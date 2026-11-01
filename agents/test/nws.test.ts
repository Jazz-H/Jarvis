import { describe, it, expect } from "vitest";
import { fetchAlerts, alertsUrl } from "../tools/nws.ts";
import { fakeFetch, json } from "./helpers.ts";

const feature = (p: object) => ({ properties: { status: "Actual", messageType: "Alert", ...p } });

describe("NWS alerts tool", () => {
  it("asks for the point (4 decimals) and names itself", async () => {
    expect(alertsUrl(39.78123, -89.656)).toBe("https://api.weather.gov/alerts/active?point=39.7812,-89.6560");
    const { impl, calls } = fakeFetch([["https://api.weather.gov/", () => json({ features: [] })]]);
    await fetchAlerts(39.781, -89.656, impl);
    expect(new Headers(calls[0].init?.headers).get("User-Agent")).toMatch(/jazz/);
  });

  it("keeps real alerts, most severe first, trimmed; drops tests and cancels", async () => {
    const { impl } = fakeFetch([
      [
        "https://api.weather.gov/",
        () =>
          json({
            features: [
              feature({ event: "Wind Advisory", severity: "Moderate", headline: "Wind Advisory  until 6PM", ends: "2026-11-02T18:00:00-05:00" }),
              feature({ event: "Tornado Warning", severity: "Extreme", headline: "x".repeat(400), ends: null, expires: "2026-11-02T13:45:00-05:00" }),
              feature({ event: "Test Message", severity: "Minor", status: "Test" }),
              feature({ event: "Flood Watch", severity: "Severe", messageType: "Cancel" }),
              feature({ event: "Odd", severity: "Bogus", headline: "h" }),
              { nope: true },
            ],
          }),
      ],
    ]);
    const a = await fetchAlerts(39.781, -89.656, impl);
    expect(a.map((x) => [x.event, x.severity])).toEqual([
      ["Tornado Warning", "Extreme"],
      ["Wind Advisory", "Moderate"],
      ["Odd", "Unknown"],
    ]);
    expect(a[0].headline).toHaveLength(240);
    expect(a[0].ends).toBe("2026-11-02T13:45:00-05:00"); // falls back to expires
    expect(a[1].headline).toBe("Wind Advisory until 6PM");
  });

  it("no alerts when NWS fails or the place is outside the US", async () => {
    expect(await fetchAlerts(51.5, -0.1, fakeFetch([["https://api.weather.gov/", () => json({ title: "Not found" }, 404)]]).impl)).toEqual([]);
    expect(await fetchAlerts(35, -80, fakeFetch([]).impl)).toEqual([]); // a thrown fetch
  });
});
