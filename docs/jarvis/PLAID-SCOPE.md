# Bank link scope: Plaid (and the alternatives)

Status: **built Nov 7** (sections 10 and SETUP.md section 10): Plaid Trial, rules that add by themselves.
Scoped Oct 31. Not built yet: balances in Bill Guard, Liabilities, the categorizer. This reopens the Oct 31 "Budget only"
decision in `PLAN.md`; that decision stands until you pick an option in section 9.
Prices were read on Oct 31, 2026 from the sources linked inline. **Estimate** means the price
isn't published and the number is our best-sourced guess.

Assumed accounts (say if this is wrong): **2–4 institutions**: one bank for checking and
savings, plus 1–3 credit card issuers. Plaid bills per **Item** (one login at one
institution), so checking and savings at the same bank are **one Item**. 2–4 institutions = 2–4 Items.

## 1. Bottom line

1. **Cost: $0 a month on Plaid's new free Trial plan** (10 Items lifetime, includes Transactions and Balance, no business needed). After that, an estimated **$0.60–$2.40 a month** for 2–4 Items. **One-time cost: $0.** The Haiku model adds pennies.
2. **A solo developer can get access.** Since Apr 16, 2026 Plaid has a "Personal use" signup with a Trial plan: no business registration, no security questionnaire, no contract, and all OAuth banks (Chase etc.) since May 20, 2026. Full paid Production is a separate application that's harder for a personal project.
3. **Main Plaid risk:** the 10-Item cap counts every Item you ever create (removing one doesn't free its slot). Re-linking the wrong way wastes slots. Plaid could also change the Trial terms.
4. **Cheapest flat-price backup: SimpleFIN Bridge at $15/year.** It's simpler to wire up (one secret, no Link page), but data updates once a day, you get 90 days of history, and there are no categories.
5. **Recommendation:** use the **Plaid Trial** for the feed (SimpleFIN if Plaid's coverage or Trial lets us down). Build the bank feed **only together with** the spreadsheet gaps in section 7, and fix the morning cron first. Real transactions in a Budget that still can't do what your sheet does won't get you off Excel.

## 2. Plaid pricing today

### Plans (from [plaid.com/pricing](https://plaid.com/pricing/) and [Plaid billing docs](https://plaid.com/docs/account/billing/), read Oct 31, 2026)
| Plan | Who | Terms |
|---|---|---|
| **Sandbox** | everyone | free forever, fake data only |
| **Trial** (replaced Limited Production on Apr 15, 2026) | new US/Canada teams; "Personal use" signup | free, **10 Production Items lifetime**; `/item/remove` does not free a slot; no expiry stated. Bundle: Assets, Auth, Balance, Identity, Investments, **Liabilities, Transactions** (with Refresh), Statements (an older help-center article lists only Auth, Transactions, Balance and Identity; check the Dashboard). **Recurring Transactions is not in the bundle** |
| **Pay as you go** | "hobbyist use or early-stage small businesses" | no minimum, no commitment, card on file, list prices (not public) |
| **Growth** | small teams | minimum spend, annual commitment, lower rates |
| **Custom** | large companies | negotiated, volume |

Sources for the Trial: the [Apr 16 and May 20, 2026 changelog entries](https://plaid.com/docs/changelog/) ("free access to Production for up to 10 Items", a "streamlined approval questionnaire that is more user-friendly for non-business users", "immediate access to all OAuth institutions"), and the [billing docs](https://plaid.com/docs/account/billing/) for the bundle and the cap. The ["Personal use" signup option](https://support.plaid.com/hc/en-us/articles/16110110883479-How-are-Sandbox-Production-Trial-plan-and-Limited-Production-different) comes from Plaid's help center, seen through search results (the page itself returned 403 to our fetch).

### How each product we'd use is billed ([billing docs](https://plaid.com/docs/account/billing/))
| Product | Need it? | Billing model | Pay-as-you-go price |
|---|---|---|---|
| **Transactions** | **yes**: the feed itself | monthly subscription **per Item**, whole month, no proration, for as long as the access token is valid | not public. **Estimate $0.30/Item/month** (range $0.30–$0.60). Sources: a Plaid support reply quoted on the [Frappe forum](https://discuss.frappe.io/t/plaid-use-canadian-banks/110896) (Oct 2023, "$0.30 per month"); [Vendr](https://www.vendr.com/marketplace/plaid) $0.30–$0.60 (updated Feb 2026); Teller's published price for the same product is also $0.30 |
| Accounts (`/accounts/get`) | yes: names, masks, cached balances | **free** endpoint | $0 |
| **Balance** (`/accounts/balance/get`, live) | no: cached balances are enough | per successful call | not public. **Estimate $0.10/call** (range $0.05–$0.25, [Vendr](https://www.vendr.com/marketplace/plaid)). Daily calls would cost ~$3/Item/month, more than Transactions, so we skip it |
| Transactions Refresh | no | per call | not public; skip (the daily feed is enough) |
| **Liabilities** | maybe: card statement balance, minimum payment, due date, APR | monthly subscription per Item | not public. **Estimate $0.20–$0.60/Item/month** (low confidence; nothing published) |
| Recurring Transactions | no: Bill Guard already knows your bills | monthly subscription per Item | not public; **not in the Trial** |
| Auth, Identity | no: we don't move money or verify identity | one-time / per call | n/a |

Not public anywhere: Plaid shows pay-as-you-go prices only on the last page of the Production
access request in the Dashboard. That page is the way to get real numbers (it's free to look and
you can stop before submitting). Some third-party pages say $29/month or $500/month; those are
business minimums or wrong, and pay-as-you-go has no minimum.

### Cost table (Transactions only, cached balances, no Balance calls)
| Items | Trial | Pay as you go, per month (estimate) | Pay as you go, per year (estimate) | + Liabilities on card Items (estimate, per month) |
|---|---|---|---|---|
| 2 | $0 | $0.60 (range $0.60–$1.20) | $7.20 ($7.20–$14.40) | +$0.20–$0.60 (1 card) |
| 3 | $0 | $0.90 ($0.90–$1.80) | $10.80 ($10.80–$21.60) | +$0.40–$1.20 (2 cards) |
| 4 | $0 | $1.20 ($1.20–$2.40) | $14.40 ($14.40–$28.80) | +$0.60–$1.80 (3 cards) |

Math: Items × $0.30 (low) or × $0.60 (high) a month, × 12 for the year. Worst case with
Liabilities on three cards: $2.40 + $1.80 = **$4.20/month (~$50/year)**. Other running costs:
GitHub Actions minutes are free on a public repo. Haiku categorizing is **estimated** at under $0.01
a run (only ambiguous merchants, see 5.6), so a few cents a month on top of the existing Anthropic
spend, under `MAX_RUN_COST_USD`. Nothing here touches the $20/month Ask budget.

## 3. Access and eligibility

**Trial (what we'd use):**
- Sign up at dashboard.plaid.com/signup, choose **Personal use**, verify email, start the Trial.
  No business registration, security questionnaire or contract
  ([help center via search](https://support.plaid.com/hc/en-us/articles/16110110883479-How-are-Sandbox-Production-Trial-plan-and-Limited-Production-different); [changelog Apr 16, 2026](https://plaid.com/docs/changelog/)).
- **OAuth banks:** since May 20, 2026, Trial teams get "immediate access to all OAuth
  institutions" ([changelog](https://plaid.com/docs/changelog/)). Plaid's OAuth guide says Chase's
  Security Questionnaire and PNC's MSA are waived on the Trial ([OAuth guide](https://plaid.com/docs/link/oauth/)).
- **Time:** minutes to an hour. Risk of being declined: **low**.
- **Catches:** the 10-Item lifetime cap. You can't go back to the Trial once you apply for
  Production. US/Canada institutions only.

**Full Production (only needed past 10 Items or for products outside the bundle):**
- An application with company details and the use case, reviewed in "a couple of business days";
  then the security questionnaire unlocks; then OAuth registration in the Dashboard's compliance
  center. Most OAuth banks turn on within hours; **Schwab up to 5 business days**; Fidelity longer
  ([OAuth guide](https://plaid.com/docs/link/oauth/); [changelog Sep 11, 2026](https://plaid.com/docs/changelog/)).
- **Risk for a personal project: medium.** Pay as you go is described as fit for "hobbyist use", but
  the questionnaire asks about security policies a one-person app doesn't have written down.
  Older personal-use guides describe this as slow. **Estimate:** 1–3 weeks, with a real chance of
  follow-up questions.

**OAuth banks** (you sign in on the bank's own page, not Plaid's): Chase, Bank of America,
Wells Fargo, Capital One, Citi, U.S. Bank, PNC, American Express, Charles Schwab and others
([OAuth guide](https://plaid.com/docs/link/oauth/)). For a typical US city, the likely ones (Bank of
America, Wells Fargo, Truist, Chase, Capital One, Amex) are mostly OAuth. Because of this, Link
must run in a real browser once per bank. That's fine (see 5.1).

**Consent / re-auth:** most US banks need re-consent every **12 months**. Chase lets you pick 6
months, 1 year or "always". USAA is 18 months. Plaid sends `PENDING_DISCONNECT` about a week ahead;
re-auth is done in **update mode**, which keeps the same Item and **doesn't use a Trial slot**
([OAuth guide](https://plaid.com/docs/link/oauth/)). Bank of America's API migration ended Oct 15, 2026; older BofA Items now need update mode.

## 4. Alternatives

| Option | Price (read Oct 31, 2026) | Coverage | Fit for no server | Notes |
|---|---|---|---|---|
| **Plaid Trial → pay as you go** | $0 for 10 Items, then ~$0.30–$0.60/Item/mo (estimate) | best US coverage, OAuth banks, good categories (`personal_finance_category`), up to 730 days of history | local one-time Link script; access tokens in GitHub secrets | recommended |
| **SimpleFIN Bridge** | **$1.50/mo or $15/yr**, up to 25 institutions and 25 apps ([bridge](https://beta-bridge.simplefin.org/)) | runs on MX; check your banks in its live search | **easiest**: you link banks on their site, paste a one-time setup token, our script claims it once for an Access URL (one secret). No Link page | updates **about once a day**, **90 days** max per sync ([Actual Budget docs](https://actualbudget.org/docs/advanced/bank-sync/simplefin/)); no categories; pending only on request ([protocol](https://www.simplefin.org/protocol.html)) |
| **Teller** | Developer tier **free, 100 live connections**; then Transactions $0.30/enrollment/mo, Balance $0.10/call ([teller.io](https://teller.io/)) | ~7,000 institutions; the big US banks, thinner on small credit unions | needs a **client certificate (mTLS)** on every call ([auth docs](https://teller.io/docs/api/authentication)): the cert and key become two more secrets; Teller Connect runs once in a local page | good, cheap; no category model; individual signup not stated |
| **Tiller** | **$99/yr** since Aug 1, 2026 ([Tiller community](https://community.tiller.com/t/update-to-tillers-annual-price-starting-in-august-2026/34853)) | Plaid/Yodlee feeds, 21,000+ banks | feeds straight into **Excel** or Google Sheets; nothing for us to build | best if you'd rather keep the spreadsheet and drop the phone budget; users say the Excel version has fewer features than Sheets |
| Monarch / Copilot / YNAB | ~$99.99/yr / ~$95/yr (Apple only) / ~$109/yr ([getfinny](https://getfinny.app/blog/monarch-money-pricing-2026), [costbench](https://costbench.com/software/personal-finance/ynab)), third-party figures | good | CSV export only, by hand; no API for us | replaces Jazz Budget instead of feeding it; 4–7× the cost of the options above |
| **Bank CSV/OFX export → new statement import** | $0 | every bank | entirely in the app (`js/budget-import.js` pattern) | not automatic: ~5 min a month per account, by hand. Today's import does **bills, paychecks and plans only**, not transactions, so this is new work too |
| MX, Finicity (Mastercard), Akoya | sales-led, business minimums (Vendr cites $1,000+/month minimums for aggregators at small scale) | good | no | not available to an individual in practice |
| GoCardless Bank Account Data | new signups reported closed since mid-2025 ([dev.to](https://dev.to/johnfrandsen/gocardless-bank-account-data-alternatives-what-to-use-when-signups-are-disabled-326d)); EU/UK banks, very few US | poor for US | n/a | not an option |

**Ranked for you:**
1. **Plaid Trial.** Free, best coverage and categories, and the Trial now targets personal use.
2. **SimpleFIN Bridge.** Flat $15/yr, the least code and the fewest secrets. Use it if Plaid misses one of your banks or the Trial changes.
3. **Teller.** Free too, but mTLS adds secrets and setup, and individual eligibility is unclear.
4. **CSV/OFX statement import.** Worth building anyway as the fallback when a feed breaks.
5. **Tiller.** Only if the answer is "keep Excel".
6. Monarch / Copilot / YNAB. Each replaces Jazz instead of feeding it.

## 5. Architecture that fits what exists

### 5.1 Linking a bank (once per bank, on your computer, like `npm run google-auth`)
- **Plaid:** `npm run plaid-link` (new, `agents/plaid-link.ts`) reads `PLAID_CLIENT_ID` and
  `PLAID_SECRET` from `agents/.env`, creates a link token for `transactions` with
  `days_requested: 730`, and opens **Plaid Hosted Link** (a Plaid-hosted page, so we don't need our
  own HTTPS page or redirect URI; Plaid requires HTTPS redirect URIs outside Sandbox, see the
  [OAuth guide](https://plaid.com/docs/link/oauth/)). It waits for the public token, exchanges it,
  and **prints the access token in the terminal only**. The same script with `--update <name>` runs
  update mode for re-consent, keeping the Item and the slot.
- You add the token to the secret `PLAID_ACCESS_TOKENS` as JSON, e.g. `{"bank":"access-…","card":"access-…"}`.
- **SimpleFIN:** `npm run simplefin-claim <setup token>` posts it once and prints the Access URL
  for the secret `SIMPLEFIN_ACCESS_URL`. Nothing else.
- Link never runs in the PWA. The app never holds a Plaid key or token.

### 5.2 Daily sync in the morning Action
- New plain-code tool `agents/tools/plaid.ts` (or `simplefin.ts`): `/accounts/get` (free, cached
  balances) and `/transactions/get` for the last **30 days** per Item, deduped by `transaction_id`.
  The call is stateless, so no sync cursor has to be stored anywhere. History: 730 days on the first
  run, which also backfills.
- It runs inside `jarvis.ts` before Bill Guard. A failed Item (`ITEM_LOGIN_REQUIRED`,
  `PENDING_DISCONNECT`) becomes a "Reconnect <bank>" line in the Money card and a push, and the
  rest of the briefing still ships.
- **Fix the cron first.** The feed rides on the morning run, which isn't firing reliably. Worth
  adding a second chance (the hourly `jarvis-ask.yml` cron could top up a missed day).

### 5.3 Where the data lands
- A new Action-only gist file, **`jazz2-bank.json`**: `{version: 1, generatedAt, accounts: [{id,
  name, mask (last 4), type, subtype, balance, available, limit?, asOf}], txns: [{id, acct, date,
  authorized?, amount, name ≤80, merchant ≤60, pfc, pfcConfidence, pending, pendingId?, suggest?:
  {cat, by: "rule" | "plaid" | "haiku"}}], errors: [{acct, code}]}`. Rolling **90 days**, at most
  ~1,500 rows (about 200 KB). Account ids are hashed, never Plaid's ids or full account numbers.
- **The backend never rewrites `jazz2-data.json`**, matching the briefing and calendar files.
- The app pulls it in sync, like `jazz2-calendar.json`. `normalizeBank()` caps and escapes every
  field and keeps a device-only copy (`jarvis-bank`, not in `SYNC_KEYS`).

### 5.4 Turning transactions into Budget
- Budget gets a **"From your bank"** review list: tap to accept (with a category), skip, or split.
  An accepted item becomes a normal `budget.expenses` row with a new `bankId` field. The
  normalizer and `applyRemote()` need to handle that field, and the bank id makes accepting idempotent
  across devices.
- **Rules:** `budget.rules: [{match, cat}]` ("CORNER MARKET" → Groceries) is synced. A
  transaction that hits a rule, or a high-confidence Plaid category mapped to one of your
  categories, can be accepted automatically. That's a setting, off by default.
- **Excluded by code:** card payments, transfers between your own accounts, and refunds paired
  with their charge (Plaid `TRANSFER_IN/OUT`, `LOAN_PAYMENTS`). Otherwise a card purchase and the
  card payment both count.
- **Pending:** shown greyed, never accepted. When the posted version arrives with
  `pending_transaction_id`, it replaces the pending one. A pending that disappears is dropped.
- **Bill matching (code):** a debit within ±5 days of a bill's due date, with a name match and an
  amount within 10% (or any amount for "varies") → a "Mark <bill> paid · $X" suggestion. For
  autopay bills it confirms the payment the app already logged, or flags a mismatch.
- **Bill Guard with real balances:** `agents/lib/money.ts` gets an optional `balances` input. Then
  safe to spend becomes checking's available balance minus bills due before payday, alongside
  the plan-based number. A new finding: "checking won't cover <bill> on <date>". Card balances and
  due dates come from Liabilities, if you turn it on.

### 5.5 Data flow
```
[your computer, once per bank]                    [GitHub secrets]
 npm run plaid-link ──Hosted Link──> bank OAuth    PLAID_CLIENT_ID, PLAID_SECRET,
        └─ prints access token ──you paste──────>  PLAID_ACCESS_TOKENS

[morning Action: jarvis.yml]
 tools/plaid.ts ──/accounts/get + /transactions/get──> Plaid
      │ code: dedupe, pending→posted, drop transfers, rules, bill matches
      ├─(ambiguous merchants only, names+amounts as untrusted data)──> Haiku categorizer ─zod─┐
      ├─────────────────────────────────────────────────────────────────────────────────────┘
      ├─> lib/money.ts (Bill Guard + balances) ──> Jarvis (Opus) ──> jazz2-briefing.json
      └─> jazz2-bank.json (gist, Action-only)

[phone: sync pull] jazz2-bank.json → normalizeBank() → "From your bank" review
      → you accept → budget.expenses (saveContent) → jazz2-data.json (app-only, as today)
```

### 5.6 Model work vs code
- **Code:** fetching, dedupe, pending, transfers, rules, category mapping from Plaid's
  `personal_finance_category`, bill matching, every amount and total.
- **Model (Haiku, optional):** only transactions with no rule and a low-confidence or unmapped
  Plaid category. At most 40 a run, sent as `<untrusted_data>`. It may only answer with a
  category from your own list (a zod enum) or "unsure". It has no tools, and it gets no balances
  or account names. With SimpleFIN (no categories), this step does more of the work.
- **Jarvis (Opus)** gets only the checked results: "Dining is 85% used with 9 days left",
  "duplicate $14.99 charge", "a new subscription".

### 5.7 Never in logs, traces, commits or the public repo
Access tokens, the client secret, the SimpleFIN Access URL, public tokens, link tokens, Plaid
item and account ids, account numbers or masks, balances, merchant names, amounts, and Plaid
error bodies (they can echo request data). The repo is public, so **workflow logs and trace
artifacts are public too**. The trace keeps counts only ("bank: 3 Items ok, 42 txns"). Tests use
recorded fake responses. `.env.example` lists the names only.

## 6. Effort

| Step | Size | What |
|---|---|---|
| 0 | S | Make the morning run reliable (cron fallback). Needed for any automatic feed |
| 1 | M | Spreadsheet gaps that don't need a bank (section 7, after we see the sheet) |
| 2 | S | `plaid-link.ts` (Hosted Link, update mode) or `simplefin-claim.ts`, SETUP.md section, `.env.example` |
| 3 | M | `agents/tools/plaid.ts` + `jazz2-bank.json` writer + zod schema + tests with mocked responses (pending→posted, transfers, re-auth errors, injection text in merchant names) |
| 4 | M | App: `normalizeBank()`, sync pull, the "From your bank" review list, rules, `bankId` on expenses, regression tests |
| 5 | S | Bill matching + Bill Guard balances in `money.ts` + Money card / push lines |
| 6 | S | Haiku categorizer (optional) + eval cases |
| 7 | S | CSV/OFX statement import into the same review list (fallback for any bank) |

Rough total: **3 M + 5 S**, about the size of Phase 2.

**What you do yourself:**
- Plaid: sign up as **Personal use** and start the Trial (~15 min). Add `PLAID_CLIENT_ID` and
  `PLAID_SECRET` to `agents/.env` and GitHub secrets. Run `npm run plaid-link` once per bank
  (~3 min each). Paste the tokens into `PLAID_ACCESS_TOKENS`. Re-consent about once a year when
  Jarvis asks.
- Or SimpleFIN: subscribe ($15), link banks on its site, run the claim once, add one secret.
- Share the spreadsheet (section 7) and pick the options in section 9.

## 7. Spreadsheet gap (the owner's monthly sheet, seen Oct 31)

This repo is public, so the sheet is described by its layout only: no amounts, lenders or names.

**The sheet, one page a month:**
- **Header tiles:** Income · Bills & spending · Left over · savings goal balance at month end.
- **My Bills** and **Joint Bills** tables: due day, expense, paid from (a checking account or a
  credit card), amount, a PAID mark that strikes the row through,
  and a total.
- **Paycheck Plan** per payday: roll-up lines like "Bills due 2nd–12th", a
  credit card payment, a single bill, one-off spending, a
  transfer to savings, next month's joint bills set aside, and **Remaining**.
- **Savings goal:** start and end of month balance, goal, % progress.
- **Income & Inputs:** each paycheck and the total; the month's planned savings deposit.
- **Goals:** a savings target with a date, and **debts to pay off** with no date yet.
- **Month at a Glance:** Income − Bills & spending − To savings = Left over.

**Already in the app** (much of the sheet is modelled one to one):
- My Bills / Joint Bills tables with paid-from account, share and paid ticks (`billTableRowHtml`).
- Paycheck plans per payday, with a one-tap **"+ Bills due 2nd–12th · $X"** line computed from the
  bills in that check's stretch, Remaining and copy-forward (`budget-income.js`, `budget-view.js`).
- Month at a Glance (Income, Bills & spending, to goals, Left over) and goals with target, date,
  pace and history.
- Pasting the sheet's bill rows, paychecks and plan blocks (`budget-import.js`).

**The real gaps, most important first:**
1. **Debts.** Nothing tracks a loan: balance, APR, minimum payment, payoff date, extra payments,
   snowball/avalanche order, or "paid off by". The sheet's payoff goals have nowhere to go.
   Needs a Debts section (manual first; balances from the bank feed later, see below).
2. **Credit cards as accounts.** Bills are marked "paid from" a card, and a card payment is a plan
   line, but the app never knows a card's balance, statement amount or due date, so it can't
   suggest the payment or avoid counting card-paid bills twice. A bank feed fixes this best.
3. **Savings by month.** Goals keep a running total, but not the sheet's start/end-of-month
   balance per month, and deposits are planned lines rather than an actual transfer.
4. **One-off spending from the bank.** The sheet's ad hoc lines
   are typed by hand both places; transactions from the bank would fill them in.
5. **One-page view on a big screen.** The sheet shows the whole month at once; the app stacks it
   for a phone. A wide "sheet view" of the month (tables side by side) would remove a reason to
   open Excel.
6. Smaller: history pruned after ~13 months, no year view, no CSV/Excel export.

**Accounts the owner would link** (about 6–7 logins): a bank (checking/savings), card issuers and
lenders. That fits the Trial's 10-Item lifetime cap with a few spare, so re-linking must be
rare. On a paid plan: about $1.80–$4.20 a month (estimate, $0.30–$0.60 per Item, section 2).

**What a bank feed can and can't do for the debts:** Plaid **Liabilities** (APR, minimum, due date,
payoff details) covers **credit cards, PayPal credit, student loans and mortgages only**, not auto
or personal loans ([Plaid Liabilities docs](https://plaid.com/docs/liabilities/), read Oct 31,
2026). For auto and personal loans the most a feed may give is the account's current
balance, and only if each lender shares loan accounts through Plaid (to check in Sandbox, lender
by lender). So the Debts section should work by hand (balance, APR, payment) and take a balance from
the feed when one exists.

**The owner's answers (Oct 31):**
1. **Cards:** cards that share one login count as one Item; a card on someone else's login is
   another Item.
2. **Card-paid bills count** in Bills & spending as well as the card payment line, as in the sheet.
   Keep that (no de-duplication); the bank feed should label card spending, not remove it.
3. **Cards are paid in full** each month: the card's statement balance is the payment to plan, and
   carrying a balance should be flagged.
4. **Priority:** a savings goal first, then the loans in an order the owner picks. Not snowball or
   avalanche: the Debts section needs a **custom order**
   the owner sets, and "extra money" goes to the first item that isn't done.

## 8. Risks and open questions

- **Trial terms can change,** and the 10-Item cap is lifetime. Mitigation: always re-auth in update
  mode, never re-link a bank as a new Item, and keep SimpleFIN or CSV as a fallback. Past 10,
  pay as you go is an estimated $1–$2.40/month.
- **Real prices aren't public.** Check the last page of Plaid's Production request before
  submitting anything (you can't return to the Trial afterwards).
- **Hosted Link on the Trial:** to verify in Sandbox first. If it isn't available, the fallback is a
  one-time Link page on the GitHub Pages site (HTTPS) that holds no secret and passes the public
  token only to your local script.
- **Coverage:** check each bank in Plaid's (or SimpleFIN's) institution search before building.
  Forum reports say Chase connections can need re-auth more often.
- **Privacy:** merchant names and amounts land in the private gist, the same trust level as Budget
  today, plus balances. A leaked `sync-token` would expose more than it does now.
- **Double counting:** card spend vs card payments, joint bills paid from a shared account. Rules
  must be right before auto-accept is ever turned on.
- **Cron reliability** blocks "automatic". Fix it first.
- **Scope:** this is outside the current plan (Phase 3 shipped "Budget only"). Building it means
  updating `PLAN.md` (finance provider, Money row) and `BACKLOG.md` first.

## 9. Decisions needed

1. **Feed:** Plaid Trial (recommended), SimpleFIN, Teller, or CSV/OFX only.
2. **Liabilities** for card balances, minimums and due dates: yes/no (useful: cards are paid in
   full, so the statement balance is the payment).
3. **Auto-accept** rule matches, or review everything by hand.
4. **Haiku categorizer:** on, or Plaid categories + rules only.
5. **Order of work.** Suggested, now that the sheet is in: (0) the morning cron firing;
   (1) **Debts** by hand, in the owner's custom order; (2) **credit cards
   as accounts** (statement balance → the paycheck plan's card line); (3) a **wide month view**;
   (4) the bank feed on the Plaid Trial, filling balances, card statements and one-off spending.
   Steps 1–3 need no bank access and close most of the gap with the sheet.

## 10. Nov 7 update: what's left, and how Budget would show it

Status: **built Nov 7**: A and B, rules that add by themselves, bill matching (`js/bank.js`,
`agents/lib/bank.ts`, `agents/plaid-link.ts`). Prices in sections 2–4 are from Oct 31 and
weren't rechecked.

**Section 9 so far:**
- (0) The morning run fires. The Google alarm clock (`docs/jarvis/alarm-clock.gs`) starts it.
- (1)–(3) Debts in your own order, credit cards as accounts, and the wide Sheet view shipped Nov 1.
- What's left is (4), the bank feed itself.

**Decided (Nov 7):** charges that match one of your rules are **added automatically** (decision 3).
Each still shows in the list as "Added by your rule · Undo" until the next sync, so a wrong rule is easy to
catch. A confident bank category without a rule still waits for a tick.

**Still open:** 1, 2 and 4 in section 9: the feed (Plaid Trial or SimpleFIN), Liabilities, and the
categorizer.

### Where transactions show up in Budget (previews, Nov 7)
Both previews use the app's own parts: Next 14 days rows, Spending bars, chips and theme tokens.
They add nothing new to the design system.

- **A. A "From your bank" list** above Next 14 days, in the left column on desktop.
  - **Each transaction is a bill-style row:** the tick adds it to Budget, then the logo, a clean
    merchant name, "date · account · category ▾", and the amount.
  - **A row that matches a bill** says "Matches Moto Insurance"; ticking it marks that bill paid.
  - **Amazon and other unknowns** say "Pick a category ▾" in gold.
  - **Pending charges** are faded, with no tick.
  - **"Add 3 matched"** adds every row a rule or a confident bank category already placed.
  - **Footer:** "Synced 6:02 AM · card payments and transfers left out".
  - **The section only appears when something is waiting.**
- **B. Folded into Spending.** There's no list. Each category bar gets a faint extra segment and
  "+$63.18 new" for charges not added yet. Spending's label gets a "5 new · Review" chip that opens
  the same rows in a sheet. Bills the feed confirmed say "matched on Citi CC" in Next 14 days.
- **Chosen (Nov 7): A and B together.**
  - **A's list:** reviewing is a daily thumb task, and A's list is one tap per row.
  - **B's faint segments:** they show where the month is heading before you've added anything.
  - **Bill matches** need no review at all: an autopay bill already counts as paid, and the feed
    only confirms or flags it.

### Designing it with impeccable
[impeccable](https://github.com/pbakaus/impeccable) (Apache 2.0) is a design skill with review
commands (`critique`, `audit`) and finishing commands (`adapt`, `polish`, `harden`, `clarify`).
It isn't installed on this computer yet. The plan:

1. **Install.**
   - **Plugin:** `/plugin marketplace add pbakaus/impeccable`, then install it from `/plugin`.
   - **Or the CLI:** `npx impeccable install` in the repo.
   - **Telemetry:** turn it off.
   - **The design hook:** keep it. It scans UI files as they're edited.
   - **Live mode:** never use it, because it runs the agent with approvals off.
2. **`init`:** write `PRODUCT.md`, the monthly budgeting job.
   - **Paychecks:** every two weeks, with a plan per check.
   - **Bills:** My Bills and Joint Bills, and paid-from accounts.
   - **Cards:** paid in full each month.
   - **Money:** Safe to spend until payday, a savings goal first, then debts in your own order.
   - **Usage:** quick phone check-ins, and a month-at-once Sheet view on desktop.
3. **`document`:** write `DESIGN.md` from the existing tokens in `css/app.css`, so impeccable
   steers toward this app's look rather than its own defaults.
4. **`critique` and `audit` on Budget at phone and desktop sizes,** before and after the feed.
   They score hierarchy, the 44px touch targets, contrast in both themes, and overflow at large
   Android text sizes.
5. **`adapt` and `polish`** on the chosen layout. Everything still follows AGENTS.md: theme tokens,
   `collapsibleCard()`, no inline handlers, and every bank field escaped.

**One gap the previews already show:** at large text sizes on a phone, a row's meta line wraps to
three lines ("Matches Moto Insurance"). The build should move the category or match onto its own
line, as Deliveries does.
