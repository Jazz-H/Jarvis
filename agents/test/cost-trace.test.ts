import { describe, it, expect, vi } from "vitest";
import { CostLedger } from "../lib/cost.ts";
import { Trace, redact } from "../lib/trace.ts";

const entry = (agent: string, costUsd: number) => ({
  agent,
  model: "m",
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 5,
  cacheWriteTokens: 0,
  costUsd,
});

describe("cost ledger", () => {
  it("rejects a non-positive cap", () => {
    expect(() => new CostLedger(0)).toThrow();
    expect(() => new CostLedger(NaN)).toThrow();
  });

  it("reserves estimates until the cap is reached", () => {
    const l = new CostLedger(0.2);
    expect(l.reserve("jarvis", 0.12)).toBe(true);
    expect(l.reserve("weather", 0.01)).toBe(true);
    expect(l.reserve("news", 0.1)).toBe(false); // 0.23 > 0.20
    expect(l.reservedUsd).toBeCloseTo(0.13);
  });

  it("gives each agent the cap minus spend and the others' reservations", () => {
    const l = new CostLedger(0.5);
    l.reserve("jarvis", 0.1);
    l.reserve("news", 0.05);
    l.record(entry("weather", 0.02));
    expect(l.budgetFor("news")).toBeCloseTo(0.38);
    l.release("jarvis");
    expect(l.budgetFor("news")).toBeCloseTo(0.48);
  });

  it("sums tokens and cost per agent", () => {
    const l = new CostLedger(1);
    l.record(entry("news", 0.01));
    l.record(entry("news", 0.02));
    expect(l.summary()).toEqual({ maxUsd: 1, spentUsd: 0.03, byAgent: { news: { tokens: 230, costUsd: 0.03 } } });
  });
});

describe("trace", () => {
  it("scrubs known secrets and credential-shaped strings", () => {
    const s = redact("key sk-ant-abc123 token ghp_" + "a".repeat(30) + " Bearer xyz.1 and mysecretvalue", [
      "mysecretvalue",
    ]);
    expect(s).toBe("key [redacted] token [redacted] [redacted] and [redacted]");
  });

  it("redacts and truncates detail strings and public errors", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const t = new Trace(["tok-1234567890"]);
    t.log("news", "failed", { error: "bad tok-1234567890 " + "x".repeat(400), n: 3 });
    expect(t.events[0].detail!.error).toMatch(/^bad \[redacted\] x+$/);
    expect(String(t.events[0].detail!.error).length).toBe(300);
    expect(t.events[0].detail!.n).toBe(3);
    expect(t.publicError(new Error("GitHub said tok-1234567890"))).toBe("GitHub said [redacted]");
  });
});
