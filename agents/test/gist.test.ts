import { describe, it, expect } from "vitest";
import { gistClient } from "../tools/gist.ts";
import { fakeFetch, json, text } from "./helpers.ts";

const API = "https://api.github.com/gists/abc123";

describe("gist tool", () => {
  it("rejects ids that aren't gist ids", () => {
    expect(() => gistClient("../evil", "t")).toThrow("gist id");
  });

  it("reads a file with the token, and returns null for a missing file", async () => {
    const { impl, calls } = fakeFetch([[API, () => json({ files: { "jazz2-data.json": { content: '{"a":1}' } } })]]);
    const g = gistClient("abc123", "tok", impl);
    expect(await g.readFile("jazz2-data.json")).toBe('{"a":1}');
    expect(await g.readFile("nope.json")).toBeNull();
    expect((calls[0].init!.headers as any).Authorization).toBe("Bearer tok");
  });

  it("follows raw_url for truncated files without sending the token there", async () => {
    const { impl, calls } = fakeFetch([
      [
        API,
        () =>
          json({ files: { "big.json": { truncated: true, raw_url: "https://gist.githubusercontent.com/raw/big" } } }),
      ],
      ["https://gist.githubusercontent.com/", () => text("FULL")],
    ]);
    expect(await gistClient("abc123", "tok", impl).readFile("big.json")).toBe("FULL");
    expect(calls[1].init?.headers).toBeUndefined();
  });

  it("writes only the named file with PATCH", async () => {
    const { impl, calls } = fakeFetch([[API, () => json({})]]);
    await gistClient("abc123", "tok", impl).writeFile("jazz2-briefing.json", "{}");
    expect(calls[0].init!.method).toBe("PATCH");
    expect(Object.keys(JSON.parse(String(calls[0].init!.body)).files)).toEqual(["jazz2-briefing.json"]);
  });

  it("throws on API errors without echoing the token", async () => {
    const { impl } = fakeFetch([[API, () => json({}, 401)]]);
    const err = await gistClient("abc123", "tok-secret", impl)
      .readFile("x")
      .catch((e) => e);
    expect(err.message).toBe("GitHub API 401 reading the gist");
    await expect(gistClient("abc123", "t", impl).writeFile("x", "")).rejects.toThrow("401");
  });
});
