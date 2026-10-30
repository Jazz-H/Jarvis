import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runWeather, weatherSpec } from "../subagents/weather.ts";
import { runNews, applyPicks, newsSpec } from "../subagents/news.ts";
import { Trace } from "../lib/trace.ts";
import type { SubagentDeps } from "../subagents/types.ts";
import { fakeFetch, json, text } from "./helpers.ts";
import { CANDIDATE, FACTS } from "./fixtures.ts";

vi.spyOn(console, "log").mockImplementation(() => {});
const meteo = JSON.parse(readFileSync(new URL("./fixtures/open-meteo.json", import.meta.url), "utf8"));

function deps(routes: Parameters<typeof fakeFetch>[0], reply: unknown): SubagentDeps & { specs: any[] } {
  const specs: any[] = [];
  return {
    fetchImpl: fakeFetch(routes).impl,
    run: async (spec) => {
      specs.push(spec);
      return spec.schema.parse(reply);
    },
    trace: new Trace(),
    specs,
  };
}

describe("weather sub-agent", () => {
  it("uses the haiku model and passes facts as untrusted data", () => {
    const s = weatherSpec(FACTS);
    expect(s.model).toBe("claude-haiku-5-5");
    expect(s.prompt).toContain('<untrusted_data source="open-meteo">');
    expect(s.system).toContain("never change");
  });

  it("merges code's facts with the model's advice; numbers come from code", async () => {
    const d = deps([[/open-meteo/, () => json(meteo)]], {
      summary: "Rain by noon.",
      wear: "Jacket.",
      washDayNote: "Frizz risk.",
    });
    const card = await runWeather(d, false);
    expect(card).toMatchObject({ highF: 69, lowF: 49, summary: "Rain by noon.", washDay: false, washDayNote: null });
  });
});

describe("news sub-agent", () => {
  const c2 = { ...CANDIDATE, id: "cars-1", topic: "cars", title: "EV prices fall", link: "https://n/2" };

  it("uses the sonnet model and sends no links to the model", () => {
    const s = newsSpec([CANDIDATE]);
    expect(s.model).toBe("claude-sonnet-5-5");
    expect(s.prompt).not.toContain("https://");
  });

  it("keeps only real, unique picks in the model's order, with links from code", () => {
    const card = applyPicks(
      {
        stories: [
          { id: "cars-1", summary: "EVs got cheaper." },
          { id: "made-up", summary: "x" },
          { id: "cars-1", summary: "dup" },
          { id: "ai-1", summary: "A model did well." },
        ],
      },
      [CANDIDATE, c2],
    );
    expect(card.stories.map((s) => [s.id, s.link, s.summary])).toEqual([
      ["cars-1", "https://n/2", "EVs got cheaper."],
      ["ai-1", "https://news.google.com/a1", "A model did well."],
    ]);
  });

  it("fails when no pick is valid", () => {
    expect(() => applyPicks({ stories: [{ id: "nope", summary: "x" }] }, [CANDIDATE])).toThrow("no valid stories");
  });

  it("fails without calling the model when every feed is down", async () => {
    const d = deps([[/news\.google\.com/, () => text("", 503)]], { stories: [] });
    await expect(runNews(d)).rejects.toThrow("no headlines");
    expect(d.specs).toHaveLength(0);
  });
});
