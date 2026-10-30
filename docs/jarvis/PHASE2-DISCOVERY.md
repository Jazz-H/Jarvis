# Phase 2 discovery: Calendar, Inbox and Shopper (+ the backlog)

Status: **built (Oct 30).** All 16 steps in section 7 are in, with the layouts picked in
section 8. Still yours: connect Google (SETUP section 6) and add `VAPID_PRIVATE_KEY` (section 7).
Design and layout options are on the design canvas (see *Design options*).

## 1. Goal

Each morning Jarvis should also know your day (calendar), what needs you in email (replies,
bills, urgent mail) and what's arriving (Amazon), and connect them with what Jazz already
knows: to-dos, bills, the Shopping list, wash days, the weather. Home shows the results as
tiles and details, the same way Weather and News do today.

## 2. What exists today (and gets reused)

| Piece | Today | Phase 2 use |
|---|---|---|
| `agents/jarvis.ts` orchestrator | runs Weather + News in parallel, cost cap, error cards, fallback summary | add three sub-agents to the same loop |
| `lib/run-agent.ts` | no tools, no MCP, no repo settings, only the Anthropic key in env, zod output, one retry | same for every new agent |
| `schemas/briefing.ts` | `cards.weather`, `cards.news` | add `cards.calendar`, `cards.inbox`, `cards.deliveries` |
| `lib/jazz-context.ts` | to-dos, bills ≤3 days, wash day, Shopping needs, goals, weight | add bills ≤14 days with amounts (to compare against bill emails) |
| App `normalizeBriefing` | weather/news cards, untrusted, capped | add the three cards with the same rules |
| Home dashboard | 6 tiles that drill down, briefing, Tomorrow view | new tiles/details or a day timeline (options below) |
| Planner strip | to-dos, bills, wash days, workouts | show calendar events as a read-only type (from the plan) |

## 3. Data access: findings

Verified against Google's docs (Oct 30, 2026):

- **OAuth apps in "Testing" get refresh tokens that expire after 7 days** (external user
  type), unless they only ask for name/email/profile. A Gmail or Calendar token from a
  test-mode app would break every week.
- **Publishing the app ("In production") without verification** works for personal use: Google
  shows an *unverified app* warning once at sign-in (you click Advanced → continue), and the
  app is capped at 100 users. Its refresh tokens don't have the 7-day limit.
- Refresh tokens still stop working if unused for 6 months, if you **change your Google
  password** (for Gmail scopes), or if you revoke access. Jarvis must report this clearly.
- **Google Calendar has a "Secret address in iCal format"** per calendar (Settings → your
  calendar → Integrate calendar). It's read-only, needs no OAuth, and can be reset if it ever
  leaks. It covers one calendar per address.
- **Gmail without OAuth** means IMAP with an *app password* (needs 2-Step Verification). It's
  quick to set up but grants full mailbox access, not read-only; our code would only read
  (IMAP `EXAMINE`), but the credential itself could do more.

### Options

| | A. OAuth for both | B. iCal + OAuth Gmail (recommended) | C. iCal + IMAP app password |
|---|---|---|---|
| Calendar | `calendar.readonly` | secret iCal address | secret iCal address |
| Gmail | `gmail.readonly` | `gmail.readonly` | IMAP, app password |
| Least privilege | read-only both | read-only both | mail credential is full access |
| Setup | ~15 min on a computer: Google Cloud project, consent screen → In production, run a one-time sign-in helper | same as A, plus 1 min to copy the iCal address | ~3 min on a phone |
| Breaks when | password change, 6 months unused | Gmail part same as A | app password revoked |
| Secrets | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | those + `GOOGLE_CALENDAR_ICS_URL` | `GOOGLE_CALENDAR_ICS_URL`, `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD` |

**Recommendation: B.** Read-only everywhere (matches AGENTS.md), and the calendar part never
expires. The OAuth part needs a computer once; I'd add a small `npm run google-auth` helper that
opens the sign-in and prints the refresh token *only to your terminal*, never to logs or chat.

## 4. Agent design

All three follow the existing rules: code fetches, parses and does math; the model judges,
ranks and summarizes; output is zod-validated; nothing but the Anthropic key is in an agent's
environment; email text is untrusted data.

| Agent | Model | Code fetches | Model returns |
|---|---|---|---|
| **Calendar** | haiku | today + tomorrow events from the iCal feed (or API), recurring events expanded, all-day vs timed | a one-line read of the day, conflicts with timed to-dos, free blocks ≥ 60 min |
| **Inbox** | sonnet | unread + last 36 h, `in:inbox -category:promotions -category:social`, up to 40 messages; sender, subject, date and a ~600-character snippet only (never full bodies or attachments) | unread count, up to 5 "needs a reply" with one-line reasons, bills/statements (payee, amount, due date), urgent items |
| **Shopper** | haiku | Gmail search `from:(amazon.com) newer_than:30d` order/shipping/delivery emails; code extracts order ids, totals, delivery dates and return-by dates with patterns | today's deliveries, return windows closing in 7 days, matches with Shopping items |

**Never stored:** email bodies, addresses other than the sender's display name, message ids.
The briefing keeps only short summaries, and its cards follow the same 200-character caps as today.

**New Jarvis cross-references** (deterministic checks first, the model only phrases them):
- a bill email whose amount or due date disagrees with Budget's bill;
- an Amazon delivery that matches a Shopping item, with a one-tap "mark bought" chip in Phase 4;
- a timed event that overlaps a to-do with a time, or rain at an outdoor event;
- a delivery arriving on a day with no one home (events all day). This one is optional.

**Cost:** about +$0.03–0.06 a day (Inbox is the biggest). The run stays well under the $0.50 cap.

**Travel time** (in the original plan) needs a maps API key. Options: skip it, show only the
event's location, or add Google Maps Distance Matrix later.

## 5. App changes

- Three new briefing cards: `calendar`, `inbox`, `deliveries`, normalized and escaped like the others.
- **Home layout:** choose one of three options on the canvas (more tiles, a "Your day"
  timeline, or grouped tiles).
- **Detail layouts:** one per new card (options on the canvas).
- **Planner strip:** calendar events as a distinct read-only row type with a dot on the calendar.
- **Budget:** Amazon order totals listed in Budget's spending as suggestions to add (not added
  automatically), as the plan says.

## 6. Risks and unknowns

- **Google setup friction.** Mitigated by option B, the helper script and a SETUP.md section with screenshots.
- **Token breaks** on a password change: the Inbox and Deliveries cards show "Reconnect Google",
  and the rest of the briefing still ships.
- **Amazon email formats change.** The parsing uses patterns plus model fallback; if both
  fail, the card says what it couldn't read.
- **Prompt injection in email.** Email is only ever data inside `<untrusted_data>`, agents have
  no tools, links come from code, and nothing an email says can trigger actions.
- **Gist size.** Briefings stay small (< 20 KB).

## 7. Build order

**Phase 2** (after the decisions):
1. Schemas and briefing cards for calendar, inbox, deliveries (+ tests).
2. Calendar: iCal fetch and recurring-event expansion, the sub-agent, the Home detail and
   Planner events (+ tests).
3. Google OAuth helper (`npm run google-auth`), a Gmail tool with read-only scope, and SETUP.md steps.
4. Inbox sub-agent and its detail (+ tests, including an injection test).
5. Shopper sub-agent, its Deliveries detail, Shopping matches and Budget suggestions (+ tests).
6. Jarvis cross-references, then README, PLAN and BACKLOG updates. Run it live once you've added the secrets.

**Then the backlog, step by step** (each is small; options on the canvas where there's a choice):
7. Budget in the tab bar (decision).
8. Skin weather: UV index and air quality from Open-Meteo (no key).
9. Wash-day swap.
10. One goal item a day.
11. Consistency score.
12. Coming up: birthdays and car maintenance.
13. Outfit from your closet.
14. Money extras: safe-to-spend, paycheck countdown, warnings for bills without autopay.
15. Your layout: reorder and hide tiles.
16. Real phone notifications (Web Push from the Action).

## 8. Decisions needed

1. **Google access:** A, B (recommended) or C.
2. **Home layout for the new sections:** canvas options 1, 2 or 3.
3. **Detail layouts:** Calendar, Inbox and Deliveries options on the canvas.
4. **Travel time:** skip, location only, or a maps API later.
5. **Inbox scope:** which mail counts. Default: unread and last 36 h, primary inbox only, no
   promotions or social.
6. **Budget tab:** back in the bar, or Home's Money tile only.
7. **Backlog design choices** on the canvas: skin weather placement, wash-day swap style,
   goal-of-the-day placement, consistency score style, coming-up placement, layout editing.
