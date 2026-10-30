// jarvis.js - Jarvis's morning briefing at the top of the main (Home) tab: the 60-second summary,
// Weather and News cards, and the in-app "new briefing" notice.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- JARVIS BRIEFING ----------
// The Jarvis GitHub Action (agents/) writes jazz2-briefing.json into the same private gist that
// sync uses. Sync's pull hands that file to ingestBriefingFile(); it's stored on this device only
// (never in SYNC_KEYS, never pushed, not in backups) and is read-only here. Like all synced
// data it's untrusted, so it's normalized on the way in and on every read, and rendered escaped.
const BRIEFING_FILENAME = "jazz2-briefing.json";
const BRIEFING_KEY = "jarvis-briefing";
const BRIEFING_SEEN_KEY = "jarvis-briefing-seen"; // id of the last briefing shown on screen
const BRIEFING_SOURCES = { weather: "Weather", news: "News", jazz: "Jazz", jarvis: "Jarvis" };
["jarvis-weather", "jarvis-news"].forEach((id) => openPinned.add(id));

function normalizeBriefing(b) {
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  const num = (v, lo, hi) => (typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
  const isoDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const isoTime = (v) => (typeof v === "string" && !isNaN(Date.parse(v)) ? v : "");
  if (!isObj(b) || b.version !== 1 || !str(b.id, 40) || !isoDay(b.date)) return null;
  const weather = (d) => {
    if (!isObj(d)) return null;
    const w = {
      conditions: str(d.conditions, 60),
      currentF: num(d.currentF, -80, 150),
      highF: num(d.highF, -80, 150),
      lowF: num(d.lowF, -80, 150),
      humidityPct: num(d.humidityPct, 0, 100),
      rainChanceMax: num(d.rainChanceMax, 0, 100),
      hourlyRain: arr(d.hourlyRain)
        .filter((h) => isObj(h) && Number.isInteger(h.hour) && h.hour >= 0 && h.hour <= 23)
        .slice(0, 24)
        .map((h) => ({ hour: h.hour, chance: num(h.chance, 0, 100) || 0 })),
      summary: str(d.summary, 200),
      wear: str(d.wear, 160),
      washDay: d.washDay === true,
      washDayNote: str(d.washDayNote, 160),
    };
    return w.highF == null || w.lowF == null || !w.summary ? null : w;
  };
  const news = (d) => {
    const stories = arr(isObj(d) && d.stories)
      .filter(isObj)
      .slice(0, 8)
      .map((s) => ({
        title: str(s.title, 300),
        source: str(s.source, 80),
        topic: str(s.topic, 30),
        link: str(s.link, 2000),
        summary: str(s.summary, 320),
      }))
      .filter((s) => s.title);
    return stories.length ? { stories } : null;
  };
  const card = (c, normData) => {
    if (!isObj(c)) return null;
    const meta = { agent: str(c.agent, 30), updatedAt: isoTime(c.updatedAt) };
    if (c.status === "ok") {
      const data = normData(c.data);
      return data
        ? { status: "ok", data, ...meta }
        : { status: "error", error: "This card's data couldn't be read.", ...meta };
    }
    return { status: "error", error: str(c.error, 200) || "This agent didn't finish.", ...meta };
  };
  const cards = isObj(b.cards) ? b.cards : {};
  return {
    id: str(b.id, 40),
    date: b.date,
    generatedAt: isoTime(b.generatedAt),
    headline: str(b.headline, 100),
    summary: arr(b.summary)
      .filter(isObj)
      .slice(0, 5)
      .map((s) => ({ text: str(s.text, 240), source: BRIEFING_SOURCES[s.source] ? s.source : "jarvis" }))
      .filter((s) => s.text),
    summaryBy: b.summaryBy === "fallback" ? "fallback" : "jarvis",
    weather: card(cards.weather, weather),
    news: card(cards.news, news),
    notes: arr(b.notes)
      .map((n) => str(n, 200))
      .filter(Boolean)
      .slice(0, 10),
  };
}
function loadBriefing() {
  return normalizeBriefing(loadContent(BRIEFING_KEY, null));
}

// Called by sync's pull with the gist's briefing file entry (or undefined)
async function ingestBriefingFile(file) {
  if (!file || typeof file !== "object") return;
  try {
    let text = file.content;
    if (file.truncated) {
      const raw = safeUrl(file.raw_url);
      if (!raw || new URL(raw).hostname !== "gist.githubusercontent.com") return;
      text = await (await fetch(raw)).text();
    }
    const b = normalizeBriefing(JSON.parse(text));
    if (!b) return;
    const prev = loadBriefing();
    if (prev && (prev.id === b.id || prev.generatedAt > b.generatedAt)) return; // same one, or older
    writeQuietly(BRIEFING_KEY, JSON.parse(text));
    renderHome();
    if (b.id !== localStorage.getItem(BRIEFING_SEEN_KEY)) announceBriefing(b);
  } catch (e) {
    console.warn("briefing not loaded", e);
  }
}

// In-app notice: a toast with the headline, plus a dot on the tab when it arrives off-screen
function announceBriefing(b) {
  showToast(b.headline ? `Jarvis: ${b.headline}` : "New briefing from Jarvis");
  if (currentTab !== "home" || document.hidden) {
    const tab = document.querySelector('nav.tabbar button[data-tab="home"]');
    if (tab) tab.classList.add("jv-new");
  }
}
function markBriefingSeen(b) {
  if (currentTab !== "home" || document.hidden) return;
  const tab = document.querySelector('nav.tabbar button[data-tab="home"]');
  if (tab) tab.classList.remove("jv-new");
  try {
    localStorage.setItem(BRIEFING_SEEN_KEY, b.id);
  } catch (e) {}
}

function jvTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function jvMeta(c) {
  const t = c.updatedAt ? jvTime(c.updatedAt) : "";
  return `<div class="jv-meta">${escapeHtml(c.agent || "Jarvis")} agent${t ? ` · ${escapeHtml(t)}` : ""}</div>`;
}
function jvErrorBody(c) {
  return `<div class="jv-error">${escapeHtml(c.error)}</div>${jvMeta(c)}`;
}
function jvHourLabel(h) {
  return h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;
}
function jvRainRow(hours) {
  if (!hours.length) return "";
  const bars = hours
    .map(
      (h) =>
        `<div class="jv-bar" title="${escapeAttr(jvHourLabel(h.hour))}: ${h.chance}% rain"><span style="height:${Math.max(4, h.chance)}%"></span><i>${h.hour % 3 === 0 ? jvHourLabel(h.hour) : ""}</i></div>`,
    )
    .join("");
  return `<div class="jv-rain" aria-label="Hourly chance of rain">${bars}</div>`;
}

function jarvisWeatherCard(c) {
  if (!c) return "";
  if (c.status !== "ok")
    return collapsibleCard({ id: "jarvis-weather", title: "Weather", insight: "Unavailable", body: jvErrorBody(c) });
  const w = c.data;
  const body =
    `<p class="jv-lede">${escapeHtml(w.summary)}</p>` +
    (w.wear ? `<p class="jv-line"><b>Wear:</b> ${escapeHtml(w.wear)}</p>` : "") +
    (w.washDay && w.washDayNote
      ? `<p class="jv-line jv-wash">${DROPLET_ICON}<span>${escapeHtml(w.washDayNote)}</span></p>`
      : "") +
    jvRainRow(w.hourlyRain) +
    `<div class="jv-facts">${escapeHtml(w.conditions)}${w.currentF != null ? ` · now ${w.currentF}°` : ""}${w.humidityPct != null ? ` · ${w.humidityPct}% humidity` : ""}</div>` +
    jvMeta(c);
  return collapsibleCard({
    id: "jarvis-weather",
    title: "Weather",
    insight: escapeHtml(`${w.highF}°/${w.lowF}°${w.rainChanceMax != null ? ` · ${w.rainChanceMax}% rain` : ""}`),
    body,
  });
}
function jarvisNewsCard(c) {
  if (!c) return "";
  if (c.status !== "ok")
    return collapsibleCard({ id: "jarvis-news", title: "News", insight: "Unavailable", body: jvErrorBody(c) });
  const rows = c.data.stories
    .map((s) => {
      const title =
        linkHtml(s.link, 'class="jv-story-title"', escapeHtml(s.title)) ||
        `<span class="jv-story-title">${escapeHtml(s.title)}</span>`;
      return `<li class="jv-story">${title}<div class="jv-story-src">${escapeHtml([s.source, s.topic].filter(Boolean).join(" · "))}</div>${s.summary ? `<p>${escapeHtml(s.summary)}</p>` : ""}</li>`;
    })
    .join("");
  const n = c.data.stories.length;
  return collapsibleCard({
    id: "jarvis-news",
    title: "News",
    insight: `${n} stor${n === 1 ? "y" : "ies"}`,
    body: `<ul class="jv-stories">${rows}</ul>${jvMeta(c)}`,
  });
}

function jarvisHtml() {
  const b = loadBriefing();
  if (!b)
    return `<div class="card jv-card jv-empty"><div class="jv-kicker">Jarvis</div><p>Your morning briefing will show up here once Jarvis is set up (docs/jarvis/SETUP.md) and sync is on.</p></div>`;
  const today = addDaysIso(0);
  const isNew = b.id !== localStorage.getItem(BRIEFING_SEEN_KEY);
  const when =
    b.date === today
      ? `Today${b.generatedAt ? ` · ${jvTime(b.generatedAt)}` : ""}`
      : `From ${noonOf(b.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`;
  const items = b.summary
    .map(
      (s) =>
        `<li><span class="jv-src jv-src-${s.source}">${BRIEFING_SOURCES[s.source]}</span><span>${escapeHtml(s.text)}</span></li>`,
    )
    .join("");
  const notes = b.notes.length
    ? `<details class="jv-notes"><summary>${b.notes.length} note${b.notes.length === 1 ? "" : "s"}</summary><ul>${b.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul></details>`
    : "";
  const html =
    `<div class="card jv-card${b.date === today ? "" : " jv-stale"}">
      <div class="jv-kicker">Today in 60 seconds${isNew ? ' <span class="jv-pill">New</span>' : ""}<span class="jv-when">${escapeHtml(when)}</span></div>
      ${b.headline ? `<h2 class="jv-headline">${escapeHtml(b.headline)}</h2>` : ""}
      <ul class="jv-summary">${items}</ul>
      <div class="jv-meta">${b.summaryBy === "fallback" ? "Assembled automatically (Jarvis didn't finish)" : "Jarvis"}</div>
      ${notes}
    </div>` +
    jarvisWeatherCard(b.weather) +
    jarvisNewsCard(b.news);
  markBriefingSeen(b);
  return `<div class="jv-wrap">${html}</div>`;
}
