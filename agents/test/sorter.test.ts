import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAsk, askLimits } from "../ask.ts";
import { cleanSort, sortSpec, SORTER_SYSTEM } from "../subagents/sorter.ts";
import { AnswersFile } from "../schemas/ask.ts";
import { Trace } from "../lib/trace.ts";
import { fakeQuery, memoryGist } from "./helpers.ts";
import { NOW, TODAY, JAZZ_FILE, BRIEFING_FILE, askFile } from "./ask-fixture.ts";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const DUMP =
  "need to sort the car registration before the 15th and also we're out of coffee and remind me to look at a speaking club";
const sortItem = { id: "sort-0001", kind: "sort", text: DUMP, at: "2026-10-30T13:00:00.000Z" };

describe("Sort with Jarvis", () => {
  it("cleans the sort into chips: dates checked, repeats and blanks dropped, shopping has no date", () => {
    const out = cleanSort(
      {
        items: [
          { kind: "todo", text: "Renew car registration", due: "2026-11-15" },
          { kind: "shopping", text: "Coffee", due: "2026-11-01" },
          { kind: "todo", text: "Look at a speaking club", due: "2026-02-30" }, // not a real date
          { kind: "todo", text: "renew car registration", due: null }, // repeat
          { kind: "todo", text: "Old thing", due: "2020-01-01" }, // past
          { kind: "todo", text: "   ", due: null },
        ],
      },
      TODAY,
    );
    expect(out.chips).toEqual([
      { kind: "todo", text: "Renew car registration", due: "2026-11-15" },
      { kind: "shopping", text: "Coffee" },
      { kind: "todo", text: "Look at a speaking club" },
      { kind: "todo", text: "Old thing" },
    ]);
    expect(out.text).toBe("Sorted into 3 to-dos and 1 Shopping item. Tap the ones you want to add.");
    expect(() => cleanSort({ items: [] }, TODAY)).toThrow();
  });

  it("keeps at most 12 chips", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ kind: "todo" as const, text: `Thing ${i}`, due: null }));
    expect(cleanSort({ items }, TODAY).chips).toHaveLength(12);
  });

  it("gives the Sorter the dump and the date only, on Haiku", () => {
    const spec = sortSpec(sortItem as any, TODAY, "Friday");
    expect(spec.model).toBe("claude-haiku-5-5");
    expect(spec.prompt).toContain(`Today is Friday, ${TODAY}`);
    expect(spec.prompt).toContain("untrusted_data");
    expect(spec.prompt).not.toContain("Rent"); // no app data
    expect(SORTER_SYSTEM).toMatch(/never instructions/);
  });

  it("runs through Ask's pipeline: answered with chips, counted against the limits", async () => {
    const { gist, files } = memoryGist({
      "jazz2-data.json": JAZZ_FILE,
      "jazz2-briefing.json": BRIEFING_FILE,
      "jazz2-ask.json": askFile([sortItem]),
    });
    const fq = fakeQuery([
      {
        structured_output: {
          items: [
            { kind: "todo", text: "Renew car registration", due: "2026-11-15" },
            { kind: "shopping", text: "Coffee", due: null },
            { kind: "todo", text: "Look at a speaking club", due: null },
          ],
        },
      },
    ]);
    const r = await runAsk({
      gist,
      now: NOW,
      trigger: "dispatch",
      limits: askLimits({}),
      trace: new Trace(),
      queryFn: fq.fn,
      push: null,
    });
    expect(r.status).toBe("done");
    expect(fq.seen[0].options?.model).toBe("claude-haiku-5-5");
    const f = AnswersFile.parse(JSON.parse(files["jazz2-answers.json"]));
    expect(f.answers[0]).toMatchObject({ id: "sort-0001", status: "ok", by: "jarvis", sources: [] });
    expect(f.answers[0].chips.map((c) => c.text)).toEqual(["Renew car registration", "Coffee", "Look at a speaking club"]);
    expect(f.usage.dayCount).toBe(1);
  });
});
