// budget-bills.js - Budget: bills, payments, autopay, spending categories and bill logos.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- BUDGET: bills + spending ----------
// Bills are recurring payments with a due date (rent, phone, insurance). Paying
// one logs a payment and moves the bill to its next due date; future dues are
// projected, not stored, the same way recurring to-dos are. Spending is a
// simple log of expenses against monthly category limits. Everything is per
// calendar month, and the page can step back and forth through months.
const BILL_REPEATS = {
  monthly: { label: "Monthly", months: 1 },
  weekly: { label: "Weekly" },
  biweekly: { label: "Every 2 weeks" },
  quarterly: { label: "Quarterly", months: 3 },
  yearly: { label: "Yearly", months: 12 },
  once: { label: "One time" },
};
const DEFAULT_BUDGET = {
  categories: [
    { id: "cat-groceries", name: "Groceries", limit: 400 },
    { id: "cat-dining", name: "Dining out", limit: 200 },
    { id: "cat-gas", name: "Gas", limit: 150 },
    { id: "cat-fun", name: "Fun", limit: 150 },
    { id: "cat-other", name: "Other", limit: 100 },
  ],
  expenses: [],
  accounts: ["Checking", "Credit card", "Joint card"],
  income: [],
  plans: {},
  goals: [],
};
let bills = [],
  billPayments = [],
  budget = { categories: [], expenses: [], accounts: [], income: [], plans: {}, goals: [] };
// Bills are split the way a household budget usually is: your own vs. shared
const BILL_GROUPS = { personal: "Monthly", joint: "Joint" };
let budgetMonthOffset = 0; // months from the current one shown on the Budget tab
const openBudgetCats = new Set();
const WALLET_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v3h-4a2 2 0 0 0 0 4h4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/></svg>';

function addMonthsIso(iso, n, keepDay) {
  const d = noonOf(iso),
    day = keepDay || d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return isoDate(d);
}
function nextBillIso(iso, repeat, day) {
  const r = BILL_REPEATS[repeat];
  if (r && r.months) return addMonthsIso(iso, r.months, day);
  if (repeat === "weekly" || repeat === "biweekly") return nextRepeatIso(iso, repeat);
  return null; // one-time
}
function money(n) {
  return "$" + fmtMoney(Number(n) || 0);
}
function moneyShort(n) {
  n = Number(n) || 0;
  return "$" + (Number.isInteger(n) ? n.toLocaleString("en-US") : fmtMoney(n));
}
function budgetMonthKey() {
  return addMonthsIso(addDaysIso(0).slice(0, 8) + "01", budgetMonthOffset).slice(0, 7);
}
function monthEndIso(key) {
  const [y, m] = key.split("-").map(Number);
  return isoDate(new Date(y, m, 0, 12));
}
// Every bill due in a month: payments already made for it, the bill's current
// (unpaid) due date, and projected later dues
function billsInMonth(key) {
  const start = key + "-01",
    end = monthEndIso(key),
    current = key === addDaysIso(0).slice(0, 7);
  const rows = billPayments
    .filter((p) => p.due >= start && p.due <= end)
    .map((p) => ({
      bill: bills.find((b) => b.id === p.billId),
      name: p.name,
      amount: p.amount,
      due: p.due,
      payment: p,
    }));
  // (unpaid rows below carry your share of the bill)
  bills.forEach((b) => {
    if (b.done || !b.due) return;
    let d = b.due,
      first = true;
    for (let i = 0; i < 800 && d && d <= end; i++) {
      // the current month also carries the bill's unpaid due from before it
      if (d >= start || (first && current))
        rows.push({ bill: b, name: b.name, amount: billShare(b), due: d, current: first });
      first = false;
      d = nextBillIso(d, b.repeat, b.day);
    }
  });
  const byDate = (a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
  return [...rows.filter((r) => !r.payment).sort(byDate), ...rows.filter((r) => r.payment).sort(byDate)];
}
// Bills that land on one day, for Home: the real due date (payable) or a projection
function billsOnDay(iso) {
  const today = addDaysIso(0);
  const open = bills.filter((b) => !b.done && b.due && (b.due === iso || (iso === today && b.due < today)));
  const projected =
    iso > today
      ? bills.filter((b) => {
          if (b.done || !b.due || b.due >= iso) return false;
          let d = b.due;
          for (let i = 0; i < 600 && d && d < iso; i++) d = nextBillIso(d, b.repeat, b.day);
          return d === iso;
        })
      : [];
  const paid = billPayments.filter((p) => p.date === iso);
  return { open, projected, paid };
}
// Your part of a bill: joint bills can carry a share (%)
function billShare(b) {
  return Math.round(b.amount * (b.group === "joint" && b.share ? b.share : 100)) / 100;
}
// Bills marked "amount varies" (electric, phone…) ask what it came to when ticked
function payBill(id) {
  const b = bills.find((x) => x.id === id);
  if (!b || b.done) return;
  if (b.varies) {
    openModal(
      `Pay ${b.name}`,
      [{ key: "amount", label: "Amount this time", type: "number", step: "0.01" }],
      { amount: billShare(b) },
      (v) => recordPayment(b, Math.max(0, Number(v.amount) || 0)),
    );
    return;
  }
  recordPayment(b, billShare(b));
}
// Autopay bills pay themselves: once a due date arrives the payment is logged
// (dated that day) and the bill moves to its next due date. Payment ids are
// derived from bill + date, so every device logs the same payment and sync
// never doubles it. Un-paying an autopaid bill holds that date (`hold`) so it
// isn't re-paid straight away. Runs on load, at midnight, and on every save.
function processAutopay() {
  const today = addDaysIso(0);
  let changed = false;
  bills.forEach((b) => {
    if (!b.autopay || b.done || !b.due) return;
    for (let i = 0; i < 60 && b.due && b.due <= today && b.due !== b.hold; i++) {
      const id = `pay-auto-${b.id}-${b.due}`;
      if (!billPayments.some((p) => p.id === id))
        billPayments.push({
          id,
          billId: b.id,
          name: b.name,
          amount: billShare(b),
          due: b.due,
          date: b.due,
          group: b.group || "personal",
          account: b.account || null,
          auto: true,
        });
      const next = nextBillIso(b.due, b.repeat, b.day);
      changed = true;
      if (next) b.due = next;
      else {
        b.done = true;
        break;
      }
    }
  });
  return changed;
}
function recordPayment(b, amount) {
  delete b.hold;
  const p = {
    id: genId("pay"),
    billId: b.id,
    name: b.name,
    amount,
    due: b.due,
    date: addDaysIso(0),
    group: b.group || "personal",
    account: b.account || null,
  };
  billPayments.push(p);
  const prevDue = b.due,
    next = nextBillIso(b.due, b.repeat, b.day);
  if (next) b.due = next;
  else b.done = true;
  saveBudgetData();
  showUndoToast(next ? `${b.name} paid · next ${dueLabel(next)}` : `${b.name} paid`, () => {
    billPayments = billPayments.filter((x) => x.id !== p.id);
    b.due = prevDue;
    delete b.done;
    saveBudgetData();
  });
}
// Un-pay from a paid row: only the bill's latest payment can be taken back
function unpayBill(paymentId) {
  const p = billPayments.find((x) => x.id === paymentId);
  if (!p) return;
  const b = bills.find((x) => x.id === p.billId);
  const latest = billPayments.filter((x) => x.billId === p.billId).sort((x, y) => (x.due < y.due ? 1 : -1))[0];
  if (b && latest !== p) {
    showToast("Only the latest payment can be undone");
    return;
  }
  billPayments = billPayments.filter((x) => x.id !== p.id);
  if (b) {
    b.due = p.due;
    delete b.done;
    if (b.autopay) b.hold = p.due;
  } // don't let autopay re-pay it right away
  saveBudgetData();
}
function saveBudgetData() {
  processAutopay(); // e.g. Autopay just switched on for a bill that's already due
  saveContent("bills-content", bills, { toast: false });
  saveContent("bill-payments", billPayments, { toast: false });
  saveContent("budget-content", budget, { toast: false });
  renderBudget();
  renderHomePanel();
}
function billFields() {
  return [
    { key: "name", label: "Bill", type: "text" },
    { key: "amount", label: "Amount", type: "number", step: "0.01" },
    { key: "due", label: "Next due date", type: "date" },
    { key: "repeat", label: "Repeats", type: "select", options: Object.values(BILL_REPEATS).map((r) => r.label) },
    { key: "group", label: "Group", type: "select", options: Object.values(BILL_GROUPS) },
    { key: "account", label: "Paid from (card / bank)", type: "select", options: ["—", ...budget.accounts] },
    { key: "share", label: "Your share % (joint bills; blank = all of it)", type: "number", step: "1" },
    { key: "varies", label: "Amount varies (ask what it was when I tick it paid)", type: "checkbox" },
    { key: "autopay", label: "Autopay (marked paid on its due date)", type: "checkbox" },
    { key: "link", label: "Pay link (optional — tap the logo to pay)", type: "url" },
    { key: "site", label: "Company website, for its logo (e.g. att.com)", type: "text" },
  ];
}
function applyBillValues(b, v) {
  b.name = (v.name || "").trim().slice(0, 120) || b.name || "Bill";
  b.amount = Math.max(0, Number(v.amount) || 0);
  const newDue = /^\d{4}-\d{2}-\d{2}$/.test(v.due || "") ? v.due : b.due || addDaysIso(0);
  if (newDue !== b.due || !b.day) b.day = dayOf(newDue); // the series' day of month
  if (newDue !== b.due || !v.autopay) delete b.hold;
  b.due = newDue;
  b.repeat = Object.keys(BILL_REPEATS).find((k) => BILL_REPEATS[k].label === v.repeat) || "monthly";
  b.autopay = !!v.autopay;
  b.link = (v.link || "").trim() || null;
  const site = cleanDomain(v.site);
  if (site && site !== billDomain({ link: b.link }, b.name)) b.site = site;
  else delete b.site; // only kept when it adds something
  b.group = v.group === BILL_GROUPS.joint ? "joint" : "personal";
  b.account = budget.accounts.includes(v.account) ? v.account : null;
  const share = Number(v.share);
  if (b.group === "joint" && share > 0 && share < 100) b.share = Math.round(share);
  else delete b.share;
  if (v.varies) b.varies = true;
  else delete b.varies;
}
function editBill(id) {
  const b = bills.find((x) => x.id === id);
  if (!b) return;
  openModal(
    "Edit bill",
    billFields(),
    {
      name: b.name,
      amount: b.amount,
      due: b.due || "",
      repeat: (BILL_REPEATS[b.repeat] || BILL_REPEATS.monthly).label,
      autopay: !!b.autopay,
      link: b.link || "",
      site: billDomain(b),
      group: BILL_GROUPS[b.group] || BILL_GROUPS.personal,
      account: b.account || "—",
      share: b.share || "",
      varies: !!b.varies,
    },
    (v) => {
      applyBillValues(b, v);
      delete b.done;
      saveBudgetData();
    },
    () => {
      bills = bills.filter((x) => x.id !== id);
      saveBudgetData();
    },
  );
}
function addBill() {
  openModal(
    "Add bill",
    billFields(),
    { repeat: "Monthly", due: addDaysIso(0), group: BILL_GROUPS.personal, account: "—" },
    (v) => {
      if (!(v.name || "").trim()) return;
      const b = { id: genId("bill") };
      applyBillValues(b, v);
      bills.push(b);
      saveBudgetData();
    },
  );
}
function budgetCat(id) {
  return budget.categories.find((c) => c.id === id);
}
function editExpense(id) {
  const e = budget.expenses.find((x) => x.id === id);
  if (!e) return;
  const names = budget.categories.map((c) => c.name);
  openModal(
    "Edit expense",
    [
      { key: "name", label: "What", type: "text" },
      { key: "amount", label: "Amount", type: "number", step: "0.01" },
      { key: "cat", label: "Category", type: "select", options: names.length ? names : ["Other"] },
      { key: "date", label: "Date", type: "date" },
    ],
    { name: e.name, amount: e.amount, cat: (budgetCat(e.cat) || {}).name, date: e.date },
    (v) => {
      e.name = (v.name || "").trim().slice(0, 120) || e.name;
      e.amount = Math.max(0, Number(v.amount) || 0);
      const c = budget.categories.find((x) => x.name === v.cat);
      if (c) e.cat = c.id;
      if (/^\d{4}-\d{2}-\d{2}$/.test(v.date || "")) e.date = v.date;
      saveBudgetData();
    },
    () => {
      budget.expenses = budget.expenses.filter((x) => x.id !== id);
      saveBudgetData();
    },
  );
}
function editBudgetCat(id) {
  const c = id ? budgetCat(id) : null;
  openModal(
    c ? "Edit category" : "Add category",
    [
      { key: "name", label: "Category", type: "text" },
      { key: "limit", label: "Monthly budget", type: "number", step: "0.01" },
    ],
    c ? { name: c.name, limit: c.limit } : {},
    (v) => {
      const name = (v.name || "").trim().slice(0, 60);
      if (!name) return;
      const target = c || { id: genId("cat") };
      target.name = name;
      target.limit = Math.max(0, Number(v.limit) || 0);
      if (!c) budget.categories.push(target);
      saveBudgetData();
    },
    c
      ? () => {
          // spending logged under it moves to Other (or the first category left)
          budget.categories = budget.categories.filter((x) => x.id !== id);
          const fallback = budget.categories.find((x) => /^other$/i.test(x.name)) || budget.categories[0];
          budget.expenses.forEach((e) => {
            if (e.cat === id) e.cat = fallback ? fallback.id : null;
          });
          saveBudgetData();
        }
      : null,
  );
}
function toggleBudgetCat(id) {
  if (openBudgetCats.has(id)) openBudgetCats.delete(id);
  else openBudgetCats.add(id);
  renderBudget();
}
function shiftBudgetMonth(n) {
  budgetMonthOffset += n;
  renderBudget();
}
// One quiet line under each bill: when (red if overdue; "Autopays" when it will
// pay itself), then the card/bank as a colored dot + name. Monthly is the
// default, so only other repeats are named; shares and "varies" say so briefly.
function billWhen(iso) {
  const n = daysFromToday(iso);
  return n >= -1 && n <= 6
    ? dueLabel(iso)
    : noonOf(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
// ---------- bill logos ----------
// A bill shows its company's logo (the site's icon, via DuckDuckGo's icon
// service) from: the website set on the bill, else its pay link, else a guess
// from well-known names. No logo found: a colored first letter. With a pay
// link, tapping the logo opens it.
const BILLER_DOMAINS = [
  [/netflix/i, "netflix.com"],
  [/hulu/i, "hulu.com"],
  [/disney/i, "disneyplus.com"],
  [/\b(hbo|max)\b/i, "max.com"],
  [/peacock/i, "peacocktv.com"],
  [/paramount/i, "paramountplus.com"],
  [/youtube/i, "youtube.com"],
  [/spotify/i, "spotify.com"],
  [/apple|icloud/i, "apple.com"],
  [/audible/i, "audible.com"],
  [/amazon|\bprime\b/i, "amazon.com"],
  [/\boura\b/i, "ouraring.com"],
  [/claude|anthropic/i, "claude.ai"],
  [/chatgpt|openai/i, "openai.com"],
  [/google|\bgoogle one\b/i, "google.com"],
  [/microsoft|xbox|office 365/i, "microsoft.com"],
  [/playstation|\bpsn\b/i, "playstation.com"],
  [/nintendo/i, "nintendo.com"],
  [/adobe/i, "adobe.com"],
  [/dropbox/i, "dropbox.com"],
  [/crunch/i, "crunch.com"],
  [/planet fitness/i, "planetfitness.com"],
  [/la fitness/i, "lafitness.com"],
  [/equinox/i, "equinox.com"],
  [/orangetheory/i, "orangetheory.com"],
  [/peloton/i, "onepeloton.com"],
  [/public storage/i, "publicstorage.com"],
  [/extra space/i, "extraspace.com"],
  [/cubesmart/i, "cubesmart.com"],
  [/\bduke\b/i, "duke-energy.com"],
  [/dominion/i, "dominionenergy.com"],
  [/pg&e|pge\b/i, "pge.com"],
  [/con ?ed/i, "coned.com"],
  [/xfinity|comcast/i, "xfinity.com"],
  [/spectrum/i, "spectrum.com"],
  [/\bcox\b/i, "cox.com"],
  [/verizon/i, "verizon.com"],
  [/at&t|\batt\b/i, "att.com"],
  [/t-?mobile/i, "t-mobile.com"],
  [/mint mobile/i, "mintmobile.com"],
  [/visible/i, "visible.com"],
  [/cricket/i, "cricketwireless.com"],
  [/geico/i, "geico.com"],
  [/progressive/i, "progressive.com"],
  [/state farm/i, "statefarm.com"],
  [/allstate/i, "allstate.com"],
  [/usaa/i, "usaa.com"],
  [/liberty mutual/i, "libertymutual.com"],
  [/nationwide/i, "nationwide.com"],
  [/lemonade/i, "lemonade.com"],
  [/chase/i, "chase.com"],
  [/\bciti/i, "citi.com"],
  [/capital one/i, "capitalone.com"],
  [/discover/i, "discover.com"],
  [/amex|american express/i, "americanexpress.com"],
  [/\bally\b/i, "ally.com"],
  [/wells fargo/i, "wellsfargo.com"],
  [/bank of america|\bbofa\b/i, "bankofamerica.com"],
  [/sofi/i, "sofi.com"],
  [/navient/i, "navient.com"],
  [/nelnet/i, "nelnet.com"],
  [/mohela/i, "mohela.com"],
  [/affirm/i, "affirm.com"],
  [/klarna/i, "klarna.com"],
  [/paypal/i, "paypal.com"],
  [/doordash|dashpass/i, "doordash.com"],
  [/\buber\b/i, "uber.com"],
  [/instacart/i, "instacart.com"],
  [/costco/i, "costco.com"],
  [/walmart/i, "walmart.com"],
  [/\bring\b/i, "ring.com"],
  [/\badt\b/i, "adt.com"],
  [/simplisafe/i, "simplisafe.com"],
  [/\baaa\b/i, "aaa.com"],
  [/tesla/i, "tesla.com"],
];
function cleanDomain(v) {
  let d = String(v || "")
    .trim()
    .toLowerCase();
  try {
    if (/^[a-z]+:\/\//.test(d)) d = new URL(d).hostname;
  } catch (e) {
    return "";
  }
  d = d.replace(/^www\./, "").replace(/\/.*$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(d) ? d : "";
}
function billDomain(b, name) {
  if (b && b.site) return b.site;
  if (b && safeUrl(b.link)) {
    const d = cleanDomain(safeUrl(b.link));
    if (d) return d;
  }
  const hit = BILLER_DOMAINS.find(([re]) => re.test(name || (b && b.name) || ""));
  return hit ? hit[1] : "";
}
function billLogoHtml(b, name) {
  name = name || (b && b.name) || "?";
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  const letter = `<span class="bill-logo letter" style="--h:${hue}" aria-hidden="true">${escapeHtml((name.trim()[0] || "?").toUpperCase())}</span>`;
  const d = billDomain(b, name);
  const logo = d
    ? `<img class="bill-logo" src="https://icons.duckduckgo.com/ip3/${d}.ico" alt="" loading="lazy" referrerpolicy="no-referrer"   data-fb="${escapeAttr(letter)}">`
    : letter;
  return b && safeUrl(b.link)
    ? linkHtml(
        b.link,
        `class="bill-logo-link" data-action="stop-click" aria-label="Pay ${escapeAttr(name)} online"`,
        logo,
      )
    : logo;
}
// Bill row body (Budget Bills list and table): a paid row edits its payment, an open row edits its bill; a projected
// row with neither is deliberately inert (no action attribute).
function billBodyAttrs(r, b, paid) {
  if (paid) return dataAttrs("bill-row-open", { mode: "payment", "payment-id": r.payment.id });
  if (b) return dataAttrs("bill-row-open", { mode: "bill", "bill-id": b.id });
  return "";
}
function billRowHtml(r, today) {
  const b = r.bill,
    paid = !!r.payment;
  const overdue = !paid && r.due < today;
  const meta = [];
  if (paid) meta.push(`${r.payment.auto ? "Autopaid" : "Paid"} ${escapeHtml(billWhen(r.payment.date))}`);
  else if (overdue) meta.push(`<span class="overdue">Overdue · ${escapeHtml(billWhen(r.due))}</span>`);
  else if (b && b.autopay)
    meta.push(`<span class="autopay">${AUTOPAY_ICON}Autopays ${escapeHtml(billWhen(r.due))}</span>`);
  else meta.push(`Due ${escapeHtml(billWhen(r.due))}`);
  const acct = (b && b.account) || (r.payment && r.payment.account);
  if (acct) meta.push(`<span class="acct-tag"><i style="--acct:${accountColor(acct)}"></i>${escapeHtml(acct)}</span>`);
  if (b && !paid && b.repeat && b.repeat !== "monthly")
    meta.push(escapeHtml((BILL_REPEATS[b.repeat] || {}).label || ""));
  if (b && b.share && b.group === "joint" && !paid) meta.push(`${b.share}%`);
  const check = paid
    ? `<button class="todo-check" role="checkbox" aria-checked="true" aria-label="Mark not paid: ${escapeAttr(r.name)}" data-action="bill-unpay" data-payment-id="${r.payment.id}"><span class="box">${BOX_CHECK_SVG}</span></button>`
    : r.current
      ? `<button class="todo-check" role="checkbox" aria-checked="false" aria-label="Mark paid: ${escapeAttr(r.name)}" data-action="bill-pay" data-bill-id="${b.id}" data-due="${b.due}"><span class="box">${BOX_CHECK_SVG}</span></button>`
      : `<span class="row-icon" aria-hidden="true">${CALENDAR_ICON}</span>`;
  return `<div class="item bill-row ${paid ? "checked" : ""}">
      ${check}
      <div class="body" ${billBodyAttrs(r, b, paid)}><div class="title">${billLogoHtml(b, r.name)}${escapeHtml(r.name)}</div><div class="todo-meta">${meta.join(" · ")}</div></div>
      <div class="bill-amt">${b && b.varies && !paid ? `<span class="approx" title="Amount varies">~</span>` : ""}${money(r.amount)}${b && !paid ? linkHtml(b.link, 'class="bill-pay" data-action="stop-click" aria-label="Pay online"', "Pay →") : ""}</div>
    </div>`;
}
// Each card/bank gets its own pill color, by its place in the list (never red,
// which reads as overdue)
const ACCOUNT_HUES = [210, 170, 40, 270, 130, 300, 190, 25];
function accountColor(name) {
  let i = budget.accounts.indexOf(name);
  if (i < 0) {
    i = 0;
    for (const ch of String(name)) i = (i * 31 + ch.charCodeAt(0)) % ACCOUNT_HUES.length;
  }
  return `hsl(${ACCOUNT_HUES[i % ACCOUNT_HUES.length]} 65% 66%)`;
}
