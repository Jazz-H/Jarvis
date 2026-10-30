import { describe, it, expect } from "vitest";
import { WeatherAdvice, WeatherFacts, WeatherCard } from "../schemas/weather.ts";
import { NewsCandidate, NewsPicks, NewsCard } from "../schemas/news.ts";
import { Briefing, JarvisOutput } from "../schemas/briefing.ts";
import { outputSchema } from "../lib/output-schema.ts";
import { FACTS, CANDIDATE } from "./fixtures.ts";

describe("schemas", () => {
  it("weather: facts, advice and the merged card", () => {
    expect(WeatherFacts.safeParse(FACTS).success).toBe(true);
    expect(WeatherFacts.safeParse({ ...FACTS, humidityPct: 140 }).success).toBe(false);
    expect(WeatherAdvice.safeParse({ summary: "Rain later.", wear: "Jacket.", washDayNote: null }).success).toBe(true);
    expect(WeatherAdvice.safeParse({ summary: "", wear: "Jacket.", washDayNote: null }).success).toBe(false);
    expect(WeatherAdvice.safeParse({ summary: "x".repeat(201), wear: "J", washDayNote: null }).success).toBe(false);
    expect(WeatherCard.safeParse({ ...FACTS, summary: "s", wear: "w", washDayNote: null }).success).toBe(true);
  });

  it("news: only http(s) links, 1–8 picks", () => {
    expect(NewsCandidate.safeParse(CANDIDATE).success).toBe(true);
    expect(NewsCandidate.safeParse({ ...CANDIDATE, link: "javascript:alert(1)" }).success).toBe(false);
    expect(NewsPicks.safeParse({ stories: [] }).success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => ({ id: `a-${i}`, summary: "s" }));
    expect(NewsPicks.safeParse({ stories: nine }).success).toBe(false);
    expect(NewsCard.safeParse({ stories: [{ ...CANDIDATE, summary: "s" }] }).success).toBe(true);
  });

  it("jarvis output: 1–5 items from known sources", () => {
    const ok = { headline: "Rain on wash day", summary: [{ text: "Bring an umbrella.", source: "weather" }] };
    expect(JarvisOutput.safeParse(ok).success).toBe(true);
    expect(JarvisOutput.safeParse({ ...ok, summary: [{ text: "x", source: "email" }] }).success).toBe(false);
    expect(JarvisOutput.safeParse({ ...ok, summary: Array(6).fill(ok.summary[0]) }).success).toBe(false);
  });

  it("briefing: ok and error cards", () => {
    const meta = { agent: "Weather", model: "m", updatedAt: "2026-10-29T10:45:00.000Z" };
    const b = {
      version: 1,
      id: "2026-10-29T10:45:00Z",
      date: "2026-10-29",
      generatedAt: meta.updatedAt,
      trigger: "schedule",
      headline: "h",
      summary: [{ text: "t", source: "jarvis" }],
      summaryBy: "jarvis",
      cards: {
        weather: { status: "ok", data: { ...FACTS, summary: "s", wear: "w", washDayNote: null }, ...meta },
        news: { status: "error", error: "News didn't finish: timed out", ...meta, agent: "News" },
      },
      notes: [],
    };
    expect(Briefing.safeParse(b).success).toBe(true);
    expect(Briefing.safeParse({ ...b, cards: { ...b.cards, news: { status: "ok", ...meta } } }).success).toBe(false);
  });

  it("output schemas drop constraint keywords the API doesn't take; zod still enforces them", () => {
    const s = JSON.stringify(outputSchema(WeatherAdvice));
    expect(s).not.toMatch(/maxLength|minLength|\$schema/);
    expect(s).toContain('"additionalProperties":false');
    expect(JSON.stringify(outputSchema(NewsPicks))).not.toMatch(/minItems|maxItems/);
  });
});
