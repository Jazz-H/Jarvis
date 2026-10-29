// home.js - Home tab: calendar strip, day agenda and rendering.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- HOME: calendar strip + day agenda ----------
// Home is a day planner. A Sunday-first week strip picks the day; swiping it
// sideways pages weeks, and swiping it down (or the chevron) opens the full
// month, so any date can be picked. The list below shows everything due that
// day; today also carries Overdue and a short Anytime peek. To-dos finished
// that day stay visible, struck through, so the progress ring has something to
// show. Selection is per-session only.
let homeDate = null;     // selected "YYYY-MM-DD"; null means today
let homeAnchor = null;   // a date inside the week/month on screen; null follows homeDate
let homeCalOpen = false; // month view vs. week strip
let homeCalAnim = false; // animate the next render (open/close only)
const HOME_ANYTIME_MAX = 4;
function homeSelected(){ return homeDate || addDaysIso(0); }
function selectHomeDate(iso){
  homeDate = iso === addDaysIso(0) ? null : iso;
  homeAnchor = null;
  renderHomePanel();
}
function setHomeCalOpen(open){
  if (open === homeCalOpen) return;
  homeCalOpen = open;
  homeAnchor = null; // reopen/close around the selected day
  homeCalAnim = true;
  renderHomePanel();
}
function shiftHomeCal(delta){
  const d = noonOf(homeAnchor || homeSelected());
  if (homeCalOpen){ d.setDate(1); d.setMonth(d.getMonth() + delta); }
  else d.setDate(d.getDate() + 7 * delta);
  homeAnchor = isoDate(d);
  renderHomePanel();
}
function completedOn(t, iso){ return t.done && !!t.completedAt && isoDate(new Date(t.completedAt)) === iso; }
function starredFirst(list){ return [...list.filter(t => t.starred), ...list.filter(t => !t.starred)]; }
const byDue = (a,b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
function homeDayItems(iso){
  const today = addDaysIso(0);
  const open = starredFirst(todoList.filter(t => !t.done && spansOn(t, iso)));
  const wash = isWashDay(noonOf(iso));
  if (iso > today) return {wash, overdue:[], anytime:[], open, done:todoList.filter(t => t.done && t.due === iso),
    repeats:todoList.filter(t => occursOn(t, iso))};
  // A past day shows what was due then (still open) and what got done that day
  if (iso < today) return {wash, overdue:[], anytime:[], open, done:todoList.filter(t => completedOn(t, iso))};
  // Today's done list: anything ticked off today that wasn't scheduled for later
  return {wash, open,
    overdue:todoList.filter(t => !t.done && todoGroup(t) === "overdue").sort(byDue),
    done:todoList.filter(t => completedOn(t, iso) && (!t.due || t.due <= iso)),
    anytime:starredFirst(todoList.filter(t => !t.done && !t.due))};
}
// Open to-dos per due date, for the calendar dots; today's count includes overdue
function homeDueCounts(){
  const today = addDaysIso(0), counts = {};
  todoList.forEach(t => {
    if (t.done || !t.due) return;
    const end = todoEnd(t);
    if (end < today){ counts[today] = (counts[today] || 0) + 1; return; } // overdue counts on today
    // a multi-day to-do counts on each of its days
    for (let d = t.due < today ? today : t.due, i = 0; d <= end && i < 60; d = isoDate(new Date(noonOf(d).getTime() + 864e5)), i++) counts[d] = (counts[d] || 0) + 1;
  });
  return counts;
}
function homeCalDayHtml(d, counts, monthView, other = false){
  const iso = isoDate(d), today = addDaysIso(0), sel = homeSelected();
  const dayBills = iso >= today ? billsOnDay(iso) : null;
  const count = iso >= today ? (counts[iso] || 0) + (iso > today ? todoList.filter(t => occursOn(t, iso)).length : 0)
    + dayBills.open.length + dayBills.projected.length + workoutsOn(iso).filter(w => !workoutDone(iso, w.id)).length
    + (weighInDue(iso) && !weighedOn(iso) ? 1 : 0) : 0;
  const wash = iso >= today && isWashDate(d) && skinRoutine.washPm.length > 0;
  const hol = holidaysOn(iso);
  const cls = ["home-day", iso === sel ? "on" : "", iso === today ? "today" : "", iso < today ? "past" : "", other ? "other" : "", hol.length ? "holiday" : ""].filter(Boolean).join(" ");
  const label = `${d.toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'})}: ${count ? `${count} to-do${count === 1 ? "" : "s"}` : "nothing due"}${wash ? ", wash day" : ""}${hol.map(h => `, ${h.name}`).join("")}`;
  return `<button class="${cls}" aria-pressed="${iso === sel}" aria-label="${label}" data-action="home-select-date" data-date="${iso}">
      ${monthView ? "" : `<span class="dow">${iso === today ? "Today" : d.toLocaleDateString('en-US', {weekday:'short'})}</span>`}<b>${d.getDate()}</b>
      <span class="marks">${"<i></i>".repeat(Math.min(count, 3))}${wash ? DROPLET_ICON : ""}</span>
    </button>`;
}
function holidayChips(iso){
  const hol = holidaysOn(iso);
  return hol.length ? `<div class="holiday-chips">${hol.map(h => `<span class="holiday-chip ${h.federal ? "fed" : ""}">${STAR_ICON_SMALL}${escapeHtml(h.name)}${h.federal ? `<em> · banks closed</em>` : ""}</span>`).join("")}</div>` : "";
}
function homeCalHtml(){
  const counts = homeDueCounts();
  const anchor = noonOf(homeAnchor || homeSelected());
  const today = addDaysIso(0);
  let body, period, showsToday;
  if (homeCalOpen){
    const first = new Date(anchor); first.setDate(1);
    const lead = first.getDay(); // Sunday-first
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    body = WEEK_LETTERS.map(x => `<div class="cal-dow">${x}</div>`).join("");
    // the previous month's last days fill the first week, greyed out
    for (let i = lead; i > 0; i--) body += homeCalDayHtml(new Date(first.getFullYear(), first.getMonth(), 1 - i, 12), counts, true, true);
    for (let n = 1; n <= days; n++) body += homeCalDayHtml(new Date(first.getFullYear(), first.getMonth(), n, 12), counts, true);
    body = `<div class="home-month">${body}</div>`;
    period = first;
    showsToday = today.slice(0, 7) === isoDate(first).slice(0, 7);
  } else {
    const start = new Date(anchor); start.setDate(start.getDate() - start.getDay());
    body = "";
    for (let n = 0; n < 7; n++){ const d = new Date(start); d.setDate(start.getDate() + n); body += homeCalDayHtml(d, counts, false); }
    body = `<div class="home-week">${body}</div>`;
    period = anchor;
    const end = new Date(start); end.setDate(start.getDate() + 6);
    showsToday = isoDate(start) <= today && today <= isoDate(end);
  }
  const yearOpt = period.getFullYear() === new Date().getFullYear() ? {month:'long'} : {month:'long', year:'numeric'};
  const back = !showsToday || homeSelected() !== today;
  return `<div class="home-cal ${homeCalOpen ? "open" : ""} ${homeCalAnim ? "anim" : ""}">
      <div class="home-cal-head">
        <span class="home-cal-title">${period.toLocaleDateString('en-US', yearOpt)}</span>
        ${back ? `<button class="home-cal-today" data-action="home-select-date" data-date="${today}">Today</button>` : ""}
        <button class="cal-nav" data-action="home-shift-cal" data-delta="-1" aria-label="Previous ${homeCalOpen ? "month" : "week"}">‹</button>
        <button class="cal-nav" data-action="home-shift-cal" data-delta="1" aria-label="Next ${homeCalOpen ? "month" : "week"}">›</button>
      </div>
      ${body}
      <button class="home-cal-grab" data-action="home-cal-open" data-open="${!homeCalOpen}" aria-expanded="${homeCalOpen}" aria-label="${homeCalOpen ? "Show week" : "Show month"}"><span></span></button>
    </div>`;
}
// Wash day as a to-do: a row derived from the wash schedule rather than stored in
// todoList. Its checkbox ticks the wash-only PM steps (the ones regular PM
// doesn't have: shampoo, mask), so it stays in step with Skin & Hair. Only
// today's can be ticked; other days show the droplet instead.
function isWashDay(d){ return isWashDate(d) && skinRoutine.washPm.length > 0; }
function washHairSteps(){
  const regular = new Set(skinRoutine.pm.map(s => s.label));
  const own = skinRoutine.washPm.filter(s => !regular.has(s.label));
  return own.length ? own : skinRoutine.washPm;
}
function washHairDone(iso){
  const c = routineChecks[iso], steps = washHairSteps();
  return !!c && steps.length > 0 && steps.every(s => (c.pm || []).includes(s.id));
}
// Any wash day's row can be ticked (catching up on a past one, or washing early)
function toggleWashHair(iso = addDaysIso(0)){
  if (!isWashDay(noonOf(iso))) return;
  const done = washHairDone(iso), ticked = (routineChecks[iso] && routineChecks[iso].pm) || [];
  washHairSteps().forEach(s => { if (ticked.includes(s.id) === done) toggleRoutineStep("pm", s.id, iso); });
}
// Tapping the row's title goes to the Wash day card (schedule + calendar)
function openWashCard(){
  openPinned.add("wash-card");
  activateTab("skin");
  renderSkin();
  const card = document.getElementById("wash-card");
  if (card) card.scrollIntoView({behavior:"smooth", block:"start"});
}
function washRowHtml(iso){
  const done = washHairDone(iso);
  const check = `<button class="todo-check" role="checkbox" aria-checked="${done}" aria-label="${done ? "Mark not done" : "Complete"}: Wash hair" data-action="home-wash-toggle" data-date="${iso}"><span class="box">${BOX_CHECK_SVG}</span></button>`;
  return `<div class="todo-wrap wash-row"><div class="item ${done ? "checked" : ""}">
      ${check}
      <div class="body" data-action="home-wash-open"><div class="title wash-title">Wash hair${DROPLET_ICON}</div></div>
    </div></div>`;
}
// A bill on Home's day list: payable when it's the bill's real due date,
// read-only when it's a projected future due, struck through once paid
function homeBillHtml(b, {projected = false, payment = null} = {}){
  const today = addDaysIso(0);
  const name = payment ? payment.name : b.name, amount = payment ? payment.amount : billShare(b);
  const meta = [`<span class="bill-tag">${money(amount)}</span>`];
  if (b && !projected && b.due < today) meta.push(`<span class="overdue">${escapeHtml(dueLabel(b.due))}</span>`);
  if (b && b.autopay) meta.push("Autopay");
  if (payment) meta.push("Paid");
  const lead = payment
    ? `<button class="todo-check" role="checkbox" aria-checked="true" aria-label="Mark not paid: ${escapeAttr(name)}" data-action="bill-unpay" data-payment-id="${payment.id}"><span class="box">${BOX_CHECK_SVG}</span></button>`
    : projected
      ? `<span class="row-icon bill-icon" aria-hidden="true">${WALLET_ICON}</span>`
      : `<button class="todo-check" role="checkbox" aria-checked="false" aria-label="Mark paid: ${escapeAttr(name)}" data-action="bill-pay" data-bill-id="${b.id}" data-due="${b.due}"><span class="box">${BOX_CHECK_SVG}</span></button>`;
  const open = b ? `data-bill-id="${b.id}" data-mode="edit"` : `data-mode="budget"`;
  return `<div class="todo-wrap bill-home"><div class="item ${payment ? "checked" : ""}">
      ${lead}
      <div class="body" data-action="home-bill-open" ${open}><div class="title">${billLogoHtml(b || bills.find(x => payment && x.id === payment.billId), name)}Pay ${escapeHtml(name)}</div><div class="todo-meta">${meta.join(" · ")}</div></div>
    </div></div>`;
}
// A future repeat of a recurring to-do: shown on its date, ticked off only once
// the real item gets there
function repeatGhostHtml(t){
  return `<div class="todo-wrap repeat-ghost"><div class="item">
      <span class="row-icon repeat-icon" aria-hidden="true">${REPEAT_ICON}</span>
      <div class="body" data-action="home-todo-edit" data-todo-id="${t.id}"><div class="title">${kindIconHtml(t)}${escapeHtml(t.text)}</div><div class="todo-meta">${escapeHtml(repeatLabel(t))}</div></div>
    </div></div>`;
}
function homeRowHtml(t, meta = []){
  const subs = t.subitems || [];
  if (subs.length && !t.done) meta = [...meta, `${subs.filter(s => s.done).length}/${subs.length} sub-items`];
  if (t.repeat && !t.done) meta = [...meta, `<span class="repeat-meta">${REPEAT_ICON}${escapeHtml(repeatLabel(t))}</span>`];
  const check = t.done
    ? `aria-checked="true" aria-label="Mark not done: ${escapeAttr(t.text)}" data-action="home-todo-toggle" data-todo-id="${t.id}"`
    : `aria-checked="false" aria-label="Complete: ${escapeAttr(t.text)}" data-action="home-todo-complete" data-todo-id="${t.id}"`;
  return `<div class="todo-wrap" data-todo-id="${t.id}"><div class="item ${t.done ? 'checked' : ''}">
      <button class="todo-check" role="checkbox" ${check}><span class="box">${BOX_CHECK_SVG}</span></button>
      <div class="body" data-action="home-todo-edit" data-todo-id="${t.id}"><div class="title">${kindIconHtml(t)}${escapeHtml(t.text)}${t.starred && !t.done ? `<span class="home-star" aria-label="Starred">${STAR_FILLED_ICON}</span>` : ""}</div>${meta.length ? `<div class="todo-meta">${meta.join(" · ")}</div>` : ""}</div>
    </div></div>`;
}
function homeRingHtml(done, total){
  const r = 24, c = 2 * Math.PI * r, f = total ? done / total : 0;
  return `<svg class="home-ring" viewBox="0 0 58 58" role="img" aria-label="${done} of ${total} done">
      <circle cx="29" cy="29" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="6"/>
      ${f ? `<circle cx="29" cy="29" r="${r}" fill="none" stroke="var(--olive)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(c * f).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 29 29)"/>` : ""}
      <text x="29" y="34" text-anchor="middle" font-size="${total > 9 ? 12 : 14}" font-weight="800" fill="var(--text)">${total ? `${done}/${total}` : "–"}</text>
    </svg>`;
}
// Re-renders both pages that show to-dos, so every to-do change can keep
// calling renderHome() and Home's summary card never goes stale.
function renderHome(){
  renderTodoPanel();
  renderHomePanel();
}
function renderHomePanel(){
  const el = document.getElementById("panel-home");
  const iso = homeSelected(), today = addDaysIso(0);
  const day = homeDayItems(iso);
  const date = noonOf(iso);
  const strip = homeCalHtml();
  homeCalAnim = false;

  const washDone = day.wash && washHairDone(iso);
  const repeats = day.repeats || [];
  const dayBills = billsOnDay(iso);
  const weighDue = weighInDue(iso), weighDone = weighDue && !!weighedOn(iso);
  const workouts = workoutsOn(iso), workoutsDone = workouts.filter(w => workoutDone(iso, w.id)).length + (weighDone ? 1 : 0);
  const total = day.overdue.length + day.open.length + repeats.length + day.done.length + (day.wash ? 1 : 0)
    + dayBills.open.length + dayBills.projected.length + dayBills.paid.length + workouts.length + (weighDue ? 1 : 0);
  const done = day.done.length + (washDone ? 1 : 0) + dayBills.paid.length + workoutsDone;
  const left = total - done;
  let sub;
  if (iso === today){
    sub = left ? `${left} left today` : total ? "All done for today" : "Nothing due today";
    const streak = routineStreak();
    if (streak) sub += ` · ${streak}-day routine streak`;
  } else if (iso < today){
    sub = [done ? `${done} done` : "", left ? `${left} still open` : ""].filter(Boolean).join(" · ") || "Nothing recorded";
  } else {
    sub = (iso === addDaysIso(1) ? "Tomorrow · " : "") + (left ? `${left} to-do${left === 1 ? "" : "s"}` : total ? "All done" : "Nothing planned");
  }
  const dateOpt = date.getFullYear() === new Date().getFullYear() ? {weekday:'long', month:'short', day:'numeric'} : {weekday:'short', month:'short', day:'numeric', year:'numeric'};
  const hero = `<div class="home-hero">
      ${homeRingHtml(done, total)}
      <div><h2>${date.toLocaleDateString('en-US', dateOpt)}</h2><div class="sub">${sub}</div>${holidayChips(iso)}</div>
    </div>`;

  // data-due: what dropping a dragged to-do here sets ("keep" = leave its date)
  const section = (label, rows, cls = "", due = "keep") => rows ? `<div class="home-sec ${cls}" data-due="${due}">${label}</div><div class="card home-list">${rows}</div>` : "";
  const lateBills = dayBills.open.filter(b => b.due < today), dueBills = dayBills.open.filter(b => b.due >= today);
  let list = section("Overdue", day.overdue.map(t => homeRowHtml(t, [`<span class="overdue">${escapeHtml(dueLabel(t.due))}</span>`])).join("")
    + lateBills.map(b => homeBillHtml(b)).join(""), "overdue", "keep");
  const pastOpen = iso < today ? [`<span class="overdue">Still open</span>`] : [];
  // The day's list groups itself: to-dos with no type first, then each type
  // that has any to-dos (Chores, Errands…) under its own label, then Bills
  const items = [...day.open.map(t => ({t, html:homeRowHtml(t, [...(iso < today && todoEnd(t) < today ? pastOpen : []), ...spanMeta(t, iso)])})),
    ...repeats.map(t => ({t, html:repeatGhostHtml(t)})),
    ...(weighDue ? [{t:{kind:"fitness", text:"Weigh in"}, html:weighRowHtml(iso)}] : []),
    ...workouts.map(w => ({t:{kind:w.kind, text:w.name}, html:workoutRowHtml(w, iso)}))];
  const kindCount = {};
  items.forEach(x => { const k = todoKind(x.t); if (k) kindCount[k] = (kindCount[k] || 0) + 1; });
  const grouped = k => k && kindCount[k] >= 1;
  const subHead = (icon, label, hue) => `<div class="home-sub" ${hue != null ? `style="--k:${hue}"` : ""}>${icon}<span>${label}</span></div>`;
  let dayRows = (day.wash && !washDone ? washRowHtml(iso) : "")
    + items.filter(x => !grouped(todoKind(x.t))).map(x => x.html).join("");
  KIND_ORDER.filter(k => kindCount[k] >= 1).forEach(k => {
    const plural = {errand:"Errands", appointment:"Appointments", birthday:"Birthdays", call:"Calls", pet:"Pets", car:"Car"}[k] || TODO_KINDS[k].label;
    dayRows += subHead(TODO_KINDS[k].icon, plural, TODO_KINDS[k].hue)
      + items.filter(x => todoKind(x.t) === k)
        .sort((a, b) => isKindName(b.t.text, k) - isKindName(a.t.text, k)) // a to-do named "Chores" leads its group
        .map(x => x.html).join("");
  });
  const billRows = dueBills.map(b => homeBillHtml(b)).join("")
    + dayBills.projected.map(b => homeBillHtml(b, {projected:true})).join("")
    + dayBills.paid.map(p => homeBillHtml(null, {payment:p})).join("");
  if (billRows) dayRows += subHead(WALLET_ICON, "Bills") + billRows;
  dayRows += washDone ? washRowHtml(iso) : ""; // finished to-dos leave Home (they still count in the ring; To-Do keeps them)
  const dayName = escapeHtml(dueLabel(iso));
  const doneN = day.done.length;
  const emptyText = doneN ? `All done · ${doneN} to-do${doneN === 1 ? "" : "s"} finished.`
    : iso === today ? "Nothing due today — tap + to add one."
    : iso < today ? "Nothing was due or done this day."
    : `Nothing planned — tap + to add one for ${dayName}.`;
  list += dayRows ? section(dayName, dayRows, "", iso)
    : `<div class="home-sec">${dayName}</div><div class="card home-list"><div class="empty">${emptyText}</div></div>`;
  if (day.anytime.length){
    const more = day.anytime.length - HOME_ANYTIME_MAX;
    list += section("Anytime", day.anytime.slice(0, HOME_ANYTIME_MAX).map(t => homeRowHtml(t)).join("")
      + (more > 0 ? `<button class="home-more" data-action="home-open-todo">${more} more anytime →</button>` : ""), "", "");
  }
  const openTotal = todoList.filter(t => !t.done).length;
  list += `<button class="home-more home-all" data-action="home-open-todo">All to-dos (${openTotal}) →</button>`;

  el.innerHTML = strip + hero + list;
}
// The calendar strip's own gestures: down opens the month, up closes it, and
// sideways pages weeks (or months). Touches that start on it are left out of
// tab swiping and pull-to-refresh.
(function(){
  const panel = document.getElementById("panel-home");
  let sx = 0, sy = 0, on = false;
  panel.addEventListener("touchstart", e => {
    on = !!e.target.closest(".home-cal");
    if (on){ sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
  }, {passive:true});
  panel.addEventListener("touchmove", e => { if (on) e.preventDefault(); }, {passive:false});
  panel.addEventListener("touchend", e => {
    if (!on) return;
    on = false;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dy) > 35 && Math.abs(dy) > Math.abs(dx)) setHomeCalOpen(dy > 0);
    else if (Math.abs(dx) > 45) shiftHomeCal(dx < 0 ? 1 : -1);
  }, {passive:true});
})();
