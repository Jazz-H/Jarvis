// Jarvis settings. Preferences come from docs/jarvis/PLAN.md ("My preferences").
// Secrets never live here: they come from the environment (GitHub Actions secrets or agents/.env).

export const CONFIG = {
  location: { name: "Springfield, IL", latitude: 39.7817, longitude: -89.6501 },
  timezone: "America/New_York",
  // The briefing should land around this local time. jarvis.yml's two cron lines start the
  // run BRIEFING_LEAD_MINUTES early (one line for EDT, one for EST); a test keeps them in step.
  briefingTime: "07:00",
  briefingLeadMinutes: 15,
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
  },
  // Gmail searches (read-only). Primary inbox only; promotions and social are left out.
  inbox: {
    query: "in:inbox category:primary newer_than:36h",
    unreadQuery: "in:inbox category:primary is:unread",
    max: 30,
  },
  deliveries: {
    query:
      "from:amazon.com newer_than:21d (subject:ordered OR subject:shipped OR subject:delivery OR subject:delivered OR subject:arriving)",
    max: 25,
  },
  // Rough upper bounds per run, used to decide what fits under MAX_RUN_COST_USD before starting.
  costEstimateUsd: { jarvis: 0.12, weather: 0.01, news: 0.06, calendar: 0.01, inbox: 0.06, deliveries: 0.02 },
  defaultMaxRunCostUsd: 0.5,
  agentTimeoutMs: 120_000,
  gistFiles: { data: "jazz2-data.json", briefing: "jazz2-briefing.json" },
};

export type SubagentName = "weather" | "news" | "calendar" | "inbox" | "deliveries";
