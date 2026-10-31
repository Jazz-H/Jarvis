import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAsk, askLimits, cleanActions, cleanLinks, cleanAskOutput } from "../ask.ts";
import { AnswersFile, type AskOutput } from "../schemas/ask.ts";
import type { ActionTargets } from "../lib/ask-context.ts";
import { Trace } from "../lib/trace.ts";
import { fakeQuery, memoryGist } from "./helpers.ts";
import { NOW, TODAY, JAZZ_FILE, BRIEFING_FILE, askFile, q, ASK_OUT } from "./ask-fixture.ts";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const T: ActionTargets = {
  memory: new Map([["m1", "No pork"]]),
  todos: new Map([["t1", "Call mom"]]),
  goals: new Map([["p3-2", "Daily floss"]]),
  shopping: new Map([["w1", "Rain jacket"]]),
  workoutsToday: new Map([["wo1", "Gym"]]),
};
const A = (type: string, over: Record<string, unknown> = {}) =>
  ({ type, id: null, text: null, date: null, lbs: null, ...over }) as NonNullable<AskOutput["actions"]>[number];

describe("Ask actions", () => {
  it("keeps only known, open targets with real dates; labels come from the app's names", () => {
    const out = cleanActions(
      [
        A("todo_done", { id: "t1" }),
        A("todo_done", { id: "nope" }), // not an open to-do
        A("todo_add", { text: "Buy stamps", date: "2026-11-02" }),
        A("todo_move", { id: "t1", date: "2026-02-30" }), // not a real date
        A("goal_done", { id: "p3-2" }),
        A("shopping_bought", { id: "w1" }),
        A("weight_log", { lbs: 127.64, date: null }),
        A("workout_done", { id: "wo1" }),
        A("todo_done", { id: "t1" }), // repeat
      ],
      TODAY,
      T,
    );
    expect(out.map((a) => a.label)).toEqual([
      'Ticked "Call mom"',
      'Added to-do "Buy stamps" for Mon, Nov 2',
      'Ticked goal "Daily floss"',
      'Marked "Rain jacket" bought',
      "Logged weight 127.6 lb today",
    ]);
    expect(out[4]).toMatchObject({ type: "weight_log", lbs: 127.6, date: TODAY });
  });

  it("refuses weights out of range and dates outside the window", () => {
    const out = cleanActions(
      [
        A("weight_log", { lbs: 9000 }),
        A("weight_log", { lbs: 150, date: "2026-01-01" }), // too old: logged for today instead
        A("todo_move", { id: "t1", date: "2020-01-01" }),
        A("shopping_add", { text: "   " }),
      ],
      TODAY,
      T,
    );
    expect(out).toEqual([{ type: "weight_log", lbs: 150, date: TODAY, label: "Logged weight 150 lb today" }]);
  });

  it("links: https only, deduped, at most 3", () => {
    expect(
      cleanLinks([
        { title: "RepairPal", url: "https://repairpal.com/ac" },
        { title: "bad", url: "javascript:alert(1)" },
        { title: "http", url: "http://example.com" },
        { title: "dup", url: "https://repairpal.com/ac" },
        { title: "", url: "https://www.cr.org/a" },
        { title: "x", url: "https://x.com" },
        { title: "y", url: "https://y.com" },
      ]),
    ).toEqual([
      { title: "RepairPal", url: "https://repairpal.com/ac" },
      { title: "cr.org", url: "https://www.cr.org/a" },
      { title: "x", url: "https://x.com" },
    ]);
  });

  it("an answer that searched the web keeps links but loses every action; without a search, links go", () => {
    const out = {
      ...(ASK_OUT as AskOutput),
      sources: ["web", "jazz"] as AskOutput["sources"],
      actions: [A("todo_done", { id: "t1" })],
      links: [{ title: "Page", url: "https://example.com/p" }],
    };
    const web = cleanAskOutput(out, TODAY, ["jazz"], T, 2);
    expect(web.actions).toBeUndefined();
    expect(web.links).toEqual([{ title: "Page", url: "https://example.com/p" }]);
    expect(web.sources).toEqual(["web", "jazz"]);
    const local = cleanAskOutput(out, TODAY, ["jazz"], T, 0);
    expect(local.actions).toHaveLength(1);
    expect(local.links).toBeUndefined();
    expect(local.sources).toEqual(["jazz"]);
  });

  it("end to end: actions on real ids are stored; a web search drops them", async () => {
    const data = JSON.parse(JAZZ_FILE);
    const todo = { id: "t-act-1", text: "Call mom", done: false, due: TODAY };
    data.data["todo-content"] = [...(data.data["todo-content"] ?? []), todo];
    const jazz = JSON.stringify(data);
    for (const searches of [0, 1]) {
      const { gist, files } = memoryGist({
        "jazz2-data.json": jazz,
        "jazz2-briefing.json": BRIEFING_FILE,
        "jazz2-ask.json": askFile([q("ask-act-01", "mark it done", "2026-10-30T13:00:00.000Z")]),
      });
      const fq = fakeQuery([
        {
          structured_output: { ...ASK_OUT, actions: [A("todo_done", { id: todo.id })] },
          modelUsage: { "claude-opus-5-5": { webSearchRequests: searches, inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 } } as any,
        },
      ]);
      await runAsk({ gist, now: NOW, trigger: "dispatch", limits: askLimits({}), trace: new Trace(), queryFn: fq.fn, push: null });
      const a = AnswersFile.parse(JSON.parse(files["jazz2-answers.json"])).answers[0];
      if (searches) expect(a.actions).toBeUndefined();
      else expect(a.actions?.map((x) => x.type)).toEqual(["todo_done"]);
    }
  });
});
