import { z } from "zod";

// What the Price watcher returns: one row per Shopping item it looked up. Loose on purpose; code
// checks every number and link (subagents/prices.ts cleanPrices).
export const PriceRead = z.object({
  items: z
    .array(
      z.object({
        id: z.string().max(80),
        price: z.number().nullable(), // the lowest current price found for the same product, new
        store: z.string().max(80).nullable(),
        url: z.string().max(1000).nullable(),
      }),
    )
    .max(12),
});
export type PriceRead = z.infer<typeof PriceRead>;

// jazz2-prices.json (the Action's own file) and the briefing's prices card
export const PriceItem = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  name: z.string().min(1).max(60),
  saved: z.number().positive(), // the price on the Shopping list
  found: z.number().positive().nullable(), // the price found this week (null: not found)
  store: z.string().max(60).nullable(),
  url: z.string().max(500).nullable(), // https only
  drop: z.boolean(), // at least 5% and $2 below the saved price
});
export type PriceItem = z.infer<typeof PriceItem>;
export const PricesCard = z.object({
  checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // the day the prices were checked
  items: z.array(PriceItem).max(8),
});
export type PricesCard = z.infer<typeof PricesCard>;
