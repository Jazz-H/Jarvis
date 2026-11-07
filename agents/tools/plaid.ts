// Plaid: plain fetch, no SDK. Reads accounts and the last N days of transactions for one Item
// (one login at one bank). Nothing here logs: callers get counts and Plaid's error code only, never
// a response body (Plaid's errors can echo request data, and this repo's logs are public).
import { z } from "zod";

export type PlaidEnv = "sandbox" | "production";
export interface PlaidCreds {
  clientId: string;
  secret: string;
  env: PlaidEnv;
}
export const plaidBase = (env: PlaidEnv) =>
  env === "sandbox" ? "https://sandbox.plaid.com" : "https://production.plaid.com";

// A failed call: just Plaid's error code ("ITEM_LOGIN_REQUIRED", "PRODUCT_NOT_READY", …) or the HTTP status
export class PlaidError extends Error {
  constructor(public code: string) {
    super(`Plaid ${code}`);
  }
}
const CODE = /^[A-Z0-9_]{1,60}$/;

export async function plaidCall(
  creds: PlaidCreds,
  endpoint: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const res = await fetchImpl(plaidBase(creds.env) + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: creds.clientId, secret: creds.secret, ...body }),
  });
  let j: any = null;
  try {
    j = await res.json();
  } catch {
    j = null;
  }
  if (!res.ok) {
    const code = typeof j?.error_code === "string" && CODE.test(j.error_code) ? j.error_code : `HTTP_${res.status}`;
    throw new PlaidError(code);
  }
  return j;
}

const Balances = z.object({
  current: z.number().nullable().optional(),
  available: z.number().nullable().optional(),
  limit: z.number().nullable().optional(),
});
export const PlaidAccount = z.object({
  account_id: z.string(),
  name: z.string().optional().default(""),
  official_name: z.string().nullable().optional(),
  mask: z.string().nullable().optional(),
  type: z.string().optional().default(""),
  subtype: z.string().nullable().optional(),
  balances: Balances.optional().default({}),
});
export type PlaidAccount = z.infer<typeof PlaidAccount>;
export const PlaidTxn = z.object({
  transaction_id: z.string(),
  account_id: z.string(),
  amount: z.number(), // positive: money left the account
  date: z.string(),
  authorized_date: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  merchant_name: z.string().nullable().optional(),
  pending: z.boolean().optional().default(false),
  pending_transaction_id: z.string().nullable().optional(),
  personal_finance_category: z
    .object({
      primary: z.string().optional().default(""),
      detailed: z.string().optional().default(""),
      confidence_level: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type PlaidTxn = z.infer<typeof PlaidTxn>;
const TxnPage = z.object({
  accounts: z.array(PlaidAccount),
  transactions: z.array(PlaidTxn),
  total_transactions: z.number(),
});

// One Item's accounts and transactions from start to end (YYYY-MM-DD), every page (at most 4 × 500)
export async function fetchItem(
  creds: PlaidCreds,
  accessToken: string,
  start: string,
  end: string,
  fetchImpl: typeof fetch,
): Promise<{ accounts: PlaidAccount[]; transactions: PlaidTxn[] }> {
  const transactions: PlaidTxn[] = [];
  let accounts: PlaidAccount[] = [];
  for (let page = 0; page < 4; page++) {
    const raw = await plaidCall(
      creds,
      "/transactions/get",
      {
        access_token: accessToken,
        start_date: start,
        end_date: end,
        options: { count: 500, offset: transactions.length },
      },
      fetchImpl,
    );
    const p = TxnPage.safeParse(raw);
    if (!p.success) throw new PlaidError("BAD_RESPONSE");
    accounts = p.data.accounts;
    transactions.push(...p.data.transactions);
    if (transactions.length >= p.data.total_transactions || !p.data.transactions.length) break;
  }
  return { accounts, transactions };
}
