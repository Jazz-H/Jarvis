// One-time bank link for the bank feed (Plaid). Run on your own computer, once per bank login:
//
//   cd agents && npm run plaid-link -- chase              (link a new login, named "chase")
//   cd agents && npm run plaid-link -- --update chase     (re-consent when Jarvis says it's needed)
//
// Needs PLAID_CLIENT_ID and PLAID_SECRET in agents/.env (PLAID_ENV=sandbox to try it with fake
// banks first). It opens Plaid's own hosted page in your browser (so nothing here serves a page or
// sees your bank password), waits for you to finish, and prints the access token in this terminal
// only, never to a file, a log or the network. Add it to the PLAID_ACCESS_TOKENS secret as JSON:
// {"chase":"access-…","citi":"access-…"}. --update reads the existing token from PLAID_ACCESS_TOKENS
// in agents/.env and keeps the same login (it doesn't use up one of the Trial's 10 slots).
import { existsSync } from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { plaidCall, PlaidError, type PlaidCreds } from "./tools/plaid.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
if (existsSync(path.join(here, ".env"))) process.loadEnvFile(path.join(here, ".env"));
const env = process.env;
if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
  console.error("Set PLAID_CLIENT_ID and PLAID_SECRET in agents/.env first (docs/jarvis/SETUP.md → Bank feed).");
  process.exit(1);
}
const creds: PlaidCreds = {
  clientId: env.PLAID_CLIENT_ID,
  secret: env.PLAID_SECRET,
  env: env.PLAID_ENV === "sandbox" ? "sandbox" : "production",
};
const args = process.argv.slice(2);
const update = args[0] === "--update";
const name = (update ? args[1] : args[0]) ?? "";
if (!/^[a-z0-9_-]{1,30}$/i.test(name)) {
  console.error("Give the login a short name: npm run plaid-link -- chase   (or -- --update chase)");
  process.exit(1);
}
let accessToken: string | null = null;
if (update) {
  try {
    accessToken = JSON.parse(env.PLAID_ACCESS_TOKENS ?? "{}")[name] ?? null;
  } catch {
    accessToken = null;
  }
  if (!accessToken) {
    console.error(`--update needs PLAID_ACCESS_TOKENS in agents/.env with a "${name}" entry.`);
    process.exit(1);
  }
}

const open = (url: string) => {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const created = (await plaidCall(
    creds,
    "/link/token/create",
    {
      client_name: "Jazz",
      language: "en",
      country_codes: ["US"],
      user: { client_user_id: "jazz-owner" },
      ...(update
        ? { access_token: accessToken }
        : { products: ["transactions"], transactions: { days_requested: 730 } }),
      hosted_link: { url_lifetime_seconds: 1800 },
    },
    fetch,
  )) as { link_token?: string; hosted_link_url?: string };
  if (!created.link_token || !created.hosted_link_url) throw new Error("Plaid didn't return a Hosted Link URL");
  console.log(
    `\nOpening Plaid in your browser (${creds.env}). If it doesn't open, go to:\n${created.hosted_link_url}\n`,
  );
  open(created.hosted_link_url);
  console.log("Waiting for you to finish (up to 30 minutes)…");
  for (let i = 0; i < 600; i++) {
    await sleep(3000);
    const got = (await plaidCall(creds, "/link/token/get", { link_token: created.link_token }, fetch)) as {
      link_sessions?: {
        finished_at?: string;
        results?: { item_add_results?: { public_token?: string; institution?: { name?: string } }[] };
        on_success?: { public_token?: string };
        exit?: unknown;
      }[];
    };
    const done = (got.link_sessions ?? []).find((s) => s.finished_at);
    if (!done) continue;
    if (update) {
      console.log(`\nDone: "${name}" is reconnected. Nothing to change in PLAID_ACCESS_TOKENS.`);
      return;
    }
    const add = done.results?.item_add_results?.[0];
    const publicToken = add?.public_token ?? done.on_success?.public_token;
    if (!publicToken) {
      console.log("\nThe Plaid window was closed without linking a bank. Run it again when you're ready.");
      process.exitCode = 1;
      return;
    }
    const ex = (await plaidCall(creds, "/item/public_token/exchange", { public_token: publicToken }, fetch)) as {
      access_token?: string;
    };
    if (!ex.access_token) throw new Error("Plaid didn't return an access token");
    console.log(`\nLinked${add?.institution?.name ? ` ${add.institution.name}` : ""} as "${name}".`);
    console.log(
      "Add this to the PLAID_ACCESS_TOKENS secret (JSON, one entry per login), and to agents/.env if you test locally:",
    );
    console.log(`\n  "${name}": "${ex.access_token}"\n`);
    console.log(
      "Keep it private: it reads this bank's accounts and transactions. Never paste it into the app or a chat.",
    );
    return;
  }
  console.log("\nTimed out after 30 minutes. Run it again when you're ready.");
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(
    e instanceof PlaidError ? `Plaid said ${e.code}.` : `Failed: ${e instanceof Error ? e.message : "unknown error"}`,
  );
  process.exitCode = 1;
});
