import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fetchWeather, forecastUrl, describeWeatherCode } from "../tools/open-meteo.ts";
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
    expect(u.searchParams.get("forecast_days")).toBe("2");
  });

  it("turns the response into facts, keeping waking hours only", async () => {
    const { impl, calls } = fakeFetch([
      ["https://api.open-meteo.com/", () => json(fixture)],
      ["https://air-quality-api.open-meteo.com/", () => json({}, 503)], // optional: a failure just means no AQI
    ]);
    const f = await fetchWeather(q, impl);
    expect(calls).toHaveLength(2);
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
