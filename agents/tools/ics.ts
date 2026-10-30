// Google Calendar's secret iCal address (read-only, no OAuth). Plain code: fetch, parse, expand
// repeating events, convert to local time, keep today and tomorrow, find overlaps.
// The address is a secret: it never goes into errors, logs or the briefing.
import ical, { type VEvent } from "node-ical";
import { CalendarFacts, type CalendarEvent } from "../schemas/calendar.ts";
import { localTime } from "../lib/schedule.ts";

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

export async function fetchCalendar(
  url: string,
  now: Date,
  timeZone: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CalendarFacts> {
  if (!/^https:\/\//.test(url)) throw new Error("Calendar address must be an https URL");
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Calendar feed HTTP ${res.status}`); // never echo the address
  return eventsFromIcs(await res.text(), now, timeZone);
}
