// The bank feed: Plaid (faked, no network) → jazz2-bank.json, in code.
import { describe, it, expect } from "vitest";
import { buildBankFile } from "../lib/bank.ts";
import { fetchItem, PlaidError, type PlaidCreds } from "../tools/plaid.ts";
import { writeBank, plaidSource } from "../jarvis.ts";
import { BankFile } from "../schemas/bank.ts";
import { Trace } from "../lib/trace.ts";
import { memoryGist } from "./helpers.ts";

const NOW = new Date("2026-11-07T15:00:00Z");
const CREDS: PlaidCreds = { clientId: "cid", secret: "sec-ret", env: "sandbox" };
const acct = (id: string, name: string, mask = "1234") => ({
  account_id: id,
  name,
  mask,
  type: "depository",
  subtype: "checking",
  balances: { current: 1200.5, available: 1100, limit: null },
});
const txn = (id: string, amount: number, over: Record<string, unknown> = {}) => ({
  transaction_id: id,
  account_id: "plaid-acct-1",
  amount,
  date: "2026-11-05",
  name: "KROGER #412 CINCINNATI",
  merchant_name: "Kroger",
  pending: false,
  pending_transaction_id: null,
  personal_finance_category: {
    primary: "FOOD_AND_DRINK",
    detailed: "FOOD_AND_DRINK_GROCERIES",
    confidence_level: "VERY_HIGH",
  },
  ...over,
});

describe("buildBankFile", () => {
  const file = buildBankFile(
    [
      {
        item: "chase",
        accounts: [acct("plaid-acct-1", "Total Checking")],
        transactions: [
          txn("t-kroger", 63.18),
          txn("t-card-pay", 512.4, {
            personal_finance_category: { primary: "LOAN_PAYMENTS", detailed: "", confidence_level: "HIGH" },
          }),
          txn("t-move", 100, {
            personal_finance_category: { primary: "TRANSFER_OUT", detailed: "", confidence_level: "HIGH" },
          }),
          txn("t-pay", -1850, {
            personal_finance_category: { primary: "INCOME", detailed: "", confidence_level: "HIGH" },
          }),
          txn("t-refund", -20),
          txn("t-pend", 6.45, { pending: true, merchant_name: "Starbucks" }),
          txn("t-posted", 6.45, { pending_transaction_id: "t-pend", merchant_name: "Starbucks" }),
          txn("t-new-pend", 4.1, { pending: true, merchant_name: "Dunkin <b>", personal_finance_category: null }),
          txn("t-old", 9, { date: "2026-08-01" }),
        ],
      },
      { item: "citi", error: "ITEM_LOGIN_REQUIRED" },
    ],
    "2026-09-23",
    "2026-11-07",
    NOW,
  );

  it("keeps spending only: card payments, transfers and money in are counted, not listed", () => {
    expect(BankFile.parse(file)).toBeTruthy();
    expect(file.txns.map((t) => t.name).sort()).toEqual(["Dunkin b", "Kroger", "Starbucks"]);
    expect(file.dropped).toEqual({ transfers: 2, incoming: 2 });
  });

  it("a posted charge replaces its pending one; a new pending one is kept, marked", () => {
    const sb = file.txns.filter((t) => t.name === "Starbucks");
    expect(sb).toHaveLength(1);
    expect(sb[0].pending).toBe(false);
    expect(file.txns.find((t) => t.name === "Dunkin b")!.pending).toBe(true);
  });

  it("hashes ids, keeps Plaid's category and confidence, cleans text", () => {
    const k = file.txns.find((t) => t.name === "Kroger")!;
    expect(k.id).toMatch(/^t[0-9a-f]{12}$/);
    expect(JSON.stringify(file)).not.toContain("plaid-acct-1");
    expect(JSON.stringify(file)).not.toContain("t-kroger");
    expect(k).toMatchObject({ amount: 63.18, raw: "KROGER #412 CINCINNATI", pfc: "FOOD_AND_DRINK", confident: true });
    expect(k.acct).toBe(file.accounts[0].id);
    expect(file.accounts[0]).toMatchObject({ item: "chase", name: "Total Checking", mask: "1234", balance: 1200.5 });
  });

  it("a login that failed is listed by its code; old charges outside the window are left out", () => {
    expect(file.errors).toEqual([{ item: "citi", code: "ITEM_LOGIN_REQUIRED" }]);
    expect(file.txns.some((t) => t.date < "2026-09-23")).toBe(false);
  });
});

// A fake Plaid: answers by endpoint, records what was asked
function fakePlaid(handler: (path: string, body: any) => { status?: number; json: unknown }) {
  const calls: { path: string; body: any }[] = [];
  const impl = (async (url: string, init: any) => {
    const u = new URL(url);
    const body = JSON.parse(init.body);
    calls.push({ path: u.pathname, body });
    const r = handler(u.pathname, body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("fetchItem", () => {
  it("pages through every transaction, with the keys in the body and sandbox's host", async () => {
    const all = Array.from({ length: 700 }, (_, i) => txn("t" + i, 1 + i));
    const p = fakePlaid((_path, body) => ({
      json: {
        accounts: [acct("plaid-acct-1", "Checking")],
        transactions: all.slice(body.options.offset, body.options.offset + body.options.count),
        total_transactions: all.length,
      },
    }));
    const r = await fetchItem(CREDS, "access-sandbox-abc12345", "2026-09-23", "2026-11-07", p.impl);
    expect(r.transactions).toHaveLength(700);
    expect(p.calls).toHaveLength(2);
    expect(p.calls[0].body).toMatchObject({
      client_id: "cid",
      secret: "sec-ret",
      access_token: "access-sandbox-abc12345",
    });
  });

  it("an error is only Plaid's code, never its message", async () => {
    const p = fakePlaid(() => ({
      status: 400,
      json: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "account 1234 for Jane needs login" },
    }));
    const e = await fetchItem(CREDS, "access-sandbox-abc12345", "a", "b", p.impl).catch((x) => x);
    expect(e).toBeInstanceOf(PlaidError);
    expect(e.code).toBe("ITEM_LOGIN_REQUIRED");
    expect(e.message).not.toContain("Jane");
  });
});

describe("writeBank", () => {
  const source = { creds: CREDS, items: { chase: "access-sandbox-chase0001", citi: "access-sandbox-citi00001" } };
  const plaid = (failCiti: boolean) =>
    fakePlaid((_path, body) =>
      failCiti && body.access_token === source.items.citi
        ? { status: 400, json: { error_code: "ITEM_LOGIN_REQUIRED" } }
        : {
            json: {
              accounts: [acct("plaid-acct-1", "Checking")],
              transactions: [txn("t1", 63.18)],
              total_transactions: 1,
            },
          },
    );

  it("writes the file once, and not again when nothing changed; the trace has counts only", async () => {
    const g = memoryGist();
    const trace = new Trace();
    expect(await writeBank(g.gist, source, NOW, plaid(false).impl, trace)).toBe("written");
    const file = BankFile.parse(JSON.parse(g.files["jazz2-bank.json"]));
    expect(file.from).toBe("2026-09-23");
    expect(file.txns).toHaveLength(2);
    const later = new Date(NOW.getTime() + 3600e3);
    expect(await writeBank(g.gist, source, later, plaid(false).impl, trace)).toBe("unchanged");
    const logged = JSON.stringify(trace.events);
    for (const secret of ["Kroger", "63.18", "Checking", "access-sandbox", "sec-ret", "chase"])
      expect(logged).not.toContain(secret);
  });

  it("one login failing still writes the rest, with its error; all failing keeps the old file", async () => {
    const g = memoryGist();
    await writeBank(g.gist, source, NOW, plaid(true).impl, new Trace());
    const file = BankFile.parse(JSON.parse(g.files["jazz2-bank.json"]));
    expect(file.errors).toEqual([{ item: "citi", code: "ITEM_LOGIN_REQUIRED" }]);
    expect(file.txns).toHaveLength(1);
    const before = g.files["jazz2-bank.json"];
    const down = fakePlaid(() => ({ status: 500, json: {} }));
    expect(await writeBank(g.gist, source, NOW, down.impl, new Trace())).toBe("failed");
    expect(g.files["jazz2-bank.json"]).toBe(before);
  });
});

describe("plaidSource", () => {
  it("needs all three secrets, keeps well-formed logins only, and defaults to production", () => {
    expect(plaidSource({ PLAID_CLIENT_ID: "c", PLAID_SECRET: "s" })).toBeNull();
    const s = plaidSource({
      PLAID_CLIENT_ID: "c",
      PLAID_SECRET: "s",
      PLAID_ACCESS_TOKENS: JSON.stringify({
        chase: "access-production-abcdef12",
        "bad name": "access-x-1",
        citi: "nope",
      }),
    })!;
    expect(Object.keys(s.items)).toEqual(["chase"]);
    expect(s.creds.env).toBe("production");
    expect(() => plaidSource({ PLAID_CLIENT_ID: "c", PLAID_SECRET: "s", PLAID_ACCESS_TOKENS: "{oops" })).toThrow(
      /isn't JSON/,
    );
  });
});
