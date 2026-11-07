// bank.js - Budget: the bank feed. The Jarvis Action reads your banks through Plaid and writes
// jazz2-bank.json into the sync gist (agents/lib/bank.ts): spending only, ids hashed, card payments
// and transfers left out. Here, on the device: your rules, categories and bill matching, the
// "From your bank" list (layout A) and the faint "+$X new" on Spending's bars (layout B).
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- the file ----------
// Kept on this device only (never in SYNC_KEYS, never pushed, not in backups); read-only. Like all
// synced data it's untrusted: normalizeBank() checks every field on the way in and on every read,
// and everything is rendered escaped. What you do with it (added, skipped, rules) lives in
// budget-content and syncs: expenses and payments carry the charge's id (bankId), skipped ids
// sit in budget.bankSkip, rules in budget.rules.
const BANK_FILENAME = "jazz2-bank.json";
const BANK_KEY = "jarvis-bank";
const BANK_ID = /^t[0-9a-f]{12}$/;
const BANK_ACCT = /^a[0-9a-f]{12}$/;
let bankCache = { raw: undefined, file: null };

function bankText(v, max) {
  return typeof v === "string"
    ? v
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
}
function normalizeBank(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== 1) return null;
  const day = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isoDate(noonOf(v)) === v;
  const n = (v) => (typeof v === "number" && isFinite(v) ? Math.round(v * 100) / 100 : null);
  const gen =
    typeof raw.generatedAt === "string" && !isNaN(Date.parse(raw.generatedAt)) ? raw.generatedAt.slice(0, 40) : "";
  if (!gen || !day(raw.from) || !day(raw.to)) return null;
  const accounts = (Array.isArray(raw.accounts) ? raw.accounts : [])
    .filter((a) => a && BANK_ACCT.test(a.id))
    .slice(0, 40)
    .map((a) => ({
      id: a.id,
      item: bankText(a.item, 30),
      name: bankText(a.name, 60) || "Account",
      mask: /^\d{2,4}$/.test(a.mask || "") ? a.mask : "",
      type: bankText(a.type, 20),
      balance: n(a.balance),
      available: n(a.available),
    }));
  const seen = new Set();
  const txns = (Array.isArray(raw.txns) ? raw.txns : [])
    .slice(0, 1500)
    .filter((t) => t && BANK_ID.test(t.id) && !seen.has(t.id) && seen.add(t.id))
    .filter((t) => BANK_ACCT.test(t.acct) && day(t.date) && n(t.amount) > 0)
    .slice(0, 1000)
    .map((t) => ({
      id: t.id,
      acct: t.acct,
      date: t.date,
      amount: n(t.amount),
      name: bankText(t.name, 60) || "Charge",
      raw: bankText(t.raw, 80),
      pfc: /^[A-Z_]{1,40}$/.test(t.pfc || "") ? t.pfc : "",
      pfcDetailed: /^[A-Z_]{1,60}$/.test(t.pfcDetailed || "") ? t.pfcDetailed : "",
      confident: t.confident === true,
      pending: t.pending === true,
    }));
  const errors = (Array.isArray(raw.errors) ? raw.errors : [])
    .filter((e) => e && /^[a-z0-9_-]{1,30}$/i.test(e.item) && /^[A-Z0-9_]{1,60}$/.test(e.code))
    .slice(0, 20)
    .map((e) => ({ item: e.item, code: e.code }));
  return { version: 1, generatedAt: gen, from: raw.from, to: raw.to, accounts, txns, errors };
}
function loadBank() {
  let raw = null;
  try {
    raw = localStorage.getItem(BANK_KEY);
  } catch (e) {}
  if (raw !== bankCache.raw) {
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (e) {}
    bankCache = { raw, file: normalizeBank(parsed) };
  }
  return bankCache.file;
}
// Called by sync's pull with the gist's bank file entry (or undefined). Rules run once the sync
// is done (bankAfterSync), so nothing is added in the middle of a merge.
async function ingestBankFile(file) {
  if (!file || typeof file !== "object") return;
  try {
    let text = file.content;
    if (file.truncated) {
      const raw = safeUrl(file.raw_url);
      if (!raw || new URL(raw).hostname !== "gist.githubusercontent.com") return;
      text = await (await fetch(raw)).text();
    }
    const bank = normalizeBank(JSON.parse(text));
    if (!bank) return;
    if (JSON.stringify(loadBank()) === JSON.stringify(bank)) return;
    writeQuietly(BANK_KEY, bank);
    if (typeof currentTab !== "undefined" && currentTab === "budget") renderBudget();
  } catch (e) {
    console.warn("bank feed not loaded", e);
  }
}
function bankAfterSync() {
  if (bankAutoAdd()) saveBudgetData();
}

// ---------- what you've done with it (budget-content) ----------
function normalizeBankBudget() {
  const cats = new Set(budget.categories.map((c) => c.id));
  const seen = new Set();
  budget.rules = (Array.isArray(budget.rules) ? budget.rules : [])
    .filter((r) => r && typeof r === "object")
    .map((r) => ({ id: safeId(r.id, "rule"), match: bankText(r.match, 40).toLowerCase(), cat: safeId(r.cat, "cat") }))
    .filter((r) => r.match.length >= 2 && cats.has(r.cat) && !seen.has(r.match) && seen.add(r.match))
    .slice(0, 100);
  const since = addDaysIso(-90);
  const skipSeen = new Set();
  budget.bankSkip = (Array.isArray(budget.bankSkip) ? budget.bankSkip : [])
    .filter((s) => s && BANK_ID.test(s.id) && /^\d{4}-\d{2}-\d{2}$/.test(s.at) && s.at >= since)
    .filter((s) => !skipSeen.has(s.id) && skipSeen.add(s.id))
    .map((s) => ({ id: s.id, at: s.at }))
    .slice(0, 400);
}
function bankHandled(id) {
  return (
    budget.expenses.some((e) => e.bankId === id) ||
    billPayments.some((p) => p.bankId === id) ||
    (budget.bankSkip || []).some((s) => s.id === id)
  );
}
function bankAccountName(bank, id) {
  const a = bank.accounts.find((x) => x.id === id);
  return a ? a.name + (a.mask ? ` ··${a.mask}` : "") : "Account";
}

// ---------- categories: your rules first, then Plaid's own when it's sure ----------
// Plaid's category → a word one of your categories is likely named with
const BANK_PFC = [
  ["FOOD_AND_DRINK_GROCERIES", /grocer|food/i],
  ["FOOD_AND_DRINK", /dining|restaurant|eat|food|coffee/i],
  ["TRANSPORTATION_GAS", /gas|fuel/i],
  ["TRANSPORTATION", /transport|car|auto|ride|commute/i],
  ["TRAVEL", /travel|trip|vacation/i],
  ["GENERAL_MERCHANDISE", /shop|merch|stuff|misc/i],
  ["ENTERTAINMENT", /entertain|fun|movie|game/i],
  ["PERSONAL_CARE", /beauty|personal|hair|skin|care/i],
  ["MEDICAL", /health|medical|doctor|pharm/i],
  ["HOME_IMPROVEMENT", /home|house/i],
  ["RENT_AND_UTILITIES", /util|rent|bill/i],
  ["GENERAL_SERVICES", /service|subscri/i],
];
function bankRuleFor(t) {
  const hay = `${t.name} ${t.raw}`.toLowerCase();
  return (budget.rules || []).find((r) => hay.includes(r.match)) || null;
}
// {cat, by: "rule" | "bank"} or null
function bankSuggest(t) {
  const rule = bankRuleFor(t);
  if (rule && budgetCat(rule.cat)) return { cat: rule.cat, by: "rule" };
  if (!t.confident || !t.pfc) return null;
  for (const [code, re] of BANK_PFC) {
    if (t.pfcDetailed !== code && t.pfc !== code) continue;
    const c = budget.categories.find((x) => re.test(x.name));
    if (c) return { cat: c.id, by: "bank" };
  }
  return null;
}

// ---------- bills: a charge that paid one ----------
// Within 5 days of the bill's date, and its name shares a word with the charge (or, without a
// name in common, the exact amount within 3 days); the amount within 15% unless it varies.
// {bill, payment} when a payment (yours or autopay's) is already logged; {bill} when it's still due.
const bankWords = (s) =>
  String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !["the", "and", "inc", "llc", "com", "www", "pay", "payment", "bill"].includes(w));
function bankBillMatch(t) {
  const dayGap = (a, b) => Math.abs(Math.round((noonOf(a) - noonOf(b)) / 864e5));
  const words = new Set([...bankWords(t.name), ...bankWords(t.raw)]);
  const fits = (b, amount, date) => {
    const gap = dayGap(t.date, date);
    if (gap > 5) return false;
    const named = bankWords(b.name).some((w) => words.has(w));
    const close = b.varies || Math.abs(amount - t.amount) <= Math.max(1, amount * 0.15);
    const exact = Math.abs(amount - t.amount) < 0.01 && gap <= 3;
    return (named && close) || exact;
  };
  for (const p of billPayments) {
    if (p.bankId && p.bankId !== t.id) continue;
    const b = bills.find((x) => x.id === p.billId);
    if (b && fits(b, p.amount, p.date)) return { bill: b, payment: p };
  }
  for (const b of bills) {
    if (b.done || !b.due) continue;
    if (fits(b, billShare(b), b.due)) return { bill: b, payment: null };
  }
  return null;
}

// What's waiting: charges not added, skipped, or already counted as a bill payment, newest first
function bankRows(bank = loadBank()) {
  if (!bank) return [];
  return bank.txns
    .filter((t) => !bankHandled(t.id))
    .map((t) => ({ t, match: bankBillMatch(t), sug: bankSuggest(t) }))
    .filter((r) => !(r.match && r.match.payment)); // already a payment: it's counted there
}

// Charges a rule places are added by themselves (decided Nov 7); each shows "Added by your rule ·
// Undo" until a newer feed arrives. The expense id comes from the charge, so two devices adding
// the same charge before they sync end up with one. Returns true when it added any.
function bankAutoAdd() {
  const bank = loadBank();
  if (!bank) return false;
  let added = 0;
  bankRows(bank).forEach(({ t, match, sug }) => {
    if (t.pending || match || !sug || sug.by !== "rule") return;
    const id = "bk-" + t.id.slice(1);
    if (budget.expenses.some((e) => e.id === id)) return;
    budget.expenses.push({
      id,
      name: t.name,
      amount: t.amount,
      cat: sug.cat,
      date: t.date,
      bankId: t.id,
      auto: bank.generatedAt,
    });
    added++;
  });
  return added > 0;
}
function bankExpense(t, cat) {
  return { id: "bk-" + t.id.slice(1), name: t.name, amount: t.amount, cat, date: t.date, bankId: t.id };
}

// ---------- actions ----------
function bankTxn(id) {
  const bank = loadBank();
  return bank && BANK_ID.test(id || "") ? bank.txns.find((t) => t.id === id) || null : null;
}
// The tick: a bill it matches is marked paid with it; otherwise it's added as spending in its category
// (none yet: the category picker opens)
function bankAdd(id) {
  const t = bankTxn(id);
  if (!t || t.pending || bankHandled(id)) return;
  const m = bankBillMatch(t);
  if (m && !m.payment) {
    recordPayment(m.bill, t.amount, t);
    return;
  }
  const s = bankSuggest(t);
  if (!s) return bankPickCategory(id);
  budget.expenses.push(bankExpense(t, s.cat));
  saveBudgetData();
  showUndoToast(`Added ${t.name} · ${budgetCat(s.cat).name}`, () => bankRemove(t.id));
}
function bankRemove(txId) {
  budget.expenses = budget.expenses.filter((e) => e.bankId !== txId);
  saveBudgetData();
}
// Pick (or change) a charge's category; "always" makes a rule, which also places the others like it
function bankPickCategory(id) {
  const t = bankTxn(id);
  if (!t || bankHandled(id)) return;
  if (!budget.categories.length) {
    showToast("Add a spending category first (Manage budget)");
    return;
  }
  const s = bankSuggest(t);
  const names = budget.categories.map((c) => c.name);
  const merchant = t.name.toLowerCase().slice(0, 40);
  openModal(
    `${t.name} · ${money(t.amount)}`,
    [
      { key: "cat", label: "Category", type: "select", options: names },
      { key: "always", label: `Always put “${t.name}” here (a rule)`, type: "checkbox" },
    ],
    { cat: s ? budgetCat(s.cat).name : names[0], always: false },
    (v) => {
      const c = budget.categories.find((x) => x.name === v.cat);
      if (!c) return;
      if (v.always && merchant.length >= 2) {
        budget.rules = (budget.rules || []).filter((r) => r.match !== merchant);
        budget.rules.push({ id: genId("rule"), match: merchant, cat: c.id });
      }
      if (!t.pending) budget.expenses.push(bankExpense(t, c.id));
      bankAutoAdd(); // a new rule places the others like it
      saveBudgetData();
      showToast(t.pending ? `Rule saved: ${t.name} → ${c.name}` : `Added ${t.name} · ${c.name}`);
    },
  );
}
function bankSkip(id) {
  if (!bankTxn(id) || bankHandled(id)) return;
  budget.bankSkip = [{ id, at: addDaysIso(0) }, ...(budget.bankSkip || [])];
  saveBudgetData();
  showUndoToast("Skipped", () => {
    budget.bankSkip = budget.bankSkip.filter((s) => s.id !== id);
    saveBudgetData();
  });
}
// Undo a rule's add: the charge goes back on the list's skipped side (it was placed, then taken back)
function bankUndoAuto(id) {
  const e = budget.expenses.find((x) => x.bankId === id && x.auto);
  if (!e) return;
  budget.expenses = budget.expenses.filter((x) => x !== e);
  budget.bankSkip = [{ id, at: addDaysIso(0) }, ...(budget.bankSkip || [])];
  saveBudgetData();
  showToast(`${e.name} taken back out`);
}
// "Add N matched": every charge with a confident category, and every bill it pays
function bankAddMatched() {
  const rows = bankRows().filter((r) => !r.t.pending && ((r.match && !r.match.payment) || r.sug));
  if (!rows.length) return;
  const before = dataSnapshot();
  rows.forEach(({ t, match, sug }) => {
    if (match) {
      const b = match.bill;
      const p = { id: genId("pay"), billId: b.id, name: b.name, amount: t.amount, due: b.due, date: t.date };
      billPayments.push({ ...p, group: b.group || "personal", account: b.account || null, bankId: t.id });
      const next = nextBillIso(b.due, b.repeat, b.day);
      if (next) b.due = next;
      else b.done = true;
    } else budget.expenses.push(bankExpense(t, sug.cat));
  });
  saveBudgetData();
  const after = dataSnapshot();
  showUndoToast(`Added ${rows.length} from your bank`, () => {
    undoTo(before, after);
    renderBudget();
  });
}
function bankReviewScroll() {
  const el = document.getElementById("bank-sec");
  if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
}

// ---------- layout A: "From your bank" ----------
function bankRowHtml(r, bank) {
  const { t, match, sug } = r;
  const n = daysFromToday(t.date);
  const when = t.pending ? "Pending" : n === 0 ? "Today" : n === -1 ? "Yesterday" : shortDate(t.date);
  const acct = bankAccountName(bank, t.acct);
  const id = escapeAttr(t.id);
  // its own line, so a long category or bill name never squeezes the name (large text sizes)
  const tag = match
    ? `<span class="bank-tag match">Pays ${escapeHtml(match.bill.name)}</span>`
    : `<button class="bank-tag${sug ? "" : " pick"}" data-action="bank-cat" data-bank-id="${id}">${sug ? escapeHtml(budgetCat(sug.cat).name) : "Pick a category"} ▾</button>`;
  const box = t.pending
    ? `<span class="wb-later" aria-hidden="true"></span>`
    : `<button class="todo-check" role="checkbox" aria-checked="false" aria-label="${match ? `Mark ${escapeAttr(match.bill.name)} paid with this` : `Add ${escapeAttr(t.name)} to Budget`}" data-action="bank-add" data-bank-id="${id}"><span class="box">${BOX_CHECK_SVG}</span></button>`;
  return `<div class="wb-bill bank-row${t.pending ? " pending" : ""}">
      ${box}
      <div class="wb-bill-body">
        ${billLogoHtml(null, t.name)}
        <span class="wb-bill-text"><b>${escapeHtml(t.name)}</b><span class="wb-bill-meta">${escapeHtml(when)} · ${escapeHtml(acct)}</span>${tag}</span>
        <b class="wb-bill-amt">${money(t.amount)}</b>
      </div>
      ${t.pending ? "" : `<button class="bank-skip" data-action="bank-skip" data-bank-id="${id}" aria-label="Skip ${escapeAttr(t.name)}">${X_ICON}</button>`}
    </div>`;
}
function bankAutoRowHtml(e, bank) {
  const c = budgetCat(e.cat);
  return `<div class="wb-bill bank-row auto">
      <span class="wb-later" aria-hidden="true"></span>
      <div class="wb-bill-body">
        ${billLogoHtml(null, e.name)}
        <span class="wb-bill-text"><b>${escapeHtml(e.name)}</b><span class="wb-bill-meta">Added by your rule${c ? ` · ${escapeHtml(c.name)}` : ""}</span></span>
        <b class="wb-bill-amt">${money(e.amount)}</b>
      </div>
      <button class="bank-undo" data-action="bank-undo" data-bank-id="${escapeAttr(e.bankId)}">Undo</button>
    </div>`;
}
function bankSectionHtml() {
  const bank = loadBank();
  if (!bank) return "";
  const rows = bankRows(bank);
  const auto = budget.expenses.filter((e) => e.auto && e.auto === bank.generatedAt && e.bankId);
  const errs = bank.errors;
  if (!rows.length && !auto.length && !errs.length) return "";
  const open = rows.filter((r) => !r.t.pending);
  const ready = open.filter((r) => (r.match && !r.match.payment) || r.sug).length;
  const synced = new Date(bank.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const reconnect = errs
    .map(
      (e) =>
        `<p class="bank-err">${escapeHtml(e.item)} needs you: ${e.code === "ITEM_LOGIN_REQUIRED" || e.code === "PENDING_DISCONNECT" ? `sign in again with <code>npm run plaid-link -- --update ${escapeHtml(e.item)}</code>` : `the bank said ${escapeHtml(e.code)}`}</p>`,
    )
    .join("");
  return `<section class="wb-sec bank-sec" id="bank-sec" aria-label="From your bank">${wbLabel("From your bank", open.length ? `${open.length} to add` : "all added")}
    <div class="wb-card wb-bills">${rows.map((r) => bankRowHtml(r, bank)).join("")}${auto.map((e) => bankAutoRowHtml(e, bank)).join("")}
      <div class="bank-foot">${ready > 1 ? `<button class="jv-chip-sm on" data-action="bank-add-matched">Add ${ready} matched</button>` : ""}<span>Synced ${escapeHtml(synced)} · card payments and transfers left out</span></div>
      ${reconnect}
    </div></section>`;
}

// ---------- layout B: Spending's bars ----------
// What's waiting per category (charges with a category but not added yet), for the faint segment
function bankNewByCat(monthKey) {
  const out = {};
  let n = 0;
  bankRows().forEach(({ t, match, sug }) => {
    if (t.pending || match || !sug || t.date.slice(0, 7) !== monthKey) return;
    out[sug.cat] = Math.round(((out[sug.cat] || 0) + t.amount) * 100) / 100;
    n++;
  });
  return { byCat: out, n, all: bankRows().filter((r) => !r.t.pending).length };
}
// A paid bill in Next 14 days that a charge confirmed: "matched on Citi CC ··4421"
function bankPaidNote(payment) {
  const bank = loadBank();
  if (!bank || !payment) return "";
  const t = payment.bankId
    ? bank.txns.find((x) => x.id === payment.bankId)
    : bank.txns.find((x) => {
        const m = bankBillMatch(x);
        return m && m.payment === payment;
      });
  return t ? `matched on ${bankAccountName(bank, t.acct)}` : "";
}
