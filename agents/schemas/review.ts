import { z } from "zod";

// The Weekly Review (jazz2-reviews.json in the Gist). Every number in `stats` is computed by code
// (lib/week-stats.ts); the model writes only the headline, wins, slips, focus and chips. The app
// treats the whole file as untrusted, read-only data. Every string and array is capped.
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const N = z.number().int().min(0).max(100_000);
const Money = z.number().min(0).max(10_000_000);
const Id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const S = (n: number) => z.string().max(n);

// Which part of the stats a win or slip is about (the app links each one to its section)
export const StatKey = z.enum([
  "todos",
  "routine",
  "workouts",
  "weight",
  "goals",
  "bills",
  "spending",
  "shopping",
  "nextWeek",
  "inbox",
]);
export type StatKey = z.infer<typeof StatKey>;

// A suggestion the owner can tap to add (never added on its own)
export const Chip = z.object({
  kind: z.enum(["todo", "shopping"]),
  text: z.string().min(1).max(120),
  due: IsoDate.optional(), // to-dos only, a day in the week ahead
});
export type Chip = z.infer<typeof Chip>;

export const WeekStats = z.object({
  // done: completed this week (any due date); due: due this week; dueDone: of those, done;
  // missed: due this week and still open; carried: open from before the week, still open
  todos: z.object({ done: N, due: N, dueDone: N, missed: N, carried: N, starredDone: N }),
  // days with AM and PM both done, days with only AM, and the streak as of Sunday (routineStreak)
  routine: z.object({ fullDays: N, amOnly: N, streak: N }),
  workouts: z.object({ done: N, planned: N, missedDays: z.array(IsoDate).max(7) }),
  // change: last weigh-in this week minus the last one before it (or the week's first); null with
  // fewer than two. pct/eta: weightStatus() as of Sunday
  weight: z.object({
    weighIns: N,
    current: z.number().min(0).max(1000).nullable(),
    change: z.number().min(-1000).max(1000).nullable(),
    pct: N.max(100).nullable(),
    eta: IsoDate.nullable(),
  }),
  // doneThisWeek is null until there's a previous review to compare with (no dates are stored)
  goals: z.array(z.object({ name: S(40), doneThisWeek: N.nullable(), done: N, total: N })).max(6),
  // unpaidPastDue: due on or before Sunday and still unpaid
  bills: z.object({
    paid: N,
    autopaid: N,
    paidTotal: Money,
    unpaidPastDue: z.array(S(60)).max(5),
    dueNextWeek: N,
    dueNextWeekTotal: Money,
  }),
  // limitWeek: the monthly limit prorated over the week's days (split across months);
  // monthSpent/limitMonth: the month Sunday falls in, to date
  spending: z.object({
    total: Money,
    byCat: z
      .array(
        z.object({
          name: S(40),
          spent: Money,
          limitWeek: Money.nullable(),
          monthSpent: Money,
          limitMonth: Money.nullable(),
        }),
      )
      .max(8),
  }),
  // bought is null until there's a previous review to compare with; estOpen is everything still to
  // buy (not "later"), like Home's Shopping tile
  shopping: z.object({ bought: z.array(S(60)).max(8).nullable(), boughtCount: N.nullable(), needsOpen: N, estOpen: Money }),
  // events is null when the calendar isn't connected; busiestDay counts events, to-dos, bills and
  // workouts per day
  nextWeek: z.object({
    start: IsoDate,
    end: IsoDate,
    events: N.nullable(),
    busiestDay: IsoDate.nullable(),
    todosDue: N,
    billsDue: N,
    workouts: N,
    washDays: z.array(IsoDate).max(3),
  }),
  // from the morning digests; left out when Inbox isn't connected
  inbox: z.object({ days: N, awaitingReply: N, billMismatches: N }).optional(),
});
export type WeekStats = z.infer<typeof WeekStats>;

export const Snapshot = z.object({ plan3Done: z.array(Id).max(200), wantsBought: z.array(Id).max(400) });
export type Snapshot = z.infer<typeof Snapshot>;

const Point = z.object({ text: z.string().min(1).max(200), stat: StatKey });

// What the Jarvis model returns for the review.
export const ReviewOutput = z.object({
  headline: z.string().min(1).max(100),
  wins: z.array(Point).max(3),
  slips: z.array(Point).max(3),
  focus: z.array(z.object({ text: z.string().min(1).max(200) })).max(3),
  suggestions: z.array(Chip).max(3),
});
export type ReviewOutput = z.infer<typeof ReviewOutput>;

export const WeeklyReview = z.object({
  version: z.literal(1),
  id: z.string().regex(/^\d{4}-W\d{2}$/), // ISO week of weekStart, e.g. "2026-W44"
  weekStart: IsoDate, // Monday
  weekEnd: IsoDate, // Sunday
  generatedAt: z.string().max(40),
  trigger: z.enum(["schedule", "manual"]),
  headline: z.string().min(1).max(100),
  stats: WeekStats,
  wins: ReviewOutput.shape.wins,
  slips: ReviewOutput.shape.slips,
  focus: ReviewOutput.shape.focus,
  suggestions: ReviewOutput.shape.suggestions,
  summaryBy: z.enum(["jarvis", "fallback"]),
  snapshot: Snapshot, // for next week's goals/shopping diff
  notes: z.array(S(200)).max(10),
});
export type WeeklyReview = z.infer<typeof WeeklyReview>;

export const ReviewsFile = z.object({ version: z.literal(1), reviews: z.array(WeeklyReview).max(12) });
export type ReviewsFile = z.infer<typeof ReviewsFile>;
