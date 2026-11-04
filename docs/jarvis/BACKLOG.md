# Jarvis backlog

Everything open, so nothing gets missed. Tick items off here as they land (and note the
branch or commit). Big phases live in `PLAN.md`; this list is the smaller work around them.

## Do next
- [ ] **Publish the Google app** (you): the Jarvis app is in "Testing", so the Gmail sign-in
  ends every 7 days. Publishing was blocked on Branding (likely a privacy policy link); a
  one-page privacy policy on the Pages site would fix it. Until then, redo `npm run google-auth`
  weekly and update `GOOGLE_REFRESH_TOKEN`.
- [ ] **Check the morning schedule** (Nov 1): GitHub had never fired `jarvis.yml`'s cron; every
  briefing so far was started by hand, and a 5-minute probe on Oct 31 didn't fire either. If no
  briefing arrives by itself, pick a fallback: an outside timer (cron-job.org with a dispatch
  token) or the app starting a run when today's is missing. Home now says when it's late.
- [ ] **Top up Claude API credit** (you) when it runs low: briefing, review and Ask stop without it.

## Build
- [ ] **Ask: drop the question limits** (Nov 3): remove the 10-a-day and 40-a-week question caps
  and only track credits spent, up to the $20 monthly limit.
- [ ] **Free-to-read news** (Nov 3): articles the app pulls in should open without a paywall (a
  Washington Post link hit a subscribe wall). Likely a skip list of paywalled sites in the News
  tool, in code, picking another outlet's copy of the story when there is one.
- [ ] **HUD**: a small glance view for a desktop corner (next event, Top 3, safe to spend, latest alert).
- [ ] **Run the Ask test set** (you: Actions → Jarvis Eval, about $0.30) to check the per-question
  models against the Oct 31 baseline (12/12).

## Done
- [x] **Weather like a phone weather app** (Nov 1): hero with a sky glow, hourly strip with a temperature line, day and night icons, tiles, sunrise/sunset and NWS alerts (live on the phone with a saved location).
- [x] **Weather for 90 days at your location** (Nov 1): 16-day forecast plus ECMWF's long-range
  outlook on Home and for Ask; "Use my location" from the phone; 12-hour Eastern times in answers.
- [x] From the Jarvis OS slides (Nov 1): **Top 3 today** in the briefing (and the Evening Top 3
  recap check-in), **a model per question** for Ask (`askTier`: Haiku / Sonnet / Opus), and the
  **Notebook** (notes by topic that Ask reads; Jarvis saves or adds to one when asked; Note it after
  a to-do with steps). Also: dismissing on Home and by Jarvis (× on briefing lines, Got it on packages).
- [x] Desktop matches the mockups (Nov 1): Ask Jarvis and the briefing read **debts and credit
  cards** (`readDebts` / `readCards` in `agents/lib/money.ts`; Bill Guard flags a card due
  soon that isn't in a paycheck plan), the To-Do **Details pane**, the Console **history column**
  (search, days, Clear history), and Home's duplicate add box gone on big screens.
- [x] Budget catches up with the sheet (Nov 1): **Debts** by hand in your own order behind the goals
  (payoff dates, Pay, Next), **credit cards** as accounts (statement → one-tap paycheck line),
  **By account**, and the wide **Sheet view**; plus the **desktop layouts** (Home three columns,
  To-Do and Console two, command bar with /, status line). Steps 1–3 of PLAID-SCOPE.md section 9.
- [x] Read aloud (🔊 on answers and the briefing; spoken questions answered out loud) and the weekly
  Price watcher for Shopping (Oct 31)
- [x] Jarvis's brain (Oct 31): memory ("remember …"), ratings, tone / news topics / about you, and
  your own scheduled check-ins (hourly in jarvis-ask.yml)
- [x] Photos and PDFs in Console (📎), with receipt → Budget chips (Oct 31)
- [x] Google Drive for Ask (read-only, all of Drive) (Oct 31)
- [ ] **Connect Drive** (you): enable the Drive API, add the drive.readonly scope, redo
  `npm run google-auth` and update `GOOGLE_REFRESH_TOKEN` (SETUP.md section 6)
- [x] The Ask test set (Oct 31): Actions → Jarvis Eval. Baseline Oct 31: **12/12 passed, $0.29**
- [x] Console: one conversation (History merged in, Earlier, usage chip, chat bubbles, quiet
  declines); Ask sees all app data, can search the web, and acts on small things with Undo (Oct 31)
- [x] Phase 3 and the rest of Phase 4 (Oct 31): Bill Guard from Budget, suggested to-dos,
  Package Tracker (all carriers), Sort with Jarvis; late-briefing notice; Ask's monthly spending
- [x] Jazz 3.0 redesign (Oct 31): banner, Today, Weight, last 4 weeks, goal-area rings
- [x] Inbox counts and reads unread Primary mail only (Oct 31)
- [x] Tab bar: Home · To-Do · Console · Wallet (Budget | Shopping) · Glow (Beauty | Jazz 3.0); phone-first
  Budget top (safe to spend, next 14 days, spending bars, goal) (Oct 30)
- [x] Console (Ask Jarvis with cost limits, Capture, voice, Hey Jarvis), Weekly Review, calendar history (Oct 30)
- [x] Google connected (Calendar, Inbox, Deliveries) and phone notifications on; tested Oct 30
- [x] Skin & Hair renamed Beauty; notification badge; cleaner notification text (Oct 30)
- [x] Workflow passes the Google and VAPID secrets to the morning run (Oct 30, `main`)
- [x] ~~Budget stays out of the tab bar~~ (Oct 30; replaced the same day by the Wallet tab group)
- [x] Backlog build, steps 7–16 (Oct 30, `main`): skin weather (UV + SPF, air quality), wash-day
  swap, one goal item a day, consistency (last 7 days), money extras (safe to spend, payday
  countdown, not-autopay warning), coming up (next 14 days, gift idea), outfit from your closet,
  your layout (reorder/hide tiles), real phone notifications (Web Push)
- [x] Phase 2 built: Calendar, Inbox and Deliveries agents; Your day timeline; Inbox tile;
  Calendar and Deliveries details; Google setup guide and `npm run google-auth`
- [x] Loading skeleton on Home while the app starts
- [x] New Jarvis app icon: reactor core with a Rajdhani "J" (`icon.svg`, `npm run icons`)
- [x] App sync on (private gist) and all three Jarvis secrets added; first briefing delivered
  Oct 30 (Weather, News and Jarvis all succeeded, about $0.05 for the run)
- [x] Pushed to GitHub (Oct 30): `main` live on Pages; Tests workflow green (app + agents)
- [x] Month-end test failures: the app was right; three tests assumed "2 days from now" stays in
  the same month or Sun–Sat week. They now pick dates inside it (`isoInMonth`, `isoInWeek`).
- [x] `.mcp.json` untracked and gitignored (still on this computer)
- [x] Pull to sync instead of a hard reload; a long pull still reloads (`jarvis/quick-wins`)
- [x] App icon badge with what still needs you today (`jarvis/quick-wins`)
- [x] Evening Tomorrow view (`jarvis/quick-wins`)
- [x] Quick add on Home (`jarvis/quick-wins`)
- [x] Home dashboard with drill-downs; app renamed Jarvis (`main`)
- [x] Reactor theme, light/dark mode, self-hosted fonts (`main`)

## Dropped
- ~~Obsidian vault~~ (Nov 3). Scope doc removed, nothing built.
- ~~Settings → Jarvis screen~~ (Oct 30). Name, location, news topics and briefing time stay in
  `agents/config.ts` and `js/dashboard.js`.
