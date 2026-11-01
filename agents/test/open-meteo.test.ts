import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fetchWeather, forecastUrl, seasonalUrl, describeWeatherCode } from "../tools/open-meteo.ts";
import { fakeFetch, json } from "./helpers.ts";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/open-meteo.json", import.meta.url), "utf8"));
const q = {
  name: "Springfield, IL",
  latitude: 39.7817,
  longitude: -89.6501,
  timezone: "America/New_York",
  washDay: true,
};

describe("open-meteo tool", () => {
  it("builds a Fahrenheit, local-time forecast URL", () => {
    const u = new URL(forecastUrl(q));
    expect(u.host).toBe("api.open-meteo.com");
    expect(u.searchParams.get("temperature_unit")).toBe("fahrenheit");
    expect(u.searchParams.get("timezone")).toBe("America/New_York");
    expect(u.searchParams.get("latitude")).toBe("39.7817");
    expect(u.searchParams.get("forecast_days")).toBe("16");
    const s = new URL(seasonalUrl(q));
    expect(s.host).toBe("seasonal-api.open-meteo.com");
    expect(s.searchParams.get("forecast_days")).toBe("92");
    expect(s.searchParams.get("precipitation_unit")).toBe("inch");
    expect(s.searchParams.has("models")).toBe(false); // the default: all 51 members
  });

  // A seasonal response: the control plus 50 members, 92 days from the forecast's first day
  const seasonal = (n = 92) => {
    const time = Array.from({ length: n }, (_, i) => new Date(Date.parse("2026-10-29T12:00:00Z") + i * 864e5).toISOString().slice(0, 10));
    const daily: Record<string, unknown[]> = { time };
    for (let m = 0; m <= 50; m++) {
      const sfx = m ? `_member${String(m).padStart(2, "0")}` : "";
      daily["temperature_2m_max" + sfx] = time.map(() => 50 + m); // middle member: 75
      daily["temperature_2m_min" + sfx] = time.map((_, i) => (i === 40 && m === 0 ? null : 30 + m / 10)); // one member missing a day
      daily["precipitation_sum" + sfx] = time.map(() => (m < 17 ? 0.2 : 0.01)); // 17 of 51 wet: 33%
    }
    return { daily };
  };

  it("adds 90 days: the 16-day forecast, then the long-range outlook from the ensemble", async () => {
    const { impl, calls } = fakeFetch([
      ["https://api.open-meteo.com/", () => json(fixture)],
      ["https://air-quality-api.open-meteo.com/", () => json({}, 503)],
      ["https://seasonal-api.open-meteo.com/", () => json(seasonal())],
    ]);
    const f = await fetchWeather(q, impl);
    expect(calls).toHaveLength(3);
    const o = f.outlook!;
    expect(o).toHaveLength(90); // Oct 29 + 89 days
    expect(o[0]).toEqual({ date: "2026-10-29", highF: 69, lowF: 49, rainChance: 60, conditions: "Light rain", kind: "forecast" });
    expect(o[1]).toMatchObject({ date: "2026-10-30", kind: "forecast", conditions: "Partly cloudy" });
    // the outlook starts the day after the forecast's last day (the fixture has 2)
    expect(o[2]).toEqual({ date: "2026-10-31", highF: 75, lowF: 33, rainChance: 33, conditions: null, kind: "outlook" });
    expect(o.at(-1)!.date).toBe("2027-01-26");
    expect(o.filter((d) => d.kind === "outlook").find((d) => d.lowF !== 33)).toBeUndefined(); // a missing member doesn't skew the middle value
  });

  it("keeps the forecast's days when the outlook fails or has too few members", async () => {
    const down = fakeFetch([
      ["https://api.open-meteo.com/", () => json(fixture)],
      ["https://air-quality-api.open-meteo.com/", () => json({}, 503)],
      ["https://seasonal-api.open-meteo.com/", () => json({ reason: "busy" }, 500)],
    ]);
    expect((await fetchWeather(q, down.impl)).outlook!.map((d) => d.kind)).toEqual(["forecast", "forecast"]);
    const thin = fakeFetch([
      ["https://api.open-meteo.com/", () => json(fixture)],
      ["https://air-quality-api.open-meteo.com/", () => json({}, 503)],
      ["https://seasonal-api.open-meteo.com/", () => json({ daily: { time: ["2026-11-01"], temperature_2m_max: [60], temperature_2m_min: [40] } })],
    ]);
    expect((await fetchWeather(q, thin.impl)).outlook).toHaveLength(2);
  });

  it("turns the response into facts, keeping waking hours only", async () => {
    const { impl, calls } = fakeFetch([
      ["https://api.open-meteo.com/", () => json(fixture)],
      ["https://air-quality-api.open-meteo.com/", () => json({}, 503)], // optional: a failure just means no AQI
      ["https://seasonal-api.open-meteo.com/", () => json({}, 503)], // optional too
    ]);
    const f = await fetchWeather(q, impl);
    expect(calls).toHaveLength(3);
    expect(f.uvMax).toBe(7); // waking hours only (tomorrow's 9 is left out)
    expect(f.uvHigh).toEqual({ from: 12, to: 13 });
    expect(f.aqi).toBeNull();
    expect(f).toMatchObject({
      location: "Springfield, IL",
      date: "2026-10-29",
      conditions: "Light rain",
      currentF: 51,
      highF: 69,
      lowF: 49,
      rainChanceMax: 60,
      washDay: true,
    });
    expect(f.hourlyRain.map((h) => h.hour)).toEqual([6, 7, 12, 17]); // 5am and 11pm dropped
    expect(f.hourlyRain[2]).toEqual({ hour: 12, chance: 60, tempF: 61, conditions: "Light rain" });
    expect(f.hourlyRain).toHaveLength(4); // tomorrow's hours are left out
    expect(f.tomorrow).toEqual({
      date: "2026-10-30",
      conditions: "Partly cloudy",
      highF: 72,
      lowF: 52,
      rainChanceMax: 20,
    });
    expect(f.humidityPct).toBe(75); // mean of 90, 80, 60, 70
  });

  it("reads the day's worst waking-hour air quality", async () => {
    const aq = {
      hourly: {
        time: ["2026-10-29T03:00", "2026-10-29T08:00", "2026-10-29T15:00", "2026-10-29T23:00"],
        us_aqi: [120, 38, 51.4, 140],
      },
    };
    const { impl } = fakeFetch([
      ["https://api.open-meteo.com/", () => json(fixture)],
      ["https://air-quality-api.open-meteo.com/", () => json(aq)],
    ]);
    expect((await fetchWeather(q, impl)).aqi).toBe(51);
  });

  it("throws on an HTTP error or a missing field", async () => {
    await expect(fetchWeather(q, fakeFetch([[/open-meteo/, () => json({}, 503)]]).impl)).rejects.toThrow("HTTP 503");
    const broken = { ...fixture, daily: { ...fixture.daily, temperature_2m_max: [] } };
    await expect(fetchWeather(q, fakeFetch([[/open-meteo/, () => json(broken)]]).impl)).rejects.toThrow("missing high");
  });

  it("names weather codes and falls back for unknown ones", () => {
    expect(describeWeatherCode(0)).toBe("Clear");
    expect(describeWeatherCode(95)).toBe("Thunderstorms");
    expect(describeWeatherCode(42)).toBe("Unknown");
  });
});
