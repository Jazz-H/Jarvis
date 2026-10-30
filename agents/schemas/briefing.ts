import { z } from "zod";
import { WeatherCard } from "./weather.ts";
import { NewsCard } from "./news.ts";
import { CalendarCard } from "./calendar.ts";
import { InboxCard } from "./inbox.ts";
import { DeliveryCard } from "./deliveries.ts";

export const SummarySource = z.enum(["weather", "news", "jazz", "jarvis", "calendar", "inbox", "deliveries"]);

// What the Jarvis agent returns.
export const JarvisOutput = z.object({
  headline: z.string().min(1).max(100),
  summary: z
    .array(z.object({ text: z.string().min(1).max(240), source: SummarySource }))
    .min(1)
    .max(5),
});
export type JarvisOutput = z.infer<typeof JarvisOutput>;

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
  trigger: z.enum(["schedule", "manual"]),
  headline: z.string().max(100),
  summary: JarvisOutput.shape.summary,
  summaryBy: z.enum(["jarvis", "fallback"]),
  // calendar, inbox and deliveries are left out until their source is connected (SETUP.md)
  cards: z.object({
    weather: BriefingCard(WeatherCard),
    news: BriefingCard(NewsCard),
    calendar: BriefingCard(CalendarCard).optional(),
    inbox: BriefingCard(InboxCard).optional(),
    deliveries: BriefingCard(DeliveryCard).optional(),
  }),
  notes: z.array(z.string().max(200)).max(10),
});
export type Briefing = z.infer<typeof Briefing>;
