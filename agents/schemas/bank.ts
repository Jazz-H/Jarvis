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
  // a credit card's statement details (Plaid Liabilities), when the login allows them
  card: z
    .object({
      statement: z.number().nullable(), // last statement balance
      statementDate: isoDate.nullable(),
      minDue: z.number().nullable(),
      dueDate: isoDate.nullable(), // next payment due
      lastPaid: z.number().nullable(),
      lastPaidDate: isoDate.nullable(),
      overdue: z.boolean(),
      apr: z.number().nullable(), // purchase APR, %
    })
    .optional(),
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
// Money into a bank account (paychecks and the like; card refunds and transfers are left out), so
// Budget can fill in a payday's real amount
export const BankDeposit = z.object({
  id: z.string().regex(/^d[0-9a-f]{12}$/),
  acct: z.string().regex(/^a[0-9a-f]{12}$/),
  date: isoDate,
  amount: z.number().positive(),
  name: z.string().max(60),
  raw: z.string().max(80),
  pfcDetailed: z.string().max(60),
});
export type BankDeposit = z.infer<typeof BankDeposit>;
export const BankFile = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  from: isoDate,
  to: isoDate,
  accounts: z.array(BankAccount).max(40),
  txns: z.array(BankTxn).max(1000),
  errors: z.array(z.object({ item: z.string().max(30), code: z.string().max(60) })).max(20),
  // logins with credit cards whose statement details need consent (npm run plaid-link -- --update <item>)
  cardsNeed: z.array(z.string().max(30)).max(20).optional(),
  deposits: z.array(BankDeposit).max(200).optional(),
  dropped: z.object({ transfers: z.number().int().min(0), incoming: z.number().int().min(0) }),
});
export type BankFile = z.infer<typeof BankFile>;
