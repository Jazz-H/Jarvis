// The bank feed in code (no model): Plaid's accounts and transactions for each linked login become
// jazz2-bank.json. Ids are hashed; card payments, transfers between your own accounts and money
// coming in are left out (counted); a pending charge gives way to its posted version. Rules,
// categories and bill matching happen in the app, against your own Budget (js/bank.js).
import { createHash } from "node:crypto";
import { BankFile, type BankAccount, type BankTxn } from "../schemas/bank.ts";
import type { PlaidAccount, PlaidTxn } from "../tools/plaid.ts";

export interface ItemResult {
  item: string; // the login's name in PLAID_ACCESS_TOKENS
  accounts?: PlaidAccount[];
  transactions?: PlaidTxn[];
  error?: string; // Plaid's error code
}

const hash = (prefix: "a" | "t", s: string) => prefix + createHash("sha256").update(s).digest("hex").slice(0, 12);
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

// Plaid's categories for money moving between your own accounts, paying a card or a loan
const TRANSFER = new Set(["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"]);
const INCOME = new Set(["INCOME"]);

export function buildBankFile(results: ItemResult[], from: string, to: string, now: Date): BankFile {
  const accounts: BankAccount[] = [];
  const txns: BankTxn[] = [];
  const errors: { item: string; code: string }[] = [];
  let transfers = 0,
    incoming = 0;
  for (const r of results) {
    const item = clean(r.item, 30);
    if (r.error) {
      errors.push({ item, code: clean(r.error, 60) });
      continue;
    }
    const acctId = (plaidId: string) => hash("a", `${item}|${plaidId}`);
    for (const a of r.accounts ?? [])
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
      });
    const list = r.transactions ?? [];
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
    dropped: { transfers, incoming },
  });
}
