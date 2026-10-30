// dashboard.js - The Jarvis tab: status, Jarvis's briefing, and a tile per section that drills down
// into its details, then into the section's own tab.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- JARVIS DASHBOARD ----------
// Each fact appears once. The six tiles are the overview; tapping one opens its detail right under
// it (one at a time), and the detail links on to its tab. To-Do has no detail of its own: its tile
// jumps to the Planner below, which is today's list. Everything except Weather and News is built
// from this device's own data, so it works offline and without Jarvis set up. Rows tick off in
// place with the same data-action handlers as their own tabs.
// Detail layouts (chosen per card): Weather summary + hour by hour; Money due-this-week list +
// pay-period bar; Skin & Hair AM/PM checklists with progress; Jazz 3.0 goal bars; Shopping needs list.
const JARVIS_OWNER = "Jazz";
const DASH_TABS = { todo: "todo", money: "budget", skin: "skin", jazz3: "jazz3", shop: "wants" };
// tiles (and timeline rows) that open a detail; calendar and deliveries open under the timeline
const DASH_DETAILS = ["weather", "inbox", "money", "skin", "jazz3", "shop", "calendar", "deliveries"];
const DASH_TIMELINE_DETAILS = ["calendar", "deliveries"];
const DASH_SHOP_MAX = 5;
let dashOpenKey = null; // the tile whose detail is open (not saved: the tab opens clean)
const dashDetailId = (key) => (key === "weather" ? "jarvis-weather" : "jv-detail-" + key);

// Tap a tile: open or close its detail. To-Do (and the evening Tomorrow panel) jump to the Planner; News to its card.
function dashDrill(key) {
  if (key === "todo" || key === "tomorrow") {
    homeDate = key === "tomorrow" ? addDaysIso(1) : null; // the Planner shows that day
    renderHome();
    const el = document.querySelector("#panel-home .jv-planner-label");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (key === "news") {
    openPinned.add("jarvis-news");
    renderHome();
    const el = document.getElementById("jarvis-news");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (!DASH_DETAILS.includes(key)) return;
  dashOpenKey = dashOpenKey === key ? null : key;
  renderHome();
  const target =
    document.querySelector(`#panel-home .jv-tile[data-go="${key}"]`) || document.getElementById(dashDetailId(key));
  if (target && dashOpenKey) target.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
// Go to a section's tab; Jazz 3.0 can also open and scroll to one of its cards
const DASH_J3_CARD = /^(weight-card|p3-[a-z0-9-]+)$/;
function dashGo(where, card) {
  if (!DASH_TABS[where]) return;
  const j3Card = where === "jazz3" && typeof card === "string" && DASH_J3_CARD.test(card) ? card : "";
  if (j3Card) openPinned.add(j3Card);
  activateTab(DASH_TABS[where]);
  if (j3Card) {
    renderFitness();
    const el = document.getElementById(j3Card);
    if (el) el.scrollIntoView({ block: "start" });
  }
}
const dashSum = (list, f = (x) => Number(x.amount) || 0) => Math.round(list.reduce((s, x) => s + f(x), 0) * 100) / 100;
const dashPct = (n, d) => (d > 0 ? Math.max(0, Math.min(100, Math.round((n / d) * 100))) : 0);
const dashOpen = (where, label) => `<button class="jv-open" data-action="jv-go" data-go="${where}">${label} →</button>`;

// Status only: the header already shows the date, and the Weather tile the weather
function dashGreetingHtml(b) {
  const h = new Date().getHours();
  const hello = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const synced = !!localStorage.getItem("sync-token");
  const state = b ? "Online" : synced ? "Standing by" : "Local mode";
  const when = !b
    ? ""
    : b.date === addDaysIso(0)
      ? `Briefed ${jvTime(b.generatedAt)}`
      : `Last briefed ${noonOf(b.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  return `<div class="jv-greet">
      <div class="jv-status"><span class="jv-status-name"><span class="jv-dot"></span>${state}</span><span>${escapeHtml(when)}</span></div>
      <h2 class="jv-hello">${hello}, ${JARVIS_OWNER}.</h2>
    </div>`;
}

// ---- section data (each feeds its tile and its detail) ----
function dashTodoData() {
  const day = homeDayItems(addDaysIso(0));
  const rows = [...day.overdue, ...day.open];
  return { left: rows.length, overdue: day.overdue.length };
}
// From the latest payday up to the next one: what's paid, what's still due, what's left
function dashPayPeriod(today) {
  if (!budget.income.length) return null;
  const key = today.slice(0, 7),
    prevKey = addMonthsIso(key + "-01", -1).slice(0, 7);
  const checks = [...incomeInMonth(prevKey), ...incomeInMonth(key)].filter((p) => p.date <= today);
  const end = nextPayday(today);
  if (!checks.length || !end) return null;
  const start = checks[checks.length - 1].date;
  const pay = dashSum(checks.filter((p) => p.date === start));
  const rows = billRowsBetween(start, end);
  const paid = dashSum(rows.filter((r) => r.payment)),
    due = dashSum(rows.filter((r) => !r.payment));
  const days = Math.round((noonOf(end) - noonOf(start)) / 864e5),
    dayN = Math.round((noonOf(today) - noonOf(start)) / 864e5) + 1;
  return { start, end, pay, paid, due, left: Math.round((pay - paid - due) * 100) / 100, days, dayN };
}
function dashMoneyData() {
  const weekEnd = addDaysIso(7);
  const dueSoon = bills
    .filter((b) => !b.done && b.due && b.due <= weekEnd)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return { dueSoon, total: dashSum(dueSoon, billShare), period: dashPayPeriod(addDaysIso(0)) };
}
function dashSkinData() {
  const r = routineForDate(new Date()),
    c = todayChecks();
  return {
    r,
    c,
    amDone: r.am.filter((s) => c.am.includes(s.id)).length,
    pmDone: r.pm.filter((s) => c.pm.includes(s.id)).length,
    streak: routineStreak(),
  };
}
function dashJazz3Data() {
  const sections = plan3Cats().map((cat) => {
    const list = plan3.filter((x) => x.cat === cat);
    return { cat, done: list.filter((x) => x.done).length, total: list.length };
  });
  return { ws: weightStatus(), sections, workouts: workoutsOn(addDaysIso(0)) };
}
function dashShopData() {
  const pending = wantsList.filter((w) => !wantsState[w.id] && !w.later).sort(wantsOrder);
  const needs = pending.filter((w) => wantKind(w) === "need");
  return { needs, wants: pending.length - needs.length, est: dashSum(pending, (w) => Number(w.price) || 0) };
}

// ---- details (shown under their tile) ----
function dashMoneyDetail(d) {
  const list = d.dueSoon.length
    ? `<div class="jv-rows">${d.dueSoon.map((b) => homeBillHtml(b)).join("")}</div>`
    : `<div class="empty">No bills due in the next 7 days.</div>`;
  const p = d.period;
  const short = (iso) => noonOf(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const scale = p ? Math.max(p.pay, p.paid + p.due) : 0;
  const period = p
    ? `<button class="jv-period" data-action="jv-go" data-go="money">
        <span class="jv-period-head"><b>Pay period</b><span>${short(p.start)} – ${short(isoDate(new Date(noonOf(p.end).getTime() - 864e5)))} · day ${p.dayN} of ${p.days}</span></span>
        <span class="jv-period-bar" aria-hidden="true"><span class="paid" style="width:${dashPct(p.paid, scale)}%"></span><span class="due" style="width:${dashPct(p.due, scale)}%"></span></span>
        <span class="jv-period-keys"><span><i class="paid"></i>Paid ${moneyShort(p.paid)}</span><span><i class="due"></i>Due ${moneyShort(p.due)}</span>${p.pay ? `<span class="${p.left < 0 ? "neg" : ""}">Left ${p.left < 0 ? "−" : ""}${moneyShort(Math.abs(p.left))}</span>` : ""}</span>
      </button>`
    : "";
  return `<div class="jv-sub-label">Due this week · tap a bill to edit</div>${list}${period}${dashOpen("money", "Open Budget")}`;
}
function dashSkinDetail(d) {
  const { r, c } = d;
  // each column's header is its progress (count + a bar per step) and opens Skin & Hair
  const col = (band, label, steps, done) =>
    `<div class="jv-skin-col">
      <button class="jv-skin-head" data-action="jv-go" data-go="skin"><span class="jv-mini ${band}">${label} ${done}/${steps.length}</span>${
        steps.length
          ? `<span class="jv-segs" style="--n:${steps.length}">${steps.map((s, i) => `<span class="${i < done ? "on" : ""}"></span>`).join("")}</span>`
          : ""
      }</button>
      ${
        steps
          .map((s) => {
            const on = c[band].includes(s.id);
            return `<button class="jv-step ${on ? "done" : ""}" role="checkbox" aria-checked="${on}" data-action="routine-step" data-band="${band}" data-step-id="${escapeAttr(s.id)}"><span class="box">${BOX_CHECK_SVG}</span><span>${escapeHtml(s.label)}</span></button>`;
          })
          .join("") || '<div class="empty">No steps today.</div>'
      }
    </div>`;
  return (
    `<div class="jv-skin-cols">${col("am", "AM", r.am, d.amDone)}${col("pm", r.wash ? "PM · wash" : "PM", r.pm, d.pmDone)}</div>` +
    (d.streak ? `<div class="jv-skin-meta">${d.streak}-day streak</div>` : "") +
    dashOpen("skin", "Open Skin &amp; Hair")
  );
}
function dashJazz3Detail(d) {
  // each bar opens its own card on the Jazz 3.0 tab
  const bar = (name, label, pct, tone, card) =>
    `<button class="jv-goal" data-action="jv-go" data-go="jazz3" data-card="${card}"><span class="jv-goal-head"><b>${escapeHtml(name)}</b><span>${escapeHtml(label)}</span></span><span class="jv-goal-bar ${tone}"><span style="width:${pct}%"></span></span></button>`;
  const ws = d.ws;
  const bars =
    (ws.pct != null
      ? bar("Weight", `${ws.pct}%${ws.toGo != null ? ` · ${ws.toGo} lb to go` : ""}`, ws.pct, "", "weight-card")
      : "") +
    d.sections
      .map((s, i) =>
        bar(
          s.cat,
          `${s.done} / ${s.total}`,
          dashPct(s.done, s.total),
          i % 2 ? "warn" : "pink",
          "p3-" + plan3Slug(s.cat),
        ),
      )
      .join("");
  const today = d.workouts.length
    ? `<div class="jv-sub-label">Today</div><div class="jv-chips">${d.workouts
        .map(
          (w) =>
            `<button class="jv-chip" data-action="jv-go" data-go="jazz3" data-card="weight-card">${escapeHtml(w.name)}${w.time ? ` · ${escapeHtml(w.time)}` : ""}</button>`,
        )
        .join("")}</div>`
    : "";
  return (
    (bars ? `<div class="jv-goals">${bars}</div>` : `<div class="empty">No goals yet.</div>`) +
    today +
    dashOpen("jazz3", "Open Jazz 3.0")
  );
}
function dashShopDetail(d, b) {
  const needs = d.needs.slice(0, DASH_SHOP_MAX);
  // a briefing line that names one of your needs ("rain jacket" on a rainy day)
  const match =
    b &&
    b.summary.find((s) =>
      d.needs.some((w) => w.name.length > 2 && s.text.toLowerCase().includes(w.name.toLowerCase())),
    );
  const list = needs.length
    ? `<div class="jv-rows">${needs
        .map(
          (w) => `<div class="jv-shop-row">
            <button class="todo-check" role="checkbox" aria-checked="false" aria-label="Bought: ${escapeAttr(w.name)}" data-action="want-toggle" data-want-id="${escapeAttr(w.id)}"><span class="box">${BOX_CHECK_SVG}</span></button>
            <button class="jv-shop-name" data-action="want-edit" data-want-id="${escapeAttr(w.id)}">${escapeHtml(w.name)}${w.price != null ? `<span class="jv-shop-price">${w.estimated ? "~" : ""}${moneyShort(w.price)}</span>` : ""}</button>
          </div>`,
        )
        .join("")}</div>`
    : `<div class="empty">No needs on the list.</div>`;
  const more = d.needs.length - needs.length;
  return (
    (match ? `<div class="jv-shop-match">Jarvis: ${escapeHtml(match.text)}</div>` : "") +
    `<div class="jv-sub-label">Needs · tap one to edit</div>${list}` +
    `<div class="jv-skin-meta">${more > 0 ? `${more} more needs · ` : ""}${d.wants} want${d.wants === 1 ? "" : "s"}${d.est ? ` · est. ${moneyShort(Math.round(d.est))} in all` : ""}</div>` +
    dashOpen("shop", "Open Shopping")
  );
}

// ---- tiles + the open detail ----
function dashTilesHtml(b, progress, d) {
  const wc = b && b.weather;
  const w = wc && wc.status === "ok" ? wc.data : null;
  const rainWin = w ? jvRainWindow(w.hourlyRain) : "";
  const nextBill = d.money.dueSoon[0];
  const skinAm = d.skin.amDone < d.skin.r.am.length;
  const j3 = d.jazz3;
  const j3Done = dashSum(j3.sections, (s) => s.done),
    j3Total = dashSum(j3.sections, (s) => s.total);
  const tiles = [
    {
      go: "weather",
      label: "Weather",
      value: w ? `${w.highF}° / ${w.lowF}°` : "—",
      sub: w
        ? `${w.currentF != null ? `Now ${w.currentF}° · ` : ""}${w.rainChanceMax}% rain${rainWin ? ` ${rainWin}` : ""}`
        : wc
          ? "Unavailable"
          : "No forecast yet",
      pct: w ? w.rainChanceMax : 0,
      tone: "",
      detail: !!wc,
    },
    dashInboxTile(b),
    {
      go: "money",
      label: "Money",
      value: moneyShort(d.money.total),
      sub: nextBill
        ? `${nextBill.name} due ${noonOf(nextBill.due).toLocaleDateString("en-US", { weekday: "short" })}`
        : "No bills this week",
      pct: d.money.period ? dashPct(d.money.period.paid, d.money.period.paid + d.money.period.due) : 0,
      tone: "",
      detail: true,
    },
    {
      go: "skin",
      label: "Skin & Hair",
      value: skinAm ? `AM ${d.skin.amDone}/${d.skin.r.am.length}` : `PM ${d.skin.pmDone}/${d.skin.r.pm.length}`,
      // skin weather on the tile (layout 2): a high-UV day says SPF
      sub: [
        d.skin.r.wash ? "Wash day tonight" : d.skin.streak ? `${d.skin.streak}-day streak` : "Today's routine",
        w && w.uvMax != null && w.uvMax >= 6 ? `UV ${w.uvMax} · SPF` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      pct: skinAm ? dashPct(d.skin.amDone, d.skin.r.am.length) : dashPct(d.skin.pmDone, d.skin.r.pm.length),
      tone: "pink",
      detail: true,
    },
    {
      go: "jazz3",
      label: "Jazz 3.0",
      value: j3.ws.pct != null ? `${j3.ws.pct}%` : `${j3Done}/${j3Total}`,
      sub: j3.ws.pct != null ? "to weight goal" : "goal items done",
      pct: j3.ws.pct != null ? j3.ws.pct : dashPct(j3Done, j3Total),
      tone: "accent",
      detail: true,
    },
    {
      go: "shop",
      label: "Shopping",
      value: `${d.shop.needs.length} need${d.shop.needs.length === 1 ? "" : "s"}`,
      sub: d.shop.needs[0] ? d.shop.needs[0].name : `${d.shop.wants} want${d.shop.wants === 1 ? "" : "s"}`,
      pct: 0,
      tone: "",
      detail: true,
    },
  ];
  const detailOf = (key) =>
    key === "weather"
      ? jarvisWeatherDetail(wc)
      : key === "inbox"
        ? dashInboxDetail(b && b.inbox)
        : key === "money"
          ? dashMoneyDetail(d.money)
          : key === "skin"
            ? dashSkinDetail(d.skin)
            : key === "jazz3"
              ? dashJazz3Detail(d.jazz3)
              : dashShopDetail(d.shop, b);
  const html = tiles
    .map((t) => {
      const open = t.detail && dashOpenKey === t.go;
      const aria = t.detail
        ? `aria-expanded="${open}" aria-controls="${dashDetailId(t.go)}"`
        : `aria-label="${t.label}: ${escapeAttr(t.value)}, go to the Planner"`;
      const tile = `<button class="jv-tile ${t.tone}${open ? " open" : ""}" data-action="jv-drill" data-go="${t.go}" ${aria}>
          <span class="jv-tile-label">${t.label}<span class="jv-tile-cue" aria-hidden="true">${t.detail ? CHEVRON_DOWN : "↓"}</span></span>
          <span class="jv-tile-value">${escapeHtml(t.value)}</span>
          <span class="jv-tile-sub">${escapeHtml(t.sub)}</span>
          <span class="jv-tile-bar"><span style="width:${t.pct}%"></span></span>
        </button>`;
      // the open detail follows its tile; grid-auto-flow: dense backfills the tile beside it
      return open
        ? tile +
            `<section class="jv-detail" id="${dashDetailId(t.go)}" aria-label="${t.label} details">${detailOf(t.go)}</section>`
        : tile;
    })
    .join("");
  return `<div class="jv-label"><span>Systems</span><i></i><span>Tap for details</span></div>
    <div class="jv-tiles">${html}</div>`;
}

function dashboardHtml() {
  const b = loadBriefing();
  if (dashOpenKey === "weather" && !(b && b.weather)) dashOpenKey = null;
  const d = {
    todo: dashTodoData(),
    money: dashMoneyData(),
    skin: dashSkinData(),
    jazz3: dashJazz3Data(),
    shop: dashShopData(),
  };
  updateAppBadge(dashBadgeCount(d.todo));
  return `<div class="jv-wrap">
      ${dashGreetingHtml(b)}
      ${dashQuickHtml()}
      ${dashTomorrowHtml(b)}
      ${jarvisHeroHtml(b)}
      ${dashTimelineHtml(b, d)}
      ${dashTilesHtml(b, homeDayTotals(addDaysIso(0)), d)}
      ${b ? jarvisNewsCard(b.news) : ""}
    </div>`;
}

// ---- quick add: one line on Home, "call mom tomorrow" style (same parsing as the + sheet) ----
let dashQuickText = ""; // survives re-renders while typing
function dashQuickHtml() {
  return `<div class="jv-quick">
      <input id="jv-quick" class="jv-quick-input" type="text" autocomplete="off" enterkeyhint="done" maxlength="${TODO_MAX_LEN}"
        aria-label="Quick add a to-do" placeholder="Add: “call mom tomorrow”"
        data-keydown-action="jv-quick-key" data-input-action="jv-quick-input" value="${escapeAttr(dashQuickText)}" />
      <button class="jv-quick-add" data-action="jv-quick-add" aria-label="Add to-do">+</button>
    </div>`;
}
function dashQuickAdd() {
  const el = document.getElementById("jv-quick");
  const raw = String((el && el.value) || dashQuickText)
    .trim()
    .slice(0, TODO_MAX_LEN);
  if (!raw) {
    if (el) el.focus();
    return;
  }
  const { text, due } = parseQuickAdd(raw);
  const t = { id: genId("todo"), text, done: false, due, starred: false, subitems: [], completedAt: null };
  // new items go to the top of their group, like the + sheet
  const at = todoList.findIndex((x) => !x.done && todoGroup(x) === todoGroup(t));
  if (at >= 0) todoList.splice(at, 0, t);
  else todoList.push(t);
  dashQuickText = "";
  saveContent("todo-content", todoList, { toast: false });
  renderHome();
  showToast(due ? `Added for ${dueLabel(due)}` : "Added");
  const again = document.getElementById("jv-quick");
  if (again) again.focus(); // ready for the next one
}

// ---- evening: tomorrow at a glance (from 5 PM) ----
const DASH_EVENING_HOUR = 17;
function dashTomorrowHtml(b, now = new Date()) {
  if (now.getHours() < DASH_EVENING_HOUR) return "";
  const iso = addDaysIso(1);
  const day = homeDayItems(iso);
  const todos = [...day.open, ...(day.repeats || [])];
  const dayBills = billsOnDay(iso);
  const billList = [...dayBills.open, ...dayBills.projected];
  const workouts = workoutsOn(iso);
  const w = b && b.weather && b.weather.status === "ok" ? b.weather.data.tomorrow : null;
  const lines = [];
  if (w && w.date === iso)
    lines.push(
      `<li><span class="jv-src jv-src-weather">Weather</span><span>${escapeHtml(`${w.highF}° / ${w.lowF}° · ${w.conditions}${w.rainChanceMax ? ` · ${w.rainChanceMax}% rain` : ""}`)}</span></li>`,
    );
  if (todos.length)
    lines.push(
      `<li><span class="jv-src jv-src-jazz">To-Do</span><span>${todos.length} · ${escapeHtml(
        todos
          .slice(0, 3)
          .map((t) => t.text)
          .join(", "),
      )}${todos.length > 3 ? "…" : ""}</span></li>`,
    );
  if (billList.length)
    lines.push(
      `<li><span class="jv-src jv-src-news">Bills</span><span>${escapeHtml(billList.map((x) => `${x.name} ${moneyShort(billShare(x))}${x.autopay ? " (autopay)" : ""}`).join(", "))}</span></li>`,
    );
  if (day.wash) lines.push(`<li><span class="jv-src jv-src-jazz">Hair</span><span>Wash day</span></li>`);
  if (workouts.length || weighInDue(iso))
    lines.push(
      `<li><span class="jv-src jv-src-jarvis">Fitness</span><span>${escapeHtml(
        [...workouts.map((x) => x.name + (x.time ? ` · ${x.time}` : "")), weighInDue(iso) ? "Weigh in" : ""]
          .filter(Boolean)
          .join(", "),
      )}</span></li>`,
    );
  const label = noonOf(iso).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return `<section class="card jv-card jv-tomorrow" aria-label="Tomorrow">
      <div class="jv-kicker">Tomorrow · ${escapeHtml(label)}</div>
      ${lines.length ? `<ul class="jv-summary">${lines.join("")}</ul>` : `<p class="jv-empty-line">Nothing planned yet.</p>`}
      <button class="jv-open" data-action="jv-drill" data-go="tomorrow">Plan tomorrow →</button>
    </section>`;
}

// ---- the app icon's badge: what still needs you today (installed app only) ----
function dashBadgeCount(todo) {
  const today = addDaysIso(0);
  const billsDue = bills.filter((b) => !b.done && b.due && b.due <= today).length;
  return todo.left + billsDue;
}
let dashBadgeShown = -1;
function updateAppBadge(n) {
  if (n === dashBadgeShown || !("setAppBadge" in navigator)) return;
  dashBadgeShown = n;
  (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

// ---- Phase 2: Your day timeline, Calendar, Deliveries and Inbox ----
// "9:30a", "3p": compact times for the timeline
function dashTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const h12 = h % 12 || 12;
  return `${h12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "a" : "p"}`;
}
const dashMins = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const dashToday = (c) => (c && c.status === "ok" ? c.data : null);
const DASH_SETUP = {
  calendar:
    "Connect your calendar: in Google Calendar settings, copy the calendar's secret address in iCal format and add it as the GOOGLE_CALENDAR_ICS_URL secret (docs/jarvis/SETUP.md).",
  google:
    "Connect Gmail: run the one-time Google sign-in (docs/jarvis/SETUP.md → Google), then add the three GOOGLE_ secrets.",
};

// Today's calendar events, rain, deliveries, to-dos, bills and wash day, in time order
function dashDayRows(b, d) {
  const today = addDaysIso(0),
    nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const rows = [];
  const cal = dashToday(b && b.calendar);
  if (cal && cal.date === today) {
    const overlapping = new Set(cal.overlaps.flatMap((o) => [o.a, o.b]));
    cal.events
      .filter((e) => e.day === "today")
      .forEach((e) => {
        const past = !e.allDay && e.end && dashMins(e.end) <= nowMin;
        rows.push({
          sort: e.allDay ? -1 : dashMins(e.start),
          time: e.allDay ? "All day" : dashTime(e.start),
          title: e.title,
          sub: [
            e.end && !e.allDay ? `until ${dashTime(e.end)}` : "",
            e.location,
            overlapping.has(e.title) ? "overlaps" : "",
          ]
            .filter(Boolean)
            .join(" · "),
          tone: overlapping.has(e.title) ? "warn" : past ? "past" : "accent",
          go: "calendar",
        });
      });
  }
  const w = dashToday(b && b.weather);
  if (w && b.date === today) {
    const wet = w.hourlyRain.filter((h) => h.chance >= 50);
    if (wet.length)
      rows.push({
        sort: wet[0].hour * 60,
        time: jvHourLabel(wet[0].hour),
        title: "Rain likely",
        sub: `${w.rainChanceMax}% · until ${jvHourLabel((wet[wet.length - 1].hour + 1) % 24)}`,
        tone: "gold",
        go: "weather",
      });
  }
  const del = dashToday(b && b.deliveries);
  if (del)
    del.packages
      .filter((p) => p.status !== "delivered" && (p.status === "out" || p.eta === today))
      .forEach((p) =>
        rows.push({
          sort: 24 * 60 + 1,
          time: p.etaText || "Today",
          title: `${p.item} arrives`,
          sub: p.shoppingMatch ? "On your Shopping list" : "Amazon",
          tone: "pink",
          go: "deliveries",
        }),
      );
  if (d.todo.left)
    rows.push({
      sort: 24 * 60 + 2,
      time: "Today",
      title: `${d.todo.left} to-do${d.todo.left === 1 ? "" : "s"} left`,
      sub: d.todo.overdue ? `${d.todo.overdue} overdue` : "Open the Planner",
      tone: d.todo.overdue ? "warn" : "",
      go: "todo",
    });
  bills
    .filter((x) => !x.done && x.due && x.due <= today)
    .slice(0, 3)
    .forEach((x) =>
      rows.push({
        sort: 24 * 60 + 3,
        time: x.due < today ? "Overdue" : "Today",
        title: `Pay ${x.name}`,
        sub: `${moneyShort(billShare(x))}${x.autopay ? " · autopay" : ""}`,
        tone: x.due < today ? "warn" : "",
        go: "money",
      }),
    );
  if (d.skin.r.wash)
    rows.push({ sort: 24 * 60 + 10, time: "Tonight", title: "Wash day", sub: "Skin & Hair", tone: "pink", go: "skin" });
  return rows.sort((a, c) => a.sort - c.sort);
}

function dashTimelineHtml(b, d) {
  const rows = dashDayRows(b, d);
  const calConnected = !!(b && b.calendar);
  const list = rows.length
    ? rows
        .map(
          (r, i) => `<button class="jv-day-row ${r.tone}" data-action="jv-drill" data-go="${r.go}">
          <span class="jv-day-time">${escapeHtml(r.time)}</span>
          <span class="jv-day-dot${i === 0 ? " first" : ""}${i === rows.length - 1 ? " last" : ""}" aria-hidden="true"><i></i></span>
          <span class="jv-day-text"><b>${escapeHtml(r.title)}</b>${r.sub ? `<span>${escapeHtml(r.sub)}</span>` : ""}</span>
        </button>`,
        )
        .join("")
    : `<div class="empty">Nothing scheduled today.</div>`;
  const connect = calConnected
    ? ""
    : `<button class="jv-day-connect" data-action="jv-drill" data-go="calendar">+ Connect your calendar</button>`;
  const openKey = DASH_TIMELINE_DETAILS.includes(dashOpenKey) ? dashOpenKey : null;
  const detail = openKey
    ? `<section class="jv-detail" id="${dashDetailId(openKey)}" aria-label="${openKey === "calendar" ? "Calendar" : "Deliveries"} details">${
        openKey === "calendar" ? dashCalendarDetail(b && b.calendar) : dashDeliveriesDetail(b && b.deliveries)
      }</section>`
    : "";
  const pkgs = dashToday(b && b.deliveries);
  const chips = `<span class="jv-day-chips">${
    calConnected
      ? `<button class="jv-chip-sm${openKey === "calendar" ? " on" : ""}" data-action="jv-drill" data-go="calendar" aria-expanded="${openKey === "calendar"}">Calendar</button>`
      : ""
  }${
    b && b.deliveries
      ? `<button class="jv-chip-sm${openKey === "deliveries" ? " on" : ""}" data-action="jv-drill" data-go="deliveries" aria-expanded="${openKey === "deliveries"}">Deliveries${pkgs && pkgs.packages.length ? ` · ${pkgs.packages.length}` : ""}</button>`
      : ""
  }</span>`;
  return `<div class="jv-label"><span>Your day</span><i></i>${chips}</div>
    <section class="card jv-day" aria-label="Your day">${list}${connect}</section>${detail}`;
}

// Calendar detail (layout 1): today and tomorrow as an agenda list
function dashCalendarDetail(c) {
  if (!c) return `<p class="jv-line">${escapeHtml(DASH_SETUP.calendar)}</p>`;
  if (c.status !== "ok") return jvErrorBody(c);
  const cal = c.data;
  const overlapping = new Set(cal.overlaps.flatMap((o) => [o.a, o.b]));
  const day = (which, label) => {
    const evs = cal.events.filter((e) => e.day === which);
    return `<div class="jv-sub-label">${label}</div>${
      evs.length
        ? `<div class="jv-agenda">${evs
            .map(
              (e) => `<div class="jv-agenda-row${overlapping.has(e.title) && which === "today" ? " warn" : ""}">
            <span class="jv-agenda-time">${e.allDay ? "All day" : `${dashTime(e.start)}${e.end ? `–${dashTime(e.end)}` : ""}`}</span>
            <span class="jv-agenda-what"><b>${escapeHtml(e.title)}</b>${e.location ? `<span>${escapeHtml(e.location)}</span>` : ""}</span>
            ${overlapping.has(e.title) && which === "today" ? '<span class="jv-agenda-flag">overlaps</span>' : ""}
          </div>`,
            )
            .join("")}</div>`
        : `<div class="empty">Nothing on the calendar.</div>`
    }`;
  };
  return `${cal.summary ? `<p class="jv-lede">${escapeHtml(cal.summary)}</p>` : ""}${day("today", "Today")}${day("tomorrow", "Tomorrow")}${jvMeta(c)}`;
}

// Deliveries detail (layouts 1 + 2): arriving today with Mark bought, then each package's progress
const DASH_PKG_STEPS = ["ordered", "shipped", "out", "delivered"];
const DASH_PKG_LABEL = { ordered: "Ordered", shipped: "Shipped", out: "Out for delivery", delivered: "Delivered" };
function dashDeliveriesDetail(c) {
  if (!c) return `<p class="jv-line">${escapeHtml(DASH_SETUP.google)}</p>`;
  if (c.status !== "ok") return jvErrorBody(c);
  const today = addDaysIso(0);
  const pkgs = c.data.packages;
  if (!pkgs.length) return `<div class="empty">No Amazon orders on the way.</div>${jvMeta(c)}`;
  const want = (name) => name && wantsList.find((w) => !wantsState[w.id] && w.name === name);
  const arrivingToday = (p) => p.status !== "delivered" && (p.status === "out" || p.eta === today);
  // one row per package: arriving-today ones first, with Mark bought when they're on the Shopping list
  const row = (p) => {
    const at = DASH_PKG_STEPS.indexOf(p.status);
    const w = arrivingToday(p) ? want(p.shoppingMatch) : null;
    const eta =
      p.status === "delivered"
        ? "Delivered"
        : p.eta
          ? `${p.eta === today ? "Today" : noonOf(p.eta).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}${p.etaText ? ` · ${p.etaText}` : ""}`
          : DASH_PKG_LABEL[p.status];
    return `<div class="jv-pkg">
        <div class="jv-pkg-head"><span class="jv-pkg-what"><b>${escapeHtml(p.item)}</b><span>${escapeHtml(eta)}${p.shoppingMatch ? " · on your Shopping list" : ""}</span></span>${
          w
            ? `<button class="jv-chip-sm on" data-action="want-toggle" data-want-id="${escapeAttr(w.id)}">Mark bought</button>`
            : ""
        }</div>
        <div class="jv-pkg-steps" aria-label="${escapeAttr(DASH_PKG_LABEL[p.status])}">${DASH_PKG_STEPS.map(
          (s, i) =>
            `<span class="${i <= at ? "on" : ""}"><i></i>${["Ordered", "Shipped", "Out", "Delivered"][i]}</span>`,
        ).join("")}</div>
      </div>`;
  };
  const today_ = pkgs.filter(arrivingToday),
    later = pkgs.filter((p) => !arrivingToday(p));
  return (
    (today_.length ? `<div class="jv-sub-label">Arriving today</div>${today_.map(row).join("")}` : "") +
    (later.length ? `<div class="jv-sub-label">On the way</div>${later.map(row).join("")}` : "") +
    jvMeta(c)
  );
}

// Inbox tile and detail (layout 3): unread count, then urgent, replies and bills (checked against Budget)
function dashInboxTile(b) {
  const c = b && b.inbox;
  const x = dashToday(c);
  const differs = x ? x.bills.filter((y) => y.status === "differs").length : 0;
  return {
    go: "inbox",
    label: "Inbox",
    value: x ? `${x.unread} unread` : "—",
    sub: x
      ? [
          x.urgent.length ? `${x.urgent.length} urgent` : "",
          x.needsReply.length ? `${x.needsReply.length} to reply` : "",
          differs
            ? `${differs} bill ≠ Budget`
            : x.bills.length
              ? `${x.bills.length} bill${x.bills.length === 1 ? "" : "s"}`
              : "",
        ]
          .filter(Boolean)
          .join(" · ") || "Nothing needs you"
      : c
        ? "Unavailable"
        : "Not connected",
    pct: 0,
    tone: x && (x.urgent.length || differs) ? "warn" : "",
    detail: true,
  };
}
function dashInboxDetail(c) {
  if (!c) return `<p class="jv-line">${escapeHtml(DASH_SETUP.google)}</p>`;
  if (c.status !== "ok") return jvErrorBody(c);
  const x = c.data;
  const row = (tag, tone, a, bText, extra = "") =>
    `<div class="jv-mail-row"><span class="jv-mini ${tone}">${tag}</span><span class="jv-mail-text"><b>${escapeHtml(a)}</b>${bText ? `<span>${escapeHtml(bText)}</span>` : ""}</span>${extra}</div>`;
  const bill = (y) => {
    const amt = y.amount != null ? moneyShort(y.amount) : "amount not shown";
    const due = y.due ? ` · due ${noonOf(y.due).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "";
    const flag =
      y.status === "differs"
        ? `<button class="jv-chip-sm warn" data-action="jv-go" data-go="money">Budget ${moneyShort(y.budgetAmount)}</button>`
        : y.status === "matches"
          ? '<span class="jv-mail-ok">✓ Budget</span>'
          : y.status === "not-in-budget"
            ? '<span class="jv-mail-note">Not in Budget</span>'
            : "";
    return row("Bill", "gold", y.payee, amt + due, flag);
  };
  const rows =
    x.urgent.map((y) => row("Urgent", "warn", y.from, y.summary)).join("") +
    x.needsReply.map((y) => row("Reply", "am", y.from, y.summary)).join("") +
    x.bills.map(bill).join("");
  // the unread count is on the tile already
  return `${
    rows ? `<div class="jv-mail">${rows}</div>` : `<div class="empty">Nothing urgent, nobody waiting, no bills.</div>`
  }${jvMeta(c)}`;
}
