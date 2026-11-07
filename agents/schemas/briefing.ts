import { z } from "zod";
import { WeatherCard } from "./weather.ts";
import { NewsCard } from "./news.ts";
import { CalendarCard } from "./calendar.ts";
import { InboxCard } from "./inbox.ts";
import { DeliveryCard } from "./deliveries.ts";
import { MoneyCard } from "./money.ts";
import { PricesCard } from "./prices.ts";

export const SummarySource = z.enum(["weather", "news", "jazz", "jarvis", "calendar", "inbox", "deliveries", "money"]);

// What the Jarvis agent returns.
export const JarvisOutput = z.object({
  headline: z.string().min(1).max(100),
  summary: z
    .array(z.object({ text: z.string().min(1).max(240), source: SummarySource }))
    .min(1)
    .max(5),
  // to-dos worth adding (one-tap chips in the app, never added automatically); code checks the dates
  suggestions: z
    .array(z.object({ text: z.string().min(1).max(120), due: z.string().max(40).nullable() }))
    .max(6) // loose on purpose: code keeps the first 3 good ones (cleanSuggestions)
    .optional(),
  // the day's three most important open to-dos, by id; code checks each and takes the text from the app
  top3: z
    .array(z.object({ id: z.string().max(80), why: z.string().max(200) }))
    .max(6)
    .optional(),
});
export type JarvisOutput = z.infer<typeof JarvisOutput>;

export const Top3 = z
  .array(
    z.object({
      id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
      text: z.string().min(1).max(120), // from the app's data, as of the briefing
      why: z.string().max(100),
    }),
  )
  .max(3);
export type Top3 = z.infer<typeof Top3>;

const cardMeta = { agent: z.string(), model: z.string(), updatedAt: z.string() };
const errorCard = z.object({ status: z.literal("error"), error: z.string().max(200), ...cardMeta });
export const BriefingCard = <T extends z.ZodTypeAny>(data: T) =>
  z.discriminatedUnion("status", [z.object({ status: z.literal("ok"), data, ...cardMeta }), errorCard]);

// jazz2-briefing.json in the Gist. The app treats it as untrusted, read-only data.
export const Briefing = z.object({
  version: z.literal(1),
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generatedAt: z.string(),
  refreshedAt: z.string().optional(), // when a card refresh last redid the cards (jarvis.ts runRefresh)
  // Midday and evening updates (jarvis.ts runRefresh at CONFIG.refresh.updates): Jarvis wrote this
  // headline and summary then, over refreshed cards. Absent on the morning's own.
  edition: z.enum(["midday", "evening"]).optional(),
  editionAt: z.string().optional(),
  // What today's briefings already said (headlines and lines), and the to-dos they already suggested,
  // so a later update never says them again
  said: z.array(z.string().max(240)).max(40).optional(),
  suggested: z.array(z.string().max(80)).max(20).optional(),
  trigger: z.enum(["schedule", "manual"]),
  headline: z.string().max(100),
  summary: JarvisOutput.shape.summary,
  summaryBy: z.enum(["jarvis", "fallback"]),
  suggestions: z
    .array(
      z.object({
        text: z.string().min(1).max(80),
        due: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
      }),
    )
    .max(3)
    .optional(),
  top3: Top3.optional(), // Top 3 for today (Home pins them; Ask sees them)
  // calendar, inbox and deliveries are left out until their source is connected (SETUP.md)
  cards: z.object({
    weather: BriefingCard(WeatherCard),
    news: BriefingCard(NewsCard),
    calendar: BriefingCard(CalendarCard).optional(),
    inbox: BriefingCard(InboxCard).optional(),
    deliveries: BriefingCard(DeliveryCard).optional(),
    money: BriefingCard(MoneyCard).optional(), // Bill Guard: code over Budget data, no model
    prices: BriefingCard(PricesCard).optional(), // Price watcher: the latest weekly check
  }),
  notes: z.array(z.string().max(200)).max(10),
});
export type Briefing = z.infer<typeof Briefing>;
