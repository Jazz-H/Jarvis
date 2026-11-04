import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildMoneyCard, payPeriod, addMonthsIso, nextBillIso } from "../lib/money.ts";
import { runBriefing, pushMessages, cleanSuggestions, type Subagents } from "../jarvis.ts";
import { Briefing } from "../schemas/briefing.ts";
import { MoneyCard } from "../schemas/money.ts";
import { Trace } from "../lib/trace.ts";
import { buildJazzContext, emptyContext } from "../lib/jazz-context.ts";
import type { GistClient } from "../tools/gist.ts";
import type { InboxCard } from "../schemas/inbox.ts";
import { FACTS, CANDIDATE } from "./fixtures.ts";
import { fakeQuery } from "./helpers.ts";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const TODAY = "2026-10-29";
// Paid on the 15th and the last-ish day (two semi-monthly sources), rent and a card due before payday
const DATA = {
  "budget-content": {
    categories: [
      { id: "cat-g", name: "Groceries", limit: 400 },
      { id: "cat-d", name: "Dining out", limit: 100 },
    ],
    expenses: [
      { amount: 120, cat: "cat-d", date: "2026-10-03" },
      { amount: 30.5, cat: "cat-d", date: "2026-10-20" },
      { amount: 90, cat: "cat-g", date: "2026-10-21" },
      { amount: 500, cat: "cat-d", date: "2026-09-30" }, // last month: not counted
    ],
    income: [{ id: "inc1", name: "Pay", amount: 2000, start: "2026-01-15", repeat: "monthly" }],
    plans: { "inc1|2026-10-15": { amount: 2100, received: true, lines: [] } },
  },
  "bills-content": [
    { id: "b1", name: "Rent", amount: 1450, due: "2026-11-01", repeat: "monthly", autopay: false },
    { id: "b2", name: "Phone", amount: 80, due: "2026-11-10", repeat: "monthly", autopay: true },
    { id: "b3", name: "Gym", amount: 40, due: "2026-10-27", repeat: "monthly", autopay: false }, // overdue
    {
      id: "b4",
      name: "Internet",
      amount: 120,
      due: "2026-11-05",
      repeat: "monthly",
      autopay: true,
      group: "joint",
      share: 50,
    },
    { id: "b5", name: "Old", amount: 999, due: "2026-10-30", done: true },
  ],
  "bill-payments": [{ id: "p1", billId: "b6", name: "Card", amount: 300, due: "2026-10-20", date: "2026-10-20" }],
};
const raw = (d: unknown = DATA) => JSON.stringify({ updatedAt: 1, data: d });

describe("money math (same rules as the app)", () => {
  it("adds months like the app, clamping to the month's length", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-02-28", 1, 31)).toBe("2026-03-31");
    expect(addMonthsIso("2026-11-15", 3)).toBe("2027-02-15");
    expect(nextBillIso("2026-10-29", "biweekly")).toBe("2026-11-12");
    expect(nextBillIso("2026-10-29", "once")).toBeNull();
  });

  it("finds the pay period around today and what's safe to spend", () => {
    // last paycheck Oct 15 ($2100 from its plan), next Nov 15; bills due Oct 15–Nov 14:
    // card paid $300; Rent 1450 + Phone 80 + Internet 60 (half) + Gym next on Nov 27? no: Gym's
    // unpaid due is Oct 27 (in the period) = 40
    const p = payPeriod(DATA, TODAY)!;
    expect(p).toEqual({ start: "2026-10-15", end: "2026-11-15", pay: 2100, paid: 300, due: 1630, left: 170 });
  });

  it("returns no period without income", () => {
    expect(payPeriod({ "budget-content": { income: [] } }, TODAY)).toBeNull();
  });
});

describe("Bill Guard", () => {
  it("flags overdue and manual bills 3 days ahead, never autopay or paid ones", () => {
    const m = buildMoneyCard(raw(), TODAY, null)!;
    expect(m.guard.map((g) => [g.reason, g.name])).toEqual([
      ["overdue", "Gym"],
      ["manual", "Rent"],
    ]);
    expect(m.overspent).toEqual([{ name: "Dining out", spent: 150.5, limit: 100 }]);
  });

  it("flags bills before payday that come to more than the paycheck", () => {
    const d = structuredClone(DATA);
    d["budget-content"].plans["inc1|2026-10-15"].amount = 1500;
    const m = buildMoneyCard(raw(d), TODAY, null)!;
    expect(m.guard.find((g) => g.reason === "short")).toEqual({
      reason: "short",
      name: "Bills before payday",
      amount: 430,
      due: "2026-11-15",
      budgetAmount: null,
    });
  });

  it("adds bill emails that differ from Budget or aren't in it", () => {
    const inbox: InboxCard = {
      unread: 1,
      urgent: [],
      needsReply: [],
      bills: [
        {
          payee: "City Power",
          amount: 142,
          due: "2026-11-04",
          budgetName: "Electric",
          budgetAmount: 110,
          status: "differs",
        },
        { payee: "Spotify", amount: 12, due: null, budgetName: null, budgetAmount: null, status: "not-in-budget" },
        { payee: "Rent Co", amount: 1450, due: null, budgetName: "Rent", budgetAmount: 1450, status: "matches" },
      ],
    };
    const g = buildMoneyCard(raw(), TODAY, inbox)!.guard;
    expect(g.slice(2)).toEqual([
      { reason: "differs", name: "Electric", amount: 142, due: "2026-11-04", budgetAmount: 110 },
      { reason: "not-in-budget", name: "Spotify", amount: 12, due: null, budgetAmount: null },
    ]);
  });

  it("treats junk data as untrusted: no data, no card; bad rows skipped", () => {
    expect(buildMoneyCard(null, TODAY, null)).toBeNull();
    expect(buildMoneyCard("not json", TODAY, null)).toBeNull();
    const m = buildMoneyCard(
      raw({
        "bills-content": [
          5,
          { name: "x".repeat(200), amount: "12", due: "2026-10-30" },
          { name: "", due: "2026-10-30" },
        ],
      }),
      TODAY,
      null,
    )!;
    expect(m.period).toBeNull();
    expect(m.guard).toHaveLength(1);
    expect(m.guard[0].name).toHaveLength(60);
    expect(m.guard[0].amount).toBe(12);
  });
});

describe("Bill Guard in the briefing", () => {
  const NOW = new Date("2026-10-29T10:50:00Z");
  const ok: Subagents = {
    weather: async () => ({ ...FACTS, summary: "Dry.", wear: "Jacket.", washDayNote: null }),
    news: async () => ({ stories: [{ ...CANDIDATE, summary: "s" }] }),
  };
  function gistWith(files: Record<string, string>) {
    const gist: GistClient = {
      readFile: async (n) => files[n] ?? null,
      writeFile: async (n, c) => void (files[n] = c),
    };
    return gist;
  }

  it("adds the money card and cleaned suggestions; Jarvis sees Bill Guard", async () => {
    const q = fakeQuery([
      {
        structured_output: {
          headline: "Pay rent by Sunday",
          summary: [{ text: "Rent is due Nov 1 and isn't on autopay.", source: "money" }],
          suggestions: [
            { text: "Pay Rent", due: "2026-11-01" },
            { text: "pay rent", due: null }, // duplicate
            { text: "Call the bank", due: null }, // already a to-do
            { text: "Cancel gym", due: "2026-02-30" }, // not a real date
          ],
        },
      },
    ]);
    const files: Record<string, string> = {
      "jazz2-data.json": raw({ ...DATA, "todo-content": [{ text: "Call the bank", due: TODAY }] }),
    };
    const r = await runBriefing({
      now: NOW,
      trigger: "manual",
      gist: gistWith(files),
      fetchImpl: fetch,
      maxRunCostUsd: 1,
      trace: new Trace([]),
      queryFn: q.fn,
      subagents: ok,
    });
    if (r.status !== "delivered") throw new Error("not delivered");
    const b = Briefing.parse(JSON.parse(files["jazz2-briefing.json"]));
    expect([b.summaryBy, b.notes]).toEqual(["jarvis", []]);
    expect(b.cards.money).toMatchObject({ status: "ok", agent: "Bill Guard", model: "code" });
    expect(b.suggestions).toEqual([
      { text: "Pay Rent", due: "2026-11-01" },
      { text: "Cancel gym", due: null },
    ]);
    const prompt = String(q.seen[0].prompt);
    expect(prompt).toContain('"money"');
    expect(prompt).toContain('"reason": "manual"');
  });

  it("phone alerts: bills not on autopay 3 days ahead, and a short pay period", () => {
    const c = buildJazzContext(raw(), TODAY);
    const d = structuredClone(DATA);
    d["budget-content"].plans["inc1|2026-10-15"].amount = 1500;
    const money = buildMoneyCard(raw(d), TODAY, null);
    const b = { headline: "Rain by noon" } as any;
    const msgs = pushMessages(b, c, null, money);
    expect(msgs.map((m) => m.tag)).toEqual(["briefing", "bill", "bill-short"]);
    expect(msgs[1].body).toBe("Gym $40.00, overdue\nRent $1450.00, due Sunday");
    expect(msgs[2].body).toBe("Bills due before payday are $430.00 more than your paycheck.");
    // without Bill Guard, only bills through tomorrow
    expect(pushMessages(b, c, null).map((m) => m.tag)).toEqual(["briefing", "bill"]);
  });

  it("cleanSuggestions keeps dates from today to 60 days out", () => {
    const c = emptyContext(TODAY);
    expect(
      cleanSuggestions(
        [
          { text: "  Renew   passport ", due: "2026-12-28" },
          { text: "Too far", due: "2027-01-15" },
          { text: "Past", due: "2026-10-01" },
          { text: "Fourth", due: null },
        ],
        c,
      ),
    ).toEqual([
      { text: "Renew passport", due: "2026-12-28" },
      { text: "Too far", due: null },
      { text: "Past", due: null },
    ]);
    expect(cleanSuggestions(undefined, c)).toEqual([]);
  });
});

describe("debts and credit cards (js/budget-debts.js rules)", () => {
  const withDebts = (budget: object) => ({ ...DATA, "budget-content": { ...DATA["budget-content"], ...budget } });

  it("works out payoff months in the owner's order and marks the first open one next", () => {
    const d = withDebts({
      debts: [
        { name: "Done one", balance: 0, apr: 5, payment: 100 },
        { name: "Loan A", balance: 1200, apr: 0, payment: 100 }, // 12 months
        { name: "Loan B", balance: 10000, apr: 6, payment: 193.33 }, // 60 months
        { name: "Too small", balance: 5000, apr: 24, payment: 50 }, // $100 interest a month
        { name: "No payment", balance: 300, apr: 0, payment: 0 },
      ],
    });
    const m = buildMoneyCard(raw(d), TODAY, null)!;
    expect(m.debts.map((x) => [x.name, x.paidOff, x.next, x.coversInterest])).toEqual([
      ["Done one", null, false, true],
      ["Loan A", "2027-10", true, true],
      ["Loan B", "2031-10", false, true],
      ["Too small", null, false, false],
      ["No payment", null, false, true],
    ]);
  });

  it("finds each card's next due date and statement, and guards one due soon that isn't planned", () => {
    const d = withDebts({
      accounts: ["Ally", "Visa", "Store"],
      cardInfo: {
        Visa: { due: 31, st: { "2026-10": 412.5 } }, // Oct 31: within 3 days, not in a plan
        Store: { due: 5, st: { "2026-11": 60 } }, // Oct 5 passed, so Nov 5
        Gone: { due: 1, st: {} }, // not an account: ignored
      },
      plans: {
        "inc1|2026-10-15": { amount: 2100, received: true, lines: [] },
        "inc1|2026-11-15": { lines: [{ name: "Store payment", amount: 60 }] },
      },
    });
    const m = buildMoneyCard(raw(d), TODAY, null)!;
    expect(m.cards).toEqual([
      { name: "Visa", due: "2026-10-31", statement: 412.5, planned: false },
      { name: "Store", due: "2026-11-05", statement: 60, planned: true },
    ]);
    expect(m.guard.filter((g) => g.reason === "card")).toEqual([
      { reason: "card", name: "Visa", amount: 412.5, due: "2026-10-31", budgetAmount: null },
    ]);
  });

  it("counts a card as planned in last month's check after its previous due date, not before it", () => {
    const d = withDebts({
      accounts: ["Visa", "Amex"],
      cardInfo: {
        Visa: { due: 4, st: { "2026-11": 200 } }, // Nov 4, planned in the Oct 15 check (after Oct 4)
        Amex: { due: 1, st: { "2026-11": 90 } }, // Nov 1; the Oct 1 check is on last due date: October's payment
      },
      plans: {
        "inc1|2026-10-15": { lines: [{ name: "Visa payment", amount: 200 }] },
        "inc1|2026-10-01": { lines: [{ name: "Amex payment", amount: 80 }] },
      },
    });
    const m = buildMoneyCard(raw(d), TODAY, null)!;
    expect(m.cards.map((c) => [c.name, c.due, c.planned])).toEqual([
      ["Visa", "2026-11-04", true],
      ["Amex", "2026-11-01", false],
    ]);
    expect(m.guard.filter((g) => g.reason === "card").map((g) => g.name)).toEqual(["Amex"]);
  });

  it("parses an older briefing without debts or cards", () => {
    expect(MoneyCard.parse({ period: null, guard: [], overspent: [] })).toMatchObject({
      debts: [],
      cards: [],
    });
  });
});
