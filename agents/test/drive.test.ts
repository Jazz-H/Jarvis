import { describe, it, expect, vi, beforeEach } from "vitest";
import { driveClient, driveQuery, DRIVE_READ_MAX } from "../tools/drive.ts";
import { runAsk, askLimits, askSpec, cleanAskOutput } from "../ask.ts";
import { agentOptions } from "../lib/run-agent.ts";
import { DRIVE_TOOLS } from "../lib/drive-tools.ts";
import { type AskOutput } from "../schemas/ask.ts";
import { buildAskContext } from "../lib/ask-context.ts";
import { Trace } from "../lib/trace.ts";
import { fakeFetch, fakeQuery, memoryGist, json, text } from "./helpers.ts";
import { NOW, TODAY, JAZZ_FILE, BRIEFING_FILE, ASK_OUT, askFile, q } from "./ask-fixture.ts";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("Google Drive (read-only)", () => {
  it("builds a safe Drive query: words quoted and escaped, trashed files left out", () => {
    expect(driveQuery("lease  o'neil\\x")).toBe(
      "(name contains 'lease' or fullText contains 'lease') and (name contains 'o\\'neil\\\\x' or fullText contains 'o\\'neil\\\\x') and trashed = false",
    );
  });

  it("searches, and reads Docs as text and Sheets as CSV; PDFs aren't read", async () => {
    const f = fakeFetch([
      [
        /\/files\?/,
        () =>
          json({
            files: [
              {
                id: "doc1234567890",
                name: "Lease",
                mimeType: "application/vnd.google-apps.document",
                modifiedTime: "2026-10-01T00:00:00Z",
                webViewLink: "https://docs.google.com/d/1",
              },
              { id: "bad id", name: "x" },
            ],
          }),
      ],
      [/\/files\/doc1234567890\/export\?mimeType=text%2Fplain/, () => text("Rent is $1450.\u0000")],
      [
        /\/files\/doc1234567890\?fields/,
        () => json({ name: "Lease", mimeType: "application/vnd.google-apps.document" }),
      ],
      [
        /\/files\/sheet123456789\?fields/,
        () => json({ name: "Budget", mimeType: "application/vnd.google-apps.spreadsheet" }),
      ],
      [/\/files\/sheet123456789\/export\?mimeType=text%2Fcsv/, () => text("a,b\n" + "x".repeat(DRIVE_READ_MAX + 10))],
      [/\/files\/pdf12345678901\?fields/, () => json({ name: "Scan", mimeType: "application/pdf" })],
    ]);
    const d = driveClient("tok", f.impl);
    expect(await d.search("lease")).toEqual([
      { id: "doc1234567890", name: "Lease", type: "doc", modified: "2026-10-01", link: "https://docs.google.com/d/1" },
    ]);
    expect(await d.read("doc1234567890")).toEqual({ name: "Lease", text: "Rent is $1450. ", truncated: false });
    const sheet = await d.read("sheet123456789");
    expect([sheet.text.length, sheet.truncated]).toEqual([DRIVE_READ_MAX, true]);
    await expect(d.read("pdf12345678901")).rejects.toThrow(/📎/);
    expect(f.calls.every((c) => (c.init?.headers as any).Authorization === "Bearer tok")).toBe(true);
  });

  it("without the Drive permission it says to reconnect", async () => {
    const d = driveClient("tok", fakeFetch([[/files/, () => json({}, 403)]]).impl);
    await expect(d.search("x")).rejects.toThrow(/redo the Google sign-in/);
  });

  it("Ask gets the two Drive tools only when Drive is connected", () => {
    const ctx = buildAskContext({
      data: JSON.parse(JAZZ_FILE).data,
      today: TODAY,
      briefingRaw: BRIEFING_FILE,
      reviewsRaw: null,
    });
    const item = {
      id: "ask-drv-0001",
      kind: "ask" as const,
      text: "What does my lease say?",
      at: "2026-10-30T13:00:00Z",
    };
    const off = agentOptions(askSpec(item, ctx, [], NOW), 0.1, new AbortController());
    expect(off.allowedTools).toEqual(["WebSearch"]);
    expect(off.mcpServers).toEqual({});
    const on = agentOptions(
      askSpec(item, ctx, [], NOW, async () => driveClient("t")),
      0.1,
      new AbortController(),
    );
    expect(on.allowedTools).toEqual(["WebSearch", ...DRIVE_TOOLS]);
    expect(Object.keys(on.mcpServers!)).toEqual(["drive"]);
    expect(on.tools).toEqual(["WebSearch"]); // no other built-in tools
  });

  it("an answer that read Drive keeps its file links and the Drive tag, but can't act", () => {
    const out = {
      ...(ASK_OUT as AskOutput),
      sources: ["drive", "jazz"] as AskOutput["sources"],
      links: [{ title: "Lease", url: "https://docs.google.com/d/1" }],
      actions: [{ type: "todo_add" as const, id: null, text: "Renew lease", date: null, lbs: null }],
    };
    const t = {
      memory: new Map(),
      todos: new Map(),
      goals: new Map(),
      shopping: new Map(),
      workoutsToday: new Map(),
      packages: new Map(),
      lines: new Map(),
      notes: new Map(),
    };
    const a = cleanAskOutput(out, TODAY, ["jazz"], t, 0, false, 2);
    expect([a.sources, a.links, a.actions]).toEqual([
      ["drive", "jazz"],
      [{ title: "Lease", url: "https://docs.google.com/d/1" }],
      undefined,
    ]);
    const b = cleanAskOutput(out, TODAY, ["jazz"], t, 0, false, 0);
    expect([b.sources, b.links, b.actions?.length]).toEqual([["jazz"], undefined, 1]);
  });

  it("signs in to Google at most once per run, and only when a question uses Drive", async () => {
    let signIns = 0;
    const { gist } = memoryGist({
      "jazz2-data.json": JAZZ_FILE,
      "jazz2-briefing.json": BRIEFING_FILE,
      "jazz2-ask.json": askFile([q("ask-drv-0002", "hi", "2026-10-30T13:00:00.000Z")]),
    });
    await runAsk({
      gist,
      now: NOW,
      trigger: "dispatch",
      limits: askLimits({}),
      trace: new Trace(),
      queryFn: fakeQuery([{ structured_output: ASK_OUT }]).fn,
      push: null,
      drive: async () => (signIns++, driveClient("t")),
    });
    expect(signIns).toBe(0); // the model never called a Drive tool
  });
});
