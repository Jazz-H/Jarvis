import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { runBriefing, refreshPushMessages, type JarvisDeps, type Subagents } from "../jarvis.ts";
import { combineDigests } from "../lib/day-digest.ts";
import { CONFIG } from "../config.ts";
import { Briefing } from "../schemas/briefing.ts";
import { Trace } from "../lib/trace.ts";
import type { GistClient } from "../tools/gist.ts";
import { FACTS, CANDIDATE } from "./fixtures.ts";
import { fakeQuery } from "./helpers.ts";

const MORNING = new Date("2026-10-29T11:00:00Z"); // 7:00am EDT
const MIDDAY = new Date("2026-10-29T16:35:00Z"); // 12:35pm EDT
const EVENING = new Date("2026-10-29T21:15:00Z"); // 5:15pm EDT
const WEATHER = { ...FACTS, summary: "Light rain by noon.", wear: "Rain jacket.", washDayNote: null };
const NEWS = { stories: [{ ...CANDIDATE, summary: "A model did well." }] };
const INBOX = { unread: 2, urgent: [], needsReply: [{ from: "Sam", summary: "Lunch?" }], bills: [] };
const pkg = (item: string, status = "shipped", eta: string | null = null) => ({
  item,
  status,
  eta,
  etaText: null,
  shoppingMatch: null,
});
const JARVIS_OUT = {
  headline: "Rain by noon, rent due Saturday",
  summary: [{ text: "Light rain by noon; bring a jacket.", source: "weather" }],
  suggestions: [{ text: "Call the bank", due: null }],
};
const JAZZ = JSON.stringify({
  updatedAt: 1,
  data: {
    "todo-content": [{ id: "t-bank", text: "Pay rent", due: "2026-10-29" }],
    "bills-content": [{ name: "Rent", amount: 1450, due: "2026-11-01" }],
  },
});

function memoryGist(files: Record<string, string>) {
  const writes: string[] = [];
  const gist: GistClient = {
    readFile: async (n) => files[n] ?? null,
    writeFile: async (n, c) => {
      writes.push(n);
      files[n] = c;
    },
  };
  return { gist, writes, files };
}

// What each sub-agent ran, and what it returns this time
function stubs(over: Partial<Subagents> = {}) {
  const ran: string[] = [];
  const track =
    <T>(name: string, value: T) =>
    async () => {
      ran.push(name);
      return value;
    };
  const subagents: Subagents = {
    weather: track("weather", { ...WEATHER, summary: "Clearing up." }) as Subagents["weather"],
    news: track("news", NEWS) as Subagents["news"],
    calendar: track("calendar", { date: "2026-10-29", summary: "Quiet.", events: [], overlaps: [] }) as any,
    inbox: track("inbox", INBOX) as any,
    deliveries: track("deliveries", { packages: [pkg("Desk lamp")] }) as any,
    ...over,
  };
  return { subagents, ran };
}

function deps(gist: GistClient, over: Partial<JarvisDeps> = {}): JarvisDeps {
  return {
    now: MIDDAY,
    trigger: "schedule",
    gist,
    fetchImpl: (() => {
      throw new Error("no network in tests");
    }) as any,
    maxRunCostUsd: 0.5,
    trace: new Trace(),
    queryFn: fakeQuery([{ structured_output: JARVIS_OUT }]).fn,
    subagents: stubs().subagents,
    ...over,
  };
}

// The morning's briefing, made the real way
async function morning(files: Record<string, string> = {}) {
  const m = memoryGist({ "jazz2-data.json": JAZZ, ...files });
  const r = await runBriefing(deps(m.gist, { now: MORNING, trigger: "manual" }));
  if (r.status !== "delivered") throw new Error("no morning briefing");
  m.writes.length = 0;
  return { ...m, briefing: r.briefing };
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("card refresh", () => {
  // plain refreshes: no update times while these run (the updates have their own tests below)
  const updates = CONFIG.refresh.updates;
  beforeEach(() => {
    CONFIG.refresh.updates = {};
  });
  afterEach(() => {
    CONFIG.refresh.updates = updates;
  });
  it("redoes the cards that go stale and keeps everything the morning wrote", async () => {
    const m = await morning();
    const { subagents, ran } = stubs();
    const q = fakeQuery([{ structured_output: JARVIS_OUT }]);
    const r = await runBriefing(deps(m.gist, { subagents, queryFn: q.fn }));
    expect(r.status).toBe("refreshed");
    expect(ran.sort()).toEqual(["calendar", "deliveries", "inbox", "weather"]); // no News
    expect(q.seen).toHaveLength(0); // no Jarvis model
    const saved = Briefing.parse(JSON.parse(m.files["jazz2-briefing.json"]));
    expect(saved.refreshedAt).toBe(MIDDAY.toISOString());
    expect(saved.cards.weather).toMatchObject({ status: "ok", updatedAt: MIDDAY.toISOString() });
    expect((saved.cards.weather as any).data.summary).toBe("Clearing up.");
    expect(saved.cards.deliveries).toMatchObject({ status: "ok" });
    for (const k of ["id", "date", "generatedAt", "headline", "summary", "suggestions", "top3"] as const)
      expect(saved[k]).toEqual(m.briefing[k]);
    expect(saved.cards.news).toEqual(m.briefing.cards.news);
  });

  it("each time gets one run, and the next time still runs", async () => {
    const m = await morning();
    expect((await runBriefing(deps(m.gist))).status).toBe("refreshed");
    const later = new Date(MIDDAY.getTime() + 45 * 60_000); // the alarm clock's retry
    expect(await runBriefing(deps(m.gist, { now: later }))).toMatchObject({ status: "skipped" });
    expect((await runBriefing(deps(m.gist, { now: EVENING }))).status).toBe("refreshed");
  });

  it("between refresh times a run stops as before, writing nothing", async () => {
    const m = await morning();
    const r = await runBriefing(deps(m.gist, { now: new Date("2026-10-29T14:00:00Z") }));
    expect(r).toMatchObject({ status: "skipped", reason: "today's briefing already exists" });
    expect(m.writes).toEqual([]);
  });

  it("without today's briefing the run is still the full morning one", async () => {
    const m = memoryGist({ "jazz2-data.json": JAZZ });
    const r = await runBriefing(deps(m.gist));
    expect(r.status).toBe("delivered");
    const q = await runBriefing(deps(m.gist)); // it landed after 12:30, so that time is done
    expect(q.status).toBe("skipped");
  });

  it("a card that fails keeps the morning's version, and the rest still update", async () => {
    const m = await morning();
    const { subagents } = stubs({
      inbox: async () => {
        throw new Error("timed out after 120s");
      },
    });
    const r = await runBriefing(deps(m.gist, { subagents }));
    expect(r.status).toBe("refreshed");
    const saved = JSON.parse(m.files["jazz2-briefing.json"]);
    expect(saved.cards.inbox).toEqual(JSON.parse(JSON.stringify(m.briefing.cards.inbox)));
    expect(saved.cards.weather.updatedAt).toBe(MIDDAY.toISOString());
    expect(saved.notes).toEqual(m.briefing.notes);
  });

  it("when every card fails nothing is written, so the alarm clock's retry can try again", async () => {
    const m = await morning();
    const fail = async () => {
      throw new Error("timed out after 120s");
    };
    const { subagents } = stubs({ weather: fail, calendar: fail, inbox: fail, deliveries: fail });
    const before = m.files["jazz2-briefing.json"];
    expect((await runBriefing(deps(m.gist, { subagents }))).status).toBe("skipped");
    expect(m.files["jazz2-briefing.json"]).toBe(before);
    expect((await runBriefing(deps(m.gist))).status).toBe("refreshed");
  });

  it("a morning problem that's now over leaves the notes", async () => {
    const fail = stubs({
      inbox: async () => {
        throw new Error("timed out after 120s");
      },
    }).subagents;
    const m = memoryGist({ "jazz2-data.json": JAZZ });
    await runBriefing(deps(m.gist, { now: MORNING, trigger: "manual", subagents: fail }));
    expect(JSON.parse(m.files["jazz2-briefing.json"]).notes.join()).toMatch(/Inbox didn't finish/);
    await runBriefing(deps(m.gist));
    expect(JSON.parse(m.files["jazz2-briefing.json"]).notes.join()).not.toMatch(/Inbox didn't finish/);
  });

  it("packages the owner hid stay hidden", async () => {
    const data = JSON.parse(JAZZ);
    data.data["jarvis-settings"] = { hiddenPackages: [{ item: "Desk lamp", at: "2026-10-29" }] };
    const m = await morning({ "jazz2-data.json": JSON.stringify(data) });
    await runBriefing(deps(m.gist));
    expect(JSON.parse(m.files["jazz2-briefing.json"]).cards.deliveries.data.packages).toEqual([]);
  });

  it("stops without its Budget and Shopping data rather than checking against nothing", async () => {
    const m = await morning();
    delete m.files["jazz2-data.json"];
    const { subagents, ran } = stubs();
    expect(await runBriefing(deps(m.gist, { subagents }))).toMatchObject({ status: "skipped", reason: "no jazz data" });
    expect(ran).toEqual([]);
  });

  describe("money", () => {
    // A model-backed card, so the run has a real cost
    const costly = (m: { gist: GistClient }, over: Partial<JarvisDeps> = {}) =>
      deps(m.gist, {
        subagents: stubs({
          inbox: (async (d: any) => {
            await d.run({
              name: "inbox",
              model: "claude-sonnet-5-5",
              system: "",
              prompt: "",
              schema: z.object({}),
              timeoutMs: 1000,
            });
            return INBOX;
          }) as any,
        }).subagents,
        queryFn: fakeQuery([{ total_cost_usd: 0.05, structured_output: {} }]).fn,
        ...over,
      });

    it("counts what it spends, month by month", async () => {
      const m = await morning();
      await runBriefing(costly(m));
      expect(JSON.parse(m.files["jazz2-refresh.json"])).toEqual({ version: 1, month: "2026-10", costUsd: 0.05 });
      await runBriefing(costly(m, { now: EVENING }));
      expect(JSON.parse(m.files["jazz2-refresh.json"]).costUsd).toBe(0.1);
      m.files["jazz2-refresh.json"] = JSON.stringify({ version: 1, month: "2026-09", costUsd: 7.99 });
      await runBriefing(costly(m, { forceRefresh: true, now: EVENING }));
      expect(JSON.parse(m.files["jazz2-refresh.json"])).toEqual({ version: 1, month: "2026-10", costUsd: 0.05 });
    });

    it("over the month's budget it stops, and the morning briefing doesn't", async () => {
      const m = await morning({
        "jazz2-refresh.json": JSON.stringify({
          version: 1,
          month: "2026-10",
          costUsd: CONFIG.refresh.monthlyBudgetUsd,
        }),
      });
      const { subagents, ran } = stubs();
      expect(await runBriefing(deps(m.gist, { subagents }))).toMatchObject({
        status: "skipped",
        reason: "this month's refresh budget is used",
      });
      expect(ran).toEqual([]);
    });

    it("a count it can't read stops the refresh instead of starting over", async () => {
      const m = await morning({ "jazz2-refresh.json": "{oops" });
      const { subagents, ran } = stubs();
      expect((await runBriefing(deps(m.gist, { subagents }))).status).toBe("skipped");
      expect(ran).toEqual([]);
    });
  });

  describe("by hand", () => {
    it("runs right away, outside the refresh times", async () => {
      const m = await morning();
      const at = new Date("2026-10-29T14:00:00Z");
      const r = await runBriefing(deps(m.gist, { now: at, trigger: "manual", forceRefresh: true }));
      expect(r.status).toBe("refreshed");
    });

    it("never starts a full briefing", async () => {
      const m = memoryGist({ "jazz2-data.json": JAZZ });
      const r = await runBriefing(deps(m.gist, { trigger: "manual", forceRefresh: true }));
      expect(r.status).toBe("skipped");
      expect(m.writes).toEqual([]);
    });
  });

  it("a plain manual run is still a full briefing, even in a refresh window", async () => {
    const m = await morning();
    const r = await runBriefing(deps(m.gist, { trigger: "manual" }));
    expect(r.status).toBe("delivered");
  });

  it("the Weekly Review keeps what the morning saw", async () => {
    const m = await morning();
    const { subagents } = stubs({ inbox: (async () => ({ ...INBOX, unread: 0, needsReply: [] })) as any });
    await runBriefing(deps(m.gist, { subagents }));
    const day = JSON.parse(m.files["jazz2-week.json"]).days[0];
    expect(day.inbox.needsReply).toEqual([{ from: "Sam", summary: "Lunch?" }]);
    expect(day.inbox.unread).toBe(2);
  });

  it("the workflow's refresh mode reaches the run", () => {
    const yml = readFileSync(new URL("../../.github/workflows/jarvis.yml", import.meta.url), "utf8");
    expect(yml).toMatch(/options:[\s\S]*- refresh\r?\n/);
    expect(yml).toContain("JARVIS_FORCE_REFRESH: ${{ inputs.mode == 'refresh' }}");
  });
});

describe("what a refresh tells the phone", () => {
  const brief = (cards: Record<string, unknown>) =>
    ({
      date: "2026-10-29",
      cards: {
        weather: { status: "ok", data: { ...WEATHER, alerts: [] } },
        ...cards,
      },
    }) as unknown as Briefing;
  const alert = (event: string, severity: string) => ({
    status: "ok",
    data: { ...WEATHER, alerts: [{ event, severity, headline: event, ends: null }] },
  });
  const inbox = (...from: string[]) => ({
    status: "ok",
    data: { ...INBOX, urgent: from.map((f) => ({ from: f, summary: "Secret detail" })) },
  });
  const packages = (...p: unknown[]) => ({ status: "ok", data: { packages: p } });

  it("nothing new, nothing sent", () => {
    const same = {
      weather: alert("Flood Warning", "Severe"),
      inbox: inbox("Bank"),
      deliveries: packages(pkg("Desk lamp", "out")),
    };
    expect(refreshPushMessages(brief(same), brief(same))).toEqual([]);
    expect(refreshPushMessages(brief({}), brief({ weather: alert("Frost Advisory", "Minor") }))).toEqual([]);
    expect(
      refreshPushMessages(brief({}), brief({ deliveries: packages(pkg("Desk lamp"), pkg("Mug", "delivered")) })),
    ).toEqual([]);
  });

  it("a new severe alert, a new urgent sender, and a package now arriving", () => {
    expect(refreshPushMessages(brief({}), brief({ weather: alert("Flood Warning", "Severe") }))).toMatchObject([
      { title: "Weather alert", body: "Flood Warning", tag: "weather" },
    ]);
    const urgent = refreshPushMessages(brief({ inbox: inbox("Bank") }), brief({ inbox: inbox("Bank", "Landlord") }));
    expect(urgent).toMatchObject([{ title: "Urgent email", body: "From Landlord", tag: "urgent" }]);
    expect(JSON.stringify(urgent)).not.toContain("Secret detail"); // who, not what the email says
    expect(
      refreshPushMessages(brief({}), brief({ deliveries: packages(pkg("Desk lamp", "shipped", "2026-10-29")) })),
    ).toMatchObject([{ title: "Arriving today", body: "Desk lamp", tag: "delivery" }]);
  });

  it("the same package reworded isn't news, and at most two go out", () => {
    expect(
      refreshPushMessages(
        brief({ deliveries: packages(pkg("Acme desk lamp", "out")) }),
        brief({ deliveries: packages(pkg("Acme desk lamp, black", "out")) }),
      ),
    ).toEqual([]);
    expect(
      refreshPushMessages(
        brief({}),
        brief({
          weather: alert("Flood Warning", "Extreme"),
          inbox: inbox("Bank"),
          deliveries: packages(pkg("Mug", "out")),
        }),
      ),
    ).toHaveLength(2);
  });
});

// Midday and evening updates: at CONFIG.refresh.updates times Jarvis writes a fresh summary over the
// refreshed cards, with nothing said before, and the phones hear about it
describe("updates (midday and evening)", () => {
  const NIGHT = new Date("2026-10-30T01:15:00Z"); // 9:15pm EDT
  const PUSH = {
    "jazz2-push.json": JSON.stringify({
      subs: [{ endpoint: "https://push.example/1", keys: { p256dh: "p256dh-key-1", auth: "auth-key-1" } }],
    }),
  };
  const MIDDAY_OUT = {
    headline: "Desk lamp arrives by 6 PM",
    summary: [
      { text: "Light rain by noon; bring a jacket.", source: "weather" }, // the morning's, word for word
      { text: "Rain by noon, so take a jacket along.", source: "weather" }, // the morning's, reworded
      { text: "Your desk lamp is out for delivery, due by 6 PM.", source: "deliveries" },
      { text: "Sam is still waiting on your lunch reply.", source: "inbox" },
    ],
    suggestions: [
      { text: "Call the bank", due: null }, // offered this morning
      { text: "Reply to Sam about lunch", due: null },
    ],
  };
  const run = (m: { gist: GistClient }, out: unknown, now: Date) => {
    const q = fakeQuery([{ structured_output: out, total_cost_usd: 0.04 }]);
    const sent: { title: string; body: string }[] = [];
    const ranStubs = stubs();
    return {
      q,
      sent,
      ran: ranStubs.ran,
      go: () =>
        runBriefing(
          deps(m.gist, {
            now,
            queryFn: q.fn,
            subagents: ranStubs.subagents,
            push: async (_s, p) => void sent.push(JSON.parse(p)),
          }),
        ),
    };
  };

  it("12:30 writes only what's new, with a new id and a Midday update notification", async () => {
    const m = await morning(PUSH);
    const r = run(m, MIDDAY_OUT, MIDDAY);
    expect((await r.go()).status).toBe("refreshed");
    expect(r.ran.sort()).toEqual(["calendar", "deliveries", "inbox", "weather"]); // News stays the morning's
    expect(r.q.seen).toHaveLength(1);
    const prompt = String(r.q.seen[0].prompt);
    expect(String(r.q.seen[0].options?.systemPrompt ?? "")).toContain("This is the midday update");
    expect(prompt).toContain("alreadySaid");
    expect(prompt).toContain("Light rain by noon; bring a jacket.");
    const saved = Briefing.parse(JSON.parse(m.files["jazz2-briefing.json"]));
    expect(saved.edition).toBe("midday");
    expect(saved.id).not.toBe(m.briefing.id);
    expect(saved.generatedAt).toBe(m.briefing.generatedAt);
    expect(saved.headline).toBe("Desk lamp arrives by 6 PM");
    // the morning's line, and a rewording of it, never come back
    expect(saved.summary.map((s) => s.text)).toEqual([
      "Your desk lamp is out for delivery, due by 6 PM.",
      "Sam is still waiting on your lunch reply.",
    ]);
    expect(saved.suggestions!.map((s) => s.text)).toEqual(["Reply to Sam about lunch"]);
    expect(saved.said).toEqual([m.briefing.headline, ...m.briefing.summary.map((s) => s.text)]);
    expect(saved.cards.news).toEqual(m.briefing.cards.news);
    expect(r.sent[0]).toMatchObject({ title: "Midday update", body: "Desk lamp arrives by 6 PM" });
  });

  it("5 PM leaves out what midday said too, and a line the owner dismissed", async () => {
    const m = await morning(PUSH);
    await run(m, MIDDAY_OUT, MIDDAY).go();
    // the owner dismissed one of midday's lines on Home
    const data = JSON.parse(m.files["jazz2-data.json"]);
    data.data["jarvis-settings"] = {
      hiddenLines: [{ text: "Sam is still waiting on your lunch reply.", at: "2026-10-29" }],
    };
    m.files["jazz2-data.json"] = JSON.stringify(data);
    const r = run(
      m,
      {
        headline: "Desk lamp arrives by 6 PM",
        summary: [
          { text: "Your desk lamp is out for delivery, due by 6 PM.", source: "deliveries" },
          { text: "Sam is still waiting on a lunch reply from you.", source: "inbox" },
          { text: "Tomorrow starts with standup at 9:30 AM.", source: "calendar" },
        ],
      },
      EVENING,
    );
    await r.go();
    const saved = Briefing.parse(JSON.parse(m.files["jazz2-briefing.json"]));
    expect(saved.edition).toBe("evening");
    expect(saved.summary.map((s) => s.text)).toEqual(["Tomorrow starts with standup at 9:30 AM."]);
    expect(saved.headline).toBe("Tomorrow starts with standup at 9:30 AM."); // its own headline was said at midday
    expect(saved.said).toContain("Your desk lamp is out for delivery, due by 6 PM.");
    expect(r.sent[0]).toMatchObject({ title: "Evening update" });
  });

  it("nothing new: the cards refresh, the summary stays, and no update is announced", async () => {
    const m = await morning(PUSH);
    const r = run(
      m,
      { headline: "x", summary: [{ text: "Nothing new since your last briefing.", source: "jarvis" }] },
      MIDDAY,
    );
    await r.go();
    const saved = Briefing.parse(JSON.parse(m.files["jazz2-briefing.json"]));
    expect(saved.edition).toBeUndefined();
    expect(saved.id).toBe(m.briefing.id);
    expect(saved.summary).toEqual(m.briefing.summary);
    expect(saved.refreshedAt).toBe(MIDDAY.toISOString());
    expect(r.sent.some((p) => /update/.test(p.title))).toBe(false);
  });

  it("9 PM stays a plain card refresh", async () => {
    const m = await morning();
    const r = run(m, MIDDAY_OUT, NIGHT);
    expect((await r.go()).status).toBe("refreshed");
    expect(r.q.seen).toHaveLength(0);
    expect(Briefing.parse(JSON.parse(m.files["jazz2-briefing.json"])).summary).toEqual(m.briefing.summary);
  });

  it("shares the $20 monthly budget with refreshes; too close to it, only the cards are redone", async () => {
    expect(CONFIG.refresh.monthlyBudgetUsd).toBe(20);
    const m = await morning({
      "jazz2-refresh.json": JSON.stringify({ version: 1, month: "2026-10", costUsd: 19.95 }),
    });
    const r = run(m, MIDDAY_OUT, MIDDAY);
    expect((await r.go()).status).toBe("refreshed");
    expect(r.q.seen).toHaveLength(0); // Jarvis's estimate doesn't fit in what's left
    expect(Briefing.parse(JSON.parse(m.files["jazz2-briefing.json"])).edition).toBeUndefined();
  });
});

describe("combineDigests", () => {
  const date = "2026-10-29";
  it("keeps what's gone since the morning, with each thing's latest status", () => {
    const old = {
      date,
      inbox: { unread: 5, urgent: 1, needsReply: [{ from: "Sam", summary: "Lunch?" }], bills: [] },
      deliveries: { packages: [{ item: "Lamp", status: "shipped" as const, eta: null }] },
      calendar: { events: 2, overlaps: 0, titles: ["A", "B"] },
    };
    const next = {
      date,
      inbox: { unread: 1, urgent: 0, needsReply: [{ from: "Jo", summary: "Call?" }], bills: [] },
      deliveries: {
        packages: [
          { item: "lamp", status: "delivered" as const, eta: null },
          { item: "Mug", status: "out" as const, eta: null },
        ],
      },
      calendar: { events: 1, overlaps: 0, titles: ["A"] },
    };
    const r = combineDigests(old, next);
    expect(r.inbox).toMatchObject({ unread: 5, urgent: 1 });
    expect(r.inbox!.needsReply.map((p) => p.from)).toEqual(["Sam", "Jo"]);
    expect(r.deliveries!.packages.map((p) => p.status)).toEqual(["delivered", "out"]);
    expect(r.calendar!.events).toBe(1); // a cancelled event is gone
  });

  it("stays inside the file's limits, and a missing side is no loss", () => {
    const people = (n: number, tag: string) =>
      Array.from({ length: n }, (_, i) => ({ from: `${tag}${i}`, summary: "s" }));
    const r = combineDigests(
      { date, inbox: { unread: 0, urgent: 0, needsReply: people(5, "a"), bills: [] } },
      { date, inbox: { unread: 0, urgent: 0, needsReply: people(5, "b"), bills: [] } },
    );
    expect(r.inbox!.needsReply).toHaveLength(5);
    const old = { date, calendar: { events: 1, overlaps: 0, titles: ["A"] } };
    expect(combineDigests(old, { date }).calendar).toEqual(old.calendar);
  });
});
