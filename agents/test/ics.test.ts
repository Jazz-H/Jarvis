import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { eventsFromIcs, fetchCalendar } from "../tools/ics.ts";
import { fakeFetch, text } from "./helpers.ts";

const ICS = readFileSync(new URL("./fixtures/calendar.ics", import.meta.url), "utf8");
const NOW = new Date("2026-10-30T11:00:00Z"); // 7:00 AM in New York (EDT)
const TZ = "America/New_York";

describe("calendar (iCal) tool", () => {
  it("lists today's and tomorrow's events in local time, all-day first", () => {
    const f = eventsFromIcs(ICS, NOW, TZ);
    expect(f.date).toBe("2026-10-30");
    expect(f.events.map((e) => `${e.day} ${e.start ?? "all-day"} ${e.title}`)).toEqual([
      "today all-day Beach trip",
      "today 09:30 Standup", // weekly repeat, expanded
      "today 12:00 Lunch with Sam",
      "today 12:30 Call with the bank",
      "today 15:00 Dentist",
      "tomorrow all-day Beach trip", // spans two days
      "tomorrow 10:00 Oil change",
    ]);
    expect(f.events.find((e) => e.title === "Lunch with Sam")).toMatchObject({ end: "13:00", location: "Midtown" });
  });

  it("leaves out cancelled events and events outside today/tomorrow", () => {
    const titles = eventsFromIcs(ICS, NOW, TZ).events.map((e) => e.title);
    expect(titles).not.toContain("Cancelled meeting");
    expect(titles).not.toContain("Next week thing");
  });

  it("finds overlapping timed events today", () => {
    expect(eventsFromIcs(ICS, NOW, TZ).overlaps).toEqual([{ a: "Lunch with Sam", b: "Call with the bank" }]);
  });

  it("handles an empty or broken feed", () => {
    expect(eventsFromIcs("BEGIN:VCALENDAR\nEND:VCALENDAR\n", NOW, TZ).events).toEqual([]);
    expect(eventsFromIcs("not a calendar", NOW, TZ).events).toEqual([]);
  });

  it("only fetches https and never puts the secret address in errors", async () => {
    const secret = "https://calendar.google.com/calendar/ical/me%40gmail.com/private-SECRET/basic.ics";
    await expect(fetchCalendar("http://example.com/x.ics", NOW, TZ)).rejects.toThrow("https");
    const { impl } = fakeFetch([[secret, () => text("", 404)]]);
    const err = await fetchCalendar(secret, NOW, TZ, impl).catch((e) => e);
    expect(err.message).toBe("Calendar feed HTTP 404");
    expect(err.message).not.toContain("SECRET");
    const ok = fakeFetch([[secret, () => text(ICS)]]);
    expect((await fetchCalendar(secret, NOW, TZ, ok.impl)).events.length).toBe(7);
  });
});
