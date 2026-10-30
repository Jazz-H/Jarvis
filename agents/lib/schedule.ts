// GitHub cron is UTC-only and ignores daylight saving, so jarvis.yml fires twice each morning
// (once lined up for EDT, once for EST). Each run checks the local time and whether today's
// briefing already exists, so exactly one of them delivers it.

export interface LocalTime {
  date: string; // YYYY-MM-DD
  minutes: number; // minutes since local midnight
}

export function localTime(now: Date, timeZone: string): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export const toMinutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Bad time "${hhmm}" (want HH:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
};

// A scheduled run delivers if it's from 30 minutes before the briefing time to 2 hours after
// (GitHub can start cron jobs late), and today's briefing hasn't been written yet.
export function shouldDeliver(opts: {
  now: Date;
  timeZone: string;
  briefingTime: string;
  lastBriefingDate: string | null;
}): { deliver: boolean; reason: string; date: string } {
  const { date, minutes } = localTime(opts.now, opts.timeZone);
  const target = toMinutes(opts.briefingTime);
  if (opts.lastBriefingDate === date) return { deliver: false, reason: "today's briefing already exists", date };
  if (minutes < target - 30) return { deliver: false, reason: "too early (this is the other time zone's run)", date };
  if (minutes > target + 120) return { deliver: false, reason: "too late for a morning briefing", date };
  return { deliver: true, reason: "in the briefing window", date };
}

// The UTC cron lines for a local time in a zone with a standard and a daylight offset.
// Used by a test to keep jarvis.yml in step with config.ts.
export function utcCronLines(localHHMM: string, leadMinutes: number, utcOffsetsHours: number[]): string[] {
  const local = toMinutes(localHHMM) - leadMinutes;
  return utcOffsetsHours.map((off) => {
    const m = (((local - off * 60) % 1440) + 1440) % 1440;
    return `${m % 60} ${Math.floor(m / 60)} * * *`;
  });
}
