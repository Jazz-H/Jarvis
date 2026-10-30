import { describe, it, expect, vi, beforeEach } from "vitest";
import { runBriefing, fallbackSummary, type JarvisDeps, type Subagents } from "../jarvis.ts";
import { Trace } from "../lib/trace.ts";
import { emptyContext } from "../lib/jazz-context.ts";
import type { GistClient } from "../tools/gist.ts";
import type { SubagentDeps } from "../subagents/types.ts";
import { FACTS, CANDIDATE } from "./fixtures.ts";
import { fakeQuery } from "./helpers.ts";

const NOW = new Date("2026-10-29T10:50:00Z"); // 6:50am EDT
const WEATHER = { ...FACTS, summary: "Light rain by noon.", wear: "Rain jacket.", washDayNote: null };
const NEWS = { stories: [{ ...CANDIDATE, summary: "A model did well." }] };
const JARVIS_OUT = {
  headline: "Rain by noon, rent due Saturday",
  summary: [
    { text: "Light rain by noon; bring a jacket.", source: "weather" },
    { text: "Rent is due Nov 1.", source: "jazz" },
  ],
};
const JAZZ = JSON.stringify({
  updatedAt: 1,
  data: {
    "todo-content": [{ text: "Call the bank", due: "2026-10-29" }],
    "bills-content": [{ name: "Rent", amount: 1450, due: "2026-11-01" }],
  },
});

function memoryGist(files: Record<string, string> = {}) {
  const writes: [string, string][] = [];
  const gist: GistClient = {
    readFile: async (n) => files[n] ?? null,
    writeFile: async (n, c) => {
      writes.push([n, c]);
      files[n] = c;
    },
  };
  return { gist, writes, files };
}

const ok: Subagents = { weather: async () => WEATHER, news: async () => NEWS };
const newsFails: Subagents = {
  ...ok,
  news: async () => {
    throw new Error("timed out after 120s");
  },
};

function deps(over: Partial<JarvisDeps> = {}): JarvisDeps {
  return {
    now: NOW,
    trigger: "manual",
    gist: memoryGist({ "jazz2-data.json": JAZZ }).gist,
    fetchImpl: (() => {
      throw new Error("no network in tests");
    }) as any,
    maxRunCostUsd: 0.5,
    trace: new Trace(),
    queryFn: fakeQuery([{ structured_output: JARVIS_OUT }]).fn,
    subagents: ok,
    ...over,
  };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("Jarvis orchestrator", () => {
  it("ships the briefing when a sub-agent fails, noting the failure", async () => {
    const g = memoryGist({ "jazz2-data.json": JAZZ });
    const q = fakeQuery([{ structured_output: JARVIS_OUT }]);
    const r = await runBriefing(deps({ gist: g.gist, queryFn: q.fn, subagents: newsFails }));
    if (r.status !== "delivered") throw new Error("not delivered");
    const b = r.briefing;
    expect(b.cards.weather).toMatchObject({ status: "ok", agent: "Weather", model: "claude-haiku-5-5" });
    expect(b.cards.news).toMatchObject({
      status: "error",
      agent: "News",
      error: "News didn't finish: timed out after 120s",
    });
    expect(b.notes).toContain("News didn't finish: timed out after 120s");
    expect(b.headline).toBe(JARVIS_OUT.headline);
    expect(b.summaryBy).toBe("jarvis");
    expect(b).toMatchObject({ version: 1, date: "2026-10-29", trigger: "manual" });

    // Jarvis saw the weather, the app data and the failure, but no news
    expect(q.seen).toHaveLength(1);
    const jarvisCall = q.seen[0];
    expect(jarvisCall.options!.model).toBe("claude-opus-5-5");
    expect(jarvisCall.prompt).toContain("Light rain by noon.");
    expect(jarvisCall.prompt).toContain("Call the bank");
    expect(jarvisCall.prompt).toContain("News didn't finish");
    expect(jarvisCall.prompt).not.toContain("New model tops benchmarks");

    // only the briefing file is written, and it round-trips
    expect(g.writes.map(([n]) => n)).toEqual(["jazz2-briefing.json"]);
    expect(JSON.parse(g.writes[0][1])).toEqual(b);
  });

  it("hands sub-agents only fetch, their own runner and the trace (no Gist)", async () => {
    let seen: SubagentDeps | undefined;
    await runBriefing(
      deps({
        subagents: {
          ...ok,
          weather: async (d) => {
            seen = d;
            return WEATHER;
          },
        },
      }),
    );
    expect(Object.keys(seen!).sort()).toEqual(["fetchImpl", "run", "trace"]);
  });

  it("passes today's wash day to the weather sub-agent", async () => {
    const washJazz = JSON.stringify({
      data: { "skin-routine-content": { washPm: [{}], wash: { anchor: "2026-10-15", everyDays: 7 } } },
    });
    let washArg: boolean | undefined;
    await runBriefing(
      deps({
        gist: memoryGist({ "jazz2-data.json": washJazz }).gist,
        subagents: {
          ...ok,
          weather: async (_d, wash) => {
            washArg = wash;
            return WEATHER;
          },
        },
      }),
    );
    expect(washArg).toBe(true);
  });

  it("falls back to a plain summary when the Jarvis model fails", async () => {
    const q = fakeQuery([{ structured_output: { headline: "" } }]);
    const r = await runBriefing(deps({ queryFn: q.fn }));
    if (r.status !== "delivered") throw new Error("not delivered");
    expect(q.seen).toHaveLength(2); // retried once
    expect(r.briefing.summaryBy).toBe("fallback");
    expect(r.briefing.headline).toBe("Your morning briefing");
    expect(r.briefing.summary[0]).toEqual({ text: "Light rain, 69°/49°, up to 60% rain.", source: "weather" });
    expect(r.briefing.notes.at(-1)).toMatch(/Jarvis couldn't write/);
  });

  it("still delivers when the Jazz data can't be read", async () => {
    const gist: GistClient = {
      readFile: async () => {
        throw new Error("GitHub API 502 reading the gist");
      },
      writeFile: async () => {},
    };
    const r = await runBriefing(deps({ gist }));
    expect(r.status).toBe("delivered");
    if (r.status === "delivered") expect(r.briefing.notes[0]).toMatch(/Couldn't read Jazz data/);
  });

  it("skips optional sub-agents that don't fit under MAX_RUN_COST_USD", async () => {
    const r = await runBriefing(deps({ maxRunCostUsd: 0.14 })); // jarvis 0.12 + weather 0.01 fit; news 0.06 doesn't
    if (r.status !== "delivered") throw new Error("not delivered");
    expect(r.briefing.cards.weather.status).toBe("ok");
    expect(r.briefing.cards.news).toMatchObject({
      status: "error",
      error: "Skipped to stay under the run's cost cap.",
    });
  });

  describe("scheduled runs", () => {
    it("skip when today's briefing already exists", async () => {
      const g = memoryGist({ "jazz2-data.json": JAZZ, "jazz2-briefing.json": JSON.stringify({ date: "2026-10-29" }) });
      const r = await runBriefing(deps({ trigger: "schedule", gist: g.gist }));
      expect(r).toEqual({ status: "skipped", reason: "today's briefing already exists" });
      expect(g.writes).toHaveLength(0);
    });

    it("skip outside the window (the EST line in summer)", async () => {
      const r = await runBriefing(deps({ trigger: "schedule", now: new Date("2026-07-01T09:45:00Z") }));
      expect(r.status).toBe("skipped");
    });

    it("deliver in the window when yesterday's briefing is there", async () => {
      const g = memoryGist({ "jazz2-data.json": JAZZ, "jazz2-briefing.json": JSON.stringify({ date: "2026-10-28" }) });
      const r = await runBriefing(deps({ trigger: "schedule", gist: g.gist }));
      expect(r.status).toBe("delivered");
      if (r.status === "delivered") expect(r.briefing.trigger).toBe("schedule");
    });
  });

  it("fallback summary reports bills, to-dos and wash day from facts only", () => {
    const c = {
      ...emptyContext("2026-10-29"),
      available: true,
      todosToday: [{ text: "a", starred: false }],
      overdue: [{ text: "b", due: "2026-10-20" }],
      billsDueSoon: [{ name: "Rent", amount: 1, due: "2026-10-29", autopay: false }],
      washDay: true,
    };
    expect(fallbackSummary(c, null, null).summary.map((s) => s.text)).toEqual([
      "1 bill due today or overdue.",
      "1 to-do today, 1 overdue.",
      "Wash day today.",
    ]);
    expect(fallbackSummary(emptyContext("2026-10-29"), null, null).summary).toEqual([
      { text: "Nothing to report yet.", source: "jarvis" },
    ]);
  });
});
