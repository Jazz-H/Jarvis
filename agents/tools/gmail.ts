// Gmail, read-only (scope gmail.readonly). Plain code: trade the refresh token for an access token,
// search, and read each message's headers + Gmail's short snippet (format=metadata: never the body
// or attachments). Only the orchestrator process holds the Google credentials; sub-agents get
// the resulting items as data.

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

export interface Gmail {
  search(q: string, max: number): Promise<RawMail[]>;
  count(q: string): Promise<number>;
}

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
  return {
    async search(q, max) {
      const ids: string[] = ((await list(q, max)).messages ?? []).map((m: any) => String(m.id));
      const meta = new URLSearchParams([
        ["format", "metadata"],
        ["metadataHeaders", "From"],
        ["metadataHeaders", "Subject"],
      ]);
      const msgs = await Promise.all(ids.map((id) => get(`/messages/${encodeURIComponent(id)}?${meta}`)));
      return msgs.map((m) => {
        const h = (name: string) =>
          (m.payload?.headers ?? []).find((x: any) => String(x.name).toLowerCase() === name)?.value ?? "";
        return {
          from: senderName(h("from")),
          subject: clean(h("subject"), 200),
          snippet: clean(m.snippet, 300),
          date: new Date(Number(m.internalDate) || 0).toISOString(),
          unread: Array.isArray(m.labelIds) && m.labelIds.includes("UNREAD"),
        };
      });
    },
    async count(q) {
      const j = await list(q, 1);
      return Number(j.resultSizeEstimate) || 0;
    },
  };
}
