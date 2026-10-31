import { z } from "zod";

// Ask Jarvis. Two gist files, one writer each:
//   jazz2-ask.json      written ONLY by the app: the questions (read here as untrusted data)
//   jazz2-answers.json  written ONLY by the backend (ask.ts): answers + usage counts
// The app treats jazz2-answers.json as untrusted, read-only data. Every string and array is capped.

export const ASK_ID = /^[a-z0-9-]{8,40}$/; // opaque; the only thing that crosses into Actions
export const ASK_FILE_NAME = /^jazz2-file-[a-z0-9-]{8,40}\.json$/; // a question's photo or PDF
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoTime = z
  .string()
  .max(40)
  .refine((s) => Number.isFinite(Date.parse(s)), "not a date-time");
const N = z.number().int().min(0).max(100_000);
const Usd = z.number().min(0).max(100_000);

export const AskSource = z.enum(["jazz", "calendar", "inbox", "deliveries", "weather", "news", "review", "web"]);
export type AskSource = z.infer<typeof AskSource>;

// ---- jazz2-ask.json (the app's file) ----
export const AskItem = z.object({
  id: z.string().regex(ASK_ID),
  kind: z.enum(["ask", "sort"]), // sort: Sort with Jarvis (a brain dump split into chips)
  text: z.string().max(1000), // longer questions are cut to 1,000 characters before this check
  at: IsoTime, // when it was asked
  thread: z.string().regex(ASK_ID).optional(), // id of the first question in a follow-up chain
  file: z.string().regex(ASK_FILE_NAME).optional(), // a photo or PDF sent with the question
});
export type AskItem = z.infer<typeof AskItem>;

// A photo or PDF sent with a question: its own gist file, written by the app with the question and
// deleted by the Ask run once it's answered. Only these types, at most ~4.5 MB of base64.
export const ATTACH_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] as const;
export const AskAttachment = z.object({
  version: z.literal(1),
  name: z.string().max(120),
  mime: z.enum(ATTACH_TYPES),
  data: z
    .string()
    .max(6_000_000)
    .regex(/^[A-Za-z0-9+/]+=*$/),
});
export type AskAttachment = z.infer<typeof AskAttachment>;

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
  kind: z.enum(["todo", "shopping", "expense"]), // expense: opens Budget's add sheet, filled in
  text: z.string().min(1).max(120),
  due: IsoDate.optional(),
  amount: z.number().positive().max(100_000).optional(), // expense only
});
export type AskChip = z.infer<typeof AskChip>;

// Small things Jarvis may do when the owner asks it to (Ask only). Code checks every one against
// the owner's data and writes the label; only the app applies them, on the device that asked,
// with Undo. An answer that used web search carries none.
export const ACTION_TYPES = [
  "todo_done",
  "todo_add",
  "todo_move",
  "goal_done",
  "shopping_add",
  "shopping_bought",
  "weight_log",
  "workout_done",
  "remember", // keep a fact in Jarvis's memory (text)
  "forget", // drop one (id)
] as const;
export const AskAction = z.object({
  type: z.enum(ACTION_TYPES),
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,80}$/)
    .optional(), // the to-do, goal item, Shopping item or workout plan
  text: z.string().min(1).max(200).optional(), // todo_add, shopping_add, remember
  date: IsoDate.optional(), // todo_add / todo_move: the due date; weight_log / workout_done: the day
  lbs: z.number().min(40).max(800).optional(), // weight_log
  label: z.string().min(1).max(160), // what was done, in plain words (written by code)
});
export type AskAction = z.infer<typeof AskAction>;
export const AskLink = z.object({
  title: z.string().min(1).max(100),
  url: z
    .string()
    .max(500)
    .regex(/^https:\/\/[^\s<>"']+$/),
});
export type AskLink = z.infer<typeof AskLink>;

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
  chips: z.array(AskChip).max(12), // 3 for a question, up to 12 for a sort
  actions: z.array(AskAction).max(5).optional(), // what Jarvis did (the app applies them)
  links: z.array(AskLink).max(3).optional(), // web pages the answer used
  checkin: z.string().min(1).max(40).optional(), // a scheduled check-in's name (no question asked)
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
        kind: z.enum(["todo", "shopping", "expense"]),
        text: z.string().max(300),
        due: z.string().max(40).nullable(),
        amount: z.number().nullable().optional(),
      }),
    )
    .max(6),
  actions: z
    .array(
      z.object({
        type: z.enum(ACTION_TYPES),
        id: z.string().max(80).nullable(),
        text: z.string().max(300).nullable(),
        date: z.string().max(40).nullable(),
        lbs: z.number().nullable(),
      }),
    )
    .max(8)
    .optional(),
  links: z
    .array(z.object({ title: z.string().max(300), url: z.string().max(1000) }))
    .max(6)
    .optional(),
});
export type AskOutput = z.infer<typeof AskOutput>;

// What the Sorter returns for a "sort" item; loose on purpose, cleaned by subagents/sorter.ts
export const SortOutput = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(["todo", "shopping"]),
        text: z.string().max(300),
        due: z.string().max(40).nullable(),
      }),
    )
    .max(20),
});
export type SortOutput = z.infer<typeof SortOutput>;
