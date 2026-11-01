// budget-debts.js - Budget: debts (loans paid down in your own order), credit cards
// (statement and due day), and the month's money by account.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- debts ----------
// budget.debts is in your order: goals come first, then the first debt that isn't
// paid off gets any extra money. Balance is what's owed now; logging a payment
// lowers it, and deleting the entry puts it back.
function debtById(id) {
  return budget.debts.find((d) => d.id === id);
}
// Month by month at this payment and APR: how long, and the interest on the way
function debtPayoff(d) {
  if (!(d.balance > 0)) return { done: true };
  if (!(d.payment > 0)) return { months: null };
  const r = d.apr / 1200;
  if (r > 0 && d.payment <= d.balance * r) return { months: Infinity };
  let bal = d.balance,
    months = 0,
    interest = 0;
  while (bal > 0.005 && months < 600) {
    const i = bal * r;
    interest += i;
    bal = bal + i - d.payment;
    months++;
  }
  return { months, interest: Math.round(interest * 100) / 100, date: addMonthsIso(addDaysIso(0), months) };
}
function debtNext() {
  return budget.debts.find((d) => d.balance > 0) || null;
}
function debtMeta(d, p = debtPayoff(d)) {
  if (p.done) return `<span class="goal-done">${BOX_CHECK_SVG}Paid off</span>`;
  const bits = [];
  if (d.apr) bits.push(`${d.apr}% APR`);
  if (d.payment) bits.push(`${moneyShort(d.payment)}/mo`);
  if (p.months === Infinity) bits.push(`<span class="overdue">payment doesn't cover interest</span>`);
  else if (p.months) bits.push(`paid off <b>${escapeHtml(monthYear(p.date))}</b>`);
  else bits.push("add a payment to see a date");
  return bits.join(" · ");
}
function debtsCardHtml() {
  const next = debtNext();
  const open = budget.debts.filter((d) => d.balance > 0);
  const total = Math.round(open.reduce((s, d) => s + d.balance, 0) * 100) / 100;
  const firstGoal = budget.goals.find((g) => !goalStatus(g).reached);
  const rows = budget.debts
    .map((d, i) => {
      const p = debtPayoff(d);
      return `<div class="debt-row ${p.done ? "done" : ""} ${d === next ? "next" : ""}" data-sort-id="${d.id}">
        <span class="debt-n" aria-hidden="true">${i + 1}</span>
        <button class="debt-body" data-action="debt-edit" data-debt-id="${escapeAttr(d.id)}"><b>${escapeHtml(d.name)}${d === next ? `<em>Next</em>` : ""}</b><span class="debt-meta">${debtMeta(d, p)}</span></button>
        <b class="debt-bal">${p.done ? "" : money(d.balance)}</b>
        ${p.done ? "" : `<button class="debt-pay" data-action="debt-pay" data-debt-id="${escapeAttr(d.id)}" aria-label="Log a payment: ${escapeAttr(d.name)}">Pay</button>`}
      </div>`;
    })
    .join("");
  const note = next
    ? `<p class="debt-note">${firstGoal ? `After ${escapeHtml(firstGoal.name)}, extra` : "Extra"} money goes to <b>${escapeHtml(next.name)}</b>. Drag to change the order.</p>`
    : "";
  return collapsibleCard({
    id: "debts-card",
    title: "Debts",
    insight: open.length ? `${moneyShort(total)} · ${open.length} open` : budget.debts.length ? "All paid off" : "None",
    body:
      (rows
        ? `${note}<div class="debt-list">${rows}</div>`
        : `<div class="empty">Add a car loan, a personal loan or a card you're paying down to see when each one is gone.</div>`) +
      `<button class="add-row" data-action="debt-add">+ Add debt</button>`,
  });
}
function editDebt(id) {
  const d = id ? debtById(id) : null;
  const hist = d && d.log.length ? `<div class="goal-entries">${debtLogHtml(d)}</div>` : "";
  openModal(
    d ? "Edit debt" : "New debt",
    [
      { key: "name", label: "Name (e.g. Car loan)", type: "text" },
      { key: "balance", label: "Balance owed now", type: "number", step: "0.01" },
      { key: "apr", label: "APR % (optional)", type: "number", step: "0.01" },
      { key: "payment", label: "Monthly payment", type: "number", step: "0.01" },
      ...(hist ? [{ type: "html", label: `<div class="modal-field"><span>Payments</span>${hist}</div>` }] : []),
    ],
    d ? { name: d.name, balance: d.balance, apr: d.apr || "", payment: d.payment || "" } : {},
    (v) => {
      const name = (v.name || "").trim().slice(0, 60);
      if (!name) return;
      const t = d || { id: genId("debt"), log: [] };
      t.name = name;
      t.balance = Math.max(0, Math.round((Number(v.balance) || 0) * 100) / 100);
      t.apr = Math.max(0, Math.min(99, Number(v.apr) || 0));
      t.payment = Math.max(0, Number(v.payment) || 0);
      if (!d) budget.debts.push(t);
      saveBudgetData();
    },
    d
      ? () => {
          budget.debts = budget.debts.filter((x) => x.id !== id);
          saveBudgetData();
        }
      : null,
  );
}
function debtLogHtml(d) {
  return d.log
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(
      (
        e,
      ) => `<button type="button" class="goal-entry" data-action="debt-pay" data-debt-id="${escapeAttr(d.id)}" data-entry-id="${escapeAttr(e.id)}">
        <span>${escapeHtml(wbShort(e.date))}</span><span class="goal-note">${escapeHtml(e.note || "Payment")}</span><b>−${money(e.amount)}</b>
      </button>`,
    )
    .join("");
}
// Log a payment (or edit one): it comes off the balance; deleting it adds it back
function payDebt(id, entryId) {
  const d = debtById(id);
  if (!d) return;
  const e = entryId ? d.log.find((x) => x.id === entryId) : null;
  openModal(
    e ? "Edit payment" : `Pay ${d.name}`,
    [
      { key: "amount", label: "Amount", type: "number", step: "0.01" },
      { key: "date", label: "Date", type: "date" },
      { key: "note", label: "Note (optional, e.g. extra payment)", type: "text" },
    ],
    e ? { amount: e.amount, date: e.date, note: e.note || "" } : { amount: d.payment || "", date: addDaysIso(0) },
    (v) => {
      const n = Math.round(Math.abs(Number(v.amount) || 0) * 100) / 100;
      if (!n) return;
      const t = e || { id: genId("dl") };
      const before = e ? e.amount : 0;
      t.amount = n;
      t.date = /^\d{4}-\d{2}-\d{2}$/.test(v.date || "") ? v.date : addDaysIso(0);
      t.note = (v.note || "").trim().slice(0, 80);
      if (!e) d.log.push(t);
      d.balance = Math.max(0, Math.round((d.balance + before - n) * 100) / 100);
      saveBudgetData();
      if (!e) showToast(d.balance ? `${money(n)} paid · ${money(d.balance)} left on ${d.name}` : `${d.name} paid off!`);
    },
    e
      ? () => {
          d.log = d.log.filter((x) => x.id !== entryId);
          d.balance = Math.round((d.balance + e.amount) * 100) / 100;
          saveBudgetData();
        }
      : null,
  );
}

// ---------- credit cards ----------
// budget.cardInfo marks which accounts are credit cards: { [account]: { due, st: { "YYYY-MM": amount } } }.
// Cards are paid in full, so the statement is the payment to plan. Bills paid
// from a card still count in Bills & spending, the way the sheet counts them.
function cardAccounts() {
  return budget.accounts.filter((a) => budget.cardInfo[a]);
}
// The paycheck that covers a card's due date this month: the last payday on or before it
function cardPaycheck(paychecks, dueIso) {
  const before = paychecks.filter((p) => p.date <= dueIso);
  return before.length ? before[before.length - 1] : paychecks[0] || null;
}
function cardDueIso(key, day) {
  const last = Number(monthEndIso(key).slice(8));
  return `${key}-${String(Math.min(day || last, last)).padStart(2, "0")}`;
}
function cardsCardHtml(key, rows, paychecks) {
  const cards = cardAccounts();
  if (!cards.length) return "";
  const shortDate = (iso) => noonOf(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const list = cards
    .map((name) => {
      const info = budget.cardInfo[name],
        st = info.st[key];
      const charged =
        Math.round(
          rows
            .filter((r) => ((r.bill && r.bill.account) || (r.payment && r.payment.account)) === name)
            .reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100,
        ) / 100;
      const due = cardDueIso(key, info.due);
      const p = cardPaycheck(paychecks, due);
      const lc = name.toLowerCase();
      const inPlan = p && paychecks.find((x) => x.plan.lines.some((l) => l.name.toLowerCase().includes(lc)));
      let action = "";
      if (inPlan)
        action = `<span class="card-planned">${BOX_CHECK_SVG}In the ${escapeHtml(shortDate(inPlan.date))} plan</span>`;
      else if (st != null && p)
        action = `<button class="plan-hint card-plan" data-action="card-plan" data-account="${escapeAttr(name)}">+ ${money(st)} to the ${escapeHtml(shortDate(p.date))} paycheck</button>`;
      return `<div class="card-row">
          <button class="card-body" data-action="card-statement" data-account="${escapeAttr(name)}">
            <span class="acct-tag"><i style="--acct:${accountColor(name)}"></i>${escapeHtml(name)}</span>
            <span class="card-meta">${info.due ? `due ${ordinal(info.due)} · ` : ""}${charged ? `${money(charged)} of bills on it` : "no bills on it"}</span>
          </button>
          <button class="card-st ${st == null ? "unset" : ""}" data-action="card-statement" data-account="${escapeAttr(name)}">${st == null ? "+ Statement" : money(st)}</button>
          ${action ? `<div class="card-act">${action}</div>` : ""}
        </div>`;
    })
    .join("");
  return collapsibleCard({
    id: "cards-card",
    title: "Cards",
    insight: `${cards.length} card${cards.length === 1 ? "" : "s"}`,
    body: `${list}<p class="debt-note">Paid in full each month: the statement is the payment. Bills on a card still count in Bills &amp; spending.</p>`,
  });
}
function editCardStatement(name, key = budgetMonthKey()) {
  const info = budget.cardInfo[name];
  if (!info) return;
  const month = noonOf(key + "-01").toLocaleDateString("en-US", { month: "long" });
  openModal(
    `${name} · ${month}`,
    [{ key: "amount", label: `Statement balance due in ${month}`, type: "number", step: "0.01" }],
    { amount: info.st[key] == null ? "" : info.st[key] },
    (v) => {
      if (v.amount == null || v.amount === "") delete info.st[key];
      else info.st[key] = Math.max(0, Math.round(Number(v.amount) * 100) / 100 || 0);
      saveBudgetData();
    },
    info.st[key] == null
      ? null
      : () => {
          delete info.st[key];
          saveBudgetData();
        },
    { label: "Clear" },
  );
}
// One tap: the statement becomes a line on the paycheck that covers the due date
function planCardPayment(name) {
  const key = budgetMonthKey(),
    info = budget.cardInfo[name];
  const st = info && info.st[key];
  if (st == null) return;
  const p = cardPaycheck(incomeInMonth(key), cardDueIso(key, info.due));
  if (p) quickPlanLine(p.key, `${name} payment`, st);
}

// ---------- by account ----------
// The month's bills by the account that pays them (the sheet's "paid from")
function byAccountHtml(rows) {
  const totals = new Map();
  rows.forEach((r) => {
    const a = (r.bill && r.bill.account) || (r.payment && r.payment.account) || "";
    const t = totals.get(a) || { amount: 0, n: 0 };
    t.amount += Number(r.amount) || 0;
    t.n++;
    totals.set(a, t);
  });
  if (!totals.size) return "";
  const list = [...totals.entries()]
    .sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || b[1].amount - a[1].amount)
    .map(
      ([a, t]) => `<div class="acct-row">
        ${a ? `<span class="acct-tag"><i style="--acct:${accountColor(a)}"></i>${escapeHtml(a)}</span>` : `<span class="acct-tag none">No account set</span>`}
        <span class="acct-n">${t.n} bill${t.n === 1 ? "" : "s"}</span><b>${money(Math.round(t.amount * 100) / 100)}</b>
      </div>`,
    )
    .join("");
  return collapsibleCard({ id: "by-account", title: "By account", insight: `${totals.size}`, body: list });
}

// ---------- the first goal, month by month (the sheet's savings fund box) ----------
function goalMonthHtml(g, key) {
  const start = key + "-01",
    end = monthEndIso(key);
  const entries = goalEntries(g);
  const before = g.saved + entries.filter((e) => e.date < start).reduce((s, e) => s + e.amount, 0);
  const inMonth = entries.filter((e) => e.date >= start && e.date <= end).reduce((s, e) => s + e.amount, 0);
  const s = goalStatus(g);
  const month = noonOf(start).toLocaleDateString("en-US", { month: "short" });
  return `<div class="glance gfund">
      <div><span>Start of ${escapeHtml(month)}</span><b>${money(Math.max(0, before))}</b></div>
      <div><span>${inMonth < 0 ? "Taken out" : "Deposited"} in ${escapeHtml(month)}</span><b>${inMonth < 0 ? "−" : "+"}${money(Math.abs(inMonth))}</b></div>
      <div class="glance-total"><span>End of ${escapeHtml(month)}</span><b>${money(Math.max(0, before + inMonth))}</b></div>
      <div><span>Goal</span><b>${money(g.target)}</b></div>
      <p class="debt-note">${s.pct}%${s.reached ? " · reached" : ` · ${moneyShort(Math.round(s.left))} to go${s.eta ? ` · at this pace ${escapeHtml(monthYear(s.eta))}` : ""}`}</p>
    </div>`;
}
// Goals, then debts: the whole payoff order in one list
function orderListHtml() {
  const items = [
    ...budget.goals.map((g) => {
      const s = goalStatus(g);
      return {
        name: g.name,
        done: s.reached,
        when: s.reached ? "Reached" : s.eta ? monthYear(s.eta) : g.date ? `by ${monthYear(g.date)}` : "",
      };
    }),
    ...budget.debts.map((d) => {
      const p = debtPayoff(d);
      return {
        name: `${d.name} paid off`,
        done: !!p.done,
        when: p.done ? "Done" : p.months && p.months !== Infinity ? monthYear(p.date) : "",
      };
    }),
  ];
  if (!items.length) return "";
  const firstOpen = items.findIndex((x) => !x.done);
  return `<ol class="order-list">${items
    .map(
      (x, i) =>
        `<li class="${x.done ? "done" : ""} ${i === firstOpen ? "now" : ""}"><span class="debt-n">${i + 1}</span><span>${escapeHtml(x.name)}</span><em>${escapeHtml(x.when)}</em></li>`,
    )
    .join("")}</ol>`;
}

function normalizeDebts() {
  const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : null);
  const amt = (v) => {
    const n = Number(v);
    return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
  };
  budget.debts = (Array.isArray(budget.debts) ? budget.debts : [])
    .filter((d) => d && typeof d === "object")
    .slice(0, 30)
    .map((d) => ({
      id: safeId(d.id, "debt"),
      name: String(d.name == null ? "" : d.name).slice(0, 60) || "Debt",
      balance: amt(d.balance),
      apr: Math.min(99, amt(d.apr)),
      payment: amt(d.payment),
      log: (Array.isArray(d.log) ? d.log : [])
        .filter((e) => e && iso(e.date) && Number(e.amount) > 0)
        .slice(-120)
        .map((e) => ({
          id: safeId(e.id, "dl"),
          date: e.date,
          amount: amt(e.amount),
          note: String(e.note || "").slice(0, 80),
        })),
    }));
  const raw =
    budget.cardInfo && typeof budget.cardInfo === "object" && !Array.isArray(budget.cardInfo) ? budget.cardInfo : {};
  budget.cardInfo = {};
  budget.accounts.forEach((a) => {
    const c = Object.prototype.hasOwnProperty.call(raw, a) ? raw[a] : null;
    if (!c || typeof c !== "object") return;
    const st = {};
    if (c.st && typeof c.st === "object")
      Object.entries(c.st).forEach(([k, v]) => {
        if (/^\d{4}-\d{2}$/.test(k) && isFinite(Number(v))) st[k] = amt(v);
      });
    const due = Number(c.due);
    budget.cardInfo[a] = { due: Number.isInteger(due) && due >= 1 && due <= 31 ? due : null, st };
  });
}
