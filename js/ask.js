// ask.js - Ask Jarvis: sending a question to the Jarvis Action, reading its answers, the Console
// rows for them, the History sheet, time-aware suggestions and the ?ask= link.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- ASK JARVIS ----------
// A question goes into jazz2-ask.json in the sync gist (this app is its only writer: re-read right
// before every write, and only that file is PATCHed). Then, with this device's Ask Jarvis key
// (a fine-grained GitHub token: Actions read/write on the one repo), the app starts the
// jarvis-ask.yml workflow with only the question's id; the text never leaves the private gist.
// Without a key, or when starting the workflow fails, the question waits for the next scheduled
// run. The Action writes jazz2-answers.json (read-only here, untrusted: normalizeAnswers() caps
// everything and it's all rendered escaped) and sends a push (tag "ask") that opens
// ./jazz2.0.html?tab=console&ask=<id>. Limits are enforced by the workflow; the app only adds a
// cooldown, one send at a time, and shows what's left today.
const ASK_FILE = "jazz2-ask.json";
const ANSWERS_FILE = "jazz2-answers.json";
const ASK_TOKEN_KEY = "ask-token"; // this device only: never synced, backed up, logged or shown
const ASK_TOKEN_BAD_KEY = "ask-token-bad"; // this device: GitHub refused the key on the last send
const ASK_TOKEN_EXP_KEY = "ask-token-expires"; // this device: when GitHub says the key expires (ms)
const ASK_LOCAL_KEY = "ask-questions"; // this device: questions asked here (or seen in the gist)
const ANSWERS_KEY = "jarvis-answers"; // this device: the cleaned copy of jazz2-answers.json
const ASK_CLEAR_KEY = "ask-clear-before"; // this device: Clear history hides everything before this (ms)
const ASK_DISPATCH_URL = "https://api.github.com/repos/Jazz-H/Jazz2.0/actions/workflows/jarvis-ask.yml/dispatches";
const ASK_SETUP_URL = "https://github.com/Jazz-H/Jazz2.0/blob/main/docs/jarvis/SETUP.md";
const ASK_ID = /^[a-z0-9-]{8,40}$/;
const ASK_TOKEN_SHAPE = /^github_pat_[A-Za-z0-9_]{20,250}$/;
const ASK_TEXT_MAX = 1000;
const ASK_FILE_MAX = 20;
const ASK_HISTORY_MAX = 50;
const ASK_DAY_LIMIT = 10;
const ASK_EXPIRY_WARN_MS = 14 * 864e5;
// Timings (tests shorten these)
const ASK_TIMING = { cooldown: 10000, pollEvery: 10000, pollFor: 180000 };
const ASK_SOURCES = {
  jazz: ["Jazz", "jv-src-jazz"],
  calendar: ["Calendar", "jv-src-calendar"],
  inbox: ["Inbox", "jv-src-inbox"],
  deliveries: ["Deliveries", "jv-src-deliveries"],
  weather: ["Weather", "jv-src-weather"],
  news: ["News", "jv-src-news"],
  review: ["Review", "jv-src-jarvis"],
};
const ASK_STATUSES = ["ok", "error", "declined", "over_limit"];
const ASK_KEY_BROKEN = "Ask Jarvis key isn't working — check it in Sync";
const ASK_NEEDS_SYNC = "Ask needs sync: turn it on with the cloud button. Capture works without it.";
let askBusy = false; // a question is being saved / sent
let askLastSend = 0;
let askThread = null; // the first question's id while a follow-up is being written
let askTapped = new Set(); // "answerId|chipIndex" added this session
let askPendingLink = null; // a ?ask= id still waiting for its answer
let askPollTimer = null;
let askPollUntil = 0;
let askReturnFocus = null;
let askAnswersCache = { raw: undefined, data: null };
let askWriteChain = Promise.resolve();

// ---- small helpers ----
const askIsObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const askStr = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
function askGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function askSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (e) {}
}
function askSyncOn() {
  return !!askGet("sync-token");
}
function askToken() {
  const t = askGet(ASK_TOKEN_KEY);
  return t && ASK_TOKEN_SHAPE.test(t) ? t : "";
}
function askTokenLooksRight(t) {
  return ASK_TOKEN_SHAPE.test(String(t || ""));
}
function askClearBefore() {
  const n = Number(askGet(ASK_CLEAR_KEY));
  return isFinite(n) && n > 0 ? n : 0;
}
function askNewId() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const rand = [...bytes].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  return `a-${Date.now().toString(36)}-${rand}`;
}
function askTime(ms) {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
// The live region screen readers hear for Ask and voice updates
function liveAnnounce(msg) {
  let el = document.getElementById("live-status");
  if (!el) {
    el = document.createElement("span");
    el.id = "live-status";
    el.className = "cn-sr";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = "";
  if (msg) setTimeout(() => (el.textContent = msg), 50);
}

// ---- the Ask Jarvis key in the Sync dialog (this device only; never put back on the page) ----
function askKeyFieldHtml() {
  const has = !!askGet(ASK_TOKEN_KEY);
  return `<div class="modal-field ak-key" id="ak-key">
      <span class="modal-section">Ask Jarvis key</span>
      <p class="modal-note">Lets this device start Jarvis right away, so answers come back in about a minute.
        It's a fine-grained GitHub token for this one repo with only <b>Actions: read and write</b>. It stays
        on this device; your question itself only goes to your private gist. Without it, questions wait
        for Jarvis's next run (~7am). How to make one: <a href="${ASK_SETUP_URL}" target="_blank" rel="noopener noreferrer">setup guide, section 8</a>.</p>
      <label class="modal-field ak-key-input"><span>${has ? "Key saved here · paste a new one to replace it" : "Key (starts with github_pat_)"}</span>
        <input id="modal-askToken" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${has ? "••••••••  saved" : "github_pat_…"}" /></label>
      ${has ? '<button type="button" class="backup-btn ak-key-remove" data-action="ask-token-remove">Remove Ask Jarvis key</button>' : ""}
    </div>`;
}
// From the Sync dialog's Save: true when a new key was saved
function askKeySave(value) {
  const v = String(value || "").trim();
  if (!v) return false;
  if (!askTokenLooksRight(v)) {
    showToast("That isn't an Ask Jarvis key: it starts with github_pat_", true);
    return false;
  }
  askSet(ASK_TOKEN_KEY, v);
  askSet(ASK_TOKEN_BAD_KEY, null);
  askSet(ASK_TOKEN_EXP_KEY, null);
  showToast("Ask Jarvis key saved on this device");
  renderConsole();
  return true;
}
function askTokenRemove() {
  if (!confirm("Remove the Ask Jarvis key from this device? Questions will wait for Jarvis's next run.")) return;
  askSet(ASK_TOKEN_KEY, null);
  askSet(ASK_TOKEN_BAD_KEY, null);
  askSet(ASK_TOKEN_EXP_KEY, null);
  const box = document.getElementById("ak-key");
  if (box) box.outerHTML = askKeyFieldHtml();
  const input = document.getElementById("modal-askToken");
  if (input) input.focus({ preventScroll: true });
  showToast("Ask Jarvis key removed");
  renderConsole();
}

// ---- questions kept on this device ----
// {id, text, at (ms), thread?, state: sending|sent|queued|failed|seen, sentAt?}
// "seen": read from the gist (asked on another device)
const ASK_STATES = ["sent", "queued", "failed", "seen"];
function normalizeAskLocal(raw, now = Date.now()) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : [])
    .filter(askIsObj)
    .map((q) => {
      const at = Number(q.at);
      const text = askStr(q.text, ASK_TEXT_MAX);
      if (typeof q.id !== "string" || !ASK_ID.test(q.id) || !text || !isFinite(at) || at > now + 864e5) return null;
      // a send that was still going when the app closed didn't finish
      const state = q.state === "sending" ? "failed" : ASK_STATES.includes(q.state) ? q.state : "queued";
      const out = { id: q.id, text, at, state };
      if (typeof q.thread === "string" && ASK_ID.test(q.thread) && q.thread !== q.id) out.thread = q.thread;
      const sentAt = Number(q.sentAt);
      if (state === "sent" && isFinite(sentAt) && sentAt > 0) out.sentAt = Math.min(sentAt, now);
      return out;
    })
    .filter((q) => q && !seen.has(q.id) && seen.add(q.id))
    .sort((a, b) => b.at - a.at)
    .slice(0, ASK_HISTORY_MAX);
}
function loadAskLocal() {
  let raw = null;
  try {
    raw = JSON.parse(askGet(ASK_LOCAL_KEY) || "null");
  } catch (e) {}
  const clear = askClearBefore();
  return normalizeAskLocal(raw).filter((q) => q.at >= clear);
}
function saveAskLocal(list) {
  writeQuietly(ASK_LOCAL_KEY, normalizeAskLocal(list)); // device-only, never a synced edit
}
function askUpdateLocal(id, patch) {
  const list = loadAskLocal();
  const q = list.find((x) => x.id === id);
  if (!q) return null;
  Object.assign(q, patch);
  if (q.state !== "sent") delete q.sentAt;
  saveAskLocal(list);
  return q;
}
// the in-memory "sending" state isn't stored (a reload means it didn't finish)
let askSending = new Set();

// ---- the answers file (written by the Action; read-only here) ----
function normalizeAnswer(a) {
  if (!askIsObj(a) || typeof a.id !== "string" || !ASK_ID.test(a.id) || !ASK_STATUSES.includes(a.status)) return null;
  const when = (v) => (typeof v === "string" && v.length <= 40 && !isNaN(Date.parse(v)) ? v : "");
  const answeredAt = when(a.answeredAt);
  const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isoDate(noonOf(v)) === v;
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    id: a.id,
    askedAt: when(a.askedAt),
    answeredAt,
    status: a.status,
    text: askStr(a.text, 1200),
    bullets: arr(a.bullets)
      .slice(0, 20)
      .map((b) => askStr(b, 200))
      .filter(Boolean)
      .slice(0, 5),
    sources: [
      ...new Set(
        arr(a.sources).filter((s) => typeof s === "string" && Object.prototype.hasOwnProperty.call(ASK_SOURCES, s)),
      ),
    ].slice(0, 6),
    chips: arr(a.chips)
      .filter((c) => askIsObj(c) && (c.kind === "todo" || c.kind === "shopping"))
      .map((c) => ({ kind: c.kind, text: askStr(c.text, 120), due: c.kind === "todo" && isDay(c.due) ? c.due : null }))
      .filter((c) => c.text)
      .slice(0, 3),
    by: a.by === "fallback" ? "fallback" : "jarvis",
  };
}
function normalizeAskUsage(u) {
  if (!askIsObj(u)) return null;
  const count = (v) => (typeof v === "number" && isFinite(v) ? Math.min(10000, Math.max(0, Math.round(v))) : 0);
  const cash = (v) =>
    typeof v === "number" && isFinite(v) ? Math.round(Math.min(1e4, Math.max(0, v)) * 100) / 100 : 0;
  const pick = (v, re) => (typeof v === "string" && re.test(v) ? v : null);
  return {
    day: pick(u.day, /^\d{4}-\d{2}-\d{2}$/),
    dayCount: count(u.dayCount),
    dayCostUsd: cash(u.dayCostUsd),
    week: pick(u.week, /^\d{4}-W\d{2}$/),
    weekCount: count(u.weekCount),
    month: pick(u.month, /^\d{4}-\d{2}$/),
    monthCostUsd: cash(u.monthCostUsd),
  };
}
// The whole file: valid answers only, one per id, newest first, at most 50
function normalizeAnswers(raw) {
  const ok = askIsObj(raw) && raw.version === 1;
  const seen = new Set();
  const stamp = (a) => Date.parse(a.answeredAt || a.askedAt) || 0;
  const answers = (ok && Array.isArray(raw.answers) ? raw.answers : [])
    .slice(0, ASK_HISTORY_MAX * 4)
    .map(normalizeAnswer)
    .filter((a) => a && !seen.has(a.id) && seen.add(a.id))
    .sort((a, b) => stamp(b) - stamp(a))
    .slice(0, ASK_HISTORY_MAX);
  return { version: 1, answers, usage: ok ? normalizeAskUsage(raw.usage) : null };
}
function loadAnswers() {
  const raw = askGet(ANSWERS_KEY);
  if (raw !== askAnswersCache.raw) {
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (e) {}
    askAnswersCache = { raw, data: normalizeAnswers(parsed) };
  }
  return askAnswersCache.data;
}
function askAnswerTime(a) {
  return Date.parse(a.askedAt) || Date.parse(a.answeredAt) || 0;
}
// A gist file's text (a truncated one is fetched from gist.githubusercontent.com only)
async function askFileText(file) {
  if (!askIsObj(file)) return null;
  if (!file.truncated) return typeof file.content === "string" ? file.content : null;
  const raw = safeUrl(file.raw_url);
  if (!raw || new URL(raw).hostname !== "gist.githubusercontent.com") return null;
  return (await fetch(raw)).text();
}
// Called by sync's pull (and the Console poll) with the gist's answers file entry (or undefined)
async function ingestAnswersFile(file) {
  try {
    const text = await askFileText(file);
    if (text == null) return;
    const parsed = JSON.parse(text);
    if (!askIsObj(parsed) || parsed.version !== 1) return;
    const next = normalizeAnswers(parsed);
    const prev = loadAnswers();
    if (JSON.stringify(prev) === JSON.stringify(next)) return; // nothing new
    const had = new Set(prev.answers.map((a) => a.id));
    writeQuietly(ANSWERS_KEY, next); // stored already cleaned
    const mine = new Set(loadAskLocal().map((q) => q.id));
    const fresh = next.answers.filter((a) => !had.has(a.id) && mine.has(a.id));
    renderConsole();
    askRenderHistory();
    if (askPendingLink && next.answers.some((a) => a.id === askPendingLink) && currentTab === "console") {
      const id = askPendingLink;
      askPendingLink = null;
      askFocusEntry(id);
    } else if (fresh.length) {
      showToast(fresh.length === 1 ? "Jarvis answered" : `Jarvis answered ${fresh.length} questions`);
    }
  } catch (e) {
    console.warn("answers not loaded", e);
  }
}

// ---- the ask file (this app is its only writer) ----
function normalizeAskFile(raw) {
  const out = { version: 1, items: [], clearBefore: 0 };
  if (!askIsObj(raw)) return out;
  const seen = new Set();
  out.items = (Array.isArray(raw.items) ? raw.items : [])
    .filter(askIsObj)
    .map((i) => {
      const text = askStr(i.text, ASK_TEXT_MAX);
      const at = typeof i.at === "string" ? Date.parse(i.at) : NaN;
      if (typeof i.id !== "string" || !ASK_ID.test(i.id) || !text || !isFinite(at)) return null;
      const kind = typeof i.kind === "string" && /^[a-z_]{1,12}$/.test(i.kind) ? i.kind : "ask";
      const item = { id: i.id, kind, text, at: new Date(at).toISOString() };
      if (typeof i.thread === "string" && ASK_ID.test(i.thread)) item.thread = i.thread;
      return item;
    })
    .filter((i) => i && !seen.has(i.id) && seen.add(i.id));
  const cb = typeof raw.clearBefore === "string" ? Date.parse(raw.clearBefore) : NaN;
  if (isFinite(cb) && cb > 0) out.clearBefore = cb;
  return out;
}
// Writes go one at a time
function askWriteFile(update) {
  const run = askWriteChain.then(() => askWriteNow(update));
  askWriteChain = run.catch(() => {});
  return run;
}
async function askWriteNow(update) {
  const id = askGet("sync-gist-id") || (await findOrCreateGist());
  const g = await gistApi("/gists/" + id); // always re-read right before writing
  const files = (g && g.files) || {};
  let cur = normalizeAskFile(null);
  const text = await askFileText(files[ASK_FILE]);
  if (text != null) {
    try {
      cur = normalizeAskFile(JSON.parse(text));
    } catch (e) {}
  }
  // questions that have an answer (any status) are done: drop them
  let answered = new Set(loadAnswers().answers.map((a) => a.id));
  try {
    const at = await askFileText(files[ANSWERS_FILE]);
    if (at != null) normalizeAnswers(JSON.parse(at)).answers.forEach((a) => answered.add(a.id));
  } catch (e) {}
  const clearBefore = Math.max(cur.clearBefore, askClearBefore());
  const all = update(cur.items.slice()).filter((i) => Date.parse(i.at) >= clearBefore);
  // Answers don't carry the question text, so a thread asked in the last 24 hours keeps its
  // answered items here: Jarvis reads them for follow-ups
  const dayAgo = Date.now() - 864e5;
  const active = new Set(all.filter((i) => Date.parse(i.at) >= dayAgo).map((i) => i.thread || i.id));
  const inThread = (i) => active.has(i.id) || (!!i.thread && active.has(i.thread));
  const items = all
    .filter((i) => !answered.has(i.id) || inThread(i))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // at most 20: answered thread context goes first (oldest first), then the oldest pending
  while (items.length > ASK_FILE_MAX) {
    const k = items.findIndex((i) => answered.has(i.id));
    items.splice(k >= 0 ? k : 0, 1);
  }
  const next = { version: 1, items };
  if (clearBefore) next.clearBefore = new Date(clearBefore).toISOString();
  const content = JSON.stringify(next);
  if (text != null && content === text) return; // nothing to change
  await gistApi("/gists/" + id, {
    method: "PATCH",
    body: JSON.stringify({ files: { [ASK_FILE]: { content } } }),
  });
}
// Called by sync's pull with the gist's ask file: questions asked on another device show here
// too, and a Clear history done there (clearBefore) clears this device as well
async function ingestAskFile(file) {
  try {
    const text = await askFileText(file);
    if (text == null) return;
    const f = normalizeAskFile(JSON.parse(text));
    const localClear = askClearBefore();
    if (f.clearBefore > localClear) {
      askSet(ASK_CLEAR_KEY, String(f.clearBefore));
      saveAskLocal(loadAskLocal());
    } else if (localClear > f.clearBefore && askSyncOn()) {
      askWriteFile((items) => items).catch(() => {}); // a clear that didn't reach the gist yet
    }
    const clear = askClearBefore();
    const list = loadAskLocal();
    const known = new Set(list.map((q) => q.id));
    const add = f.items
      .filter((i) => i.kind === "ask" && !known.has(i.id) && Date.parse(i.at) >= clear)
      .map((i) => ({ id: i.id, text: i.text, at: Date.parse(i.at), state: "seen", thread: i.thread }));
    if (!add.length && f.clearBefore <= localClear) return;
    saveAskLocal([...add, ...list]);
    renderConsole();
    askRenderHistory();
  } catch (e) {
    console.warn("ask file not loaded", e);
  }
}

// ---- sending ----
function askCooldownLeft(now = Date.now()) {
  return Math.max(0, askLastSend + ASK_TIMING.cooldown - now);
}
// The Console's Send in Ask mode. Returns true when the question was taken (the box clears).
function askSend(text) {
  const q = askStr(text, ASK_TEXT_MAX);
  if (!q) return false;
  if (!askSyncOn()) {
    showToast(ASK_NEEDS_SYNC, true);
    return false;
  }
  if (askBusy) {
    showToast("One moment: your last question is still sending", true);
    return false;
  }
  const wait = askCooldownLeft();
  if (wait > 0) {
    showToast(`One moment: you can ask again in ${Math.ceil(wait / 1000)}s`, true);
    return false;
  }
  const item = { id: askNewId(), text: q, at: Date.now(), state: "queued" };
  if (askThread && loadAskEntries().some((e) => e.id === askThread)) item.thread = askThread;
  askThread = null;
  askLastSend = item.at;
  saveAskLocal([item, ...loadAskLocal()]);
  askDeliver(item.id);
  return true;
}
// Save to the gist, then start the workflow (or leave it queued)
async function askDeliver(id) {
  const q = loadAskLocal().find((x) => x.id === id);
  if (!q || askBusy) return;
  askBusy = true;
  askSending.add(id);
  renderConsole();
  liveAnnounce("Sending your question to Jarvis");
  try {
    try {
      await askWriteFile((items) => [
        ...items.filter((i) => i.id !== q.id),
        {
          id: q.id,
          kind: "ask",
          text: q.text,
          at: new Date(q.at).toISOString(),
          ...(q.thread ? { thread: q.thread } : {}),
        },
      ]);
    } catch (e) {
      console.error("ask save failed", e);
      askUpdateLocal(id, { state: "failed" });
      showToast("Couldn't send your question. Check your connection and try again", true);
      return;
    }
    const token = askToken();
    const result = token ? await askDispatch(token, q.id) : "none";
    if (result === "ok") {
      askSet(ASK_TOKEN_BAD_KEY, null);
      askUpdateLocal(id, { state: "sent", sentAt: Date.now() });
      askPollStart();
      liveAnnounce("Jarvis is thinking");
    } else {
      askUpdateLocal(id, { state: "queued" });
      if (result === "bad") {
        askSet(ASK_TOKEN_BAD_KEY, "1");
        showToast(ASK_KEY_BROKEN, true);
      }
      liveAnnounce("Queued. Jarvis will answer on the next run");
    }
  } finally {
    askSending.delete(id);
    askBusy = false;
    renderConsole();
  }
}
// Starts jarvis-ask.yml with only the question's id. "ok" | "bad" (key refused) | "failed"
async function askDispatch(token, id) {
  let res;
  try {
    res = await fetch(ASK_DISPATCH_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { id } }),
    });
  } catch (e) {
    console.warn("ask dispatch failed"); // never log the key or the request
    return "failed";
  }
  try {
    const exp = askParseExpiry(res.headers.get("github-authentication-token-expiration"));
    if (exp) askSet(ASK_TOKEN_EXP_KEY, String(exp));
  } catch (e) {}
  if (res.status === 204 || res.ok) return "ok";
  if (res.status === 401 || res.status === 403 || res.status === 404) return "bad";
  return "failed";
}
// GitHub sends "2027-10-30 12:00:00 UTC" (or with a -0500 style offset)
function askParseExpiry(h) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*(UTC|Z|[+-]\d{2}:?\d{2})?$/.exec(
    String(h || "").trim(),
  );
  if (!m) return null;
  let tz = m[3] || "Z";
  if (tz === "UTC") tz = "Z";
  else if (/^[+-]\d{4}$/.test(tz)) tz = tz.slice(0, 3) + ":" + tz.slice(3);
  const t = Date.parse(`${m[1]}T${m[2]}${tz}`);
  return isFinite(t) ? t : null;
}
function askRetry(id) {
  const q = typeof id === "string" && ASK_ID.test(id) ? loadAskLocal().find((x) => x.id === id) : null;
  if (!q || q.state !== "failed") return;
  if (askBusy) {
    showToast("One moment: your last question is still sending", true);
    return;
  }
  askDeliver(id);
}

// ---- waiting for the answer: poll the gist while Console is on screen ----
function askWaiting() {
  const answered = new Set(loadAnswers().answers.map((a) => a.id));
  return loadAskLocal().filter((q) => q.state === "sent" && !answered.has(q.id));
}
function askPollStart() {
  askPollUntil = Date.now() + ASK_TIMING.pollFor;
  clearTimeout(askPollTimer);
  askPollTimer = null;
  askPollEnsure();
}
function askShouldPoll() {
  return (
    Date.now() < askPollUntil &&
    document.visibilityState === "visible" &&
    currentTab === "console" &&
    askSyncOn() &&
    askWaiting().length > 0
  );
}
function askPollEnsure() {
  if (askPollTimer || !askShouldPoll()) return;
  askPollTimer = setTimeout(askPollTick, ASK_TIMING.pollEvery);
}
function askPollStop() {
  clearTimeout(askPollTimer);
  askPollTimer = null;
}
async function askPollTick() {
  askPollTimer = null;
  if (!askShouldPoll()) {
    renderConsole(); // past 3 minutes: "Still working"
    return;
  }
  try {
    const id = askGet("sync-gist-id");
    if (id) {
      const g = await gistApi("/gists/" + id);
      await ingestAnswersFile(g && g.files && g.files[ANSWERS_FILE]);
    }
  } catch (e) {}
  if (Date.now() >= askPollUntil) renderConsole();
  askPollEnsure();
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") askPollEnsure();
  else askPollStop();
});

// ---- what the Console and History show ----
// Questions (this device's, or seen in the gist) with their answer, plus answers whose question
// this device never saw. Newest first, Clear history respected.
function loadAskEntries() {
  const clear = askClearBefore();
  const answers = loadAnswers().answers;
  const byId = new Map(answers.map((a) => [a.id, a]));
  const out = loadAskLocal().map((q) => ({ ...q, answer: byId.get(q.id) || null }));
  const known = new Set(out.map((q) => q.id));
  answers.forEach((a) => {
    const at = askAnswerTime(a);
    if (known.has(a.id) || !at || at < clear) return;
    out.push({ id: a.id, text: "", at, state: "seen", answer: a });
  });
  return out.sort((a, b) => b.at - a.at).slice(0, ASK_HISTORY_MAX);
}
function askUsageLeft() {
  const u = loadAnswers().usage;
  if (!u || !u.day) return null;
  if (u.day !== isoDate(new Date())) return u.day < isoDate(new Date()) ? ASK_DAY_LIMIT : null;
  return Math.max(0, ASK_DAY_LIMIT - u.dayCount);
}
function askUsageText() {
  const left = askUsageLeft();
  return left == null ? "" : `${left} of ${ASK_DAY_LIMIT} questions left today`;
}
function askNextRunText(now = new Date()) {
  return `Queued — Jarvis will answer on the next run (${now.getHours() < 7 ? "today" : "tomorrow"} ~7am)`;
}
function askStatusHtml(q) {
  if (askSending.has(q.id))
    return `<span class="cn-status"><span class="cn-dot pulse" aria-hidden="true"></span>Sending…</span>`;
  if (q.state === "sent") {
    const fresh = Date.now() - (q.sentAt || q.at) < ASK_TIMING.pollFor;
    return fresh
      ? `<span class="cn-status ak-on ak-thinking">Jarvis is thinking<span class="ak-dots" aria-hidden="true"><i></i><i></i><i></i></span></span>`
      : `<span class="cn-status"><span class="cn-dot" aria-hidden="true"></span>Still working — you'll get a notification</span>`;
  }
  if (q.state === "failed")
    return `<span class="cn-status ak-failed"><span class="cn-dot" aria-hidden="true"></span>Couldn't send — check your connection</span>
      <span class="cn-links"><button type="button" class="cn-link" data-action="ask-retry" data-ask-id="${escapeAttr(q.id)}">Try again</button></span>`;
  if (q.state === "seen")
    return `<span class="cn-status"><span class="cn-dot" aria-hidden="true"></span>Waiting for Jarvis's answer</span>`;
  return `<span class="cn-status"><span class="cn-dot" aria-hidden="true"></span>${escapeHtml(askNextRunText())}</span>`;
}
const ASK_FLAGS = {
  over_limit: ["Over the limit", "This was over the daily question limit, so Jarvis didn't answer it."],
  error: ["Jarvis couldn't answer", "Something went wrong on Jarvis's side. Try asking again."],
  declined: ["Jarvis didn't answer this", "This one is outside what Jarvis can answer from your data."],
};
function askAnswerHtml(q) {
  const a = q.answer;
  const id = escapeAttr(a.id);
  const answered = Date.parse(a.answeredAt);
  const when = isFinite(answered) ? `Answered ${askTime(answered)}` : "";
  if (a.status !== "ok") {
    const [title, plain] = ASK_FLAGS[a.status];
    const again =
      a.status === "error" && q.text
        ? `<button type="button" class="cn-link" data-action="ask-again" data-ask-id="${id}">Ask again</button>`
        : "";
    return `<div class="ak-ans ak-flagged ak-${a.status}">
        <b class="ak-flag">${title}</b>
        <p class="ak-text">${escapeHtml(a.text || plain)}</p>
        ${a.status === "over_limit" ? '<p class="ak-meta">Limits: 10 questions a day, 40 a week.</p>' : ""}
        ${again || when ? `<div class="ak-foot">${again}${when ? `<span class="ak-meta">${escapeHtml(when)}</span>` : ""}</div>` : ""}
      </div>`;
  }
  const bullets = a.bullets.length
    ? `<ul class="ak-bullets">${a.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
    : "";
  const srcs = a.sources.length
    ? `<div class="ak-srcs" aria-label="Sources">${a.sources.map((s) => `<span class="jv-src ${ASK_SOURCES[s][1]}">${ASK_SOURCES[s][0]}</span>`).join("")}</div>`
    : "";
  const chips = a.chips
    .map((c, i) =>
      jarvisChipHtml(c, askTapped.has(`${a.id}|${i}`), `data-action="ask-chip" data-ask-id="${id}" data-index="${i}"`),
    )
    .join("");
  return `<div class="ak-ans">
      ${a.text ? `<p class="ak-text">${escapeHtml(a.text)}</p>` : bullets ? "" : '<p class="ak-text">Jarvis didn\'t say anything.</p>'}
      ${bullets}
      ${chips ? `<div class="rv-chips ak-chips" role="group" aria-label="Suggestions: tap one to add it">${chips}</div>` : ""}
      ${srcs}
      <div class="ak-foot">
        <button type="button" class="cn-link" data-action="ask-follow" data-ask-id="${id}" aria-label="Follow up on this answer">Follow up</button>
        <span class="ak-meta">${escapeHtml([a.by === "fallback" ? "Put together automatically (Jarvis didn't finish)" : "", when].filter(Boolean).join(" · "))}</span>
      </div>
    </div>`;
}
// One question and its answer (or status). withDay: the History sheet shows the date too.
function askEntryHtml(q, withDay = false) {
  const day = withDay
    ? `${noonOf(isoDate(new Date(q.at))).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · `
    : "";
  const said = q.text ? escapeHtml(q.text) : '<span class="ak-other">Asked on another device</span>';
  const follow = q.thread ? '<span class="ak-thread">Follow-up</span> ' : "";
  return `<li class="cn-entry ak-entry" data-ask-entry="${escapeAttr(q.id)}" tabindex="-1">
    <span class="cn-who">You</span><p class="cn-said">${follow}${said} <time class="cn-time">${escapeHtml(day + askTime(q.at))}</time></p>
    <span class="cn-who cn-j">J</span><div class="cn-reply">${q.answer ? askAnswerHtml(q) : askStatusHtml(q)}</div>
  </li>`;
}
// Today and yesterday go in the Console feed; everything else is in History
function askFeedEntries() {
  const from = noonOf(addDaysIso(-1)).getTime() - 12 * 3600e3; // yesterday's midnight
  return loadAskEntries().filter((q) => q.at >= from);
}

// ---- the Ask hint and notes under the box ----
function askHint() {
  if (!askSyncOn()) return ASK_NEEDS_SYNC;
  if (askGet(ASK_TOKEN_BAD_KEY) && askToken()) return ASK_KEY_BROKEN + ". Questions wait for the next run.";
  if (!askToken())
    return "Questions wait for Jarvis's next run (~7am). Add an Ask Jarvis key in Sync for answers in about a minute.";
  if (askUsageLeft() === 0) return "You've used today's 10 questions. Ask again tomorrow.";
  return "Jarvis answers from this morning's briefing, your calendar and your lists.";
}
function askNoteHtml(mode) {
  const parts = [];
  if (askThread) {
    const root = loadAskEntries().find((e) => e.id === askThread);
    const what =
      root && root.text ? `“${root.text.length > 60 ? root.text.slice(0, 57) + "…" : root.text}”` : "your last answer";
    parts.push(
      `<p class="ak-note ak-follow-note"><span>Following up on ${escapeHtml(what)}</span><button type="button" class="cn-link" data-action="ask-thread-cancel">Cancel</button></p>`,
    );
  }
  if (mode !== "ask") return parts.join("");
  if (!askSyncOn())
    parts.push(
      `<p class="ak-note"><span>Ask Jarvis sends your question through your private sync gist.</span><button type="button" class="cn-link" data-action="open-sync">Open Sync</button></p>`,
    );
  else if (askToken()) {
    const exp = Number(askGet(ASK_TOKEN_EXP_KEY));
    if (isFinite(exp) && exp > 0 && exp - Date.now() <= ASK_EXPIRY_WARN_MS) {
      const day = new Date(exp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      parts.push(
        `<p class="ak-note ak-warn"><span>${exp <= Date.now() ? `Your Ask Jarvis key expired ${escapeHtml(day)}.` : `Your Ask Jarvis key expires ${escapeHtml(day)}.`} Make a new one on GitHub and paste it in Sync.</span><button type="button" class="cn-link" data-action="open-sync">Open Sync</button></p>`,
      );
    }
  }
  return parts.join("");
}

// ---- History sheet ----
function askSheetEl() {
  return document.getElementById("ask-sheet");
}
function askHistoryOpenNow() {
  const el = askSheetEl();
  return !!el && el.classList.contains("open");
}
function askHistoryHtml() {
  const list = loadAskEntries();
  const body = list.length
    ? `<ul class="cn-feed ak-hist">${list.map((q) => askEntryHtml(q, true)).join("")}</ul>`
    : '<p class="cn-empty">No questions yet. Ask Jarvis something from Console.</p>';
  return `<div class="modal-head"><h2 class="ak-title" id="ask-title" tabindex="-1">History</h2><button type="button" class="modal-x rv-x" data-action="ask-history-close" aria-label="Close">&times;</button></div>
    <p class="ak-meta ak-hist-sub">Your last ${ASK_HISTORY_MAX} questions to Jarvis, newest first. ${escapeHtml(askUsageText())}</p>
    ${body}
    ${list.length ? '<button type="button" class="modal-btn danger ak-clear" data-action="ask-clear">Clear history</button>' : ""}
    <p class="ak-meta">Questions and answers live in your private sync gist, never in backups.</p>`;
}
function askRenderHistory() {
  const body = document.getElementById("ask-body");
  if (body && askHistoryOpenNow()) {
    const top = body.scrollTop;
    body.innerHTML = askHistoryHtml();
    body.scrollTop = top;
  }
}
function openAskHistory() {
  const el = askSheetEl();
  if (!el) return;
  if (!askHistoryOpenNow()) askReturnFocus = document.activeElement;
  el.classList.add("open");
  el.setAttribute("aria-hidden", "false");
  document.getElementById("ask-body").innerHTML = askHistoryHtml();
  syncSheets();
  document.getElementById("ask-body").scrollTop = 0;
  document.getElementById("ask-title").focus({ preventScroll: true });
}
function closeAskHistory(restore = true) {
  const el = askSheetEl();
  if (!el || !askHistoryOpenNow()) return;
  el.classList.remove("open");
  el.setAttribute("aria-hidden", "true");
  syncSheets();
  const back = askReturnFocus;
  askReturnFocus = null;
  if (restore && back && document.contains(back))
    try {
      back.focus({ preventScroll: true });
    } catch (e) {}
}
function askClearHistory() {
  if (
    !confirm(
      "Clear your questions and answers? They're hidden on this device now, and Jarvis's next run deletes them from the gist.",
    )
  )
    return;
  const now = Date.now();
  askSet(ASK_CLEAR_KEY, String(now));
  saveAskLocal([]);
  const a = loadAnswers();
  writeQuietly(ANSWERS_KEY, { ...a, answers: a.answers.filter((x) => askAnswerTime(x) >= now) });
  askThread = null;
  askPendingLink = null;
  askPollStop();
  renderConsole();
  askRenderHistory();
  showToast("History cleared");
  if (askSyncOn()) askWriteFile((items) => items).catch(() => {}); // sets clearBefore; retried on the next sync
}

// ---- answer actions ----
function askEntryById(id) {
  return typeof id === "string" && ASK_ID.test(id) ? loadAskEntries().find((e) => e.id === id) : undefined;
}
function askAddChip(id, i) {
  const e = askEntryById(id);
  const c = e && e.answer && e.answer.status === "ok" ? e.answer.chips[i] : null;
  if (!c) return;
  const key = `${e.id}|${i}`;
  if (askTapped.has(key) || reviewChipOnList(c)) {
    showToast("Already on your list");
    return;
  }
  const { before, after } = jarvisChipAdd(c);
  askTapped.add(key);
  renderConsole();
  askRenderHistory();
  const scope = askHistoryOpenNow() ? "#ask-body" : "#cn-feed";
  const chip = document.querySelector(`${scope} .rv-chip[data-ask-id="${CSS.escape(e.id)}"][data-index="${i}"]`);
  if (chip) chip.focus({ preventScroll: true });
  showUndoToast(c.kind === "todo" ? "Added to To-Do" : "Added to Shopping", () => {
    undoTo(before, after);
    askTapped.delete(key);
    renderConsole();
    askRenderHistory();
  });
}
function askFollow(id) {
  const e = askEntryById(id);
  if (!e || !e.answer) return;
  askThread = e.thread || e.id;
  closeAskHistory(false);
  if (currentTab !== "console") activateTab("console");
  consoleSetMode("ask");
  renderConsole();
  const input = consoleInput();
  if (input) input.focus();
}
function askThreadCancel() {
  askThread = null;
  renderConsole();
  const input = consoleInput();
  if (input) input.focus();
}
function askAgain(id) {
  const e = askEntryById(id);
  const input = consoleInput();
  if (!e || !e.text || !input) return;
  closeAskHistory(false);
  input.value = e.text;
  consoleSetMode("ask");
  input.focus();
}

// ---- ?tab=console&ask=<id> (the "ask" push) ----
function askFocusEntry(id) {
  const inFeed = document.querySelector(`#cn-feed [data-ask-entry="${CSS.escape(id)}"]`);
  let el = inFeed;
  if (!el && loadAskEntries().some((e) => e.id === id)) {
    openAskHistory();
    el = document.querySelector(`#ask-body [data-ask-entry="${CSS.escape(id)}"]`);
  }
  if (!el) return false;
  el.classList.add("ak-hit");
  el.scrollIntoView({ block: "center" });
  el.focus({ preventScroll: true });
  return true;
}
function askDeepLink(id) {
  if (typeof id !== "string" || !ASK_ID.test(id)) return;
  activateTab("console");
  const has = loadAnswers().answers.some((a) => a.id === id);
  if (!askFocusEntry(id) || !has) askPendingLink = id;
}

// ---- suggested questions (change with the day and time) ----
function askSuggestions(now = new Date()) {
  const out = [];
  const day = now.getDay();
  if (day === 0 || day === 1) out.push("How did my week go?");
  out.push("What's due before payday?");
  const need = (typeof wantsList !== "undefined" ? wantsList : [])
    .filter((w) => w && !wantsState[w.id] && !w.later && wantKind(w) === "need" && String(w.name || "").trim())
    .sort(wantsOrder)[0];
  if (need) {
    const name = String(need.name).trim();
    out.push(`Can I afford ${name.length > 40 ? name.slice(0, 39) + "…" : name} this pay period?`);
  }
  out.push(now.getHours() < 12 ? "What should I focus on today?" : "What should I focus on tomorrow?");
  if (typeof fitness !== "undefined" && fitness && fitness.goal != null) out.push("When will I hit my weight goal?");
  out.push("What's on my calendar this week?");
  return out;
}

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !askHistoryOpenNow()) return;
  if (document.getElementById("modal-backdrop").classList.contains("open")) return;
  e.preventDefault();
  closeAskHistory();
});
