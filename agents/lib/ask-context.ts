// What Jarvis sees when answering an Ask question: a wider version of buildJazzContext, with every
// figure worked out here in code so the model never does the math. Rules are the app's own, shared
// with the Weekly Review through lib/week-stats.ts (to-dos, bills, autopay, routine, workouts,
// weight, goals, Shopping, spending) and lib/jazz-context.ts (wash days). The pay period and safe
// to spend mirror js/dashboard.js dashPayPeriod with js/budget-income.js (incomeInMonth,
// paycheckAt, incomeEstimate, nextPayday) and js/budget-view.js billRowsBetween.
// Plus this morning's validated briefing cards, the latest Weekly Review, and the earlier turns of
// the same thread. Synced text is untrusted: it's clipped here and only reaches the model as data.
import { addDays, isWashDate } from "./jazz-context.ts";
import { weekday } from "./schedule.ts";
import {
  addMonthsIso,
  billDuesBetween,
  goalItems,
  goalSection,
  isShoppingNeed,
  monthSpending,
  nextBillIso,
  pendingShopping,
  readBills,
  readPayments,
  routineStreak,
  settleAutopay,
  shoppingPrice,
  sundayOf,
  todoOccurrences,
  weightStatus,
  workoutOn,
  workoutPlan,
  workoutsBetween,
  type WeightStatus,
} from "./week-stats.ts";
import { readReviews } from "./reviews-file.ts";
import { Briefing } from "../schemas/briefing.ts";
import type { Answer, AskItem, AskSource } from "../schemas/ask.ts";

type Obj = Record<string, any>;
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isIso = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const clip = (s: unknown, n: number) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const cents = (n: number) => Math.round(n * 100) / 100;
const sum = (list: number[]) => cents(list.reduce((s, n) => s + n, 0));
const dayNum = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / 86400000);
const daysBetween = (a: string, b: string) => dayNum(b) - dayNum(a);
const amt = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const BILL_REPEATS = new Set(["monthly", "weekly", "biweekly", "quarterly", "yearly", "once"]);
const monthEnd = (key: string) => addDays(addMonthsIso(key + "-01", 1), -1);

// ---- pay period (js/dashboard.js dashPayPeriod) ----
export interface PayPeriod {
  start: string; // the latest payday on or before today
  nextPayday: string;
  lastDay: string; // the day before the next payday
  day: number; // today is day `day` of `days`
  days: number;
  daysToPayday: number;
  paycheck: number; // what came in on `start` (every source paid that day)
  paycheckEstimated: boolean; // pay that varies and isn't ticked Received yet
  billsPaid: number; // bills in the period already paid
  billsDue: number; // bills in the period still to pay
  safeToSpend: number; // paycheck minus bills paid and due in the period (negative = short)
}
interface Income {
  id: string;
  amount: number;
  start: string;
  repeat: string;
  varies: boolean;
}
interface Plan {
  amount?: number;
  received?: boolean;
}

function readIncome(data: Obj): { income: Income[]; plans: Record<string, Plan> } {
  const budget = isObj(data["budget-content"]) ? data["budget-content"] : {};
  const income = arr(budget.income)
    .filter((x) => isObj(x) && isIso(x.start))
    .map((x) => ({
      // an unsafe id gets a fresh random one in the app, so no plan can match it
      id: SAFE_ID.test(String(x.id)) ? String(x.id) : "",
      amount: amt(x.amount),
      start: x.start as string,
      repeat: BILL_REPEATS.has(x.repeat) ? x.repeat : "biweekly",
      varies: !!x.varies,
    }));
  const plans: Record<string, Plan> = {};
  const raw = isObj(budget.plans) ? budget.plans : {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[A-Za-z0-9_-]+\|\d{4}-\d{2}-\d{2}$/.test(k) || !isObj(v)) continue;
    plans[k] = {
      ...(v.amount != null && v.amount !== "" && Number.isFinite(Number(v.amount)) ? { amount: amt(v.amount) } : {}),
      ...(v.received ? { received: true } : {}),
    };
  }
  return { income, plans };
}

// Paydays of one source up to `to` (js/budget-income.js incomeInMonth)
function paydays(src: Income, to: string): string[] {
  const out: string[] = [];
  let d: string | null = src.start;
  for (let i = 0; i < 800 && d && d <= to; i++) {
    out.push(d);
    d = nextBillIso(d, src.repeat, +src.start.slice(8, 10));
  }
  return out;
}

// paycheckAt + incomeEstimate: the plan's own amount, else for pay that varies the average of the
// last 3 received checks (or the usual amount before any), else the usual amount
function paycheck(src: Income, date: string, plans: Record<string, Plan>) {
  const plan = src.id ? plans[`${src.id}|${date}`] : undefined;
  let amount = src.amount;
  if (plan?.amount != null) amount = plan.amount;
  else if (src.varies) {
    const got = Object.entries(plans)
      .filter(([k, p]) => src.id && k.startsWith(src.id + "|") && p.received && p.amount != null)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 3)
      .map(([, p]) => p.amount!);
    if (got.length) amount = cents(got.reduce((t, n) => t + n, 0) / got.length);
  }
  return { amount, estimated: src.varies && !plan?.received };
}

export function payPeriod(data: Obj, today: string): PayPeriod | null {
  const { income, plans } = readIncome(data);
  if (!income.length) return null;
  const prevStart = addMonthsIso(today.slice(0, 7) + "-01", -1);
  const horizon = monthEnd(addMonthsIso(today.slice(0, 7) + "-01", 1).slice(0, 7));
  const all = income.flatMap((src) => paydays(src, horizon).map((date) => ({ src, date })));
  const checks = all.filter((p) => p.date >= prevStart && p.date <= today);
  const next = all
    .map((p) => p.date)
    .filter((d) => d > today)
    .sort()[0];
  if (!checks.length || !next) return null;
  const start = checks.map((p) => p.date).sort().at(-1)!;
  const onStart = checks.filter((p) => p.date === start).map((p) => paycheck(p.src, start, plans));
  const pay = sum(onStart.map((p) => p.amount));
  const bills = readBills(data);
  const payments = readPayments(data);
  settleAutopay(bills, payments, today);
  const lastDay = addDays(next, -1);
  const paid = sum(payments.filter((p) => p.due >= start && p.due <= lastDay).map((p) => p.amount));
  const due = sum(billDuesBetween(bills, start, lastDay).map((r) => r.bill.amount));
  return {
    start,
    nextPayday: next,
    lastDay,
    day: daysBetween(start, today) + 1,
    days: daysBetween(start, next),
    daysToPayday: daysBetween(today, next),
    paycheck: pay,
    paycheckEstimated: onStart.some((p) => p.estimated),
    billsPaid: paid,
    billsDue: due,
    safeToSpend: cents(pay - paid - due),
  };
}

// ---- the briefing and the review ----
function briefingPart(raw: string | null, today: string) {
  if (!raw) return null;
  let parsed;
  try {
    parsed = Briefing.safeParse(JSON.parse(raw));
  } catch {
    return null;
  }
  if (!parsed.success || parsed.data.date < addDays(today, -1)) return null;
  const b = parsed.data;
  const ok = <T>(c: { status: "ok"; data: T } | { status: "error" } | undefined) => (c && c.status === "ok" ? c.data : null);
  const w = ok(b.cards.weather);
  const n = ok(b.cards.news);
  const cal = ok(b.cards.calendar);
  const inbox = ok(b.cards.inbox);
  const del = ok(b.cards.deliveries);
  return {
    date: b.date,
    headline: b.headline,
    summary: b.summary,
    weather: w && {
      summary: w.summary,
      conditions: w.conditions,
      highF: w.highF,
      lowF: w.lowF,
      humidityPct: w.humidityPct,
      rainChanceMax: w.rainChanceMax,
      washDayNote: w.washDayNote,
    },
    news: n && n.stories.map((s) => ({ topic: s.topic, title: s.title, source: s.source })),
    calendar: cal && { summary: cal.summary, events: cal.events, overlaps: cal.overlaps },
    inbox: inbox && { unread: inbox.unread, urgent: inbox.urgent, needsReply: inbox.needsReply, bills: inbox.bills },
    deliveries: del && { packages: del.packages },
  };
}

function reviewPart(raw: string | null, today: string) {
  const latest = readReviews(raw)
    .reviews.filter((r) => r.weekEnd <= today && r.weekEnd >= addDays(today, -13))
    .sort((a, b) => (a.weekEnd < b.weekEnd ? 1 : -1))[0];
  if (!latest) return null;
  const { id, weekStart, weekEnd, headline, stats, wins, slips, focus } = latest;
  return { id, weekStart, weekEnd, headline, stats, wins, slips, focus };
}

// ---- the owner's data ----
function workouts(data: Obj, today: string) {
  const plan = workoutPlan(data, today);
  const names = new Map<string, string>();
  const f = isObj(data["fitness-content"]) ? data["fitness-content"] : {};
  for (const p of arr(f.plan)) if (isObj(p)) names.set(String(p.id), clip(p.name, 40) || "Workout");
  const checks = isObj(f.checks) ? f.checks : {};
  const on = (iso: string) => plan.filter((p) => workoutOn(p, iso));
  const sun = sundayOf(today); // the app's fitness weeks start Sunday
  const soFar = workoutsBetween(data, sun, addDays(today, -1), today);
  const later = workoutsBetween(data, addDays(today, 1), addDays(sun, 6), today);
  const todays = on(today);
  let next: { date: string; workouts: string[] } | null = null;
  for (let i = 1; i <= 14 && !next; i++) {
    const d = addDays(today, i);
    if (on(d).length) next = { date: d, workouts: on(d).map((p) => names.get(p.id) ?? "Workout") };
  }
  return {
    thisWeek: {
      start: sun,
      doneBeforeToday: soFar.done,
      plannedBeforeToday: soFar.planned,
      missedDays: soFar.missedDays,
      plannedRestOfWeek: later.planned,
    },
    today: todays.map((p) => ({ name: names.get(p.id) ?? "Workout", done: !!checks[`${today}|${p.id}`] })),
    next,
  };
}

function goals(data: Obj) {
  const out: { section: string; done: number; total: number; open: string[] }[] = [];
  for (const x of goalItems(data)) {
    const section = goalSection(x);
    let g = out.find((o) => o.section === section);
    if (!g) out.push((g = { section, done: 0, total: 0, open: [] }));
    g.total++;
    if (x.done) g.done++;
    else if (g.open.length < 6) g.open.push(clip(x.item, 80));
  }
  return out.slice(0, 8);
}

function shopping(data: Obj) {
  const pending = pendingShopping(data);
  const rows = pending
    .map((x) => ({
      name: clip(x.name, 60) || "Item",
      price: shoppingPrice(x) || null, // null: no price saved
      need: isShoppingNeed(x),
      high: x.priority === "high",
    }))
    .sort((a, b) => Number(b.need) - Number(a.need) || Number(b.high) - Number(a.high));
  return {
    openCount: pending.length,
    needsOpen: pending.filter(isShoppingNeed).length,
    estOpen: sum(pending.map(shoppingPrice)),
    items: rows.slice(0, 20),
  };
}

export interface AskContext {
  available: boolean;
  today: string;
  weekday: string;
  jazz: Record<string, unknown> | null;
  briefing: ReturnType<typeof briefingPart>;
  review: ReturnType<typeof reviewPart>;
  sources: AskSource[]; // what the answer may cite
  notes: string[];
}

export function jazzPart(data: Obj, today: string) {
  const todos = arr(data["todo-content"]).filter(isObj);
  const overdue = todos
    .filter((t) => !t.done && isIso(t.due) && t.due < today)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))
    .map((t) => ({ text: clip(t.text, 120), due: t.due as string, starred: t.starred === true }));
  const next14 = todoOccurrences(data, today, addDays(today, 14)).sort((a, b) =>
    a.due < b.due ? -1 : a.due > b.due ? 1 : Number(b.starred) - Number(a.starred),
  );
  const anytime = todos.filter((t) => !t.done && !isIso(t.due) && clip(t.text, 120));

  const bills = readBills(data);
  const payments = readPayments(data);
  settleAutopay(bills, payments, today);
  const billRow = (b: { name: string; amount: number; autopay: boolean }, due: string) => ({
    name: b.name,
    amount: b.amount,
    due,
    autopay: b.autopay,
  });
  const billsOverdue = bills.filter((b) => !b.done && b.due < today).map((b) => billRow(b, b.due));
  const next30 = billDuesBetween(bills, today, addDays(today, 30))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))
    .map((r) => billRow(r.bill, r.due));

  const checks = isObj(data["routine-checks"]) ? data["routine-checks"] : {};
  const todayChecks = isObj(checks[today]) ? checks[today] : {};
  // No saved routine means the app's built-in one, which has wash steps (same as jazz-context.ts)
  const routine = data["skin-routine-content"] ?? { washPm: [{}] };
  const weight: WeightStatus = weightStatus(data, today);

  return {
    todos: {
      overdueCount: overdue.length,
      overdue: overdue.slice(0, 10),
      next14DaysCount: next14.length,
      next14Days: next14.slice(0, 25).map((t) => ({ text: t.text, due: t.due, starred: t.starred, repeats: t.repeats })),
      anytimeCount: anytime.length,
      anytime: anytime.slice(0, 5).map((t) => clip(t.text, 120)),
    },
    bills: {
      overdue: billsOverdue.slice(0, 10),
      overdueTotal: sum(billsOverdue.map((b) => b.amount)),
      next30Days: next30.slice(0, 20),
      next30DaysCount: next30.length,
      next30DaysTotal: sum(next30.map((b) => b.amount)),
    },
    payPeriod: payPeriod(data, today),
    spendingThisMonth: monthSpending(data, today),
    routine: {
      streak: routineStreak(data, today),
      amDoneToday: !!todayChecks.amDone,
      pmDoneToday: !!todayChecks.pmDone,
      washToday: isWashDate(today, routine),
      washTomorrow: isWashDate(addDays(today, 1), routine),
    },
    workouts: workouts(data, today),
    weight,
    goals: goals(data),
    shopping: shopping(data),
  };
}

export function buildAskContext(opts: {
  data: Obj | null;
  today: string;
  briefingRaw: string | null;
  reviewsRaw: string | null;
}): AskContext {
  const { data, today } = opts;
  const notes: string[] = [];
  const briefing = briefingPart(opts.briefingRaw, today);
  const review = reviewPart(opts.reviewsRaw, today);
  if (!data) notes.push("The owner's Jazz data isn't available, so to-dos, bills and money are left out.");
  if (!briefing) notes.push("There's no briefing from this morning, so weather, news, calendar, inbox and deliveries are left out.");
  else if (briefing.date !== today) notes.push(`The latest briefing is from ${briefing.date}, not today.`);
  if (!briefing?.calendar && briefing) notes.push("The calendar isn't in this morning's briefing.");
  if (!review) notes.push("There's no Weekly Review from the last two weeks.");
  notes.push("Calendar, inbox and deliveries are as of this morning's briefing, not live.");
  const sources: AskSource[] = [];
  if (data) sources.push("jazz");
  if (briefing?.calendar) sources.push("calendar");
  if (briefing?.inbox) sources.push("inbox");
  if (briefing?.deliveries) sources.push("deliveries");
  if (briefing?.weather) sources.push("weather");
  if (briefing?.news) sources.push("news");
  if (review) sources.push("review");
  return {
    available: !!data,
    today,
    weekday: WEEKDAYS[weekday(today)],
    jazz: data ? jazzPart(data, today) : null,
    briefing,
    review,
    sources,
    notes,
  };
}

// ---- the thread ----
export interface Turn {
  askedAt: string;
  question: string | null; // null once the app has pruned the question from jazz2-ask.json
  answer: string | null;
}

// Earlier turns of the same thread, oldest first, at most `max`. A question links to its thread by
// `thread` (the first question's id). Answers carry no question text, so a pruned question shows
// only its answer (the thread's first answer is always found by its id).
export function threadTurns(item: AskItem, items: AskItem[], answers: Map<string, Answer>, max: number): Turn[] {
  const root = item.thread;
  if (!root || root === item.id) return [];
  const t = (s: string) => Date.parse(s);
  const said = (a: Answer | undefined) =>
    a && (a.status === "ok" || a.status === "declined")
      ? [a.text, ...a.bullets.map((b) => "- " + b)].join("\n").slice(0, 1600)
      : null;
  const turns = new Map<string, Turn>();
  for (const x of items) {
    if (x.id === item.id || (x.id !== root && x.thread !== root) || t(x.at) > t(item.at)) continue;
    turns.set(x.id, { askedAt: x.at, question: x.text, answer: said(answers.get(x.id)) });
  }
  const rootAnswer = answers.get(root);
  if (!turns.has(root) && rootAnswer)
    turns.set(root, { askedAt: rootAnswer.askedAt, question: null, answer: said(rootAnswer) });
  return [...turns.values()]
    .filter((x) => x.question || x.answer)
    .sort((a, b) => t(a.askedAt) - t(b.askedAt))
    .slice(-max);
}
