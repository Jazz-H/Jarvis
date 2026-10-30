// dashboard.js - The Jarvis tab: greeting, Jarvis's briefing, a tile per section, and a live card
// per section that feeds from the rest of the app.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- JARVIS DASHBOARD ----------
// Everything here except the Weather and News cards is built from this device's own data, so it
// works offline and without Jarvis set up. Rows tick off in place with the same data-action
// handlers as their own tabs (to-dos, bills, routine steps, Jazz 3.0 items, shopping), and every
// tile and card links to its tab. Layouts (chosen per card): To-Do checklist; Money due-this-week
// list + pay-period bar; Skin & Hair checklist + step progress; Jazz 3.0 goal bars + chips;
// Shopping needs list + count.
const JARVIS_OWNER = "Jazz";
const DASH_GO = { todo: "todo", money: "budget", skin: "skin", jazz3: "jazz3", shop: "wants" }; // tile → tab
const DASH_TODO_MAX = 6;
const DASH_SHOP_MAX = 4;
["jv-todo", "jv-money", "jv-skin"].forEach((id) => openPinned.add(id)); // Jazz 3.0 and Shopping start folded

function dashGo(where) {
  if (where === "weather") {
    openPinned.add("jarvis-weather");
    renderHome();
    const el = document.getElementById("jarvis-weather");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (DASH_GO[where]) activateTab(DASH_GO[where]);
}
const dashSum = (list, f = (x) => Number(x.amount) || 0) => Math.round(list.reduce((s, x) => s + f(x), 0) * 100) / 100;
const dashPct = (n, d) => (d > 0 ? Math.max(0, Math.min(100, Math.round((n / d) * 100))) : 0);
const dashOpen = (where, label) => `<button class="jv-open" data-action="jv-go" data-go="${where}">${label} →</button>`;

function dashGreetingHtml(b) {
  const now = new Date(),
    h = now.getHours();
  const hello = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const synced = !!localStorage.getItem("sync-token");
  const status = b
    ? `Briefed ${b.date === addDaysIso(0) ? jvTime(b.generatedAt) : noonOf(b.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : synced
      ? "Standing by"
      : "Local mode";
  const w = b && b.date === addDaysIso(0) && b.weather && b.weather.status === "ok" ? b.weather.data : null;
  const place = w && w.location ? w.location.replace(/,.*$/, "") : "";
  const sub = [
    now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    place,
    w && w.currentF != null ? `${w.currentF}° ${w.conditions.toLowerCase()}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `<div class="jv-greet">
      <div class="jv-status"><span class="jv-status-name"><span class="jv-dot"></span>Jarvis</span><span>${escapeHtml(status)}</span></div>
      <h2 class="jv-hello">${hello}, ${JARVIS_OWNER}.</h2>
      <div class="jv-greet-sub">${escapeHtml(sub)}</div>
    </div>`;
}

// ---- section data (shared by the tiles and the cards) ----
function dashTodoData() {
  const today = addDaysIso(0),
    day = homeDayItems(today);
  const rows = [...day.overdue, ...day.open];
  return { rows, overdue: day.overdue.length, starred: rows.filter((t) => t.starred).length };
}
// The stretch from the latest payday up to the next one: what's paid, what's still due, what's left
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
  const today = addDaysIso(0),
    weekEnd = addDaysIso(7);
  const dueSoon = bills
    .filter((b) => !b.done && b.due && b.due <= weekEnd)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return { dueSoon, total: dashSum(dueSoon, billShare), period: dashPayPeriod(today) };
}
function dashSkinData() {
  const now = new Date(),
    r = routineForDate(now),
    c = todayChecks();
  const amDone = r.am.filter((s) => c.am.includes(s.id)).length,
    pmDone = r.pm.filter((s) => c.pm.includes(s.id)).length;
  const next = r.am.find((s) => !c.am.includes(s.id)) || r.pm.find((s) => !c.pm.includes(s.id));
  return { r, c, amDone, pmDone, next, streak: routineStreak() };
}
function dashJazz3Data() {
  const ws = weightStatus();
  const sections = plan3Cats().map((cat) => {
    const list = plan3.filter((x) => x.cat === cat);
    return { cat, done: list.filter((x) => x.done).length, total: list.length };
  });
  return { ws, sections, workouts: workoutsOn(addDaysIso(0)) };
}
function dashShopData() {
  const pending = wantsList.filter((w) => !wantsState[w.id] && !w.later).sort(wantsOrder);
  const needs = pending.filter((w) => wantKind(w) === "need");
  return { needs, wants: pending.length - needs.length, est: dashSum(pending, (w) => Number(w.price) || 0) };
}

// ---- tiles ----
function dashTilesHtml(b, progress, d) {
  const w = b && b.weather && b.weather.status === "ok" ? b.weather.data : null;
  const rainWin = w ? jvRainWindow(w.hourlyRain) : "";
  const nextBill = d.money.dueSoon[0];
  const skinAm = d.skin.amDone < d.skin.r.am.length;
  const j3 = d.jazz3;
  const sectionsLine = j3.sections
    .slice(0, 2)
    .map((s) => `${s.cat} ${s.done}/${s.total}`)
    .join(" · ");
  const tiles = [
    {
      go: "weather",
      label: "Weather",
      value: w ? `${w.highF}° / ${w.lowF}°` : "—",
      sub: w ? `${w.rainChanceMax}% rain${rainWin ? ` ${rainWin}` : ""}` : "No forecast yet",
      pct: w ? w.rainChanceMax : 0,
      tone: "",
    },
    {
      go: "todo",
      label: "To-Do",
      value: `${d.todo.rows.length} left`,
      sub:
        [d.todo.overdue ? `${d.todo.overdue} overdue` : "", d.todo.starred ? `${d.todo.starred} starred` : ""]
          .filter(Boolean)
          .join(" · ") || "Nothing overdue",
      pct: dashPct(progress.done, progress.total),
      tone: d.todo.overdue ? "warn" : "",
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
    },
    {
      go: "skin",
      label: "Skin & Hair",
      value: skinAm ? `AM ${d.skin.amDone}/${d.skin.r.am.length}` : `PM ${d.skin.pmDone}/${d.skin.r.pm.length}`,
      sub: d.skin.r.wash ? "Wash day tonight" : d.skin.streak ? `${d.skin.streak}-day streak` : "Today's routine",
      pct: skinAm ? dashPct(d.skin.amDone, d.skin.r.am.length) : dashPct(d.skin.pmDone, d.skin.r.pm.length),
      tone: "pink",
    },
    {
      go: "jazz3",
      label: "Jazz 3.0",
      value:
        j3.ws.pct != null
          ? `${j3.ws.pct}%`
          : `${dashSum(j3.sections, (s) => s.done)}/${dashSum(j3.sections, (s) => s.total)}`,
      sub: [j3.ws.pct != null ? "to weight goal" : "", sectionsLine].filter(Boolean).join(" · ") || "Goals",
      pct:
        j3.ws.pct != null
          ? j3.ws.pct
          : dashPct(
              dashSum(j3.sections, (s) => s.done),
              dashSum(j3.sections, (s) => s.total),
            ),
      tone: "accent",
    },
    {
      go: "shop",
      label: "Shopping",
      value: `${d.shop.needs.length} need${d.shop.needs.length === 1 ? "" : "s"}`,
      sub: d.shop.needs[0] ? d.shop.needs[0].name : `${d.shop.wants} want${d.shop.wants === 1 ? "" : "s"}`,
      pct: 0,
      tone: "",
    },
  ];
  return `<div class="jv-label"><span>Systems</span><i></i><span>${tiles.length} feeds</span></div>
    <div class="jv-tiles">${tiles
      .map(
        (t) => `<button class="jv-tile ${t.tone}" data-action="jv-go" data-go="${t.go}">
          <span class="jv-tile-label">${t.label}</span>
          <span class="jv-tile-value">${escapeHtml(t.value)}</span>
          <span class="jv-tile-sub">${escapeHtml(t.sub)}</span>
          <span class="jv-tile-bar"><span style="width:${t.pct}%"></span></span>
        </button>`,
      )
      .join("")}</div>`;
}

// ---- cards ----
function dashTodoCard(d) {
  const rows = d.rows.slice(0, DASH_TODO_MAX);
  const more = d.rows.length - rows.length;
  const body = rows.length
    ? `<div class="jv-rows">${rows
        .map((t) =>
          homeRowHtml(
            t,
            t.due && t.due < addDaysIso(0) ? [`<span class="overdue">${escapeHtml(dueLabel(t.due))}</span>`] : [],
          ),
        )
        .join("")}</div>${more > 0 ? `<div class="jv-more">${more} more today</div>` : ""}`
    : `<div class="empty">Nothing due today.</div>`;
  const openN = todoList.filter((t) => !t.done).length;
  return collapsibleCard({
    id: "jv-todo",
    title: "To-Do",
    insight: d.rows.length ? `${d.rows.length} left${d.overdue ? ` · ${d.overdue} overdue` : ""}` : "Clear",
    body: body + dashOpen("todo", `All to-dos (${openN})`),
  });
}
function dashMoneyCard(d) {
  const list = d.dueSoon.length
    ? `<div class="jv-rows">${d.dueSoon.map((b) => homeBillHtml(b)).join("")}</div>`
    : `<div class="empty">No bills due in the next 7 days.</div>`;
  const p = d.period;
  const short = (iso) => noonOf(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const period = p
    ? `<div class="jv-period">
        <div class="jv-period-head"><b>Pay period</b><span>${short(p.start)} – ${short(isoDate(new Date(noonOf(p.end).getTime() - 864e5)))} · day ${p.dayN} of ${p.days}</span></div>
        <div class="jv-period-bar" aria-hidden="true"><span class="paid" style="width:${dashPct(p.paid, Math.max(p.pay, p.paid + p.due))}%"></span><span class="due" style="width:${dashPct(p.due, Math.max(p.pay, p.paid + p.due))}%"></span></div>
        <div class="jv-period-keys"><span><i class="paid"></i>Paid ${moneyShort(p.paid)}</span><span><i class="due"></i>Due ${moneyShort(p.due)}</span>${p.pay ? `<span class="${p.left < 0 ? "neg" : ""}">Left ${p.left < 0 ? "−" : ""}${moneyShort(Math.abs(p.left))}</span>` : ""}</div>
      </div>`
    : "";
  return collapsibleCard({
    id: "jv-money",
    title: "Money",
    insight: d.dueSoon.length ? `${moneyShort(d.total)} this week` : "Nothing due",
    body: `<div class="jv-sub-label">Due this week</div>${list}${period}${dashOpen("money", "Open Budget")}`,
  });
}
function dashSkinCard(d) {
  const { r, c } = d;
  const segs = (steps, done) =>
    steps.length
      ? `<div class="jv-segs" style="--n:${steps.length}">${steps.map((s, i) => `<span class="${i < done ? "on" : ""}"></span>`).join("")}</div>`
      : "";
  const progress = `<div class="jv-skin-progress">
      <div class="jv-skin-row"><span class="jv-mini am">AM ${d.amDone}/${r.am.length}</span>${segs(r.am, d.amDone)}</div>
      <div class="jv-skin-row"><span class="jv-mini pm">PM ${d.pmDone}/${r.pm.length}</span>${segs(r.pm, d.pmDone)}</div>
      <div class="jv-skin-meta">${d.next ? `Next: <b>${escapeHtml(d.next.label)}</b>` : "All done today"}${d.streak ? ` · ${d.streak}-day streak` : ""}${r.wash ? ` · <span class="jv-wash-tag">Wash day</span>` : ""}</div>
    </div>`;
  const col = (band, label, steps) =>
    `<div class="jv-skin-col"><div class="jv-mini ${band}">${label}</div>${
      steps
        .map((s) => {
          const on = c[band].includes(s.id);
          return `<button class="jv-step ${on ? "done" : ""}" role="checkbox" aria-checked="${on}" data-action="routine-step" data-band="${band}" data-step-id="${escapeAttr(s.id)}"><span class="box">${BOX_CHECK_SVG}</span><span>${escapeHtml(s.label)}</span></button>`;
        })
        .join("") || '<div class="empty">No steps today.</div>'
    }</div>`;
  return collapsibleCard({
    id: "jv-skin",
    title: "Skin &amp; Hair",
    insight: `AM ${d.amDone}/${r.am.length} · PM ${d.pmDone}/${r.pm.length}`,
    body:
      progress +
      `<div class="jv-skin-cols">${col("am", "AM", r.am)}${col("pm", r.wash ? "PM · wash day" : "PM", r.pm)}</div>` +
      dashOpen("skin", "Open Skin &amp; Hair"),
  });
}
function dashJazz3Card(d) {
  const bar = (name, label, pct, tone) =>
    `<div class="jv-goal"><div class="jv-goal-head"><b>${escapeHtml(name)}</b><span>${escapeHtml(label)}</span></div><div class="jv-goal-bar ${tone}"><span style="width:${pct}%"></span></div></div>`;
  const ws = d.ws;
  const bars =
    (ws.pct != null ? bar("Weight", `${ws.pct}%${ws.toGo != null ? ` · ${ws.toGo} lb to go` : ""}`, ws.pct, "") : "") +
    d.sections
      .map((s, i) => bar(s.cat, `${s.done} / ${s.total}`, dashPct(s.done, s.total), i % 2 ? "warn" : "pink"))
      .join("");
  const chips = [
    ...d.sections.map((s) => `${s.cat} ${s.done}/${s.total}`),
    ...d.workouts.map((w) => `Workout: ${w.name}${w.time ? ` · ${w.time}` : ""}`),
  ];
  return collapsibleCard({
    id: "jv-jazz3",
    title: "Jazz 3.0",
    insight: ws.pct != null ? `Weight ${ws.pct}%` : `${d.sections.length} goals`,
    body:
      (bars ? `<div class="jv-goals">${bars}</div>` : `<div class="empty">No goals yet.</div>`) +
      (chips.length
        ? `<div class="jv-chips">${chips.map((c) => `<button class="jv-chip" data-action="jv-go" data-go="jazz3">${escapeHtml(c)}</button>`).join("")}</div>`
        : "") +
      dashOpen("jazz3", "Open Jazz 3.0"),
  });
}
function dashShopCard(d, b) {
  const needs = d.needs.slice(0, DASH_SHOP_MAX);
  // A briefing line that names one of your needs ("rain jacket" on a rainy day)
  const match =
    b &&
    b.summary.find((s) =>
      d.needs.some((w) => w.name.length > 2 && s.text.toLowerCase().includes(w.name.toLowerCase())),
    );
  const count = `<div class="jv-shop-count"><b>${d.needs.length} need${d.needs.length === 1 ? "" : "s"}</b><span>${d.wants} want${d.wants === 1 ? "" : "s"}${d.est ? ` · est. ${moneyShort(Math.round(d.est))}` : ""}</span></div>
    ${match ? `<div class="jv-shop-match">Jarvis: ${escapeHtml(match.text)}</div>` : ""}`;
  const list = needs.length
    ? `<div class="jv-rows">${needs
        .map(
          (w) => `<div class="jv-shop-row">
            <button class="todo-check" role="checkbox" aria-checked="false" aria-label="Bought: ${escapeAttr(w.name)}" data-action="want-toggle" data-want-id="${escapeAttr(w.id)}"><span class="box">${BOX_CHECK_SVG}</span></button>
            <span class="jv-shop-name">${escapeHtml(w.name)}</span>
            ${w.price != null ? `<span class="jv-shop-price">${w.estimated ? "~" : ""}${moneyShort(w.price)}</span>` : ""}
          </div>`,
        )
        .join("")}</div>`
    : `<div class="empty">No needs on the list.</div>`;
  return collapsibleCard({
    id: "jv-shop",
    title: "Shopping",
    insight: `${d.needs.length} need${d.needs.length === 1 ? "" : "s"}`,
    body: count + list + dashOpen("shop", "Open Shopping"),
  });
}

function dashboardHtml() {
  const b = loadBriefing();
  const today = addDaysIso(0);
  const progress = homeDayTotals(today);
  const d = {
    todo: dashTodoData(),
    money: dashMoneyData(),
    skin: dashSkinData(),
    jazz3: dashJazz3Data(),
    shop: dashShopData(),
  };
  return `<div class="jv-wrap">
      ${dashGreetingHtml(b)}
      ${jarvisHeroHtml(b, progress)}
      ${dashTilesHtml(b, progress, d)}
      <div class="jv-label"><span>Today</span><i></i></div>
      ${b ? jarvisWeatherCard(b.weather) : ""}
      ${dashTodoCard(d.todo)}
      ${dashMoneyCard(d.money)}
      ${dashSkinCard(d.skin)}
      ${dashJazz3Card(d.jazz3)}
      ${dashShopCard(d.shop, b)}
      ${b ? jarvisNewsCard(b.news) : ""}
    </div>`;
}
