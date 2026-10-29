// budget-view.js - Budget: spending card, pay-period view, month calendar, renderBudget and data normalizing.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

function spendingCardHtml(spent, spentTotal){
  const sum = list => list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  let cats = "";
  const catRows = [...budget.categories.map(c => ({c, list:spent.filter(e => e.cat === c.id)}))];
  const orphans = spent.filter(e => !budgetCat(e.cat));
  if (orphans.length) catRows.push({c:{id:"none", name:"Uncategorized", limit:0}, list:orphans});
  catRows.forEach(({c, list}) => {
    const total = sum(list);
    const p = c.limit ? Math.min(100, Math.round(total / c.limit * 100)) : (total ? 100 : 0);
    const over = c.limit ? total > c.limit : total > 0 && c.id === "none";
    const open = openBudgetCats.has(c.id);
    const items = list.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map(e => `<button class="expense-row" data-action="expense-edit" data-expense-id="${escapeAttr(e.id)}">
        <span class="expense-name">${escapeHtml(e.name)}</span><span class="expense-date">${escapeHtml(noonOf(e.date).toLocaleDateString('en-US', {month:'short', day:'numeric'}))}</span><b>${money(e.amount)}</b>
      </button>`).join("");
    cats += `<div class="budget-cat ${open ? "open" : ""}" ${c.id !== "none" ? `data-sort-id="${c.id}"` : ""}>
        <button class="budget-cat-head" data-action="budget-cat-toggle" data-cat-id="${escapeAttr(c.id)}" aria-expanded="${open}">
          <span class="budget-cat-name">${escapeHtml(c.name)}</span>
          <span class="budget-cat-amt ${over ? "over" : ""}">${moneyShort(total)}${c.limit ? ` <span>of ${moneyShort(c.limit)}</span>` : ""}</span>
        </button>
        <div class="progress-bar thin"><div class="progress-fill ${over ? "over" : ""}" style="width:${p}%"></div></div>
        ${open ? `<div class="expense-list">${items || '<div class="empty">Nothing spent here this month.</div>'}${c.id !== "none" ? `<button class="cat-edit" data-action="budget-cat-edit" data-cat-id="${escapeAttr(c.id)}">Edit ${escapeHtml(c.name)}</button>` : ""}</div>` : ""}
      </div>`;
  });
  return collapsibleCard({id:"spending-card", title:"Spending", insight:`${moneyShort(spentTotal)} · ${spent.length} item${spent.length === 1 ? "" : "s"}`, body:cats + `<button class="add-row" data-action="budget-cat-add">+ Add category</button>`});
}
// ---------- pay-period view ----------
// The Budget tab is laid out by pay period, the way the paycheck-split sheet
// works: each payday owns the bills due before the next payday, its plan lines,
// and what's left. Bills due before the month's first payday (or overdue from
// earlier) get their own group on top. A period that runs into next month shows
// those bills too; they're the same bills November's view will show.
let showSpending = false;
let budgetManageHtml = "";
function openBudgetManage(){
  openModal("Manage budget", [{type:"html", label:`<div class="manage" id="budget-manage">${budgetManageHtml}</div>`}], {}, () => {}, null, {saveLabel:"Done"});
}
// Cards & banks: a sheet of pills; tap one to rename or delete it
function openAccounts(){
  openModal("Cards & banks", [{type:"html", label:`<div class="acct-editor">
      ${budget.accounts.map((a, i) => `<button type="button" class="acct-pill big"       style="--acct:${accountColor(a)}" data-action="account-edit" data-index="${i}">${escapeHtml(a)}</button>`).join("") || '<div class="empty">None yet.</div>'}
            <button type="button" class="acct-add" data-action="account-add">+ Add</button></div>`}], {}, () => {});
}
// ---------- budget month calendar ----------
// Like Home's month view, for money: each day shows a dot per bill due (red if
// overdue, green once paid) and a $ on paydays. Tapping a day lists its bills
// (tickable) and paycheck below the grid; it starts on today.
let budgetCalDay = null;
let budgetCalMonth = false; // false: just the selected day's week
function setBudgetCalMonth(open){
  if (open === budgetCalMonth) return;
  budgetCalMonth = open;
  renderBudget();
}
function selectBudgetDay(iso){
  budgetCalDay = iso;
  const cur = addDaysIso(0).slice(0, 7), [y1, m1] = cur.split("-").map(Number), [y2, m2] = iso.slice(0, 7).split("-").map(Number);
  budgetMonthOffset = (y2 - y1) * 12 + (m2 - m1); // a week can cross into the next/previous month
  renderBudget();
}
function budgetCalHtml(key, rows, paychecks, today){
  const start = key + "-01", days = Number(monthEndIso(key).slice(8));
  // per-day bills and paydays, for this month and (in week view) its neighbours
  const byDay = {}, pays = {}, seen = new Set();
  const addMonth = (k, list, pc) => {
    if (seen.has(k)) return; seen.add(k);
    list.filter(r => r.due.slice(0, 7) === k).forEach(r => { (byDay[r.due] = byDay[r.due] || []).push(r); });
    pc.forEach(p => { (pays[p.date] = pays[p.date] || []).push(p); });
  };
  addMonth(key, rows, paychecks);
  const sel = budgetCalDay && budgetCalDay.slice(0, 7) === key ? budgetCalDay : (today.slice(0, 7) === key ? today : start);
  let first, count;
  if (budgetCalMonth){ first = noonOf(start); first.setDate(1 - first.getDay()); count = Math.ceil((noonOf(start).getDay() + days) / 7) * 7; }
  else { first = noonOf(sel); first.setDate(first.getDate() - first.getDay()); count = 7; }
  const cellIsos = [];
  for (let n = 0; n < count; n++){ const d = new Date(first); d.setDate(first.getDate() + n); cellIsos.push(isoDate(d)); }
  cellIsos.forEach(iso => { const k = iso.slice(0, 7); if (!seen.has(k)) addMonth(k, billsInMonth(k), incomeInMonth(k)); });
  let cells = WEEK_LETTERS.map(x => `<div class="cal-dow">${x}</div>`).join("");
  cellIsos.forEach(iso => {
    if (budgetCalMonth && iso.slice(0, 7) !== key){ // last month's tail shows greyed; next month's stays blank
      cells += iso < key ? `<div class="home-day other" aria-hidden="true"><b>${Number(iso.slice(8))}</b></div>` : `<div class="home-day blank"></div>`; return; }
    const list = byDay[iso] || [], pay = pays[iso];
    const dots = list.slice(0, 3).map(r => `<i class="${r.payment ? "paid" : r.due < today ? "over" : ""}"></i>`).join("");
    const due = list.filter(r => !r.payment).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const fed = holidaysOn(iso).filter(h => h.federal);
    const label = `${noonOf(iso).toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'})}: ${list.length ? `${list.length} bill${list.length === 1 ? "" : "s"}${due ? `, ${money(due)} due` : ", paid"}` : "no bills"}${pay ? ", payday" : ""}${fed.map(h => `, ${h.name} (banks closed)`).join("")}`;
    const cls = ["home-day", iso === sel ? "on" : "", iso === today ? "today" : "", iso < today ? "past" : "", iso.slice(0, 7) !== key ? "other" : "", fed.length ? "holiday" : ""].filter(Boolean).join(" ");
    cells += `<button class="${cls}" aria-pressed="${iso === sel}" aria-label="${escapeAttr(label)}" data-action="budget-select-day" data-date="${iso}">
        <b>${Number(iso.slice(8))}</b><span class="marks">${dots}${pay ? `<em class="pay">$</em>` : ""}</span>
      </button>`;
  });
  let detail = "";
  if (sel){
    const list = byDay[sel] || [], pay = pays[sel] || [];
    const due = list.filter(r => !r.payment).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    detail = `<div class="bcal-detail">
        <div class="period-sub"><span>${escapeHtml(noonOf(sel).toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'}))}</span><span>${list.length ? (due ? `${money(due)} due` : "All paid") : ""}</span></div>
        ${(() => { const fed = holidaysOn(sel).filter(h => h.federal); return fed.length ? `<div class="holiday-chips">${fed.map(h => `<span class="holiday-chip fed">${STAR_ICON_SMALL}${escapeHtml(h.name)}<em> · banks closed</em></span>`).join("")}</div>` : ""; })()}
        ${pay.map(p => `<button class="bcal-pay" data-action="paycheck-edit" data-src-id="${escapeAttr(p.src.id)}" data-date="${p.date}"><span><em class="pay">$</em>${escapeHtml(p.src.name)}</span><b>${payAmt(p)}</b></button>`).join("")}
        ${list.map(r => billRowHtml(r, today)).join("")}
        ${!list.length && !pay.length ? `<div class="empty">Nothing due this day.</div>` : ""}
      </div>`;
  }
  const billDays = Object.keys(byDay).length, payDays = Object.keys(pays).length;
  return collapsibleCard({id:"budget-cal", title:"Calendar",
    insight:[billDays && `${billDays} bill day${billDays === 1 ? "" : "s"}`, payDays && `${payDays} payday${payDays === 1 ? "" : "s"}`].filter(Boolean).join(" · ") || "Nothing due",
    body:`<div class="bcal-wrap"><div class="home-month bcal">${cells}</div>
      <button class="home-cal-grab" data-action="budget-cal-open" data-open="${!budgetCalMonth}" aria-expanded="${budgetCalMonth}" aria-label="${budgetCalMonth ? "Show week" : "Show month"}"><span></span></button></div>${detail}`});
}
function billRowsBetween(from, toExclusive){
  const lastKey = isoDate(new Date(noonOf(toExclusive).getTime() - 864e5)).slice(0, 7);
  const months = [];
  for (let k = from.slice(0, 7), i = 0; i < 3; i++){ months.push(k); if (k >= lastKey) break; k = addMonthsIso(k + "-01", 1).slice(0, 7); }
  const seen = new Set(), out = [];
  months.forEach(m => billsInMonth(m).forEach(r => {
    if (r.due < from || r.due >= toExclusive) return;
    const id = `${r.bill ? r.bill.id : r.payment.billId}|${r.due}|${r.payment ? r.payment.id : ""}`;
    if (seen.has(id)) return;
    seen.add(id); out.push(r);
  }));
  return out;
}
// Bills for one group: unpaid rows, then the paid ones folded behind a toggle
// One bill as a table row, like the sheet: due day · logo + name (and the card
// that pays it) · amount · paid box. Paid rows are struck through.
function billTableRowHtml(r, today, monthStart){
  const b = r.bill, paid = !!r.payment, overdue = !paid && r.due < today;
  const due = r.due < monthStart ? noonOf(r.due).toLocaleDateString('en-US', {month:'short', day:'numeric'}) : ordinal(Number(r.due.slice(8)));
  const acct = (b && b.account) || (r.payment && r.payment.account);
  const sub = [acct ? `<span class="acct-tag"><i style="--acct:${accountColor(acct)}"></i>${escapeHtml(acct)}</span>` : "",
    b && b.autopay && !paid ? `<span class="autopay">${AUTOPAY_ICON}Autopay</span>` : "",
    b && b.share && b.group === "joint" ? `${b.share}%` : ""].filter(Boolean).join(" · ");
  const box = paid
    ? `<button class="todo-check" role="checkbox" aria-checked="true" aria-label="Mark not paid: ${escapeAttr(r.name)}" data-action="bill-unpay" data-payment-id="${r.payment.id}"><span class="box">${BOX_CHECK_SVG}</span></button>`
    : r.current
      ? `<button class="todo-check" role="checkbox" aria-checked="false" aria-label="Mark paid: ${escapeAttr(r.name)}" data-action="bill-pay" data-bill-id="${b.id}" data-due="${b.due}"><span class="box">${BOX_CHECK_SVG}</span></button>`
      : `<span class="btab-later" aria-hidden="true"></span>`;
  return `<div class="btab-row ${paid ? "checked" : ""} ${overdue ? "over" : ""}">
      <span class="btab-due">${escapeHtml(due)}</span>
      <div class="btab-name" ${billBodyAttrs(r, b, paid)}><div class="title">${billLogoHtml(b, r.name)}<span class="btab-text">${escapeHtml(r.name)}</span></div>${sub ? `<div class="todo-meta">${sub}</div>` : ""}</div>
      <b class="btab-amt">${b && b.varies && !paid ? `<span class="approx" title="Amount varies">~</span>` : ""}${money(r.amount)}</b>
      ${box}
    </div>`;
}
// tick: confirm the real amount; untick: back to expected (the amount stays)
function toggleReceived(srcId, date){
  const plan = budget.plans[`${srcId}|${date}`];
  if (plan && plan.received){ delete plan.received; saveBudgetData(); return; }
  editPaycheck(srcId, date, true);
}
function togglePlanLine(key, id){
  const plan = budget.plans[key], l = plan && plan.lines.find(x => x.id === id);
  if (!l) return;
  if (l.done) delete l.done; else l.done = true;
  saveBudgetData();
}
// Copy last month's paycheck plans onto this month's paydays, in order. Month
// names in line names move along ("1/2 of Oct Bills" → "1/2 of Nov Bills").
function copyPrevPlans(){
  const key = budgetMonthKey(), prevKey = addMonthsIso(key + "-01", -1).slice(0, 7);
  const prev = incomeInMonth(prevKey), cur = incomeInMonth(key);
  const names = k => { const d = noonOf(k + "-01"); return [d.toLocaleDateString('en-US', {month:'long'}), d.toLocaleDateString('en-US', {month:'short'})]; };
  const [pLong, pShort] = names(prevKey), [cLong, cShort] = names(key);
  const rename = s => s.replace(new RegExp(`\\b${pLong}\\b`, "g"), cLong).replace(new RegExp(`\\b${pShort}\\b`, "g"), cShort);
  let n = 0;
  cur.forEach((p, i) => {
    const from = prev[Math.min(i, prev.length - 1)];
    if (!from || p.plan.lines.length || !from.plan.lines.length) return;
    planFor(p.key).lines = from.plan.lines.map(l => ({id:genId("line"), name:rename(l.name), amount:l.amount, ...(l.goal ? {goal:l.goal} : {})}));
    n++;
  });
  saveBudgetData();
  showToast(n ? `Copied plans to ${n} payday${n === 1 ? "" : "s"}` : "Nothing to copy");
}
function editPayment(id){
  const p = billPayments.find(x => x.id === id);
  if (!p) return;
  openModal(`${p.name} · paid`, [
    {key:"amount", label:"Amount paid", type:"number", step:"0.01"},
    {key:"date", label:"Paid on", type:"date"},
  ], {amount:p.amount, date:p.date},
    v => { p.amount = Math.max(0, Number(v.amount) || 0); if (/^\d{4}-\d{2}-\d{2}$/.test(v.date || "")) p.date = v.date; saveBudgetData(); },
    () => unpayBill(id), {label:"Mark not paid"});
}
function renderBudget(){
  const el = document.getElementById("panel-budget");
  if (!el) return;
  const key = budgetMonthKey(), today = addDaysIso(0), monthStart = key + "-01";
  const monthName = noonOf(monthStart).toLocaleDateString('en-US', key.slice(0, 4) === today.slice(0, 4) ? {month:'long'} : {month:'long', year:'numeric'});
  const shortDate = iso => noonOf(iso).toLocaleDateString('en-US', {month:'short', day:'numeric'});
  const sum = list => list.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const rows = billsInMonth(key);
  const unpaid = rows.filter(r => !r.payment);
  const spent = budget.expenses.filter(e => e.date && e.date.slice(0, 7) === key);
  const spentTotal = sum(spent);
  const limitTotal = budget.categories.reduce((s, c) => s + (Number(c.limit) || 0), 0);
  const paychecks = incomeInMonth(key);
  const incomeTotal = paychecks.reduce((s, p) => s + p.amount, 0), estN = paychecks.filter(p => p.approx).length;
  const plannedTotal = paychecks.reduce((s, p) => s + p.planned, 0);
  const hasIncome = budget.income.length > 0;
  const remaining = Math.round((hasIncome ? incomeTotal - plannedTotal : limitTotal - spentTotal) * 100) / 100;

  // Laid out like the budget sheet: four totals, My Bills and Joint Bills as
  // tables, each paycheck's plan, Month at a Glance, then goals; the calendar
  // and the set-up-once things sit folded at the bottom.
  const r2 = n => Math.round(n * 100) / 100;
  const monthRows = rows.filter(r => r.due >= monthStart);
  const toGoals = r2(paychecks.reduce((s, p) => s + p.plan.lines.filter(l => goalById(l.goal)).reduce((t, l) => t + l.amount, 0), 0));
  const hasPlan = paychecks.some(p => p.plan.lines.length);
  // A check without plan lines yet counts the bills due in its stretch of the
  // month, so a half-planned month doesn't look richer than it is
  const monthEndNext = isoDate(new Date(noonOf(monthEndIso(key)).getTime() + 864e5));
  const unplanned = paychecks.filter(p => !p.plan.lines.length);
  let unplannedBills = 0;
  const seenDays = new Set(); // two checks on one day share one stretch of bills
  paychecks.forEach(p => {
    if (seenDays.has(p.date)) return;
    seenDays.add(p.date);
    if (p.plan.lines.length || paychecks.some(x => x.date === p.date && x.plan.lines.length)) return;
    const next = nextPayday(p.date) || monthEndNext;
    unplannedBills += sum(billRowsBetween(p.date, next < monthEndNext ? next : monthEndNext));
  });
  unplannedBills = r2(unplannedBills);
  const overdue = r2(sum(rows.filter(r => r.due < monthStart && !r.payment))); // still unpaid from an earlier month
  const billsSpend = r2((hasPlan ? plannedTotal - toGoals + unplannedBills : sum(monthRows) + spentTotal) + overdue);
  const paidCount = `${rows.filter(r => r.payment).length} of ${rows.length}`;
  const estimated = hasPlan && unplanned.length > 0;
  const leftOver = r2(incomeTotal - billsSpend - toGoals);
  const goalNames = [...new Set(paychecks.flatMap(p => p.plan.lines.map(l => goalById(l.goal)).filter(Boolean).map(g => g.name)))];
  const signed = n => `${n < 0 ? "−" : ""}${moneyShort(Math.abs(n))}`;
  const tile = (label, value, sub = "", cls = "", click = "") => `<${click ? `button ${click}` : "div"} class="budget-kpi ${cls}"><span>${label}</span><b class="${cls.includes("neg") ? "over" : ""}">${value}</b>${sub ? `<i>${sub}</i>` : ""}</${click ? "button" : "div"}>`;
  const g0 = budget.goals[0], g0s = g0 && goalStatus(g0);
  let html = `<div class="budget-month">
      <button class="cal-nav" data-action="budget-month" data-delta="-1" aria-label="Previous month">‹</button>
      <span>${monthName}</span>
      <button class="cal-nav" data-action="budget-month" data-delta="1" aria-label="Next month">›</button>
    </div>
    <div class="budget-kpis four">
      ${hasIncome && paychecks.length ? `${tile("Income", `${estN ? "~" : ""}${moneyShort(r2(incomeTotal))}`, `${paychecks.length} paycheck${paychecks.length === 1 ? "" : "s"}${estN ? ` · ${estN} expected` : ""}`)}
      ${tile("Bills &amp; spending", `${estimated ? "~" : ""}${moneyShort(billsSpend)}`, estimated ? `${unplanned.length} check${unplanned.length === 1 ? "" : "s"} not planned yet` : `${paidCount} bills paid`)}
      ${tile("Left over", signed(leftOver), toGoals ? `after ${moneyShort(toGoals)} to ${goalNames.length === 1 ? escapeHtml(goalNames[0]) : "goals"}` : "", leftOver < 0 ? "neg" : "good")}`
      // no paycheck yet: bills and spending against the category budgets
      : `${tile("Bills left", moneyShort(r2(sum(unpaid))), `${paidCount} paid`)}
      ${tile("Spent", moneyShort(r2(spentTotal)), limitTotal ? `of ${moneyShort(limitTotal)} budgeted` : "")}
      ${hasIncome ? tile("Income", "$0", `No paydays in ${monthName}`) : tile("Income", "—", "Add your paycheck", "", 'data-action="budget-add-income"')}`}
      ${g0 ? tile(escapeHtml(g0.name), moneyShort(Math.round(g0s.saved)), `of ${moneyShort(g0.target)} · ${g0s.pct}%`, "goal", 'data-action="budget-goals-scroll"')
        : hasIncome && paychecks.length ? tile("Bills left", moneyShort(r2(sum(unpaid))), `${unpaid.length} unpaid`) : tile("Left to spend", signed(r2(limitTotal - spentTotal)), "")}
    </div>`;

  // My Bills / Joint Bills: one table each, like the sheet (paid rows struck)
  ["personal", "joint"].forEach(g => {
    const list = rows.filter(r => ((r.bill && r.bill.group) || (r.payment && r.payment.group) || "personal") === g)
      .sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
    if (!list.length && g === "joint") return;
    const paidN = list.filter(r => r.payment).length;
    const body = list.length
      ? `<div class="btab-head"><span>Due</span><span>Expense</span><span>Amount</span><span>Paid</span></div>${list.map(r => billTableRowHtml(r, today, monthStart)).join("")}
         <div class="btab-total"><span>Total</span><b>${money(sum(list))}</b></div>`
      : `<div class="empty">No bills this month. Add rent, phone, subscriptions… or import them from your sheet.</div>`;
    html += collapsibleCard({id:g === "joint" ? "bills-joint" : "bills-mine", title:g === "joint" ? "Joint Bills" : "My Bills",
      insight:list.length ? `${paidN}/${list.length} paid` : "None",
      body:body + (g === "personal" ? `<button class="add-row" data-action="bill-add">+ Add bill</button>` : "")});
  });

  // Paycheck Plan: each check, its lines, and what's left of it
  let plan = "";
  const prevKey = addMonthsIso(monthStart, -1).slice(0, 7);
  if (paychecks.length && paychecks.every(p => !p.plan.lines.length) && incomeInMonth(prevKey).some(p => p.plan.lines.length)){
    plan += `<button class="copy-plans" data-action="plans-copy-prev">${DUPLICATE_ICON}<span>Copy ${escapeHtml(noonOf(prevKey + "-01").toLocaleDateString('en-US', {month:'long'}))}'s paycheck plans</span></button>`;
  }
  const billedDates = new Set(); // two checks on one day: only the first offers its bills
  paychecks.forEach(p => {
    const next = nextPayday(p.date) || isoDate(new Date(noonOf(monthEndIso(key)).getTime() + 864e5));
    const end = isoDate(new Date(noonOf(next).getTime() - 864e5));
    const billsDue = billedDates.has(p.date) ? 0 : r2(sum(billRowsBetween(p.date, next)));
    billedDates.add(p.date);
    const now = p.date <= today && today < next;
    const lines = p.plan.lines.map(l => `<div class="plan-row ${l.done ? "done" : ""}" data-sort-id="${l.id}">
        <button class="todo-check" role="checkbox" aria-checked="${!!l.done}"         aria-label="${l.done ? "Not done" : "Done"}: ${escapeAttr(l.name)}" data-action="plan-line-toggle" data-plan-key="${escapeAttr(p.key)}" data-line-id="${escapeAttr(l.id)}"><span class="box">${BOX_CHECK_SVG}</span></button>
                <button class="plan-body" data-action="plan-line-edit" data-plan-key="${escapeAttr(p.key)}" data-line-id="${escapeAttr(l.id)}"><span>${escapeHtml(l.name)}${goalById(l.goal) ? `<span class="goal-tag">→ ${escapeHtml(goalById(l.goal).name)}</span>` : ""}</span><b>${money(l.amount)}</b></button>
      </div>`).join("");
    plan += `<div class="pp ${now ? "now" : ""}" data-key="${p.key}">
        <div class="pp-head ${p.src.varies ? "recv" : ""} ${p.received ? "got" : ""}">
          ${p.src.varies ? `<button class="todo-check" role="checkbox" aria-checked="${p.received}" aria-label="${p.received ? "Not received" : "Mark received"}: ${escapeAttr(p.src.name)} ${escapeAttr(shortDate(p.date))}" data-action="paycheck-received" data-src-id="${escapeAttr(p.src.id)}" data-date="${p.date}"><span class="box">${BOX_CHECK_SVG}</span></button>` : ""}
          <button class="pp-title" data-action="paycheck-edit" data-src-id="${escapeAttr(p.src.id)}" data-date="${p.date}"><span>${escapeHtml(shortDate(p.date))} ${escapeHtml(/^paycheck$/i.test(p.src.name) ? "paycheck" : p.src.name)}${now ? `<em>Now</em>` : ""}</span>
            <i>${p.src.varies ? (p.received ? "Received" : p.date <= today ? "Not marked received" : "Expected") : `${escapeHtml(shortDate(p.date))} – ${escapeHtml(shortDate(end))}`}</i></button>
          <b>${payAmt(p)}</b>
        </div>
        ${lines}
        ${billsDue > 0 && !p.plan.lines.some(l => /bill/i.test(l.name)) ? `<button class="plan-hint" data-action="plan-hint" data-plan-key="${escapeAttr(p.key)}">+ Bills due ${escapeHtml(shortDate(p.date))}–${escapeHtml(shortDate(end))} · ${money(billsDue)}</button>` : ""}
        <button class="plan-add" data-action="plan-line-add" data-plan-key="${escapeAttr(p.key)}">+ Add line</button>
        <div class="pp-left ${p.left < 0 ? "over" : ""}"><span>Remaining</span><b>${p.left < 0 ? "−" : ""}${money(Math.abs(p.left))}</b></div>
      </div>`;
  });
  if (paychecks.length) html += collapsibleCard({id:"pay-plan", title:"Paycheck Plan", insight:`${paychecks.length} check${paychecks.length === 1 ? "" : "s"}`, body:`<div id="pay-periods">${plan}</div>`});
  else html += `<div class="card period-empty">${hasIncome ? `No paydays in ${monthName}.` : `Add your paycheck to plan each check: what it covers and what's left.`}</div>`;

  // Month at a Glance
  if (hasIncome && paychecks.length) html += collapsibleCard({id:"glance", title:"Month at a Glance", body:`<div class="glance">
      <div><span>Income</span><b>${money(r2(incomeTotal))}</b></div>
      <div><span>Bills &amp; spending${estimated ? `<em class="glance-note">includes bills due on ${unplanned.length} unplanned check${unplanned.length === 1 ? "" : "s"}</em>` : ""}</span><b>${estimated ? "~" : ""}${money(billsSpend)}</b></div>
      ${toGoals ? `<div><span>To ${goalNames.length === 1 ? escapeHtml(goalNames[0]) : "goals"}</span><b>${money(toGoals)}</b></div>` : ""}
      <div class="glance-total ${leftOver < 0 ? "over" : ""}"><span>Left over</span><b>${leftOver < 0 ? "−" : ""}${money(Math.abs(leftOver))}</b></div>
    </div>`});

  if (budget.goals.length) html += goalsCardHtml();
  const spendingShown = spent.length || showSpending;
  if (spendingShown) html += spendingCardHtml(spent, spentTotal);
  html += budgetCalHtml(key, rows, paychecks, today); // folded by default

  // Manage: the set-up-once things, one line each
  const mrow = (label, value, attrs) => `<button class="manage-row" ${attrs}><span>${label}</span><span class="manage-val">${value}</span>${CHEVRON_RIGHT}</button>`;
  const mact = (op, id) => dataAttrs("manage-run", id ? {op, id} : {op});
  let manage = budget.income.map(x => mrow(escapeHtml(x.name), `${x.varies ? "varies · ~" : ""}${moneyShort(x.amount)} · ${escapeHtml(((BILL_REPEATS[x.repeat] || {}).label || "").toLowerCase())}`, mact("edit-income", x.id))).join("");
  manage += mrow(budget.income.length ? "Add another income" : "Add your paycheck", budget.income.length ? "" : "Splits the month by payday", mact("add-income"));
  if (!budget.goals.length) manage += mrow("Goals", "House, ring, emergency fund…", mact("new-goal"));
  if (!spendingShown) manage += mrow("Spending by category", "Nothing logged", mact("show-spending"));
  manage += mrow("Cards &amp; banks", `${budget.accounts.length}`, mact("accounts"));
  manage += mrow("Import bills from a sheet", "", mact("import-bills"));
  if (budget.income.length) manage += mrow("Import paychecks", "Dates and amounts", mact("import-income"));
  if (paychecks.length) manage += mrow("Import paycheck plans", "", mact("import-plans"));
  // Manage stays out of the way: a quiet link at the bottom opens it as a sheet
  budgetManageHtml = manage;
  html += `<button class="budget-manage-link" data-action="budget-manage-open">${GEAR_ICON}<span>Manage budget</span><em>paychecks, cards &amp; imports</em></button>`;
  el.innerHTML = html;
}
function pruneBudgetHistory(){
  const cutoff = addDaysIso(-400);
  const p = billPayments.filter(x => x.date >= cutoff), e = budget.expenses.filter(x => x.date >= cutoff);
  if (p.length !== billPayments.length){ billPayments = p; writeQuietly("bill-payments", billPayments); }
  if (e.length !== budget.expenses.length){ budget.expenses = e; writeQuietly("budget-content", budget); }
}
// Stored budget data arrives from sync/backup too: coerce every field
function normalizeBudgetData(){
  const iso = v => /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : null;
  const amt = v => { const n = Number(v); return isFinite(n) && n >= 0 ? n : 0; };
  const str = (v, max) => String(v == null ? "" : v).slice(0, max);
  if (!Array.isArray(bills)) bills = [];
  if (!Array.isArray(billPayments)) billPayments = [];
  if (!budget || typeof budget !== "object") budget = {categories:[], expenses:[]};
  if (!Array.isArray(budget.categories)) budget.categories = [];
  if (!Array.isArray(budget.expenses)) budget.expenses = [];
  bills = bills.filter(b => b && typeof b === "object").map(b => ({id:safeId(b.id, "bill"), name:str(b.name, 120) || "Bill", amount:amt(b.amount),
    due:iso(b.due) || addDaysIso(0), repeat:BILL_REPEATS[b.repeat] ? b.repeat : "monthly", autopay:!!b.autopay, link:b.link ? str(b.link, 2000) : null, ...(b.done ? {done:true} : {}),
    group:b.group, account:b.account == null ? null : str(b.account, 40), share:b.share, varies:!!b.varies,
    day:Number.isInteger(b.day) && b.day >= 1 && b.day <= 31 ? b.day : dayOf(iso(b.due) || addDaysIso(0)),
    ...(iso(b.hold) ? {hold:b.hold} : {}), ...(cleanDomain(b.site) ? {site:cleanDomain(b.site)} : {})}));
  billPayments = billPayments.filter(p => p && iso(p.due) && iso(p.date)).map(p => ({id:safeId(p.id, "pay"), billId:safeId(p.billId, "bill"), name:str(p.name, 120), amount:amt(p.amount), due:p.due, date:p.date,
    group:p.group, account:p.account, ...(p.auto ? {auto:true} : {})}));
  budget.categories = budget.categories.filter(c => c && typeof c === "object").map(c => ({id:safeId(c.id, "cat"), name:str(c.name, 60) || "Category", limit:amt(c.limit)}));
  budget.expenses = budget.expenses.filter(e => e && iso(e.date)).map(e => ({id:safeId(e.id, "exp"), name:str(e.name, 120) || "Expense", amount:amt(e.amount), cat:e.cat ? safeId(e.cat, "cat") : null, date:e.date}));
  budget.accounts = (Array.isArray(budget.accounts) ? budget.accounts : DEFAULT_BUDGET.accounts).map(a => str(a, 40).trim()).filter(Boolean)
    .filter((a, i, all) => all.indexOf(a) === i);
  bills.forEach(b => {
    b.group = b.group === "joint" ? "joint" : "personal"; b.account = budget.accounts.includes(b.account) ? b.account : null;
    const sh = Number(b.share); if (b.group === "joint" && sh > 0 && sh < 100) b.share = Math.round(sh); else delete b.share;
    if (b.varies) b.varies = true; else delete b.varies;
  });
  billPayments.forEach(p => { p.group = p.group === "joint" ? "joint" : "personal"; p.account = p.account ? str(p.account, 40) : null; });
  budget.income = (Array.isArray(budget.income) ? budget.income : []).filter(x => x && iso(x.start))
    .map(x => ({id:safeId(x.id, "inc"), name:str(x.name, 60) || "Paycheck", amount:amt(x.amount), start:x.start, repeat:BILL_REPEATS[x.repeat] ? x.repeat : "biweekly", ...(x.varies ? {varies:true} : {})}));
  const plans = budget.plans && typeof budget.plans === "object" && !Array.isArray(budget.plans) ? budget.plans : {};
  budget.plans = {};
  Object.entries(plans).forEach(([k, v]) => {
    if (!/^[A-Za-z0-9_-]+\|\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== "object") return;
    budget.plans[k] = {...(v.amount != null && isFinite(Number(v.amount)) ? {amount:amt(v.amount)} : {}), ...(v.received ? {received:true} : {}),
      lines:(Array.isArray(v.lines) ? v.lines : []).filter(l => l && typeof l === "object").map(l => ({id:safeId(l.id, "line"), name:str(l.name, 80) || "Item", amount:amt(l.amount),
        ...(l.goal ? {goal:safeId(l.goal, "goal")} : {}), ...(l.done ? {done:true} : {})}))};
  });
  budget.goals = (Array.isArray(budget.goals) ? budget.goals : []).filter(g => g && typeof g === "object")
    .map(g => ({id:safeId(g.id, "goal"), name:str(g.name, 60) || "Savings", target:amt(g.target), saved:amt(g.saved),
      date:iso(g.date), created:iso(g.created) || addDaysIso(0),
      log:(Array.isArray(g.log) ? g.log : []).filter(e => e && iso(e.date) && isFinite(Number(e.amount)))
        .map(e => ({id:safeId(e.id, "gl"), date:e.date, amount:Number(e.amount), note:str(e.note, 80)}))}));
}

// Budget's calendar: swipe down for the month, up for the week
(function(){
  const panel = document.getElementById("panel-budget");
  let sx = 0, sy = 0, on = false;
  panel.addEventListener("touchstart", e => {
    on = !!e.target.closest(".bcal-wrap");
    if (on){ sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
  }, {passive:true});
  panel.addEventListener("touchmove", e => { if (on) e.preventDefault(); }, {passive:false});
  panel.addEventListener("touchend", e => {
    if (!on) return;
    on = false;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dy) > 35 && Math.abs(dy) > Math.abs(dx)) setBudgetCalMonth(dy > 0);
  }, {passive:true});
})();
