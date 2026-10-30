import { describe, it, expect } from "vitest";
import { buildAskContext, jazzPart, payPeriod, threadTurns } from "../lib/ask-context.ts";
import type { Answer, AskItem } from "../schemas/ask.ts";
import { ASK_DATA, BRIEFING_FILE, TODAY } from "./ask-fixture.ts";

describe("Ask context (figures worked out in code)", () => {
  const j = jazzPart(ASK_DATA, TODAY);

  it("pay period: latest payday to the next, with safe to spend and days to payday", () => {
    // Oct 30 payday: Rent $1450 (Nov 1), Phone $80 (Nov 5), Gym $30 x2 (Oct 31, Nov 7) still due;
    // Power's autopay moved it past the period; nothing in the period is paid yet
    expect(j.payPeriod).toEqual({
      start: "2026-10-30",
      nextPayday: "2026-11-13",
      lastDay: "2026-11-12",
      day: 1,
      days: 14,
      daysToPayday: 14,
      paycheck: 2000,
      paycheckEstimated: false,
      billsPaid: 0,
      billsDue: 1590,
      safeToSpend: 410,
    });
    // the day before: the Oct 16 check, 1 day to payday; Internet (due Oct 25, $60) and Power's
    // autopay (due Oct 28, your $100 share) are paid in it, and Gym (Oct 24) is still due
    expect(payPeriod(ASK_DATA, "2026-10-29")).toMatchObject({
      start: "2026-10-16",
      nextPayday: "2026-10-30",
      daysToPayday: 1,
      day: 14,
      billsPaid: 160,
      billsDue: 30,
      safeToSpend: 1810,
    });
    expect(payPeriod({}, TODAY)).toBeNull(); // no income set up
  });

  it("pay that varies uses the average of the last 3 received checks", () => {
    const data = {
      "budget-content": {
        income: [{ id: "inc1", amount: 1000, start: "2026-09-04", repeat: "biweekly", varies: true }],
        plans: {
          "inc1|2026-09-18": { amount: 900, received: true },
          "inc1|2026-10-02": { amount: 1100, received: true },
          "inc1|2026-10-16": { amount: 1300, received: true },
          "inc1|2026-09-04": { amount: 100, received: true }, // older than the last 3
        },
      },
    };
    expect(payPeriod(data, TODAY)).toMatchObject({ start: "2026-10-30", paycheck: 1100, paycheckEstimated: true });
  });

  it("to-dos: overdue, and the next 14 days with repeats projected", () => {
    expect(j.todos.overdue).toEqual([
      { text: "E", due: "2026-10-20", starred: false },
      { text: "D", due: "2026-10-28", starred: false },
    ]);
    expect(j.todos.next14Days.map((t) => `${t.text} ${t.due}`)).toEqual(["G 2026-10-31", "F 2026-11-03", "G 2026-11-07"]);
  });

  it("bills: overdue and the next 30 days, your share, after autopay", () => {
    expect(j.bills.overdue).toEqual([{ name: "Gym", amount: 30, due: "2026-10-24", autopay: false }]);
    expect(j.bills.next30Days.map((b) => `${b.name} ${b.due} ${b.amount}`)).toEqual([
      "Gym 2026-10-31 30",
      "Rent 2026-11-01 1450",
      "Phone 2026-11-05 80",
      "Gym 2026-11-07 30",
      "Gym 2026-11-14 30",
      "Gym 2026-11-21 30",
      "Power 2026-11-28 100", // the joint bill at your 50% share
      "Gym 2026-11-28 30",
    ]);
    expect(j.bills.next30DaysTotal).toBe(1780);
  });

  it("spending this month against limits, routine, workouts, weight, goals and Shopping", () => {
    expect(j.spendingThisMonth).toEqual({
      month: "2026-10",
      total: 102.25,
      byCat: [
        { name: "Groceries", spent: 90, limit: 310, left: 220 },
        { name: "Unused", spent: 0, limit: 50, left: 50 },
        { name: "Uncategorized", spent: 12.25, limit: null, left: null },
      ],
      overLimit: [],
    });
    expect(j.routine).toEqual({ streak: 1, amDoneToday: true, pmDoneToday: true, washToday: false, washTomorrow: false });
    expect(j.workouts).toEqual({
      thisWeek: { start: "2026-10-25", doneBeforeToday: 1, plannedBeforeToday: 2, missedDays: ["2026-10-28"], plannedRestOfWeek: 0 },
      today: [{ name: "Lift", done: true }],
      next: { date: "2026-11-01", workouts: ["Long run"] },
    });
    expect(j.weight).toEqual({
      current: 193.4,
      start: 200,
      goal: 180,
      toGo: 13.4,
      pct: 33,
      ratePerWeek: -0.9,
      eta: "2027-02-12",
      reached: false,
      lastWeighIn: "2026-10-27",
    });
    expect(j.goals).toEqual([
      { section: "Glow", done: 1, total: 2, open: ["Floss"] },
      { section: "Leadership", done: 1, total: 1, open: [] },
    ]);
    expect(j.shopping).toEqual({
      openCount: 3,
      needsOpen: 2,
      estOpen: 160,
      items: [
        { name: "Rain jacket", price: 120, need: true, high: false },
        { name: "Belt", price: 40, need: true, high: false },
        { name: "Headphones", price: null, need: false, high: false },
      ],
    });
  });

  it("adds this morning's validated briefing cards and lists only sources it has", () => {
    const c = buildAskContext({ data: ASK_DATA, today: TODAY, briefingRaw: BRIEFING_FILE, reviewsRaw: null });
    expect(c.sources).toEqual(["jazz", "inbox", "weather", "news"]); // calendar card failed; no review
    expect(c.briefing).toMatchObject({ date: TODAY, calendar: null, deliveries: null, weather: { highF: 69 } });
    expect(c.notes).toContain("There's no Weekly Review from the last two weeks.");
    // a stale or junk briefing is left out
    const old = buildAskContext({ data: null, today: "2026-11-05", briefingRaw: BRIEFING_FILE, reviewsRaw: "nope" });
    expect(old.briefing).toBeNull();
    expect(old.sources).toEqual([]);
    expect(old.jazz).toBeNull();
    expect(buildAskContext({ data: null, today: TODAY, briefingRaw: "{", reviewsRaw: null }).briefing).toBeNull();
  });
});

describe("thread turns", () => {
  const item = (id: string, at: string, thread?: string, text = `q ${id}`): AskItem => ({ id, kind: "ask", text, at, ...(thread ? { thread } : {}) });
  const ans = (id: string, askedAt: string, text = `a ${id}`): Answer => ({
    id,
    askedAt,
    answeredAt: askedAt,
    status: "ok",
    text,
    bullets: ["b"],
    sources: [],
    chips: [],
    by: "jarvis",
  });

  it("gives the earlier turns of the same thread, oldest first, at most 6", () => {
    const at = (m: number) => `2026-10-30T13:${String(m).padStart(2, "0")}:00.000Z`;
    const items = [item("root0001", at(0))];
    const answers = new Map([["root0001", ans("root0001", at(0))]]);
    for (let i = 1; i <= 7; i++) {
      items.push(item(`follow0${i}`, at(i), "root0001"));
      answers.set(`follow0${i}`, ans(`follow0${i}`, at(i)));
    }
    items.push(item("other001", at(20), "otherrr1"), item("current1", at(30), "root0001"));
    const turns = threadTurns(items.at(-1)!, items, answers, 6);
    expect(turns.map((t) => t.question)).toEqual(["q follow02", "q follow03", "q follow04", "q follow05", "q follow06", "q follow07"]);
    expect(turns[0].answer).toBe("a follow02\n- b");
    expect(threadTurns(item("solo0001", at(40)), items, answers, 6)).toEqual([]);
  });

  it("finds the first answer by its id once the app has pruned its question", () => {
    const a = ans("root0001", "2026-10-30T12:00:00.000Z");
    const cur = item("current1", "2026-10-30T13:00:00.000Z", "root0001");
    expect(threadTurns(cur, [cur], new Map([["root0001", a]]), 6)).toEqual([
      { askedAt: a.askedAt, question: null, answer: "a root0001\n- b" },
    ]);
  });
});
