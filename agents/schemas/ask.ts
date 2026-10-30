import { z } from "zod";

// Ask Jarvis. Two gist files, one writer each:
//   jazz2-ask.json      written ONLY by the app: the questions (read here as untrusted data)
//   jazz2-answers.json  written ONLY by the backend (ask.ts): answers + usage counts
// The app treats jazz2-answers.json as untrusted, read-only data. Every string and array is capped.

export const ASK_ID = /^[a-z0-9-]{8,40}$/; // opaque; the only thing that crosses into Actions
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoTime = z
  .string()
  .max(40)
  .refine((s) => Number.isFinite(Date.parse(s)), "not a date-time");
const N = z.number().int().min(0).max(100_000);
const Usd = z.number().min(0).max(100_000);

export const AskSource = z.enum(["jazz", "calendar", "inbox", "deliveries", "weather", "news", "review"]);
export type AskSource = z.infer<typeof AskSource>;

// ---- jazz2-ask.json (the app's file) ----
export const AskItem = z.object({
  id: z.string().regex(ASK_ID),
  kind: z.literal("ask"),
  text: z.string().max(1000), // longer questions are cut to 1,000 characters before this check
  at: IsoTime, // when it was asked
  thread: z.string().regex(ASK_ID).optional(), // id of the first question in a follow-up chain
});
export type AskItem = z.infer<typeof AskItem>;

export const AskFile = z.object({
  version: z.literal(1),
  items: z.array(AskItem).max(20),
  clearBefore: IsoTime.optional(), // answers asked before this are deleted by the next run
});
export type AskFile = z.infer<typeof AskFile>;

// ---- jazz2-answers.json (the backend's file) ----
// A suggestion the owner can tap to add (never added on its own). A to-do's due date is from
// today to a year out.
export const AskChip = z.object({
  kind: z.enum(["todo", "shopping"]),
  text: z.string().min(1).max(120),
  due: IsoDate.optional(),
});
export type AskChip = z.infer<typeof AskChip>;

export const Answer = z.object({
  id: z.string().regex(ASK_ID), // the question's id
  askedAt: z.string().max(40), // the question's `at`, as the app wrote it
  answeredAt: z.string().max(40),
  // ok: answered (including "I don't have that"); declined: not something Jarvis answers here;
  // error: the model failed; over_limit: a daily, weekly or monthly limit was reached (no model call)
  status: z.enum(["ok", "error", "declined", "over_limit"]),
  text: z.string().max(1200), // plain text; no Markdown, no links (the app escapes it anyway)
  bullets: z.array(z.string().max(200)).max(5),
  sources: z.array(AskSource).max(6),
  chips: z.array(AskChip).max(3),
  by: z.enum(["jarvis", "fallback"]), // fallback: written by code (limits, errors), not the model
});
export type Answer = z.infer<typeof Answer>;

// Counts and spend for the limits, in America/New_York days, ISO weeks and months. A period that
// has rolled over starts again at zero.
export const AskUsage = z.object({
  day: IsoDate,
  dayCount: N,
  dayCostUsd: Usd,
  week: z.string().regex(/^\d{4}-W\d{2}$/),
  weekCount: N,
  month: z.string().regex(/^\d{4}-\d{2}$/),
  monthCostUsd: Usd,
});
export type AskUsage = z.infer<typeof AskUsage>;

export const AnswersFile = z.object({
  version: z.literal(1),
  answers: z.array(Answer).max(50), // newest first
  usage: AskUsage,
});
export type AnswersFile = z.infer<typeof AnswersFile>;

// ---- what the model returns ----
// Looser than Answer on purpose: code cleans and caps it (ask.ts cleanAskOutput), so a slightly
// long answer is trimmed instead of failing and costing a retry.
export const AskOutput = z.object({
  status: z.enum(["ok", "declined"]),
  text: z.string().min(1).max(3000),
  bullets: z.array(z.string().max(600)).max(10),
  sources: z.array(AskSource).max(10),
  chips: z
    .array(
      z.object({
        kind: z.enum(["todo", "shopping"]),
        text: z.string().max(300),
        due: z.string().max(40).nullable(),
      }),
    )
    .max(6),
});
export type AskOutput = z.infer<typeof AskOutput>;
