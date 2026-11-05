// The morning run's day digest for the Weekly Review (jazz2-week.json). Built only from the
// briefing's already-validated Inbox, Deliveries and Calendar cards, shortened again (no raw
// email text beyond what the card holds). Only the orchestrator writes the file; the last
// CONFIG.digestDaysKept days are kept.
import type { Briefing } from "../schemas/briefing.ts";
import { DayDigest, WeekFile } from "../schemas/week.ts";

const clip = (s: unknown, n: number) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const isIso = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const person = (p: { from: string; summary: string }) => ({ from: clip(p.from, 30), summary: clip(p.summary, 60) });

// null when the day has none of the three cards (Google not connected, or all three failed)
export function buildDayDigest(b: Briefing): DayDigest | null {
  const d: DayDigest = { date: b.date };
  const { inbox, deliveries, calendar } = b.cards;
  if (inbox?.status === "ok") {
    const x = inbox.data;
    d.inbox = {
      unread: Math.min(100_000, x.unread),
      urgent: x.urgent.length,
      needsReply: x.needsReply.slice(0, 5).map(person),
      bills: x.bills.slice(0, 5).map((bill) => ({
        payee: clip(bill.payee, 30),
        amount: bill.amount == null ? null : Math.min(10_000_000, Math.max(0, bill.amount)),
        status: bill.status,
      })),
    };
  }
  if (deliveries?.status === "ok")
    d.deliveries = {
      packages: deliveries.data.packages
        .slice(0, 5)
        .map((p) => ({ item: clip(p.item, 40), status: p.status, eta: isIso(p.eta) ? p.eta : null })),
    };
  if (calendar?.status === "ok") {
    const today = calendar.data.events.filter((e) => e.day === "today");
    d.calendar = {
      events: today.length,
      overlaps: calendar.data.overlaps.length,
      titles: today.slice(0, 4).map((e) => clip(e.title, 40)),
    };
  }
  if (!d.inbox && !d.deliveries && !d.calendar) return null;
  return DayDigest.parse(d);
}

// A later run the same day adds to what the morning saw, so nothing leaves the week's record because
// the owner has read the email by then (Inbox only looks at unread mail) or a package left the list.
// The calendar is simply its latest view: an event that's gone was cancelled.
export function combineDigests(old: DayDigest, next: DayDigest): DayDigest {
  const by = <T>(key: (x: T) => string, first: T[], then: T[]) => {
    const seen = new Set<string>();
    return [...first, ...then].filter((x) => !seen.has(key(x)) && seen.add(key(x)));
  };
  const low = (s: string) => s.toLowerCase();
  const inbox =
    old.inbox && next.inbox
      ? {
          unread: Math.max(old.inbox.unread, next.inbox.unread),
          urgent: Math.max(old.inbox.urgent, next.inbox.urgent),
          needsReply: by(
            (p: { from: string; summary: string }) => low(p.from),
            old.inbox.needsReply,
            next.inbox.needsReply,
          ).slice(0, 5),
          bills: by(
            (b: NonNullable<DayDigest["inbox"]>["bills"][number]) => low(b.payee),
            next.inbox.bills,
            old.inbox.bills,
          ).slice(0, 5),
        }
      : (next.inbox ?? old.inbox);
  const deliveries =
    old.deliveries && next.deliveries
      ? {
          packages: by(
            (p: NonNullable<DayDigest["deliveries"]>["packages"][number]) => low(p.item),
            next.deliveries.packages,
            old.deliveries.packages,
          ).slice(0, 5),
        }
      : (next.deliveries ?? old.deliveries);
  const calendar = next.calendar ?? old.calendar;
  return DayDigest.parse({
    date: next.date,
    ...(inbox ? { inbox } : {}),
    ...(deliveries ? { deliveries } : {}),
    ...(calendar ? { calendar } : {}),
  });
}

// The valid days in jazz2-week.json; anything malformed is dropped (the file is ours to rebuild)
export function readWeekFile(raw: string | null): DayDigest[] {
  if (!raw) return [];
  let j: any;
  try {
    j = JSON.parse(raw);
  } catch {
    return [];
  }
  const days = Array.isArray(j?.days) ? j.days.slice(0, 50) : [];
  const out: DayDigest[] = [];
  for (const d of days) {
    const r = DayDigest.safeParse(d);
    if (r.success && !out.some((x) => x.date === r.data.date)) out.push(r.data);
  }
  return out;
}

// Adds (or replaces) one day and keeps the newest `keep` days, oldest first
export function mergeDigest(days: DayDigest[], digest: DayDigest, keep: number): WeekFile {
  const all = [...days.filter((d) => d.date !== digest.date), digest].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  return WeekFile.parse({ version: 1, days: all.slice(-Math.min(8, Math.max(1, keep))) });
}
