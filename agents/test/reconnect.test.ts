import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runBriefing, pushMessages, type JarvisDeps, type Subagents } from "../jarvis.ts";
import { CONFIG } from "../config.ts";
import { Trace } from "../lib/trace.ts";
import { emptyContext } from "../lib/jazz-context.ts";
import { GoogleAuthError } from "../tools/gmail.ts";
import type { GistClient } from "../tools/gist.ts";
import { FACTS, CANDIDATE } from "./fixtures.ts";
import { fakeQuery } from "./helpers.ts";

const MORNING = new Date("2026-10-29T11:00:00Z"); // 7:00am EDT
const NOON = new Date("2026-10-29T16:35:00Z"); // 12:35pm
const FIVE = new Date("2026-10-29T21:05:00Z"); // 5:05pm
const NINE = new Date("2026-10-30T01:05:00Z"); // 9:05pm
const JAZZ = JSON.stringify({
  updatedAt: 1,
  data: { "todo-content": [{ id: "t1", text: "Pay rent", due: "2026-10-29" }] },
});
const SUB = { endpoint: "https://push.example/1", keys: { p256dh: "p256dh-key-1", auth: "auth-key-1" } };
const OUT = { headline: "Rain by noon", summary: [{ text: "Light rain by noon.", source: "weather" }] };
const expired = async () => {
  throw new GoogleAuthError("Google access expired: reconnect (SETUP.md → Google)");
};

function agents(google: "expired" | "ok"): Subagents {
  return {
    weather: async () => ({ ...FACTS, summary: "Rain.", wear: "Jacket.", washDayNote: null }),
    news: async () => ({ stories: [{ ...CANDIDATE, summary: "s" }] }),
    inbox: (google === "ok" ? async () => ({ unread: 1, urgent: [], needsReply: [], bills: [] }) : expired) as any,
    deliveries: (google === "ok" ? async () => ({ packages: [] }) : expired) as any,
  };
}

function setup() {
  const files: Record<string, string> = { "jazz2-data.json": JAZZ, "jazz2-push.json": JSON.stringify({ subs: [SUB] }) };
  const gist: GistClient = { readFile: async (n) => files[n] ?? null, writeFile: async (n, c) => void (files[n] = c) };
  const tags: string[][] = [];
  const run = async (now: Date, google: "expired" | "ok", trigger: JarvisDeps["trigger"] = "schedule") => {
    const sent: string[] = [];
    const r = await runBriefing({
      now,
      trigger,
      gist,
      fetchImpl: (() => {
        throw new Error("no network in tests");
      }) as any,
      maxRunCostUsd: 0.5,
      trace: new Trace(),
      queryFn: fakeQuery([{ structured_output: OUT }]).fn,
      subagents: agents(google),
      push: async (_s, payload) => void sent.push(JSON.parse(payload).tag),
    });
    tags.push(sent);
    return { r, briefing: JSON.parse(files["jazz2-briefing.json"]) };
  };
  return { run, tags, files };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("Google sign-in expired", () => {
  const updates = CONFIG.refresh.updates;
  beforeEach(() => {
    CONFIG.refresh.updates = {};
  });
  afterEach(() => {
    CONFIG.refresh.updates = updates;
  });

  it("the morning briefing flags it and the phone is told, right after the briefing", async () => {
    const s = setup();
    const { r, briefing } = await s.run(MORNING, "expired", "manual");
    expect(r.status).toBe("delivered");
    expect(briefing.reconnect).toEqual(["google"]);
    expect(s.tags[0].slice(0, 2)).toEqual(["briefing", "reconnect"]);
  });

  it("a refresh tells the phone only when it newly expired, and a good sign-in clears it", async () => {
    const s = setup();
    await s.run(MORNING, "ok", "manual");
    expect(s.tags[0]).not.toContain("reconnect");
    let b = (await s.run(NOON, "expired")).briefing;
    expect(b.reconnect).toEqual(["google"]);
    expect(s.tags[1]).toEqual(["reconnect"]);
    b = (await s.run(FIVE, "expired")).briefing; // still expired: said already
    expect(b.reconnect).toEqual(["google"]);
    expect(s.tags[2] ?? []).not.toContain("reconnect");
    b = (await s.run(NINE, "ok")).briefing; // reconnected
    expect(b.reconnect).toBeUndefined();
  });

  it("other failures aren't a sign-in problem", async () => {
    const subagents = {
      ...agents("ok"),
      inbox: (async () => {
        throw new Error("Gmail HTTP 503");
      }) as any,
    };
    const files: Record<string, string> = { "jazz2-data.json": JAZZ };
    const gist: GistClient = {
      readFile: async (n) => files[n] ?? null,
      writeFile: async (n, c) => void (files[n] = c),
    };
    const r = await runBriefing({
      now: MORNING,
      trigger: "manual",
      gist,
      fetchImpl: (() => {
        throw new Error("no network in tests");
      }) as any,
      maxRunCostUsd: 0.5,
      trace: new Trace(),
      queryFn: fakeQuery([{ structured_output: OUT }]).fn,
      subagents,
    });
    expect(r.status).toBe("delivered");
    expect(JSON.parse(files["jazz2-briefing.json"]).reconnect).toBeUndefined();
  });

  it("the message says what to do", () => {
    const [, m] = pushMessages({ headline: "Hi", reconnect: ["google"] } as any, emptyContext("2026-10-29"), null);
    expect(m).toMatchObject({ title: "Gmail needs you", tag: "reconnect" });
    expect(m.body).toMatch(/npm run google-auth/);
    expect(m.body).not.toMatch(/token":|access-|ya29/);
  });
});
