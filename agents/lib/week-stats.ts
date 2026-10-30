// Every number in the Weekly Review, computed in plain code from jazz2-data.json (the model never
// does math). The window is Monday to Sunday (America/New_York dates) ending on the review's
// Sunday, plus a preview of the Monday to Sunday ahead. These mirror the app's own rules, the way
// jazz-context.ts does:
//   to-dos      js/todo.js (completedAt, archiveOldTodos), js/todo-dates.js (nextRepeatIso, todoNext)
//   routine     js/skin.js routineStreak (amDone/pmDone recorded per day)
//   workouts    js/fitness.js workoutOn (Sunday-based weeks, every N weeks from the anchor's week)
//   weight      js/fitness.js normalizeFitness + weightStatus (pct, 8-week pace, eta)
//   goals       js/jazz3.js normalizePlan3 (sections in saved order)
//   bills       js/budget-bills.js billShare, nextBillIso, processAutopay
//   spending    js/budget-view.js normalizeBudgetData (expenses against monthly category limits)
//   shopping    js/shopping.js wantKind, js/dashboard.js dashShopData (pending = not bought, not later)
// Goals and Shopping store no dates, so "this week" is a diff against the previous review's
// snapshot of done/bought ids; with no previous review those figures are null ("not tracked yet").
// Synced data is untrusted: every field is type-checked, text is clipped, and counts are capped.
import { addDays, isWashDate } from "./jazz-context.ts";
import { localTime, weekday } from "./schedule.ts";
import { WeekStats, type Snapshot } from "../schemas/review.ts";
import type { DayDigest } from "../schemas/week.ts";

export interface ReviewWeek {
  id: string; // ISO week, "2026-W44"
  weekStart: string; // Monday
  weekEnd: string; // Sunday
  nextStart: string;
  nextEnd: string;
}

type Obj = Record<string, any>;
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isIso = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/; // js/data-load.js SAFE_ID (other ids aren't stable)
const clip = (s: unknown, n: number) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const amt = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const money = (n: number) => Math.min(10_000_000, Math.round(n * 100) / 100);
const count = (n: number) => Math.min(100_000, n);
const dayNum = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / 86400000);
const daysInMonth = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7), 0)).getUTCDate();
const range = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
};

// The week a review covers: Monday to the Sunday on or before `today` (a Sunday covers itself)
export function reviewWeek(today: string): ReviewWeek {
  const weekEnd = addDays(today, -weekday(today));
  const weekStart = addDays(weekEnd, -6);
  return { id: isoWeekId(weekStart), weekStart, weekEnd, nextStart: addDays(weekEnd, 1), nextEnd: addDays(weekEnd, 7) };
}

// ISO 8601 week id: weeks start Monday and belong to the year their Thursday falls in
export function isoWeekId(iso: string): string {
  const thursday = addDays(iso, 3 - ((weekday(iso) + 6) % 7));
  const year = thursday.slice(0, 4);
  const week = Math.floor((dayNum(thursday) - dayNum(`${year}-01-01`)) / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// ---- dates that repeat (js/budget-bills.js addMonthsIso, js/todo-dates.js nextRepeatIso) ----
export function addMonthsIso(iso: string, n: number, keepDay?: number): string {
  const y = +iso.slice(0, 4),
    m = +iso.slice(5, 7) - 1 + n,
    day = keepDay || +iso.slice(8, 10);
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}

// null for an unknown repeat (the app would return the same date; here that would never advance)
export function nextRepeatIso(iso: string, repeat: unknown, day?: number, every = 1): string | null {
  switch (repeat) {
    case "monthly":
      return addMonthsIso(iso, 1, day);
    case "months":
      return addMonthsIso(iso, every, day);
    case "yearly":
      return addMonthsIso(iso, 12, day);
    case "daily":
      return addDays(iso, 1);
    case "weekdays": {
      let d = addDays(iso, 1);
      while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, 1);
      return d;
    }
    case "weekly":
      return addDays(iso, 7);
    case "biweekly":
      return addDays(iso, 14);
    case "weeks":
      return addDays(iso, 7 * every);
    default:
      return null;
  }
}

const BILL_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, yearly: 12 };
const BILL_REPEATS = new Set(["monthly", "weekly", "biweekly", "quarterly", "yearly", "once"]);
export function nextBillIso(iso: string, repeat: string, day?: number): string | null {
  if (BILL_MONTHS[repeat]) return addMonthsIso(iso, BILL_MONTHS[repeat], day);
  if (repeat === "weekly" || repeat === "biweekly") return nextRepeatIso(iso, repeat);
  return null; // one-time
}

// ---- to-dos ----
const TODO_REPEATS = new Set(["daily", "weekdays", "weekly", "biweekly", "monthly", "yearly", "weeks", "months"]);
function todoNext(iso: string, t: Obj): string | null {
  const day = Number.isInteger(t.repeatDay) && t.repeatDay >= 1 && t.repeatDay <= 31 ? t.repeatDay : +t.due.slice(8, 10);
  const every =
    t.repeat === "weeks" || t.repeat === "months" ? Math.max(1, Math.min(99, parseInt(t.every, 10) || 2)) : 1;
  return nextRepeatIso(iso, t.repeat, day, every);
}

function todoStats(data: Obj, w: ReviewWeek, timeZone: string): WeekStats["todos"] {
  const inW = (iso: string | null) => iso != null && iso >= w.weekStart && iso <= w.weekEnd;
  const doneOn = (t: Obj): string | null => {
    const ms = Number(t.completedAt);
    if (t.completedAt == null || !Number.isFinite(ms) || ms <= 0 || ms > 8.64e15) return null;
    return localTime(new Date(ms), timeZone).date;
  };
  const active = arr(data["todo-content"]).filter(isObj);
  // completed to-dos move to the archive after 7 days (archiveOldTodos); a sync race could leave
  // one in both, so archive rows matching an active one are skipped
  const seen = new Set(active.filter((t) => t.done).map((t) => `${String(t.text)}|${Number(t.completedAt)}`));
  const archive = arr(data["todo-archive-content"])
    .filter(isObj)
    .filter((t) => !seen.has(`${String(t.text)}|${Number(t.completedAt)}`))
    .map((t): Obj => ({ ...t, done: true, starred: false })); // the archive keeps no star
  const all: Obj[] = [...active, ...archive];
  const done = all.filter((t) => t.done && inW(doneOn(t)));
  const due = all.filter((t) => isIso(t.due) && inW(t.due));
  const open = active.filter((t) => !t.done && isIso(t.due));
  return {
    done: count(done.length),
    due: count(due.length),
    dueDone: count(due.filter((t) => t.done).length),
    missed: count(open.filter((t) => inW(t.due)).length),
    carried: count(open.filter((t) => t.due < w.weekStart).length),
    starredDone: count(done.filter((t) => t.starred === true).length),
  };
}

// Open to-dos per day of the week ahead, with repeating ones projected (js/todo-dates.js occursOn)
function todosAhead(data: Obj, w: ReviewWeek): Map<string, number> {
  const per = new Map<string, number>();
  const add = (d: string) => per.set(d, (per.get(d) ?? 0) + 1);
  for (const t of arr(data["todo-content"])) {
    if (!isObj(t) || t.done || !isIso(t.due) || t.due > w.nextEnd) continue;
    if (t.due >= w.nextStart) add(t.due);
    if (!TODO_REPEATS.has(t.repeat)) continue;
    let d: string | null = t.due;
    for (let i = 0; i < 800 && d; i++) {
      d = todoNext(d, t);
      if (!d || d > w.nextEnd) break;
      if (d >= w.nextStart) add(d);
    }
  }
  return per;
}

// ---- routine ----
function routineStats(data: Obj, w: ReviewWeek): WeekStats["routine"] {
  const checks = isObj(data["routine-checks"]) ? data["routine-checks"] : {};
  const day = (k: string) => (isObj(checks[k]) ? checks[k] : null);
  const full = (k: string) => !!(day(k)?.amDone && day(k)?.pmDone);
  const days = range(w.weekStart, w.weekEnd);
  // routineStreak(): consecutive full days ending Sunday, counting Sunday only once it's done
  let d = full(w.weekEnd) ? w.weekEnd : addDays(w.weekEnd, -1),
    streak = 0;
  while (streak < 1000 && full(d)) {
    streak++;
    d = addDays(d, -1);
  }
  return {
    fullDays: days.filter(full).length,
    amOnly: days.filter((k) => !!day(k)?.amDone && !day(k)?.pmDone).length,
    streak,
  };
}

// ---- workouts ----
interface Workout {
  id: string;
  days: number[];
  every: number;
  anchor: string;
}
const sundayOf = (iso: string) => addDays(iso, -weekday(iso)); // js/fitness.js weekStartIso
function workoutOn(p: Workout, iso: string): boolean {
  if (!p.days.includes(weekday(iso))) return false;
  if (iso < sundayOf(p.anchor)) return false; // the plan starts the week of its start date
  if (p.every <= 1) return true;
  const weeks = Math.round((dayNum(sundayOf(iso)) - dayNum(sundayOf(p.anchor))) / 7);
  return ((weeks % p.every) + p.every) % p.every === 0;
}
function fitnessOf(data: Obj): Obj {
  return isObj(data["fitness-content"]) ? data["fitness-content"] : {};
}
// Plans whose id isn't a safe token get a fresh random id in the app on every load, so their
// checks can't be matched; they're left out here.
function workoutPlan(data: Obj, asOf: string): Workout[] {
  return arr(fitnessOf(data).plan)
    .filter((p) => isObj(p) && SAFE_ID.test(String(p.id)))
    .map((p) => ({
      id: String(p.id),
      days: [...new Set(arr(p.days).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
      every: Math.max(1, Math.min(4, parseInt(p.every, 10) || 1)),
      anchor: isIso(p.anchor) ? p.anchor : asOf, // the app falls back to "today"
    }));
}
function workoutStats(data: Obj, w: ReviewWeek): WeekStats["workouts"] {
  const plan = workoutPlan(data, w.weekEnd);
  const checks = isObj(fitnessOf(data).checks) ? fitnessOf(data).checks : {};
  let planned = 0,
    done = 0;
  const missedDays: string[] = [];
  for (const iso of range(w.weekStart, w.weekEnd)) {
    const on = plan.filter((p) => workoutOn(p, iso));
    const ok = on.filter((p) => !!checks[`${iso}|${p.id}`]).length;
    planned += on.length;
    done += ok;
    if (on.length && ok < on.length) missedDays.push(iso);
  }
  return { done: count(done), planned: count(planned), missedDays };
}

// ---- weight ----
const lbs = (v: unknown) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n >= 40 && n <= 800 ? r1(n) : null;
};
function weightStats(data: Obj, w: ReviewWeek): WeekStats["weight"] {
  const f = fitnessOf(data);
  const all = arr(f.weights)
    .filter((x) => isObj(x) && isIso(x.date) && lbs(x.lbs) != null)
    .map((x) => ({ date: x.date as string, lbs: lbs(x.lbs)! }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const upTo = all.filter((x) => x.date <= w.weekEnd); // as of Sunday
  const week = upTo.filter((x) => x.date >= w.weekStart);
  const cur = upTo.length ? upTo[upTo.length - 1].lbs : null;
  const before = upTo.filter((x) => x.date < w.weekStart).pop();
  const base = before ?? (week.length >= 2 ? week[0] : null);
  const change = week.length && base ? r1(week[week.length - 1].lbs - base.lbs) : null;
  let pct: number | null = null,
    eta: string | null = null;
  const goal = lbs(f.goal);
  const start = lbs(f.start) ?? (upTo[0]?.lbs ?? null);
  if (cur != null && goal != null) {
    const reached =
      start != null && start !== goal ? (goal > start ? cur >= goal : cur <= goal) : Math.abs(goal - cur) < 0.05;
    pct =
      start != null && goal !== start
        ? Math.max(0, Math.min(100, Math.round(((cur - start) / (goal - start)) * 100)))
        : reached
          ? 100
          : 0;
    // pace: first to last weigh-in over the last 8 weeks; with fewer than 3 there, all of them
    let recent = upTo.filter((x) => x.date >= addDays(w.weekEnd, -56));
    if (recent.length < 3 && upTo.length > recent.length) recent = upTo;
    if (recent.length >= 2) {
      const weeks = (dayNum(recent[recent.length - 1].date) - dayNum(recent[0].date)) / 7;
      if (weeks >= 1) {
        const rate = r1((recent[recent.length - 1].lbs - recent[0].lbs) / weeks);
        if (!reached && rate && Math.sign(rate) === Math.sign(goal - cur))
          eta = addDays(w.weekEnd, Math.min(36500, Math.ceil((Math.abs(goal - cur) / Math.abs(rate)) * 7)));
      }
    }
  }
  return { weighIns: count(week.length), current: cur, change, pct, eta };
}

// ---- goals (Jazz 3.0 sections) ----
function goalStats(data: Obj, prev: Snapshot | null): { goals: WeekStats["goals"]; doneIds: string[] } {
  const items = arr(data["plan3-content"]).filter((x) => isObj(x) && String(x.item ?? "").trim());
  const before = prev ? new Set(prev.plan3Done) : null;
  const out: WeekStats["goals"] = [];
  const doneIds: string[] = [];
  for (const x of items) {
    const name = clip(String(x.cat || "Goals").trim().slice(0, 30), 40) || "Goals";
    let g = out.find((o) => o.name === name);
    if (!g) out.push((g = { name, doneThisWeek: before ? 0 : null, done: 0, total: 0 }));
    g.total++;
    if (!x.done) continue;
    g.done++;
    const id = String(x.id);
    if (!SAFE_ID.test(id)) continue;
    doneIds.push(id);
    if (before && !before.has(id)) g.doneThisWeek!++;
  }
  return { goals: out.slice(0, 6), doneIds: doneIds.slice(0, 200) };
}

// ---- bills ----
interface Bill {
  id: string;
  name: string;
  amount: number; // your share (billShare)
  due: string;
  repeat: string;
  autopay: boolean;
  done: boolean;
  day: number;
  hold: string | null;
}
function readBills(data: Obj): Bill[] {
  // a bill without a valid due date gets "today" in the app; here it's left out
  return arr(data["bills-content"])
    .filter((b) => isObj(b) && isIso(b.due))
    .map((b) => {
      const sh = Number(b.share);
      const share = b.group === "joint" && sh > 0 && sh < 100 ? Math.round(sh) : 100;
      return {
        id: String(b.id ?? ""),
        name: clip(b.name, 60) || "Bill",
        amount: Math.round(amt(b.amount) * share) / 100,
        due: b.due,
        repeat: BILL_REPEATS.has(b.repeat) ? b.repeat : "monthly",
        autopay: !!b.autopay,
        done: !!b.done,
        day: Number.isInteger(b.day) && b.day >= 1 && b.day <= 31 ? b.day : +b.due.slice(8, 10),
        hold: isIso(b.hold) ? b.hold : null,
      };
    });
}
function billStats(data: Obj, w: ReviewWeek): { bills: WeekStats["bills"]; perDay: Map<string, number> } {
  const bills = readBills(data);
  const payments = arr(data["bill-payments"])
    .filter((p) => isObj(p) && isIso(p.due) && isIso(p.date))
    .map((p) => ({ id: String(p.id ?? ""), amount: amt(p.amount), date: p.date as string, auto: !!p.auto }));
  // processAutopay(): the app logs autopay bills only when it's opened, so a payment that came due
  // since then is logged here the same way (same derived id, so it's never counted twice)
  for (const b of bills) {
    if (!b.autopay || b.done) continue;
    for (let i = 0; i < 60 && b.due <= w.weekEnd && b.due !== b.hold; i++) {
      const id = `pay-auto-${b.id}-${b.due}`;
      if (!payments.some((p) => p.id === id)) payments.push({ id, amount: b.amount, date: b.due, auto: true });
      const next = nextBillIso(b.due, b.repeat, b.day);
      if (next) b.due = next;
      else {
        b.done = true;
        break;
      }
    }
  }
  const paid = payments.filter((p) => p.date >= w.weekStart && p.date <= w.weekEnd);
  const perDay = new Map<string, number>();
  let dueNext = 0,
    dueNextTotal = 0;
  for (const b of bills) {
    if (b.done) continue;
    let d: string | null = b.due;
    for (let i = 0; i < 800 && d && d <= w.nextEnd; i++) {
      if (d >= w.nextStart) {
        dueNext++;
        dueNextTotal += b.amount;
        perDay.set(d, (perDay.get(d) ?? 0) + 1);
      }
      d = nextBillIso(d, b.repeat, b.day);
    }
  }
  return {
    bills: {
      paid: count(paid.length),
      autopaid: count(paid.filter((p) => p.auto).length),
      paidTotal: money(paid.reduce((s, p) => s + p.amount, 0)),
      unpaidPastDue: bills
        .filter((b) => !b.done && b.due <= w.weekEnd)
        .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0))
        .slice(0, 5)
        .map((b) => b.name),
      dueNextWeek: count(dueNext),
      dueNextWeekTotal: money(dueNextTotal),
    },
    perDay,
  };
}

// ---- spending ----
function spendingStats(data: Obj, w: ReviewWeek): WeekStats["spending"] {
  const budget = isObj(data["budget-content"]) ? data["budget-content"] : {};
  const cats = arr(budget.categories)
    .filter(isObj)
    .map((c) => ({ id: String(c.id ?? ""), name: clip(c.name, 40) || "Category", limit: amt(c.limit) }));
  const exps = arr(budget.expenses)
    .filter((e) => isObj(e) && isIso(e.date))
    .map((e) => ({ amount: amt(e.amount), cat: e.cat == null ? "" : String(e.cat), date: e.date as string }));
  const month = w.weekEnd.slice(0, 7);
  const week = exps.filter((e) => e.date >= w.weekStart && e.date <= w.weekEnd);
  const mtd = exps.filter((e) => e.date.slice(0, 7) === month && e.date <= w.weekEnd);
  const days = range(w.weekStart, w.weekEnd);
  // a monthly limit spread over the week's days, each day at its own month's rate
  const prorate = (limit: number) => money(days.reduce((s, d) => s + limit / daysInMonth(d), 0));
  const sum = (list: { amount: number }[]) => money(list.reduce((s, e) => s + e.amount, 0));
  const known = new Set(cats.map((c) => c.id));
  const rows = cats.map((c) => ({
    name: c.name,
    spent: sum(week.filter((e) => e.cat === c.id)),
    limitWeek: c.limit ? prorate(c.limit) : null,
    monthSpent: sum(mtd.filter((e) => e.cat === c.id)),
    limitMonth: c.limit ? money(c.limit) : null,
  }));
  const orphan = (e: { cat: string }) => !known.has(e.cat);
  if (exps.some(orphan))
    rows.push({
      name: "Uncategorized",
      spent: sum(week.filter(orphan)),
      limitWeek: null,
      monthSpent: sum(mtd.filter(orphan)),
      limitMonth: null,
    });
  return {
    total: sum(week),
    byCat: rows
      .filter((r) => r.spent > 0 || r.monthSpent > 0)
      .sort((a, b) => b.spent - a.spent || b.monthSpent - a.monthSpent)
      .slice(0, 8),
  };
}

// ---- shopping ----
function shoppingStats(data: Obj, prev: Snapshot | null): { shopping: WeekStats["shopping"]; boughtIds: string[] } {
  const list = arr(data["wants-content"]).filter(isObj);
  const state = isObj(data["wants-state"]) ? data["wants-state"] : {};
  const isBought = (x: Obj) => !!state[String(x.id)];
  const pending = list.filter((x) => !isBought(x) && !x.later);
  const isNeed = (x: Obj) => x.kind === "need" || (x.kind !== "want" && !!x.wardrobeCat);
  const boughtNow = list.filter((x) => isBought(x) && SAFE_ID.test(String(x.id)));
  const before = prev ? new Set(prev.wantsBought) : null;
  const fresh = before ? boughtNow.filter((x) => !before.has(String(x.id))) : null;
  return {
    shopping: {
      bought: fresh ? fresh.slice(0, 8).map((x) => clip(x.name, 60) || "Item") : null,
      boughtCount: fresh ? count(fresh.length) : null,
      needsOpen: count(pending.filter(isNeed).length),
      estOpen: money(pending.reduce((s, x) => s + amt(x.price), 0)),
    },
    boughtIds: boughtNow.map((x) => String(x.id)).slice(0, 400),
  };
}

// ---- next week ----
function nextWeekStats(
  data: Obj,
  w: ReviewWeek,
  billsPerDay: Map<string, number>,
  calendarDays: Record<string, number> | null,
): WeekStats["nextWeek"] {
  const days = range(w.nextStart, w.nextEnd);
  const todos = todosAhead(data, w);
  const plan = workoutPlan(data, w.weekEnd);
  const workouts = new Map(days.map((d) => [d, plan.filter((p) => workoutOn(p, d)).length]));
  const cal = (d: string) => {
    const n = calendarDays ? Number(calendarDays[d]) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  // No saved routine means the app's built-in one, which has wash steps (same as jazz-context.ts)
  const routine = data["skin-routine-content"] ?? { washPm: [{}] };
  let busiest: string | null = null,
    best = 0;
  for (const d of days) {
    const n = cal(d) + (todos.get(d) ?? 0) + (billsPerDay.get(d) ?? 0) + (workouts.get(d) ?? 0);
    if (n > best) [busiest, best] = [d, n];
  }
  const sum = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + n, 0);
  return {
    start: w.nextStart,
    end: w.nextEnd,
    events: calendarDays ? count(days.reduce((s, d) => s + cal(d), 0)) : null,
    busiestDay: busiest,
    todosDue: count(sum(todos)),
    billsDue: count(sum(billsPerDay)),
    workouts: count(sum(workouts)),
    washDays: days.filter((d) => isWashDate(d, routine)).slice(0, 3),
  };
}

// ---- inbox (from the morning digests) ----
function inboxStats(digests: DayDigest[], w: ReviewWeek): WeekStats["inbox"] {
  const days = digests
    .filter((d) => d.inbox && d.date >= w.weekStart && d.date <= w.weekEnd)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!days.length) return undefined;
  const key = (s: string) => s.trim().toLowerCase();
  // still waiting = the latest morning's list; mismatches = any bill email that week that
  // disagreed with Budget or wasn't in it
  const latest = days[days.length - 1].inbox!;
  const waiting = new Set(latest.needsReply.map((x) => key(x.from)));
  const mismatched = new Set(
    days.flatMap((d) =>
      d.inbox!.bills.filter((b) => b.status === "differs" || b.status === "not-in-budget").map((b) => key(b.payee)),
    ),
  );
  return { days: days.length, awaitingReply: waiting.size, billMismatches: mismatched.size };
}

// jazz2-data.json's `data` object, or null when it's missing or unreadable
export function parseJazzData(raw: string | null): Obj | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw)?.data;
    return isObj(d) ? d : null;
  } catch {
    return null;
  }
}

export interface WeekStatsInput {
  data: Obj;
  week: ReviewWeek;
  timeZone: string;
  prev: Snapshot | null; // the previous review's snapshot, for the goals/shopping diff
  digests: DayDigest[];
  calendarDays: Record<string, number> | null; // events per day next week; null if not connected
}

export function computeWeekStats(input: WeekStatsInput): { stats: WeekStats; snapshot: Snapshot } {
  const { data, week, prev } = input;
  const goals = goalStats(data, prev);
  const bills = billStats(data, week);
  const shopping = shoppingStats(data, prev);
  const inbox = inboxStats(input.digests, week);
  const stats = WeekStats.parse({
    todos: todoStats(data, week, input.timeZone),
    routine: routineStats(data, week),
    workouts: workoutStats(data, week),
    weight: weightStats(data, week),
    goals: goals.goals,
    bills: bills.bills,
    spending: spendingStats(data, week),
    shopping: shopping.shopping,
    nextWeek: nextWeekStats(data, week, bills.perDay, input.calendarDays),
    ...(inbox ? { inbox } : {}),
  });
  return { stats, snapshot: { plan3Done: goals.doneIds, wantsBought: shopping.boughtIds } };
}
