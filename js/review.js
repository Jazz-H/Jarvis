// review.js - Jarvis's Weekly Review: storing and normalizing it, the Console card, the full-review
// sheet (with ‹ › history and tap-to-add suggestion chips), the Home line and the ?review= link.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- WEEKLY REVIEW ----------
// The Jarvis Action's Sunday run writes jazz2-reviews.json ({version: 1, reviews: [...]}, newest
// first, at most 12) into the sync gist. Sync's pull hands that file to ingestReviewFile(); it's
// kept on this device only (never in SYNC_KEYS, never pushed, not in backups) and is read-only
// here. Like all synced data it's untrusted: normalizeReviews() caps every field on the way in and
// on every read, and everything is rendered escaped, with no links from its text.
const REVIEWS_FILENAME = "jazz2-reviews.json";
const REVIEWS_KEY = "jarvis-reviews";
const REVIEW_SEEN_KEY = "jarvis-review-seen"; // id of the newest review opened on this device
const REVIEW_MAX = 12;
const REVIEW_ID = /^\d{4}-W\d{2}$/;
// What each stat key is called and where it leads (dashGo's sections)
const REVIEW_STATS = {
  todos: { label: "To-dos", go: "todo" },
  routine: { label: "Routine", go: "skin" },
  workouts: { label: "Workouts", go: "jazz3", card: "weight-card" },
  weight: { label: "Weight", go: "jazz3", card: "weight-card" },
  goals: { label: "Goals", go: "jazz3" },
  bills: { label: "Bills", go: "money" },
  spending: { label: "Spending", go: "money" },
  shopping: { label: "Shopping", go: "shop" },
  nextWeek: { label: "Next week", go: "todo" },
  inbox: { label: "Inbox", go: null },
};
const REVIEW_NOT_TRACKED = "Not tracked yet";
let reviewOpenId = null; // the review shown in the sheet
let reviewReturnFocus = null;
let reviewPending = null; // a ?review= id that hadn't synced yet: opened when it arrives
let reviewTapped = new Set(); // "reviewId|chipIndex" added from the sheet this session
let reviewCache = { raw: undefined, list: [] };

function normalizeReview(r) {
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const fin = (v) => typeof v === "number" && isFinite(v);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const count = (v, hi = 100000) => (fin(v) ? clamp(Math.round(v), 0, hi) : 0);
  const countOrNull = (v, hi = 100000) => (fin(v) ? clamp(Math.round(v), 0, hi) : null);
  const cash = (v) => (fin(v) ? Math.round(clamp(v, 0, 1e7) * 100) / 100 : 0);
  const cashOrNull = (v) => (fin(v) ? Math.round(clamp(v, 0, 1e7) * 100) / 100 : null);
  const isDay = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isoDate(noonOf(v)) === v;
  const day = (v) => (isDay(v) ? v : null);
  const days = (v, max) => [...new Set(arr(v).filter(isDay))].sort().slice(0, max);
  const names = (v, max, len) =>
    arr(v)
      .map((x) => str(x, len))
      .filter(Boolean)
      .slice(0, max);
  const sec = (v, fn) => (isObj(v) ? fn(v) : null);
  if (!isObj(r) || r.version !== 1 || typeof r.id !== "string" || !REVIEW_ID.test(r.id)) return null;
  if (!isDay(r.weekStart) || !isDay(r.weekEnd) || r.weekEnd < r.weekStart) return null;
  const headline = str(r.headline, 100);
  if (!headline || !isObj(r.stats)) return null;
  const s = r.stats;
  const points = (v) =>
    arr(v)
      .filter(isObj)
      .map((p) => ({
        text: str(p.text, 200),
        stat: typeof p.stat === "string" && Object.prototype.hasOwnProperty.call(REVIEW_STATS, p.stat) ? p.stat : null,
      }))
      .filter((p) => p.text)
      .slice(0, 3);
  return {
    version: 1,
    id: r.id,
    weekStart: r.weekStart,
    weekEnd: r.weekEnd,
    generatedAt:
      typeof r.generatedAt === "string" && !isNaN(Date.parse(r.generatedAt)) ? r.generatedAt.slice(0, 40) : "",
    headline,
    stats: {
      todos: sec(s.todos, (t) => {
        const due = count(t.due);
        return {
          done: count(t.done),
          due,
          dueDone: Math.min(count(t.dueDone), due),
          missed: count(t.missed),
          carried: count(t.carried),
          starredDone: count(t.starredDone),
        };
      }),
      routine: sec(s.routine, (t) => ({
        fullDays: count(t.fullDays, 7),
        amOnly: count(t.amOnly, 7),
        streak: count(t.streak),
      })),
      workouts: sec(s.workouts, (t) => ({
        done: count(t.done),
        planned: count(t.planned),
        missedDays: days(t.missedDays, 7),
      })),
      weight: sec(s.weight, (t) => ({
        weighIns: count(t.weighIns),
        current: fin(t.current) ? clamp(t.current, 0, 1000) : null,
        change: fin(t.change) ? clamp(t.change, -1000, 1000) : null,
        pct: countOrNull(t.pct, 100),
        eta: day(t.eta),
      })),
      goals: arr(s.goals)
        .filter(isObj)
        .map((g) => ({
          name: str(g.name, 40),
          doneThisWeek: countOrNull(g.doneThisWeek),
          done: count(g.done),
          total: Math.max(count(g.total), count(g.done)),
        }))
        .filter((g) => g.name)
        .slice(0, 6),
      bills: sec(s.bills, (t) => ({
        paid: count(t.paid),
        autopaid: count(t.autopaid),
        paidTotal: cash(t.paidTotal),
        unpaidPastDue: names(t.unpaidPastDue, 5, 60),
        dueNextWeek: count(t.dueNextWeek),
        dueNextWeekTotal: cash(t.dueNextWeekTotal),
      })),
      spending: sec(s.spending, (t) => ({
        total: cash(t.total),
        byCat: arr(t.byCat)
          .filter(isObj)
          .map((c) => ({
            name: str(c.name, 40),
            spent: cash(c.spent),
            limitWeek: cashOrNull(c.limitWeek),
            monthSpent: cash(c.monthSpent),
            limitMonth: cashOrNull(c.limitMonth),
          }))
          .filter((c) => c.name)
          .slice(0, 8),
      })),
      shopping: sec(s.shopping, (t) => ({
        bought: Array.isArray(t.bought) ? names(t.bought, 8, 60) : null,
        boughtCount: countOrNull(t.boughtCount),
        needsOpen: count(t.needsOpen),
        estOpen: cash(t.estOpen),
      })),
      nextWeek: sec(s.nextWeek, (t) => ({
        start: day(t.start),
        end: day(t.end),
        events: countOrNull(t.events),
        busiestDay: day(t.busiestDay),
        todosDue: count(t.todosDue),
        billsDue: count(t.billsDue),
        workouts: count(t.workouts),
        washDays: days(t.washDays, 3),
      })),
      inbox: sec(s.inbox, (t) => ({
        days: count(t.days, 8),
        awaitingReply: count(t.awaitingReply),
        billMismatches: count(t.billMismatches),
      })),
    },
    wins: points(r.wins),
    slips: points(r.slips),
    focus: arr(r.focus)
      .filter(isObj)
      .map((f) => ({ text: str(f.text, 200) }))
      .filter((f) => f.text)
      .slice(0, 3),
    suggestions: arr(r.suggestions)
      .filter((c) => isObj(c) && (c.kind === "todo" || c.kind === "shopping"))
      .map((c) => ({ kind: c.kind, text: str(c.text, 120), due: c.kind === "todo" ? day(c.due) : null }))
      .filter((c) => c.text)
      .slice(0, 3),
    summaryBy: r.summaryBy === "fallback" ? "fallback" : "jarvis",
    notes: names(r.notes, 10, 200),
  };
}
// The whole file (or what's stored): valid reviews only, one per id, newest first, at most 12
function normalizeReviews(raw) {
  const list = raw && typeof raw === "object" && raw.version === 1 && Array.isArray(raw.reviews) ? raw.reviews : [];
  const seen = new Set();
  return list
    .slice(0, REVIEW_MAX * 4)
    .map(normalizeReview)
    .filter((r) => r && !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => (a.id < b.id ? 1 : -1))
    .slice(0, REVIEW_MAX);
}
function loadReviews() {
  let raw = null;
  try {
    raw = localStorage.getItem(REVIEWS_KEY);
  } catch (e) {}
  if (raw !== reviewCache.raw) {
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (e) {}
    reviewCache = { raw, list: normalizeReviews(parsed) };
  }
  return reviewCache.list;
}
function reviewById(id) {
  return typeof id === "string" && REVIEW_ID.test(id) ? loadReviews().find((r) => r.id === id) : undefined;
}
function reviewSeenId() {
  try {
    return localStorage.getItem(REVIEW_SEEN_KEY) || "";
  } catch (e) {
    return "";
  }
}
// Ids sort by week, so anything newer than the newest one opened is new
function reviewIsNew(r) {
  return !!r && r.id > reviewSeenId();
}
function markReviewSeen(r) {
  if (!reviewIsNew(r)) return;
  try {
    localStorage.setItem(REVIEW_SEEN_KEY, r.id);
  } catch (e) {}
}

// Called by sync's pull with the gist's reviews file entry (or undefined)
async function ingestReviewFile(file) {
  if (!file || typeof file !== "object") return;
  try {
    let text = file.content;
    if (file.truncated) {
      const raw = safeUrl(file.raw_url);
      if (!raw || new URL(raw).hostname !== "gist.githubusercontent.com") return;
      text = await (await fetch(raw)).text();
    }
    const list = normalizeReviews(JSON.parse(text));
    if (!list.length) return;
    const prev = loadReviews();
    if (JSON.stringify(prev) === JSON.stringify(list)) return; // nothing new
    writeQuietly(REVIEWS_KEY, { version: 1, reviews: list }); // stored already cleaned
    renderHome();
    renderConsole();
    if (reviewPending && reviewById(reviewPending) && currentTab === "console") {
      const id = reviewPending;
      reviewPending = null;
      openReview(id);
    } else if ((!prev.length || prev[0].id !== list[0].id) && reviewIsNew(list[0]))
      showToast("Your week in review is ready");
  } catch (e) {
    console.warn("reviews not loaded", e);
  }
}

// ---- small formatters ----
function reviewShort(iso) {
  return noonOf(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function reviewRange(a, b) {
  if (!a || !b) return "";
  return a.slice(0, 7) === b.slice(0, 7)
    ? `${reviewShort(a)} – ${Number(b.slice(8))}`
    : `${reviewShort(a)} – ${reviewShort(b)}`;
}
function reviewWeekday(iso) {
  return noonOf(iso).toLocaleDateString("en-US", { weekday: "short" });
}
const reviewPlural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const reviewPct = (n, d) => (d > 0 ? Math.max(0, Math.min(100, Math.round((n / d) * 100))) : 0);
// Categories with a limit: what they spent against their limits prorated over the week
function reviewLimitWeek(sp) {
  const limits = sp.byCat.filter((c) => c.limitWeek != null);
  if (!limits.length) return null;
  return {
    spent: Math.round(limits.reduce((s, c) => s + c.spent, 0)),
    limit: Math.round(limits.reduce((s, c) => s + c.limitWeek, 0)),
  };
}
// The one line of numbers: "2/4 to-dos · 5/7 routine · 3/4 workouts · $118 spent"
function reviewNumbers(r, max = 4) {
  const s = r.stats,
    out = [];
  if (s.todos) {
    if (s.todos.due) out.push(`${s.todos.dueDone}/${s.todos.due} to-dos`);
    else if (s.todos.done) out.push(`${reviewPlural(s.todos.done, "to-do")} done`);
  }
  if (s.routine) out.push(`${s.routine.fullDays}/7 routine`);
  if (s.workouts && s.workouts.planned) out.push(`${s.workouts.done}/${s.workouts.planned} workouts`);
  if (s.spending) out.push(`${moneyShort(Math.round(s.spending.total))} spent`);
  return out.slice(0, max).join(" · ");
}

// ---- Console: the card (Sunday to Tuesday, or while it's new) and the one-line row after ----
function consoleReviewHtml() {
  const r = loadReviews()[0];
  if (!r) {
    let synced = false;
    try {
      synced = !!localStorage.getItem("sync-token");
    } catch (e) {}
    return synced ? '<p class="rv-first">Your first weekly review arrives Sunday evening.</p>' : "";
  }
  const since = -daysFromToday(r.weekEnd); // days since the review's Sunday
  const isNew = reviewIsNew(r);
  const nums = reviewNumbers(r);
  if (since <= 2 || (isNew && since <= 6)) {
    return `<section class="rv-card" aria-labelledby="rv-card-title">
      <div class="jv-kicker rv-kicker"><span>Week in review · ${escapeHtml(reviewRange(r.weekStart, r.weekEnd))}</span>${isNew ? '<span class="jv-pill">New</span>' : ""}</div>
      <h2 class="rv-headline" id="rv-card-title">${escapeHtml(r.headline)}</h2>
      ${nums ? `<p class="rv-nums">${escapeHtml(nums)}</p>` : ""}
      <button type="button" class="rv-open" data-action="review-open" data-review-id="${escapeAttr(r.id)}" aria-label="Open the review of ${escapeAttr(reviewRange(r.weekStart, r.weekEnd))}">Open review <span aria-hidden="true">›</span></button>
    </section>`;
  }
  const label = since <= 7 ? "Last week" : `Week of ${reviewShort(r.weekStart)}`;
  const short = reviewNumbers(r, 2);
  return `<button type="button" class="rv-row" data-action="review-open" data-review-id="${escapeAttr(r.id)}" aria-label="${escapeAttr(`Open ${label.toLowerCase()}'s review${short ? `: ${short}` : ""}`)}">
      <span class="rv-row-k">${escapeHtml(label)}${isNew ? ' <span class="jv-pill">New</span>' : ""}</span><span class="rv-row-t">${escapeHtml(short || r.headline)}</span><span class="rv-cue" aria-hidden="true">›</span>
    </button>`;
}
// ---- Home: one line in Today in 60 seconds while the newest review is unseen ----
function reviewHomeRowHtml() {
  const r = loadReviews()[0];
  if (!reviewIsNew(r)) return "";
  return `<li><button class="jv-sum-row jv-sum-drill" data-action="review-open" data-review-id="${escapeAttr(r.id)}"><span class="jv-src jv-src-jarvis">Review</span><span class="jv-sum-text">Your week in review is ready</span><span class="jv-sum-cue" aria-hidden="true">›</span></button></li>`;
}

// ---- the full review ----
function reviewGoAttrs(stat, label) {
  return `data-action="review-go" data-stat="${stat}" aria-label="${escapeAttr(label)}"`;
}
function reviewBar(stat, label, pct, value, tone, aria) {
  return `<button type="button" class="rv-bar" ${reviewGoAttrs(stat, aria)}>
      <span class="rv-bar-k">${label}</span><span class="rv-track ${tone}" aria-hidden="true"><span style="width:${pct}%"></span></span><b>${escapeHtml(value)}</b>
    </button>`;
}
function reviewLine(stat, label, text, aria, extra = "") {
  return `<button type="button" class="rv-line" ${reviewGoAttrs(stat, aria)}${extra}>
      <span class="rv-line-k">${escapeHtml(label)}</span><span class="rv-line-t">${escapeHtml(text)}</span><span class="rv-cue" aria-hidden="true">›</span>
    </button>`;
}
function reviewNumbersHtml(r) {
  const s = r.stats,
    rows = [],
    lines = [];
  if (s.todos) {
    const t = s.todos;
    const sub = [
      `${t.done} done in all`,
      t.missed ? `${t.missed} still open` : "",
      t.carried ? `${t.carried} carried over` : "",
      t.starredDone ? `${t.starredDone} starred done` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    rows.push(
      reviewBar(
        "todos",
        "To-dos",
        reviewPct(t.dueDone, t.due),
        t.due ? `${t.dueDone}/${t.due}` : String(t.done),
        "",
        `To-dos: ${t.due ? `${t.dueDone} of ${t.due} due this week done` : `${t.done} done`}. ${sub}. Open To-Do`,
      ) + `<p class="rv-sub">${escapeHtml(t.due ? `Due this week · ${sub}` : sub)}</p>`,
    );
  }
  if (s.routine) {
    const t = s.routine;
    const sub = [t.amOnly ? `${t.amOnly} AM only` : "", t.streak ? `${t.streak}-day streak` : ""]
      .filter(Boolean)
      .join(" · ");
    rows.push(
      reviewBar(
        "routine",
        "Routine",
        reviewPct(t.fullDays, 7),
        `${t.fullDays}/7`,
        "pink",
        `Routine: AM and PM done ${t.fullDays} of 7 days${sub ? `. ${sub}` : ""}. Open Beauty`,
      ) + (sub ? `<p class="rv-sub">${escapeHtml(sub)}</p>` : ""),
    );
  }
  if (s.workouts) {
    const t = s.workouts;
    const sub = t.missedDays.length ? `Missed ${t.missedDays.map(reviewWeekday).join(", ")}` : "";
    rows.push(
      reviewBar(
        "workouts",
        "Workouts",
        reviewPct(t.done, t.planned),
        t.planned ? `${t.done}/${t.planned}` : String(t.done),
        "warn",
        `Workouts: ${t.done} of ${t.planned} done${sub ? `. ${sub}` : ""}. Open Jazz 3.0`,
      ) + (sub ? `<p class="rv-sub">${escapeHtml(sub)}</p>` : ""),
    );
  }
  if (s.spending) {
    const sp = s.spending,
      limit = reviewLimitWeek(sp);
    rows.push(
      reviewBar(
        "spending",
        "Spent",
        limit ? reviewPct(limit.spent, limit.limit) : sp.total ? 100 : 0,
        moneyShort(Math.round(sp.total)),
        limit && limit.spent > limit.limit ? "over" : "gold",
        `Spent ${moneyShort(Math.round(sp.total))}${limit ? `; categories with a limit: ${moneyShort(limit.spent)} of ${moneyShort(limit.limit)}` : ""}. Open Budget`,
      ) +
        (limit
          ? `<p class="rv-sub">${escapeHtml(`${moneyShort(limit.spent)} of ${moneyShort(limit.limit)} in categories with a limit`)}</p>`
          : ""),
    );
    const cats = sp.byCat
      .map((c) => {
        const over = c.limitWeek != null && c.spent > c.limitWeek;
        const of = c.limitWeek != null ? ` of ${moneyShort(Math.round(c.limitWeek))}` : "";
        const month =
          c.limitMonth != null
            ? ` · month ${moneyShort(Math.round(c.monthSpent))}/${moneyShort(Math.round(c.limitMonth))}`
            : "";
        return `<li class="${over ? "over" : ""}"><span>${escapeHtml(c.name)}</span><span>${escapeHtml(`${moneyShort(Math.round(c.spent))}${of}${month}`)}${over ? " · over" : ""}</span></li>`;
      })
      .join("");
    if (cats) rows.push(`<ul class="rv-cats" aria-label="Spending by category">${cats}</ul>`);
  }
  if (s.weight) {
    const w = s.weight;
    const ch =
      w.change != null
        ? `${w.change > 0 ? "+" : w.change < 0 ? "−" : ""}${Math.abs(Math.round(w.change * 10) / 10)} lb`
        : "";
    const text =
      [
        ch,
        w.current != null ? `now ${Math.round(w.current * 10) / 10} lb` : "",
        w.pct != null ? `${w.pct}% to goal` : "",
        w.eta ? `on pace for ${reviewShort(w.eta)}` : "",
      ]
        .filter(Boolean)
        .join(" · ") || (w.weighIns ? reviewPlural(w.weighIns, "weigh-in") : "No weigh-ins this week");
    lines.push(reviewLine("weight", "Weight", text, `Weight: ${text}. Open the Weight card`));
  }
  s.goals.forEach((g, i) => {
    const text = `${g.done}/${g.total} done · ${g.doneThisWeek == null ? `this week: ${REVIEW_NOT_TRACKED.toLowerCase()}` : `${g.doneThisWeek} this week`}`;
    lines.push(reviewLine("goals", g.name, text, `${g.name}: ${text}. Open it in Jazz 3.0`, ` data-index="${i}"`));
  });
  if (s.bills) {
    const b = s.bills;
    const text = [
      `${b.paid} paid${b.paid ? ` (${moneyShort(Math.round(b.paidTotal))}${b.autopaid ? `, ${b.autopaid} autopay` : ""})` : ""}`,
      b.unpaidPastDue.length ? `unpaid: ${b.unpaidPastDue.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(reviewLine("bills", "Bills", text, `Bills: ${text}. Open Budget`));
  }
  if (s.shopping) {
    const sh = s.shopping;
    const bought =
      sh.bought == null
        ? `bought: ${REVIEW_NOT_TRACKED.toLowerCase()}`
        : `bought ${sh.boughtCount != null ? sh.boughtCount : sh.bought.length}${sh.bought.length ? ` (${sh.bought.join(", ")})` : ""}`;
    const text = [
      bought,
      `${reviewPlural(sh.needsOpen, "need")} open${sh.estOpen ? ` (~${moneyShort(Math.round(sh.estOpen))})` : ""}`,
    ].join(" · ");
    lines.push(reviewLine("shopping", "Shopping", text, `Shopping: ${text}. Open Shopping`));
  }
  if (!rows.length && !lines.length) return "";
  return `<section class="rv-numbers" aria-label="Numbers">${rows.join("")}${lines.length ? `<div class="rv-lines">${lines.join("")}</div>` : ""}</section>`;
}
function reviewPointsHtml(title, cls, list) {
  if (!list.length) return "";
  const items = list
    .map((p) => {
      const st = p.stat && REVIEW_STATS[p.stat];
      const tag = st ? `<span class="jv-src">${st.label}</span>` : '<span class="jv-src">Jarvis</span>';
      const body = `${tag}<span class="jv-sum-text">${escapeHtml(p.text)}</span>`;
      return st && st.go
        ? `<li><button type="button" class="jv-sum-row jv-sum-drill" data-action="review-go" data-stat="${p.stat}">${body}<span class="jv-sum-cue" aria-hidden="true">›</span></button></li>`
        : `<li class="jv-sum-row rv-point">${body}</li>`;
    })
    .join("");
  return `<section class="rv-section" aria-labelledby="rv-h-${cls}"><h3 class="rv-h ${cls}" id="rv-h-${cls}">${title}</h3><ul class="jv-summary rv-points">${items}</ul></section>`;
}
// A suggestion is "on your list" when the to-do / Shopping item already exists (same text)
function reviewChipOnList(c) {
  const key = c.text.toLowerCase();
  return c.kind === "todo"
    ? todoList.some(
        (t) =>
          String(t.text || "")
            .trim()
            .toLowerCase() === key,
      )
    : wantsList.some(
        (w) =>
          String(w.name || "")
            .trim()
            .toLowerCase() === key,
      );
}
function reviewChipLabel(c) {
  const where = c.kind === "todo" ? (c.due ? dueLabel(c.due) : "To-do") : "Shopping";
  return { text: c.text, where };
}
function reviewFocusHtml(r) {
  const focus = r.focus.length
    ? `<ul class="rv-focus">${r.focus.map((f) => `<li>${escapeHtml(f.text)}</li>`).join("")}</ul>`
    : "";
  const chips = r.suggestions
    .map((c, i) => {
      const l = reviewChipLabel(c);
      const tapped = reviewTapped.has(`${r.id}|${i}`),
        onList = tapped || reviewChipOnList(c);
      const state = tapped ? "Added" : "On your list";
      return onList
        ? `<button type="button" class="rv-chip added" data-action="review-chip" data-index="${i}" aria-disabled="true" aria-label="${escapeAttr(`${l.text}: ${state.toLowerCase()}`)}"><span aria-hidden="true">✓</span> ${escapeHtml(l.text)} <small>${state}</small></button>`
        : `<button type="button" class="rv-chip" data-action="review-chip" data-index="${i}" aria-label="${escapeAttr(`Add ${c.kind === "todo" ? "to-do" : "to Shopping"}: ${l.text}${c.kind === "todo" && c.due ? `, due ${l.where}` : ""}`)}"><span aria-hidden="true">+</span> ${escapeHtml(l.text)} <small>${escapeHtml(l.where)}</small></button>`;
    })
    .join("");
  if (!focus && !chips) return "";
  return `<section class="rv-box" aria-labelledby="rv-h-focus">
      <h3 class="rv-h" id="rv-h-focus">Next week · focus</h3>
      ${focus}
      ${chips ? `<div class="rv-chips" role="group" aria-label="Suggestions: tap one to add it">${chips}</div><p class="rv-hint">Nothing is added until you tap it.</p>` : ""}
    </section>`;
}
function reviewNextWeekHtml(r) {
  const n = r.stats.nextWeek,
    ib = r.stats.inbox;
  const parts = [];
  if (n) {
    parts.push(
      reviewPlural(n.todosDue, "to-do") + " due",
      reviewPlural(n.billsDue, "bill") +
        (r.stats.bills && r.stats.bills.dueNextWeekTotal
          ? ` (${moneyShort(Math.round(r.stats.bills.dueNextWeekTotal))})`
          : ""),
      reviewPlural(n.workouts, "workout"),
      n.events == null ? "Calendar: not connected" : reviewPlural(n.events, "event"),
    );
    if (n.washDays.length) parts.push(`Wash ${n.washDays.map(reviewWeekday).join(", ")}`);
    if (n.busiestDay) parts.push(`Busiest ${reviewWeekday(n.busiestDay)}`);
  }
  const inbox = ib
    ? `<p class="rv-sub">Inbox (${reviewPlural(ib.days, "day")}): ${escapeHtml(reviewPlural(ib.awaitingReply, "person", "people"))} waiting on a reply · ${escapeHtml(reviewPlural(ib.billMismatches, "bill email"))} that didn't match Budget</p>`
    : "";
  if (!parts.length && !inbox) return "";
  return `<section class="rv-section" aria-labelledby="rv-h-next">
      <h3 class="rv-h" id="rv-h-next">Next week${n && n.start && n.end ? ` · ${escapeHtml(reviewRange(n.start, n.end))}` : ""}</h3>
      ${parts.length ? `<button type="button" class="rv-line rv-next" data-action="review-go" data-stat="nextWeek" aria-label="${escapeAttr(`Next week: ${parts.join(", ")}. Open To-Do`)}"><span class="rv-line-t">${escapeHtml(parts.join(" · "))}</span><span class="rv-cue" aria-hidden="true">›</span></button>` : ""}
      ${inbox}
    </section>`;
}
function reviewSheetHtml(r) {
  const list = loadReviews(),
    i = list.findIndex((x) => x.id === r.id);
  const older = list[i + 1],
    newer = list[i - 1];
  const nav = `<div class="rv-nav" role="group" aria-label="Past reviews">
      <button type="button" class="rv-step" data-action="review-step" data-dir="older"${older ? ` aria-label="Older: ${escapeAttr(reviewRange(older.weekStart, older.weekEnd))}"` : ' aria-label="No older review" disabled'}>‹</button>
      <span class="rv-pos">${i + 1} of ${list.length}</span>
      <button type="button" class="rv-step" data-action="review-step" data-dir="newer"${newer ? ` aria-label="Newer: ${escapeAttr(reviewRange(newer.weekStart, newer.weekEnd))}"` : ' aria-label="No newer review" disabled'}>›</button>
    </div>`;
  const notes = r.notes.length
    ? `<ul class="rv-notes">${r.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>`
    : "";
  return `<div class="modal-head rv-head">${nav}<button type="button" class="modal-x rv-x" data-action="review-close" aria-label="Close">&times;</button></div>
    <div class="jv-kicker">Week in review · ${escapeHtml(reviewRange(r.weekStart, r.weekEnd))}</div>
    <h2 class="rv-title" id="rv-title" tabindex="-1">${escapeHtml(r.headline)}</h2>
    ${reviewNumbersHtml(r)}
    ${reviewPointsHtml("Wins", "wins", r.wins)}
    ${reviewPointsHtml("Slipped", "slips", r.slips)}
    ${reviewFocusHtml(r)}
    ${reviewNextWeekHtml(r)}
    ${notes}
    <p class="rv-meta">${r.summaryBy === "fallback" ? "Assembled automatically from the numbers (Jarvis didn't finish)" : "Numbers counted by the app; wording by Jarvis"}</p>`;
}
function reviewSheetEl() {
  return document.getElementById("review-sheet");
}
function reviewIsOpenNow() {
  const el = reviewSheetEl();
  return !!el && el.classList.contains("open");
}
function renderReviewSheet() {
  const r = reviewById(reviewOpenId);
  const body = document.getElementById("review-body");
  if (!r || !body) return;
  body.innerHTML = reviewSheetHtml(r);
}
function openReview(id) {
  const r = reviewById(id),
    el = reviewSheetEl();
  if (!r || !el) return false;
  if (!reviewIsOpenNow()) reviewReturnFocus = document.activeElement;
  reviewOpenId = r.id;
  markReviewSeen(r);
  renderReviewSheet();
  el.classList.add("open");
  el.setAttribute("aria-hidden", "false");
  syncSheets();
  document.getElementById("review-body").scrollTop = 0;
  const t = document.getElementById("rv-title");
  if (t) t.focus({ preventScroll: true });
  renderConsole(); // the New pill goes
  renderHome(); // and so does Home's line
  return true;
}
// restore: put focus back where the review was opened (not when it closed to go somewhere else)
function closeReview(restore = true) {
  const el = reviewSheetEl();
  if (!el || !reviewIsOpenNow()) return;
  el.classList.remove("open");
  el.setAttribute("aria-hidden", "true");
  syncSheets();
  const back = reviewReturnFocus;
  reviewReturnFocus = null;
  if (!restore) return;
  let target = back && document.contains(back) ? back : null;
  // the card it came from was redrawn (its New pill went): use its new copy
  if (!target && back && back.getAttribute && back.getAttribute("data-action") === "review-open")
    target = document.querySelector('.tabpanel.active [data-action="review-open"]');
  if (target)
    try {
      target.focus({ preventScroll: true });
    } catch (e) {}
}
function reviewStep(dir) {
  const list = loadReviews(),
    i = list.findIndex((x) => x.id === reviewOpenId);
  const next = i < 0 ? null : list[dir === "older" ? i + 1 : i - 1];
  if (!next) return;
  reviewOpenId = next.id;
  markReviewSeen(next);
  renderReviewSheet();
  document.getElementById("review-body").scrollTop = 0;
  // keep the keyboard on the arrow while there's more that way, else the title
  const again = document.querySelector(`#review-body .rv-step[data-dir="${dir}"]:not([disabled])`);
  (again || document.getElementById("rv-title")).focus({ preventScroll: true });
  renderConsole();
  renderHome();
}
// Where a stat leads; goals open their own Jazz 3.0 card when one has the same name
function reviewGo(stat, index) {
  const st = Object.prototype.hasOwnProperty.call(REVIEW_STATS, stat) ? REVIEW_STATS[stat] : null;
  if (!st) return;
  let card = st.card || null;
  if (stat === "goals") {
    const r = reviewById(reviewOpenId),
      g = r && /^\d+$/.test(index || "") ? r.stats.goals[Number(index)] : null;
    const cat = g && plan3Cats().find((c) => String(c).trim().toLowerCase() === g.name.toLowerCase());
    if (cat) card = "p3-" + plan3Slug(cat);
  }
  closeReview(false);
  if (st.go) dashGo(st.go, card);
  else activateTab("home");
}
// A suggestion chip adds its to-do (with its due date) or Shopping item, only when tapped, with Undo
function reviewAddChip(i) {
  const r = reviewById(reviewOpenId),
    c = r && r.suggestions[i];
  if (!c) return;
  const key = `${r.id}|${i}`;
  if (reviewTapped.has(key) || reviewChipOnList(c)) {
    showToast("Already on your list");
    return;
  }
  const before = dataSnapshot();
  if (c.kind === "todo") {
    const t = {
      id: genId("todo"),
      text: c.text.slice(0, TODO_MAX_LEN),
      done: false,
      due: c.due,
      starred: false,
      subitems: [],
      completedAt: null,
    };
    const at = todoList.findIndex((x) => !x.done && todoGroup(x) === todoGroup(t));
    if (at >= 0) todoList.splice(at, 0, t);
    else todoList.push(t);
    saveContent("todo-content", todoList, { toast: false });
  } else {
    const w = { id: genId("want"), name: c.text.slice(0, TODO_MAX_LEN), meta: "", price: null, link: null };
    setWantCategory(w, "General");
    wantsList.push(w);
    saveContent("wants-content", wantsList, { toast: false });
  }
  const after = dataSnapshot();
  reviewTapped.add(key);
  renderHome();
  renderWants();
  renderReviewSheet();
  const chip = document.querySelector(`#review-body .rv-chip[data-index="${i}"]`);
  if (chip) chip.focus({ preventScroll: true });
  showUndoToast(c.kind === "todo" ? "Added to To-Do" : "Added to Shopping", () => {
    undoTo(before, after);
    reviewTapped.delete(key);
    if (reviewIsOpenNow()) renderReviewSheet();
  });
}
// ?tab=console&review=<id> (the Sunday push): open it now, or as soon as sync brings it in
function reviewDeepLink(id) {
  if (typeof id !== "string" || !REVIEW_ID.test(id)) return;
  activateTab("console");
  if (!openReview(id)) reviewPending = id;
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !reviewIsOpenNow()) return;
  if (document.getElementById("modal-backdrop").classList.contains("open")) return;
  e.preventDefault();
  closeReview();
});
