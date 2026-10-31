// brain.js - Jarvis's brain: what Jarvis remembers about you, how you've rated its answers and
// briefings, its settings (tone, news topics, a note about you) and your own check-ins.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- JARVIS'S BRAIN ----------
// Three synced keys, all written only here (the Jarvis Action reads them from jazz2-data.json):
//   jarvis-memory:   [{id, text, at: "YYYY-MM-DD", by: "you" | "jarvis"}]   at most 60
//   jarvis-feedback: [{id, at: ms, kind: "answer" | "briefing", ref, item, vote: 1 | -1}]   newest 60
//   jarvis-settings: {tone: "brief" | "normal" | "detailed", newsTopics: [..6], about,
//                     checkins: [{id, name, prompt, days: [0-6], time: "HH:MM", on}]   at most 8}
// Synced data is untrusted: every field is checked and capped here and on the way back in.
const BRAIN_MAX = { memory: 60, feedback: 60, checkins: 8, topics: 6 };
const BRAIN_TONES = { brief: "Brief", normal: "Normal", detailed: "Detailed" };
let jarvisMemory = [];
let jarvisFeedback = [];
let jarvisSettings = { tone: "normal", newsTopics: [], about: "", checkins: [] };

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
    .map((m) => ({ id: safeId(m.id, "mem"), text: str(m.text, 200), at: day(m.at), by: m.by === "jarvis" ? "jarvis" : "you" }))
    .filter((m) => !seen.has(m.text.toLowerCase()) && seen.add(m.text.toLowerCase()))
    .slice(0, BRAIN_MAX.memory);
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
    checkins: (Array.isArray(s.checkins) ? s.checkins : [])
      .filter((c) => isObj(c) && str(c.prompt, 300))
      .slice(0, BRAIN_MAX.checkins)
      .map((c) => ({
        id: safeId(c.id, "ci"),
        name: str(c.name, 40) || "Check-in",
        prompt: str(c.prompt, 300),
        days: [...new Set((Array.isArray(c.days) ? c.days : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort(),
        time: typeof c.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(c.time) ? c.time : "08:00",
        on: c.on !== false,
      })),
  };
}
function saveBrain(key) {
  if (key === "jarvis-memory") saveContent(key, jarvisMemory, { toast: false });
  else if (key === "jarvis-feedback") saveContent(key, jarvisFeedback, { toast: false });
  else saveContent("jarvis-settings", jarvisSettings, { toast: false });
  renderConsole();
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
      { type: "note", label: "For example: “I don't eat pork”, “Payday moves early in December”, “Mom's birthday is Mar 3”." },
    ],
    {},
    (v) => {
      if (brainRemember(v.text)) showToast("Jarvis will remember that");
    },
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
      { type: "note", label: "Brief keeps answers and briefings as short as possible; Detailed adds a little more context." },
    ],
    { tone: BRAIN_TONES[jarvisSettings.tone] },
    (v) => {
      const key = Object.keys(BRAIN_TONES).find((k) => BRAIN_TONES[k] === v.tone);
      if (key) jarvisSettings.tone = key;
      saveBrain("jarvis-settings");
    },
  );
}
function brainEditTopics() {
  openModal(
    "News topics",
    [
      { key: "topics", label: "Topics, separated by commas (up to 6)", type: "text" },
      { type: "note", label: "Leave empty for the usual mix: AI, tech, cars and what's trending. Used from the next morning's briefing." },
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
      { type: "note", label: "Your job, your routines, what matters to you. Jarvis reads it with every briefing and answer." },
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
function brainEditCheckin(id) {
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
    c ? { name: c.name, prompt: c.prompt, days: c.days, time: c.time } : { days: [0], time: "20:00" },
    (v) => {
      const prompt = String(v.prompt || "").trim().slice(0, 300);
      if (!prompt || !(v.days || []).length) {
        showToast("Say what Jarvis should do, and pick at least one day", true);
        return;
      }
      const t = c || { id: genId("ci"), on: true };
      t.name = String(v.name || "").trim().slice(0, 40) || "Check-in";
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
            `<li><span>${escapeHtml(m.text)}${m.by === "jarvis" ? ' <small>from a chat</small>' : ""}</span><button type="button" class="br-x" data-action="brain-forget" data-mem-id="${escapeAttr(m.id)}" aria-label="Forget: ${escapeAttr(m.text)}">&times;</button></li>`,
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
    insight: `${jarvisMemory.length} fact${jarvisMemory.length === 1 ? "" : "s"}`,
    body: `<div class="jv-sub-label">Remembers</div>${mem}
      <button type="button" class="add-row" data-action="brain-add-memory">+ Remember something</button>
      <div class="jv-sub-label">Settings</div>
      ${row("brain-tone", "How it writes", BRAIN_TONES[s.tone])}
      ${row("brain-topics", "News topics", s.newsTopics.length ? s.newsTopics.join(", ") : "AI, tech, cars, trending")}
      ${row("brain-about", "About you", s.about ? (s.about.length > 40 ? s.about.slice(0, 39) + "…" : s.about) : "Add a note")}
      <div class="jv-sub-label">Check-ins</div>
      ${checkins || `<p class="br-empty">Your own scheduled prompts, like “Every Sunday at 8 PM, plan my week”.</p>`}
      <button type="button" class="add-row" data-action="brain-checkin">+ New check-in</button>
      <p class="br-foot">Ratings in the last 30 days: ${up} 👍 · ${down} 👎. Jarvis reads your latest ones to do better.</p>`,
  });
}
