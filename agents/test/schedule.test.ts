import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  dueRefresh,
  localTime,
  shouldDeliver,
  shouldDeliverReview,
  startedByHand,
  toMinutes,
  utcCronLines,
  weekday,
} from "../lib/schedule.ts";
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

  it("tolerates GitHub starting hours late, but not past 7pm", () => {
    expect(gate("2026-07-01T11:30:00Z").deliver).toBe(true); // 7:30 EDT
    expect(gate("2026-11-01T16:55:00Z").deliver).toBe(true); // 11:55 EST (a real late run)
    expect(gate("2026-11-03T18:04:00Z").deliver).toBe(true); // 1:04 EST (a real late run that was skipped)
    expect(gate("2026-07-01T23:30:00Z").deliver).toBe(false); // 7:30pm EDT
  });

  it("gates alarm clock starts like scheduled runs; Run workflow and --now deliver right away", () => {
    const dispatch = { GITHUB_EVENT_NAME: "workflow_dispatch" };
    expect(startedByHand([], dispatch)).toBe(true);
    expect(startedByHand([], { ...dispatch, JARVIS_GATED: "false" })).toBe(true);
    expect(startedByHand([], { ...dispatch, JARVIS_GATED: "true" })).toBe(false);
    expect(startedByHand([], { GITHUB_EVENT_NAME: "schedule" })).toBe(false);
    expect(startedByHand(["--now"], {})).toBe(true);
  });

  it("the alarm clock's times and modes match config.ts and jarvis.yml", () => {
    const gs = readFileSync(new URL("../../docs/jarvis/alarm-clock.gs", import.meta.url), "utf8");
    const yml = readFileSync(new URL("../../.github/workflows/jarvis.yml", import.meta.url), "utf8");
    const hhmm = (t: string, lead: number) => {
      const m = toMinutes(t) - lead;
      return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    };
    expect(gs).toContain(`const BRIEFING = "${hhmm(CONFIG.briefingTime, CONFIG.briefingLeadMinutes)}"`);
    expect(gs).toContain(`const REVIEW = "${hhmm(CONFIG.reviewTime, CONFIG.reviewLeadMinutes)}"`);
    expect(gs).toContain(`const TZ = "${CONFIG.timezone}"`);
    const windows = CONFIG.refresh.times.map((t) => `["${t}", "${hhmm(t, -CONFIG.refresh.windowMinutes)}"]`);
    expect(gs).toContain(`const REFRESHES = [${windows.join(", ")}]`);
    expect(CONFIG.reviewDay).toBe(0); // the script checks for Sunday
    for (const mode of ["alarm", "alarm-review"]) {
      expect(gs).toContain(`mode: "${mode}"`);
      expect(yml).toMatch(new RegExp(`options:[\\s\\S]*- ${mode}\\r?\\n`));
    }
    expect(
      yml.match(/JARVIS_GATED: \$\{\{ inputs\.mode == 'alarm' \|\| inputs\.mode == 'alarm-review' \}\}/g),
    ).toHaveLength(2);
    // the check-in poke passes jarvis-ask.yml's id check
    expect("alarm-checkins").toMatch(/^[a-z0-9-]{8,40}$/);
    expect(gs).not.toMatch(/github_pat_|ghp_/);
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

  it("jarvis.yml's cron lines match config.ts (briefing and review, EDT and EST)", () => {
    const yml = readFileSync(new URL("../../.github/workflows/jarvis.yml", import.meta.url), "utf8");
    const lines = [...yml.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]);
    const briefing = utcCronLines(CONFIG.briefingTime, CONFIG.briefingLeadMinutes, [-4, -5]);
    const review = utcCronLines(CONFIG.reviewTime, CONFIG.reviewLeadMinutes, [-4, -5], CONFIG.reviewDay);
    // plus one backup briefing line (GitHub skips scheduled runs), still gated by shouldDeliver
    // and one for the 5pm card refresh, in its window in both EDT and EST
    expect(lines).toEqual([...briefing, "5,20,35,50 11-17 * * *", "15 21,22 * * *", ...review]);
    expect(utcCronLines("07:00", 15, [-4, -5])).toEqual(["45 10 * * *", "45 11 * * *"]);
    expect(review).toEqual(["45 21 * * 0", "45 22 * * 0"]);
    // the review lines are routed to the review job and kept away from the briefing job
    const job = (name: string) => yml.slice(yml.indexOf(`\n  ${name}:`)).split("\n    runs-on:")[0];
    for (const line of review) {
      expect(job("review")).toContain(`github.event.schedule == '${line}'`);
      expect(job("brief")).toContain(`github.event.schedule != '${line}'`);
    }
    expect(yml).toMatch(/options:\s*\n\s*- briefing\s*\n\s*- review/);
  });

  it("shifts the cron day when UTC crosses midnight", () => {
    expect(utcCronLines("21:00", 0, [-4], 0)).toEqual(["0 1 * * 1"]); // Sun 9pm EDT = Mon 01:00 UTC
    expect(utcCronLines("01:00", 0, [2], 0)).toEqual(["0 23 * * 6"]); // Sun 1am UTC+2 = Sat 23:00 UTC
  });

  it("weekday() reads dates without a time zone", () => {
    expect(weekday("2026-11-01")).toBe(0);
    expect(weekday("2026-10-26")).toBe(1);
  });
});

describe("card refresh schedule", () => {
  const due = (iso: string, lastUpdate: string) =>
    dueRefresh({ now: new Date(iso), timeZone: TZ, times: ["12:30", "17:00"], windowMinutes: 240, lastUpdate }).refresh;
  const MORNING = "2026-07-01T11:00:00Z"; // 7:00 EDT

  it("runs from each time through its window, in EDT and EST", () => {
    expect(due("2026-07-01T16:20:00Z", MORNING)).toBe(false); // 12:20 EDT
    expect(due("2026-07-01T16:35:00Z", MORNING)).toBe(true); // 12:35 EDT
    expect(due("2026-12-01T17:35:00Z", "2026-12-01T12:00:00Z")).toBe(true); // 12:35 EST
    expect(due("2026-07-01T20:40:00Z", MORNING)).toBe(false); // 4:40 EDT: between the two
    expect(due("2026-07-01T21:15:00Z", MORNING)).toBe(true); // 5:15 EDT
    expect(due("2026-07-02T01:05:00Z", MORNING)).toBe(false); // 9:05pm EDT: past the window
  });

  it("each time gets one run: a retry or a late GitHub run changes nothing", () => {
    const midday = "2026-07-01T16:35:00Z";
    expect(due("2026-07-01T17:20:00Z", midday)).toBe(false);
    expect(due("2026-07-01T21:15:00Z", midday)).toBe(true); // the next time still runs
    expect(due("2026-07-01T21:45:00Z", "2026-07-01T21:15:00Z")).toBe(false);
  });

  it("a briefing that landed late fills the time it passed", () => {
    expect(due("2026-07-01T17:00:00Z", "2026-07-01T16:45:00Z")).toBe(false); // briefing at 12:45, now 1:00
  });

  it("a last update from another day or that can't be read doesn't count", () => {
    expect(due("2026-07-01T16:35:00Z", "2026-06-30T21:15:00Z")).toBe(true);
    expect(due("2026-07-01T16:35:00Z", "junk")).toBe(true);
  });
});

describe("review schedule", () => {
  const rgate = (iso: string, hasThisWeek = false) =>
    shouldDeliverReview({ now: new Date(iso), timeZone: TZ, reviewDay: 0, reviewTime: "18:00", hasThisWeek });

  it("delivers from the EDT line in summer and the EST line in winter", () => {
    expect(rgate("2026-07-05T21:45:00Z").deliver).toBe(true); // Sun 5:45pm EDT
    expect(rgate("2026-11-08T21:45:00Z")).toMatchObject({ deliver: false, reason: expect.stringMatching(/too early/) }); // 4:45pm EST
    expect(rgate("2026-11-08T22:45:00Z").deliver).toBe(true); // 5:45pm EST
  });

  it("handles the Sunday daylight saving ends (Nov 1, 2026)", () => {
    expect(rgate("2026-11-01T21:45:00Z").deliver).toBe(false); // 4:45pm EST already
    expect(rgate("2026-11-01T22:45:00Z").deliver).toBe(true);
  });

  it("skips the second line once this week's review exists, other days, and very late starts", () => {
    expect(rgate("2026-07-05T22:45:00Z", true)).toMatchObject({
      deliver: false,
      reason: expect.stringMatching(/already exists/),
    });
    expect(rgate("2026-07-06T21:45:00Z")).toMatchObject({ deliver: false, reason: "not the review day" });
    expect(rgate("2026-07-06T01:30:00Z").deliver).toBe(false); // Sun 9:30pm EDT: too late
    expect(rgate("2026-07-06T00:30:00Z").deliver).toBe(true); // Sun 8:30pm EDT: GitHub was late
  });
});
