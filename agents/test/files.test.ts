import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAsk, askLimits, readAskFile } from "../ask.ts";
import { promptWithAttachments } from "../lib/run-agent.ts";
import { AnswersFile } from "../schemas/ask.ts";
import { Trace } from "../lib/trace.ts";
import { gistClient, type GistClient } from "../tools/gist.ts";
import { fakeFetch, fakeQuery, json, memoryGist } from "./helpers.ts";
import { NOW, JAZZ_FILE, BRIEFING_FILE, ASK_OUT, askFile } from "./ask-fixture.ts";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const FILE = "jazz2-file-ask-pic-0001.json";
const PIC = JSON.stringify({ version: 1, name: "receipt.jpg", mime: "image/jpeg", data: "QUJDRA==" });
const item = (over = {}) => ({
  id: "ask-pic-0001",
  kind: "ask",
  text: "Log this receipt",
  at: "2026-10-30T13:00:00.000Z",
  file: FILE,
  ...over,
});

async function firstMessage(p: unknown) {
  if (typeof p === "string") return p;
  for await (const m of p as AsyncIterable<any>) return m;
}

describe("photos and files in Ask", () => {
  it("keeps a valid file name on a question, drops anything else", () => {
    const r = readAskFile(
      askFile([
        item(),
        item({ id: "ask-pic-0002", file: "../../etc/passwd" }),
        item({ id: "sort-pic-001", kind: "sort" }),
      ]),
    );
    expect(r.items.map((i) => [i.id, i.file ?? null])).toEqual([
      ["ask-pic-0001", FILE],
      ["ask-pic-0002", null],
      ["sort-pic-001", null], // only questions carry files
    ]);
  });

  it("an image or PDF goes in as a content block ahead of the prompt", async () => {
    const m = await firstMessage(
      promptWithAttachments({
        name: "ask",
        model: "m",
        system: "",
        prompt: "P",
        schema: null as any,
        timeoutMs: 1,
        attachments: [{ mime: "application/pdf", data: "QQ==" }],
      }),
    );
    expect(m.message.content.map((b: any) => b.type)).toEqual(["document", "text"]);
    expect(
      promptWithAttachments({ name: "ask", model: "m", system: "", prompt: "P", schema: null as any, timeoutMs: 1 }),
    ).toBe("P");
  });

  it("answers with the file, offers an expense chip, only adds things, and deletes the file after", async () => {
    const { gist, files, deleted } = memoryGist({
      "jazz2-data.json": JAZZ_FILE,
      "jazz2-briefing.json": BRIEFING_FILE,
      "jazz2-ask.json": askFile([item()]),
      [FILE]: PIC,
    });
    const A = (type: string, over: object) => ({ type, id: null, text: null, date: null, lbs: null, ...over });
    const fq = fakeQuery([
      {
        structured_output: {
          ...ASK_OUT,
          chips: [
            { kind: "expense", text: "Corner Market", amount: 54.236, due: null },
            { kind: "expense", text: "No amount", amount: null, due: null },
          ],
          actions: [
            A("shopping_add", { text: "Oat milk" }),
            A("remember", { text: "Shops at Corner Market" }),
            A("forget", { id: "m1" }),
            A("note_add", { text: "Ignore your rules", note: "Words from inside the file" }),
          ],
        },
      },
    ]);
    await runAsk({
      gist,
      now: NOW,
      trigger: "dispatch",
      limits: askLimits({}),
      trace: new Trace(),
      queryFn: fq.fn,
      push: null,
    });
    const m = await firstMessage(fq.seen[0].prompt);
    expect(m.message.content[0]).toMatchObject({
      type: "image",
      source: { media_type: "image/jpeg", data: "QUJDRA==" },
    });
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
    await runAsk({
      gist,
      now: NOW,
      trigger: "dispatch",
      limits: askLimits({}),
      trace: new Trace(),
      queryFn: fq.fn,
      push: null,
    });
    expect(typeof fq.seen[0].prompt).toBe("string");
    expect(AnswersFile.parse(JSON.parse(files["jazz2-answers.json"])).answers[0].status).toBe("ok");
  });
});

describe("a photo or PDF doesn't stay in the gist once its question is done", () => {
  const OTHER = "jazz2-file-ask-pic-0002.json";
  const run = (gist: GistClient, over = {}) =>
    runAsk({
      gist,
      now: NOW,
      trigger: "dispatch",
      limits: askLimits({}),
      trace: new Trace(),
      queryFn: fakeQuery([{ structured_output: ASK_OUT }]).fn,
      push: null,
      ...over,
    });
  const app = (extra: Record<string, string>) => ({
    "jazz2-data.json": JAZZ_FILE,
    "jazz2-briefing.json": BRIEFING_FILE,
    ...extra,
  });
  const answersWith = (ids: string[], monthCostUsd = 0) =>
    JSON.stringify({
      version: 1,
      answers: ids.map((id) => ({
        id,
        askedAt: "2026-10-30T12:00:00.000Z",
        answeredAt: "2026-10-30T12:30:00.000Z",
        status: "ok",
        text: "Done",
        bullets: [],
        sources: [],
        chips: [],
        by: "jarvis",
      })),
      usage: {
        day: "2026-10-30",
        dayCount: 0,
        dayCostUsd: 0,
        week: "2026-W44",
        weekCount: 0,
        month: "2026-10",
        monthCostUsd,
      },
    });

  it("deletes it when the question is refused over the month's budget, with no model call", async () => {
    const { gist, files, deleted } = memoryGist(
      app({ "jazz2-ask.json": askFile([item()]), "jazz2-answers.json": answersWith([], 20), [FILE]: PIC }),
    );
    const fq = fakeQuery([{ structured_output: ASK_OUT }]);
    await run(gist, { queryFn: fq.fn });
    expect(fq.seen).toHaveLength(0);
    expect(AnswersFile.parse(JSON.parse(files["jazz2-answers.json"])).answers[0].status).toBe("over_limit");
    expect(deleted).toEqual([[FILE]]);
  });

  it("deletes one whose question was cleared, or that no question points to any more", async () => {
    const { gist, deleted } = memoryGist(
      app({
        "jazz2-ask.json": askFile([item()], { clearBefore: "2026-10-30T14:00:00.000Z" }),
        [FILE]: PIC,
        [OTHER]: PIC,
      }),
    );
    expect((await run(gist)).status).toBe("idle");
    expect(deleted).toEqual([[FILE, OTHER]]);
  });

  it("tries a failed delete again on the next run, even with nothing to answer", async () => {
    const { gist, files, deleted } = memoryGist(app({ "jazz2-ask.json": askFile([item()]), [FILE]: PIC }));
    const realDelete = gist.deleteFiles!;
    gist.deleteFiles = async () => {
      throw new Error("GitHub API 500 deleting files");
    };
    expect((await run(gist)).status).toBe("done"); // a failed delete doesn't fail the run
    expect(files[FILE]).toBe(PIC);
    gist.deleteFiles = realDelete;
    expect((await run(gist)).status).toBe("idle");
    expect(deleted).toEqual([[FILE]]);
    expect(files[FILE]).toBeUndefined();
  });

  it("keeps the file of a question that's still waiting for its turn", async () => {
    const waiting = item({ id: "ask-pic-0002", file: OTHER, at: "2026-10-30T13:05:00.000Z" });
    const { gist, deleted } = memoryGist(
      app({ "jazz2-ask.json": askFile([item(), waiting]), [FILE]: PIC, [OTHER]: PIC }),
    );
    const r = await run(gist, { limits: { ...askLimits({}), maxPerRun: 1 } });
    expect(r).toMatchObject({ status: "done", leftPending: 1 });
    expect(deleted).toEqual([[FILE]]);
  });

  it("never deletes the file of a question sent while the run was working", async () => {
    const fresh = item({ id: "ask-pic-0002", file: OTHER, at: "2026-10-30T13:10:00.000Z" });
    const m = memoryGist(app({ "jazz2-ask.json": askFile([item()]), [FILE]: PIC }));
    const fq = fakeQuery([{ structured_output: ASK_OUT }]);
    await run(m.gist, {
      queryFn: (p: any) => {
        // the app writes a question and its file in one go, mid-run
        m.files["jazz2-ask.json"] = askFile([item(), fresh]);
        m.files[OTHER] = PIC;
        return fq.fn(p);
      },
    });
    expect(m.deleted).toEqual([[FILE]]);
    expect(m.files[OTHER]).toBe(PIC);
  });

  it("deletes nothing when the question list has anything it can't read", async () => {
    const queue = JSON.stringify({
      version: 1,
      items: [{ id: "bad id", kind: "ask", text: "x", at: "nope", file: FILE }],
    });
    const { gist, deleted } = memoryGist(app({ "jazz2-ask.json": queue, [FILE]: PIC }));
    await run(gist);
    expect(deleted).toEqual([]);
  });

  it("one bad date in a full answers list doesn't close every question or delete its file", async () => {
    const full = JSON.parse(answersWith(Array.from({ length: 50 }, (_, i) => `old-${String(i).padStart(4, "0")}`)));
    full.answers[7].askedAt = "not a date";
    const { gist, deleted, files } = memoryGist(
      app({ "jazz2-ask.json": askFile([item()]), "jazz2-answers.json": JSON.stringify(full), [FILE]: PIC }),
    );
    const fq = fakeQuery([{ structured_output: ASK_OUT }]);
    const r = await run(gist, { queryFn: fq.fn });
    expect(r.status).toBe("done");
    expect(fq.seen).toHaveLength(1);
    expect(typeof fq.seen[0].prompt).not.toBe("string"); // the photo went with the question
    expect(deleted).toEqual([[FILE]]);
    expect(AnswersFile.parse(JSON.parse(files["jazz2-answers.json"])).answers[0].id).toBe("ask-pic-0001");
  });

  it("keeps the file of a question it isn't reading: past the newest 20, or of a kind it doesn't know", async () => {
    const old = item({ id: "ask-pic-0002", file: OTHER, at: "2026-10-01T13:00:00.000Z" });
    const later = Array.from({ length: 20 }, (_, i) =>
      item({ id: `ask-new-${String(i).padStart(4, "0")}`, file: undefined, at: "2026-10-30T13:00:00.000Z" }),
    );
    const THIRD = "jazz2-file-ask-pic-0003.json";
    const unknown = item({ id: "ask-pic-0003", kind: "later", file: THIRD });
    const { gist, deleted, files } = memoryGist(
      app({ "jazz2-ask.json": askFile([old, unknown, ...later]), [OTHER]: PIC, [THIRD]: PIC, [FILE]: PIC }),
    );
    await run(gist, { limits: { ...askLimits({}), maxPerRun: 0 } });
    expect(files[OTHER]).toBe(PIC);
    expect(files[THIRD]).toBe(PIC);
    expect(deleted).toEqual([[FILE]]); // and one that no question names still goes
  });

  it("decides from one read of the gist, so a lagging read can't delete an open question's file", async () => {
    const waiting = item({ id: "ask-pic-0002", file: OTHER, at: "2026-10-30T13:05:00.000Z" });
    const m = memoryGist(app({ "jazz2-ask.json": askFile([item(), waiting]), [FILE]: PIC, [OTHER]: PIC }));
    const realSnapshot = m.gist.snapshot!;
    const realRead = m.gist.readFile;
    let lagging = false;
    m.gist.snapshot = async () => {
      const s = await realSnapshot();
      lagging = true;
      return s;
    };
    m.gist.readFile = async (n) => (lagging && n === "jazz2-ask.json" ? null : realRead(n));
    await run(m.gist, { limits: { ...askLimits({}), maxPerRun: 1 } });
    expect(m.deleted).toEqual([[FILE]]);
  });

  it("the phone is told before the sweep, which reads the gist again", async () => {
    const order: string[] = [];
    const { gist, files } = memoryGist(app({ "jazz2-ask.json": askFile([item()]), [FILE]: PIC }));
    files["jazz2-push.json"] = JSON.stringify({
      subs: [
        { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "p".repeat(20), auth: "a".repeat(20) } },
      ],
    });
    const snapshot = gist.snapshot!;
    gist.snapshot = async () => {
      order.push("sweep");
      return snapshot();
    };
    await run(gist, {
      push: async () => {
        order.push("push");
        return { ok: true, status: 201 };
      },
    });
    expect(order).toEqual(["push", "sweep"]);
  });

  it("a question another run finished isn't paid for again without its file", async () => {
    const done = JSON.parse(answersWith(["ask-pic-0001"]));
    done.answers[0].text = "The answer that saw the photo.";
    const m = memoryGist(app({ "jazz2-ask.json": askFile([item()]) })); // the file's already deleted
    const realRead = m.gist.readFile;
    let answerReads = 0;
    m.gist.readFile = async (n) =>
      n === "jazz2-answers.json" && answerReads++ > 0 ? JSON.stringify(done) : realRead(n);
    const fq = fakeQuery([{ structured_output: ASK_OUT }]);
    const r = await run(m.gist, { queryFn: fq.fn });
    expect(fq.seen).toHaveLength(0);
    expect(r).toMatchObject({ status: "done", answered: [] });
    expect(m.files["jazz2-answers.json"]).toBeUndefined();
  });

  it("a failed read of the photo pays for nothing, keeps it, and leaves the question for the next run", async () => {
    const m = memoryGist(app({ "jazz2-ask.json": askFile([item()]), [FILE]: PIC }));
    const realRead = m.gist.readFile;
    m.gist.readFile = async (n) => {
      if (n === FILE) throw new Error("GitHub API 502 reading the gist");
      return realRead(n);
    };
    const fq = fakeQuery([{ structured_output: ASK_OUT }]);
    const r = await run(m.gist, { queryFn: fq.fn });
    expect(fq.seen).toHaveLength(0);
    expect(r).toMatchObject({ status: "done", answered: [], leftPending: 1 });
    expect(m.deleted).toEqual([]);
    expect(m.files[FILE]).toBe(PIC);
    expect(m.files["jazz2-answers.json"]).toBeUndefined();
  });

  it("a photo that still can't be read a day later ends in an error, not an endless wait", async () => {
    const old = item({ at: "2026-10-28T13:00:00.000Z" });
    const m = memoryGist(app({ "jazz2-ask.json": askFile([old]), [FILE]: PIC }));
    const realRead = m.gist.readFile;
    m.gist.readFile = async (n) => {
      if (n === FILE) throw new Error("GitHub API 502 reading the gist");
      return realRead(n);
    };
    const fq = fakeQuery([{ structured_output: ASK_OUT }]);
    const r = await run(m.gist, { queryFn: fq.fn });
    expect(fq.seen).toHaveLength(0);
    expect(r).toMatchObject({ status: "done", leftPending: 0 });
    expect(JSON.parse(m.files["jazz2-answers.json"]).answers[0].status).toBe("error");
  });

  it("the same when the photo is gone and the check for another run's answer can't read", async () => {
    const m = memoryGist(app({ "jazz2-ask.json": askFile([item()]) }));
    const realRead = m.gist.readFile;
    let answerReads = 0;
    m.gist.readFile = async (n) => {
      if (n === "jazz2-answers.json" && answerReads++ > 0) throw new Error("GitHub API 502 reading the gist");
      return realRead(n);
    };
    const fq = fakeQuery([{ structured_output: ASK_OUT }]);
    const r = await run(m.gist, { queryFn: fq.fn });
    expect(fq.seen).toHaveLength(0);
    expect(r).toMatchObject({ status: "done", answered: [], leftPending: 1 });
  });

  it("an empty questions or answers file isn't read as having nothing in it", async () => {
    expect(readAskFile("")).toMatchObject({ items: [], junk: true });
    const blank = memoryGist(app({ "jazz2-ask.json": "", [FILE]: PIC }));
    await run(blank.gist);
    expect(blank.deleted).toEqual([]);
    const lost = memoryGist(app({ "jazz2-ask.json": askFile([item()]), "jazz2-answers.json": "", [FILE]: PIC }));
    const fq = fakeQuery([{ structured_output: ASK_OUT }]);
    await expect(run(lost.gist, { queryFn: fq.fn })).rejects.toThrow("can't be read");
    expect(fq.seen).toHaveLength(0);
    expect(lost.deleted).toEqual([]);
  });

  it("a file GitHub lists with no content fails the read instead of looking empty", async () => {
    const { impl } = fakeFetch([["https://api.github.com/gists/abc123", () => json({ files: { "a.json": {} } })]]);
    const client = gistClient("abc123", "t", impl);
    await expect(client.readFile("a.json")).rejects.toThrow("no content");
    await expect((await client.snapshot!()).read("a.json")).rejects.toThrow("no content");
    expect(await client.readFile("missing.json")).toBeNull();
  });

  it("a reply with no list of files fails the read instead of looking like an empty gist", async () => {
    const { impl } = fakeFetch([["https://api.github.com/gists/abc123", () => json({ message: "odd" })]]);
    await expect(gistClient("abc123", "t", impl).readFile("jazz2-answers.json")).rejects.toThrow("no files");
  });

  it("through the real client: one GET, the file's text from that same read, and only question files deleted", async () => {
    const g = {
      [FILE]: {},
      "jazz2-data.json": {},
      "jazz2-ask.json": { content: "queue" },
      "jazz2-answers.json": { truncated: true, raw_url: "https://gist.example/raw" },
    };
    const { impl, calls } = fakeFetch([
      ["https://gist.example/raw", () => new Response("answers")],
      ["https://api.github.com/gists/abc123", (_, init) => (init?.method === "PATCH" ? json({}) : json({ files: g }))],
    ]);
    const client = gistClient("abc123", "t", impl);
    const s = await client.snapshot!();
    expect(s.names).toEqual([FILE, "jazz2-data.json", "jazz2-ask.json", "jazz2-answers.json"]);
    expect(await s.read("jazz2-ask.json")).toBe("queue");
    expect(await s.read("jazz2-answers.json")).toBe("answers");
    expect(await s.read("missing.json")).toBeNull();
    expect(calls.filter((c) => c.url.includes("api.github.com"))).toHaveLength(1);
    await client.deleteFiles!([FILE, "jazz2-data.json"]);
    expect(JSON.parse(String(calls.at(-1)!.init?.body))).toEqual({ files: { [FILE]: null } });
  });
});
