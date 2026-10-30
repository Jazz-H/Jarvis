// push.js - Phone notifications from Jarvis (Web Push): the morning headline and alerts.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- PHONE NOTIFICATIONS ----------
// Turning them on asks the phone for permission and a push address, and saves that address in
// the sync gist (jazz2-push.json, its own file, never touched by sync). The Jarvis Action sends to
// it with the matching private key (VAPID_PRIVATE_KEY secret). On iPhone this needs the app added
// to the home screen (iOS 16.4+); Android works from Chrome.
const PUSH_PUBLIC_KEY = "BF54qprNwJg833P74vJhM1ABNGzHJYmWsgq26TZi9ik7JLLmK_F_tMAuKGpkC_S7fO4-_Ci5anNk7T2jinq4YtQ";
const PUSH_FILE = "jazz2-push.json";
const PUSH_ENDPOINT_KEY = "push-endpoint"; // this phone's push address, once on (this device only)
const PUSH_LATER_KEY = "push-later"; // "Not now" (this device only)

function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
function pushState() {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return localStorage.getItem(PUSH_ENDPOINT_KEY) && Notification.permission === "granted" ? "on" : "off";
}
function pushKeyBytes(b64url) {
  const s = (b64url + "=".repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
// Read, change and write the push file in the sync gist (sync must be on)
async function savePushSubs(update) {
  const id = localStorage.getItem("sync-gist-id") || (await findOrCreateGist());
  const g = await gistApi("/gists/" + id);
  let subs = [];
  try {
    const f = g.files && g.files[PUSH_FILE];
    const parsed = f && JSON.parse(f.content);
    if (parsed && Array.isArray(parsed.subs)) subs = parsed.subs.filter((x) => x && typeof x.endpoint === "string");
  } catch (e) {}
  await gistApi("/gists/" + id, {
    method: "PATCH",
    body: JSON.stringify({ files: { [PUSH_FILE]: { content: JSON.stringify({ subs: update(subs) }) } } }),
  });
}
async function enablePush() {
  if (!localStorage.getItem("sync-token")) {
    showToast("Turn on sync first (the cloud button)", true);
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      showToast("Notifications are blocked for this app", true);
      renderHome();
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: pushKeyBytes(PUSH_PUBLIC_KEY),
    });
    const j = sub.toJSON();
    await savePushSubs((subs) =>
      [...subs.filter((x) => x.endpoint !== j.endpoint), { endpoint: j.endpoint, keys: j.keys }].slice(-10),
    );
    localStorage.setItem(PUSH_ENDPOINT_KEY, j.endpoint);
    showToast("Notifications on: you'll get tomorrow's briefing");
  } catch (e) {
    console.error("push setup failed", e);
    showToast("Couldn't turn on notifications. Try again later.", true);
  }
  renderHome();
}
function pushLater() {
  try {
    localStorage.setItem(PUSH_LATER_KEY, "1");
  } catch (e) {}
  renderHome();
}
// A small card on Home until notifications are on (or "Not now"), only where they can work
function pushCardHtml() {
  if (pushState() !== "off" || !localStorage.getItem("sync-token") || localStorage.getItem(PUSH_LATER_KEY)) return "";
  return `<section class="card jv-card jv-suggest" aria-label="Notifications">
      <div class="jv-kicker">Notifications</div>
      <h2 class="jv-headline">Get Jarvis on your lock screen</h2>
      <p class="jv-line">The morning headline, plus alerts for bills to pay by hand and packages arriving today.</p>
      <div class="jv-chips">
        <button class="jv-chip-sm on" data-action="jv-push-on">Turn on</button>
        <button class="jv-chip-sm" data-action="jv-push-later">Not now</button>
      </div>
    </section>`;
}
