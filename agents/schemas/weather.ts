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
  // skin weather: today's peak UV, the hours it's high (6+), and the worst waking-hour US AQI
  uvMax: z.number().min(0).max(20).nullable().optional(),
  uvHigh: z
    .object({ from: z.number().int().min(0).max(23), to: z.number().int().min(1).max(24) })
    .nullable()
    .optional(),
  aqi: z.number().min(0).max(500).nullable().optional(),
  // tomorrow's outlook, shown by the app's evening Tomorrow view
  tomorrow: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      conditions: z.string(),
      highF: z.number(),
      lowF: z.number(),
      rainChanceMax: z.number().min(0).max(100),
    })
    .nullable()
    .optional(),
  // Up to 90 days from today: "forecast" days (the next 16, with conditions and a real chance of
  // rain), then "outlook" days (ECMWF's long-range ensemble: the middle high and low of its members,
  // and the share of members with rain; a trend, not a forecast). Never shown to the Weather model.
  outlook: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        highF: z.number(),
        lowF: z.number(),
        rainChance: z.number().min(0).max(100),
        conditions: z.string().nullable(),
        kind: z.enum(["forecast", "outlook"]),
      }),
    )
    .max(92)
    .nullable()
    .optional(),
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
