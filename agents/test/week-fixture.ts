// Shared Weekly Review test data: 2026-W44 (Mon Oct 26 to Sun Nov 1, 2026), a week that crosses
// the month end and ends on the Sunday daylight saving ends.
import type { DayDigest } from "../schemas/week.ts";

const ms = (iso: string) => Date.parse(iso);

export const FIXTURE: Record<string, unknown> = {
  "todo-content": [
    { text: "A", done: true, starred: true, due: "2026-10-30", completedAt: ms("2026-11-02T04:30:00Z") }, // Nov 1 11:30pm EST
    { text: "B", done: true, due: null, completedAt: ms("2026-10-26T03:59:00Z") }, // Oct 25 11:59pm EDT: before
    { text: "C", done: true, due: null, completedAt: ms("2026-10-26T04:00:00Z") }, // Oct 26 midnight EDT: in
    { text: "H", done: true, due: null, completedAt: ms("2026-11-02T05:00:00Z") }, // Nov 2 midnight EST: after
    { text: "D", due: "2026-10-28" }, // missed
    { text: "E", due: "2026-10-20" }, // carried
    { text: "F", due: "2026-11-03" }, // next week
    { text: "G", due: "2026-10-31", repeat: "weekly" }, // missed, and again Nov 7
    "junk",
    null,
    5,
  ],
  "todo-archive-content": [
    { text: "Old", completedAt: ms("2026-10-27T15:00:00Z"), due: "2026-10-27" },
    { text: "A", completedAt: ms("2026-11-02T04:30:00Z"), due: "2026-10-30" }, // same as active A
    { text: "Older", completedAt: ms("2026-10-10T15:00:00Z"), due: "2026-10-10" },
  ],
  "routine-checks": {
    "2026-10-25": { amDone: true, pmDone: true },
    "2026-10-26": { amDone: true, pmDone: true },
    "2026-10-27": { amDone: true, pmDone: true },
    "2026-10-28": { amDone: true, pmDone: true },
    "2026-10-29": { amDone: true, pmDone: false },
    "2026-10-30": { amDone: true, pmDone: true },
    "2026-10-31": { amDone: true, pmDone: true },
    "2026-11-01": { am: ["x"], pm: [] },
  },
  "fitness-content": {
    start: 200,
    goal: 180,
    weights: [
      { date: "2026-09-06", lbs: 200 },
      { date: "2026-10-04", lbs: 196 },
      { date: "2026-10-25", lbs: 194 },
      { date: "2026-10-27", lbs: 193.4 },
      { date: "2026-10-31", lbs: 192.5 },
      { date: "2026-11-05", lbs: 190 }, // after the week
      { date: "x", lbs: 5 },
      { date: "2026-10-28", lbs: "abc" },
    ],
    plan: [
      { id: "wo1", name: "Lift", days: [1, 3, 5], every: 1, anchor: "2026-10-01" },
      { id: "wo2", name: "Long run", days: [0], every: 2, anchor: "2026-10-18" },
      { id: "bad id!", name: "Ghost", days: [2], every: 1, anchor: "2026-10-01" },
    ],
    checks: { "2026-10-26|wo1": true, "2026-10-30|wo1": true, "2026-11-01|wo2": true },
  },
  "plan3-content": [
    { id: "p3-1", cat: "Glow", item: "Night serum", done: true },
    { id: "p3-2", cat: "Glow", item: "Floss" },
    { id: "p3-3", cat: "Leadership", item: "a speaking club", done: true },
    { id: "p3-4", cat: "Leadership", item: "   " },
  ],
  "bills-content": [
    { id: "rent", name: "Rent", amount: 1450, due: "2026-11-01", repeat: "monthly" },
    {
      id: "power",
      name: "Power",
      amount: 200,
      group: "joint",
      share: 50,
      autopay: true,
      due: "2026-10-28",
      repeat: "monthly",
      day: 28,
    },
    { id: "phone", name: "Phone", amount: 80, due: "2026-11-05", repeat: "monthly" },
    { id: "gym", name: "Gym", amount: 30, due: "2026-10-24", repeat: "weekly" },
  ],
  "bill-payments": [
    { id: "pay1", billId: "net", name: "Internet", amount: 60, due: "2026-10-25", date: "2026-10-27" },
    { id: "pay0", billId: "net", name: "Internet", amount: 60, due: "2026-09-25", date: "2026-10-25" },
    // the app already logged Power's autopay: it must not be counted twice
    {
      id: "pay-auto-power-2026-10-28",
      billId: "power",
      name: "Power",
      amount: 100,
      due: "2026-10-28",
      date: "2026-10-28",
      auto: true,
    },
  ],
  "budget-content": {
    categories: [
      { id: "cat-g", name: "Groceries", limit: 310 },
      { id: "cat-f", name: "Fun", limit: 0 },
      { id: "cat-z", name: "Unused", limit: 50 },
    ],
    expenses: [
      { amount: 50, cat: "cat-g", date: "2026-10-25" },
      { amount: 40, cat: "cat-g", date: "2026-10-26" },
      { amount: 30.5, cat: "cat-g", date: "2026-10-31" },
      { amount: 20, cat: "cat-g", date: "2026-11-01" },
      { amount: 15, cat: "cat-f", date: "2026-11-01" },
      { amount: 12.25, cat: "cat-gone", date: "2026-10-29" },
      { amount: 99, cat: "cat-g", date: "2026-11-02" },
    ],
  },
  "wants-content": [
    { id: "w1", name: "Rain jacket", kind: "need", price: 120 },
    { id: "w2", name: "Belt", wardrobeCat: "Accessories", price: 40 },
    { id: "w3", name: "Headphones", kind: "want", price: "abc" },
    { id: "w4", name: "Boots", kind: "need", price: 150, later: true },
    { id: "w5", name: "Socks", price: 12 },
  ],
  "wants-state": { w5: true, ghost: true },
  "skin-routine-content": { washPm: [{}], wash: { anchor: "2026-11-04", everyDays: 14 } },
};

export const DIGESTS: DayDigest[] = [
  {
    date: "2026-10-20", // before the week
    inbox: { unread: 1, urgent: 0, needsReply: [{ from: "Zed", summary: "z" }], bills: [] },
  },
  {
    date: "2026-10-27",
    inbox: {
      unread: 3,
      urgent: 0,
      needsReply: [{ from: "Ann", summary: "Lunch?" }],
      bills: [{ payee: "City Power", amount: 120, status: "differs" }],
    },
  },
  {
    date: "2026-10-31",
    inbox: {
      unread: 2,
      urgent: 0,
      needsReply: [
        { from: "Bob", summary: "Contract" },
        { from: "bob ", summary: "Again" },
      ],
      bills: [
        { payee: "city power", amount: null, status: "not-in-budget" },
        { payee: "Netflix", amount: 15, status: "matches" },
      ],
    },
  },
];
