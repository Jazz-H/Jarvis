import { describe, it, expect } from "vitest";
import {
  addMonthsIso,
  computeWeekStats,
  isoWeekId,
  nextRepeatIso,
  parseJazzData,
  reviewWeek,
  type WeekStatsInput,
} from "../lib/week-stats.ts";
import { WeekStats } from "../schemas/review.ts";
import { FIXTURE, DIGESTS } from "./week-fixture.ts";

const TZ = "America/New_York";
// 2026-W44: Mon Oct 26 to Sun Nov 1. It crosses the month end, and daylight saving ends on its
// Sunday (Nov 1, 2am EDT -> 1am EST), so local midnight is 04:00Z at the start and 05:00Z at the end.
const WEEK = reviewWeek("2026-11-01");
const input = (over: Partial<WeekStatsInput> = {}): WeekStatsInput => ({
  data: FIXTURE,
  week: WEEK,
  timeZone: TZ,
  prev: null,
  digests: DIGESTS,
  calendarDays: { "2026-11-03": 4, "2026-11-09": 9 },
  ...over,
});

describe("review week", () => {
  it("covers Monday to the Sunday on or before today", () => {
    expect(WEEK).toEqual({
      id: "2026-W44",
      weekStart: "2026-10-26",
      weekEnd: "2026-11-01",
      nextStart: "2026-11-02",
      nextEnd: "2026-11-08",
    });
    expect(reviewWeek("2026-11-04").weekEnd).toBe("2026-11-01"); // a Wednesday re-run reviews last week
    expect(reviewWeek("2026-11-07").id).toBe("2026-W44");
  });

  it("uses ISO week ids across the year end", () => {
    expect(isoWeekId("2026-12-28")).toBe("2026-W53");
    expect(isoWeekId("2027-01-03")).toBe("2026-W53");
    expect(isoWeekId("2027-01-04")).toBe("2027-W01");
    expect(isoWeekId("2025-12-29")).toBe("2026-W01");
    expect(isoWeekId("2026-01-01")).toBe("2026-W01");
    expect(reviewWeek("2027-01-03")).toMatchObject({ weekStart: "2026-12-28", nextEnd: "2027-01-10" });
  });

  it("repeats dates like the app (month-end clamping, weekdays)", () => {
    expect(addMonthsIso("2026-01-31", 1, 31)).toBe("2026-02-28");
    expect(addMonthsIso("2026-02-28", 1, 31)).toBe("2026-03-31");
    expect(addMonthsIso("2026-11-15", 3)).toBe("2027-02-15");
    expect(nextRepeatIso("2026-10-30", "weekdays")).toBe("2026-11-02");
    expect(nextRepeatIso("2026-10-30", "weeks", undefined, 3)).toBe("2026-11-20");
    expect(nextRepeatIso("2026-10-30", "bogus")).toBeNull();
  });
});

describe("week stats", () => {
  const { stats, snapshot } = computeWeekStats(input());

  it("counts to-dos by local date across the DST change, with the archive", () => {
    expect(stats.todos).toEqual({ done: 3, due: 4, dueDone: 2, missed: 2, carried: 1, starredDone: 1 });
  });

  it("counts routine days and the streak as of Sunday (routineStreak)", () => {
    expect(stats.routine).toEqual({ fullDays: 5, amOnly: 1, streak: 2 });
  });

  it("counts planned workouts with every-N-weeks plans (workoutOn)", () => {
    expect(stats.workouts).toEqual({ done: 3, planned: 4, missedDays: ["2026-10-28"] });
  });

  it("works out weight change, goal progress and pace (weightStatus)", () => {
    expect(stats.weight).toEqual({ weighIns: 2, current: 192.5, change: -1.5, pct: 38, eta: "2027-01-28" });
  });

  it("reports goal sections; this week's ticks aren't tracked before a snapshot", () => {
    expect(stats.goals).toEqual([
      { name: "Glow", doneThisWeek: null, done: 1, total: 2 },
      { name: "Leadership", doneThisWeek: null, done: 1, total: 1 },
    ]);
    expect(snapshot.plan3Done).toEqual(["p3-1", "p3-3"]);
  });

  it("counts bills paid (with autopay the app hasn't logged yet, never twice) and what's due next", () => {
    expect(stats.bills).toEqual({
      paid: 2,
      autopaid: 1,
      paidTotal: 160,
      unpaidPastDue: ["Gym", "Rent"],
      dueNextWeek: 2,
      dueNextWeekTotal: 110,
    });
    // without the app's own autopay record, the same payment is derived here
    const data = { ...FIXTURE, "bill-payments": (FIXTURE["bill-payments"] as any[]).slice(0, 2) };
    expect(computeWeekStats(input({ data })).stats.bills).toMatchObject({ paid: 2, autopaid: 1, paidTotal: 160 });
  });

  it("prorates monthly limits over a week that crosses the month end", () => {
    expect(stats.spending).toEqual({
      total: 117.75,
      byCat: [
        // 6 October days at 310/31 + 1 November day at 310/30
        { name: "Groceries", spent: 90.5, limitWeek: 70.33, monthSpent: 20, limitMonth: 310 },
        { name: "Fun", spent: 15, limitWeek: null, monthSpent: 15, limitMonth: null },
        { name: "Uncategorized", spent: 12.25, limitWeek: null, monthSpent: 0, limitMonth: null },
      ],
    });
  });

  it("reports open needs and the estimate; bought isn't tracked before a snapshot", () => {
    expect(stats.shopping).toEqual({ bought: null, boughtCount: null, needsOpen: 2, estOpen: 160 });
    expect(snapshot.wantsBought).toEqual(["w5"]);
  });

  it("previews next week with projected repeats, bills, workouts and wash days", () => {
    expect(stats.nextWeek).toEqual({
      start: "2026-11-02",
      end: "2026-11-08",
      events: 4,
      busiestDay: "2026-11-03",
      todosDue: 2,
      billsDue: 2,
      workouts: 3,
      washDays: ["2026-11-04"],
    });
    expect(computeWeekStats(input({ calendarDays: null })).stats.nextWeek.events).toBeNull();
  });

  it("reads Inbox from this week's digests only", () => {
    expect(stats.inbox).toEqual({ days: 2, awaitingReply: 1, billMismatches: 1 });
    expect(computeWeekStats(input({ digests: [] })).stats.inbox).toBeUndefined();
  });

  it("diffs goals and shopping against the previous review's snapshot", () => {
    const r = computeWeekStats(input({ prev: { plan3Done: ["p3-1"], wantsBought: [] } })).stats;
    expect(r.goals.map((g) => g.doneThisWeek)).toEqual([0, 1]);
    expect(r.shopping).toMatchObject({ bought: ["Socks"], boughtCount: 1 });
    const same = computeWeekStats(input({ prev: snapshot })).stats;
    expect(same.goals.map((g) => g.doneThisWeek)).toEqual([0, 0]);
    expect(same.shopping).toMatchObject({ bought: [], boughtCount: 0 });
  });
});

describe("week stats edge cases", () => {
  it("returns zeros for empty data", () => {
    const { stats, snapshot } = computeWeekStats(input({ data: {}, digests: [], calendarDays: null }));
    expect(stats.todos).toEqual({ done: 0, due: 0, dueDone: 0, missed: 0, carried: 0, starredDone: 0 });
    expect(stats.routine).toEqual({ fullDays: 0, amOnly: 0, streak: 0 });
    expect(stats.workouts).toEqual({ done: 0, planned: 0, missedDays: [] });
    expect(stats.weight).toEqual({ weighIns: 0, current: null, change: null, pct: null, eta: null });
    expect(stats.goals).toEqual([]);
    expect(stats.bills).toEqual({ paid: 0, autopaid: 0, paidTotal: 0, unpaidPastDue: [], dueNextWeek: 0, dueNextWeekTotal: 0 });
    expect(stats.spending).toEqual({ total: 0, byCat: [] });
    expect(stats.shopping).toEqual({ bought: null, boughtCount: null, needsOpen: 0, estOpen: 0 });
    // no saved routine = the app's built-in wash schedule (every 14 days from Jul 16)
    expect(stats.nextWeek).toMatchObject({ events: null, busiestDay: null, washDays: ["2026-11-05"] });
    expect(snapshot).toEqual({ plan3Done: [], wantsBought: [] });
  });

  it("survives junk data and keeps every field inside the schema caps", () => {
    const long = "<img src=x onerror=alert(1)>".repeat(40);
    const junk = {
      "todo-content": { not: "an array" },
      "todo-archive-content": [{ completedAt: "abc" }, { completedAt: 1e20 }, { completedAt: -5 }],
      "routine-checks": ["x"],
      "fitness-content": { weights: "x", plan: [{ id: "a", days: "x", every: "abc", anchor: 7 }], goal: "x", checks: 3 },
      "plan3-content": [{ id: "<b>", cat: long, item: long, done: true }, ...Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, cat: `S${i}`, item: "x" }))],
      "bills-content": [
        { name: long, amount: "-5", due: "nope" },
        { id: "j", name: long, amount: 1e300, due: "2026-10-30", repeat: "bogus", autopay: "yes" },
        { name: "NaN", amount: NaN, due: "2026-10-29", repeat: "weekly", day: 99 },
        ...Array.from({ length: 10 }, (_, i) => ({ name: `B${i}`, amount: 1, due: "2026-10-01", repeat: "once" })),
      ],
      "bill-payments": [{ date: "2026-10-27" }, { due: "2026-10-27", date: "2026-10-27", amount: "x" }],
      "budget-content": { categories: "x", expenses: [{ amount: 1e12, date: "2026-10-27" }, { amount: "5", date: "bad" }] },
      "wants-content": [{ id: "w", name: long, price: -3 }, { id: { evil: 1 }, name: 5 }],
      "wants-state": "x",
      "skin-routine-content": { washPm: [], wash: "x" },
    };
    const { stats, snapshot } = computeWeekStats(input({ data: junk, digests: [], calendarDays: null }));
    expect(() => WeekStats.parse(stats)).not.toThrow();
    expect(stats.goals).toHaveLength(6);
    expect(stats.goals[0].name.length).toBeLessThanOrEqual(40);
    expect(snapshot.plan3Done).toEqual([]); // "<b>" isn't a safe id
    expect(stats.bills.unpaidPastDue).toHaveLength(5);
    expect(stats.bills.unpaidPastDue.every((n) => n.length <= 60)).toBe(true);
    expect(stats.spending.total).toBe(10_000_000);
    expect(stats.shopping.estOpen).toBe(0);
    expect(stats.nextWeek.washDays).toEqual([]);
  });

  it("parses jazz2-data.json leniently", () => {
    expect(parseJazzData(null)).toBeNull();
    expect(parseJazzData("nope")).toBeNull();
    expect(parseJazzData('{"data":[1]}')).toBeNull();
    expect(parseJazzData('{"updatedAt":1,"data":{"a":1}}')).toEqual({ a: 1 });
  });
});
