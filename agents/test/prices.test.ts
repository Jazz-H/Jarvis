import { describe, it, expect, vi, beforeEach } from "vitest";
import { watchItems, cleanPrices, isDrop, pricesSpec } from "../subagents/prices.ts";
import { runBriefing, pushMessages, type Subagents } from "../jarvis.ts";
import { Briefing } from "../schemas/briefing.ts";
import { emptyContext } from "../lib/jazz-context.ts";
import { agentOptions } from "../lib/run-agent.ts";
import { Trace } from "../lib/trace.ts";
import type { GistClient } from "../tools/gist.ts";
import { FACTS, CANDIDATE } from "./fixtures.ts";
import { fakeQuery } from "./helpers.ts";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const TODAY = "2026-10-29";
const DATA = {
  "wants-content": [
    {
      id: "w1",
      name: "Rain jacket",
      kind: "need",
      price: 120,
      link: "https://www.rei.com/p/1",
      meta: "Men's M, black",
    },
    { id: "w2", name: "Belt", price: "$40.00" },
    { id: "w3", name: "No price", price: null },
    { id: "w4", name: "Later", price: 50, later: true },
    { id: "w5", name: "Bought", price: 30 },
    { id: "w6", name: "Headphones", price: 300, priority: "high" },
    { id: "bad id!", name: "x", price: 10 },
  ],
  "wants-state": { w5: true },
};

describe("Price watcher", () => {
  it("watches open items with a saved price: high priority and needs first, at most 8", () => {
    expect(watchItems(DATA).map((w) => [w.id, w.saved, w.store])).toEqual([
      ["w6", 300, null],
      ["w1", 120, "rei.com"],
      ["w2", 40, null],
    ]);
    expect(watchItems(null)).toEqual([]);
  });

  it("a drop is at least 5% and $2 under the saved price", () => {
    expect(isDrop(120, 113.99)).toBe(true);
    expect(isDrop(120, 115)).toBe(false); // under 5%
    expect(isDrop(20, 18.5)).toBe(false); // under $2
    expect(isDrop(120, null)).toBe(false);
  });

  it("checks every price and link; unknown ids are ignored", () => {
    const card = cleanPrices(
      {
        items: [
          { id: "w1", price: 89.999, store: "REI", url: "https://www.rei.com/p/1" },
          { id: "w6", price: -5, store: "Shady", url: "javascript:alert(1)" },
          { id: "w2", price: 39, store: null, url: "http://belts.example/b" },
          { id: "zzz", price: 1, store: "x", url: "https://x.com" },
        ],
      },
      watchItems(DATA),
      TODAY,
    );
    expect(card).toEqual({
      checkedAt: TODAY,
      items: [
        { id: "w6", name: "Headphones", saved: 300, found: null, store: null, url: null, drop: false },
        {
          id: "w1",
          name: "Rain jacket",
          saved: 120,
          found: 90,
          store: "REI",
          url: "https://www.rei.com/p/1",
          drop: true,
        },
        { id: "w2", name: "Belt", saved: 40, found: 39, store: null, url: null, drop: false },
      ],
    });
  });

  it("uses web search, Sonnet, and treats the list as data", () => {
    const spec = pricesSpec(watchItems(DATA));
    const o = agentOptions(spec, 0.15, new AbortController());
    expect([o.model, o.tools, o.allowedTools]).toEqual(["claude-sonnet-5-5", ["WebSearch"], ["WebSearch"]]);
    expect(spec.prompt).toContain("untrusted_data");
  });

  it("phone alert for drops found this morning", () => {
    const m = pushMessages({ headline: "Rain by noon" } as any, emptyContext(TODAY), null, null, {
      checkedAt: TODAY,
      items: [{ id: "w1", name: "Rain jacket", saved: 120, found: 89, store: "REI", url: null, drop: true }],
    });
    expect(m.find((x) => x.tag === "price")).toMatchObject({
      title: "Price drop on your list",
      body: "Rain jacket: $89.00 at REI (you saved $120.00)",
    });
  });
});

describe("Price watcher in the morning run", () => {
  const NOW = new Date("2026-10-29T10:50:00Z");
  const base: Subagents = {
    weather: async () => ({ ...FACTS, summary: "Dry.", wear: "Jacket.", washDayNote: null }),
    news: async () => ({ stories: [{ ...CANDIDATE, summary: "s" }] }),
  };
  const files = (over: Record<string, string> = {}) =>
    ({ "jazz2-data.json": JSON.stringify({ data: DATA }), ...over }) as Record<string, string>;
  const gistOf = (f: Record<string, string>): GistClient => ({
    readFile: async (n) => f[n] ?? null,
    writeFile: async (n, c) => void (f[n] = c),
  });
  const run = (f: Record<string, string>, prices: Subagents["prices"]) =>
    runBriefing({
      now: NOW,
      trigger: "manual",
      gist: gistOf(f),
      fetchImpl: fetch,
      maxRunCostUsd: 1,
      trace: new Trace([]),
      queryFn: fakeQuery([{ structured_output: { headline: "h", summary: [{ text: "t", source: "jazz" }] } }]).fn,
      subagents: { ...base, prices },
    });

  it("checks when the last check is a week old, saves it, and puts it in the briefing", async () => {
    const f = files({ "jazz2-prices.json": JSON.stringify({ checkedAt: "2026-10-20", items: [] }) });
    const seen: string[][] = [];
    await run(f, async (_d, items, today) => {
      seen.push(items.map((i) => i.id));
      return {
        checkedAt: today,
        items: [{ id: "w1", name: "Rain jacket", saved: 120, found: 90, store: "REI", url: null, drop: true }],
      };
    });
    expect(seen).toEqual([["w6", "w1", "w2"]]);
    expect(JSON.parse(f["jazz2-prices.json"]).checkedAt).toBe(TODAY);
    const b = Briefing.parse(JSON.parse(f["jazz2-briefing.json"]));
    expect(b.cards.prices).toMatchObject({ status: "ok", agent: "Price watcher", data: { checkedAt: TODAY } });
  });

  it("skips the check within the week and carries the last one (minus items no longer on the list)", async () => {
    const f = files({
      "jazz2-prices.json": JSON.stringify({
        checkedAt: "2026-10-26",
        items: [
          { id: "w1", name: "Rain jacket", saved: 120, found: 90, store: "REI", url: null, drop: true },
          { id: "gone", name: "Old", saved: 10, found: 5, store: null, url: null, drop: true },
        ],
      }),
    });
    let calls = 0;
    await run(f, async () => {
      calls++;
      return { checkedAt: TODAY, items: [] };
    });
    expect(calls).toBe(0);
    const b = Briefing.parse(JSON.parse(f["jazz2-briefing.json"]));
    expect(b.cards.prices?.status === "ok" && b.cards.prices.data.items.map((i) => i.id)).toEqual(["w1"]);
  });
});
