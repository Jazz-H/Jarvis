// jarvis.js - Jarvis's morning briefing: storing and normalizing it, the in-app notice, and its hero,
// Weather and News cards. dashboard.js lays them out on the main tab.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- JARVIS BRIEFING ----------
// The Jarvis GitHub Action (agents/) writes jazz2-briefing.json into the same private gist that
// sync uses. Sync's pull hands that file to ingestBriefingFile(); it's stored on this device only
// (never in SYNC_KEYS, never pushed, not in backups) and is read-only here. Like all synced
// data it's untrusted, so it's normalized on the way in and on every read, and rendered escaped.
const BRIEFING_FILENAME = "jazz2-briefing.json";
const BRIEFING_KEY = "jarvis-briefing";
const BRIEFING_SEEN_KEY = "jarvis-briefing-seen"; // id of the last briefing shown on screen
const BRIEFING_SOURCES = {
  weather: "Weather",
  news: "News",
  jazz: "Jazz",
  jarvis: "Jarvis",
  calendar: "Calendar",
  inbox: "Inbox",
  deliveries: "Deliveries",
  money: "Bill Guard",
};
openPinned.add("jarvis-news");

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
      location: str(d.location, 60),
      conditions: str(d.conditions, 60),
      currentF: num(d.currentF, -80, 150),
      highF: num(d.highF, -80, 150),
      lowF: num(d.lowF, -80, 150),
      humidityPct: num(d.humidityPct, 0, 100),
      rainChanceMax: num(d.rainChanceMax, 0, 100),
      hourlyRain: arr(d.hourlyRain)
        .filter((h) => isObj(h) && Number.isInteger(h.hour) && h.hour >= 0 && h.hour <= 23)
        .slice(0, 24)
        .map((h) => ({
          hour: h.hour,
          chance: num(h.chance, 0, 100) || 0,
          tempF: num(h.tempF, -80, 150),
          conditions: str(h.conditions, 40),
        })),
      summary: str(d.summary, 200),
      wear: str(d.wear, 160),
      washDay: d.washDay === true,
      washDayNote: str(d.washDayNote, 160),
      uvMax: num(d.uvMax, 0, 20),
      uvHigh:
        isObj(d.uvHigh) && Number.isInteger(d.uvHigh.from) && Number.isInteger(d.uvHigh.to)
          ? { from: num(d.uvHigh.from, 0, 23), to: num(d.uvHigh.to, 1, 24) }
          : null,
      aqi: num(d.aqi, 0, 500),
      tomorrow:
        isObj(d.tomorrow) && isoDay(d.tomorrow.date) && num(d.tomorrow.highF, -80, 150) != null
          ? {
              date: d.tomorrow.date,
              conditions: str(d.tomorrow.conditions, 60),
              highF: num(d.tomorrow.highF, -80, 150),
              lowF: num(d.tomorrow.lowF, -80, 150),
              rainChanceMax: num(d.tomorrow.rainChanceMax, 0, 100) || 0,
            }
          : null,
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
  // Phase 2 cards: present only once their source is connected
  const hhmm = (v) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : null);
  const calendar = (d) => {
    if (!isObj(d)) return null;
    return {
      date: isoDay(d.date) ? d.date : "",
      events: arr(d.events)
        .filter(isObj)
        .slice(0, 30)
        .map((e) => ({
          title: str(e.title, 120),
          day: e.day === "tomorrow" ? "tomorrow" : "today",
          allDay: e.allDay === true,
          start: hhmm(e.start),
          end: hhmm(e.end),
          location: str(e.location, 120),
        }))
        .filter((e) => e.title && (e.allDay || e.start)),
      overlaps: arr(d.overlaps)
        .filter(isObj)
        .slice(0, 10)
        .map((o) => ({ a: str(o.a, 120), b: str(o.b, 120) })),
      summary: str(d.summary, 200),
    };
  };
  const people = (v, n) =>
    arr(v)
      .filter(isObj)
      .slice(0, n)
      .map((x) => ({ from: str(x.from, 80), summary: str(x.summary, 140) }))
      .filter((x) => x.summary);
  const BILL_STATUSES = ["matches", "differs", "not-in-budget", "no-amount"];
  const inbox = (d) =>
    isObj(d)
      ? {
          unread: num(d.unread, 0, 1e6) || 0,
          urgent: people(d.urgent, 3),
          needsReply: people(d.needsReply, 5),
          bills: arr(d.bills)
            .filter(isObj)
            .slice(0, 5)
            .map((x) => ({
              payee: str(x.payee, 60),
              amount: num(x.amount, 0, 1e7),
              due: isoDay(x.due) ? x.due : null,
              budgetName: str(x.budgetName, 60),
              budgetAmount: num(x.budgetAmount, 0, 1e7),
              status: BILL_STATUSES.includes(x.status) ? x.status : "no-amount",
            }))
            .filter((x) => x.payee),
        }
      : null;
  const PKG_STATUSES = ["ordered", "shipped", "out", "delivered"];
  const deliveries = (d) =>
    isObj(d)
      ? {
          packages: arr(d.packages)
            .filter(isObj)
            .slice(0, 8)
            .map((x) => ({
              item: str(x.item, 80),
              status: PKG_STATUSES.includes(x.status) ? x.status : "ordered",
              eta: isoDay(x.eta) ? x.eta : null,
              etaText: str(x.etaText, 40),
              shoppingMatch: str(x.shoppingMatch, 60),
              carrier: str(x.carrier, 30),
            }))
            .filter((x) => x.item),
        }
      : null;
  // Bill Guard (Phase 3): code over Budget data, so every field is checked again here
  const GUARD_REASONS = ["overdue", "manual", "short", "differs", "not-in-budget"];
  const money = (d) =>
    isObj(d)
      ? {
          guard: arr(d.guard)
            .filter(isObj)
            .slice(0, 8)
            .map((g) => ({
              reason: GUARD_REASONS.includes(g.reason) ? g.reason : null,
              name: str(g.name, 60),
              amount: num(g.amount, 0, 1e7),
              due: isoDay(g.due) ? g.due : null,
              budgetAmount: num(g.budgetAmount, 0, 1e7),
            }))
            .filter((g) => g.reason && g.name),
          overspent: arr(d.overspent)
            .filter(isObj)
            .slice(0, 5)
            .map((c) => ({ name: str(c.name, 40), spent: num(c.spent, 0, 1e7), limit: num(c.limit, 0, 1e7) }))
            .filter((c) => c.name && c.spent != null && c.limit != null),
        }
      : null;
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
    // suggested to-dos: one-tap chips, never added by themselves
    suggestions: arr(b.suggestions)
      .filter(isObj)
      .slice(0, 10)
      .map((s) => ({ kind: "todo", text: str(s.text, 80).trim(), due: isoDay(s.due) ? s.due : null }))
      .filter((s) => s.text)
      .slice(0, 3),
    weather: card(cards.weather, weather),
    news: card(cards.news, news),
    calendar: cards.calendar ? card(cards.calendar, calendar) : null,
    inbox: cards.inbox ? card(cards.inbox, inbox) : null,
    deliveries: cards.deliveries ? card(cards.deliveries, deliveries) : null,
    money: cards.money ? card(cards.money, money) : null,
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
// The hours when rain is likely (50%+), e.g. "11a–3p"; "" when it isn't
function jvRainWindow(hours) {
  const wet = hours.filter((h) => h.chance >= 50);
  return wet.length ? `${jvHourLabel(wet[0].hour)}–${jvHourLabel((wet[wet.length - 1].hour + 1) % 24)}` : "";
}
// Weather detail (under the Weather tile, which already shows high/low, now and rain): the
// summary, what to wear, a wash-day note, then an hour-by-hour list
function jarvisWeatherDetail(c) {
  if (!c) return "";
  if (c.status !== "ok") return jvErrorBody(c);
  const w = c.data;
  // every third waking hour keeps the list short
  const hours = w.hourlyRain.filter((h) => h.hour % 3 === 0);
  const list = hours.length
    ? `<div class="jv-hours" role="table" aria-label="Hour by hour">${hours
        .map(
          (h) => `<div class="jv-hour" role="row">
            <span role="cell" class="jv-hour-t">${jvHourLabel(h.hour)}</span>
            <span role="cell" class="jv-hour-temp">${h.tempF != null ? `${h.tempF}°` : ""}</span>
            <span role="cell" class="jv-hour-cond">${escapeHtml(h.conditions || "")}</span>
            <span role="cell" class="jv-hour-rain${h.chance >= 50 ? " wet" : ""}">${h.chance}%</span>
          </div>`,
        )
        .join("")}</div>`
    : "";
  return `<p class="jv-lede">${escapeHtml(w.summary)}</p>
    ${w.wear ? `<p class="jv-line"><b>Wear:</b> ${escapeHtml(w.wear)}</p>` : ""}
    ${w.washDay && w.washDayNote ? `<p class="jv-line jv-wash">${DROPLET_ICON}<span>${escapeHtml(w.washDayNote)}</span></p>` : ""}
    ${jvSkinWeatherHtml(w)}
    <div class="jv-facts">${escapeHtml(w.conditions)}${w.humidityPct != null ? ` · ${w.humidityPct}% humidity` : ""}</div>
    ${list}${jvMeta(c)}`;
}

// News: a headline list. Each story: "TOPIC · Source" with a Read link on the right, then the
// title and a short summary. The Read link is the one tap target (the title is plain text), and
// unsafe links get no Read link at all.
function jarvisNewsCard(c) {
  if (!c) return "";
  // a section label like Systems (NEWS ─── count), then the stories in a plain card
  const section = (count, body) =>
    `<div class="jv-label jv-news-label"><span>News</span><i></i><span class="jv-label-count">${count}</span></div>
    <section class="card jv-card jv-news" id="jarvis-news" aria-label="News">${body}</section>`;
  if (c.status !== "ok") return section("Unavailable", jvErrorBody(c));
  const rows = c.data.stories
    .map((s) => {
      const meta = [
        s.topic ? `<span class="jv-story-topic">${escapeHtml(s.topic)}</span>` : "",
        s.source ? `<span class="jv-story-src">${escapeHtml(s.source)}</span>` : "",
      ]
        .filter(Boolean)
        .join('<span class="jv-story-sep" aria-hidden="true">·</span>');
      const read = linkHtml(
        s.link,
        `class="jv-story-read" aria-label="Read “${escapeAttr(s.title)}”${s.source ? ` on ${escapeAttr(s.source)}` : ""} (opens in a new tab)"`,
        `<span>${EXTERNAL_ICON}</span>`,
      );
      const head =
        meta || read ? `<div class="jv-story-head"><span class="jv-story-meta">${meta}</span>${read}</div>` : "";
      return `<li class="jv-story">${head}<span class="jv-story-title">${escapeHtml(s.title)}</span>${s.summary ? `<p>${escapeHtml(s.summary)}</p>` : ""}</li>`;
    })
    .join("");
  const n = c.data.stories.length;
  return section(`${n} stor${n === 1 ? "y" : "ies"}`, `<ul class="jv-stories">${rows}</ul>${jvMeta(c)}`);
}

// The briefing (layout 1): headline, then the tagged summary. Weather and News lines drill into
// their details. The time it was made shows once, in the status line above, unless it's old.
const BRIEFING_DRILL = {
  weather: "weather",
  news: "news",
  calendar: "calendar",
  inbox: "inbox",
  deliveries: "deliveries",
};
// Items from your own lists come tagged "jazz"; name the part of the app they're about instead
// (Budget, Beauty…) and open its detail. First match wins; anything else is a to-do.
const BRIEFING_AREAS = [
  {
    area: "budget",
    label: "Budget",
    go: "money",
    re: /\b(bills?|rent|autopay|paycheck|payday|budget|spend|owe|due)\b|\$\d/i,
  },
  { area: "beauty", label: "Beauty", go: "skin", re: /\b(wash day|wash|routine|spf|skin|hair|night serum|serum)\b/i },
  { area: "shopping", label: "Shopping", go: "shop", re: /\b(shopping|your list|buy|bought|order)\b/i },
  { area: "fitness", label: "Fitness", go: "jazz3", re: /\b(weigh[- ]?in|weight|workout|gym|run|lift)\b/i },
];
function briefingTag(s) {
  if (s.source === "money") return { cls: "budget", label: BRIEFING_SOURCES.money, go: "money" };
  if (s.source !== "jazz") return { cls: s.source, label: BRIEFING_SOURCES[s.source], go: BRIEFING_DRILL[s.source] };
  const a = BRIEFING_AREAS.find((x) => x.re.test(s.text)) || { area: "todo", label: "To-do", go: "todo" };
  return { cls: a.area, label: a.label, go: a.go };
}
// A headline crammed with details ("Pay rent ($612.50, not on autopay) by Sunday; Credit is low")
// shows its main point as the headline and the rest as a smaller line under it
function briefingHeadParts(h) {
  const [first, ...rest] = h.split(/;\s+/);
  const m = first.match(/^(.*?)\s*\(([^)]*)\)\s*(.*)$/);
  const title = m && m[1] ? `${m[1]} ${m[3]}`.trim() : first;
  const sub = [m && m[1] ? m[2] : "", ...rest]
    .map((s) => s.trim().replace(/[.;]$/, ""))
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" · ");
  return { title, sub };
}
function jarvisHeroHtml(b) {
  if (!b)
    return `<section class="card jv-card jv-hero jv-empty">
      <div class="jv-kicker">Standing by</div>
      <h2 class="jv-headline">Your briefing arrives each morning.</h2>
      <p>Your morning briefing will show up here once Jarvis is set up (docs/jarvis/SETUP.md) and sync is on.</p>
      ${reviewHomeRowHtml() ? `<ul class="jv-summary">${reviewHomeRowHtml()}</ul>` : ""}
    </section>`;
  const today = addDaysIso(0);
  const isNew = b.id !== localStorage.getItem(BRIEFING_SEEN_KEY);
  const items = b.summary
    .map((s) => {
      // one divided row per item: tag column, text, then the drill cue (or an empty cue column)
      const tag = briefingTag(s);
      const body = `<span class="jv-src jv-src-${tag.cls}">${tag.label}</span><span class="jv-sum-text">${escapeHtml(s.text)}</span>`;
      return tag.go
        ? `<li><button class="jv-sum-row jv-sum-drill" data-action="jv-drill" data-go="${tag.go}">${body}<span class="jv-sum-cue" aria-hidden="true">›</span></button></li>`
        : `<li class="jv-sum-row">${body}</li>`;
    })
    .join("");
  const notes = b.notes.length
    ? `<details class="jv-notes"><summary>${b.notes.length} note${b.notes.length === 1 ? "" : "s"}</summary><ul>${b.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul></details>`
    : "";
  markBriefingSeen(b);
  return `<section class="card jv-card jv-hero${b.date === today ? "" : " jv-stale"}">
      <div class="jv-kicker">Today in 60 seconds${isNew ? ' <span class="jv-pill">New</span>' : ""}</div>
      ${((p) => (b.headline ? `<h2 class="jv-headline">${escapeHtml(p.title)}</h2>${p.sub ? `<p class="jv-headsub">${escapeHtml(p.sub)}</p>` : ""}` : ""))(briefingHeadParts(b.headline || ""))}
      ${b.date === today ? "" : briefingLateHtml(b)}
      <ul class="jv-summary">${reviewHomeRowHtml()}${items}</ul>
      ${briefingSuggestHtml(b)}
      ${b.summaryBy === "fallback" ? '<div class="jv-meta">Assembled automatically (Jarvis didn\'t finish)</div>' : ""}
      <div class="jv-rate-row"><span>Was this briefing useful?</span>${brainRateHtml("briefing", b.id.replace(/[^A-Za-z0-9_-]/g, "-"))}</div>
      ${notes}
    </section>`;
}

// Suggested to-dos under the summary: tap to add (with its due date), Undo in the toast.
// Tapped chips are remembered for this briefing until the page reloads.
const briefingTapped = new Set();
function briefingSuggestHtml(b) {
  if (!b.suggestions.length) return "";
  const chips = b.suggestions
    .map((c, i) =>
      jarvisChipHtml(c, briefingTapped.has(`${b.id}|${i}`), `data-action="jv-suggest" data-index="${i}"`),
    )
    .join("");
  return `<div class="jv-suggest"><div class="jv-mini">Suggested to-dos</div><div class="rv-chips">${chips}</div></div>`;
}
function briefingSuggestAdd(i) {
  const b = loadBriefing();
  const c = b && b.suggestions[i];
  if (!c) return;
  const key = `${b.id}|${i}`;
  if (briefingTapped.has(key) || reviewChipOnList(c)) {
    showToast("Already on your list");
    return;
  }
  const { before, after } = jarvisChipAdd(c);
  briefingTapped.add(key);
  renderHome();
  document.querySelector(`.jv-suggest .rv-chip[data-index="${i}"]`)?.focus({ preventScroll: true });
  showUndoToast("Added to To-Do", () => {
    undoTo(before, after);
    briefingTapped.delete(key);
    renderHome();
  });
}
// Bill Guard's lines for Home's Money detail, from today's briefing. Bills due soon and not on
// autopay are already shown from Budget itself, so this adds what only the morning run knows.
function billGuardLines(b, today = addDaysIso(0)) {
  const m = b && b.date === today && b.money && b.money.status === "ok" ? b.money.data : null;
  if (!m) return [];
  const $ = (n) => (n == null ? "" : moneyShort(n));
  const out = [];
  m.guard.forEach((g) => {
    if (g.reason === "short")
      out.push(`Bills due before payday are ${$(g.amount)} more than your paycheck.`);
    else if (g.reason === "differs")
      out.push(`${g.name}: the email says ${$(g.amount)}, Budget says ${$(g.budgetAmount)}.`);
    else if (g.reason === "not-in-budget")
      out.push(`${g.name}${g.amount != null ? ` (${$(g.amount)})` : ""} emailed a bill that isn't in Budget.`);
  });
  m.overspent.forEach((c) => out.push(`${c.name}: ${$(c.spent)} spent of ${$(c.limit)} this month.`));
  return out.slice(0, 6);
}

// An older briefing on screen: after 8 AM, today's is late (the run usually lands by 7), so say so
const BRIEFING_LATE_HOUR = 8;
function briefingLateHtml(b, now = new Date()) {
  const from = noonOf(b.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return b.date < isoDate(now) && now.getHours() >= BRIEFING_LATE_HOUR
    ? `<div class="jv-when jv-late" role="status">Today's briefing hasn't arrived. Showing ${from}.</div>`
    : `<div class="jv-when">From ${from}</div>`;
}

// Skin weather: UV (with SPF advice) and air quality, from the Weather agent's facts
function jvUvLevel(uv) {
  return uv >= 11 ? "Extreme" : uv >= 8 ? "Very high" : uv >= 6 ? "High" : uv >= 3 ? "Moderate" : "Low";
}
function jvUvAdvice(uv) {
  return uv >= 8
    ? "SPF 50, reapply every 2 h, shade at midday"
    : uv >= 6
      ? "SPF 50, reapply every 2 h"
      : uv >= 3
        ? "SPF 30 before you go out"
        : "Daily SPF is enough";
}
function jvAqiLevel(aqi) {
  return aqi > 300
    ? "Hazardous"
    : aqi > 200
      ? "Very unhealthy"
      : aqi > 150
        ? "Unhealthy"
        : aqi > 100
          ? "Unhealthy for sensitive groups"
          : aqi > 50
            ? "Moderate"
            : "Good";
}
function jvSkinWeatherHtml(w) {
  const lines = [];
  if (w.uvMax != null) {
    const when = w.uvHigh ? ` ${jvHourLabel(w.uvHigh.from)}–${jvHourLabel(w.uvHigh.to % 24)}` : "";
    lines.push(
      `<div class="jv-skinwx-row${w.uvMax >= 6 ? " warn" : ""}"><span class="jv-mini">UV</span><span>${jvUvLevel(w.uvMax)} (${w.uvMax})${when}: ${jvUvAdvice(w.uvMax)}</span></div>`,
    );
  }
  if (w.aqi != null)
    lines.push(
      `<div class="jv-skinwx-row${w.aqi > 100 ? " warn" : ""}"><span class="jv-mini">Air</span><span>${jvAqiLevel(w.aqi)} (AQI ${w.aqi})</span></div>`,
    );
  return lines.length ? `<div class="jv-skinwx">${lines.join("")}</div>` : "";
}
