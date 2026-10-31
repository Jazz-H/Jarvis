import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAsk, askLimits, readAskFile } from "../ask.ts";
import { promptWithAttachments } from "../lib/run-agent.ts";
import { AnswersFile } from "../schemas/ask.ts";
import { Trace } from "../lib/trace.ts";
import { fakeQuery, memoryGist } from "./helpers.ts";
import { NOW, JAZZ_FILE, BRIEFING_FILE, ASK_OUT, askFile } from "./ask-fixture.ts";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const FILE = "jazz2-file-ask-pic-0001.json";
const PIC = JSON.stringify({ version: 1, name: "receipt.jpg", mime: "image/jpeg", data: "QUJDRA==" });
const item = (over = {}) => ({ id: "ask-pic-0001", kind: "ask", text: "Log this receipt", at: "2026-10-30T13:00:00.000Z", file: FILE, ...over });

async function firstMessage(p: unknown) {
  if (typeof p === "string") return p;
  for await (const m of p as AsyncIterable<any>) return m;
}

describe("photos and files in Ask", () => {
  it("keeps a valid file name on a question, drops anything else", () => {
    const r = readAskFile(askFile([item(), item({ id: "ask-pic-0002", file: "../../etc/passwd" }), item({ id: "sort-pic-001", kind: "sort" })]));
    expect(r.items.map((i) => [i.id, i.file ?? null])).toEqual([
      ["ask-pic-0001", FILE],
      ["ask-pic-0002", null],
      ["sort-pic-001", null], // only questions carry files
    ]);
  });

  it("an image or PDF goes in as a content block ahead of the prompt", async () => {
    const m = await firstMessage(
      promptWithAttachments({ name: "ask", model: "m", system: "", prompt: "P", schema: null as any, timeoutMs: 1, attachments: [{ mime: "application/pdf", data: "QQ==" }] }),
    );
    expect(m.message.content.map((b: any) => b.type)).toEqual(["document", "text"]);
    expect(promptWithAttachments({ name: "ask", model: "m", system: "", prompt: "P", schema: null as any, timeoutMs: 1 })).toBe("P");
  });

  it("answers with the file, offers an expense chip, only adds things, and deletes the file after", async () => {
    const { gist, files } = memoryGist({
      "jazz2-data.json": JAZZ_FILE,
      "jazz2-briefing.json": BRIEFING_FILE,
      "jazz2-ask.json": askFile([item()]),
      [FILE]: PIC,
    });
    const deleted: string[][] = [];
    gist.deleteFiles = async (names) => void deleted.push(names);
    const A = (type: string, over: object) => ({ type, id: null, text: null, date: null, lbs: null, ...over });
    const fq = fakeQuery([
      {
        structured_output: {
          ...ASK_OUT,
          chips: [
            { kind: "expense", text: "Corner Market", amount: 54.236, due: null },
            { kind: "expense", text: "No amount", amount: null, due: null },
          ],
          actions: [A("shopping_add", { text: "Oat milk" }), A("remember", { text: "Shops at Corner Market" }), A("forget", { id: "m1" })],
        },
      },
    ]);
    await runAsk({ gist, now: NOW, trigger: "dispatch", limits: askLimits({}), trace: new Trace(), queryFn: fq.fn, push: null });
    const m = await firstMessage(fq.seen[0].prompt);
    expect(m.message.content[0]).toMatchObject({ type: "image", source: { media_type: "image/jpeg", data: "QUJDRA==" } });
    const a = AnswersFile.parse(JSON.parse(files["jazz2-answers.json"])).answers[0];
    expect(a.chips).toEqual([{ kind: "expense", text: "Corner Market", amount: 54.24 }]);
    expect(a.actions?.map((x) => x.type)).toEqual(["shopping_add", "remember"]);
    expect(deleted).toEqual([[FILE]]);
  });

  it("a missing or bad file is skipped: the question is still answered, as plain text", async () => {
    const { gist, files } = memoryGist({
      "jazz2-data.json": JAZZ_FILE,
      "jazz2-briefing.json": BRIEFING_FILE,
      "jazz2-ask.json": askFile([item()]),
      [FILE]: JSON.stringify({ version: 1, name: "x", mime: "text/html", data: "PHNjcmlwdD4=" }),
    });
    const fq = fakeQuery([{ structured_output: ASK_OUT }]);
    await runAsk({ gist, now: NOW, trigger: "dispatch", limits: askLimits({}), trace: new Trace(), queryFn: fq.fn, push: null });
    expect(typeof fq.seen[0].prompt).toBe("string");
    expect(AnswersFile.parse(JSON.parse(files["jazz2-answers.json"])).answers[0].status).toBe("ok");
  });
});
