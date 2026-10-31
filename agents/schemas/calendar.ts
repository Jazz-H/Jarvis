import { z } from "zod";

const hhmm = z.string().regex(/^\d{2}:\d{2}$/);

// One event as code read it from the calendar feed (times are local, America/New_York)
export const CalendarEvent = z.object({
  title: z.string().max(120),
  day: z.enum(["today", "tomorrow"]),
  allDay: z.boolean(),
  start: hhmm.nullable(), // null for all-day events
  end: hhmm.nullable(),
  location: z.string().max(120),
});
export type CalendarEvent = z.infer<typeof CalendarEvent>;

// What code measures: today's and tomorrow's events, and timed events that overlap today
export const CalendarFacts = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  events: z.array(CalendarEvent).max(30),
  overlaps: z.array(z.object({ a: z.string(), b: z.string() })).max(10),
});
export type CalendarFacts = z.infer<typeof CalendarFacts>;

// What the Calendar sub-agent returns: a one-line read of the day
export const CalendarRead = z.object({ summary: z.string().min(1).max(200) });
export type CalendarRead = z.infer<typeof CalendarRead>;

export const CalendarCard = CalendarFacts.extend(CalendarRead.shape);
export type CalendarCard = z.infer<typeof CalendarCard>;

// jazz2-calendar.json: the owner's calendar from 90 days back to 60 days ahead, written only by the
// morning briefing run (jarvis.ts writeCalendarHistory) and read by the app's Planner and by Ask.
// Titles and places only: never descriptions, attendees, URLs or organizer emails.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const CalendarHistoryEvent = z.object({
  date: isoDate, // local (America/New_York) date the entry is shown on
  start: hhmm.nullable(), // null for all-day
  end: hhmm.nullable(), // as-is, even when a timed event ends after midnight
  allDay: z.boolean(),
  title: z.string().min(1).max(80),
  location: z.string().max(60),
});
export type CalendarHistoryEvent = z.infer<typeof CalendarHistoryEvent>;

export const CalendarHistoryFile = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  tz: z.literal("America/New_York"),
  from: isoDate,
  to: isoDate,
  events: z.array(CalendarHistoryEvent).max(1500),
});
export type CalendarHistoryFile = z.infer<typeof CalendarHistoryFile>;
