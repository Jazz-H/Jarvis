import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildDayDigest, mergeDigest, readWeekFile } from "../lib/day-digest.ts";
import { runBriefing, type JarvisDeps, type Subagents } from "../jarvis.ts";
import { Briefing } from "../schemas/briefing.ts";
import { WeekFile, type DayDigest } from "../schemas/week.ts";
import { Trace } from "../lib/trace.ts";
import { addDays } from "../lib/jazz-context.ts";
import type { GistClient } from "../tools/gist.ts";
import { FACTS, CANDIDATE } from "./fixtures.ts";
import { fakeQuery, memoryGist } from "./helpers.ts";

const meta = { agent: "x", model: "m", updatedAt: "2026-10-29T10:50:00.000Z" };
const WEATHER = { ...FACTS, summary: "Rain.", wear: "Jacket.", washDayNote: null };
const NEWS = { stories: [{ ...CANDIDATE, summary: "s" }] };
const CALENDAR = {
  date: "2026-10-29",
  events: [
    { title: "Standup", day: "today", allDay: false, start: "09:30", end: "10:00", location: "" },
    { title: "Dentist " + "x".repeat(100), day: "today", allDay: false, start: "15:00", end: "16:00", location: "" },
    { title: "Oil change", day: "tomorrow", allDay: false, start: "10:00", end: "11:00", location: "" },
  ],
  overlaps: [],
  summary: "Two things today.",
};
const INBOX = {
  unread: 4,
  urgent: [{ from: "Bank", summary: "Card locked" }],
  needsReply: [{ from: "Ann " + "y".repeat(60), summary: "Lunch? " + "z".repeat(200) }],
  bills: [
    {
      payee: "City Power",
      amount: 120.5,
      due: "2026-11-03",
      budgetName: "Power",
      budgetAmount: 100,
      status: "differs",
    },
  ],
};
const DELIVERIES = {
  packages: [
    { item: "Rain jacket", status: "out", eta: "2026-10-29", etaText: "by 8 PM", shoppingMatch: "Rain jacket" },
  ],
};

const briefing = (cards: Record<string, unknown>, date = "2026-10-29") =>
  Briefing.parse({
    version: 1,
    id: `${date}T10:50:00Z`,
    date,
    generatedAt: meta.updatedAt,
    trigger: "manual",
    headline: "h",
    summary: [{ text: "t", source: "jazz" }],
    summaryBy: "jarvis",
    cards: {
      weather: { status: "ok", data: WEATHER, ...meta },
      news: { status: "ok", data: NEWS, ...meta },
      ...cards,
    },
    notes: [],
  });

const ok = (data: unknown) => ({ status: "ok", data, ...meta });
const err = { status: "error", error: "Inbox didn't finish: x", ...meta };

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("day digest", () => {
  it("keeps only short, validated card fields", () => {
    const d = buildDayDigest(briefing({ calendar: ok(CALENDAR), inbox: ok(INBOX), deliveries: ok(DELIVERIES) }))!;
    expect(d).toEqual({
      date: "2026-10-29",
      inbox: {
        unread: 4,
        urgent: 1,
        needsReply: [
          { from: ("Ann " + "y".repeat(60)).slice(0, 30), summary: ("Lunch? " + "z".repeat(200)).slice(0, 60) },
        ],
        bills: [{ payee: "City Power", amount: 120.5, status: "differs" }],
      },
      deliveries: { packages: [{ item: "Rain jacket", status: "out", eta: "2026-10-29" }] },
      calendar: { events: 2, overlaps: 0, titles: ["Standup", ("Dentist " + "x".repeat(100)).slice(0, 40)] },
    });
    expect(JSON.stringify(d).length).toBeLessThan(1024);
  });

  it("leaves out failed cards, and is null without any of the three", () => {
    expect(buildDayDigest(briefing({ inbox: err, calendar: ok(CALENDAR) }))).toEqual({
      date: "2026-10-29",
      calendar: { events: 2, overlaps: 0, titles: ["Standup", ("Dentist " + "x".repeat(100)).slice(0, 40)] },
    });
    expect(buildDayDigest(briefing({}))).toBeNull();
    expect(buildDayDigest(briefing({ inbox: err }))).toBeNull();
  });

  it("stays under 2 KB even on a maxed-out day (typically under 1 KB)", () => {
    const full = {
      unread: 99,
      urgent: Array(3).fill({ from: "f".repeat(80), summary: "s".repeat(140) }),
      needsReply: Array(5).fill({ from: "f".repeat(80), summary: "s".repeat(140) }),
      bills: Array(5).fill({ ...INBOX.bills[0], payee: "p".repeat(60) }),
    };
    const pk = Array(8).fill({ ...DELIVERIES.packages[0], item: "i".repeat(80) });
    const cal = { ...CALENDAR, events: Array(6).fill({ ...CALENDAR.events[0], title: "t".repeat(120) }) };
    const d = buildDayDigest(briefing({ inbox: ok(full), deliveries: ok({ packages: pk }), calendar: ok(cal) }))!;
    expect(d.deliveries!.packages).toHaveLength(5);
    expect(JSON.stringify(d).length).toBeLessThan(2048);
  });

  it("keeps the newest 8 days, oldest first, replacing a re-run day", () => {
    const day = (date: string, unread = 1): DayDigest => ({
      date,
      inbox: { unread, urgent: 0, needsReply: [], bills: [] },
    });
    let days: DayDigest[] = [];
    for (let i = 0; i < 10; i++) days = mergeDigest(days, day(addDays("2026-10-20", i)), 8).days;
    expect(days.map((d) => d.date)).toEqual(Array.from({ length: 8 }, (_, i) => addDays("2026-10-22", i)));
    const again = mergeDigest(days, day("2026-10-29", 7), 8);
    expect(again.days).toHaveLength(8);
    expect(again.days.at(-1)).toEqual(day("2026-10-29", 7));
    expect(WeekFile.safeParse(again).success).toBe(true);
  });

  it("reads the week file leniently, dropping anything malformed", () => {
    expect(readWeekFile(null)).toEqual([]);
    expect(readWeekFile("nope")).toEqual([]);
    expect(readWeekFile('{"days":"x"}')).toEqual([]);
    const good = { date: "2026-10-28", calendar: { events: 1, overlaps: 0, titles: ["a"] } };
    const raw = JSON.stringify({
      version: 1,
      days: [good, { date: "bad" }, { date: "2026-10-27", calendar: { events: -1, overlaps: 0, titles: [] } }, good, 5],
    });
    expect(readWeekFile(raw)).toEqual([good]);
  });
});

describe("morning run writes the day digest", () => {
  const JAZZ = JSON.stringify({ updatedAt: 1, data: {} });
  const subs: Subagents = {
    weather: async () => WEATHER,
    news: async () => NEWS,
    calendar: async () => CALENDAR as any,
  };
  const deps = (gist: GistClient): JarvisDeps => ({
    now: new Date("2026-10-29T10:50:00Z"),
    trigger: "manual",
    gist,
    fetchImpl: (() => {
      throw new Error("no network in tests");
    }) as any,
    maxRunCostUsd: 0.5,
    trace: new Trace(),
    queryFn: fakeQuery([{ structured_output: { headline: "h", summary: [{ text: "t", source: "jazz" }] } }]).fn,
    subagents: subs,
  });

  it("appends today's digest to jazz2-week.json after the briefing", async () => {
    const old = { date: "2026-10-28", calendar: { events: 3, overlaps: 1, titles: ["x"] } };
    const g = memoryGist({ "jazz2-data.json": JAZZ, "jazz2-week.json": JSON.stringify({ version: 1, days: [old] }) });
    const r = await runBriefing(deps(g.gist));
    expect(r.status).toBe("delivered");
    expect(g.writes.map(([n]) => n)).toEqual(["jazz2-briefing.json", "jazz2-week.json"]);
    expect(JSON.parse(g.files["jazz2-week.json"])).toEqual({
      version: 1,
      days: [
        old,
        {
          date: "2026-10-29",
          calendar: { events: 2, overlaps: 0, titles: CALENDAR.events.slice(0, 2).map((e) => e.title.slice(0, 40)) },
        },
      ],
    });
  });

  it("never fails the briefing when the digest can't be written", async () => {
    const g = memoryGist({ "jazz2-data.json": JAZZ });
    const gist: GistClient = {
      readFile: g.gist.readFile,
      writeFile: async (n, c) => {
        if (n === "jazz2-week.json") throw new Error("GitHub API 500 writing jazz2-week.json");
        return g.gist.writeFile(n, c);
      },
    };
    const d = deps(gist);
    const r = await runBriefing(d);
    expect(r.status).toBe("delivered");
    expect(d.trace.events.find((e) => e.event === "day digest failed")).toBeTruthy();
  });
});
