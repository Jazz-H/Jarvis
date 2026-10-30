import { z } from "zod";

// What code measures (tools/open-meteo.ts). The model never produces these numbers.
export const WeatherFacts = z.object({
  location: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  conditions: z.string(),
  currentF: z.number(),
  highF: z.number(),
  lowF: z.number(),
  humidityPct: z.number().min(0).max(100), // daytime average
  rainChanceMax: z.number().min(0).max(100),
  // Waking hours; temperature and conditions feed the app's hour-by-hour list
  hourlyRain: z
    .array(
      z.object({
        hour: z.number().int().min(0).max(23),
        chance: z.number().min(0).max(100),
        tempF: z.number().optional(),
        conditions: z.string().optional(),
      }),
    )
    .max(24),
  washDay: z.boolean(),
});
export type WeatherFacts = z.infer<typeof WeatherFacts>;

// What the Weather sub-agent returns: judgment only.
export const WeatherAdvice = z.object({
  summary: z.string().min(1).max(200),
  wear: z.string().min(1).max(160),
  washDayNote: z.string().max(160).nullable(),
});
export type WeatherAdvice = z.infer<typeof WeatherAdvice>;

export const WeatherCard = WeatherFacts.extend(WeatherAdvice.shape);
export type WeatherCard = z.infer<typeof WeatherCard>;
