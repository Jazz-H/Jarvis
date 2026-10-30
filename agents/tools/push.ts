// Web Push to the phones that turned on notifications in the app. The app saves each phone's push
// address in the sync gist (jazz2-push.json); the orchestrator sends the morning headline and a
// few alerts there, signed with the VAPID key (secret VAPID_PRIVATE_KEY). Addresses the phone has
// revoked (404/410) are dropped. Nothing here can fail the briefing.
import webpush from "web-push";

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}
export type Sender = (sub: PushSub, payload: string) => Promise<unknown>;

const isKey = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(v);

// jazz2-push.json: {subs: [{endpoint, keys: {p256dh, auth}}]}; anything else is ignored
export function readSubs(raw: string | null): PushSub[] {
  if (!raw) return [];
  let j: any;
  try {
    j = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(j?.subs) ? j.subs : [];
  return list
    .filter((s: any) => s && /^https:\/\//.test(String(s.endpoint)) && isKey(s.keys?.p256dh) && isKey(s.keys?.auth))
    .slice(0, 10)
    .map((s: any) => ({
      endpoint: String(s.endpoint).slice(0, 1000),
      keys: { p256dh: s.keys.p256dh, auth: s.keys.auth },
    }));
}

export function vapidSender(publicKey: string, privateKey: string, subject: string): Sender {
  return (sub, payload) =>
    webpush.sendNotification(sub, payload, { vapidDetails: { subject, publicKey, privateKey }, TTL: 6 * 3600 });
}

// Sends every message to every phone; returns how many went out and which addresses are gone
export async function sendAll(
  subs: PushSub[],
  messages: PushMessage[],
  send: Sender,
): Promise<{ sent: number; gone: string[]; failed: number }> {
  let sent = 0,
    failed = 0;
  const gone = new Set<string>();
  for (const sub of subs)
    for (const m of messages) {
      if (gone.has(sub.endpoint)) break;
      try {
        await send(sub, JSON.stringify(m));
        sent++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) gone.add(sub.endpoint);
        else failed++;
      }
    }
  return { sent, gone: [...gone], failed };
}
