// Jarvis's brain: what the owner has told Jarvis to remember, how they've rated its answers and
// briefings, its settings (tone, news topics, a note about the owner), their own check-ins and the
// Notebook. The app writes all of it (synced keys jarvis-memory, jarvis-notes, jarvis-feedback, jarvis-settings in
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
  notes: { id: string; title: string; text: string; at: string }[]; // the Notebook, newest first
  about: string;
  tone: Tone;
  newsTopics: string[];
  checkins: Checkin[];
  feedback: { kind: "answer" | "briefing"; item: string; vote: 1 | -1; at: number }[];
  hiddenPackages: string[]; // lowercased item names the owner hid ("Got it" in Home's Deliveries)
  hiddenLines: string[]; // lowercased briefing lines the owner dismissed (first 200 characters)
  hiddenSuggestions: string[]; // lowercased suggested to-dos the owner dismissed
  location: DeviceLocation | null; // where the owner is, from the app ("Use my location"), for the weather
}
// Rounded to 3 decimals (about 100 m): finer than any forecast grid. Never logged or put in a prompt.
export interface DeviceLocation {
  latitude: number;
  longitude: number;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const clip = (s: unknown, n: number) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

export const BRAIN_LIMITS = { notes: 30, notesPromptChars: 12_000, memory: 60, feedback: 60, checkins: 8, topics: 6, hiddenPackages: 20, hiddenLines: 10, hiddenSuggestions: 20 };

export function emptyBrain(): Brain {
  return { memory: [], notes: [], about: "", tone: "normal", newsTopics: [], checkins: [], feedback: [], hiddenPackages: [], hiddenLines: [], hiddenSuggestions: [], location: null };
}
function readLocation(v: unknown): DeviceLocation | null {
  if (!isObj(v)) return null;
  const lat = Number(v.lat),
    lon = Number(v.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { latitude: Math.round(lat * 1000) / 1000, longitude: Math.round(lon * 1000) / 1000 };
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
  const notes = arr(data["jarvis-notes"])
    .filter((n) => isObj(n) && SAFE_ID.test(String(n.id)) && clip(n.title, 60))
    .slice(0, BRAIN_LIMITS.notes)
    .map((n) => ({
      id: String(n.id),
      title: clip(n.title, 60),
      text: String(n.text ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 2000),
      at: typeof n.at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(n.at) ? n.at : "",
    }));
  return {
    memory,
    notes,
    about: clip(s.about, 600),
    tone: s.tone === "brief" || s.tone === "detailed" ? s.tone : "normal",
    newsTopics: arr(s.newsTopics)
      .map((t) => clip(t, 30))
      .filter(Boolean)
      .slice(0, BRAIN_LIMITS.topics),
    checkins,
    feedback: feedback as Brain["feedback"],
    hiddenPackages: arr(s.hiddenPackages)
      .filter((h) => isObj(h) && clip(h.item, 80))
      .slice(0, BRAIN_LIMITS.hiddenPackages)
      .map((h) => clip(h.item, 80).toLowerCase()),
    hiddenLines: arr(s.hiddenLines)
      .filter((h) => isObj(h) && clip(h.text, 200))
      .slice(0, BRAIN_LIMITS.hiddenLines)
      .map((h) => clip(h.text, 200).toLowerCase()),
    hiddenSuggestions: arr(s.hiddenSuggestions)
      .filter((h) => isObj(h) && clip(h.text, 80))
      .slice(0, BRAIN_LIMITS.hiddenSuggestions)
      .map((h) => clip(h.text, 80).toLowerCase()),
    location: readLocation(s.location),
  };
}

// Packages the owner hid stay out of the briefing, its alerts and Ask (exact name, any case)
export function withoutHidden<T extends { item: string }>(packages: T[], hidden: string[]): T[] {
  if (!hidden.length) return packages;
  const ids = new Set(hidden.flatMap(pkgIds));
  return packages.filter((p) => !hidden.includes(p.item.toLowerCase()) && !pkgIds(p.item).some((w) => ids.has(w)));
}
// Is this line or suggestion about a package the owner said came? Its whole name, or two of its
// words ("Acme Glow" for "Acme Glow C-10 serum"). A one-word name only counts on a delivery or
// inbox line, so "Belt" doesn't hide "Buy a belt". An order number ("#48151": 5+ characters
// with a digit) counts anywhere. js/jarvis.js mentionsPackage matches this.
const PKG_SKIP = new Set(["the", "and", "for", "your", "with", "from", "order", "orders", "package", "packages", "delivery", "item", "items", "set", "pack", "new"]);
const pkgWords = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !PKG_SKIP.has(w));
const pkgIds = (s: string) => pkgWords(s).filter((w) => w.length >= 5 && /\d/.test(w));
export function mentionsHidden(text: string, hidden: string[], source: string | null = null): boolean {
  if (!hidden.length) return false;
  const t = text.toLowerCase();
  const words = new Set(pkgWords(t));
  return hidden.some((item) => {
    const ws = [...new Set(pkgWords(item))];
    const hits = ws.filter((w) => words.has(w)).length;
    if (pkgIds(item).some((w) => words.has(w))) return true;
    if (ws.length <= 1) return (source === "deliveries" || source === "inbox") && (hits === 1 || t.includes(item));
    return t.includes(item) || hits >= 2;
  });
}

// The Notebook for Ask: newest first, whole notes until about 12k characters, then titles only
export function notesForPrompt(b: Brain) {
  let left = BRAIN_LIMITS.notesPromptChars;
  return b.notes.map((n) => {
    const fits = n.text.length <= left;
    if (fits) left -= n.text.length;
    return { id: n.id, title: n.title, updated: n.at || null, text: fits ? n.text : null };
  });
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
what they didn't).
Clock times: the data's times are already Eastern (America/New_York); write them the 12-hour way
("7:30 PM", "7 AM"), never as 24-hour times like "19:30".`;

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
