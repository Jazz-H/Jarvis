// brain.js - Jarvis's brain: what Jarvis remembers about you, how you've rated its answers and
// briefings, its settings (tone, news topics, a note about you) and your own check-ins.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- JARVIS'S BRAIN ----------
// Four synced keys, all written only here (the Jarvis Action reads them from jazz2-data.json):
//   jarvis-notes:    [{id, title, text, at: "YYYY-MM-DD", by: "you" | "jarvis"}]   at most 30 (the Notebook:
//                    longer notes by topic; title 60, text 2,000 characters; newest first)
//   jarvis-memory:   [{id, text, at: "YYYY-MM-DD", by: "you" | "jarvis"}]   at most 60
//   jarvis-feedback: [{id, at: ms, kind: "answer" | "briefing", ref, item, vote: 1 | -1}]   newest 60
//   jarvis-settings: {tone: "brief" | "normal" | "detailed", newsTopics: [..6], about,
//                     speak: "voice" | "always" | "never",
//                     checkins: [{id, name, prompt, days: [0-6], time: "HH:MM", on}]   at most 8,
//                     hiddenPackages: [{item, at: "YYYY-MM-DD"}]   newest first, 20, gone after 14 days,
//                     hiddenLines: [{text, at: "YYYY-MM-DD"}]   briefing lines dismissed, 10, gone after 2 days
//                     hiddenSuggestions: [{text, at: "YYYY-MM-DD"}]   suggested to-dos dismissed, 20, gone after 14 days}
// Synced data is untrusted: every field is checked and capped here and on the way back in.
const BRAIN_MAX = {
  notes: 30,
  noteTitle: 60,
  noteText: 2000,
  memory: 60,
  feedback: 60,
  checkins: 8,
  topics: 6,
  hiddenPackages: 20,
  hiddenDays: 14,
  hiddenLines: 10,
  hiddenSuggestions: 20,
};
const BRAIN_TONES = { brief: "Brief", normal: "Normal", detailed: "Detailed" };
const BRAIN_SPEAK = { voice: "When I ask by voice", always: "Always", never: "Never" }; // read answers aloud
let jarvisMemory = [];
let jarvisNotes = [];
let jarvisFeedback = [];
let jarvisSettings = {
  tone: "normal",
  newsTopics: [],
  about: "",
  speak: "voice",
  checkins: [],
  hiddenPackages: [],
  hiddenLines: [],
  hiddenSuggestions: [],
  location: null,
};

function normalizeJarvisBrain() {
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const str = (v, n) =>
    String(v == null ? "" : v)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, n);
  const day = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : addDaysIso(0));
  const seen = new Set();
  jarvisMemory = (Array.isArray(jarvisMemory) ? jarvisMemory : [])
    .filter((m) => isObj(m) && str(m.text, 200))
    .map((m) => ({
      id: safeId(m.id, "mem"),
      text: str(m.text, 200),
      at: day(m.at),
      by: m.by === "jarvis" ? "jarvis" : "you",
    }))
    .filter((m) => !seen.has(m.text.toLowerCase()) && seen.add(m.text.toLowerCase()))
    .slice(0, BRAIN_MAX.memory);
  jarvisNotes = brainUniqueTitles(
    (Array.isArray(jarvisNotes) ? jarvisNotes : [])
      .filter((n) => isObj(n) && str(n.title, BRAIN_MAX.noteTitle))
      .map((n) => ({
        id: safeId(n.id, "note"),
        title: str(n.title, BRAIN_MAX.noteTitle),
        text: String(n.text == null ? "" : n.text)
          .replace(/\r\n?/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
          .slice(0, BRAIN_MAX.noteText),
        at: day(n.at),
        by: n.by === "jarvis" ? "jarvis" : "you",
      })),
  ).slice(0, BRAIN_MAX.notes);
  jarvisFeedback = (Array.isArray(jarvisFeedback) ? jarvisFeedback : [])
    .filter((f) => isObj(f) && (f.kind === "answer" || f.kind === "briefing") && (f.vote === 1 || f.vote === -1))
    .map((f) => ({
      id: safeId(f.id, "fb"),
      at: Number(f.at) || 0,
      kind: f.kind,
      ref: SAFE_ID.test(String(f.ref)) ? String(f.ref) : "",
      item: str(f.item, 200),
      vote: f.vote,
    }))
    .filter((f) => f.ref)
    .sort((a, b) => b.at - a.at)
    .slice(0, BRAIN_MAX.feedback);
  const s = isObj(jarvisSettings) ? jarvisSettings : {};
  jarvisSettings = {
    tone: BRAIN_TONES[s.tone] ? s.tone : "normal",
    newsTopics: (Array.isArray(s.newsTopics) ? s.newsTopics : [])
      .map((t) => str(t, 30))
      .filter(Boolean)
      .slice(0, BRAIN_MAX.topics),
    about: str(s.about, 600),
    speak: BRAIN_SPEAK[s.speak] ? s.speak : "voice",
    checkins: (Array.isArray(s.checkins) ? s.checkins : [])
      .filter((c) => isObj(c) && str(c.prompt, 300))
      .slice(0, BRAIN_MAX.checkins)
      .map((c) => ({
        id: safeId(c.id, "ci"),
        name: str(c.name, 40) || "Check-in",
        prompt: str(c.prompt, 300),
        days: [...new Set((Array.isArray(c.days) ? c.days : []).map(Number))]
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
          .sort(),
        time: typeof c.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(c.time) ? c.time : "08:00",
        on: c.on !== false,
      })),
    hiddenPackages: dismissedList(s.hiddenPackages, "item", 80, BRAIN_MAX.hiddenDays, BRAIN_MAX.hiddenPackages),
    hiddenLines: dismissedList(s.hiddenLines, "text", 200, 2, BRAIN_MAX.hiddenLines),
    hiddenSuggestions: dismissedList(
      s.hiddenSuggestions,
      "text",
      80,
      BRAIN_MAX.hiddenDays,
      BRAIN_MAX.hiddenSuggestions,
    ),
    location: savedLocation(s.location),
  };
}
// Where you are, for the weather: {lat, lon} to 3 decimals (about 100 m) and the day it was saved
function savedLocation(l) {
  if (!l || typeof l !== "object") return null;
  const lat = Number(l.lat),
    lon = Number(l.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return {
    lat: Math.round(lat * 1000) / 1000,
    lon: Math.round(lon * 1000) / 1000,
    at: typeof l.at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(l.at) ? l.at : "",
  };
}
// What you dismissed on Home (jarvis.js): [{[field]: name, at}] from the last `days`, no repeats, newest first
function dismissedList(list, field, max, days, n) {
  const since = addDaysIso(-days),
    seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter(
      (h) =>
        h && typeof h === "object" && typeof h.at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.at) && h.at >= since,
    )
    .map((h) => ({
      [field]: String(h[field] == null ? "" : h[field])
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max),
      at: h.at,
    }))
    .filter((h) => h[field] && !seen.has(h[field].toLowerCase()) && seen.add(h[field].toLowerCase()))
    .slice(0, n);
}
function saveBrain(key) {
  if (key === "jarvis-memory") saveContent(key, jarvisMemory, { toast: false });
  else if (key === "jarvis-notes") saveContent(key, jarvisNotes, { toast: false });
  else if (key === "jarvis-feedback") saveContent(key, jarvisFeedback, { toast: false });
  else saveContent("jarvis-settings", jarvisSettings, { toast: false });
  renderConsole();
}

// ---- your location (Weather) ----
// "Use my location" saves this phone's position in jarvis-settings (synced, never shown); the next
// briefing's weather and 90-day outlook are for it. Once saved, opening the app on a device that
// already allows location keeps it current, saving only a move of 1 km or more.
function weatherUseLocation(quiet = false) {
  const fail = (msg) => !quiet && showToast(msg, true);
  if (!navigator.geolocation) return fail("Location isn't available on this device");
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const next = savedLocation({ lat: p.coords.latitude, lon: p.coords.longitude, at: addDaysIso(0) });
      if (!next) return fail("Couldn't read your location");
      const old = jarvisSettings.location;
      if (quiet && old && locationKm(old, next) < 1) return;
      jarvisSettings.location = next;
      saveBrain("jarvis-settings");
      renderHome();
      if (!quiet) showToast("Location saved: the next briefing's weather is for where you are");
    },
    (e) =>
      fail(
        e && e.code === 1
          ? "Location is blocked for this site: allow it in your browser's settings"
          : "Couldn't get your location",
      ),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10 * 60 * 1000 },
  );
}
function weatherForgetLocation() {
  jarvisSettings.location = null;
  saveBrain("jarvis-settings");
  renderHome();
  showToast("Location forgotten: the weather goes back to the default city");
}
function weatherRefreshLocation() {
  if (!jarvisSettings.location || !navigator.geolocation || !navigator.permissions) return;
  navigator.permissions
    .query({ name: "geolocation" })
    .then((s) => s.state === "granted" && weatherUseLocation(true))
    .catch(() => {});
}
// Distance in km between two saved locations (equirectangular: plenty at these distances)
function locationKm(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  return Math.hypot(x, (b.lat - a.lat) * rad) * 6371;
}

// ---- memory ----
function brainRemember(text, by = "you") {
  const t = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  if (!t || jarvisMemory.some((m) => m.text.toLowerCase() === t.toLowerCase())) return false;
  jarvisMemory.unshift({ id: genId("mem"), text: t, at: addDaysIso(0), by });
  jarvisMemory = jarvisMemory.slice(0, BRAIN_MAX.memory);
  saveBrain("jarvis-memory");
  return true;
}
function brainForget(id) {
  const before = jarvisMemory.length;
  jarvisMemory = jarvisMemory.filter((m) => m.id !== id);
  if (jarvisMemory.length === before) return false;
  saveBrain("jarvis-memory");
  return true;
}
function brainAddMemory() {
  openModal(
    "Remember something",
    [
      { key: "text", label: "Something Jarvis should keep in mind", type: "text" },
      {
        type: "note",
        label: "For example: “I don't eat pork”, “Payday moves early in December”, “Mom's birthday is Mar 3”.",
      },
    ],
    {},
    (v) => {
      if (brainRemember(v.text)) showToast("Jarvis will remember that");
    },
  );
}

// ---- the Notebook ----
// A note with the same title (any case) is the same note: saving again adds to it. Jarvis writes
// here only through an Ask action ("save that as a note", "add this to my car note"), with Undo.
// Titles are unique, but two devices can each save a note under the same one and sync then holds both.
// Only a true repeat (same title, same text) goes; the other keeps its text under "Title (2)".
function brainUniqueTitles(notes) {
  const taken = new Set(notes.map((n) => n.title.toLowerCase()));
  const textsByTitle = new Map();
  const out = [];
  notes.forEach((n) => {
    const key = n.title.toLowerCase();
    const texts = textsByTitle.get(key);
    if (!texts) {
      textsByTitle.set(key, new Set([n.text]));
      out.push(n);
      return;
    }
    if (texts.has(n.text)) return;
    texts.add(n.text);
    let title;
    for (let i = 2; !title || taken.has(title.toLowerCase()); i++) {
      const tag = ` (${i})`;
      title = n.title.slice(0, BRAIN_MAX.noteTitle - tag.length).trimEnd() + tag;
    }
    taken.add(title.toLowerCase());
    out.push({ ...n, title });
  });
  return out;
}
function brainSaveNote(title, text, by = "you") {
  const t = String(title || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BRAIN_MAX.noteTitle);
  const body = String(text || "").trim();
  if (!t || !body) return false;
  const old = jarvisNotes.find((n) => n.title.toLowerCase() === t.toLowerCase());
  if (old) return brainAppendNote(old.id, body, by);
  if (jarvisNotes.length >= BRAIN_MAX.notes) return false;
  jarvisNotes.unshift({ id: genId("note"), title: t, text: body, at: addDaysIso(0), by });
  normalizeJarvisBrain();
  saveBrain("jarvis-notes");
  return true;
}
function brainAppendNote(id, text, by = "you") {
  const n = jarvisNotes.find((x) => x.id === id);
  const body = String(text || "").trim();
  if (!n || !body || n.text.includes(body)) return false;
  n.text = `${n.text}\n\n${body}`.slice(0, BRAIN_MAX.noteText);
  n.at = addDaysIso(0);
  if (by === "jarvis") n.by = "jarvis";
  jarvisNotes = [n, ...jarvisNotes.filter((x) => x !== n)]; // newest first
  normalizeJarvisBrain();
  saveBrain("jarvis-notes");
  return true;
}
function brainEditNote(id) {
  const n = id ? jarvisNotes.find((x) => x.id === id) : null;
  if (!n && jarvisNotes.length >= BRAIN_MAX.notes) {
    showToast(`Up to ${BRAIN_MAX.notes} notes`, true);
    return;
  }
  openModal(
    n ? "Edit note" : "New note",
    [
      { key: "title", label: "Title (e.g. Car, Lease, Health)", type: "text" },
      { key: "text", label: "Note", type: "textarea" },
      {
        type: "note",
        label: "Jarvis reads your notes when it answers. Longer than a fact: what you'd want it to know about a topic.",
      },
    ],
    n ? { title: n.title, text: n.text } : {},
    (v) => {
      const title = String(v.title || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, BRAIN_MAX.noteTitle);
      const text = String(v.text || "")
        .trim()
        .slice(0, BRAIN_MAX.noteText);
      if (!title || !text) {
        showToast("Give the note a title and some text", true);
        return;
      }
      if (n) {
        n.title = title;
        n.text = text;
        n.at = addDaysIso(0);
        normalizeJarvisBrain();
        saveBrain("jarvis-notes");
      } else brainSaveNote(title, text);
    },
    n
      ? () => {
          jarvisNotes = jarvisNotes.filter((x) => x.id !== id);
          saveBrain("jarvis-notes");
        }
      : null,
  );
}
// "Harvest": finishing a to-do with steps offers to keep a note of it (the completed toast's Note it)
function brainHarvestTodo(t) {
  const steps = (t.subitems || []).map((s) => s.text).filter(Boolean);
  consoleHandOff(
    `Jarvis, save a short note about finishing "${t.text}"${steps.length ? `. Steps: ${steps.join("; ")}` : ""}. Put it in the note it belongs to, or a new one.`,
  );
}

// ---- ratings ----
// One rating per answer or briefing: tapping the same one again takes it back
function brainRate(kind, ref, vote) {
  if ((kind !== "answer" && kind !== "briefing") || !SAFE_ID.test(String(ref)) || (vote !== 1 && vote !== -1)) return;
  const old = jarvisFeedback.find((f) => f.kind === kind && f.ref === ref);
  jarvisFeedback = jarvisFeedback.filter((f) => f !== old);
  if (!old || old.vote !== vote) {
    const item = kind === "briefing" ? (loadBriefing() || {}).headline || "" : brainAnswerItem(ref);
    jarvisFeedback.unshift({ id: genId("fb"), at: Date.now(), kind, ref, item: String(item).slice(0, 200), vote });
    jarvisFeedback = jarvisFeedback.slice(0, BRAIN_MAX.feedback);
  }
  saveContent("jarvis-feedback", jarvisFeedback, { toast: false });
  renderConsole();
  renderHome();
  showToast(!old || old.vote !== vote ? "Thanks: Jarvis will take that into account" : "Rating removed");
}
function brainAnswerItem(id) {
  const e = typeof askEntryById === "function" ? askEntryById(id) : null;
  return e ? e.text || (e.answer && e.answer.text) || "" : "";
}
function brainVote(kind, ref) {
  const f = jarvisFeedback.find((x) => x.kind === kind && x.ref === ref);
  return f ? f.vote : 0;
}
// 👍 / 👎 for an answer or a briefing (data-action="jv-rate")
function brainRateHtml(kind, ref) {
  const v = brainVote(kind, ref),
    r = escapeAttr(ref);
  const btn = (vote, icon, label) =>
    `<button type="button" class="jv-rate${v === vote ? " on" : ""}" data-action="jv-rate" data-kind="${kind}" data-ref="${r}" data-vote="${vote}" aria-pressed="${v === vote}" aria-label="${label}">${icon}</button>`;
  return `<span class="jv-rates">${btn(1, "👍", "Useful")}${btn(-1, "👎", "Not useful")}</span>`;
}

// ---- settings ----
function brainEditTone() {
  const labels = Object.values(BRAIN_TONES);
  openModal(
    "How Jarvis writes",
    [
      { key: "tone", label: "Length and detail", type: "select", options: labels },
      {
        type: "note",
        label: "Brief keeps answers and briefings as short as possible; Detailed adds a little more context.",
      },
    ],
    { tone: BRAIN_TONES[jarvisSettings.tone] },
    (v) => {
      const key = Object.keys(BRAIN_TONES).find((k) => BRAIN_TONES[k] === v.tone);
      if (key) jarvisSettings.tone = key;
      saveBrain("jarvis-settings");
    },
  );
}
function brainEditSpeak() {
  const labels = Object.values(BRAIN_SPEAK);
  openModal(
    "Read answers aloud",
    [
      { key: "speak", label: "Jarvis reads a new answer aloud", type: "select", options: labels },
      {
        type: "note",
        label: "Only while the app is on screen. Every answer also has a 🔊 button, and so does the briefing.",
      },
    ],
    { speak: BRAIN_SPEAK[jarvisSettings.speak] },
    (v) => {
      const key = Object.keys(BRAIN_SPEAK).find((k) => BRAIN_SPEAK[k] === v.speak);
      if (key) jarvisSettings.speak = key;
      saveBrain("jarvis-settings");
    },
  );
}
function brainEditTopics() {
  openModal(
    "News topics",
    [
      { key: "topics", label: "Topics, separated by commas (up to 6)", type: "text" },
      {
        type: "note",
        label:
          "Leave empty for the usual mix: AI, tech, cars and what's trending. Used from the next morning's briefing.",
      },
    ],
    { topics: jarvisSettings.newsTopics.join(", ") },
    (v) => {
      jarvisSettings.newsTopics = String(v.topics || "")
        .split(",")
        .map((t) => t.trim().slice(0, 30))
        .filter(Boolean)
        .slice(0, BRAIN_MAX.topics);
      saveBrain("jarvis-settings");
    },
  );
}
function brainEditAbout() {
  openModal(
    "About you",
    [
      { key: "about", label: "Anything Jarvis should know about you", type: "textarea" },
      {
        type: "note",
        label: "Your job, your routines, what matters to you. Jarvis reads it with every briefing and answer.",
      },
    ],
    { about: jarvisSettings.about },
    (v) => {
      jarvisSettings.about = String(v.about || "")
        .trim()
        .slice(0, 600);
      saveBrain("jarvis-settings");
    },
  );
}

// ---- check-ins ----
// A ready-made one: the evening look back at the briefing's Top 3 (you can change it before saving)
const TOP3_CHECKIN = {
  name: "Top 3 recap",
  prompt: "How did today's Top 3 go? Say which are done and suggest when to fit in the rest.",
  days: [0, 1, 2, 3, 4, 5, 6],
  time: "20:00",
};
function brainEditCheckin(id, preset = null) {
  const c = id ? jarvisSettings.checkins.find((x) => x.id === id) : null;
  if (!c && jarvisSettings.checkins.length >= BRAIN_MAX.checkins) {
    showToast(`Up to ${BRAIN_MAX.checkins} check-ins`, true);
    return;
  }
  openModal(
    c ? "Edit check-in" : "New check-in",
    [
      { key: "name", label: "Name (e.g. Plan my week)", type: "text" },
      { key: "prompt", label: "What Jarvis should do", type: "textarea" },
      { key: "days", label: "Days", type: "days" },
      { key: "time", label: "Time", type: "time" },
      {
        type: "note",
        label: "Jarvis sends it as a notification and in Console. It counts as a question toward your limits.",
      },
    ],
    c
      ? { name: c.name, prompt: c.prompt, days: c.days, time: c.time }
      : preset
        ? { ...preset }
        : { days: [0], time: "20:00" },
    (v) => {
      const prompt = String(v.prompt || "")
        .trim()
        .slice(0, 300);
      if (!prompt || !(v.days || []).length) {
        showToast("Say what Jarvis should do, and pick at least one day", true);
        return;
      }
      const t = c || { id: genId("ci"), on: true };
      t.name =
        String(v.name || "")
          .trim()
          .slice(0, 40) || "Check-in";
      t.prompt = prompt;
      t.days = v.days;
      t.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(v.time || "") ? v.time : "08:00";
      if (!c) jarvisSettings.checkins.push(t);
      saveBrain("jarvis-settings");
    },
    c
      ? () => {
          jarvisSettings.checkins = jarvisSettings.checkins.filter((x) => x.id !== id);
          saveBrain("jarvis-settings");
        }
      : null,
  );
}
function brainCheckinWhen(c) {
  const days = c.days.length === 7 ? "Every day" : c.days.map((d) => DAY_SHORT[d]).join(" · ");
  return `${days} · ${fmtTime(c.time)}`;
}

// ---- the card in Console ----
function brainCardHtml() {
  const s = jarvisSettings;
  const mem = jarvisMemory.length
    ? `<ul class="br-mem">${jarvisMemory
        .map(
          (m) =>
            `<li><span>${escapeHtml(m.text)}${m.by === "jarvis" ? " <small>from a chat</small>" : ""}</span><button type="button" class="br-x" data-action="brain-forget" data-mem-id="${escapeAttr(m.id)}" aria-label="Forget: ${escapeAttr(m.text)}">&times;</button></li>`,
        )
        .join("")}</ul>`
    : `<p class="br-empty">Nothing yet. Tell Jarvis “remember …” in a chat, or add it here.</p>`;
  const row = (action, label, value) =>
    `<button type="button" class="br-row" data-action="${action}"><span>${label}</span><b>${escapeHtml(value)}</b>${CHEVRON_RIGHT}</button>`;
  const checkins = s.checkins
    .map(
      (c) =>
        `<button type="button" class="br-row" data-action="brain-checkin" data-ci-id="${escapeAttr(c.id)}"><span>${escapeHtml(c.name)}</span><b>${escapeHtml(brainCheckinWhen(c))}</b>${CHEVRON_RIGHT}</button>`,
    )
    .join("");
  const month = Date.now() - 30 * 864e5;
  const recent = jarvisFeedback.filter((f) => f.at >= month);
  const up = recent.filter((f) => f.vote > 0).length,
    down = recent.length - up;
  return collapsibleCard({
    id: "cn-brain-card",
    title: "Jarvis's brain",
    insight: `${jarvisMemory.length} fact${jarvisMemory.length === 1 ? "" : "s"}${jarvisNotes.length ? ` · ${jarvisNotes.length} note${jarvisNotes.length === 1 ? "" : "s"}` : ""}`,
    body: `<div class="jv-sub-label">Remembers</div>${mem}
      <button type="button" class="add-row" data-action="brain-add-memory">+ Remember something</button>
      <div class="jv-sub-label">Notebook</div>
      ${
        jarvisNotes.length
          ? jarvisNotes
              .map(
                (n) =>
                  `<button type="button" class="br-row" data-action="brain-note" data-note-id="${escapeAttr(n.id)}"><span>${escapeHtml(n.title)}</span><b>${escapeHtml(noonOf(n.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }))}${n.by === "jarvis" ? " · Jarvis" : ""}</b>${CHEVRON_RIGHT}</button>`,
              )
              .join("")
          : `<p class="br-empty">Longer notes by topic (your car, the lease, health) that Jarvis reads when it answers. Add one, or tell Jarvis “save that as a note”.</p>`
      }
      <button type="button" class="add-row" data-action="brain-note">+ New note</button>
      <div class="jv-sub-label">Settings</div>
      ${row("brain-tone", "How it writes", BRAIN_TONES[s.tone])}
      ${speakSupported() ? row("brain-speak", "Read answers aloud", BRAIN_SPEAK[s.speak]) : ""}
      ${row("brain-topics", "News topics", s.newsTopics.length ? s.newsTopics.join(", ") : "AI, tech, cars, trending")}
      ${row("brain-about", "About you", s.about ? (s.about.length > 40 ? s.about.slice(0, 39) + "…" : s.about) : "Add a note")}
      <div class="jv-sub-label">Check-ins</div>
      ${checkins || `<p class="br-empty">Your own scheduled prompts, like “Every Sunday at 8 PM, plan my week”.</p>`}
      <button type="button" class="add-row" data-action="brain-checkin">+ New check-in</button>
      ${s.checkins.some((c) => c.name === TOP3_CHECKIN.name) ? "" : '<button type="button" class="add-row" data-action="brain-checkin" data-preset="top3">+ Evening Top 3 recap</button>'}
      <p class="br-foot">Ratings in the last 30 days: ${up} 👍 · ${down} 👎. Jarvis reads your latest ones to do better.</p>`,
  });
}
