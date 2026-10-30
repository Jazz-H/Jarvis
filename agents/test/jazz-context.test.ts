import { describe, it, expect } from "vitest";
import { buildJazzContext, isWashDate, addDays } from "../lib/jazz-context.ts";

const TODAY = "2026-10-29";
const gist = (data: Record<string, unknown>) => JSON.stringify({ updatedAt: 1, data });

describe("jazz context", () => {
  it("is unavailable for missing or broken data", () => {
    expect(buildJazzContext(null, TODAY).available).toBe(false);
    expect(buildJazzContext("not json", TODAY).available).toBe(false);
    expect(buildJazzContext('{"data":null}', TODAY).available).toBe(false);
  });

  it("picks today's and overdue open to-dos, starred first", () => {
    const c = buildJazzContext(
      gist({
        "todo-content": [
          { text: "Plain", due: TODAY },
          { text: "Star", due: TODAY, starred: true },
          { text: "Done", due: TODAY, done: true },
          { text: "Late", due: "2026-10-20" },
          { text: "Later", due: "2026-11-02" },
          { text: "Anytime", due: null },
          { text: "x".repeat(500), due: TODAY },
        ],
      }),
      TODAY,
    );
    expect(c.todosToday.map((t) => t.text.slice(0, 5))).toEqual(["Star", "Plain", "xxxxx"]);
    expect(c.todosToday[2].text).toHaveLength(120);
    expect(c.overdue).toEqual([{ text: "Late", due: "2026-10-20" }]);
  });

  it("lists unpaid bills due within 3 days, with the joint share", () => {
    const c = buildJazzContext(
      gist({
        "bills-content": [
          { name: "Rent", amount: 1450, due: "2026-11-01", autopay: false },
          { name: "Power", amount: 200, due: "2026-10-30", group: "joint", share: 50, autopay: true },
          { name: "Gym", amount: 30, due: "2026-11-05" },
          { name: "Paid once", amount: 9, due: "2026-10-29", done: true },
        ],
      }),
      TODAY,
    );
    expect(c.billsDueSoon).toEqual([
      { name: "Power", amount: 100, due: "2026-10-30", autopay: true },
      { name: "Rent", amount: 1450, due: "2026-11-01", autopay: false },
    ]);
  });

  it("matches the app's wash-day rule", () => {
    const routine = { washPm: [{ id: "a" }], wash: { anchor: "2026-10-15", everyDays: 7 } };
    expect(isWashDate("2026-10-29", routine)).toBe(true);
    expect(isWashDate("2026-10-30", routine)).toBe(false);
    expect(isWashDate("2026-10-08", routine)).toBe(true); // before the anchor
    expect(isWashDate("2026-10-29", { washPm: [], wash: routine.wash })).toBe(false); // no wash steps
    // an invalid schedule falls back to the default (2026-07-16, every 14 days)
    expect(isWashDate("2026-07-30", { washPm: [{}], wash: { anchor: "bad", everyDays: 7 } })).toBe(true);
  });

  it("treats a missing routine as the app's built-in one", () => {
    const c = buildJazzContext(gist({}), "2026-07-30");
    expect(c.washDay).toBe(true);
    expect(c.washTomorrow).toBe(false);
  });

  it("lists open shopping needs, Jazz 3.0 goal progress and weight-goal progress", () => {
    const c = buildJazzContext(
      gist({
        "wants-content": [
          { id: "w1", name: "Desk lamp", kind: "want" },
          { id: "w2", name: "Rain jacket", kind: "need" },
          { id: "w3", name: "Blazer", wardrobeCat: "Tops" }, // wardrobe items default to needs
          { id: "w4", name: "Shampoo", kind: "need", priority: "high" },
          { id: "w5", name: "Bought one", kind: "need" },
          { id: "w6", name: "Later one", kind: "need", later: true },
        ],
        "wants-state": { w5: true },
        "plan3-content": [
          { cat: "Glow", item: "a", done: true },
          { cat: "Glow", item: "b" },
          { cat: "Leadership", item: "c" },
        ],
        "fitness-content": { start: 200, goal: 180, weights: [{ lbs: 200 }, { lbs: 190 }] },
      }),
      TODAY,
    );
    expect(c.shoppingNeeds).toEqual(["Shampoo", "Rain jacket", "Blazer"]);
    expect(c.goals).toEqual([
      { name: "Glow", done: 1, total: 2 },
      { name: "Leadership", done: 0, total: 1 },
    ]);
    expect(c.weightGoalPct).toBe(50);
    expect(buildJazzContext(gist({}), TODAY)).toMatchObject({ shoppingNeeds: [], goals: [], weightGoalPct: null });
  });

  it("adds days across months", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
});
