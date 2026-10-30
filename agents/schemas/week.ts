import { z } from "zod";
import { PackageStatus } from "./deliveries.ts";

// jazz2-week.json in the Gist: a small digest of each morning's validated Inbox, Deliveries and
// Calendar cards, so Sunday's Weekly Review can see the whole week (jazz2-briefing.json is
// overwritten every morning). Only the orchestrator writes it; nothing here is raw email text,
// just fields the briefing already validated, shortened again. About 1 KB a day, 8 days kept.
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const N = z.number().int().min(0).max(100_000);
const Person = z.object({ from: z.string().max(30), summary: z.string().max(60) });

export const DayDigest = z.object({
  date: IsoDate,
  inbox: z
    .object({
      unread: N,
      urgent: N, // how many urgent emails (their text isn't needed for the week)
      needsReply: z.array(Person).max(5),
      bills: z
        .array(
          z.object({
            payee: z.string().max(30),
            amount: z.number().min(0).max(10_000_000).nullable(),
            status: z.enum(["matches", "differs", "not-in-budget", "no-amount"]),
          }),
        )
        .max(5),
    })
    .optional(),
  deliveries: z
    .object({
      packages: z
        .array(z.object({ item: z.string().max(40), status: PackageStatus, eta: IsoDate.nullable() }))
        .max(5),
    })
    .optional(),
  calendar: z.object({ events: N, overlaps: N, titles: z.array(z.string().max(40)).max(4) }).optional(),
});
export type DayDigest = z.infer<typeof DayDigest>;

export const WeekFile = z.object({ version: z.literal(1), days: z.array(DayDigest).max(8) });
export type WeekFile = z.infer<typeof WeekFile>;
