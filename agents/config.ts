// Jarvis settings. Preferences come from docs/jarvis/PLAN.md ("My preferences").
// Secrets never live here: they come from the environment (GitHub Actions secrets or agents/.env).

export const CONFIG = {
  location: { name: "Springfield, IL", latitude: 39.7817, longitude: -89.6501 },
  timezone: "America/New_York",
  // The briefing should land around this local time. jarvis.yml's two cron lines start the
  // run BRIEFING_LEAD_MINUTES early (one line for EDT, one for EST); a test keeps them in step.
  briefingTime: "07:00",
  briefingLeadMinutes: 15,
  // The Weekly Review (review.ts) lands on reviewDay around reviewTime, covering Monday to Sunday.
  // Its two Sunday cron lines in jarvis.yml start reviewLeadMinutes early; the same test checks them.
  reviewDay: 0, // Sunday (0 = Sunday … 6 = Saturday, like Date.getDay)
  reviewTime: "18:00",
  reviewLeadMinutes: 15,
  reviewsKept: 12,
  digestDaysKept: 8, // daily Inbox/Deliveries/Calendar digests kept in jazz2-week.json
  // jazz2-calendar.json (morning run, when GOOGLE_CALENDAR_ICS_URL is set): New York local dates
  // from today - daysBack to today + daysAhead, for the app's Planner and for Ask.
  calendarHistory: {
    daysBack: 90,
    daysAhead: 60,
    maxEvents: 1500, // over this, the entries nearest to today are kept
    maxDaysPerEvent: 14, // a multi-day all-day event gets one entry per day, from its first day
    titleChars: 80,
    locationChars: 60,
  },
  news: {
    // Google News RSS only (no key). Each topic is one feed.
    topics: {
      ai: "https://news.google.com/rss/search?q=%22artificial+intelligence%22+OR+AI+when:1d&hl=en-US&gl=US&ceid=US:en",
      tech: "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en",
      cars: "https://news.google.com/rss/search?q=cars+OR+automotive+OR+EV+when:1d&hl=en-US&gl=US&ceid=US:en",
      trending: "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en",
    } as Record<string, string>,
    blockedKeywords: [] as string[],
    perTopic: 12, // candidates kept per feed before the model ranks them
    maxAgeHours: 36,
  },
  models: {
    jarvis: "claude-opus-5-5",
    weather: "claude-haiku-5-5",
    news: "claude-sonnet-5-5",
    calendar: "claude-haiku-5-5",
    inbox: "claude-sonnet-5-5",
    deliveries: "claude-haiku-5-5",
    sorter: "claude-haiku-5-5", // Sort with Jarvis (runs through Ask's pipeline and limits)
    // Ask picks one per question (ask.ts askTier): quick lookups, most questions, hard ones
    askQuick: "claude-haiku-5-5",
    askNormal: "claude-sonnet-5-5",
    askHard: "claude-opus-5-5",
    prices: "claude-sonnet-5-5", // Price watcher (weekly, with web search)
  },
  // Gmail searches (read-only). Unread mail in the primary inbox only; promotions and social are left out.
  inbox: {
    query: "in:inbox category:primary is:unread newer_than:36h", // the card only looks at unread mail
    unreadQuery: "in:inbox category:primary is:unread newer_than:36h", // the count uses the same search
    max: 30,
  },
  deliveries: {
    // Amazon order mail, every message from the big carriers, and any store's shipping notice
    query:
      'newer_than:21d -category:promotions ((from:amazon.com (subject:ordered OR subject:shipped OR subject:delivery OR subject:delivered OR subject:arriving)) OR from:ups.com OR from:fedex.com OR from:usps.com OR from:dhl.com OR subject:"has shipped" OR subject:"out for delivery" OR subject:"tracking number" OR subject:"was delivered")',
    max: 30,
  },
  // Rough upper bounds per run, used to decide what fits under MAX_RUN_COST_USD before starting.
  // review: the Weekly Review's single Opus call (~12k in / ~2.5k out, about $0.10).
  costEstimateUsd: {
    jarvis: 0.12,
    weather: 0.01,
    news: 0.06,
    calendar: 0.01,
    inbox: 0.06,
    deliveries: 0.02,
    prices: 0.15, // weekly: up to 8 items, a web search or two each
    review: 0.15,
    ask: 0.1, // one Ask answer (Opus, effort low: ~8k in / ~1.5k out, about $0.06)
  },
  defaultMaxRunCostUsd: 0.5,
  // Ask Jarvis (ask.ts). Every limit is enforced here in the backend, not just in the app.
  // Days, ISO weeks and months are America/New_York. Anything over a limit is answered
  // "over_limit" at no model cost. The three dollar limits can be lowered or raised with the
  // MAX_ASK_COST_USD, ASK_DAILY_BUDGET_USD and ASK_MONTHLY_BUDGET_USD variables, but never above
  // the hard ceilings below.
  ask: {
    maxQuestionChars: 1000, // longer questions are cut
    maxPerRun: 5, // questions answered by the model in one run; the rest wait for the next run
    maxRunCostUsd: 0.4, // MAX_ASK_COST_USD
    maxQuestionCostUsd: 0.2, // one question (including its one retry) can't spend more than this
    perDay: 10,
    dailyBudgetUsd: 1.0, // ASK_DAILY_BUDGET_USD
    perWeek: 40,
    monthlyBudgetUsd: 20.0, // ASK_MONTHLY_BUDGET_USD (raised from $8, Oct 31)
    ceilings: { runUsd: 2, dayUsd: 5, monthUsd: 40 }, // overrides are clamped to these
    pendingKept: 20, // items read from jazz2-ask.json
    answersKept: 50,
    sortMaxItems: 12, // chips from one Sort with Jarvis
    maxTurns: 8, // a question may search the web a few times before answering
    threadTurns: 6, // earlier question/answer turns in the same thread given as context
    // The calendar list given to Ask (from jazz2-calendar.json): the events nearest to today are
    // listed until this many characters of JSON (about 5k tokens); the rest are counted per week.
    calendarMaxChars: 20_000,
    calendarMaxAgeDays: 7, // an older calendar file is left out
  },
  agentTimeoutMs: 120_000,
  // Each gist file has one writer. The app writes data, push and ask; the orchestrator writes
  // briefing and week (morning run), reviews (Sunday run) and answers (Ask runs, and the morning
  // and Sunday runs for queued questions) and calendar (morning run), and prunes revoked phones
  // from push.
  gistFiles: {
    data: "jazz2-data.json",
    briefing: "jazz2-briefing.json",
    push: "jazz2-push.json",
    week: "jazz2-week.json",
    reviews: "jazz2-reviews.json",
    ask: "jazz2-ask.json",
    answers: "jazz2-answers.json",
    calendar: "jazz2-calendar.json",
    prices: "jazz2-prices.json", // the Price watcher's last check (this Action's own file)
  },
  // Price watcher: Shopping items with a saved price, checked once a week in the morning run
  prices: { maxItems: 8, everyDays: 7 },
  // Web Push (phone notifications). The public key is also in js/push.js; the private key is the
  // VAPID_PRIVATE_KEY secret.
  push: {
    publicKey: "BF54qprNwJg833P74vJhM1ABNGzHJYmWsgq26TZi9ik7JLLmK_F_tMAuKGpkC_S7fO4-_Ci5anNk7T2jinq4YtQ",
    subject: "https://jazz-h.github.io/Jazz2.0/",
    url: "./jazz2.0.html?tab=jarvis",
    reviewUrl: "./jazz2.0.html?tab=console&review=", // + the review id
    askUrl: "./jazz2.0.html?tab=console&ask=", // + the first answered question's id
  },
};

export type SubagentName = "weather" | "news" | "calendar" | "inbox" | "deliveries" | "prices";
