// todo-dates.js - To-do dates, quick-add parsing and recurring to-dos.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- RENDER: HOME ----------
// ---------- to-do dates ----------
// A to-do's `due` is a local "YYYY-MM-DD" string, or null for Anytime. Older
// data stored `day` (a bare weekday name with no real date); migrateTodoDays()
// converts that to the next occurrence of the weekday, today included.
// Date math runs at local noon so DST shifts can't push a day over a boundary.
const STAR_ICON_SMALL = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>`;
// calendars run Sunday → Saturday
const WEEK_LETTERS = ["S","M","T","W","T","F","S"];
const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function isoDate(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function noonOf(iso){ const [y,m,d] = iso.split("-").map(Number); return new Date(y, m-1, d, 12); }
function addDaysIso(n){ const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+n); return isoDate(d); }
function daysFromToday(iso){
  const now = new Date(); now.setHours(12,0,0,0);
  return Math.round((noonOf(iso) - now) / 86400000);
}
function nextWeekdayIso(dayIdx){ return addDaysIso((dayIdx - new Date().getDay() + 7) % 7); }
function dueLabel(iso){
  const n = daysFromToday(iso);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n > 1 && n < 7) return WEEKDAYS[noonOf(iso).getDay()];
  return noonOf(iso).toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'});
}
// Groups in display order. Overdue and Today sit above Anytime because they're
// time-critical and usually short; Anytime stays near the top so new to-dos
// (undated by default) land in view.
function todoGroup(t){
  if (!t.due) return "anytime";
  const n = daysFromToday(t.due);
  if (n < 0 && t.days > 1 && daysFromToday(todoEnd(t)) >= 0) return "today"; // multi-day, still running
  if (n < 0) return "overdue";
  if (n === 0) return "today";
  return n < 7 ? "d" + n : "later";
}
function todoGroups(){
  const g = [
    {key:"overdue", label:"Overdue", due:"keep"},
    {key:"today", label:"Today", due:addDaysIso(0)},
    {key:"anytime", label:"Anytime", due:""},
    {key:"d1", label:"Tomorrow", due:addDaysIso(1)}
  ];
  for (let n = 2; n < 7; n++) g.push({key:"d"+n, label:WEEKDAYS[noonOf(addDaysIso(n)).getDay()], due:addDaysIso(n)});
  g.push({key:"later", label:"Later", due:"keep"});
  return g;
}
function migrateTodoDays(list){
  let changed = false;
  list.forEach(t => {
    if ("day" in t){
      if (t.due === undefined){
        const i = WEEKDAYS.indexOf(t.day);
        t.due = i >= 0 ? nextWeekdayIso(i) : null;
      }
      delete t.day;
      changed = true;
    }
    if (t.due === undefined){ t.due = null; changed = true; }
  });
  return changed;
}
// Trailing date word in a new to-do: "dentist fri", "call mom tomorrow",
// "pay rent by today". Only the final word counts, and the composer lights up
// the matching chip (tap it to dismiss), so a title that legitimately ends in
// a day name can be kept as plain text.
const DAY_ALIASES = {sun:0, mon:1, tue:2, wed:3, thu:4, fri:5, sat:6};
function parseQuickAdd(raw){
  const m = raw.match(/^(.*?)\s+(?:on\s+|by\s+)?(today|tonight|tomorrow|tmrw|tmr|sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)$/i);
  if (!m || !m[1].trim()) return {text:raw, due:null};
  const w = m[2].toLowerCase();
  let due;
  if (w === "today" || w === "tonight") due = addDaysIso(0);
  else if (w.startsWith("tom") || w.startsWith("tm")) due = addDaysIso(1);
  else due = nextWeekdayIso(DAY_ALIASES[w.slice(0,3)]);
  return {text:m[1].trim(), due};
}
// ---------- recurring to-dos ----------
// A repeating to-do is one item with a `repeat` rule and a due date. Ticking it
// records a done copy for that date (so Completed and Home's ring show it) and
// moves the item on to its next date after today. Later dates are projected on
// Home's calendar but not stored.
const REPEATS = {
  daily:    {label:"Every day", short:"Daily"},
  weekdays: {label:"Weekdays", short:"Weekdays"},
  weekly:   {label:"Every week", short:"Weekly"},
  biweekly: {label:"Every 2 weeks", short:"Every 2 weeks"},
  monthly:  {label:"Every month", short:"Monthly"},
  yearly:   {label:"Every year", short:"Yearly"},
  weeks:    {label:"Every N weeks…", short:"Every N weeks"},  // custom: t.every weeks
  months:   {label:"Every N months…", short:"Every N months"}, // custom: t.every months
};
const CUSTOM_REPEATS = {weeks:"weeks", months:"months"};
function todoEvery(t){ return CUSTOM_REPEATS[t.repeat] ? Math.max(1, Math.min(99, parseInt(t.every, 10) || 2)) : 1; }
// the next date in a to-do's series
function todoNext(iso, t){ return nextRepeatIso(iso, t.repeat, todoRepeatDay(t), todoEvery(t)); }
// Multi-day to-dos: `days` (2–60) runs from the due date. Its last day:
function todoEnd(t){ return t.due && t.days > 1 ? isoDate(new Date(noonOf(t.due).getTime() + (t.days - 1) * 864e5)) : t.due; }
function spansOn(t, iso){ return !!t.due && t.due <= iso && iso <= todoEnd(t); }
function spanMeta(t, iso){
  if (!(t.days > 1) || !spansOn(t, iso)) return [];
  return [`Day ${Math.round((noonOf(iso) - noonOf(t.due)) / 864e5) + 1} of ${t.days}`];
}
function spanRange(t){
  const f = iso => noonOf(iso).toLocaleDateString('en-US', {month:'short', day:'numeric'});
  return t.days > 1 ? `${f(t.due)} – ${f(todoEnd(t))}` : "";
}
// `day` is the series' own day of month, so a repeat on the 31st lands on the
// 30th in a 30-day month and goes back to the 31st after (no drift to the 28th)
function nextRepeatIso(iso, repeat, day, every = 1){
  if (repeat === "monthly") return addMonthsIso(iso, 1, day);
  if (repeat === "months") return addMonthsIso(iso, every, day);
  if (repeat === "yearly") return addMonthsIso(iso, 12, day); // Feb 29 → Feb 28, back to the 29th in a leap year
  const d = noonOf(iso);
  if (repeat === "daily") d.setDate(d.getDate() + 1);
  else if (repeat === "weekdays"){ do d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6); }
  else if (repeat === "weekly") d.setDate(d.getDate() + 7);
  else if (repeat === "biweekly") d.setDate(d.getDate() + 14);
  else if (repeat === "weeks") d.setDate(d.getDate() + 7 * every);
  return isoDate(d);
}
function dayOf(iso){ return iso ? Number(iso.slice(8, 10)) : undefined; }
function todoRepeatDay(t){ return t.repeatDay || dayOf(t.due); }
function ordinal(n){ const s = ["th","st","nd","rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function repeatLabel(t){
  const r = REPEATS[t.repeat];
  if (!r) return "";
  if (!t.due || t.repeat === "daily" || t.repeat === "weekdays") return r.short;
  const d = noonOf(t.due);
  if (t.repeat === "monthly") return `Monthly on the ${ordinal(todoRepeatDay(t))}`;
  if (t.repeat === "yearly") return `Yearly on ${noonOf(t.due).toLocaleDateString('en-US', {month:'short'})} ${todoRepeatDay(t)}`;
  if (t.repeat === "months") return `Every ${todoEvery(t)} months on the ${ordinal(todoRepeatDay(t))}`;
  if (t.repeat === "weeks") return `Every ${todoEvery(t)} weeks · ${WEEKDAYS[d.getDay()]}s`;
  return `${r.short} · ${WEEKDAYS[d.getDay()]}s`;
}
// Does a repeating to-do land on `iso`, after its current (stored) date?
function occursOn(t, iso){
  if (!t.repeat || t.done || !t.due || iso <= todoEnd(t)) return false;
  const len = t.days > 1 ? t.days : 1;
  let d = t.due;
  for (let i = 0; i < 800 && d <= iso; i++){
    d = todoNext(d, t);
    if (d <= iso && iso < isoDate(new Date(noonOf(d).getTime() + len * 864e5))) return true; // within a later run
  }
  return false;
}
function completeRepeating(t){
  const today = addDaysIso(0);
  const occurrence = t.due || today;
  const prev = {due:t.due, subitems:JSON.parse(JSON.stringify(t.subitems || []))};
  const copy = {id:genId("todo"), text:t.text, done:true, due:occurrence, starred:false, seriesId:t.id,
    subitems:prev.subitems.map(s => ({...s, id:genId("sub")})), completedAt:Date.now()};
  const day = todoRepeatDay(t);
  if ((t.repeat === "monthly" || t.repeat === "months" || t.repeat === "yearly") && !t.repeatDay) t.repeatDay = day; // pin it before the first clamp
  let next = todoNext(occurrence, t);
  if (occurrence <= today) while (next <= today) next = todoNext(next, t);
  t.due = next;
  (t.subitems || []).forEach(s => { s.done = false; }); // fresh checklist each time
  todoList.splice(todoList.indexOf(t) + 1, 0, copy);
  saveContent("todo-content", todoList, {toast:false});
  renderHome();
  showUndoToast(`Done · next ${dueLabel(next)}`, () => {
    todoList = todoList.filter(x => x.id !== copy.id);
    const cur = todoList.find(x => x.id === t.id); // a sync may have replaced the object
    if (cur){ cur.due = prev.due; cur.subitems = prev.subitems; }
    saveContent("todo-content", todoList);
    renderHome();
  });
}

