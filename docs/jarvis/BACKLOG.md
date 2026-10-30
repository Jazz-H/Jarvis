# Jarvis backlog

Everything open, so nothing gets missed. Tick items off here as they land (and note the
branch or commit). Big phases live in `PLAN.md`; this list is the smaller work around them.

## Do next
- Nothing right now. Next up is a Build item or the Budget decision.

## Decide
- [ ] **Budget in the tab bar?** It's hidden; Home's Money tile is the everyday way in. Keep it
  that way, or put Budget back in the bar.

## Build
- [ ] **New app icon.** The icon is still the charcoal "J 2.0" terminal card. Redesign it for
  Jarvis in the Reactor look (near-black, cyan core ring), keep it inside Android's maskable
  safe zone, and regenerate `icon-192.png` / `icon-512.png`; update the manifest and the README's
  Icons section, and bump `CACHE_NAME` in `sw.js` so installed copies pick it up.
- [ ] **Real phone notifications.** The Jarvis Action sends the morning headline as a Web Push
  notification (VAPID key in a secret; works for home-screen apps on iOS 16.4+), instead of
  only the in-app notice.
- [ ] **Outfit from your closet.** Jarvis picks today's outfit from your saved wardrobe using the
  weather and business-casual days.
- [ ] **Skin weather.** UV index and air quality from Open-Meteo; an SPF nudge when UV is high.
- [ ] **Wash-day swap.** When rain or humidity hits a wash day, offer to move it a day with one tap.
- [ ] **One goal item a day.** Jarvis picks one unfinished Glow or Leadership item.
- [ ] **Consistency score.** Routine, workouts and weigh-ins as one streak.
- [ ] **Money extras.** Safe to spend until payday; a paycheck countdown; a warning when a bill
  without autopay is due soon. (Fits Phase 3.)
- [ ] **Coming up.** Upcoming birthdays and car maintenance from your to-do types, with gift
  ideas from Shopping.
- [ ] **Your layout.** Reorder or hide Home's tiles; pin the detail you open most.

## Done
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
