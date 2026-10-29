// budget-income.js - Budget: income, paychecks and paycheck plans.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- income + paycheck plans ----------
// An income source (a paycheck) repeats from its start date. Each payday gets a
// plan: lines that spend the check down (a share of the bills, a card payment,
// fun money), and what's left over. Plans are keyed "sourceId|date".
function incomeInMonth(key){
  const start = key + "-01", end = monthEndIso(key), out = [];
  budget.income.forEach(src => {
    let d = src.start;
    for (let i = 0; i < 800 && d && d <= end; i++){
      if (d >= start) out.push(paycheckAt(src, d));
      d = nextBillIso(d, src.repeat, dayOf(src.start));
    }
  });
  return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}
function isPayday(srcId, date){
  const src = budget.income.find(i => i.id === srcId);
  if (!src) return false;
  let d = src.start;
  for (let i = 0; i < 800 && d && d < date; i++) d = nextBillIso(d, src.repeat, dayOf(src.start));
  return d === date;
}
// Pay that varies: a check is "expected" (~) until it's ticked Received with
// the real amount. Expected checks without their own amount use the average of
// the last 3 received ones (or the typical amount before any arrive).
function paycheckAt(src, date){
  const key = `${src.id}|${date}`, plan = budget.plans[key] || {lines:[]};
  const amount = plan.amount != null ? plan.amount : src.varies ? incomeEstimate(src) : src.amount;
  const planned = plan.lines.reduce((s, l) => s + l.amount, 0);
  const received = !!plan.received, approx = !!src.varies && !received;
  return {src, date, key, amount, plan, planned, received, approx, left:Math.round((amount - planned) * 100) / 100}; // cents, so 0.1 + 0.2 isn't "−$0.00"
}
function incomeEstimate(src){
  const got = Object.entries(budget.plans)
    .filter(([k, p]) => k.startsWith(src.id + "|") && p.received && p.amount != null)
    .sort((a, b) => a[0] < b[0] ? 1 : -1).slice(0, 3).map(([, p]) => p.amount);
  return got.length ? Math.round(got.reduce((t, n) => t + n, 0) / got.length * 100) / 100 : src.amount;
}
function payAmt(p){ return `${p.approx ? `<span class="approx" title="Expected">~</span>` : ""}${money(p.amount)}`; }
// The next payday after `iso`, across every income source (for the bills hint)
function nextPayday(iso){
  const key = iso.slice(0, 7), nextKey = addMonthsIso(key + "-01", 1).slice(0, 7);
  return [...incomeInMonth(key), ...incomeInMonth(nextKey)].map(p => p.date).filter(d => d > iso).sort()[0] || null;
}
function planFor(key){ return budget.plans[key] || (budget.plans[key] = {lines:[]}); }
function incomeFields(){
  return [
    {key:"name", label:"Income (e.g. Paycheck)", type:"text"},
    {key:"amount", label:"Usual amount (typical, if it varies)", type:"number", step:"0.01"},
    {key:"start", label:"A payday (first one to count)", type:"date"},
    {key:"repeat", label:"Repeats", type:"select", options:Object.values(BILL_REPEATS).map(r => r.label)},
    {key:"varies", label:"Pay varies by check (tick each one Received with the real amount; later checks are estimated from your last 3)", type:"checkbox"},
  ];
}
function applyIncomeValues(x, v){
  x.name = (v.name || "").trim().slice(0, 60) || "Paycheck";
  x.amount = Math.max(0, Number(v.amount) || 0);
  x.start = /^\d{4}-\d{2}-\d{2}$/.test(v.start || "") ? v.start : (x.start || addDaysIso(0));
  x.repeat = Object.keys(BILL_REPEATS).find(k => BILL_REPEATS[k].label === v.repeat) || "biweekly";
  if (v.varies) x.varies = true; else delete x.varies;
}
function addIncome(){
  openModal("Add income", incomeFields(), {name:"Paycheck", repeat:BILL_REPEATS.biweekly.label, start:addDaysIso(0)},
    v => { const x = {id:genId("inc")}; applyIncomeValues(x, v); budget.income.push(x); saveBudgetData(); });
}
function editIncome(id){
  const x = budget.income.find(i => i.id === id);
  if (!x) return;
  openModal("Edit income", incomeFields(), {name:x.name, amount:x.amount, start:x.start, repeat:(BILL_REPEATS[x.repeat] || BILL_REPEATS.biweekly).label, varies:!!x.varies},
    v => { applyIncomeValues(x, v); saveBudgetData(); },
    () => {
      budget.income = budget.income.filter(i => i.id !== id);
      Object.keys(budget.plans).forEach(k => { if (k.startsWith(id + "|")) delete budget.plans[k]; });
      saveBudgetData();
    });
}
function editPaycheck(srcId, date, markReceived = false){
  const src = budget.income.find(i => i.id === srcId);
  if (!src) return;
  const p = paycheckAt(src, date), base = src.varies ? incomeEstimate(src) : src.amount;
  openModal(`${src.name} · ${noonOf(date).toLocaleDateString('en-US', {month:'short', day:'numeric'})}`, [
    {key:"amount", label:src.varies ? "Amount (the real one once it's in)" : "Amount for this payday", type:"number", step:"0.01"},
    ...(src.varies ? [{key:"received", label:"Received", type:"checkbox"}] : []),
    {type:"note", label:src.varies
      ? `Typical: ${money(src.amount)} · recent average: ${money(incomeEstimate(src))}. Leave blank to go back to the estimate.`
      : `Usual amount: ${money(src.amount)}. Change the source itself from <b>Income</b> → Edit.`},
  ], {amount:p.amount, received:p.received || markReceived},
    v => {
      const n = Number(v.amount), plan = planFor(p.key);
      const ok = v.amount != null && v.amount !== "" && isFinite(n) && n >= 0;
      const received = !!(src.varies && v.received && ok);
      // blank (or the usual/estimated amount) goes back to the default
      if (ok && (received || n !== base)) plan.amount = n; else delete plan.amount;
      if (received) plan.received = true; else delete plan.received;
      saveBudgetData();
    });
}
// Paychecks pasted from a sheet's Income list: "10/01/2026 - Work  $1,234.56".
// Each row sets that payday's amount; rows on past dates can count as received.
function parseIncomeRows(text, year){
  const out = [];
  String(text || "").split(/\r?\n/).forEach(line => {
    let date = null, m;
    if ((m = line.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) date = [m[1], m[2], m[3]];
    else if ((m = line.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) date = [m[3] ? (m[3].length === 2 ? "20" + m[3] : m[3]) : String(year), m[1], m[2]];
    if (!date) return;
    const rest = line.slice(m.index + m[0].length);
    const am = rest.match(/\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$/) || rest.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    if (!am) return;
    const amount = Number(am[1].replace(/,/g, ""));
    const iso = `${date[0]}-${String(date[1]).padStart(2, "0")}-${String(date[2]).padStart(2, "0")}`;
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso) || !isFinite(amount)) return;
    out.push({date:iso, amount:Math.round(amount * 100) / 100, label:rest.replace(am[0], "").replace(/^[\s\-–—|:]+|[\s\-–—|:]+$/g, "")});
  });
  return out;
}
function importIncome(){
  if (!budget.income.length){ showToast("Add your paycheck under Income first", true); return; }
  openModal("Import paychecks", [
    {type:"note", label:"Copy your sheet's Income rows (a date and an amount on each, like <b>10/01/2026 - Work $1,234.56</b>) and paste them here. Each row sets that payday's amount."},
    {key:"rows", label:"Rows", type:"textarea"},
    {key:"received", label:"Count paydays up to today as received", type:"checkbox"},
  ], {received:true},
    v => {
      const rows = parseIncomeRows(v.rows, budgetMonthKey().slice(0, 4));
      if (!rows.length){ showToast("Nothing found — paste rows with a date and an amount", true); return; }
      const today = addDaysIso(0);
      let n = 0, miss = 0;
      rows.forEach(r => {
        // the source named on the row, else any source paid that day
        const named = budget.income.filter(x => r.label.toLowerCase().includes(x.name.toLowerCase()));
        const src = [...named, ...budget.income].find(x => isPayday(x.id, r.date));
        if (!src){ miss++; return; }
        const plan = planFor(`${src.id}|${r.date}`), received = !!(v.received && src.varies && r.date <= today);
        if (received || src.varies || r.amount !== src.amount) plan.amount = r.amount; else delete plan.amount;
        if (received) plan.received = true;
        n++;
      });
      saveBudgetData();
      showToast(`Set ${n} paycheck${n === 1 ? "" : "s"}` + (miss ? ` · ${miss} not on a payday` : ""), !n);
    });
}
function addPlanLine(key, name = "", amount = ""){
  openModal("Add to this paycheck", [
    {key:"name", label:"What (a bill share, card payment, fun money…)", type:"text"},
    {key:"amount", label:"Amount", type:"number", step:"0.01"},
    {key:"goal", label:"Goes toward a goal (counts once the payday arrives)", type:"select", options:["—", ...budget.goals.map(g => g.name)]},
  ], {name, amount, goal:"—"},
    v => {
      if (!(v.name || "").trim()) return;
      const line = {id:genId("line"), name:v.name.trim().slice(0, 80), amount:Math.max(0, Number(v.amount) || 0)};
      const g = budget.goals.find(x => x.name === v.goal); if (g) line.goal = g.id;
      planFor(key).lines.push(line); saveBudgetData();
    });
}
function quickPlanLine(key, name, amount){
  planFor(key).lines.push({id:genId("line"), name, amount});
  saveBudgetData();
}
function editPlanLine(key, id){
  const plan = budget.plans[key], l = plan && plan.lines.find(x => x.id === id);
  if (!l) return;
  openModal("Edit line", [
    {key:"name", label:"What", type:"text"},
    {key:"amount", label:"Amount", type:"number", step:"0.01"},
    {key:"goal", label:"Goes toward a goal (counts once the payday arrives)", type:"select", options:["—", ...budget.goals.map(g => g.name)]},
  ], {name:l.name, amount:l.amount, goal:(goalById(l.goal) || {}).name || "—"},
    v => {
      l.name = (v.name || "").trim().slice(0, 80) || l.name; l.amount = Math.max(0, Number(v.amount) || 0);
      const g = budget.goals.find(x => x.name === v.goal); if (g) l.goal = g.id; else delete l.goal;
      saveBudgetData();
    },
    () => { plan.lines = plan.lines.filter(x => x.id !== id); saveBudgetData(); });
}
