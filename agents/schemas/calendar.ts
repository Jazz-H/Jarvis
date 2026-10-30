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
