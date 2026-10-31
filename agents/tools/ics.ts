// Google Calendar's secret iCal address (read-only, no OAuth). Plain code: fetch, parse, expand
// repeating events, convert to local time, keep today and tomorrow, find overlaps; and the wider
// 90-days-back / 60-days-ahead list for jazz2-calendar.json (calendarHistory).
// The address is a secret: it never goes into errors, logs or the briefing.
import ical, { type VEvent } from "node-ical";
import {
  CalendarFacts,
  CalendarHistoryFile,
  type CalendarEvent,
  type CalendarHistoryEvent,
} from "../schemas/calendar.ts";
import { CONFIG } from "../config.ts";
import { localTime } from "../lib/schedule.ts";
import { eventText } from "../lib/text.ts";

const text = (v: unknown): string =>
  typeof v === "string" ? v : v && typeof v === "object" && "val" in v ? String((v as any).val) : "";
const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
// all-day dates come back as local-midnight Dates; read their own calendar fields
const dateOnly = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDay = (iso: string, n: number) =>
  new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n)).toISOString().slice(0, 10);

export function eventsFromIcs(raw: string, now: Date, timeZone: string): CalendarFacts {
  const today = localTime(now, timeZone).date;
  const tomorrow = addDay(today, 1);
  const parsed = ical.sync.parseICS(raw);
  const from = new Date(now.getTime() - 36 * 3600_000),
    to = new Date(now.getTime() + 60 * 3600_000);
  const out: (CalendarEvent & { sortKey: string; startMin: number | null; endMin: number | null })[] = [];
  for (const c of Object.values(parsed)) {
    if (!c || (c as any).type !== "VEVENT") continue;
    const ev = c as VEvent;
    if (ev.status === "CANCELLED") continue;
    let instances;
    try {
      instances = ical.expandRecurringEvent(ev, { from, to, expandOngoing: true });
    } catch {
      continue; // one malformed event shouldn't sink the calendar
    }
    for (const inst of instances) {
      if ((inst.event as any)?.status === "CANCELLED") continue;
      const title = clip(text(inst.summary) || "(No title)", 120);
      const location = clip(text((inst.event as any)?.location), 120);
      if (inst.isFullDay) {
        // an all-day event covers [start, end); show it on each of today/tomorrow it covers
        const s = dateOnly(inst.start),
          e = inst.end ? dateOnly(inst.end) : addDay(s, 1);
        for (const [day, iso] of [
          ["today", today],
          ["tomorrow", tomorrow],
        ] as const)
          if (s <= iso && iso < e)
            out.push({
              title,
              day,
              allDay: true,
              start: null,
              end: null,
              location,
              sortKey: `${day}0`,
              startMin: null,
              endMin: null,
            });
        continue;
      }
      const s = localTime(inst.start, timeZone);
      const day = s.date === today ? "today" : s.date === tomorrow ? "tomorrow" : null;
      if (!day) continue;
      const e = inst.end ? localTime(inst.end, timeZone) : null;
      const endMin = e ? (e.date === s.date ? e.minutes : 24 * 60 - 1) : null;
      out.push({
        title,
        day,
        allDay: false,
        start: hhmm(s.minutes),
        end: endMin != null ? hhmm(endMin) : null,
        location,
        sortKey: `${day}1${hhmm(s.minutes)}`,
        startMin: s.minutes,
        endMin,
      });
    }
  }
  out.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  const timedToday = out.filter((x) => x.day === "today" && x.startMin != null && x.endMin != null);
  const overlaps: { a: string; b: string }[] = [];
  for (let i = 0; i < timedToday.length; i++)
    for (let j = i + 1; j < timedToday.length; j++)
      if (timedToday[j].startMin! < timedToday[i].endMin!)
        overlaps.push({ a: timedToday[i].title, b: timedToday[j].title });
  return CalendarFacts.parse({
    date: today,
    events: out.slice(0, 30).map(({ sortKey, startMin, endMin, ...ev }) => ev),
    overlaps: overlaps.slice(0, 10),
  });
}

// How many events fall on each local day from `fromIso` to `toIso` (inclusive), for the Weekly
// Review's look at the week ahead. Counts only: no titles or places leave this function.
export function eventCountsByDay(raw: string, fromIso: string, toIso: string, timeZone: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (let d = fromIso; d <= toIso && Object.keys(counts).length < 60; d = addDay(d, 1)) counts[d] = 0;
  const parsed = ical.sync.parseICS(raw);
  const from = new Date(Date.parse(fromIso + "T00:00:00Z") - 36 * 3600_000),
    to = new Date(Date.parse(toIso + "T00:00:00Z") + 60 * 3600_000);
  for (const c of Object.values(parsed)) {
    if (!c || (c as any).type !== "VEVENT") continue;
    const ev = c as VEvent;
    if (ev.status === "CANCELLED") continue;
    let instances;
    try {
      instances = ical.expandRecurringEvent(ev, { from, to, expandOngoing: true });
    } catch {
      continue;
    }
    for (const inst of instances) {
      if ((inst.event as any)?.status === "CANCELLED") continue;
      if (inst.isFullDay) {
        const s = dateOnly(inst.start),
          e = inst.end ? dateOnly(inst.end) : addDay(s, 1);
        for (const d of Object.keys(counts)) if (s <= d && d < e) counts[d]++;
        continue;
      }
      const d = localTime(inst.start, timeZone).date;
      if (d in counts) counts[d]++;
    }
  }
  return counts;
}

// jazz2-calendar.json: every event from today - 90 days to today + 60 days (New York local dates),
// for the app's Planner and for Ask. Repeats are expanded (EXDATEs and moved instances as
// node-ical gives them); a multi-day all-day event gets one entry per day (at most 14, from its
// first day); a timed event that runs past midnight is listed on its start date with its end time
// as-is. Sorted by date, all-day first, then start. Titles and places only, cleaned and capped:
// no descriptions, attendees, URLs or organizer emails. Throws on a feed that isn't iCal, so a
// bad fetch never replaces yesterday's file.
export function calendarHistory(raw: string, now: Date, timeZone: string): CalendarHistoryFile {
  if (!/BEGIN:VCALENDAR/i.test(raw)) throw new Error("Calendar feed isn't an iCal file");
  const opt = CONFIG.calendarHistory;
  const today = localTime(now, timeZone).date;
  const fromIso = addDay(today, -opt.daysBack),
    toIso = addDay(today, opt.daysAhead);
  const inWindow = (d: string) => d >= fromIso && d <= toIso;
  const parsed = ical.sync.parseICS(raw);
  const from = new Date(Date.parse(fromIso + "T00:00:00Z") - 36 * 3600_000),
    to = new Date(Date.parse(toIso + "T00:00:00Z") + 60 * 3600_000);
  const out: CalendarHistoryEvent[] = [];
  const RAW_CAP = 20_000; // a runaway repeat (every minute) can't blow up memory
  for (const c of Object.values(parsed)) {
    if (out.length >= RAW_CAP) break;
    if (!c || (c as any).type !== "VEVENT") continue;
    const ev = c as VEvent;
    if (ev.status === "CANCELLED") continue;
    let instances;
    try {
      instances = ical.expandRecurringEvent(ev, { from, to, expandOngoing: true });
    } catch {
      continue; // one malformed event shouldn't sink the calendar
    }
    for (const inst of instances) {
      if (out.length >= RAW_CAP) break;
      if ((inst.event as any)?.status === "CANCELLED") continue;
      const title = eventText(text(inst.summary), opt.titleChars) || "(No title)";
      const location = eventText(text((inst.event as any)?.location), opt.locationChars);
      if (inst.isFullDay) {
        const s = dateOnly(inst.start);
        let e = inst.end ? dateOnly(inst.end) : addDay(s, 1);
        if (e <= s) e = addDay(s, 1);
        for (let d = s, i = 0; d < e && i < opt.maxDaysPerEvent; d = addDay(d, 1), i++)
          if (inWindow(d)) out.push({ date: d, start: null, end: null, allDay: true, title, location });
        continue;
      }
      const s = localTime(inst.start, timeZone);
      if (!inWindow(s.date)) continue;
      const e = inst.end ? localTime(inst.end, timeZone) : null;
      out.push({
        date: s.date,
        start: hhmm(s.minutes),
        end: e ? hhmm(e.minutes) : null,
        allDay: false,
        title,
        location,
      });
    }
  }
  const dayNum = (d: string) => Date.parse(d + "T00:00:00Z") / 86400_000;
  const t0 = dayNum(today);
  let kept = out;
  if (kept.length > opt.maxEvents)
    // nearest to today first; on a tie the upcoming day wins
    kept = kept
      .map((ev) => ({ ev, dist: Math.abs(dayNum(ev.date) - t0), past: ev.date < today ? 1 : 0 }))
      .sort((a, b) => a.dist - b.dist || a.past - b.past)
      .slice(0, opt.maxEvents)
      .map((x) => x.ev);
  const key = (e: CalendarHistoryEvent) => `${e.date}${e.allDay ? "0" : "1" + e.start}\u0000${e.title}`;
  kept.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return CalendarHistoryFile.parse({
    version: 1,
    generatedAt: now.toISOString(),
    tz: timeZone,
    from: fromIso,
    to: toIso,
    events: kept,
  });
}

export async function fetchIcs(url: string, fetchImpl: typeof fetch): Promise<string> {
  if (!/^https:\/\//.test(url)) throw new Error("Calendar address must be an https URL");
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Calendar feed HTTP ${res.status}`); // never echo the address
  return res.text();
}

export async function fetchCalendar(
  url: string,
  now: Date,
  timeZone: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CalendarFacts> {
  return eventsFromIcs(await fetchIcs(url, fetchImpl), now, timeZone);
}

export async function fetchCalendarWeek(
  url: string,
  fromIso: string,
  toIso: string,
  timeZone: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, number>> {
  return eventCountsByDay(await fetchIcs(url, fetchImpl), fromIso, toIso, timeZone);
}
