// calendar.js - Google Calendar history on the Planner: storing and normalizing the imported
// events, and the read-only pieces Home draws with them (a day's events, the strip's marks).
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- CALENDAR EVENTS ----------
// The Jarvis Action's morning run writes jazz2-calendar.json into the sync gist: 90 days back,
// 60 ahead ({version: 1, generatedAt, tz, from, to, events: [{date, start, end, allDay, title,
// location}]}). Sync's pull hands it to ingestCalendarFile(); it's kept on this device only (never
// in SYNC_KEYS, never pushed, not in backups) and is read-only here. Like all synced data it's
// untrusted: normalizeCalendar() checks every field on the way in and on every read, and the
// Planner renders it escaped, with no links. Days outside from..to show nothing at all, so a day
// the file doesn't cover never looks "free".
const CALENDAR_FILENAME = "jazz2-calendar.json";
const CALENDAR_KEY = "jarvis-calendar";
const CALENDAR_MAX = 1500;
let calendarCache = { raw: undefined, cal: null, byDate: new Map() };

function calIsDay(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isoDate(noonOf(v)) === v;
}
function calIsTime(v) {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}
// Plain one-line text: control characters out, whitespace collapsed, capped
function calText(v, max) {
  return typeof v === "string"
    ? v
        .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
        .trim()
    : "";
}
function normalizeCalendarEvent(e, from, to) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  if (!calIsDay(e.date) || e.date < from || e.date > to) return null;
  const title = calText(e.title, 80);
  if (!title) return null;
  const start = calIsTime(e.start) ? e.start : null;
  const allDay = e.allDay === true || !start; // a timed event without a start reads as all-day
  const end = !allDay && calIsTime(e.end) ? e.end : null;
  return { date: e.date, start: allDay ? null : start, end, allDay, title, location: calText(e.location, 60) };
}
// The whole file (or what's stored): null unless it's a version-1 file with a real range
function normalizeCalendar(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== 1) return null;
  if (!calIsDay(raw.from) || !calIsDay(raw.to) || raw.to < raw.from) return null;
  const list = Array.isArray(raw.events) ? raw.events : [];
  const events = list
    .slice(0, CALENDAR_MAX * 2)
    .map((e) => normalizeCalendarEvent(e, raw.from, raw.to))
    .filter(Boolean)
    .sort(calCompare)
    .slice(0, CALENDAR_MAX);
  return {
    version: 1,
    generatedAt:
      typeof raw.generatedAt === "string" && !isNaN(Date.parse(raw.generatedAt)) ? raw.generatedAt.slice(0, 40) : "",
    tz: calText(raw.tz, 60),
    from: raw.from,
    to: raw.to,
    events,
  };
}
// By date, then all-day first, then start time
function calCompare(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const sa = a.start || "",
    sb = b.start || "";
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
function loadCalendar() {
  let raw = null;
  try {
    raw = localStorage.getItem(CALENDAR_KEY);
  } catch (e) {}
  if (raw !== calendarCache.raw) {
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (e) {}
    const cal = normalizeCalendar(parsed);
    const byDate = new Map();
    if (cal)
      cal.events.forEach((e) => {
        if (!byDate.has(e.date)) byDate.set(e.date, []);
        byDate.get(e.date).push(e);
      });
    calendarCache = { raw, cal, byDate };
  }
  return calendarCache.cal;
}
// A day's events, or null when there's no file or the day is outside what it covers
function calendarEventsOn(iso) {
  const cal = loadCalendar();
  if (!cal || iso < cal.from || iso > cal.to) return null;
  return calendarCache.byDate.get(iso) || [];
}

// Called by sync's pull with the gist's calendar file entry (or undefined)
async function ingestCalendarFile(file) {
  if (!file || typeof file !== "object") return;
  try {
    let text = file.content;
    if (file.truncated) {
      const raw = safeUrl(file.raw_url);
      if (!raw || new URL(raw).hostname !== "gist.githubusercontent.com") return;
      text = await (await fetch(raw)).text();
    }
    const cal = normalizeCalendar(JSON.parse(text));
    if (!cal) return;
    if (JSON.stringify(loadCalendar()) === JSON.stringify(cal)) return; // nothing new
    writeQuietly(CALENDAR_KEY, cal); // stored already cleaned
    renderHomePanel();
  } catch (e) {
    console.warn("calendar not loaded", e);
  }
}

// ---- Planner pieces ----
const calMins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
function calTime(hhmm) {
  const h = Number(hhmm.slice(0, 2)),
    m = Number(hhmm.slice(3, 5));
  return `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "a" : "p"}`;
}
function calCountLabel(n) {
  return `${n} event${n === 1 ? "" : "s"}`;
}
// The day's events for the Planner: all-day ones as chips, then timed rows (start–end, title,
// location) in the same style as the dashboard's Calendar detail. Today's finished ones dim.
// Read-only: nothing here is tappable. Empty string when there's nothing to show.
function homeEventsHtml(iso) {
  const evs = calendarEventsOn(iso);
  if (!evs || !evs.length) return "";
  const isToday = iso === addDaysIso(0);
  const now = new Date(),
    nowMin = now.getHours() * 60 + now.getMinutes();
  const allDay = evs.filter((e) => e.allDay);
  const timed = evs.filter((e) => !e.allDay);
  const row = (e) => {
    const s = calMins(e.start),
      end = e.end && calMins(e.end) > s ? calMins(e.end) : e.end ? 24 * 60 : s + 60;
    const past = isToday && end <= nowMin;
    // screen readers hear "9a to 10a, Standup, Room 4 (over)"; the "to" and commas are hidden visually
    const sr = (t) => `<span class="home-ev-sr">${t}</span>`;
    return `<li class="jv-cal-ev${past ? " past" : ""}">
        <span class="jv-cal-time"><b>${calTime(e.start)}</b>${e.end ? `${sr(" to ")}<span>${calTime(e.end)}</span>` : ""}${sr(", ")}</span>
        <span class="jv-cal-what"><b>${escapeHtml(e.title)}</b>${e.location ? `${sr(", ")}<span>${escapeHtml(e.location)}</span>` : ""}${past ? sr(" (over)") : ""}</span>
      </li>`;
  };
  return `<div class="home-sec home-ev-sec">Calendar</div>
    <section class="card home-events" aria-label="Calendar events">${
      allDay.length
        ? `<div class="jv-cal-allday" role="list">${allDay.map((e) => `<span role="listitem">${escapeHtml(e.title)}</span>`).join("")}</div>`
        : ""
    }${timed.length ? `<ol class="jv-cal-list">${timed.map(row).join("")}</ol>` : ""}</section>`;
}
