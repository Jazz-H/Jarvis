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
        code: z.number().int().nullable().optional(), // WMO code (forecast days), for the app's icons
        nightCode: z.number().int().nullable().optional(), // the night's most common code, 6pm to 6am
        kind: z.enum(["forecast", "outlook"]),
      }),
    )
    .max(92)
    .nullable()
    .optional(),
  code: z.number().int().nullable().optional(), // today's WMO code
  // at the run: feels like, humidity, wind (mph, 8-point direction), day or night
  now: z
    .object({
      feelsF: z.number().nullable(),
      humidityPct: z.number().min(0).max(100).nullable(),
      windMph: z.number().min(0).nullable(),
      gustMph: z.number().min(0).nullable(),
      windDir: z.string().max(2).nullable(),
      isDay: z.boolean(),
    })
    .nullable()
    .optional(),
  // the next 48 hours from the run (local "YYYY-MM-DDTHH:MM"), for the hourly strip and "now" later in the day
  hours: z
    .array(
      z.object({
        time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
        tempF: z.number(),
        feelsF: z.number().nullable(),
        chance: z.number().min(0).max(100),
        code: z.number().int().nullable(),
        isDay: z.boolean(),
        humidityPct: z.number().min(0).max(100).nullable(),
        windMph: z.number().min(0).nullable(),
        windDir: z.string().max(2).nullable(),
      }),
    )
    .max(48)
    .nullable()
    .optional(),
  // today's and tomorrow's sunrise and sunset, local "HH:MM"
  sun: z
    .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), rise: z.string().regex(/^\d{2}:\d{2}$/), set: z.string().regex(/^\d{2}:\d{2}$/) }))
    .max(2)
    .nullable()
    .optional(),
  // National Weather Service alerts for the spot, most severe first (untrusted text)
  alerts: z
    .array(
      z.object({
        event: z.string().max(80),
        severity: z.enum(["Extreme", "Severe", "Moderate", "Minor", "Unknown"]),
        headline: z.string().max(240),
        ends: z.string().nullable(),
      }),
    )
    .max(5)
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
