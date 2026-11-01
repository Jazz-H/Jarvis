// Open-Meteo forecast (no key). Plain code: fetches and does all the math; the model only advises.
import { WeatherFacts } from "../schemas/weather.ts";

// WMO weather interpretation codes, as Open-Meteo documents them.
const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent rain showers",
  85: "Snow showers",
  86: "Snow showers",
  95: "Thunderstorms",
  96: "Thunderstorms with hail",
  99: "Thunderstorms with hail",
};
export const describeWeatherCode = (code: number) => WMO[code] ?? "Unknown";

export interface WeatherQuery {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  washDay: boolean;
}

export function forecastUrl(q: WeatherQuery): string {
  const p = new URLSearchParams({
    latitude: String(q.latitude),
    longitude: String(q.longitude),
    current: "temperature_2m,weather_code",
    hourly: "precipitation_probability,relative_humidity_2m,temperature_2m,weather_code,uv_index",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    temperature_unit: "fahrenheit",
    timezone: q.timezone,
    forecast_days: String(FORECAST_DAYS), // today, tomorrow for the evening view, and the 16-day list
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}
export const FORECAST_DAYS = 16; // Open-Meteo's longest forecast
export const OUTLOOK_DAYS = 90;
// Past the forecast: ECMWF's long-range ensemble (EC46, then SEAS5), every one of its 51 members,
// so code can take the middle high and low and count how many members have rain
export function seasonalUrl(q: WeatherQuery): string {
  const p = new URLSearchParams({
    latitude: String(q.latitude),
    longitude: String(q.longitude),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
    temperature_unit: "fahrenheit",
    precipitation_unit: "inch",
    timezone: q.timezone,
    forecast_days: String(OUTLOOK_DAYS + 2),
  });
  return `https://seasonal-api.open-meteo.com/v1/seasonal?${p}`;
}
const WET_INCHES = 0.04; // about 1 mm: a member counts as a wet day from here
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
type OutlookDay = NonNullable<WeatherFacts["outlook"]>[number];
// The forecast's days (from the main response): conditions and a real chance of rain
function forecastDays(j: any): OutlookDay[] {
  const d = j?.daily ?? {};
  const out: OutlookDay[] = [];
  (Array.isArray(d.time) ? d.time : []).forEach((date: unknown, i: number) => {
    const hi = d.temperature_2m_max?.[i],
      lo = d.temperature_2m_min?.[i];
    if (typeof date !== "string" || !finite(hi) || !finite(lo)) return;
    out.push({
      date,
      highF: Math.round(hi),
      lowF: Math.round(lo),
      rainChance: finite(d.precipitation_probability_max?.[i]) ? Math.round(d.precipitation_probability_max[i]) : 0,
      conditions: finite(d.weather_code?.[i]) ? describeWeatherCode(d.weather_code[i]) : null,
      kind: "forecast",
    });
  });
  return out;
}
// The outlook's days after `after`: the members' middle high and low, and the share of members with rain
async function outlookDays(q: WeatherQuery, after: string, until: string, fetchImpl: typeof fetch): Promise<OutlookDay[]> {
  try {
    const res = await fetchImpl(seasonalUrl(q), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return [];
    const d = ((await res.json()) as any)?.daily ?? {};
    const members = (base: string) => Object.keys(d).filter((k) => k === base || k.startsWith(base + "_member"));
    const [his, los, wet] = ["temperature_2m_max", "temperature_2m_min", "precipitation_sum"].map(members);
    const at = (keys: string[], i: number) => keys.map((k) => d[k]?.[i]).filter(finite);
    const out: OutlookDay[] = [];
    (Array.isArray(d.time) ? d.time : []).forEach((date: unknown, i: number) => {
      if (typeof date !== "string" || date <= after || date > until) return;
      const hi = at(his, i),
        lo = at(los, i),
        rain = at(wet, i);
      if (hi.length < 10 || lo.length < 10) return; // too few members to say anything
      out.push({
        date,
        highF: Math.round(median(hi)),
        lowF: Math.round(median(lo)),
        rainChance: rain.length ? Math.round((100 * rain.filter((r) => r >= WET_INCHES).length) / rain.length) : 0,
        conditions: null,
        kind: "outlook",
      });
    });
    return out;
  } catch {
    return [];
  }
}
const addDaysIso = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
// Open-Meteo's air-quality API (also keyless): today's hourly US AQI
export function airQualityUrl(q: WeatherQuery): string {
  const p = new URLSearchParams({
    latitude: String(q.latitude),
    longitude: String(q.longitude),
    hourly: "us_aqi",
    timezone: q.timezone,
    forecast_days: "1",
  });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${p}`;
}
// Worst waking-hour AQI today, or null when the air-quality service doesn't answer (it's optional)
async function fetchAqi(q: WeatherQuery, fetchImpl: typeof fetch): Promise<number | null> {
  try {
    const res = await fetchImpl(airQualityUrl(q), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as any;
    const times: string[] = j?.hourly?.time ?? [];
    const vals: unknown[] = j?.hourly?.us_aqi ?? [];
    const day = times
      .map((t, i) => [Number(t.slice(11, 13)), vals[i]] as const)
      .filter(([h, v]) => h >= 6 && h <= 22 && typeof v === "number")
      .map(([, v]) => v as number);
    return day.length ? Math.round(Math.max(...day)) : null;
  } catch {
    return null;
  }
}

const num = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Open-Meteo: missing ${what}`);
  return v;
};

export async function fetchWeather(q: WeatherQuery, fetchImpl: typeof fetch = fetch): Promise<WeatherFacts> {
  const res = await fetchImpl(forecastUrl(q), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const j = (await res.json()) as any;
  const times: string[] = j?.hourly?.time ?? [];
  const rain: unknown[] = j?.hourly?.precipitation_probability ?? [];
  const humidity: unknown[] = j?.hourly?.relative_humidity_2m ?? [];
  const temps: unknown[] = j?.hourly?.temperature_2m ?? [];
  const codes: unknown[] = j?.hourly?.weather_code ?? [];
  const uv: unknown[] = j?.hourly?.uv_index ?? [];
  const uvHours: { hour: number; uv: number }[] = [];
  const hourlyRain: WeatherFacts["hourlyRain"] = [];
  const dayHumidity: number[] = [];
  const today = String(j?.daily?.time?.[0] ?? "");
  times.forEach((t, i) => {
    if (today && !t.startsWith(today)) return; // the hourly list and humidity are about today
    const hour = Number(t.slice(11, 13));
    if (hour < 6 || hour > 22) return; // waking hours only
    if (typeof rain[i] === "number")
      hourlyRain.push({
        hour,
        chance: Math.round(rain[i] as number),
        ...(typeof temps[i] === "number" ? { tempF: Math.round(temps[i] as number) } : {}),
        ...(typeof codes[i] === "number" ? { conditions: describeWeatherCode(codes[i] as number) } : {}),
      });
    if (typeof humidity[i] === "number") dayHumidity.push(humidity[i] as number);
    if (typeof uv[i] === "number") uvHours.push({ hour, uv: uv[i] as number });
  });
  // UV: the day's peak, and the hours it's high (6+), for SPF advice
  const uvMax = uvHours.length ? Math.round(Math.max(...uvHours.map((h) => h.uv))) : null;
  const high = uvHours.filter((h) => h.uv >= 6);
  const uvHigh = high.length ? { from: high[0].hour, to: high[high.length - 1].hour + 1 } : null;
  // The 90 days: the forecast's 16, then the long-range outlook (optional: a failure keeps the 16)
  const forecast = forecastDays(j);
  const lastDay = today ? addDaysIso(today, OUTLOOK_DAYS - 1) : "";
  const [aqi, later] = await Promise.all([
    fetchAqi(q, fetchImpl),
    today ? outlookDays(q, forecast.at(-1)?.date ?? addDaysIso(today, -1), lastDay, fetchImpl) : Promise.resolve([]),
  ]);
  const outlook = [...forecast, ...later].slice(0, OUTLOOK_DAYS);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  // Tomorrow's outlook, for the app's evening Tomorrow view (null if the second day is missing)
  const d1 = (k: string) => j?.daily?.[k]?.[1];
  const tomorrow =
    typeof d1("time") === "string" &&
    [d1("weather_code"), d1("temperature_2m_max"), d1("temperature_2m_min")].every(
      (v) => typeof v === "number" && Number.isFinite(v),
    )
      ? {
          date: d1("time") as string,
          conditions: describeWeatherCode(d1("weather_code")),
          highF: Math.round(d1("temperature_2m_max")),
          lowF: Math.round(d1("temperature_2m_min")),
          rainChanceMax:
            typeof d1("precipitation_probability_max") === "number"
              ? Math.round(d1("precipitation_probability_max"))
              : 0,
        }
      : null;
  return WeatherFacts.parse({
    tomorrow,
    outlook: outlook.length ? outlook : null,
    location: q.name,
    date: today,
    conditions: describeWeatherCode(num(j?.daily?.weather_code?.[0], "daily weather code")),
    currentF: Math.round(num(j?.current?.temperature_2m, "current temperature")),
    highF: Math.round(num(j?.daily?.temperature_2m_max?.[0], "high")),
    lowF: Math.round(num(j?.daily?.temperature_2m_min?.[0], "low")),
    humidityPct: avg(dayHumidity),
    rainChanceMax: Math.round(
      typeof j?.daily?.precipitation_probability_max?.[0] === "number"
        ? j.daily.precipitation_probability_max[0]
        : Math.max(0, ...hourlyRain.map((h) => h.chance)),
    ),
    hourlyRain,
    washDay: q.washDay,
    uvMax,
    uvHigh,
    aqi,
  });
}
