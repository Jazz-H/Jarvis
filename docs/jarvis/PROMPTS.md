# Prompts for each phase

Workflow: one branch per phase (`jarvis/phase-1`, …). Use **one assistant at a time**, and
commit before switching between Claude and Copilot so neither one overwrites the other's
work.

| Job | Use |
|---|---|
| Starting a phase: planning, scaffolding many files, agent code, tests, running checks | **Claude Code** (VS Code extension) |
| Inline completions, small tweaks, styling cards, explaining code | **Copilot** (inline / Chat) |
| A one-function change or one extra test | either; Copilot Chat Edit mode is quick |
| Reviewing a phase's PR | Claude `/code-review` and `/security-review`, plus Copilot's PR review as a second opinion |

---

## Phase 1: Claude Code
```
Read AGENTS.md and docs/jarvis/PLAN.md. We're doing Phase 1 only.
First reply with: a short plan, a diagram of how Jarvis and its sub-agents interact,
the file list you'll create, and any questions about the "My preferences" section.
Wait for my OK, then build it, run npm run check, npm test and the agents tests, and
tick Phase 1 in the plan.
```

## Phase 2: Claude Code
```
Read AGENTS.md and docs/jarvis/PLAN.md. Phase 1 is merged. Do Phase 2 (Calendar,
Inbox and Shopper sub-agents with read-only Google OAuth). Add the Google steps to
docs/jarvis/SETUP.md. Plan first, wait for my OK, then build and test.
```

## Phase 3: Claude Code
```
Read AGENTS.md and docs/jarvis/PLAN.md. Do Phase 3 (Money sub-agent via
FINANCE_PROVIDER plaid|csv, Budget connections, Bill Guard). Store only what the
dashboard needs. Plan first, wait for my OK, then build and test.
```

## Phase 4: Claude Code
```
Read AGENTS.md and docs/jarvis/PLAN.md. Do Phase 4 (Jarvis cross-source insights,
suggested to-do chips, Ask Jarvis, Weekly Review, Package Tracker). Then list the
"propose only" sub-agents with a one-paragraph design for each. Plan first.
```

## Copilot Chat: small follow-ups (examples)
```
#file:AGENTS.md Make the Weather card on the Jarvis tab show the hourly rain chance as a
small bar row. Keep using the app.css tokens and escapeHtml.
```
```
#file:AGENTS.md Add a test in agents/test for the News sub-agent dropping stories that
match a blocked keyword. Mock the RSS fetch.
```
