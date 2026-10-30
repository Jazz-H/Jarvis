import { describe, it, expect, vi, beforeEach } from "vitest";
import { readSubs, sendAll, type PushSub } from "../tools/push.ts";
import { runBriefing, pushMessages } from "../jarvis.ts";
import { Trace } from "../lib/trace.ts";
import { emptyContext } from "../lib/jazz-context.ts";
import type { GistClient } from "../tools/gist.ts";
import { FACTS, CANDIDATE } from "./fixtures.ts";
import { fakeFetch, fakeQuery } from "./helpers.ts";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
const sub = (n: number): PushSub => ({
  endpoint: `https://push.example/${n}`,
  keys: { p256dh: "p256dh-key-" + n, auth: "auth-key-" + n },
});

describe("push tool", () => {
  it("reads only well-formed https subscriptions", () => {
    const raw = JSON.stringify({
      subs: [
        sub(1),
        { endpoint: "http://insecure", keys: sub(2).keys },
        { endpoint: "https://x", keys: { p256dh: "<script>", auth: "a" } },
        5,
      ],
    });
    expect(readSubs(raw)).toEqual([sub(1)]);
    expect(readSubs("not json")).toEqual([]);
    expect(readSubs(null)).toEqual([]);
  });

  it("sends every message to every phone and reports revoked ones", async () => {
    const sent: string[] = [];
    const send = async (s: PushSub, payload: string) => {
      if (s.endpoint.endsWith("/2")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if (s.endpoint.endsWith("/3")) throw Object.assign(new Error("boom"), { statusCode: 500 });
      sent.push(`${s.endpoint} ${JSON.parse(payload).tag}`);
    };
    const msgs = [
      { title: "Jarvis", body: "h", url: "u", tag: "briefing" },
      { title: "Bill", body: "b", url: "u", tag: "bill" },
    ];
    const r = await sendAll([sub(1), sub(2), sub(3)], msgs, send);
    expect(sent).toEqual(["https://push.example/1 briefing", "https://push.example/1 bill"]);
    expect(r).toEqual({ sent: 2, gone: ["https://push.example/2"], failed: 2 });
  });
});

describe("notification messages", () => {
  const today = "2026-10-30";
  const b = { headline: "Rain by noon" } as any;
  it("headline, then manual bills due by tomorrow, then packages arriving today (max 3)", () => {
    const c = {
      ...emptyContext(today),
      billsDueSoon: [
        { name: "Rent", amount: 1450, due: "2026-10-31", autopay: false },
        { name: "Power", amount: 100, due: "2026-10-30", autopay: true },
        { name: "Gym", amount: 30, due: "2026-11-02", autopay: false },
      ],
    };
    const d = {
      packages: [
        { item: "Rain jacket", status: "out" as const, eta: today, etaText: "by 8 PM", shoppingMatch: null },
        { item: "Lamp", status: "shipped" as const, eta: "2026-11-02", etaText: null, shoppingMatch: null },
      ],
    };
    expect(pushMessages(b, c, d)).toEqual([
      { title: "Jarvis", body: "Rain by noon", url: "./jazz2.0.html?tab=jarvis", tag: "briefing" },
      {
        title: "Bill to pay",
        body: "Rent $1450.00 due tomorrow (not on autopay)",
        url: "./jazz2.0.html?tab=jarvis",
        tag: "bill",
      },
      { title: "Arriving today", body: "Rain jacket (by 8 PM)", url: "./jazz2.0.html?tab=jarvis", tag: "delivery" },
    ]);
    expect(pushMessages(b, emptyContext(today), null)).toHaveLength(1);
  });
});

describe("orchestrator notifications", () => {
  it("notifies after writing the briefing, prunes revoked phones, and never fails the run", async () => {
    const files: Record<string, string> = {
      "jazz2-data.json": JSON.stringify({ data: {} }),
      "jazz2-push.json": JSON.stringify({ subs: [sub(1), sub(2)] }),
    };
    const gist: GistClient = {
      readFile: async (n) => files[n] ?? null,
      writeFile: async (n, c) => void (files[n] = c),
    };
    const payloads: string[] = [];
    const r = await runBriefing({
      now: new Date("2026-10-30T11:00:00Z"),
      trigger: "manual",
      gist,
      fetchImpl: fakeFetch([]).impl,
      maxRunCostUsd: 0.5,
      trace: new Trace(),
      queryFn: fakeQuery([{ structured_output: { headline: "Hello", summary: [{ text: "x", source: "jarvis" }] } }]).fn,
      subagents: {
        weather: async () => ({ ...FACTS, summary: "s", wear: "w", washDayNote: null }),
        news: async () => ({ stories: [{ ...CANDIDATE, summary: "s" }] }),
      },
      push: async (s, payload) => {
        if (s.endpoint.endsWith("/2")) throw Object.assign(new Error("gone"), { statusCode: 404 });
        payloads.push(payload);
      },
    });
    expect(r.status).toBe("delivered");
    expect(payloads.map((p) => JSON.parse(p).body)).toEqual(["Hello"]);
    expect(readSubs(files["jazz2-push.json"])).toEqual([sub(1)]);

    // a broken push file or sender doesn't fail the run
    files["jazz2-push.json"] = "garbage";
    const r2 = await runBriefing({
      now: new Date("2026-10-30T11:00:00Z"),
      trigger: "manual",
      gist,
      fetchImpl: fakeFetch([]).impl,
      maxRunCostUsd: 0.5,
      trace: new Trace(),
      queryFn: fakeQuery([{ structured_output: { headline: "Hello", summary: [{ text: "x", source: "jarvis" }] } }]).fn,
      subagents: {
        weather: async () => ({ ...FACTS, summary: "s", wear: "w", washDayNote: null }),
        news: async () => ({ stories: [{ ...CANDIDATE, summary: "s" }] }),
      },
      push: async () => {
        throw new Error("network down");
      },
    });
    expect(r2.status).toBe("delivered");
  });
});
