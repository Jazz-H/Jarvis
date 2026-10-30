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
const DASH_DETAILS = ["weather", "money", "skin", "jazz3", "shop"]; // tiles that open a detail
const DASH_SHOP_MAX = 5;
let dashOpenKey = null; // the tile whose detail is open (not saved: the tab opens clean)
const dashDetailId = (key) => (key === "weather" ? "jarvis-weather" : "jv-detail-" + key);

// Tap a tile: open or close its detail. To-Do jumps to the Planner; News to its card.
function dashDrill(key) {
  if (key === "todo") {
    homeDate = null; // the Planner shows today
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
  const tile = document.querySelector(`#panel-home .jv-tile[data-go="${key}"]`);
  if (tile && dashOpenKey) tile.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    {
      go: "todo",
      label: "To-Do",
      value: `${d.todo.left} left`,
      sub: [d.todo.overdue ? `${d.todo.overdue} overdue` : "", `${progress.done}/${progress.total} done today`]
        .filter(Boolean)
        .join(" · "),
      pct: dashPct(progress.done, progress.total),
      tone: d.todo.overdue ? "warn" : "",
      detail: false,
    },
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
      sub: d.skin.r.wash ? "Wash day tonight" : d.skin.streak ? `${d.skin.streak}-day streak` : "Today's routine",
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
  return `<div class="jv-wrap">
      ${dashGreetingHtml(b)}
      ${jarvisHeroHtml(b)}
      ${dashTilesHtml(b, homeDayTotals(addDaysIso(0)), d)}
      ${b ? jarvisNewsCard(b.news) : ""}
    </div>`;
}
