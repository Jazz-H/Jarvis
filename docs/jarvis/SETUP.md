# Setting up Jarvis

Jarvis runs in GitHub Actions (`.github/workflows/jarvis.yml`) and writes its briefing into the
same private gist that Jazz sync uses. The app picks it up the next time it syncs. Keys live
**only** in GitHub Actions secrets (or a gitignored `agents/.env` on your computer), never in
the app, the gist, or the repo.

Phase 1 needs three secrets (sections 1–5). Phase 2 adds optional Google access (section 6).

## 1. Anthropic API key: `ANTHROPIC_API_KEY`
1. Go to console.anthropic.com → **API Keys** → **Create Key**. Name it "Jarvis".
2. Optional but recommended: in **Limits**, set a monthly spend limit (for example $10).
   Each run is also capped by `MAX_RUN_COST_USD` (default $0.50; a normal run costs about $0.05–$0.15).

## 2. Gist id: `JARVIS_GIST_ID`
This is the gist Jazz already syncs to.
1. Open https://gist.github.com while signed in and find the private gist whose file is
   `jazz2-data.json` (description "Jazz 2.0 app data (auto-sync)").
2. The id is the last part of its URL: `https://gist.github.com/<you>/<THIS-PART>`.

Sync must be on in the app (cloud button → paste a token) for the briefing to reach your phone.

## 3. Gist token: `JARVIS_GIST_TOKEN`
Use a **separate** token from the one in the app, so either can be revoked on its own.
1. GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)** →
   Generate new token (classic). Fine-grained tokens can't use the Gist API.
2. Note: "Jarvis gist". Expiration: your choice (set a reminder to renew it).
3. Scope: **gist** only. Nothing else.

Jarvis only reads `jazz2-data.json` and only writes `jazz2-briefing.json`. Sync never
touches `jazz2-briefing.json`, and Jarvis never touches `jazz2-data.json`.

## 4. Add the secrets to the repo
Repo → Settings → Secrets and variables → Actions → **New repository secret**, three times:
`ANTHROPIC_API_KEY`, `JARVIS_GIST_ID`, `JARVIS_GIST_TOKEN`.

Optional: on the **Variables** tab, add `MAX_RUN_COST_USD` (for example `0.30`) to change the per-run cap.

## 5. Try it
1. Repo → Actions → **Jarvis** → **Run workflow**. A manual run delivers right away.
2. When it finishes, open Jazz (or bring it back to the foreground). A "Jarvis: …" toast appears and
   the briefing shows at the top of the Jarvis tab.
3. Each run uploads a `jarvis-trace-<id>` artifact with timings, outcomes and token costs per agent
   (no inputs or secrets).

## 6. Google (optional): Calendar, Inbox and Deliveries

Each part is optional. Until it's connected, Home shows "Connect your calendar" or "Not
connected", and the rest of the briefing works as before. Everything is **read-only**.

### Calendar (about 2 minutes, works on a phone in desktop view)
1. Open calendar.google.com → ⚙ **Settings** → under *Settings for my calendars*, click your
   calendar → **Integrate calendar**.
2. Copy **Secret address in iCal format**.
3. Add it as the repository secret **`GOOGLE_CALENDAR_ICS_URL`**.

The address only lets someone *read* that calendar. Never share it; if it ever leaks, click
**Reset** there and update the secret.

### Gmail: Inbox and Deliveries (about 15 minutes, once, on a computer)
For the Inbox, Jarvis reads only headers and Gmail's short preview snippet. For Deliveries, code
also reads the body of order and shipping emails, because the product name is often only there. It
strips links and cuts everything from the first address or payment label ("Shipping address",
"Billing" and the like), or anything shaped like a street, PO box or "City, ST 12345", on, and a
model sees at most 800 characters of each. An address in an unusual shape, or your name printed
above an address, could still slip through. USPS's Daily Digest is read by code only. None
of this text is stored or logged, and attachments are never opened.

1. **Project:** go to console.cloud.google.com and create a project named "Jarvis".
2. **Gmail API:** APIs & Services → Library → **Gmail API** → **Enable**.
3. **Consent screen** (Google Auth Platform):
   - *Branding*: app name "Jarvis", your email as support and developer contact.
   - *Audience*: user type **External**; add your Gmail address as a test user.
   - *Data access*: **Add or remove scopes** → `https://www.googleapis.com/auth/gmail.readonly`.
   - Back on *Audience*, click **Publish app** so it's **In production**. This matters: apps left
     in "Testing" get sign-ins that expire every 7 days. You don't need Google's verification
     for an app only you use.
4. **Client:** *Clients* → **Create client** → type **Desktop app** → name "Jarvis CLI". Copy the
   **Client ID** and **Client secret**.
5. **Sign in once** on your computer:
   ```
   cd agents
   npm ci
   # add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to agents/.env (it's gitignored)
   npm run google-auth
   ```
   Google says **"Google hasn't verified this app."** That's expected for your own app: click
   **Advanced → Go to Jarvis**, then allow read-only Gmail access. The terminal prints a refresh
   token.
6. Add three repository secrets: **`GOOGLE_CLIENT_ID`**, **`GOOGLE_CLIENT_SECRET`**,
   **`GOOGLE_REFRESH_TOKEN`** (the token from step 5). Don't paste the token anywhere else.
7. Actions → Jarvis → **Run workflow**. Inbox and Deliveries appear on Home.

**If Home says "Gmail needs you"** (your phone gets the same notification, each morning until it's
fixed): the sign-in ended. Usually the app is still in "Testing" (step 3: Publish app; its sign-ins
last 7 days), or you changed your Google password, left it unused 6 months, or removed access at
myaccount.google.com/permissions. Publish the app if it isn't, run `npm run google-auth` again
(allow Gmail and Drive) and replace `GOOGLE_REFRESH_TOKEN`. The next run clears the warning.

### Google Drive for Ask Jarvis (about 5 minutes, once; after Gmail above)
Lets Ask Jarvis search your Drive and read Docs, Sheets and Slides (read-only, all of Drive) when
you ask about your files. It uses the same Google secrets, plus one more permission:

1. **Drive API:** APIs & Services → Library → **Google Drive API** → **Enable**.
2. **Consent screen** → *Data access* → **Add or remove scopes** → add
   `https://www.googleapis.com/auth/drive.readonly` (keep the Gmail one).
3. **Sign in again** on your computer, so the new token covers Drive too:
   ```
   cd agents
   npm run google-auth
   ```
   Allow both read-only Gmail and read-only Drive.
4. Replace the **`GOOGLE_REFRESH_TOKEN`** secret with the new token (the same token serves the
   morning run and Ask). Nothing else changes.

Until then, Ask answers as usual and says "Drive isn't connected yet" if it tries Drive.

## 7. Phone notifications (optional): `VAPID_PRIVATE_KEY`
The morning headline (plus a bill to pay by hand due by tomorrow, and a package arriving today)
as a notification on your lock screen. The key pair is already made: the public half is in the
app, and the private half is in `agents/.env` on your computer (gitignored).
1. On your computer, open `agents/.env` and copy the value after `VAPID_PRIVATE_KEY=`.
2. GitHub → repo → Settings → Secrets and variables → Actions → **New repository secret**, name
   **`VAPID_PRIVATE_KEY`**, paste it. Don't paste it anywhere else (not in chat, not in the app).
3. On your phone, open Jarvis (sync must be on) and tap **Turn on** on the Notifications card,
   then **Allow**. Do this on each phone you want notified.
   - **Android:** works in Chrome or the installed app.
   - **iPhone:** iOS 16.4+, and only from the app added to the Home Screen (Share → Add to
     Home Screen), not from Safari.
4. Actions → Jarvis → **Run workflow** to test it.

**Not now** hides the card on that phone for 2 weeks. If you blocked notifications, allow them
again in the phone's settings for Jarvis (or the site settings in Chrome); the card then returns.

## 8. Ask Jarvis (optional): the Ask key
Questions typed in Console go to your private gist; the Ask key lets the app start Jarvis right
away, so answers come back in about a minute (and as a notification). Without the key, questions
wait for the next morning run.

The key can **only** start, re-run or cancel this repo's Actions. It can't read your secrets,
your gist, or your code, and it can't push anything. It can start any workflow in this repo, though,
including paid briefing runs, so if a key is lost, delete it right away. A monthly spend limit in the
Anthropic console is the ceiling over all of this.
1. Open https://github.com/settings/personal-access-tokens/new (a **fine-grained** token).
2. **Token name:** `Jarvis Ask`. **Expiration:** custom, 1 year (the app warns you 2 weeks before).
3. **Repository access:** *Only select repositories* → **Jarvis** (named Jazz2.0 before Nov 5, 2026; a key made then still works).
4. **Permissions** → **Repository permissions** → **Actions: Read and write**. (Metadata: Read is
   added automatically.) Leave everything else as *No access*.
5. **Generate token** and copy it (it starts with `github_pat_`).
6. In Jarvis on your phone: the cloud button (Sync) → **Ask Jarvis key** → paste → Save. Do this on
   each device you ask from. Don't paste it anywhere else (not in chat, not in a note).

**Limits** (enforced by the Action, so they hold whatever the app does): 1,000 characters a
question and $20 a month, however many questions that is. Over the month's budget, Jarvis answers
"over the limit" at no cost. Each run answers up to 5 questions and $0.40; the rest wait for the next
run. Typical use is about $1 a week. To change a dollar cap, add a repository **variable** (Settings →
Secrets and variables → Actions → Variables): `ASK_MONTHLY_BUDGET_USD` (default 20, max 40) or
`MAX_ASK_COST_USD` per run (default 0.40, max 2). A question that doesn't fit a run's cap stays
queued for the next run.

**If Ask says the key isn't working:** it expired or was deleted. Make a new one (steps 1–5) and
replace it in Sync. If a phone is lost, delete the token at
https://github.com/settings/personal-access-tokens; nothing else needs changing.

## 9. The alarm clock (recommended): on-time briefings
GitHub runs this repo's scheduled workflows only every few hours (in Nov 2026 the hourly check-in
line ran 3–4 times a day, and the 6:45am briefing lines were missed or started 5–7 hours late).
The alarm clock is a small Google Apps Script, in your Google account, that asks GitHub to start
the briefing at about 5:45am (once more about 45 minutes later, in case), the Weekly Review on
Sundays at about 5:45pm, and check-ins hourly. Its starts are gated like scheduled runs, so it
never delivers twice.

Its token can **only** start, re-run or cancel this repo's Actions, including paid runs (like the Ask key). It lives
only in the script's Script Properties: never in the script's code, the app, the gist or the repo.
1. Make a fine-grained token exactly like section 8 steps 1–5, named `Jarvis alarm clock`
   (this repo only, **Actions: Read and write**, nothing else). Use a new token, not your Ask key,
   so either can be deleted on its own.
2. Open https://script.google.com → **New project**. Name it `Jarvis alarm clock`.
3. Replace the code in `Code.gs` with `docs/jarvis/alarm-clock.gs` from this repo. Save.
4. **Project Settings** (gear) → set **Time zone** to *(GMT-05:00) Eastern Time - New York*. Then
   **Script Properties** → **Add script property**: name `GITHUB_TOKEN`, value = the token. Save.
5. Back in **Editor**, pick `setup` in the function menu → **Run**. Allow the permissions Google
   asks for (it says "unverified app" because it's your own script: Advanced → Go to Jarvis alarm
   clock). This makes the 15-minute trigger and runs it once.
6. Check: **Triggers** (clock icon) shows one `tick` trigger every 15 minutes; **Executions** shows
   it running. On GitHub, Actions → Jarvis shows a run started by `workflow_dispatch` after 6:45am.

To stop it, delete the trigger (or the project). If the token expires, the executions log says
"GitHub said 401": make a new one and replace the property.

## 10. The bank feed (optional): Plaid
Your banks' charges in Budget's **From your bank** (README → Budget). About 15 minutes, once, on
a computer, plus about 3 minutes per bank.

1. **Sign up:** at dashboard.plaid.com/signup choose **Personal use** and start the free **Trial**.
   It covers 10 bank logins for good: a login you link counts even if you remove it later, so
   always reconnect with `--update` (step 5), never by linking again.
2. **Keys:** in the Dashboard → Developers → Keys, copy the client id and the Production secret.
   Add them to `agents/.env` as `PLAID_CLIENT_ID` and `PLAID_SECRET`, and as GitHub secrets
   with the same names. To try it with Plaid's fake banks first, set `PLAID_ENV=sandbox` in
   `agents/.env` and use the Sandbox secret (user `user_good`, password `pass_good`).
3. **Link a bank:** `cd agents && npm run plaid-link -- chase` (any short name for that login).
   Plaid's own page opens in your browser; sign in to your bank there. The terminal then prints
   `"chase": "access-…"`. Do it once per bank login (cards on the same login count once).
4. **Add the tokens:** make one GitHub secret, `PLAID_ACCESS_TOKENS`, with every login as JSON:
   `{"chase":"access-…","citi":"access-…"}`. Never paste a token into the app, a chat or a file
   in the repo. For local runs, add the same line to `agents/.env`.
5. **When a bank needs you** (most ask about once a year): Budget says
   "chase needs you: sign in again". Run `npm run plaid-link -- --update chase`. It keeps the
   same login and token, and doesn't use up a Trial slot.
6. **Card statements, minimums and due dates** (Plaid Liabilities): a login linked from Nov 7 2026
   on asks for them. A login linked before that, with a credit card on it, shows in Budget's
   Balances as "allow card details once": run `npm run plaid-link -- --update citi` and approve.
   Same login and token, no new Trial slot.

The next Jarvis run (the 6 AM briefing or a card refresh) writes `jazz2-bank.json`, and the app
picks it up on its next sync. It covers the last 45 days of spending, every account's balance,
cards' statement details, and deposits (for paydays); card payments and transfers are left out.
The run's log shows only counts, never names or amounts.

## When it runs
- **Card refreshes** at about **12:30pm, 5pm and 9pm Eastern** redo today's Weather, Calendar, Inbox,
  Deliveries and Bill Guard cards. They come from the alarm clock, so after updating to this version
  paste the new `docs/jarvis/alarm-clock.gs` into your script again (section 9, step 3, and save);
  the 15-minute trigger stays as it is. To try one by hand: Actions → Jarvis → Run workflow → `refresh`.
- Every morning so it's there by about **6:00am Eastern**: the alarm clock (section 9) starts it at
  5:45am. GitHub's own cron lines (5:45am EDT and EST, plus a try every 15 minutes) are a fallback;
  GitHub often runs them hours late or not at all. Whatever starts first in the 5:30am–6pm window
  delivers; every later run that day sees today's briefing and stops.
- Scheduled workflows only run from the default branch (`main`), and GitHub pauses them after 60
  days without repo activity; re-enable from the Actions tab if that happens.
- To change the time, edit `briefingTime` in `agents/config.ts` and the two cron lines in
  `jarvis.yml`. A test fails if they disagree.

## Running it on your computer
```
cd agents
npm ci
cp .env.example .env      # fill in the three values; .env is gitignored
npm run brief -- --now    # deliver now
npm test                  # unit tests, no network
```

## If something fails
- A sub-agent that fails or times out shows an error on its card; the rest of the briefing still ships.
- If the Jarvis model itself fails, the briefing is assembled from the cards without its summary.
- If the gist can't be written, the workflow run fails (red X in Actions) and the app keeps the last briefing.
