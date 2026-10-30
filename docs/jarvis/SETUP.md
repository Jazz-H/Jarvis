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
Jarvis reads only headers and Gmail's short preview snippet: never full emails or attachments.

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

**If Inbox says "Google access expired":** changing your Google password (or 6 months unused, or
removing access at myaccount.google.com/permissions) ends the sign-in. Run
`npm run google-auth` again and update `GOOGLE_REFRESH_TOKEN`.

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
your gist, or your code, and it can't push anything. A run with no question waiting does nothing.
1. Open https://github.com/settings/personal-access-tokens/new (a **fine-grained** token).
2. **Token name:** `Jarvis Ask`. **Expiration:** custom, 1 year (the app warns you 2 weeks before).
3. **Repository access:** *Only select repositories* → **Jazz2.0**.
4. **Permissions** → **Repository permissions** → **Actions: Read and write**. (Metadata: Read is
   added automatically.) Leave everything else as *No access*.
5. **Generate token** and copy it (it starts with `github_pat_`).
6. In Jarvis on your phone: the cloud button (Sync) → **Ask Jarvis key** → paste → Save. Do this on
   each device you ask from. Don't paste it anywhere else (not in chat, not in a note).

**Limits** (enforced by the Action, so they hold whatever the app does): 1,000 characters a
question, 5 questions and $0.40 per run, 10 questions and $1 a day, 40 a week, and $8 a month.
Over a limit, Jarvis answers "over the limit" at no cost. Typical use is about $1 a week. To change
a dollar cap, add a repository **variable** (Settings → Secrets and variables → Actions →
Variables): `ASK_MONTHLY_BUDGET_USD` (default 8, max 40), `ASK_DAILY_BUDGET_USD` (default 1, max 5)
or `MAX_ASK_COST_USD` per run (default 0.40, max 2). A question that doesn't fit a run's cap stays
queued for the next run.

**If Ask says the key isn't working:** it expired or was deleted. Make a new one (steps 1–5) and
replace it in Sync. If a phone is lost, delete the token at
https://github.com/settings/personal-access-tokens; nothing else needs changing.

## When it runs
- Every morning so it's there by about **7:00am Eastern**. GitHub's cron is UTC-only and can start
  5–15 minutes late (sometimes more), so the workflow fires at 6:45am EDT and 6:45am EST, and only
  the run that falls in the 6:30–9:00am window delivers. If today's briefing already exists, the
  other run skips.
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
