import { z } from "zod";

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Usd = z.number().finite();

// The pay period around today, with the same math as the app's Safe to spend
// (js/dashboard.js dashPayPeriod): the last paycheck, the next payday, and the bills between.
export const PayPeriod = z.object({
  start: IsoDate, // last payday (on or before today)
  end: IsoDate, // next payday (after today)
  pay: Usd, // what came in on the last payday
  paid: Usd, // bills in the period already paid
  due: Usd, // bills in the period still to pay
  left: Usd, // pay − paid − due: safe to spend until payday
});
export type PayPeriod = z.infer<typeof PayPeriod>;

// Bill Guard: bills that need a person, all found by code from Budget (and the Inbox card's checks)
//   overdue      unpaid and past its due date
//   manual       due within 3 days and not on autopay
//   short        the bills due before payday come to more than the paycheck
//   differs      a bill email's amount differs from Budget
//   not-in-budget a bill email with no matching Budget bill
//   card         a credit card due within 3 days whose payment isn't in a paycheck plan
//                (amount: the statement, null until it's typed in)
export const GuardItem = z.object({
  reason: z.enum(["overdue", "manual", "short", "differs", "not-in-budget", "card"]),
  name: z.string().min(1).max(60),
  amount: Usd.nullable(),
  due: IsoDate.nullable(),
  budgetAmount: Usd.nullable(), // differs: what Budget says
});
export type GuardItem = z.infer<typeof GuardItem>;

// Budget's debts in the owner's payoff order (js/budget-debts.js debtPayoff, worked out in code)
export const DebtStatus = z.object({
  name: z.string().min(1).max(60),
  balance: Usd,
  apr: z.number().min(0).max(99),
  payment: Usd, // monthly
  paidOff: z.string().regex(/^\d{4}-\d{2}$/).nullable(), // YYYY-MM; null when paid off, no payment, or it doesn't cover interest
  coversInterest: z.boolean(),
  next: z.boolean(), // the first one not paid off: where extra money goes after the goals
});
export type DebtStatus = z.infer<typeof DebtStatus>;

// Credit cards, paid in full: the next due date and that month's statement
export const CardStatus = z.object({
  name: z.string().min(1).max(40),
  due: IsoDate,
  statement: Usd.nullable(), // null until it's typed in
  planned: z.boolean(), // a paycheck plan that month has "<card> payment"
});
export type CardStatus = z.infer<typeof CardStatus>;

export const MoneyCard = z.object({
  period: PayPeriod.nullable(),
  guard: z.array(GuardItem).max(8),
  overspent: z.array(z.object({ name: z.string().min(1).max(40), spent: Usd, limit: Usd })).max(5), // this month
  debts: z.array(DebtStatus).max(10).default([]),
  cards: z.array(CardStatus).max(6).default([]),
});
export type MoneyCard = z.infer<typeof MoneyCard>;
