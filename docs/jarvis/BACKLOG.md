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

## Decide
- (nothing open)

## Build
- (nothing open; add ideas here)

## Done
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
- ~~Settings → Jarvis screen~~ (Oct 30). Name, location, news topics and briefing time stay in
  `agents/config.ts` and `js/dashboard.js`.
