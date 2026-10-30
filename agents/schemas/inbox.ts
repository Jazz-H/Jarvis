import { z } from "zod";

// One email as code fetched it: headers and Gmail's short snippet only (never the body)
export const MailItem = z.object({
  id: z.string(), // our own short id (m1, m2…), not Gmail's message id
  from: z.string().max(80), // display name only, no address
  subject: z.string().max(200),
  snippet: z.string().max(300),
  date: z.string(), // ISO
  unread: z.boolean(),
});
export type MailItem = z.infer<typeof MailItem>;

// What the Inbox sub-agent returns: judgment over the fetched items
export const InboxRead = z.object({
  urgent: z.array(z.object({ id: z.string(), summary: z.string().min(1).max(140) })).max(3),
  needsReply: z.array(z.object({ id: z.string(), summary: z.string().min(1).max(140) })).max(5),
  bills: z
    .array(
      z.object({
        id: z.string(),
        payee: z.string().min(1).max(60),
        amount: z.number().nonnegative().nullable(),
        due: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
      }),
    )
    .max(5),
});
export type InboxRead = z.infer<typeof InboxRead>;

// A bill email compared with the matching Budget bill (done in code)
export const BillCheck = z.object({
  payee: z.string(),
  amount: z.number().nullable(),
  due: z.string().nullable(),
  budgetName: z.string().nullable(),
  budgetAmount: z.number().nullable(),
  status: z.enum(["matches", "differs", "not-in-budget", "no-amount"]),
});
export type BillCheck = z.infer<typeof BillCheck>;

// The card: counts from code, picks from the model (names come from code, not the model)
export const InboxCard = z.object({
  unread: z.number().int().nonnegative(),
  urgent: z.array(z.object({ from: z.string(), summary: z.string() })).max(3),
  needsReply: z.array(z.object({ from: z.string(), summary: z.string() })).max(5),
  bills: z.array(BillCheck).max(5),
});
export type InboxCard = z.infer<typeof InboxCard>;
