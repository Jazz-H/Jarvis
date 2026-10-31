// Jarvis's brain: what the owner has told Jarvis to remember, how they've rated its answers and
// briefings, its settings (tone, news topics, a note about the owner) and their own check-ins.
// The app writes all of it (synced keys jarvis-memory, jarvis-feedback, jarvis-settings in
// jazz2-data.json); this only reads it. Synced text is untrusted: trimmed, capped, and only ever
// shown to a model as data.
import { localTime } from "./schedule.ts";

export type Tone = "brief" | "normal" | "detailed";
export interface Checkin {
  id: string;
  name: string;
  prompt: string;
  days: number[]; // 0 = Sunday
  time: string; // HH:MM, America/New_York
}
export interface Brain {
  memory: { id: string; text: string; by: "you" | "jarvis" }[];
  about: string;
  tone: Tone;
  newsTopics: string[];
  checkins: Checkin[];
  feedback: { kind: "answer" | "briefing"; item: string; vote: 1 | -1; at: number }[];
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const clip = (s: unknown, n: number) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

export const BRAIN_LIMITS = { memory: 60, feedback: 60, checkins: 8, topics: 6 };

export function emptyBrain(): Brain {
  return { memory: [], about: "", tone: "normal", newsTopics: [], checkins: [], feedback: [] };
}

export function readBrain(data: unknown): Brain {
  if (!isObj(data)) return emptyBrain();
  const s = isObj(data["jarvis-settings"]) ? data["jarvis-settings"] : {};
  const memory = arr(data["jarvis-memory"])
    .filter((m) => isObj(m) && SAFE_ID.test(String(m.id)) && clip(m.text, 200))
    .slice(0, BRAIN_LIMITS.memory)
    .map((m) => ({ id: String(m.id), text: clip(m.text, 200), by: m.by === "jarvis" ? ("jarvis" as const) : ("you" as const) }));
  const feedback = arr(data["jarvis-feedback"])
    .filter((f) => isObj(f) && (f.kind === "answer" || f.kind === "briefing") && (f.vote === 1 || f.vote === -1))
    .map((f) => ({ kind: f.kind, item: clip(f.item, 200), vote: f.vote, at: Number(f.at) || 0 }))
    .sort((a, b) => b.at - a.at)
    .slice(0, BRAIN_LIMITS.feedback);
  const checkins = arr(s.checkins)
    .filter((c) => isObj(c) && c.on !== false && SAFE_ID.test(String(c.id)) && clip(c.prompt, 300))
    .slice(0, BRAIN_LIMITS.checkins)
    .map((c) => ({
      id: String(c.id),
      name: clip(c.name, 40) || "Check-in",
      prompt: clip(c.prompt, 300),
      days: [...new Set(arr(c.days).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
      time: typeof c.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(c.time) ? c.time : "",
    }))
    .filter((c) => c.days.length && c.time);
  return {
    memory,
    about: clip(s.about, 600),
    tone: s.tone === "brief" || s.tone === "detailed" ? s.tone : "normal",
    newsTopics: arr(s.newsTopics)
      .map((t) => clip(t, 30))
      .filter(Boolean)
      .slice(0, BRAIN_LIMITS.topics),
    checkins,
    feedback: feedback as Brain["feedback"],
  };
}

// What a model sees: the facts, the note, the tone and the latest ratings (newest first)
export function brainForPrompt(b: Brain) {
  return {
    remember: b.memory.map((m) => m.text),
    about: b.about || null,
    tone: b.tone,
    recentRatings: b.feedback.slice(0, 15).map((f) => ({ on: f.kind, item: f.item, rating: f.vote > 0 ? "useful" : "not useful" })),
  };
}

export const BRAIN_RULES = `"brain" is what the owner set up for you: "remember" (facts they asked you to keep in mind:
use them whenever they matter, never repeat them back for no reason), "about" (a note about
themselves), "tone" ("brief": as short as possible; "normal"; "detailed": a little more context)
and "recentRatings" (what they found useful or not lately: lean toward what they liked, away from
what they didn't).`;

// Check-ins due now: today's weekday is one of its days, its time has passed (New York), not more
// than 6 hours ago (a late run doesn't send a stale one), and it hasn't run today (`done` holds the
// answer ids already written). The answer id is fixed per check-in and day, so it runs once.
export function checkinAnswerId(c: Checkin, date: string) {
  const base = c.id.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 22);
  return `ck-${base}-${date.replace(/-/g, "")}`.slice(0, 40);
}
export function dueCheckins(b: Brain, now: Date, timeZone: string, done: Set<string>): { checkin: Checkin; id: string; date: string }[] {
  const t = localTime(now, timeZone);
  const dow = new Date(t.date + "T12:00:00Z").getUTCDay();
  return b.checkins
    .filter((c) => c.days.includes(dow))
    .map((c) => {
      const [h, m] = c.time.split(":").map(Number);
      return { c, mins: h * 60 + m };
    })
    .filter(({ mins }) => mins <= t.minutes && t.minutes - mins <= 6 * 60)
    .map(({ c }) => ({ checkin: c, id: checkinAnswerId(c, t.date), date: t.date }))
    .filter((x) => !done.has(x.id));
}
