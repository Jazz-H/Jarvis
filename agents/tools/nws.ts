// National Weather Service alerts (no key; US only). Plain code: fetches and trims; alert text is
// untrusted data. A failure (or a place outside the US) just means no alerts.
const SEVERITY = ["Extreme", "Severe", "Moderate", "Minor", "Unknown"] as const;
export type AlertSeverity = (typeof SEVERITY)[number];
export interface WeatherAlert {
  event: string; // "Tornado Warning"
  severity: AlertSeverity;
  headline: string; // "Tornado Warning issued November 2 at 1:05PM EST until 1:45PM EST by NWS …"
  ends: string | null; // ISO time it ends (or expires)
}

export function alertsUrl(latitude: number, longitude: number): string {
  // NWS takes at most 4 decimals
  return `https://api.weather.gov/alerts/active?point=${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

const clip = (v: unknown, n: number) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

export async function fetchAlerts(
  latitude: number,
  longitude: number,
  fetchImpl: typeof fetch,
): Promise<WeatherAlert[]> {
  try {
    const res = await fetchImpl(alertsUrl(latitude, longitude), {
      // NWS asks every caller to identify itself; no contact details here (the repo is public)
      headers: { "User-Agent": "jazz-jarvis personal dashboard", Accept: "application/geo+json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as any;
    const features: any[] = Array.isArray(j?.features) ? j.features : [];
    return features
      .map((f) => f?.properties ?? {})
      .filter((p) => clip(p.event, 80) && p.status !== "Test" && p.messageType !== "Cancel")
      .map((p) => {
        const ends = [p.ends, p.expires].find((t) => typeof t === "string" && Number.isFinite(Date.parse(t))) ?? null;
        return {
          event: clip(p.event, 80),
          severity: (SEVERITY as readonly string[]).includes(p.severity) ? (p.severity as AlertSeverity) : "Unknown",
          headline: clip(p.headline, 240),
          ends,
        };
      })
      .sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity))
      .slice(0, 5);
  } catch {
    return [];
  }
}
