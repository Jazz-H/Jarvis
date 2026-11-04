// Gmail, read-only (scope gmail.readonly). Plain code: trade the refresh token for an access token,
// search, and read each message's headers + Gmail's short snippet (format=metadata). Only
// searchWithText, for order and shipping emails, also reads the body's text (never attachments);
// the Shopper trims it before a model sees it. Only the orchestrator process holds the Google
// credentials; sub-agents get the resulting items as data.

export interface GoogleCreds {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}
export class GoogleAuthError extends Error {}

export interface RawMail {
  from: string; // display name (or the address's domain when there's no name)
  subject: string;
  snippet: string;
  date: string; // ISO
  unread: boolean;
}

export async function googleAccessToken(c: GoogleCreds, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      refresh_token: c.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || typeof j.access_token !== "string") {
    // invalid_grant: revoked, expired, or the Google password changed
    if (j.error === "invalid_grant") throw new GoogleAuthError("Google access expired: reconnect (SETUP.md → Google)");
    throw new Error(`Google token HTTP ${res.status}`);
  }
  return j.access_token;
}

const clean = (s: unknown, n: number) =>
  String(s ?? "")
    .replace(/[­͏​-‏⁠﻿]+/g, "") // invisible padding (Chewy's snippets are full of it)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

// "City Power <billing@citypower.example>" → "City Power"; "<a@b.com>" → "b.com"
export function senderName(from: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(from);
  const name = m ? m[1].trim() : "";
  if (name) return clean(name, 80);
  const addr = (m ? m[2] : from).trim();
  const domain = addr.includes("@") ? addr.split("@").pop()! : addr;
  return clean(domain, 80);
}

// "City Power <billing@citypower.example>" → "billing@citypower.example". A quoted display name can
// hold anything, so it's ignored. A header that could mean more than one sender (a second address
// before or after the <address>) has no clear one: "".
export function senderAddress(from: string): string {
  const unquoted = from.replace(/"(?:[^"\\]|\\.)*"/g, " ").trim();
  const m = /^([^<>]*)<([^<>]*)>$/.exec(unquoted);
  if (m) return /[@,]/.test(m[1]) ? "" : m[2].trim().toLowerCase();
  return /[<>]/.test(unquoted) ? "" : unquoted.toLowerCase();
}

export interface Gmail {
  search(q: string, max: number): Promise<RawMail[]>;
  searchWithText(q: string, max: number): Promise<(RawMail & { text: string; address: string })[]>;
  count(q: string): Promise<number>;
}

// HTML without its tags, and without what's inside style, script and head. An email is untrusted and
// can be many megabytes, before any cap applies, so each pass walks it once: every search carries on
// from the last, and one that finds nothing isn't repeated. A regex here takes minutes on a crafted
// email. Blocks go first, so a stray "<" before one can't be read as a tag that swallows its opening.
const HIDDEN_BLOCK = /<(style|script|head)\b/y;
function withoutHiddenBlocks(html: string): string {
  const lower = html.replace(/[A-Z]+/g, (s) => s.toLowerCase()); // the same length, so positions match
  const unclosed = new Set<string>();
  const out: string[] = [];
  let at = 0;
  let from = 0;
  for (;;) {
    const open = html.indexOf("<", from);
    if (open < 0) break;
    from = open + 1;
    HIDDEN_BLOCK.lastIndex = open;
    const name = HIDDEN_BLOCK.exec(lower)?.[1];
    if (!name || unclosed.has(name)) continue;
    const closer = `</${name}>`;
    const close = lower.indexOf(closer, open);
    if (close < 0) {
      unclosed.add(name); // none from here on, so only its tag can go, in the next pass
      continue;
    }
    out.push(html.slice(at, open), " ");
    at = from = close + closer.length;
  }
  out.push(html.slice(at));
  return out.join("");
}
// A tag starts with a letter, "/", "!" or "?". Any other "<" is text ("a < b", "<3"), and stays.
const TAG_START = /[a-zA-Z/!?]/;
function withoutTags(html: string): string {
  const out: string[] = [];
  let at = 0;
  let from = 0;
  for (;;) {
    const open = html.indexOf("<", from);
    if (open < 0) break;
    from = open + 1;
    if (!TAG_START.test(html.charAt(from))) continue;
    const end = html.indexOf(">", from);
    if (end < 0) break; // no ">" left, so no more tags
    out.push(html.slice(at, open), " ");
    at = from = end + 1;
  }
  out.push(html.slice(at));
  return out.join("");
}

// What a message's body shows when read: its HTML with the tags gone (some senders, like USPS, put
// nothing useful in the plain part), else the plain part. Attachments are never decoded.
export function visibleText(payload: any): string {
  const found: { html?: string; plain?: string } = {};
  const walk = (part: any) => {
    const data = part?.body?.data;
    if (typeof data === "string" && !part.filename) {
      const text = Buffer.from(data, "base64url").toString("utf8");
      if (part.mimeType === "text/html") found.html ??= text;
      else if (part.mimeType === "text/plain") found.plain ??= text;
    }
    (part?.parts ?? []).forEach(walk);
  };
  walk(payload);
  const text =
    found.html !== undefined
      ? withoutTags(withoutHiddenBlocks(found.html))
          .replace(/&#(\d{1,7});|&#x([0-9a-f]{1,6});/gi, (_, d, x) => {
            const n = d ? Number(d) : parseInt(x, 16);
            return n <= 0x10ffff ? String.fromCodePoint(n) : " ";
          })
          .replace(/&rsquo;|&lsquo;/g, "'")
          .replace(/&(?!amp;)[a-z][a-z0-9]{1,8};/gi, " ") // &nbsp;, &shy; and the like
          .replace(/&amp;/g, "&")
      : (found.plain ?? "");
  return clean(text, 200_000);
}

export const COUNT_CAP = 100;
export function gmailClient(accessToken: string, fetchImpl: typeof fetch = fetch): Gmail {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  const get = async (path: string) => {
    const res = await fetchImpl(base + path, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Gmail HTTP ${res.status}`);
    return res.json() as Promise<any>;
  };
  const list = (q: string, max: number) => get(`/messages?${new URLSearchParams({ q, maxResults: String(max) })}`);
  const toRaw = (m: any): RawMail => {
    const h = (name: string) =>
      (m.payload?.headers ?? []).find((x: any) => String(x.name).toLowerCase() === name)?.value ?? "";
    return {
      from: senderName(h("from")),
      subject: clean(h("subject"), 200),
      snippet: clean(m.snippet, 300),
      date: new Date(Number(m.internalDate) || 0).toISOString(),
      unread: Array.isArray(m.labelIds) && m.labelIds.includes("UNREAD"),
    };
  };
  return {
    async search(q, max) {
      const ids: string[] = ((await list(q, max)).messages ?? []).map((m: any) => String(m.id));
      const meta = new URLSearchParams([
        ["format", "metadata"],
        ["metadataHeaders", "From"],
        ["metadataHeaders", "Subject"],
      ]);
      const msgs = await Promise.all(ids.map((id) => get(`/messages/${encodeURIComponent(id)}?${meta}`)));
      return msgs.map(toRaw);
    },
    async searchWithText(q, max) {
      const ids: string[] = ((await list(q, max)).messages ?? []).map((m: any) => String(m.id));
      const msgs = await Promise.all(ids.map((id) => get(`/messages/${encodeURIComponent(id)}?format=full`)));
      return msgs.map((m) => {
        const from = (m.payload?.headers ?? []).find((x: any) => String(x.name).toLowerCase() === "from")?.value ?? "";
        return { ...toRaw(m), text: visibleText(m.payload), address: senderAddress(from) };
      });
    },
    // Counts the matches (up to COUNT_CAP) instead of trusting resultSizeEstimate, which is a rough
    // guess (it said ~201 for a handful of unread). Past the cap it returns COUNT_CAP ("99+").
    async count(q) {
      const j = await list(q, COUNT_CAP);
      const n = Array.isArray(j.messages) ? j.messages.length : 0;
      return j.nextPageToken ? COUNT_CAP : n;
    },
  };
}
