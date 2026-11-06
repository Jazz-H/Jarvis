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
// cooldown, one send at a time, and shows this month's spending.
const ASK_FILE = "jazz2-ask.json";
const ANSWERS_FILE = "jazz2-answers.json";
const ASK_TOKEN_KEY = "ask-token"; // this device only: never synced, backed up, logged or shown
const ASK_TOKEN_BAD_KEY = "ask-token-bad"; // this device: GitHub refused the key on the last send
const ASK_TOKEN_EXP_KEY = "ask-token-expires"; // this device: when GitHub says the key expires (ms)
const ASK_LOCAL_KEY = "ask-questions"; // this device: questions asked here (or seen in the gist)
const ANSWERS_KEY = "jarvis-answers"; // this device: the cleaned copy of jazz2-answers.json
const ASK_CLEAR_KEY = "ask-clear-before"; // this device: Clear history hides everything before this (ms)
const ASK_DISPATCH_URL = "https://api.github.com/repos/Jazz-H/Jarvis/actions/workflows/jarvis-ask.yml/dispatches";
const ASK_SETUP_URL = "https://github.com/Jazz-H/Jarvis/blob/main/docs/jarvis/SETUP.md";
const ASK_ID = /^[a-z0-9-]{8,40}$/;
const ASK_TOKEN_SHAPE = /^github_pat_[A-Za-z0-9_]{20,250}$/;
const ASK_TEXT_MAX = 1000;
const ASK_FILE_MAX = 20;
const ASK_HISTORY_MAX = 50;
const ASK_MONTH_BUDGET = 20; // ASK_MONTHLY_BUDGET_USD's default (dollars)
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
  web: ["Web", "jv-src-news"],
  drive: ["Drive", "jv-src-calendar"],
};
const ASK_STATUSES = ["ok", "error", "declined", "over_limit"];
const ASK_ACTIONS = [
  "todo_done",
  "todo_add",
  "todo_move",
  "goal_done",
  "shopping_add",
  "shopping_bought",
  "weight_log",
  "workout_done",
  "remember",
  "forget",
  "package_hide", // dismiss one of this morning's packages (text: its name)
  "notice_dismiss", // dismiss one line of this morning's briefing (text: the line)
  "note_add", // a new note in the Notebook (text: title, note: body); same title adds to it
  "note_append", // add to a note (id, note: what to add)
];
const ASK_APPLIED_KEY = "ask-applied"; // this device: answers whose actions were applied here
let askShowAll = false; // the conversation shows every kept question (Earlier), not just 2 days
// A photo or PDF waiting to go with the next question ({name, mime, data (base64), size}); and the
// ones on their way (by question id) until they're saved to the gist. In memory only.
let askAttachment = null;
const askFiles = new Map();
const ASK_FILE_RE = /^jazz2-file-[a-z0-9-]{8,40}\.json$/;
const ASK_PDF_MAX = 3 * 1024 * 1024; // bytes
const ASK_IMG_SIDE = 1600; // photos are shrunk to this many pixels on the long side

function askAttachPick() {
  const input = document.getElementById("cn-file");
  if (input) input.click();
}
async function askAttachFile(input) {
  const file = input && input.files && input.files[0];
  if (input) input.value = "";
  if (!file) return;
  try {
    if (file.type === "application/pdf") {
      if (file.size > ASK_PDF_MAX) {
        showToast("That PDF is over 3 MB: try a smaller one or a photo of the page", true);
        return;
      }
      askAttachment = {
        name: file.name.slice(0, 120),
        mime: "application/pdf",
        data: await askBase64(file),
        size: file.size,
      };
    } else if (/^image\//.test(file.type)) {
      const data = await askShrinkImage(file);
      askAttachment = {
        name: file.name.slice(0, 120) || "photo.jpg",
        mime: "image/jpeg",
        data,
        size: Math.round((data.length * 3) / 4),
      };
    } else {
      showToast("Attach a photo or a PDF", true);
      return;
    }
  } catch (e) {
    console.warn("attach failed", e);
    showToast("Couldn't read that file", true);
    return;
  }
  consoleSetMode("ask"); // a file always goes to Jarvis
  renderConsole();
}
function askBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
async function askShrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, ASK_IMG_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c.toDataURL("image/jpeg", 0.82).split(",")[1] || "";
}
function askAttachClear() {
  askAttachment = null;
  renderConsole();
}
function askAttachHtml() {
  if (!askAttachment) return "";
  const kb = Math.max(1, Math.round(askAttachment.size / 1024));
  return `<div class="cn-attached"><span aria-hidden="true">📎</span><span class="cn-attached-name">${escapeHtml(askAttachment.name)}</span><small>${kb >= 1024 ? (kb / 1024).toFixed(1) + " MB" : kb + " KB"}</small><button type="button" class="br-x" data-action="ask-attach-clear" aria-label="Remove the attachment">&times;</button></div>`;
}
const ASK_KEY_BROKEN = "Ask Jarvis key isn't working — check it in Sync";
const ASK_NEEDS_SYNC = "Jarvis needs sync: turn it on in Settings (the gear). Quick lists work without it.";
let askBusy = false; // a question is being saved / sent
let askLastSend = 0;
let askThread = null; // the first question's id while a follow-up is being written
let askTapped = new Set(); // "answerId|chipIndex" added this session
let askPendingLink = null; // a ?ask= id still waiting for its answer
let askPollTimer = null;
let askPollUntil = 0;
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
        for Jarvis's next run (~6am). How to make one: <a href="${ASK_SETUP_URL}" target="_blank" rel="noopener noreferrer">setup guide, section 8</a>.</p>
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
      if (q.kind === "sort") out.kind = "sort"; // Sort with Jarvis: a brain dump to split into chips
      if (typeof q.file === "string" && ASK_FILE_RE.test(q.file)) out.file = q.file; // sent with a photo or PDF
      if (q.spoken === true)
        out.spoken = true; // asked by voice: the answer may be read aloud
      else if (typeof q.thread === "string" && ASK_ID.test(q.thread) && q.thread !== q.id) out.thread = q.thread;
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
      .filter((c) => askIsObj(c) && (c.kind === "todo" || c.kind === "shopping" || c.kind === "expense"))
      .map((c) => ({
        kind: c.kind,
        text: askStr(c.text, 120),
        due: c.kind === "todo" && isDay(c.due) ? c.due : null,
        ...(c.kind === "expense"
          ? {
              amount:
                typeof c.amount === "number" && isFinite(c.amount) && c.amount > 0 && c.amount <= 1e5
                  ? Math.round(c.amount * 100) / 100
                  : null,
            }
          : {}),
      }))
      .filter((c) => c.text && (c.kind !== "expense" || c.amount != null))
      .slice(0, 12), // 3 for a question, up to 12 for a sort
    // what Jarvis did (applied by askApplyActions on the device that asked): known types only
    actions: arr(a.actions)
      .filter((x) => askIsObj(x) && ASK_ACTIONS.includes(x.type) && askStr(x.label, 160))
      .slice(0, 5)
      .map((x) => ({
        type: x.type,
        id: typeof x.id === "string" && SAFE_ID.test(x.id) ? x.id : null,
        text: askStr(x.text, 200),
        date: isDay(x.date) ? x.date : null,
        lbs:
          typeof x.lbs === "number" && isFinite(x.lbs) && x.lbs >= 40 && x.lbs <= 800
            ? Math.round(x.lbs * 10) / 10
            : null,
        note: typeof x.note === "string" ? x.note.trim().slice(0, 1500) : "",
        label: askStr(x.label, 160),
      })),
    // web pages the answer used: https only (linkHtml checks again when drawing)
    links: arr(a.links)
      .filter(
        (l) => askIsObj(l) && typeof l.url === "string" && /^https:\/\/[^\s<>"']+$/.test(l.url) && l.url.length <= 500,
      )
      .slice(0, 3)
      .map((l) => ({ url: l.url, title: askStr(l.title, 100) || "Link" })),
    checkin: askStr(a.checkin, 40), // a scheduled check-in's name ("" for a question)
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
// Called by sync's pull (and the Console poll) with the gist's answers file entry (or undefined)
async function ingestAnswersFile(file) {
  try {
    const text = await readGistFile(file);
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
    const acted = askApplyActions(next.answers);
    renderConsole();
    askSpeakFresh(fresh);
    if (askPendingLink && next.answers.some((a) => a.id === askPendingLink) && currentTab === "console") {
      const id = askPendingLink;
      askPendingLink = null;
      askFocusEntry(id);
    } else if (fresh.length && !acted) {
      showToast(fresh.length === 1 ? "Jarvis answered" : `Jarvis answered ${fresh.length} questions`);
    }
  } catch (e) {
    console.warn("answers not loaded", e);
  }
}

// ---- reading answers aloud ----
// The words of an answer as they'd be read: the text, then what Jarvis did, then the points
function askSpokenText(a) {
  return [a.text, ...a.actions.map((x) => x.label + "."), ...a.bullets].filter(Boolean).join(" ");
}
function askSpeak(id) {
  const e = askEntryById(id);
  if (e && e.answer && e.answer.status === "ok") speakText(askSpokenText(e.answer), "ask:" + e.id);
}
// A new answer to a question asked by voice (or any, with "Always") is read aloud while the app is on screen
function askSpeakFresh(fresh) {
  const pref = jarvisSettings.speak || "voice";
  if (pref === "never" || !fresh.length || document.visibilityState !== "visible" || !speakSupported()) return;
  const local = new Map(loadAskLocal().map((q) => [q.id, q]));
  const a = fresh.find((x) => x.status === "ok" && (pref === "always" || (local.get(x.id) && local.get(x.id).spoken)));
  if (a) speakText(askSpokenText(a), "ask:" + a.id);
}

// ---- what Jarvis did ----
// An answer's actions are applied once, on the device that asked (a question seen from another
// device is left alone: its changes arrive by sync), within a day of the answer. Each goes through
// the app's own save path and checks again that its target is there and still open. One Undo
// covers all of them. Returns true when something was done.
function askAppliedSet() {
  try {
    const v = JSON.parse(askGet(ASK_APPLIED_KEY) || "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch (e) {
    return new Set();
  }
}
function askDoAction(x) {
  const today = addDaysIso(0);
  if (x.type === "todo_done") {
    const t = todoList.find((y) => y.id === x.id);
    if (!t || t.done) return false;
    if (t.repeat) completeRepeating(t);
    else toggleTodo(t.id);
  } else if (x.type === "todo_move") {
    const t = todoList.find((y) => y.id === x.id);
    if (!t || t.done || !x.date) return false;
    if (t.repeat) t.repeatDay = dayOf(x.date); // the series moves too, as when it's dragged
    t.due = x.date;
    saveContent("todo-content", todoList, { toast: false });
  } else if (x.type === "todo_add" || x.type === "shopping_add") {
    const c = { kind: x.type === "todo_add" ? "todo" : "shopping", text: x.text, due: x.date };
    if (!c.text || reviewChipOnList(c)) return false;
    jarvisChipAdd(c);
  } else if (x.type === "goal_done") {
    const g = plan3.find((y) => y.id === x.id);
    if (!g || g.done) return false;
    togglePlan3(g.id);
  } else if (x.type === "shopping_bought") {
    if (!wantsList.some((w) => w.id === x.id) || wantsState[x.id]) return false;
    toggleWant(x.id);
  } else if (x.type === "weight_log") {
    const date = x.date && x.date <= today ? x.date : today;
    if (x.lbs == null) return false;
    const w = fitness.weights.find((y) => y.date === date) || { id: genId("wt") }; // one weigh-in a day
    w.lbs = x.lbs;
    w.date = date;
    w.at = Date.now();
    if (!fitness.weights.includes(w)) fitness.weights.push(w);
    fitness.weights.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    saveFitness();
  } else if (x.type === "remember") {
    if (!brainRemember(x.text, "jarvis")) return false;
  } else if (x.type === "forget") {
    if (!x.id || !brainForget(x.id)) return false;
  } else if (x.type === "package_hide" || x.type === "notice_dismiss") {
    if (!(x.type === "package_hide" ? dismissPackage(x.text) : dismissLine(x.text))) return false;
    saveContent("jarvis-settings", jarvisSettings, { toast: false });
  } else if (x.type === "note_add") {
    if (!brainSaveNote(x.text, x.note, "jarvis")) return false;
  } else if (x.type === "note_append") {
    if (!x.id || !brainAppendNote(x.id, x.note, "jarvis")) return false;
  } else if (x.type === "workout_done") {
    const w = fitness.plan.find((y) => y.id === x.id);
    if (!w || !workoutOn(w, today) || workoutDone(today, w.id)) return false;
    toggleWorkout(today, w.id);
  } else return false;
  return true;
}
function askApplyActions(answers) {
  const local = new Map(loadAskLocal().map((q) => [q.id, q]));
  const applied = askAppliedSet();
  const due = answers.filter(
    (a) =>
      a.status === "ok" &&
      a.actions.length &&
      !applied.has(a.id) &&
      local.has(a.id) &&
      local.get(a.id).state !== "seen" &&
      Date.now() - (Date.parse(a.answeredAt) || 0) < 864e5,
  );
  if (!due.length) return false;
  const before = dataSnapshot();
  const done = [];
  due.forEach((a) => {
    a.actions.forEach((x) => {
      try {
        if (askDoAction(x)) done.push(x.label);
      } catch (e) {
        console.warn("Jarvis action skipped", e);
      }
    });
    applied.add(a.id);
  });
  askSet(ASK_APPLIED_KEY, JSON.stringify([...applied].slice(-100)));
  if (!done.length) return false;
  const after = dataSnapshot();
  showUndoToast(done.length === 1 ? `Jarvis: ${done[0]}` : `Jarvis did ${done.length} things`, () =>
    undoTo(before, after),
  );
  return true;
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
      if (typeof i.file === "string" && ASK_FILE_RE.test(i.file)) item.file = i.file;
      return item;
    })
    .filter((i) => i && !seen.has(i.id) && seen.add(i.id));
  const cb = typeof raw.clearBefore === "string" ? Date.parse(raw.clearBefore) : NaN;
  if (isFinite(cb) && cb > 0) out.clearBefore = cb;
  return out;
}
// Writes go one at a time
function askWriteFile(update, extra = null) {
  const run = askWriteChain.then(() => askWriteNow(update, extra));
  askWriteChain = run.catch(() => {});
  return run;
}
function askWriteNow(update, extra = null) {
  return withGist((id) => askWriteTo(id, update, extra));
}
async function askWriteTo(id, update, extra) {
  const g = await gistApi("/gists/" + id); // always re-read right before writing
  const files = (g && g.files) || {};
  let cur = normalizeAskFile(null);
  const text = await readGistFile(files[ASK_FILE]);
  if (text != null) {
    try {
      cur = normalizeAskFile(JSON.parse(text));
    } catch (e) {}
  }
  // questions that have an answer (any status) are done: drop them
  let answered = new Set(loadAnswers().answers.map((a) => a.id));
  try {
    const at = await readGistFile(files[ANSWERS_FILE]);
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
  const more = extra
    ? Object.fromEntries(
        Object.entries(extra)
          .filter(([n]) => ASK_FILE_RE.test(n))
          .map(([n, c]) => [n, { content: c }]),
      )
    : {};
  if (text != null && content === text && !Object.keys(more).length) return; // nothing to change
  await gistApi("/gists/" + id, {
    method: "PATCH",
    body: JSON.stringify({ files: { [ASK_FILE]: { content }, ...more } }),
  });
}
// Called by sync's pull with the gist's ask file: questions asked on another device show here
// too, and a Clear history done there (clearBefore) clears this device as well
async function ingestAskFile(file) {
  try {
    const text = await readGistFile(file);
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
      .filter((i) => (i.kind === "ask" || i.kind === "sort") && !known.has(i.id) && Date.parse(i.at) >= clear)
      .map((i) => ({ id: i.id, text: i.text, at: Date.parse(i.at), state: "seen", thread: i.thread, kind: i.kind }));
    if (!add.length && f.clearBefore <= localClear) return;
    saveAskLocal([...add, ...list]);
    renderConsole();
  } catch (e) {
    console.warn("ask file not loaded", e);
  }
}

// ---- sending ----
function askCooldownLeft(now = Date.now()) {
  return Math.max(0, askLastSend + ASK_TIMING.cooldown - now);
}
// The Console's Send in Ask mode, and Capture's Sort with Jarvis (kind "sort"). Returns true when
// it was taken (the box clears).
function askSend(text, kind = "ask") {
  const withFile = kind === "ask" && !!askAttachment;
  const q = askStr(text, ASK_TEXT_MAX) || (withFile ? "What's in this, and what should I do with it?" : "");
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
  if (withFile) {
    item.file = `jazz2-file-${item.id}.json`;
    askFiles.set(item.id, askAttachment);
    askAttachment = null;
  }
  if (kind === "ask" && voiceSaid && voiceSaid === q) item.spoken = true; // sent as it was spoken
  voiceSaid = "";
  if (kind === "sort") item.kind = "sort";
  else if (askThread && loadAskEntries().some((e) => e.id === askThread)) item.thread = askThread;
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
      const att = q.file ? askFiles.get(q.id) : null;
      await askWriteFile(
        (items) => [
          ...items.filter((i) => i.id !== q.id),
          {
            id: q.id,
            kind: q.kind === "sort" ? "sort" : "ask",
            text: q.text,
            at: new Date(q.at).toISOString(),
            ...(q.thread ? { thread: q.thread } : {}),
            ...(att ? { file: q.file } : {}),
          },
        ],
        // the photo or PDF goes in the same write, as its own file (the Ask run deletes it)
        att ? { [q.file]: JSON.stringify({ version: 1, name: att.name, mime: att.mime, data: att.data }) } : null,
      );
      askFiles.delete(q.id);
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
    if (askGet("sync-gist-id")) {
      const g = await withGist((id) => gistApi("/gists/" + id));
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
// This month's Ask spending, from the backend's usage counts (0 once a new month starts)
function askMonthSpent() {
  const u = loadAnswers().usage;
  if (!u || !u.month) return null;
  return u.month === isoDate(new Date()).slice(0, 7)
    ? u.monthCostUsd
    : u.month < isoDate(new Date()).slice(0, 7)
      ? 0
      : null;
}
function askUsageText() {
  const spent = askMonthSpent();
  return spent == null ? "" : `$${spent.toFixed(2)} of $${ASK_MONTH_BUDGET} used this month`;
}
// The usage chip at the top of Console ("$0.18/$20") and the limit it opens
function askUsageShort() {
  const spent = askMonthSpent();
  return spent == null ? "Limits" : `$${spent.toFixed(2)}/$${ASK_MONTH_BUDGET}`;
}
function askUsagePopHtml() {
  const t = askUsageText();
  return `${t ? `<p>${escapeHtml(t)}.</p>` : ""}<p>Limit: $${ASK_MONTH_BUDGET} a month, however many questions that is. Web answers cost a little more.</p>`;
}
function askNextRunText(now = new Date()) {
  return `Queued — Jarvis will answer on the next run (${now.getHours() < 6 ? "today" : "tomorrow"} ~6am)`;
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
  over_limit: ["Over the limit", "This was over the month's Ask budget, so Jarvis didn't answer it."],
  error: ["Jarvis couldn't answer", "Something went wrong on Jarvis's side. Try asking again."],
  declined: ["Jarvis didn't answer this", "This one is outside what Jarvis can answer from your data."],
};
function askAnswerHtml(q) {
  const a = q.answer;
  const id = escapeAttr(a.id);
  const answered = Date.parse(a.answeredAt);
  const when = isFinite(answered) ? `Answered ${askTime(answered)}` : "";
  if (a.status === "declined" || a.status === "over_limit") {
    // one quiet line; the reason opens under it
    const [title, plain] = ASK_FLAGS[a.status];
    return `<details class="ak-flag-line ak-${a.status}">
        <summary><span class="cn-dot" aria-hidden="true"></span><span class="ak-flag-what">${title}</span><span class="ak-why">Why</span>${isFinite(answered) ? `<time class="ak-meta">${escapeHtml(askTime(answered))}</time>` : ""}</summary>
        <p class="ak-text">${escapeHtml(a.text || plain)}</p>
        ${a.status === "over_limit" ? `<p class="ak-meta">Limit: $${ASK_MONTH_BUDGET} a month.</p>` : ""}
      </details>`;
  }
  if (a.status !== "ok") {
    const [title, plain] = ASK_FLAGS[a.status];
    const again =
      a.status === "error" && q.text
        ? `<button type="button" class="cn-link" data-action="ask-again" data-ask-id="${id}">Ask again</button>`
        : "";
    return `<div class="ak-ans ak-flagged ak-${a.status}">
        <b class="ak-flag">${title}</b>
        <p class="ak-text">${escapeHtml(a.text || plain)}</p>
        ${a.status === "over_limit" ? `<p class="ak-meta">Limit: $${ASK_MONTH_BUDGET} a month.</p>` : ""}
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
  const acts = a.actions.length
    ? `<ul class="ak-acts" aria-label="What Jarvis did">${a.actions.map((x) => `<li><span aria-hidden="true">✓</span>${escapeHtml(x.label)}</li>`).join("")}</ul>`
    : "";
  const links = a.links
    .map((l) => linkHtml(l.url, 'class="ak-link"', `<span aria-hidden="true">↗</span> ${escapeHtml(l.title)}`))
    .filter(Boolean)
    .join("");
  return `<div class="ak-ans">
      ${a.text ? `<p class="ak-text">${escapeHtml(a.text)}</p>` : bullets ? "" : '<p class="ak-text">Jarvis didn\'t say anything.</p>'}
      ${acts}
      ${bullets}
      ${links ? `<div class="ak-links">${links}</div>` : ""}
      ${chips ? `<div class="rv-chips ak-chips" role="group" aria-label="Suggestions: tap one to add it">${chips}</div>` : ""}
      ${srcs}
      <div class="ak-foot">
        ${q.kind === "sort" ? "" : `<button type="button" class="cn-link" data-action="ask-follow" data-ask-id="${id}" aria-label="Follow up on this answer">Follow up</button>`}
        <span class="ak-meta">${escapeHtml([a.by === "fallback" ? "Put together automatically (Jarvis didn't finish)" : "", when].filter(Boolean).join(" · "))}</span>
        ${speakBtnHtml("ask:" + a.id, "ask-speak", `data-ask-id="${id}"`, "Read this answer aloud")}
        ${a.by === "jarvis" ? brainRateHtml("answer", a.id) : ""}
      </div>
    </div>`;
}
// One question and its answer (or status); repeats: the same question asked again in a row
function askEntryHtml(q) {
  const said = q.text
    ? escapeHtml(q.text)
    : q.answer && q.answer.checkin
      ? `<span class="ak-thread">Check-in</span> ${escapeHtml(q.answer.checkin)}`
      : '<span class="ak-other">Asked on another device</span>';
  const clip = q.file ? '<span class="ak-thread" aria-label="with a file">📎</span> ' : "";
  const follow =
    q.kind === "sort"
      ? '<span class="ak-thread">Sort</span> '
      : q.thread
        ? '<span class="ak-thread">Follow-up</span> '
        : "";
  return `<li class="cn-entry ak-entry" data-ask-entry="${escapeAttr(q.id)}" tabindex="-1">
    <span class="cn-who">You</span><p class="cn-said">${clip}${follow}${said}${q.repeats ? ` <span class="ak-repeat" aria-label="asked ${q.repeats + 1} times">×${q.repeats + 1}</span>` : ""} <time class="cn-time">${escapeHtml(askTime(q.at))}</time></p>
    <span class="cn-who cn-j">J</span><div class="cn-reply">${q.answer ? askAnswerHtml(q) : askStatusHtml(q)}</div>
  </li>`;
}
// The conversation shows today and yesterday; Earlier (askShowAll) shows every kept question.
// The same question asked again in a row, with the same kind of non-answer, shows once (×2).
function askFeedEntries() {
  const from = noonOf(addDaysIso(-1)).getTime() - 12 * 3600e3; // yesterday's midnight
  const list = loadAskEntries().filter((q) => askShowAll || q.at >= from);
  const out = [];
  list.forEach((q) => {
    const prev = out[out.length - 1];
    const same =
      prev &&
      q.text &&
      prev.text.trim().toLowerCase() === q.text.trim().toLowerCase() &&
      prev.answer &&
      q.answer &&
      prev.answer.status !== "ok" &&
      prev.answer.status === q.answer.status;
    if (same) prev.repeats = (prev.repeats || 0) + 1;
    else out.push({ ...q });
  });
  return out;
}
// Questions kept but older than the conversation shows (for its Earlier row)
function askEarlierCount() {
  if (askShowAll) return 0;
  const from = noonOf(addDaysIso(-1)).getTime() - 12 * 3600e3;
  return loadAskEntries().filter((q) => q.at < from).length;
}
function askShowEarlier() {
  askShowAll = true;
  renderConsole();
}

// ---- the Ask hint and notes under the box ----
function askHint() {
  if (!askSyncOn()) return ASK_NEEDS_SYNC;
  if (askGet(ASK_TOKEN_BAD_KEY) && askToken()) return ASK_KEY_BROKEN + ". Questions wait for the next run.";
  if (!askToken())
    return "Questions wait for Jarvis's next run (~6am). Add an Ask Jarvis key in Settings → Sync for answers in about a minute.";
  return "";
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
  askShowAll = false;
  renderConsole();
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
  if (c.kind === "expense") {
    // only offered: Budget's add sheet opens filled in, to check before saving
    openComposer("money");
    document.getElementById("composer-text").value = `${c.text} $${c.amount}`;
    composerTextChanged();
    return;
  }
  const key = `${e.id}|${i}`;
  if (askTapped.has(key) || reviewChipOnList(c)) {
    showToast("Already on your list");
    return;
  }
  const { before, after } = jarvisChipAdd(c);
  askTapped.add(key);
  renderConsole();
  const chip = document.querySelector(`#cn-feed .rv-chip[data-ask-id="${CSS.escape(e.id)}"][data-index="${i}"]`);
  if (chip) chip.focus({ preventScroll: true });
  showUndoToast(c.kind === "todo" ? "Added to To-Do" : "Added to Shopping", () => {
    undoTo(before, after);
    askTapped.delete(key);
    renderConsole();
  });
}
function askFollow(id) {
  const e = askEntryById(id);
  if (!e || !e.answer) return;
  askThread = e.thread || e.id;
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
  input.value = e.text;
  consoleSetMode("ask");
  input.focus();
}

// ---- ?tab=console&ask=<id> (the "ask" push) ----
function askFocusEntry(id) {
  const inFeed = document.querySelector(`#cn-feed [data-ask-entry="${CSS.escape(id)}"]`);
  let el = inFeed;
  const entries = loadAskEntries();
  const entry = entries.find((e) => e.id === id);
  if (!el && entry) {
    // an earlier day's question: open its day's thread (placed by the chain's newest message), and
    // if it's older than the conversation shows, the whole conversation too
    const root = entry.thread || entry.id;
    const newest = Math.max(...entries.filter((e) => (e.thread || e.id) === root).map((e) => e.at));
    consoleDaysOpen.add(isoDate(new Date(newest)));
    try {
      localStorage.setItem(CONSOLE_FEED_OPEN_KEY, "1");
    } catch (e) {}
    renderConsole();
    el = document.querySelector(`#cn-feed [data-ask-entry="${CSS.escape(id)}"]`);
    if (!el) {
      askShowAll = true;
      renderConsole();
      el = document.querySelector(`#cn-feed [data-ask-entry="${CSS.escape(id)}"]`);
    }
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
