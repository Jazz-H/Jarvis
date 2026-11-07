import { z } from "zod";

// jazz2-bank.json: what the bank feed (Plaid) saw, written only by the Jarvis Action (jarvis.ts
// writeBank) and read by the app's Budget ("From your bank"). Ids are hashes, never Plaid's ids or
// full account numbers. Spending only: money coming in, card payments and transfers between your
// own accounts are left out here (counted in `dropped`).
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const BankAccount = z.object({
  id: z.string().regex(/^a[0-9a-f]{12}$/),
  item: z.string().max(30), // the name you gave the login in PLAID_ACCESS_TOKENS ("chase")
  name: z.string().max(60),
  mask: z.string().max(4), // last 4, or ""
  type: z.string().max(20),
  subtype: z.string().max(30),
  balance: z.number().nullable(),
  available: z.number().nullable(),
  limit: z.number().nullable(),
});
export type BankAccount = z.infer<typeof BankAccount>;
export const BankTxn = z.object({
  id: z.string().regex(/^t[0-9a-f]{12}$/),
  acct: z.string().regex(/^a[0-9a-f]{12}$/),
  date: isoDate,
  amount: z.number().positive(),
  name: z.string().max(60), // the merchant, cleaned (or the raw description when Plaid has none)
  raw: z.string().max(80), // the statement description, for your rules to match
  pfc: z.string().max(40), // Plaid's category: primary ("FOOD_AND_DRINK")
  pfcDetailed: z.string().max(60), // and detailed ("FOOD_AND_DRINK_GROCERIES")
  confident: z.boolean(), // Plaid says HIGH or VERY_HIGH
  pending: z.boolean(),
});
export type BankTxn = z.infer<typeof BankTxn>;
export const BankFile = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  from: isoDate,
  to: isoDate,
  accounts: z.array(BankAccount).max(40),
  txns: z.array(BankTxn).max(1000),
  errors: z.array(z.object({ item: z.string().max(30), code: z.string().max(60) })).max(20),
  dropped: z.object({ transfers: z.number().int().min(0), incoming: z.number().int().min(0) }),
});
export type BankFile = z.infer<typeof BankFile>;
