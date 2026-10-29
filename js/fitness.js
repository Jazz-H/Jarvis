// fitness.js - Jazz 3.0 fitness: workouts, weigh-ins, weight chart.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- FITNESS (Jazz 3.0) ----------
// One synced object: a start and goal weight, weigh-ins, a weekly workout plan
// and which planned workouts got done. Workouts are worked out from the plan
// (like wash days), so nothing piles up as to-dos.
//   plan: [{id, name, days:[0-6], every:1-4 weeks, anchor:"YYYY-MM-DD", time:"", kind}]
//   checks: {"YYYY-MM-DD|planId": true}
const DEFAULT_FITNESS = {start:null, goal:null, weights:[], plan:[], checks:{}};
let fitness = JSON.parse(JSON.stringify(DEFAULT_FITNESS));
let showWeighIns = false;
function normalizeFitness(){
  const f = fitness && typeof fitness === "object" && !Array.isArray(fitness) ? fitness : {};
  const iso = v => /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : null;
  const lbs = v => { const n = Number(v); return isFinite(n) && n >= 40 && n <= 800 ? Math.round(n * 10) / 10 : null; };
  const cutoff = addDaysIso(-400);
  fitness = {
    start:lbs(f.start), goal:lbs(f.goal),
    ...(Number.isInteger(f.weighDay) && f.weighDay >= -1 && f.weighDay <= 6 ? {weighDay:f.weighDay} : {}),
    weights:(Array.isArray(f.weights) ? f.weights : []).filter(w => w && iso(w.date) && lbs(w.lbs) != null)
      .map(w => ({id:safeId(w.id, "wt"), date:w.date, lbs:lbs(w.lbs)})).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
    plan:(Array.isArray(f.plan) ? f.plan : []).filter(w => w && typeof w === "object").map(w => ({
      id:safeId(w.id, "wo"), name:String(w.name || "Workout").slice(0, 60),
      days:[...new Set((Array.isArray(w.days) ? w.days : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort(),
      every:Math.max(1, Math.min(4, parseInt(w.every, 10) || 1)), anchor:iso(w.anchor) || addDaysIso(0),
      time:String(w.time || "").slice(0, 20), kind:TODO_KINDS[w.kind] ? w.kind : "fitness"})),
    checks:{}};
  Object.keys(f.checks && typeof f.checks === "object" ? f.checks : {}).forEach(k => {
    if (/^\d{4}-\d{2}-\d{2}\|[A-Za-z0-9_-]+$/.test(k) && f.checks[k] && k.slice(0, 10) >= cutoff) fitness.checks[k] = true;
  });
}
function saveFitness(){ saveContent("fitness-content", fitness, {toast:false}); renderFitness(); renderHome(); } // renderHome redraws To-Do too
function weekStartIso(iso){ const d = noonOf(iso); d.setDate(d.getDate() - d.getDay()); return isoDate(d); }
// Does a planned workout land on this date? It starts the week of its anchor
// (start) date; every-N-weeks counts weeks from there.
function workoutOn(w, iso){
  if (!w.days.includes(noonOf(iso).getDay())) return false;
  if (iso < weekStartIso(w.anchor)) return false; // the plan starts the week of its start date
  if (w.every <= 1) return true;
  const weeks = Math.round((noonOf(weekStartIso(iso)) - noonOf(weekStartIso(w.anchor))) / (7 * 864e5));
  return ((weeks % w.every) + w.every) % w.every === 0;
}
function workoutsOn(iso){ return fitness.plan.filter(w => workoutOn(w, iso)); }
function workoutDone(iso, id){ return !!fitness.checks[`${iso}|${id}`]; }
function toggleWorkout(iso, id){
  const k = `${iso}|${id}`;
  if (fitness.checks[k]) delete fitness.checks[k]; else fitness.checks[k] = true;
  saveFitness();
}
function fmtTime(t){
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return t || "";
  const h = Number(m[1]);
  return `${h % 12 || 12}${m[2] === "00" ? "" : ":" + m[2]} ${h < 12 ? "AM" : "PM"}`;
}
function workoutMeta(w){
  return [w.days.length === 7 ? "Every day" : w.days.map(d => DAY_SHORT[d]).join(" · "), fmtTime(w.time), w.every > 1 ? `every ${w.every} weeks` : ""].filter(Boolean).join(" · ");
}
// A workout as a Home row: checkable today and before, a preview after
function workoutRowHtml(w, iso){
  const today = addDaysIso(0), done = workoutDone(iso, w.id);
  const lead = iso > today
    ? `<span class="row-icon repeat-icon" aria-hidden="true">${REPEAT_ICON}</span>`
    : `<button class="todo-check" role="checkbox" aria-checked="${done}" aria-label="${done ? "Not done" : "Done"}: ${escapeAttr(w.name)}" data-action="workout-occ-toggle" data-workout-id="${w.id}" data-date="${iso}"><span class="box">${BOX_CHECK_SVG}</span></button>`;
  return `<div class="todo-wrap workout-row ${iso > today ? "repeat-ghost" : ""}"><div class="item ${done ? "checked" : ""}">
      ${lead}
      <div class="body" data-action="workout-occ-edit" data-workout-id="${w.id}" data-date="${iso}"><div class="title">${kindIconHtml({kind:w.kind, text:w.name})}${escapeHtml(w.name)}</div><div class="todo-meta"><span class="repeat-meta">${REPEAT_ICON}${escapeHtml([w.every > 1 ? `Every ${w.every} weeks` : "Weekly", fmtTime(w.time)].filter(Boolean).join(" · "))}</span></div></div>
    </div></div>`;
}
function currentWeight(){ const w = fitness.weights; return w.length ? w[w.length - 1].lbs : null; }
function weightStatus(){
  const cur = currentWeight(), start = fitness.start != null ? fitness.start : (fitness.weights[0] || {}).lbs, goal = fitness.goal;
  const out = {cur, start, goal};
  if (cur == null) return out;
  if (start != null) out.change = Math.round((cur - start) * 10) / 10;
  if (goal != null){
    out.toGo = Math.round(Math.abs(goal - cur) * 10) / 10;
    out.reached = start != null && start !== goal ? (goal > start ? cur >= goal : cur <= goal) : Math.abs(goal - cur) < 0.05;
    out.pct = start != null && goal !== start ? Math.max(0, Math.min(100, Math.round((cur - start) / (goal - start) * 100))) : (out.reached ? 100 : 0);
  }
  // pace: first to last weigh-in over the last 8 weeks, per week; with
  // fewer than 3 there, the whole history (a gap shouldn't skew the outlook)
  const since = addDaysIso(-56);
  let recent = fitness.weights.filter(w => w.date >= since);
  if (recent.length < 3 && fitness.weights.length > recent.length){ recent = fitness.weights; out.rateAll = true; }
  if (recent.length >= 2){
    const weeks = (noonOf(recent[recent.length - 1].date) - noonOf(recent[0].date)) / (7 * 864e5);
    if (weeks >= 1){
      out.rate = Math.round((recent[recent.length - 1].lbs - recent[0].lbs) / weeks * 10) / 10;
      if (goal != null && !out.reached && out.rate && Math.sign(out.rate) === Math.sign(goal - cur)) out.eta = addDaysIso(Math.ceil(Math.abs(goal - cur) / Math.abs(out.rate) * 7));
    }
  }
  return out;
}
// Each month's low–high and how much it moved, like a health app's year view
function weightMonthsHtml(){
  const by = new Map();
  fitness.weights.forEach(w => { const k = w.date.slice(0, 7); if (!by.has(k)) by.set(k, []); by.get(k).push(w.lbs); });
  if (by.size < 2) return "";
  const today = addDaysIso(0), r1 = n => Math.round(n * 10) / 10;
  const rows = [...by].reverse().map(([k, l]) => {
    const lo = Math.min(...l), hi = Math.max(...l), d = r1(l[l.length - 1] - l[0]);
    const name = noonOf(k + "-01").toLocaleDateString('en-US', {month:'short', year:k.slice(0, 4) === today.slice(0, 4) ? undefined : '2-digit'});
    return `<div><span>${escapeHtml(name)}</span><b>${lo === hi ? `${lo} lb` : `${lo}–${hi} lb`}</b><span class="${d > 0 ? "wm-up" : d < 0 ? "wm-down" : ""}">${l.length > 1 ? `${d > 0 ? "+" : ""}${d} lb` : ""}</span></div>`;
  }).join("");
  return `<div class="weight-months"><div><span>By month</span></div>${rows}</div>`;
}
// Overall pace from the first weigh-in, per month
function weightAllTime(){
  const w = fitness.weights;
  if (w.length < 2) return null;
  const months = (noonOf(w[w.length - 1].date) - noonOf(w[0].date)) / (30.44 * 864e5);
  if (months < 1) return null;
  return {since:w[0].date, change:Math.round((w[w.length - 1].lbs - w[0].lbs) * 10) / 10, perMonth:Math.round((w[w.length - 1].lbs - w[0].lbs) / months * 10) / 10};
}
function weightChartHtml(){
  const pts = fitness.weights.slice(-16);
  if (pts.length < 2) return "";
  const W = 300, H = 70, vals = pts.map(p => p.lbs).concat(fitness.goal != null ? [fitness.goal] : []);
  const lo = Math.min(...vals) - 1, hi = Math.max(...vals) + 1;
  const x = i => Math.round(i / (pts.length - 1) * (W - 8) + 4), y = v => Math.round((hi - v) / (hi - lo) * (H - 8) + 4);
  const line = pts.map((p, i) => `${x(i)},${y(p.lbs)}`).join(" ");
  const goal = fitness.goal != null ? `<line x1="0" x2="${W}" y1="${y(fitness.goal)}" y2="${y(fitness.goal)}" class="wc-goal"/>` : "";
  return `<svg class="weight-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Weight trend">${goal}
      <polyline points="${line}" class="wc-line"/>${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.lbs)}" r="${i === pts.length - 1 ? 3.5 : 2}" class="wc-dot"/>`).join("")}</svg>`;
}
function logWeight(id, date){
  const e = id ? fitness.weights.find(w => w.id === id) : null;
  openModal(e ? "Edit weigh-in" : "Log weight", [
    {key:"lbs", label:"Weight (lb)", type:"number", step:"0.1"},
    {key:"date", label:"Date", type:"date"},
  ], e ? {lbs:e.lbs, date:e.date} : {lbs:currentWeight() ?? "", date:date || addDaysIso(0)},
    v => {
      const n = Math.round(Number(v.lbs) * 10) / 10;
      if (!isFinite(n) || n < 40 || n > 800) return;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(v.date || "") ? v.date : addDaysIso(0);
      const t = e || fitness.weights.find(w => w.date === date) || {id:genId("wt")}; // one weigh-in a day
      t.lbs = n; t.date = date;
      if (!fitness.weights.includes(t)) fitness.weights.push(t);
      fitness.weights.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      saveFitness();
      const s = weightStatus();
      showToast(s.reached ? "Goal weight reached!" : s.toGo != null ? `${n} lb · ${s.toGo} lb to go` : `${n} lb logged`);
    },
    e ? () => { fitness.weights = fitness.weights.filter(w => w.id !== id); saveFitness(); } : null);
}
// Weigh-in day: a weekly reminder (Monday unless changed; -1 = off) that shows
// on Home and in To-Do and ticks itself once that day has a weigh-in. If a
// week goes by without one, it also shows today.
function weighDay(){ return fitness.weighDay == null ? 1 : fitness.weighDay; }
function weighedOn(iso){ return fitness.weights.find(w => w.date === iso) || null; }
function weighInDue(iso){
  const d = weighDay(), today = addDaysIso(0);
  if (d < 0 || (fitness.goal == null && !fitness.weights.length)) return false;
  if (noonOf(iso).getDay() === d) return true;
  if (iso !== today) return false;
  const last = fitness.weights.length ? fitness.weights[fitness.weights.length - 1].date : null;
  return !weighedOn(today) && (!last || last <= addDaysIso(-7)); // a week without one
}
function weighRowHtml(iso){
  const today = addDaysIso(0), w = weighedOn(iso), last = fitness.weights.filter(x => x.date < iso).pop();
  const open = `data-weight-id="${w ? escapeAttr(w.id) : ""}" data-date="${iso}"`;
  const meta = w ? `${w.lbs} lb` : last ? `Last ${last.lbs} lb · ${noonOf(last.date).toLocaleDateString('en-US', {month:'short', day:'numeric'})}` : "Log your weight";
  const lead = iso > today
    ? `<span class="row-icon repeat-icon" aria-hidden="true">${REPEAT_ICON}</span>`
    : `<button class="todo-check" role="checkbox" aria-checked="${!!w}" aria-label="Weigh in" data-action="weigh-row-check" ${open}><span class="box">${BOX_CHECK_SVG}</span></button>`;
  return `<div class="todo-wrap weigh-row workout-row ${iso > today ? "repeat-ghost" : ""}"><div class="item ${w ? "checked" : ""}">
      ${lead}
      <div class="body" data-action="weigh-row-open" ${open}><div class="title">${kindIconHtml({kind:"fitness", text:""})}Weigh in</div><div class="todo-meta">${escapeHtml(meta)}</div></div>
    </div></div>`;
}
function editWeighDay(){
  const opts = [...WEEKDAYS, "Off"];
  openModal("Weigh-in day", [
    {key:"day", label:"Remind me to weigh in every", type:"select", options:opts},
    {type:"note", label:"Weigh in first thing in the morning, before eating, for steady numbers. If a week goes by without a weigh-in, the reminder also shows today."},
  ], {day:weighDay() < 0 ? "Off" : WEEKDAYS[weighDay()]},
    v => { const i = WEEKDAYS.indexOf(v.day); fitness.weighDay = i >= 0 ? i : -1; saveFitness(); });
}
function editWeightGoal(){
  openModal("Weight goal", [
    {key:"start", label:"Starting weight (lb)", type:"number", step:"0.1"},
    {key:"goal", label:"Goal weight (lb)", type:"number", step:"0.1"},
  ], {start:fitness.start ?? "", goal:fitness.goal ?? ""},
    v => {
      const n = x => { const k = Math.round(Number(x) * 10) / 10; return x !== "" && x != null && isFinite(k) && k >= 40 && k <= 800 ? k : null; };
      fitness.start = n(v.start); fitness.goal = n(v.goal);
      saveFitness();
    });
}
const WORKOUT_EVERY = ["Every week", "Every 2 weeks", "Every 3 weeks", "Every 4 weeks"];
function editWorkout(id){
  const w = id ? fitness.plan.find(x => x.id === id) : null;
  const kinds = KIND_ORDER.map(k => TODO_KINDS[k].label);
  openModal(w ? "Edit workout" : "Add workout", [
    {key:"name", label:"Workout (e.g. Gym, Yoga, Run)", type:"text"},
    {key:"days", label:"Days", type:"days"},
    {key:"time", label:"Time (optional)", type:"time"},
    {key:"every", label:"Repeats", type:"select", options:WORKOUT_EVERY},
    {key:"anchor", label:"Starts (a date it happens; every few weeks counts from here)", type:"date"},
    {key:"kind", label:"Type", type:"select", options:kinds},
  ], w ? {name:w.name, days:w.days, time:w.time, every:WORKOUT_EVERY[w.every - 1], anchor:w.anchor, kind:TODO_KINDS[w.kind].label}
       : {days:[], every:WORKOUT_EVERY[0], anchor:addDaysIso(0), kind:"Fitness"},
    v => {
      const name = (v.name || "").trim().slice(0, 60);
      if (!name || !(v.days || []).length){ showToast("Give it a name and at least one day", true); return; }
      const t = w || {id:genId("wo")};
      t.name = name; t.days = v.days; t.time = /^\d{1,2}:\d{2}$/.test(v.time || "") ? v.time : "";
      t.every = Math.max(1, WORKOUT_EVERY.indexOf(v.every) + 1);
      t.anchor = /^\d{4}-\d{2}-\d{2}$/.test(v.anchor || "") ? v.anchor : addDaysIso(0);
      t.kind = KIND_ORDER.find(k => TODO_KINDS[k].label === v.kind) || "fitness";
      if (!w) fitness.plan.push(t);
      saveFitness();
    },
    w ? () => { fitness.plan = fitness.plan.filter(x => x.id !== id); saveFitness(); } : null);
}
// This week's planned workouts and how many got done; and the last 4 weeks
function workoutWeekStats(){
  const today = addDaysIso(0), ws = weekStartIso(today);
  let done = 0, total = 0, p4 = 0, d4 = 0;
  for (let i = 0; i < 7; i++){
    const iso = isoDate(new Date(noonOf(ws).getTime() + i * 864e5));
    workoutsOn(iso).forEach(w => { total++; if (workoutDone(iso, w.id)) done++; });
  }
  for (let i = 1; i <= 28; i++){ const iso = addDaysIso(-i); workoutsOn(iso).forEach(w => { p4++; if (workoutDone(iso, w.id)) d4++; }); }
  return {done, total, p4, d4};
}
// To-Do's Workouts card: the weekly plan (tap to edit, drag to reorder)
function workoutsCardHtml(){
  const wk = workoutWeekStats();
  const plan = fitness.plan.map(w => `<button class="fp-row" data-sort-id="${w.id}" data-action="fitness-workout-edit" data-workout-id="${w.id}">
      ${kindIconHtml({kind:w.kind, text:w.name})}<span class="fp-name">${escapeHtml(w.name)}<i>${escapeHtml(workoutMeta(w))}</i></span>${CHEVRON_RIGHT}</button>`).join("");
  return collapsibleCard({id:"fit-plan", title:"Workouts", insight:fitness.plan.length ? `${wk.done}/${wk.total} this week` : "None",
    body:(plan || `<div class="empty">Add your workouts and they show up in your to-dos on their days.</div>`)
      + (wk.p4 ? `<div class="fw-foot">Last 4 weeks: <b>${wk.d4} of ${wk.p4}</b> done</div>` : "")
      + `<button class="add-row" data-action="fitness-workout-add">+ Add workout</button>`});
}
function renderFitness(){
  const el = document.getElementById("panel-jazz3");
  if (!el) return;
  const today = addDaysIso(0), s = weightStatus();
  // 1. Weight
  let wBody;
  if (s.cur == null && fitness.goal == null){
    wBody = `<div class="empty">Track your weight toward a goal: log a weigh-in and set where you're headed.</div>
      <div class="goal-actions"><button class="goal-add" data-action="fitness-log-weight">+ Log weight</button><button class="goal-hist" data-action="fitness-weight-goal">Set goal</button></div>`;
  } else {
    const dir = s.change > 0 ? "Up" : s.change < 0 ? "Down" : "No change";
    const rate = s.rate != null ? `${s.rate > 0 ? "+" : ""}${s.rate} lb/week ${s.rateAll ? "on average" : "lately"}` : "Log a few weigh-ins to see your pace";
    wBody = `<div class="weight-top">
        <div class="weight-now"><b>${s.cur != null ? s.cur : "—"}</b><span>lb</span></div>
        <button class="weight-goal" data-action="fitness-weight-goal">${s.goal != null ? (s.reached ? `${BOX_CHECK_SVG}Goal ${s.goal} reached` : `Goal ${s.goal} · <b>${s.toGo} lb to go</b>`) : "Set a goal"}</button>
      </div>
      ${s.goal != null && s.start != null ? `<div class="progress-bar"><div class="progress-fill" style="width:${s.pct}%"></div></div>
        <div class="weight-scale"><span>${s.start}</span><span>${s.pct}%</span><span>${s.goal}</span></div>` : ""}
      <div class="goal-outlook">
        ${s.change != null ? `<div>${dir}${s.change ? ` <b>${Math.abs(s.change)} lb</b>` : ""} since you started at ${s.start}</div>` : ""}
        ${(a => a ? `<div>Since ${escapeHtml(noonOf(a.since).toLocaleDateString('en-US', {month:'short', year:a.since.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric'}))}: <b>${a.change > 0 ? "+" : ""}${a.change} lb</b> · about ${a.perMonth > 0 ? "+" : ""}${a.perMonth} lb a month</div>` : "")(weightAllTime())}
        <div>${escapeHtml(rate)}${s.eta ? ` · At this pace: <b>${escapeHtml(noonOf(s.eta).toLocaleDateString('en-US', {month:'short', day:'numeric'}))}</b>` : ""}</div>
      </div>
      <button class="weigh-day-link" data-action="fitness-weigh-day">${CALENDAR_ICON}<span>${weighDay() < 0 ? "Weigh-in reminder off" : `Weigh-in day: ${WEEKDAYS[weighDay()]}s`}</span><b>Change</b></button>
      ${weightChartHtml()}
      ${weightMonthsHtml()}
      <div class="goal-actions">
        <button class="goal-add" data-action="fitness-log-weight">+ Log weight</button>
        ${fitness.weights.length ? `<button class="goal-hist" data-action="fitness-weigh-history" aria-expanded="${showWeighIns}">Weigh-ins (${fitness.weights.length})${CHEVRON_DOWN}</button>` : ""}
      </div>
      ${showWeighIns ? `<div class="goal-entries">${fitness.weights.slice().reverse().map(w => `<button class="goal-entry" data-action="fitness-weigh-edit" data-weight-id="${w.id}">
          <span>${escapeHtml(noonOf(w.date).toLocaleDateString('en-US', {month:'short', day:'numeric', year:w.date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric'}))}</span>
          <span class="goal-note"></span><b>${w.lbs} lb</b></button>`).join("")}</div>` : ""}`;
  }
  // The Jazz 3.0 tab is a set of sections; Fitness is the first
  let html = j3HeroHtml(s) + `<div class="j3-sec">${KIND_SVG('<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>')}Fitness</div>`;
  html += collapsibleCard({id:"weight-card", title:"Weight", insight:s.cur != null && s.goal != null ? (s.reached ? "Goal reached" : `${s.cur} → ${s.goal}`) : s.cur != null ? `${s.cur} lb` : "Not set", body:wBody});
  html += plan3SectionsHtml();
  el.innerHTML = html;
}

