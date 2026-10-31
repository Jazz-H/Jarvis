import { describe, it, expect } from "vitest";
import { googleAccessToken, gmailClient, senderName, GoogleAuthError } from "../tools/gmail.ts";
import { fakeFetch, json } from "./helpers.ts";

const creds = { clientId: "cid", clientSecret: "csecret", refreshToken: "rtoken" };

describe("gmail tool", () => {
  it("trades the refresh token for an access token", async () => {
    const { impl, calls } = fakeFetch([["https://oauth2.googleapis.com/token", () => json({ access_token: "at" })]]);
    expect(await googleAccessToken(creds, impl)).toBe("at");
    const body = new URLSearchParams(String(calls[0].init!.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rtoken");
  });

  it("says to reconnect when Google revokes access, without echoing secrets", async () => {
    const { impl } = fakeFetch([[/oauth2/, () => json({ error: "invalid_grant" }, 400)]]);
    const err = await googleAccessToken(creds, impl).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleAuthError);
    expect(err.message).toMatch(/reconnect/);
    expect(err.message).not.toMatch(/rtoken|csecret/);
    const other = fakeFetch([[/oauth2/, () => json({}, 503)]]);
    await expect(googleAccessToken(creds, other.impl)).rejects.toThrow("Google token HTTP 503");
  });

  it("keeps display names, never addresses", () => {
    expect(senderName('"City Power" <billing@citypower.example>')).toBe("City Power");
    expect(senderName("Sam Lee <sam@example.com>")).toBe("Sam Lee");
    expect(senderName("<no-reply@amazon.com>")).toBe("amazon.com");
    expect(senderName("ship-confirm@amazon.com")).toBe("amazon.com");
  });

  it("searches with headers and snippets only (format=metadata), and counts", async () => {
    const msg = (id: string, from: string, subject: string, unread: boolean) => ({
      id,
      snippet: `snippet ${id}\u0000 with\ncontrol chars`,
      internalDate: "1793300000000",
      labelIds: unread ? ["INBOX", "UNREAD"] : ["INBOX"],
      payload: {
        headers: [
          { name: "From", value: from },
          { name: "Subject", value: subject },
        ],
      },
    });
    const { impl, calls } = fakeFetch([
      [
        /\/messages\?/,
        (url) =>
          json(
            url.includes("maxResults=100")
              ? // the estimate is a rough guess; the count must come from the ids
                { resultSizeEstimate: 201, messages: Array.from({ length: 14 }, (_, i) => ({ id: "u" + i })) }
              : { messages: [{ id: "a" }, { id: "b" }] },
          ),
      ],
      [/\/messages\/a\?/, () => json(msg("a", "Sam <sam@x.com>", "Lunch?", true))],
      [/\/messages\/b\?/, () => json(msg("b", "Bank <b@bank.com>", "Statement", false))],
    ]);
    const g = gmailClient("at", impl);
    const items = await g.search("in:inbox", 30);
    expect(items).toEqual([
      {
        from: "Sam",
        subject: "Lunch?",
        snippet: "snippet a with control chars",
        date: new Date(1793300000000).toISOString(),
        unread: true,
      },
      {
        from: "Bank",
        subject: "Statement",
        snippet: "snippet b with control chars",
        date: new Date(1793300000000).toISOString(),
        unread: false,
      },
    ]);
    expect(calls.filter((c) => /\/messages\/[ab]\?/.test(c.url)).every((c) => c.url.includes("format=metadata"))).toBe(
      true,
    );
    expect(calls.every((c) => (c.init!.headers as any).Authorization === "Bearer at")).toBe(true);
    expect(await g.count("is:unread")).toBe(14);
  });

  it("caps the unread count at 100 when there are more pages", async () => {
    const { impl } = fakeFetch([
      [
        /\/messages\?/,
        () => json({ messages: Array.from({ length: 100 }, (_, i) => ({ id: "m" + i })), nextPageToken: "p2" }),
      ],
    ]);
    expect(await gmailClient("at", impl).count("is:unread")).toBe(100);
  });

  it("throws on API errors", async () => {
    const { impl } = fakeFetch([[/gmail/, () => json({}, 401)]]);
    await expect(gmailClient("at", impl).search("x", 1)).rejects.toThrow("Gmail HTTP 401");
  });
});
