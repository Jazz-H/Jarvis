// Option B: the morning briefing and the Sunday review answer questions still waiting in
// jazz2-ask.json after their own work, under the same limits, and never fail because of it.
// Plus checks on .github/workflows/jarvis-ask.yml (the repo is public).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { runBriefing, type Subagents } from "../jarvis.ts";
import { runReview } from "../review.ts";
import { askLimits } from "../ask.ts";
import { AnswersFile } from "../schemas/ask.ts";
import { Trace } from "../lib/trace.ts";
import type { GistClient } from "../tools/gist.ts";
import { FACTS, CANDIDATE } from "./fixtures.ts";
import { FIXTURE, DIGESTS } from "./week-fixture.ts";
import { fakeQuery, memoryGist } from "./helpers.ts";
import { ASK_OUT, JAZZ_FILE, SUB, askFile, q } from "./ask-fixture.ts";

const noNet = (() => {
  throw new Error("no network in tests");
}) as any;
const answers = (f: Record<string, string>) => AnswersFile.parse(JSON.parse(f["jazz2-answers.json"]));

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("Ask fallback in the morning briefing", () => {
  const NOW = new Date("2026-10-30T10:50:00Z"); // 6:50am EDT
  const subagents: Subagents = {
    weather: async () => ({ ...FACTS, date: "2026-10-30", summary: "Light rain by noon.", wear: "Jacket.", washDayNote: null }),
    news: async () => ({ stories: [{ ...CANDIDATE, summary: "A model did well." }] }),
  };
  const BRIEF_OUT = { headline: "Rain by noon", summary: [{ text: "Rent is due Nov 1.", source: "jazz" }] };

  it("answers queued questions after the briefing, with this morning's cards as context", async () => {
    const g = memoryGist({
      "jazz2-data.json": JAZZ_FILE,
      "jazz2-ask.json": askFile([q("ask-0001", "What's due before payday?", "2026-10-30T02:00:00.000Z")]),
      "jazz2-push.json": JSON.stringify({ subs: [SUB] }),
    });
    const fq = fakeQuery([{ structured_output: BRIEF_OUT }, { structured_output: ASK_OUT }]);
    const sent: string[] = [];
    const r = await runBriefing({
      now: NOW,
      trigger: "schedule",
      gist: g.gist,
      fetchImpl: noNet,
      maxRunCostUsd: 0.5,
      trace: new Trace(),
      queryFn: fq.fn,
      subagents,
      push: async (_s, p) => void sent.push(p),
      ask: askLimits({}),
    });
    expect(r.status).toBe("delivered");
    expect(fq.seen).toHaveLength(2);
    expect(fq.seen[1].prompt).toContain("Light rain by noon."); // the briefing it just wrote
    expect(g.writes.map(([n]) => n)).toEqual(["jazz2-briefing.json", "jazz2-answers.json"]);
    expect(answers(g.files)).toMatchObject({ answers: [{ id: "ask-0001", status: "ok" }], usage: { dayCount: 1 } });
    expect(sent.map((p) => JSON.parse(p).tag)).toEqual(["briefing", "bill", "ask"]); // the Ask push comes last
  });

  it("the briefing is still delivered when answering fails, and Ask is off without limits", async () => {
    const { files: f } = memoryGist({ "jazz2-data.json": JAZZ_FILE, "jazz2-ask.json": askFile([q("ask-0001", "Hi?", "2026-10-30T02:00:00.000Z")]) });
    const writes: string[] = [];
    const flaky: GistClient = {
      readFile: async (n) => {
        if (n === "jazz2-answers.json") throw new Error("GitHub API 502 reading the gist");
        return f[n] ?? null;
      },
      writeFile: async (n, c) => {
        writes.push(n);
        f[n] = c;
      },
    };
    const trace = new Trace();
    const base = { now: NOW, trigger: "schedule" as const, fetchImpl: noNet, maxRunCostUsd: 0.5, subagents };
    const r = await runBriefing({ ...base, gist: flaky, trace, queryFn: fakeQuery([{ structured_output: BRIEF_OUT }]).fn, ask: askLimits({}) });
    expect(r.status).toBe("delivered");
    expect(writes).not.toContain("jazz2-answers.json");
    expect(trace.events.map((e) => e.event)).toContain("pending questions not answered");

    const g = memoryGist({ "jazz2-data.json": JAZZ_FILE, "jazz2-ask.json": askFile([q("ask-0001", "Hi?", "2026-10-30T02:00:00.000Z")]) });
    const fq = fakeQuery([{ structured_output: BRIEF_OUT }]);
    await runBriefing({ ...base, now: new Date("2026-10-30T10:51:00Z"), gist: g.gist, trace: new Trace(), queryFn: fq.fn });
    expect(fq.seen).toHaveLength(1);
    expect(g.files["jazz2-answers.json"]).toBeUndefined();
  });
});

describe("Ask fallback in the Sunday review", () => {
  const NOW = new Date("2026-11-01T22:50:00Z"); // Sunday 5:50pm EST
  const REVIEW_OUT = {
    headline: "A steady week",
    wins: [{ text: "Routine done 5 of 7 days.", stat: "routine" }],
    slips: [],
    focus: [],
    suggestions: [],
  };

  it("answers queued questions after the review, with the new review as context", async () => {
    const g = memoryGist({
      "jazz2-data.json": JSON.stringify({ updatedAt: 1, data: FIXTURE }),
      "jazz2-week.json": JSON.stringify({ version: 1, days: DIGESTS }),
      "jazz2-ask.json": askFile([q("ask-0001", "How did my week go?", "2026-11-01T20:00:00.000Z")]),
      "jazz2-answers.json": JSON.stringify({
        version: 1,
        answers: [],
        usage: { day: "2026-11-01", dayCount: 10, dayCostUsd: 0.5, week: "2026-W44", weekCount: 10, month: "2026-11", monthCostUsd: 0.5 },
      }),
    });
    // a day already at its 10 questions: same limits apply in the fallback
    const fq = fakeQuery([{ structured_output: REVIEW_OUT }, { structured_output: ASK_OUT }]);
    const r = await runReview({ now: NOW, trigger: "schedule", gist: g.gist, fetchImpl: noNet, maxRunCostUsd: 0.5, trace: new Trace(), queryFn: fq.fn, ask: askLimits({}) });
    expect(r.status).toBe("delivered");
    expect(fq.seen).toHaveLength(1);
    expect(answers(g.files).answers[0]).toMatchObject({ id: "ask-0001", status: "over_limit" });

    // a new day: answered, effort medium, with the review it just wrote
    g.files["jazz2-ask.json"] = askFile([q("ask-0002", "How did my week go?", "2026-11-02T20:00:00.000Z")]);
    const fq2 = fakeQuery([{ structured_output: REVIEW_OUT }, { structured_output: ASK_OUT }]);
    const monday = new Date("2026-11-02T21:00:00Z");
    await runReview({ now: monday, trigger: "manual", gist: g.gist, fetchImpl: noNet, maxRunCostUsd: 0.5, trace: new Trace(), queryFn: fq2.fn, ask: askLimits({}) });
    expect(fq2.seen).toHaveLength(2);
    expect(fq2.seen[1].options!.effort).toBe("medium");
    expect(fq2.seen[1].prompt).toContain("A steady week");
    expect(answers(g.files).answers.map((a) => [a.id, a.status])).toEqual([
      ["ask-0002", "ok"],
      ["ask-0001", "over_limit"],
    ]);
  });
});

describe("jarvis-ask.yml", () => {
  const yml = readFileSync(new URL("../../.github/workflows/jarvis-ask.yml", import.meta.url), "utf8");
  const code = yml
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

  it("is dispatch-only with one string input, id, checked against the id pattern", () => {
    expect(code).toMatch(/on:\s*\n\s*workflow_dispatch:\s*\n\s*inputs:\s*\n\s*id:\s*\n/);
    expect(code).not.toMatch(/\bschedule:|\bpush:|pull_request/);
    expect(code).toMatch(/type: string/);
    // the input is used exactly once, as an env var for the check (never inline in a script)
    expect(code.match(/\$\{\{\s*(inputs|github\.event\.inputs)\./g)).toHaveLength(1);
    expect(code).toMatch(/ASK_ID: \$\{\{ inputs\.id \}\}/);
    expect(code).toContain('if [[ ! "$ASK_ID" =~ ^[a-z0-9-]{8,40}$ ]]; then');
    expect(code).toMatch(/exit 1/);
    // never echoed or passed on
    expect(code.match(/\$ASK_ID/g)).toHaveLength(1);
  });

  it("has no run-name, one run at a time without cancelling, and a 6-minute timeout", () => {
    expect(code).not.toMatch(/run-name/);
    expect(code).toMatch(/concurrency:\s*\n\s*group: jarvis-ask\s*\n\s*cancel-in-progress: false/);
    expect(code).toMatch(/timeout-minutes: 6\b/);
    expect(code).toMatch(/permissions:\s*\n\s*contents: read/);
  });

  it("exits before npm ci when nothing is pending", () => {
    const check = code.indexOf("- name: Anything pending?");
    const install = code.indexOf("npm ci");
    expect(check).toBeGreaterThan(code.indexOf("- name: Check the question id"));
    expect(check).toBeLessThan(install);
    expect(code.slice(check, code.indexOf("- uses: actions/checkout"))).toMatch(/curl[\s\S]*jq[\s\S]*GITHUB_OUTPUT/);
    // every step after the check is gated on it
    const after = code.slice(code.indexOf("- uses: actions/checkout"));
    const steps = after.split(/\n      - /).length;
    expect(after.match(/if: (always\(\) && )?steps\.pending\.outputs\.work == 'yes'/g)).toHaveLength(steps);
    expect(code).toMatch(/run: npm run ask/);
  });

  it("uses only the four secrets Ask needs, and an artifact name without inputs", () => {
    const secrets = new Set([...code.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]));
    expect([...secrets].sort()).toEqual(["ANTHROPIC_API_KEY", "JARVIS_GIST_ID", "JARVIS_GIST_TOKEN", "VAPID_PRIVATE_KEY"]);
    expect(code).toMatch(/name: jarvis-ask-trace-\$\{\{ github\.run_id \}\}/);
    expect(code).toMatch(/path: agents\/out\//);
  });

  it("jarvis.yml passes the Ask limits to the briefing and review jobs (fallback B)", () => {
    const main = readFileSync(new URL("../../.github/workflows/jarvis.yml", import.meta.url), "utf8");
    expect(main.match(/MAX_ASK_COST_USD: \$\{\{ vars\.MAX_ASK_COST_USD \}\}/g)).toHaveLength(2);
    expect(main.match(/ASK_MONTHLY_BUDGET_USD: \$\{\{ vars\.ASK_MONTHLY_BUDGET_USD \}\}/g)).toHaveLength(2);
  });
});
