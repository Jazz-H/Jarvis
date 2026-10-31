// Money and Bill Guard, in code only (Budget is the source; no bank link, no model).
// Mirrors the app's rules: js/budget-bills.js (addMonthsIso, nextBillIso, billShare, billsInMonth),
// js/budget-income.js (incomeInMonth, paycheckAt, incomeEstimate) and js/dashboard.js
// (dashPayPeriod), so Jarvis's numbers match Safe to spend in the app.
// Synced data is untrusted: names are trimmed and capped, amounts must be finite.
import { MoneyCard, type GuardItem, type PayPeriod } from "../schemas/money.ts";
import type { InboxCard } from "../schemas/inbox.ts";

const GUARD_DAYS = 3; // a bill not on autopay is flagged this many days ahead
const isIso = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
const clip = (s: unknown, n: number) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const dayNum = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
const fromNum = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
export const addDaysIso = (iso: string, n: number) => fromNum(dayNum(iso) + n);
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

// js/budget-bills.js addMonthsIso: keeps the day (or `keepDay`), clamped to the month's length
export function addMonthsIso(iso: string, n: number, keepDay?: number): string {
  const y = +iso.slice(0, 4),
    m = +iso.slice(5, 7) - 1 + n,
    day = keepDay || +iso.slice(8, 10);
  const ny = y + Math.floor(m / 12),
    nm = ((m % 12) + 12) % 12;
  const d = Math.min(day, daysInMonth(ny, nm));
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, yearly: 12 };
// js/budget-bills.js nextBillIso: null for one-time
export function nextBillIso(iso: string, repeat: unknown, day?: number): string | null {
  if (typeof repeat === "string" && MONTHS[repeat]) return addMonthsIso(iso, MONTHS[repeat], day);
  if (repeat === "weekly") return addDaysIso(iso, 7);
  if (repeat === "biweekly") return addDaysIso(iso, 14);
  return null;
}
const dayOf = (iso: string) => +iso.slice(8, 10);

interface Bill {
  id: string;
  name: string;
  amount: number;
  due: string;
  repeat: unknown;
  day?: number;
  autopay: boolean;
}
function readBills(data: any): Bill[] {
  const list = Array.isArray(data?.["bills-content"]) ? data["bills-content"] : [];
  return list
    .filter((b: any) => b && !b.done && isIso(b.due) && clip(b.name, 60))
    .slice(0, 100)
    .map((b: any) => ({
      id: String(b.id ?? ""),
      name: clip(b.name, 60),
      // js/budget-bills.js billShare: your part of a joint bill
      amount: r2(num(b.amount) * (b.group === "joint" && b.share ? num(b.share) : 100) / 100),
      due: b.due,
      repeat: b.repeat,
      day: Number.isInteger(b.day) ? b.day : undefined,
      autopay: !!b.autopay,
    }));
}
function readPayments(data: any): { amount: number; due: string }[] {
  const list = Array.isArray(data?.["bill-payments"]) ? data["bill-payments"] : [];
  return list.filter((p: any) => p && isIso(p.due)).map((p: any) => ({ amount: num(p.amount), due: p.due }));
}

// Every payday from `from` to `to` (inclusive) with what it pays, like incomeInMonth + paycheckAt
function paychecks(budget: any, from: string, to: string): { date: string; amount: number }[] {
  const income = Array.isArray(budget?.income) ? budget.income : [];
  const plans = budget?.plans && typeof budget.plans === "object" ? budget.plans : {};
  const out: { date: string; amount: number }[] = [];
  for (const src of income.slice(0, 20)) {
    if (!src || !isIso(src.start)) continue;
    // varying pay: the average of the last 3 received checks, else the typical amount
    const got = Object.entries(plans)
      .filter(([k, p]: [string, any]) => k.startsWith(src.id + "|") && p?.received && p.amount != null)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 3)
      .map(([, p]: [string, any]) => num(p.amount));
    const estimate = src.varies && got.length ? r2(got.reduce((t, n) => t + n, 0) / got.length) : num(src.amount);
    let d: string | null = src.start;
    for (let i = 0; i < 800 && d && d <= to; i++) {
      if (d >= from) {
        const plan = plans[`${src.id}|${d}`];
        out.push({ date: d, amount: plan && plan.amount != null ? num(plan.amount) : estimate });
      }
      d = nextBillIso(d, src.repeat, dayOf(src.start));
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// js/dashboard.js dashPayPeriod: last paycheck on or before today to the next payday after it
export function payPeriod(data: any, today: string): PayPeriod | null {
  const budget = data?.["budget-content"];
  const prevMonth = addMonthsIso(today.slice(0, 8) + "01", -1);
  const nextMonthEnd = addDaysIso(addMonthsIso(today.slice(0, 8) + "01", 2), -1);
  const all = paychecks(budget, prevMonth, nextMonthEnd);
  const past = all.filter((p) => p.date <= today);
  const end = all.find((p) => p.date > today)?.date;
  if (!past.length || !end) return null;
  const start = past[past.length - 1].date;
  const pay = r2(past.filter((p) => p.date === start).reduce((s, p) => s + p.amount, 0));
  const paid = r2(
    readPayments(data)
      .filter((p) => p.due >= start && p.due < end)
      .reduce((s, p) => s + p.amount, 0),
  );
  let due = 0;
  for (const b of readBills(data)) {
    let d: string | null = b.due;
    for (let i = 0; i < 800 && d && d < end; i++) {
      if (d >= start) due += b.amount;
      d = nextBillIso(d, b.repeat, b.day);
    }
  }
  due = r2(due);
  return { start, end, pay, paid, due, left: r2(pay - paid - due) };
}

// This month's spending against each category's limit (js/budget-view.js wbSpendingHtml)
function overspent(data: any, today: string): MoneyCard["overspent"] {
  const budget = data?.["budget-content"];
  const cats = Array.isArray(budget?.categories) ? budget.categories : [];
  const spent = (Array.isArray(budget?.expenses) ? budget.expenses : []).filter(
    (e: any) => e && isIso(e.date) && e.date.slice(0, 7) === today.slice(0, 7),
  );
  return cats
    .filter((c: any) => c && num(c.limit) > 0 && clip(c.name, 40))
    .map((c: any) => ({
      name: clip(c.name, 40),
      limit: r2(num(c.limit)),
      spent: r2(spent.filter((e: any) => e.cat === c.id).reduce((s: number, e: any) => s + num(e.amount), 0)),
    }))
    .filter((c: any) => c.spent > c.limit)
    .sort((a: any, b: any) => b.spent - b.limit - (a.spent - a.limit))
    .slice(0, 5);
}

export function buildMoneyCard(raw: string | null, today: string, inbox: InboxCard | null): MoneyCard | null {
  let data: any;
  try {
    data = raw ? JSON.parse(raw)?.data : null;
  } catch {
    data = null;
  }
  if (!data || typeof data !== "object") return null;
  const guard: GuardItem[] = [];
  const soon = addDaysIso(today, GUARD_DAYS);
  const bills = readBills(data).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  for (const b of bills) {
    const base = { name: b.name, amount: b.amount, due: b.due, budgetAmount: null };
    if (b.due < today && !b.autopay) guard.push({ reason: "overdue", ...base });
    else if (b.due >= today && b.due <= soon && !b.autopay) guard.push({ reason: "manual", ...base });
  }
  const period = payPeriod(data, today);
  if (period && period.pay > 0 && period.left < 0)
    guard.push({ reason: "short", name: "Bills before payday", amount: r2(-period.left), due: period.end, budgetAmount: null });
  for (const c of inbox?.bills ?? []) {
    if (c.status === "differs")
      guard.push({ reason: "differs", name: clip(c.budgetName || c.payee, 60), amount: c.amount, due: c.due, budgetAmount: c.budgetAmount });
    else if (c.status === "not-in-budget")
      guard.push({ reason: "not-in-budget", name: clip(c.payee, 60), amount: c.amount, due: c.due, budgetAmount: null });
  }
  return MoneyCard.parse({ period, guard: guard.slice(0, 8), overspent: overspent(data, today) });
}
