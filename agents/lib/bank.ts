// The bank feed in code (no model): Plaid's accounts and transactions for each linked login become
// jazz2-bank.json. Ids are hashed; card payments, transfers between your own accounts and money
// coming in are left out (counted); a pending charge gives way to its posted version. Rules,
// categories and bill matching happen in the app, against your own Budget (js/bank.js).
import { createHash } from "node:crypto";
import { BankFile, type BankAccount, type BankDeposit, type BankTxn } from "../schemas/bank.ts";
import type { PlaidAccount, PlaidCredit, PlaidTxn } from "../tools/plaid.ts";

export interface ItemResult {
  item: string; // the login's name in PLAID_ACCESS_TOKENS
  accounts?: PlaidAccount[];
  transactions?: PlaidTxn[];
  error?: string; // Plaid's error code
  credit?: PlaidCredit[]; // card statement details (Liabilities), when the login allows them
  cardsNeed?: boolean; // it has credit cards but hasn't allowed statement details yet
}

const hash = (prefix: "a" | "t" | "d", s: string) => prefix + createHash("sha256").update(s).digest("hex").slice(0, 12);
// One line of plain text: no control characters, collapsed spaces, capped
const clean = (s: unknown, n: number) =>
  [...String(s ?? "")]
    .map((c) => {
      const k = c.charCodeAt(0);
      // control characters, the two Unicode line breaks and angle brackets become spaces
      return k < 32 || (k >= 127 && k < 160) || k === 8232 || k === 8233 || c === "<" || c === ">" ? " " : c;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.round(v * 100) / 100 : null);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
// A card's statement details, or undefined when Plaid gave none for it
function cardOf(c: PlaidCredit | undefined): BankAccount["card"] {
  if (!c) return undefined;
  const purchase = (c.aprs ?? []).find((a) => a.apr_type === "purchase_apr") ?? (c.aprs ?? [])[0];
  return {
    statement: num(c.last_statement_balance),
    statementDate: day(c.last_statement_issue_date),
    minDue: num(c.minimum_payment_amount),
    dueDate: day(c.next_payment_due_date),
    lastPaid: num(c.last_payment_amount),
    lastPaidDate: day(c.last_payment_date),
    overdue: c.is_overdue === true,
    apr: num(purchase?.apr_percentage),
  };
}

// Plaid's categories for money moving between your own accounts, paying a card or a loan
const TRANSFER = new Set(["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"]);
const INCOME = new Set(["INCOME"]);

export function buildBankFile(results: ItemResult[], from: string, to: string, now: Date): BankFile {
  const accounts: BankAccount[] = [];
  const txns: BankTxn[] = [];
  const errors: { item: string; code: string }[] = [];
  const cardsNeed: string[] = [];
  const deposits: BankDeposit[] = [];
  let transfers = 0,
    incoming = 0;
  for (const r of results) {
    const item = clean(r.item, 30);
    if (r.error) {
      errors.push({ item, code: clean(r.error, 60) });
      continue;
    }
    const acctId = (plaidId: string) => hash("a", `${item}|${plaidId}`);
    if (r.cardsNeed) cardsNeed.push(item);
    for (const a of r.accounts ?? []) {
      const card =
        a.type === "credit" ? cardOf((r.credit ?? []).find((c) => c.account_id === a.account_id)) : undefined;
      accounts.push({
        id: acctId(a.account_id),
        item,
        name: clean(a.name || a.official_name, 60) || "Account",
        mask: /^\d{2,4}$/.test(String(a.mask ?? "")) ? String(a.mask) : "",
        type: clean(a.type, 20),
        subtype: clean(a.subtype, 30),
        balance: num(a.balances?.current),
        available: num(a.balances?.available),
        limit: num(a.balances?.limit),
        ...(card ? { card } : {}),
      });
    }
    const list = r.transactions ?? [];
    const types = new Map((r.accounts ?? []).map((a) => [a.account_id, a.type]));
    // a posted charge names the pending one it replaces; that pending one goes
    const replaced = new Set(list.map((t) => t.pending_transaction_id).filter(Boolean) as string[]);
    for (const t of list) {
      if (t.pending && replaced.has(t.transaction_id)) continue;
      const pfc = t.personal_finance_category;
      const primary = clean(pfc?.primary, 40);
      if (TRANSFER.has(primary)) {
        transfers++;
        continue;
      }
      if (t.amount <= 0 || INCOME.has(primary)) {
        incoming++;
        // money into a bank account (not a card's refund): kept so Budget can fill in paydays
        const intoBank = types.get(t.account_id) !== "credit";
        if (
          t.amount < 0 &&
          intoBank &&
          !t.pending &&
          /^\d{4}-\d{2}-\d{2}$/.test(t.date) &&
          t.date >= from &&
          t.date <= to
        )
          deposits.push({
            id: hash("d", `${item}|${t.transaction_id}`),
            acct: acctId(t.account_id),
            date: t.date,
            amount: Math.round(-t.amount * 100) / 100,
            name: clean(t.merchant_name, 60) || clean(t.name, 60) || "Deposit",
            raw: clean(t.name, 80),
            pfcDetailed: clean(pfc?.detailed, 60),
          });
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date) || t.date < from || t.date > to) continue;
      const raw = clean(t.name, 80);
      txns.push({
        id: hash("t", `${item}|${t.transaction_id}`),
        acct: acctId(t.account_id),
        date: t.date,
        amount: Math.round(t.amount * 100) / 100,
        name: clean(t.merchant_name, 60) || clean(raw, 60) || "Charge",
        raw,
        pfc: primary,
        pfcDetailed: clean(pfc?.detailed, 60),
        confident: pfc?.confidence_level === "HIGH" || pfc?.confidence_level === "VERY_HIGH",
        pending: !!t.pending,
      });
    }
  }
  txns.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1));
  return BankFile.parse({
    version: 1,
    generatedAt: now.toISOString(),
    from,
    to,
    accounts: accounts.slice(0, 40),
    txns: txns.slice(0, 1000),
    errors: errors.slice(0, 20),
    ...(cardsNeed.length ? { cardsNeed: cardsNeed.slice(0, 20) } : {}),
    deposits: deposits.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 200),
    dropped: { transfers, incoming },
  });
}
