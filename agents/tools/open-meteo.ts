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
    hourly: "precipitation_probability,relative_humidity_2m,temperature_2m,weather_code",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    temperature_unit: "fahrenheit",
    timezone: q.timezone,
    forecast_days: "1",
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
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
  const hourlyRain: WeatherFacts["hourlyRain"] = [];
  const dayHumidity: number[] = [];
  times.forEach((t, i) => {
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
  });
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  return WeatherFacts.parse({
    location: q.name,
    date: String(j?.daily?.time?.[0] ?? ""),
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
  });
}
