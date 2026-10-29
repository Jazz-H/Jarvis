// composer.js - Composer: the floating + button's add sheet (to-do, shopping, budget modes).
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- COMPOSER (the floating + button's sheet) ----------
// One bottom sheet for adding things, in a mode picked by the current tab:
// to-dos (Home, To-Do), shopping items (Shopping), spending/bills/goals (Budget).
// Skin & Hair has no + button: adding routine steps is a rare edit there, and the
// tab's everyday action is ticking steps off.
// Every mode is built for adding several in a row: Enter (or Add) saves, clears
// the text, keeps the keyboard up, and counts adds in the header; the sheet stays
// open until dismissed. Typed shortcuts — a trailing day word for to-dos ("dentist
// fri"), a trailing price for shopping ("helmet $250") — light up their chip;
// tapping a lit chip keeps the words as plain text.
const TODO_MAX_LEN = 200;
const COMPOSER_MODES = {
  todo:   {title:"New to-do", add:"Add to-do", fab:"Add a to-do", placeholder:"What needs doing? Try “dentist fri”"},
  shop:   {title:"New item", add:"Add to list", fab:"Add to shopping list", placeholder:"What to buy? Try “helmet $250”"},
  money:  {title:"Add to budget", add:"Add", fab:"Add spending or a bill", placeholder:"What did you spend on? Try “groceries $54”"},
};
const FAB_MODE_BY_TAB = {home:"todo", todo:"todo", wants:"shop", budget:"money"};
const GEAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
const LATER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const CALENDAR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
let composer = null;
function fabMode(){ return FAB_MODE_BY_TAB[currentTab] || "todo"; }
function composerFresh(mode, added, prev){
  const base = {mode, added, ignoreParse:false, showMore:false};
  if (mode === "todo"){
    // On Home with a later day picked in the calendar, new to-dos land on that day
    // (a typed day word still wins over it)
    const preset = currentTab === "home" && homeSelected() > addDaysIso(0) ? homeSelected() : null;
    return {...base, date:null, manual:false, preset, star:false, repeat:null};
  }
  if (mode === "shop"){
    if (prev) return {...base, kind:prev.kind, cat:prev.cat, wcat:prev.wcat, high:false, later:false}; // categories stick for batches
    // start in whatever the Shopping filter shows, so new items stay visible
    const f = wantsFilter;
    return {...base, kind:f === "need" || f === "want" ? f : null,
      cat:f === "moto" ? "moto" : f === "wardrobe" ? "wardrobe" : "general", wcat:"Other", high:false, later:false};
  }
  if (mode === "money"){
    // type, category and repeat stick for batches; the date goes back to today
    const firstCat = budget.categories[0] ? budget.categories[0].id : null;
    return {...base, type:prev ? prev.type : "expense", cat:prev && budgetCat(prev.cat) ? prev.cat : firstCat,
      date:null, manual:false, repeat:prev ? prev.repeat : "monthly", autopay:false,
      group:prev ? prev.group : "personal", account:prev ? prev.account : null,
      goal:prev && goalById(prev.goal) ? prev.goal : (budget.goals[0] || {}).id || null};
  }
  return base;
}
function composerExtraHtml(mode){
  if (mode === "todo") return `<textarea id="composer-subs" rows="3" maxlength="2000" placeholder="Sub-items — one per line"></textarea>`;
  if (mode === "shop") return `<input id="cx-meta" type="text" maxlength="200" placeholder="Notes — size, color, store">`;
  return "";
}
function composerText(){ return document.getElementById("composer-text").value.trim(); }
function composerField(id){ const el = document.getElementById(id); return el ? el.value.trim() : ""; }
function weekendIso(){
  const dow = new Date().getDay();
  return dow === 6 || dow === 0 ? addDaysIso(0) : nextWeekdayIso(6);
}
function composerDue(){
  if (composer.manual) return {due:composer.date, auto:false};
  if (composer.ignoreParse) return {due:composer.preset || null, auto:false};
  const p = parseQuickAdd(composerText());
  return p.due ? {due:p.due, auto:true} : {due:composer.preset || null, auto:false};
}
// "helmet $250" / "boots $119.45": a trailing dollar amount is the price
function parsePrice(raw){
  const m = raw.match(/^(.*?)\s+\$\s?(\d{1,6}(?:\.\d{1,2})?)$/);
  return m && m[1].trim() ? {text:m[1].trim(), price:Number(m[2])} : {text:raw, price:null};
}
// `attrs` is a ready-made delegated-action attribute string from dataAttrs() (see SHELL_CLICK).
function cchip(label, on, attrs, icon = ""){
  return `<button type="button" class="filter-chip ${on ? "on" : ""}" aria-pressed="${on}" ${attrs}>${icon}${label}</button>`;
}
// Builds `data-action="…" data-k="v"` markup for delegated handlers; every value is attribute-escaped.
function dataAttrs(action, data = {}){
  return [`data-action="${escapeAttr(action)}"`, ...Object.entries(data).map(([k, v]) => `data-${k}="${escapeAttr(v)}"`)].join(" ");
}
const cset = (key, val) => dataAttrs("composer-set", {key, val});
const ctoggle = key => dataAttrs("composer-toggle", {key});
function renderComposerChips(){
  const c = composer;
  let row1 = "", row2 = "";
  if (c.mode === "todo"){
    const {due} = composerDue();
    const presets = [["Today", addDaysIso(0)], ["Tomorrow", addDaysIso(1)], ["This weekend", weekendIso()]];
    const presetHit = presets.some(([, iso]) => iso === due);
    row1 = presets.map(([label, iso]) => cchip(label, due === iso, dataAttrs("composer-pick-date", {date:iso}))).join("");
    row1 += cchip(due && !presetHit ? escapeHtml(dueLabel(due)) : "Pick date", !!due && !presetHit,
      due && !presetHit ? dataAttrs("composer-pick-date", {date:due}) : dataAttrs("composer-open-picker"), CALENDAR_ICON);
    row1 += cchip("Star", c.star, ctoggle("star"), c.star ? STAR_FILLED_ICON : STAR_ICON);
    row1 += cchip(c.repeat ? REPEATS[c.repeat].short : "Repeat", !!c.repeat, dataAttrs("composer-repeat-toggle"), REPEAT_ICON);
    if (c.repeat) row2 = Object.entries(REPEATS).filter(([k]) => !CUSTOM_REPEATS[k]).map(([k, r]) => cchip(r.label, c.repeat === k, cset("repeat", k))).join("");
    row1 += cchip("Sub-items", c.showMore, dataAttrs("composer-toggle-more"), SMALL_PLUS_ICON);
  } else if (c.mode === "shop"){
    const price = c.ignoreParse ? null : parsePrice(composerText()).price;
    if (price != null) row1 += cchip(`$${fmtMoney(price)}`, true, dataAttrs("composer-ignore-parse"));
    const kind = c.kind || (c.cat === "wardrobe" ? "need" : "want");
    row1 += cchip("Need", kind === "need", cset("kind", "need"))
      + cchip("Want", kind === "want", cset("kind", "want"));
    row1 += cchip("General", c.cat === "general", cset("cat", "general"))
      + cchip("Moto", c.cat === "moto", cset("cat", "moto"), MOTO_ICON)
      + cchip("Wardrobe", c.cat === "wardrobe", cset("cat", "wardrobe"), SHIRT_ICON);
    row1 += cchip("High priority", c.high, ctoggle("high"), c.high ? STAR_FILLED_ICON : STAR_ICON);
    row1 += cchip("Later", c.later, ctoggle("later"), LATER_ICON);
    row1 += cchip("Notes", c.showMore, dataAttrs("composer-toggle-more"), SMALL_PLUS_ICON);
    if (c.cat === "wardrobe") row2 = [...CAP_CATS, "Other"].map(w => cchip(w, c.wcat === w, cset("wcat", w))).join("");
  } else if (c.mode === "money"){
    const amt = c.ignoreParse ? null : parsePrice(composerText()).price;
    if (amt != null) row1 += cchip(`$${fmtMoney(amt)}`, true, dataAttrs("composer-ignore-parse"));
    row1 += cchip("Expense", c.type === "expense", cset("type", "expense"))
      + cchip("Bill", c.type === "bill", cset("type", "bill"))
      + (budget.goals.length ? cchip("To a goal", c.type === "goal", cset("type", "goal")) : "");
    const date = c.date || addDaysIso(0);
    const presets = c.type === "bill" ? [["Due today", addDaysIso(0)]] : [["Today", addDaysIso(0)], ["Yesterday", addDaysIso(-1)]];
    const hit = presets.some(([, iso]) => iso === date);
    row1 += presets.map(([label, iso]) =>     cchip(label, date === iso, dataAttrs("composer-set-date", {date:iso}))).join("");
        row1 += cchip(hit ? (c.type === "bill" ? "Pick due date" : "Pick date") : escapeHtml(dueLabel(date)), !hit, dataAttrs("composer-open-picker"), CALENDAR_ICON);
    if (c.type === "goal"){
          row2 = budget.goals.map(g => cchip(escapeHtml(g.name), c.goal === g.id, cset("goal", g.id))).join("");
    } else if (c.type === "bill"){
          row1 += cchip("Joint", c.group === "joint", dataAttrs("composer-group-toggle"))
            + cchip("Autopay", c.autopay, ctoggle("autopay"));
      // repeat, then which card/bank pays it
          row2 = Object.entries(BILL_REPEATS).map(([k, r]) => cchip(r.label, c.repeat === k, cset("repeat", k))).join("")
            + budget.accounts.map((a, i) => cchip(escapeHtml(a), c.account === a, dataAttrs("composer-account", {index:i}))).join("");
    } else {
          row2 = budget.categories.map(cat => cchip(escapeHtml(cat.name), c.cat === cat.id, cset("cat", cat.id))).join("");
    }
    document.getElementById("composer-text").placeholder = c.type === "bill" ? "Bill name — try “rent $1200”"
      : c.type === "goal" ? "What is it? Try “bonus $500”" : COMPOSER_MODES.money.placeholder;
  }
  // Price and link stay in view whenever the item is headed for the shopping list
  document.getElementById("composer-buy").hidden = !(c.mode === "shop" || c.mode === "money");
  document.getElementById("cx-price").placeholder = c.mode === "money" ? "Amount" : "Price";
  document.getElementById("cx-link").hidden = c.mode === "money" && c.type !== "bill";
  if (c.mode === "money") document.getElementById("cx-link").placeholder = "Pay link (optional)";
  else document.getElementById("cx-link").placeholder = "Link";
  document.getElementById("composer-chips").innerHTML = row1;
  const r2 = document.getElementById("composer-chips2");
  r2.innerHTML = row2;
  r2.hidden = !row2;
}
function composerTextChanged(){
  if (!composer) return;
  if (!composerText()) composer.ignoreParse = false;
  renderComposerChips();
}
// To-dos: tapping the selected date chip clears the date; any other chip selects its date
function composerPickDate(iso){
  const {due, auto} = composerDue();
  if (due === iso){
    if (auto) composer.ignoreParse = true;
    else { composer.manual = true; composer.date = null; }
  } else {
    composer.manual = true; composer.date = iso;
  }
  renderComposerChips();
}
function composerOpenPicker(){
  const input = document.getElementById("composer-date");
  input.value = "";
  try{ input.showPicker(); }catch(e){ input.focus(); input.click(); }
}
function composerToggleMore(){
  composer.showMore = !composer.showMore;
  const extra = document.getElementById("composer-extra");
  extra.hidden = !composer.showMore;
  renderComposerChips();
  if (composer.showMore){ const first = extra.querySelector("input, textarea"); if (first) first.focus(); }
}
function composerResetFields(){
  document.getElementById("composer-text").value = "";
  const extra = document.getElementById("composer-extra");
  extra.innerHTML = composerExtraHtml(composer.mode);
  extra.hidden = true;
  document.getElementById("cx-price").value = "";
  document.getElementById("cx-link").value = "";
}
function openComposer(mode = "todo"){
  const cfg = COMPOSER_MODES[mode];
  composer = composerFresh(mode, 0);
  document.getElementById("composer-heading").textContent = cfg.title;
  document.getElementById("composer-add-btn").textContent = cfg.add;
  const text = document.getElementById("composer-text");
  text.placeholder = cfg.placeholder;
  document.getElementById("composer-count").textContent = "";
  composerResetFields();
  renderComposerChips();
  const el = document.getElementById("composer");
  el.classList.add("open");
  el.setAttribute("aria-hidden", "false");
  text.focus(); // synchronous with the tap, so phones raise the keyboard
  fitComposerToKeyboard();
}
function closeComposer(){
  const el = document.getElementById("composer");
  el.classList.remove("open");
  el.setAttribute("aria-hidden", "true");
  document.getElementById("composer-sheet").style.transform = "";
  document.activeElement && document.activeElement.blur();
}
function composerAdd(){
  const textEl = document.getElementById("composer-text");
  const raw = composerText().slice(0, TODO_MAX_LEN);
  if (!raw){ textEl.focus(); return; }
  const note = composer.mode === "todo" ? addTodoFromComposer(raw)
    : composer.mode === "shop" ? addWantFromComposer(raw)
    : addMoneyFromComposer(raw);
  if (note === false) return; // not saved; the sheet says why
  composer = composerFresh(composer.mode, composer.added + 1, composer);
  // Feedback stays in the sheet's header: a toast would sit on top of the sheet
  document.getElementById("composer-count").textContent = `${composer.added} added` + (note ? ` · last ${note}` : "");
  composerResetFields();
  renderComposerChips();
  textEl.focus();
}
function addTodoFromComposer(raw){
  const {due, auto} = composerDue();
  const subs = composer.showMore
    ? composerField("composer-subs").split("\n").map(x => x.trim()).filter(Boolean).map(x => ({id:genId("sub"), text:x.slice(0, TODO_MAX_LEN), done:false}))
    : [];
  const t = {id:genId("todo"), text:auto ? parseQuickAdd(raw).text : raw, done:false, due, starred:composer.star, subitems:subs, completedAt:null};
  if (composer.repeat){ t.repeat = composer.repeat; if (!t.due) t.due = addDaysIso(0); t.repeatDay = dayOf(t.due); } // a repeat needs a start date
  // New items go to the top of their group so they land in view, not below the fold
  const at = todoList.findIndex(x => !x.done && todoGroup(x) === todoGroup(t));
  if (at >= 0) todoList.splice(at, 0, t); else todoList.push(t);
  if (subs.length) expandedTodos.add(t.id);
  saveContent("todo-content", todoList, {toast:false}); // the sheet header confirms it
  renderHome();
  if (t.repeat) return `${REPEATS[t.repeat].short.toLowerCase()} from ${dueLabel(t.due)}`;
  return due ? `for ${dueLabel(due)}` : "";
}
function addWantFromComposer(raw){
  const parsed = composer.ignoreParse ? {text:raw, price:null} : parsePrice(raw);
  const typed = composerField("cx-price") !== "" ? Number(composerField("cx-price")) : null;
  const price = typed != null && !isNaN(typed) ? typed : parsed.price;
  const w = {id:genId("want"), name:parsed.text, meta:composer.showMore ? composerField("cx-meta") : "",
    price:price ?? null, link:composerField("cx-link") || null};
  if (composer.kind) w.kind = composer.kind;
  if (composer.high) w.priority = "high";
  if (composer.later) w.later = true;
  setWantCategory(w, composer.cat === "moto" ? "Moto" : composer.cat === "wardrobe" ? "Wardrobe · " + composer.wcat : "General");
  wantsList.push(w);
  saveContent("wants-content", wantsList, {toast:false});
  renderWants(); renderHomePanel();
  return price != null ? `$${fmtMoney(price)}` : "";
}
function addMoneyFromComposer(raw){
  const parsed = composer.ignoreParse ? {text:raw, price:null} : parsePrice(raw);
  const typed = composerField("cx-price") !== "" ? Number(composerField("cx-price")) : null;
  const amount = typed != null && !isNaN(typed) ? typed : parsed.price;
  if (amount == null){
    document.getElementById("composer-count").textContent = "Add an amount — type “$54” or use the Amount box";
    document.getElementById("cx-price").focus();
    return false;
  }
  const date = composer.date || addDaysIso(0), name = parsed.text.slice(0, 120);
  if (composer.type === "goal"){
    const g = goalById(composer.goal);
    if (!g) return false;
    g.log.push({id:genId("gl"), date, amount:Math.max(0, amount), note:name.slice(0, 80)});
    saveBudgetData();
    return `to ${g.name}`;
  }
  if (composer.type === "bill"){
    bills.push({id:genId("bill"), name, amount:Math.max(0, amount), due:date, day:dayOf(date), repeat:composer.repeat, autopay:composer.autopay,
      link:composerField("cx-link") || null, group:composer.group, account:budget.accounts.includes(composer.account) ? composer.account : null});
  } else {
    budget.expenses.push({id:genId("exp"), name, amount:Math.max(0, amount), cat:composer.cat, date});
  }
  saveBudgetData();
  return composer.type === "bill" ? `bill due ${dueLabel(date)}` : money(amount);
}
// Keep the sheet above the on-screen keyboard where the browser shrinks only the
// visual viewport (iOS Safari, newer Android Chrome).
function fitComposerToKeyboard(){
  const vv = window.visualViewport, el = document.getElementById("composer-sheet");
  if (!vv || !el) return;
  el.style.marginBottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + "px";
}
if (window.visualViewport){
  window.visualViewport.addEventListener("resize", () => { if (composer && document.getElementById("composer").classList.contains("open")) fitComposerToKeyboard(); });
}
// Swipe the sheet down by its handle/header to dismiss
(function(){
  let startY = null;
  document.addEventListener("touchstart", e => {
    const sheet = document.getElementById("composer-sheet");
    if (!sheet || !e.target.closest("#composer-sheet .composer-grab, #composer-sheet .modal-head")) return;
    startY = e.touches[0].clientY;
  }, {passive:true});
  document.addEventListener("touchmove", e => {
    if (startY === null) return;
    const dy = Math.max(0, e.touches[0].clientY - startY);
    document.getElementById("composer-sheet").style.transform = `translateY(${dy}px)`;
  }, {passive:true});
  document.addEventListener("touchend", e => {
    if (startY === null) return;
    const dy = e.changedTouches[0].clientY - startY;
    startY = null;
    if (dy > 80) closeComposer();
    else document.getElementById("composer-sheet").style.transform = "";
  }, {passive:true});
})();
