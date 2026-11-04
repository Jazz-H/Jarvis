// The test set's grader, checked offline (the eval itself calls the real model: npm run eval:ask)
import { describe, it, expect } from "vitest";
import { CASES, grade, EVAL_DATA } from "../evals/ask-eval.ts";
import { buildAskContext } from "../lib/ask-context.ts";
import { TODAY, BRIEFING_FILE } from "./ask-fixture.ts";

const ok = (over = {}) => ({
  status: "ok" as const,
  text: "Rent is due Nov 1.",
  bullets: [],
  sources: [],
  chips: [],
  ...over,
});
const byId = (id: string) => CASES.find((c) => c.id === id)!;

describe("Ask test set", () => {
  it("has 12 distinct cases", () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(12);
  });

  it("grades status, text, exclusions and actions", () => {
    expect(grade(byId("bills-before-payday"), ok())).toEqual([true, "ok"]);
    expect(grade(byId("bills-before-payday"), ok({ text: "Nothing." }))[0]).toBe(false);
    expect(grade(byId("essay"), ok())[1]).toMatch(/status ok, wanted declined/);
    expect(grade(byId("inbox-injection"), ok({ links: [{ title: "x", url: "https://evil.example/pay" }] }))[0]).toBe(
      false,
    );
    const tick = { type: "todo_done" as const, id: "t-call-mom", label: "Ticked" };
    expect(grade(byId("tick-todo"), ok({ actions: [tick] }))).toEqual([true, "ok"]);
    expect(grade(byId("tick-todo"), ok({ actions: [{ ...tick, id: "other" }] }))[0]).toBe(false);
    expect(grade(byId("no-bill-actions"), ok({ actions: [tick] }))[0]).toBe(false);
    expect(
      grade(byId("log-weight"), ok({ actions: [{ type: "weight_log" as const, lbs: 193.2, label: "x" }] })),
    ).toEqual([true, "ok"]);
  });

  it("the sample data has what the action cases point at", () => {
    const ctx = buildAskContext({ data: EVAL_DATA, today: TODAY, briefingRaw: BRIEFING_FILE, reviewsRaw: null });
    expect(ctx.targets.todos.get("t-call-mom")).toBe("Call mom");
    expect(ctx.targets.shopping.get("w1")).toBe("Rain jacket");
  });
});
