import { describe, it, expect, vi, beforeEach } from "vitest";
import { readBrain, brainForPrompt, notesForPrompt, dueCheckins, checkinAnswerId, emptyBrain } from "../lib/brain.ts";
import { runAsk, askLimits, cleanActions } from "../ask.ts";
import { jarvisSpec } from "../jarvis.ts";
import { topicFeeds } from "../subagents/news.ts";
import { AnswersFile } from "../schemas/ask.ts";
import { emptyContext } from "../lib/jazz-context.ts";
import { Trace } from "../lib/trace.ts";
import { localTime } from "../lib/schedule.ts";
import { fakeQuery, memoryGist } from "./helpers.ts";
import { NOW, TODAY, JAZZ_FILE, BRIEFING_FILE, ASK_OUT, askFile } from "./ask-fixture.ts";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const DATA = {
  "jarvis-memory": [
    { id: "m1", text: "I don't eat pork", by: "you" },
    { id: "bad id!", text: "dropped" },
    { id: "m2", text: "x".repeat(500), by: "jarvis" },
  ],
  "jarvis-feedback": [
    { kind: "briefing", item: "Old", vote: 1, at: 1 },
    { kind: "answer", item: "Newest", vote: -1, at: 3 },
    { kind: "weird", item: "dropped", vote: 1, at: 2 },
  ],
  "jarvis-settings": {
    tone: "brief",
    about: "  Software engineer in Springfield  ",
    newsTopics: ["Formula 1", "", "AI agents"],
    checkins: [
      { id: "ci-sun", name: "Plan my week", prompt: "What does my week look like?", days: [0, 5], time: "20:00" },
      { id: "ci-off", name: "Off", prompt: "x", days: [0], time: "08:00", on: false },
      { id: "ci-bad", name: "Bad time", prompt: "x", days: [0], time: "25:00" },
    ],
  },
};

describe("Jarvis's brain", () => {
  it("reads memory, ratings, settings and check-ins, trimmed and capped", () => {
    const b = readBrain(DATA);
    expect(b.memory.map((m) => [m.id, m.text.length, m.by])).toEqual([
      ["m1", 16, "you"],
      ["m2", 200, "jarvis"],
    ]);
    expect(b.feedback.map((f) => f.item)).toEqual(["Newest", "Old"]);
    expect(b).toMatchObject({ tone: "brief", about: "Software engineer in Springfield", newsTopics: ["Formula 1", "AI agents"] });
    expect(b.checkins.map((c) => c.id)).toEqual(["ci-sun"]);
    expect(readBrain(null)).toEqual(emptyBrain());
    expect(brainForPrompt(b).recentRatings[0]).toEqual({ on: "answer", item: "Newest", rating: "not useful" });
  });

  it("reads the Notebook (checked and capped) and gives Ask whole notes until 12k characters, then titles", () => {
    const b = readBrain({
      "jarvis-notes": [
        { id: "n1", title: "Car", text: "Oil every 5k.\r\nTires Nov 2025.", at: "2026-10-30" },
        { id: "n2", title: "Lease", text: "x".repeat(5000), at: "2026-10-01" }, // capped at 2,000
        { id: "bad id", title: "Dropped", text: "y" },
        { id: "n3", title: "", text: "no title" },
        ...Array.from({ length: 7 }, (_, i) => ({ id: `f${i}`, title: `Filler ${i}`, text: "z".repeat(2000) })),
      ],
    });
    expect(b.notes[0]).toEqual({ id: "n1", title: "Car", text: "Oil every 5k.\nTires Nov 2025.", at: "2026-10-30" });
    expect(b.notes[1].text).toHaveLength(2000);
    expect(b.notes.map((n) => n.id)).not.toContain("bad id");
    const p = notesForPrompt(b);
    expect(p.length).toBe(9);
    expect(p.filter((n) => n.text !== null).length).toBe(6); // 29 + 2000 + 4 × 2000 fit under 12k; the rest are titles only
    expect(p[8]).toEqual({ id: "f6", title: "Filler 6", updated: null, text: null });
  });

  it("a check-in is due once its time has passed today (New York), within 6 hours, once a day", () => {
    const b = readBrain(DATA);
    const fri = (hhmm: string) => new Date(`2026-10-30T${hhmm}:00-04:00`); // a Friday, EDT
    expect(dueCheckins(b, fri("19:59"), "America/New_York", new Set())).toEqual([]);
    const due = dueCheckins(b, fri("20:30"), "America/New_York", new Set());
    expect(due.map((d) => [d.id, d.date])).toEqual([[checkinAnswerId(b.checkins[0], "2026-10-30"), "2026-10-30"]]);
    expect(dueCheckins(b, fri("20:30"), "America/New_York", new Set([due[0].id]))).toEqual([]); // already ran
    expect(dueCheckins(b, new Date("2026-10-31T03:30:00Z"), "America/New_York", new Set())).toHaveLength(1); // 11:30pm
    expect(dueCheckins(b, new Date("2026-10-29T20:30:00-04:00"), "America/New_York", new Set())).toEqual([]); // Thursday
    expect(due[0].id).toMatch(/^[a-z0-9-]{8,40}$/);
  });

  it("the briefing gets the brain and the rules; News uses the owner's topics", () => {
    const spec = jarvisSpec(emptyContext(TODAY), null, null, [], { brain: readBrain(DATA) });
    expect(spec.prompt).toContain("I don't eat pork");
    expect(spec.prompt).toContain('"tone": "brief"');
    expect(spec.system).toMatch(/recentRatings/);
    expect(Object.keys(topicFeeds(["Formula 1", "formula 1", "AI agents"]))).toEqual(["formula 1", "ai agents"]);
    expect(topicFeeds(["Formula 1"])["formula 1"]).toBe(
      "https://news.google.com/rss/search?q=formula%201+when:1d&hl=en-US&gl=US&ceid=US:en",
    );
  });

  it("remember and forget are actions like the others", () => {
    const t = { memory: new Map([["m1", "I don't eat pork"]]), todos: new Map(), goals: new Map(), shopping: new Map(), workoutsToday: new Map(), packages: new Map(), lines: new Map(), notes: new Map() };
    const A = (type: string, over: object) => ({ type, id: null, text: null, date: null, lbs: null, ...over }) as any;
    expect(cleanActions([A("remember", { text: "Paid early in December" }), A("forget", { id: "m1" }), A("forget", { id: "nope" })], TODAY, t).map((a) => a.label)).toEqual([
      'Remembered "Paid early in December"',
      'Forgot "I don\'t eat pork"',
    ]);
  });

  it("a due check-in is answered in the Ask run (no actions), with its name", async () => {
    const data = JSON.parse(JAZZ_FILE);
    const m = Math.max(0, localTime(NOW, "America/New_York").minutes - 10);
    const time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    data.data["jarvis-settings"] = {
      checkins: [{ id: "ci-now", name: "Midday", prompt: "Anything I should know?", days: [0, 1, 2, 3, 4, 5, 6], time }],
    };
    const { gist, files } = memoryGist({
      "jazz2-data.json": JSON.stringify(data),
      "jazz2-briefing.json": BRIEFING_FILE,
      "jazz2-ask.json": askFile([]),
    });
    const fq = fakeQuery([{ structured_output: { ...ASK_OUT, actions: [{ type: "remember", id: null, text: "x", date: null, lbs: null }] } }]);
    const r = await runAsk({ gist, now: NOW, trigger: "dispatch", limits: askLimits({}), trace: new Trace(), queryFn: fq.fn, push: null });
    expect(r.status).toBe("done");
    const a = AnswersFile.parse(JSON.parse(files["jazz2-answers.json"])).answers[0];
    expect(a).toMatchObject({ checkin: "Midday", status: "ok" });
    expect(a.actions).toBeUndefined();
    expect(String(fq.seen[0].prompt)).toContain("scheduled check-in");
    // the same run again: it already ran today
    const again = await runAsk({ gist, now: NOW, trigger: "dispatch", limits: askLimits({}), trace: new Trace(), queryFn: fq.fn, push: null });
    expect(again.status).toBe("idle");
  });
});
