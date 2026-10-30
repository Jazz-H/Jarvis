# Jarvis backlog

Everything open, so nothing gets missed. Tick items off here as they land (and note the
branch or commit). Big phases live in `PLAN.md`; this list is the smaller work around them.

## Do next
- [ ] **Publish the Google app** (you): the Jarvis app is in "Testing", so the Gmail sign-in
  ends every 7 days. Publishing was blocked on Branding (likely a privacy policy link); a
  one-page privacy policy on the Pages site would fix it. Until then, redo `npm run google-auth`
  weekly and update `GOOGLE_REFRESH_TOKEN`.

## Decide
- (nothing open)

## Build
- (nothing open; add ideas here)

## Done
- [x] Google connected (Calendar, Inbox, Deliveries) and phone notifications on; tested Oct 30
- [x] Skin & Hair renamed Beauty; notification badge; cleaner notification text (Oct 30)
- [x] Workflow passes the Google and VAPID secrets to the morning run (Oct 30, `main`)
- [x] Budget stays out of the tab bar; Home's Money tile is the way in (decided Oct 30)
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
