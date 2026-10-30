# Jarvis: personal dashboard plan

Turn Jazz into a full personal dashboard run by an AI chief of staff named **Jarvis**.
Jarvis is the main agent. It hands work to specialist sub-agents (email, calendar, Amazon,
money, weather, news), puts their findings together, and delivers a daily briefing at a set
time with insights, the weather and a news feed tailored to me. Everything Jazz already does
(Home, To-Do, Budget, Shopping, Skin & Hair, Gist sync, backups) keeps working unchanged.

Rules for both assistants are in `/AGENTS.md`. Step-by-step prompts are in `PROMPTS.md`.

## Status
- [ ] Phase 1: Agent SDK setup, Jarvis + Weather + News, Gist output, ntfy, Jarvis tab
- [ ] Phase 2: Calendar + Inbox + Shopper (Google OAuth)
- [ ] Phase 3: Money + Budget links + Bill Guard
- [ ] Phase 4: Cross-source insights, suggested to-dos, Ask Jarvis, Weekly Review, Package Tracker

## My preferences (fill in)
- Location:
- Time zone: America/New_York
- Briefing time: 6:30am
- News topics / sources / blocked keywords:
- Jarvis as its own tab, or the top of Home:
- Finance provider: plaid | csv

## Architecture (fixed)
- The app stays a static PWA on GitHub Pages. No secrets in the client or in localStorage.
- Jarvis and all sub-agents run in a scheduled GitHub Action (`.github/workflows/jarvis.yml`)
  using the **Claude Agent SDK (TypeScript)**. They live in `agents/`, with their own
  `package.json` and `tsconfig.json`:
  - `agents/jarvis.ts`: the orchestrator
  - `agents/subagents/*.ts`: one file per sub-agent
  - `agents/tools/*.ts`: plain code functions that call external APIs
  - `agents/schemas/*.ts`: a zod output schema for each sub-agent
  - `agents/test/`: tests with mocked APIs
- Secrets live only in GitHub Actions secrets (and a gitignored `agents/.env` locally).
- Jarvis writes `jazz2-briefing.json` to the same private Gist the app already syncs with.
  The app reads it on load and on pull-to-refresh. The briefing is read-only in the app, so
  it is left out of `SYNC_KEYS` and the per-list merge.
- Schedule: cron in UTC, set from `BRIEFING_TIME` + `TIMEZONE`. Also `workflow_dispatch`.
  GitHub cron can run 5–15 minutes late.
- Notify through ntfy.sh (topic in a secret) with Jarvis's headline and a link to
  `?tab=jarvis`. The notifier is swappable (email via Resend is the fallback).

## Agent design

### Jarvis (orchestrator), `claude-opus-5-5`
- Reads my settings and Jazz context from the Gist: to-dos, bills, pay periods, goals,
  Shopping list, wash days.
- Picks which sub-agents to run (all of them daily; only the relevant ones for a question)
  and runs independent ones in parallel.
- Receives **only validated sub-agent output**, never raw emails, articles or transactions.
- Cross-references the outputs. For example: a bill email that disagrees with Budget; an
  Amazon delivery that matches a Shopping item; a meeting that conflicts with a to-do; rain
  on a wash day; spending that puts a pre-payday bill at risk.
- Produces "Today in 60 seconds" (3–5 ranked items), suggested to-dos (one-tap chips, never
  added automatically) and the full briefing JSON.
- A failed or timed-out sub-agent is noted in the briefing; the rest still ships.

### Sub-agents
| Sub-agent | Model | Tools / source | Returns |
|---|---|---|---|
| Inbox | claude-sonnet-5-5 | Gmail API, read-only | unread count, mail needing a reply, bills and statements (payee, amount, due date), urgent items. Short summaries only |
| Calendar | claude-haiku-5-5 | Google Calendar, read-only | today's and tomorrow's events, conflicts, free blocks, travel time |
| Shopper (Amazon) | claude-haiku-5-5 | Gmail search on Amazon order and shipping emails (no consumer API) | orders, totals, deliveries arriving today, return windows closing within 7 days, Shopping matches |
| Money | claude-sonnet-5-5 | Plaid (dev tier) or CSV import, chosen by `FINANCE_PROVIDER` | balances, safe-to-spend until next paycheck, unusual or duplicate charges, subscription changes, category trend, goal progress |
| Weather | claude-haiku-5-5 | Open-Meteo (no key needed) | conditions, high/low, hourly rain chances, what to wear, humidity on wash days |
| News | claude-sonnet-5-5 | RSS feeds or a news API, using my topics, sources and blocked keywords | 5–8 stories with duplicates removed and ranked, each with a 1–2 sentence summary and a link |

### Agent rules
- Least privilege: a sub-agent gets only its own tools and credentials. It cannot write to
  the Gist, notify, or call another agent.
- Untrusted content: email, news and transaction text is data, not instructions. Invalid
  output is retried once, then dropped and logged.
- Deterministic first: code does the fetching, parsing and math; models judge, rank and
  summarize.
- Cost guard: log tokens per agent per run; `MAX_RUN_COST_USD` (default 0.50) caps a run,
  and Jarvis skips optional sub-agents to stay under it.
- Logging: a per-agent trace (inputs redacted) is saved as a workflow artifact.

## App UI
- A **Jarvis** tab (or the top of Home, per my preference). It shows:
  - the 60-second summary and suggested to-do chips
  - cards for Weather, Calendar, Inbox, Deliveries, Money and News
  - on each card: the sub-agent that made it, when it was last updated, and an error state
- Calendar events on the Home strip as a distinct read-only type; Amazon spending in Budget.
- **Ask Jarvis**: a question box that triggers `workflow_dispatch` with the question; the
  answer goes to the Gist and the app checks for it until it arrives (about a minute).
- Settings → Jarvis: location, briefing time and time zone, news topics and sources,
  sub-agents on or off, "Run now", and setup status for each sub-agent.
- `docs/jarvis/SETUP.md`: steps for each secret (Google OAuth refresh token, Plaid, ntfy,
  Anthropic key, Gist id and token).

## Extra sub-agents
Build: **Weekly Review** (Sunday evening), **Bill Guard** (3-day warning when the balance
won't cover a bill), **Package Tracker** (all carriers, linked to Shopping).
Propose only: Subscription Auditor, Price Watcher, Birthdays & Gifts, Commute, Skin Weather
(UV and air quality), Health (Apple Health export), Read-Later inbox, Year in Review.

## Definition of done for each phase
- Unit tests for every tool and schema, with mocked APIs.
- An orchestrator test where Jarvis runs with stubbed sub-agents and one of them fails.
- `tests/regression.mjs` extended for any UI.
- `npm run check` and `npm test` green.
- README.md and the status list above updated.
- The app still works offline and when Jarvis isn't set up.
