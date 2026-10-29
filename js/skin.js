// skin.js - Skin & Hair tab: routine, wash-day schedule and rules.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- RENDER: SKIN/HAIR ----------
// ---------- SKIN & HAIR ROUTINE ----------
// One routine instead of seven per-day copies: AM steps, PM steps, and a
// wash-day PM that replaces PM on wash days. A step with `days` (weekday
// numbers, 0 = Sun) only happens on those days; no `days` means every day.
// Older data stored seven full day lists (skin-days-content); routineFromDays()
// folds them into this shape without losing which step happens on which day.
// Migrated step ids are derived from the step's text, so every device computes
// the same ids and synced check-offs keep pointing at the same steps.
const DAY_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
let openWeekDays = new Set();

function decodeEntities(s){
  return String(s).replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&");
}
function stableStepId(band, label, product){
  const str = band + "|" + label + "|" + product;
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return band + "-" + (h >>> 0).toString(36);
}
function routineFromDays(days){
  const toStep = (band, raw) => {
    const label = decodeEntities(raw[0]), product = decodeEntities(raw[1]);
    const step = {id:stableStepId(band, label, product), label, product};
    if (raw[2]) step.note = decodeEntities(raw[2]);
    return step;
  };
  // Ordered union of every day's list; each step remembers the days it was on
  const merge = (band, lists) => {
    const merged = [];
    lists.forEach(({dow, steps}) => {
      let at = 0;
      steps.forEach(raw => {
        const step = toStep(band, raw);
        let i = merged.findIndex(m => m.step.id === step.id);
        if (i < 0){ merged.splice(at, 0, {step, days:new Set()}); i = at; }
        merged[i].days.add(dow);
        at = i + 1;
      });
    });
    return merged.map(({step, days}) => {
      if (days.size < lists.length){
        step.days = [...days].sort((a,b) => a - b);
        // a note like "Mon / Wed / Fri only" now duplicates `days`
        if (step.note && / only$/i.test(step.note)) delete step.note;
      }
      return step;
    });
  };
  const week = days.map(d => ({...d, dow:WEEKDAYS.indexOf(d.day)})).filter(d => d.dow >= 0);
  const washDay = week.find(d => d.pmWash && d.pmWash.length);
  return {
    am: merge("am", week.map(d => ({dow:d.dow, steps:d.am || []}))),
    pm: merge("pm", week.map(d => ({dow:d.dow, steps:d.pm || []}))),
    washPm: washDay ? merge("washPm", [{dow:washDay.dow, steps:washDay.pmWash}]) : []
  };
}
function routineForDate(date){
  const dow = date.getDay();
  const on = s => !s.days || s.days.includes(dow);
  const wash = isWashDate(date) && skinRoutine.washPm.length > 0;
  return {am:skinRoutine.am.filter(on), pm:wash ? skinRoutine.washPm : skinRoutine.pm.filter(on), wash};
}
function todayChecks(){
  const c = routineChecks[isoDate(new Date())];
  return {am:(c && c.am) || [], pm:(c && c.pm) || [], amDone:!!(c && c.amDone), pmDone:!!(c && c.pmDone)};
}
// `key` defaults to today; the Wash hair row can also tick another day's steps
function toggleRoutineStep(band, id, key = isoDate(new Date())){
  const day = routineChecks[key] || (routineChecks[key] = {am:[], pm:[]});
  const i = day[band].indexOf(id);
  if (i >= 0) day[band].splice(i, 1); else day[band].push(id);
  const wasDone = !!day[band + "Done"];
  // amDone/pmDone are recorded when ticking so the streak survives later routine edits
  const r = routineForDate(noonOf(key));
  // a band with no steps that day counts as done, so it can't block the streak
  day.amDone = r.am.every(s => day.am.includes(s.id));
  day.pmDone = r.pm.every(s => day.pm.includes(s.id));
  const cutoff = addDaysIso(-400); // about a year of history, so long streaks keep counting
  Object.keys(routineChecks).forEach(k => { if (k < cutoff) delete routineChecks[k]; });
  try{
    localStorage.setItem("routine-checks", JSON.stringify(routineChecks));
    markDataChanged();
  }catch(e){ showToast("Save failed — storage may be full or disabled", true); }
  if (!wasDone && day[band + "Done"] && key === isoDate(new Date())) showToast(band === "am" ? "Morning routine done" : "Evening routine done");
  renderSkin();
  renderHome(); // both to-do views show the Wash hair row
}
// Consecutive days with both AM and PM finished, counting today only once it's done
function routineStreak(){
  const d = new Date(); d.setHours(12, 0, 0, 0);
  const full = k => { const c = routineChecks[k]; return !!(c && c.amDone && c.pmDone); };
  if (!full(isoDate(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (full(isoDate(d))){ n++; d.setDate(d.getDate() - 1); }
  return n;
}
function daysText(days){
  const k = days.join(",");
  if (k === "1,2,3,4,5") return "Weekdays";
  if (k === "0,6") return "Weekends";
  return [...days].sort((a,b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => DAY_SHORT[d]).join(" · ");
}
function routineStepText(s){
  return `<b>${escapeHtml(s.label)}</b> — ${escapeHtml(s.product)}${s.note ? `<span class="note">${escapeHtml(s.note)}</span>` : ""}`;
}
function toggleWeekDay(key){
  if (openWeekDays.has(key)) openWeekDays.delete(key); else openWeekDays.add(key);
  renderSkin();
}

// AM/PM bands on the Today card fold away: a finished band closes itself, an
// unfinished one stays open, and a tap overrides either for the rest of the day.
const routineBandChoice = {}; // "YYYY-MM-DD:am" -> open?
function routineBandOpen(key, steps, done){
  const k = `${isoDate(new Date())}:${key}`;
  return k in routineBandChoice ? routineBandChoice[k] : !(steps.length && done === steps.length);
}
function toggleRoutineBand(key){
  const r = routineForDate(new Date()), steps = r[key], checks = todayChecks();
  const done = steps.filter(s => checks[key].includes(s.id)).length;
  routineBandChoice[`${isoDate(new Date())}:${key}`] = !routineBandOpen(key, steps, done);
  renderSkin();
}
function renderSkin(){
  const el = document.getElementById("panel-skin");
  const now = new Date();
  const todayKey = isoDate(now);
  const r = routineForDate(now);
  const checks = todayChecks();
  const streak = routineStreak();

  // 1. Today: tick-off checklist
  const band = (key, label, steps) => {
    const done = steps.filter(s => checks[key].includes(s.id)).length;
    const rows = steps.map(s => {
      const on = checks[key].includes(s.id);
      return `<button class="routine-step ${on?'done':''}" role="checkbox" aria-checked="${on}" data-action="routine-step" data-band="${key}" data-step-id="${escapeAttr(s.id)}"><span class="box">${BOX_CHECK_SVG}</span><span class="routine-text">${routineStepText(s)}</span></button>`;
    }).join("");
    const open = routineBandOpen(key, steps, done);
    const complete = steps.length > 0 && done === steps.length;
    return `<div class="routine-band ${key} ${open ? 'open' : ''}">
        <button class="routine-band-head" data-action="routine-band" data-band="${key}" aria-expanded="${open}"><span class="label">${label}</span><span class="routine-count ${complete ? 'complete' : ''}">${complete ? `${BOX_CHECK_SVG}Done` : `${done}/${steps.length}`}</span>${CHEVRON_DOWN}</button>
        ${open ? (rows || '<div class="empty">No steps today.</div>') : ''}
      </div>`;
  };
  let html = `<div class="card routine-today">
      <div class="glance-head"><h3 style="margin:0;">Today — ${WEEKDAYS[now.getDay()]}${r.wash ? '<span class="badge wash">Wash day</span>' : ''}</h3>${streak ? `<span class="insight">${streak}-day streak</span>` : ''}</div>
      ${band("am", "AM", r.am)}
      ${band("pm", r.wash ? "PM · wash day" : "PM", r.pm)}
    </div>`;

  // 2. This week, Sun–Sat: only what differs from the base routine; tap a day for its full list
  const monday = new Date(now); monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - monday.getDay()); // (the week's Sunday)
  let week = "";
  for (let i = 0; i < 7; i++){
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const key = isoDate(d);
    const rd = routineForDate(d);
    const extras = [...rd.am, ...(rd.wash ? [] : rd.pm)].filter(s => s.days).map(s => escapeHtml(s.label));
    if (rd.wash) extras.unshift("Wash day");
    const log = routineChecks[key];
    const finished = !!(log && log.amDone && log.pmDone);
    const open = openWeekDays.has(key);
    const list = steps => steps.map((s, n) => `<div class="step"><span class="n">${n+1}.</span><div>${routineStepText(s)}</div></div>`).join("");
    week += `<div class="week-day ${key === todayKey ? 'today' : ''} ${open ? 'open' : ''}">
        <button class="week-day-head" data-action="week-day" data-date="${key}" aria-expanded="${open}">
          <span class="week-day-name">${DAY_SHORT[d.getDay()]}</span>
          <span class="week-day-extras">${key === todayKey ? '<span class="badge today">Today</span>' : ''}${extras.join(" · ") || "Base routine"}</span>
          ${finished ? `<span class="week-day-done" aria-label="Routine done">${BOX_CHECK_SVG}</span>` : ''}
          ${CHEVRON_DOWN}
        </button>
        ${open ? `<div class="week-day-body"><div class="wl am">AM</div>${list(rd.am)}<div class="wl pm">${rd.wash ? 'PM · wash day' : 'PM'}</div>${list(rd.pm)}</div>` : ''}
      </div>`;
  }
  html += `<div class="card"><div class="glance-head"><h3 style="margin:0;">This week</h3></div>${week}</div>`;

  // 3. Wash-day schedule: frequency + a calendar to pick the date
  const nextWash = nextWashDate();
  const nextLabel = daysUntilWashDay() === 0 ? "today"
    : nextWash.toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'});
  html += collapsibleCard({id:"wash-card", title:"Wash day",
    insight:`${washFrequencyLabel()} · next ${nextLabel}`, body:washCalendarHtml()});

  // 4. The routine itself, edited in one place
  const editorBand = key => {
    const steps = skinRoutine[key];
    const head = key === "washPm"
      ? `Wash-day PM<span class="routine-sub">replaces PM on wash days</span>`
      : key.toUpperCase();
    const rows = steps.map((s, n) => `<button class="step editable" data-sort-id="${s.id}" data-action="routine-step-edit" data-step-band="${key}" data-step-id="${escapeAttr(s.id)}">
        <span class="n">${n+1}.</span><div>${routineStepText(s)}${s.days ? `<span class="note">${daysText(s.days)} only</span>` : ''}</div>
      </button>`).join("");
    return `<div class="band ${key === 'am' ? 'am' : 'pm'}" data-band="${key}"><div class="label">${head}</div>
        ${rows || '<div class="empty">No steps.</div>'}
        <button class="add-row" data-action="routine-step-add" data-step-band="${key}">+ Add step</button>
      </div>`;
  };
  html += collapsibleCard({id:"routine-card", title:"Routine", insight:`${skinRoutine.am.length} AM · ${skinRoutine.pm.length} PM`,
    wrapBody:false, body:`${editorBand('am')}${editorBand('pm')}${editorBand('washPm')}`});

  // 5. Key rules (only shown once there are some)
  if (!skinRules.length){ el.innerHTML = html; return; }
  let rules = skinRules.map((r, i) => `<button class="rule editable" data-sort-id="${i}" data-action="skin-rule-edit" data-index="${i}">${escapeHtml(r)}</button>`).join("")
    + `<button class="add-row" data-action="skin-rule-add">+ Add rule</button>`;
  html += collapsibleCard({id:"rules-skin", title:"Key rules", insight:`${skinRules.length} rules`, body:rules});
  el.innerHTML = html;
}
function routineStepFields(band){
  const fields = [
    {key:"label", label:"Step name", type:"text"},
    {key:"product", label:"Product / description", type:"text"},
    {key:"note", label:"Note (optional)", type:"text"}
  ];
  if (band !== "washPm") fields.push({key:"days", label:"Only on these days — leave all off for every day", type:"days"});
  return fields;
}
function applyStepValues(step, v){
  step.label = v.label; step.product = v.product;
  if (v.note) step.note = v.note; else delete step.note;
  if (v.days && v.days.length && v.days.length < 7) step.days = v.days; else delete step.days;
}
function saveRoutine(){
  saveContent("skin-routine-content", skinRoutine);
  renderSkin();
  renderHomePanel();
}
function editRoutineStep(band, id){
  const s = skinRoutine[band].find(x => x.id === id);
  if (!s) return;
  openModal("Edit step", routineStepFields(band), {label:s.label, product:s.product, note:s.note || "", days:s.days || []},
    v => { if (!v.label || !v.product) return; applyStepValues(s, v); saveRoutine(); },
    () => { skinRoutine[band] = skinRoutine[band].filter(x => x.id !== id); saveRoutine(); }
  );
}
function addRoutineStep(band){
  openModal("Add step", routineStepFields(band), {days:[]},
    v => {
      if (!v.label || !v.product) return;
      const step = {id:genId(band)};
      applyStepValues(step, v);
      // keep "… — last step" entries (SPF, lash serum) last
      const list = skinRoutine[band], last = list[list.length - 1];
      if (last && /last step/i.test(last.label)) list.splice(list.length - 1, 0, step); else list.push(step);
      saveRoutine();
    }
  );
}

// ---------- wash-day schedule ----------
// Wash day repeats every `everyDays` days counting from `anchor` (a YYYY-MM-DD
// wash day). It's stored on the routine (skinRoutine.wash) so it syncs and backs
// up with it. Routines saved before the schedule was editable fall back to the
// original cadence: every 2 weeks from Thu Jul 16, 2026.
const DEFAULT_WASH = {anchor:"2026-07-16", everyDays:14};
const WASH_FREQUENCIES = [[7, "Every week"], [10, "Every 10 days"], [14, "Every 2 weeks"], [21, "Every 3 weeks"], [28, "Every 4 weeks"]];
let washCalOffset = 0; // months from the current one shown in the wash-day calendar
function washSchedule(){
  const w = skinRoutine && skinRoutine.wash;
  return w && /^\d{4}-\d{2}-\d{2}$/.test(w.anchor) && Number.isInteger(w.everyDays) && w.everyDays >= 1 && w.everyDays <= 365 ? w : DEFAULT_WASH;
}
function washFrequencyLabel(){
  const n = washSchedule().everyDays;
  const hit = WASH_FREQUENCIES.find(([d]) => d === n);
  return hit ? hit[1] : `Every ${n} days`;
}
function isWashDate(date){
  const {anchor, everyDays} = washSchedule();
  const diff = Math.round((noonOf(isoDate(date)) - noonOf(anchor)) / 86400000);
  return ((diff % everyDays) + everyDays) % everyDays === 0;
}
function nextWashDate(){
  const d = new Date(); d.setHours(12, 0, 0, 0);
  for (let i = 0; i < washSchedule().everyDays && !isWashDate(d); i++) d.setDate(d.getDate() + 1);
  return d;
}
function daysUntilWashDay(){ return daysFromToday(isoDate(nextWashDate())); }
function setWashSchedule(next, message){
  const prev = skinRoutine.wash ? {...skinRoutine.wash} : null;
  skinRoutine.wash = next;
  saveRoutine();
  showUndoToast(message, () => {
    if (prev) skinRoutine.wash = prev; else delete skinRoutine.wash;
    saveRoutine();
  });
}
function setWashDate(iso){
  const label = noonOf(iso).toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'});
  setWashSchedule({anchor:iso, everyDays:washSchedule().everyDays}, `Wash day set to ${label}`);
}
function setWashFrequency(n){
  // keep the series lined up with the next upcoming wash day
  setWashSchedule({anchor:isoDate(nextWashDate()), everyDays:n}, `Wash day: ${WASH_FREQUENCIES.find(([d]) => d === n)[1].toLowerCase()}`);
}
function shiftWashMonth(delta){ washCalOffset += delta; renderSkin(); }
function washCalendarHtml(){
  const first = new Date(); first.setHours(12, 0, 0, 0); first.setDate(1); first.setMonth(first.getMonth() + washCalOffset);
  const month = first.getMonth(), todayKey = isoDate(new Date());
  const lead = first.getDay(); // Sunday-first grid
  const daysInMonth = new Date(first.getFullYear(), month + 1, 0).getDate();
  let cells = WEEK_LETTERS.map(d => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < lead; i++) cells += `<div class="cal-day blank"></div>`;
  for (let n = 1; n <= daysInMonth; n++){
    const d = new Date(first.getFullYear(), month, n, 12);
    const key = isoDate(d), wash = isWashDate(d);
    const cls = ["cal-day", wash ? "wash" : "", key === todayKey ? "today" : "", key < todayKey ? "past" : ""].filter(Boolean).join(" ");
    const label = d.toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'}) + (wash ? ", wash day" : "");
    cells += `<button class="${cls}" data-action="wash-date" data-date="${key}" aria-label="${label}"${wash ? ' aria-pressed="true"' : ''}>${n}</button>`;
  }
  const freq = washSchedule().everyDays;
  const chips = WASH_FREQUENCIES.map(([n, text]) =>
    `<button class="filter-chip ${n === freq ? "on" : ""}" aria-pressed="${n === freq}" data-action="wash-frequency" data-days="${n}">${text}</button>`).join("");
  return `<div class="wash-freq">${chips}</div>
    <div class="cal-head">
      <button class="cal-nav" data-action="wash-month" data-delta="-1" aria-label="Previous month">‹</button>
      <span>${first.toLocaleDateString('en-US', {month:'long', year:'numeric'})}</span>
      <button class="cal-nav" data-action="wash-month" data-delta="1" aria-label="Next month">›</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <p class="footnote">Tap a date to make it a wash day — the schedule repeats from there.</p>`;
}
// Collapsible card used across tabs: the header (title, insight badge, chevron)
// toggles the body; open state lives in openPinned.
// No Edit mode: tapping an item opens its editor, and "+ Add" rows sit at the
// bottom of each card (the way Android apps do it)
function collapsibleCard({id, title, insight = "", insightId = "", body = "", wrapBody = true, innerId = ""}){
  return `<div class="card pinned ${openPinned.has(id) ? 'open' : ''}" id="${id}">
    <div class="coll-head" data-action="coll-toggle" data-card-id="${escapeAttr(id)}">
      <div style="display:flex;align-items:center;gap:8px;"><h3>${title}</h3><span class="insight"${insightId ? ` id="${insightId}"` : ""}>${insight}</span></div>
      <div style="display:flex;align-items:center;gap:8px;">
        ${CHEVRON_DOWN}
      </div>
    </div>
    <div class="coll-body">${wrapBody ? `<div class="coll-inner"${innerId ? ` id="${innerId}"` : ""}>${body}</div>` : body}</div>
  </div>`;
}
function toggleCompletedTodos(){
  if (openPinned.has('todo-completed')) openPinned.delete('todo-completed'); else openPinned.add('todo-completed');
  renderHome();
}
function toggleRules(id){
  if (openPinned.has(id)) openPinned.delete(id); else openPinned.add(id);
  document.getElementById(id).classList.toggle("open");
}
function editSkinRule(i){
  openModal("Edit rule", [{key:"text",label:"Rule",type:"textarea"}], {text:skinRules[i]},
    (v) => { if(!v.text) return; skinRules[i]=v.text; saveContent("skin-rules-content", skinRules); renderSkin(); },
    () => { skinRules.splice(i,1); saveContent("skin-rules-content", skinRules); renderSkin(); }
  );
}
function addSkinRule(){
  openModal("Add rule", [{key:"text",label:"Rule",type:"textarea"}], {},
    (v) => { if(!v.text) return; skinRules.push(v.text); saveContent("skin-rules-content", skinRules); renderSkin(); }
  );
}
