import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { localTime, shouldDeliver, toMinutes, utcCronLines } from "../lib/schedule.ts";
import { CONFIG } from "../config.ts";

const TZ = "America/New_York";
const gate = (iso: string, last: string | null = null) =>
  shouldDeliver({ now: new Date(iso), timeZone: TZ, briefingTime: "07:00", lastBriefingDate: last });

describe("schedule", () => {
  it("reads local date and time across daylight saving", () => {
    expect(localTime(new Date("2026-07-01T10:45:00Z"), TZ)).toEqual({ date: "2026-07-01", minutes: 6 * 60 + 45 });
    expect(localTime(new Date("2026-12-01T11:45:00Z"), TZ)).toEqual({ date: "2026-12-01", minutes: 6 * 60 + 45 });
    expect(localTime(new Date("2026-12-01T03:00:00Z"), TZ).date).toBe("2026-11-30");
  });

  it("delivers from the EDT line in summer and the EST line in winter", () => {
    expect(gate("2026-07-01T10:45:00Z").deliver).toBe(true); // 6:45 EDT
    expect(gate("2026-12-01T10:45:00Z").deliver).toBe(false); // 5:45 EST: too early
    expect(gate("2026-12-01T11:45:00Z").deliver).toBe(true); // 6:45 EST
  });

  it("tolerates GitHub starting late, but not hours late", () => {
    expect(gate("2026-07-01T11:30:00Z").deliver).toBe(true); // 7:30 EDT
    expect(gate("2026-07-01T13:30:00Z").deliver).toBe(false); // 9:30 EDT
  });

  it("skips when today's briefing already exists (the second cron line in summer)", () => {
    const r = gate("2026-07-01T11:45:00Z", "2026-07-01");
    expect(r).toMatchObject({ deliver: false, reason: "today's briefing already exists" });
    expect(gate("2026-07-01T11:45:00Z", "2026-06-30").deliver).toBe(true);
  });

  it("parses HH:MM and rejects junk", () => {
    expect(toMinutes("07:00")).toBe(420);
    expect(() => toMinutes("7am")).toThrow();
  });

  it("jarvis.yml's cron lines match config.ts (EDT and EST)", () => {
    const yml = readFileSync(new URL("../../.github/workflows/jarvis.yml", import.meta.url), "utf8");
    const lines = [...yml.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]);
    const expected = utcCronLines(CONFIG.briefingTime, CONFIG.briefingLeadMinutes, [-4, -5]);
    expect(lines).toEqual(expected);
    expect(utcCronLines("07:00", 15, [-4, -5])).toEqual(["45 10 * * *", "45 11 * * *"]);
  });
});
