// Sends phone notifications to every phone saved in jazz2-push.json and drops the ones the phone
// has revoked. Shared by the briefing (jarvis.ts), the Weekly Review (review.ts) and Ask (ask.ts).
// Never fails the run that calls it.
import { CONFIG } from "../config.ts";
import type { GistClient } from "../tools/gist.ts";
import { readSubs, sendAll, type PushMessage, type Sender } from "../tools/push.ts";
import type { Trace } from "./trace.ts";

export async function notifyPhones(gist: GistClient, send: Sender, messages: PushMessage[], trace: Trace) {
  try {
    const raw = await gist.readFile(CONFIG.gistFiles.push);
    const subs = readSubs(raw);
    if (!subs.length) return;
    const r = await sendAll(subs, messages, send);
    trace.log("jarvis", "notifications", { phones: subs.length, sent: r.sent, gone: r.gone.length, failed: r.failed });
    if (r.gone.length) {
      const keep = subs.filter((x) => !r.gone.includes(x.endpoint));
      await gist.writeFile(CONFIG.gistFiles.push, JSON.stringify({ subs: keep }));
    }
  } catch (e) {
    trace.log("jarvis", "notifications failed", { error: trace.publicError(e) }); // never fails the run
  }
}
