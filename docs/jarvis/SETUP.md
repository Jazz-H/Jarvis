# Setting up Jarvis

Jarvis runs in GitHub Actions (`.github/workflows/jarvis.yml`) and writes its briefing into the
same private gist that Jazz sync uses. The app picks it up the next time it syncs. Keys live
**only** in GitHub Actions secrets (or a gitignored `agents/.env` on your computer), never in
the app, the gist, or the repo.

Phase 1 needs three secrets. Later phases add Google, Plaid and so on, and their steps will be added here.

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
