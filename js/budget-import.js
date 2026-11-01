// budget-import.js - Budget: cards/banks and spreadsheet import.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- cards / banks ----------
function editAccount(i) {
  const name = i == null ? "" : budget.accounts[i];
  const card = name ? budget.cardInfo[name] : null;
  openModal(
    i == null ? "Add card or bank" : "Edit card or bank",
    [
      { key: "name", label: "Name (e.g. Bank A, Citi CC)", type: "text" },
      { key: "card", label: "Credit card (paid in full each month)", type: "checkbox" },
      { key: "due", label: "Card payment due day (1–31)", type: "number", step: "1" },
    ],
    { name, card: !!card, due: card && card.due ? card.due : "" },
    (v) => {
      const n = (v.name || "").trim().slice(0, 40);
      if (!n || (n !== name && budget.accounts.includes(n))) return;
      if (i == null) budget.accounts.push(n);
      else {
        budget.accounts[i] = n;
        [...bills, ...billPayments].forEach((b) => {
          if (b.account === name) b.account = n;
        });
      }
      delete budget.cardInfo[name];
      const due = Number(v.due);
      if (v.card)
        budget.cardInfo[n] = {
          due: Number.isInteger(due) && due >= 1 && due <= 31 ? due : null,
          st: card ? card.st : {},
        };
      saveBudgetData();
    },
    i == null
      ? null
      : () => {
          delete budget.cardInfo[name];
          budget.accounts.splice(i, 1);
          [...bills, ...billPayments].forEach((b) => {
            if (b.account === name) b.account = null;
          });
          saveBudgetData();
        },
  );
}
// ---------- import bills pasted from a spreadsheet ----------
// Copying rows out of Google Sheets / Excel gives tab-separated text, e.g.
// "Bank A	6th	Car Loan	$120.00". Each row becomes a monthly bill due
// that day this month; header and Total rows are skipped.
function parseBillRows(text) {
  const out = [];
  String(text || "")
    .split(/\r?\n/)
    .forEach((line) => {
      // skip header/total rows (a first cell that's exactly a heading), not bills like "Monthly gym"
      if (!line.trim() || /^\s*(total|total bills|card\s*\/\s*bank|monthly|joint bills)\s*(\t|$)/i.test(line)) return;
      let cells = line.includes("\t") ? line.split("\t") : line.split(/\s{2,}|\s*,\s*(?=\$|\d|[A-Za-z])/);
      cells = cells.map((c) => c.trim()).filter(Boolean);
      let amount = null,
        day = null,
        account = null;
      const rest = [];
      cells.forEach((c) => {
        const money = c.match(/^\$?\s*([\d,]+(?:\.\d{1,2})?)$/);
        const dayM = c.match(/^(\d{1,2})(?:st|nd|rd|th)?$/i),
          dateM = c.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/);
        if (c === "-" || c === "—") {
          if (amount == null) amount = 0;
        } else if (money && c.includes("$")) amount = Number(money[1].replace(/,/g, ""));
        else if (dayM && day == null) day = Number(dayM[1]);
        else if (dateM && day == null) day = Number(dateM[2]);
        else if (money && amount == null) amount = Number(money[1].replace(/,/g, ""));
        else if (!account && budget.accounts.some((a) => a.toLowerCase() === c.toLowerCase()))
          account = budget.accounts.find((a) => a.toLowerCase() === c.toLowerCase());
        else rest.push(c);
      });
      // four cells and no known account: the first one is the card/bank
      if (!account && cells.length >= 4 && rest.length >= 2) account = rest.shift();
      const name = rest.join(" ").slice(0, 120);
      if (name && day >= 1 && day <= 31) out.push({ name, amount: amount || 0, day, account });
    });
  return out;
}
// Paycheck plans pasted from a spreadsheet: a "Paycheck  $1,345.67" row starts
// each payday's block, the rows under it are its lines, and Remaining/Total rows
// are skipped (the app works those out). Blocks fill this month's paydays in order.
function parsePlanBlocks(text) {
  const blocks = [];
  String(text || "")
    .split(/\r?\n/)
    .forEach((line) => {
      if (!line.trim()) return;
      let name, amountText;
      if (line.includes("\t")) {
        const cells = line
          .split("\t")
          .map((c) => c.trim())
          .filter(Boolean);
        const i = cells.findIndex((c) => /^-?\$?\s*[\d,]+(\.\d{1,2})?$/.test(c));
        amountText = i >= 0 ? cells.splice(i, 1)[0] : "";
        name = cells.join(" ");
      } else {
        const m = line.trim().match(/^(.*?)\s*(\$?\s*[\d,]+(?:\.\d{1,2})?)?$/);
        name = m[1];
        amountText = m[2] || "";
      }
      name = (name || "").trim();
      const amount = amountText ? Number(amountText.replace(/[$,\s]/g, "")) : null;
      if (!name || /^(remaining|total|income)\b/i.test(name)) return;
      if (/^paycheck\b/i.test(name)) {
        blocks.push({ amount, lines: [] });
        return;
      }
      if (!blocks.length) blocks.push({ amount: null, lines: [] });
      blocks[blocks.length - 1].lines.push({
        name: name.slice(0, 80),
        amount: amount != null && isFinite(amount) ? Math.max(0, amount) : 0,
      });
    });
  return blocks.filter((b) => b.lines.length || b.amount != null);
}
function importPlans() {
  const pays = incomeInMonth(budgetMonthKey());
  if (!pays.length) {
    showToast(budget.income.length ? "No paydays this month" : "Add your paycheck under Income first", true);
    return;
  }
  openModal(
    "Import paycheck plans",
    [
      {
        type: "note",
        label:
          "Copy your paycheck breakdowns from your sheet (each block starting with its <b>Paycheck</b> row) and paste them here. Blocks fill this month's paydays in order; a block's Paycheck amount sets that payday's amount.",
      },
      { key: "rows", label: "Rows", type: "textarea" },
      { key: "replace", label: "Replace lines already on those paydays", type: "checkbox" },
    ],
    { replace: true },
    (v) => {
      const blocks = parsePlanBlocks(v.rows);
      if (!blocks.length) {
        showToast("Nothing found — paste rows with a name and an amount", true);
        return;
      }
      blocks.slice(0, pays.length).forEach((b, i) => {
        const p = pays[i],
          plan = planFor(p.key);
        if (b.amount != null && isFinite(b.amount)) {
          if (b.amount !== p.src.amount) plan.amount = Math.max(0, b.amount);
          else delete plan.amount;
        }
        const lines = b.lines.map((l) => ({ id: genId("line"), ...l }));
        plan.lines = v.replace ? lines : [...plan.lines, ...lines];
      });
      saveBudgetData();
      const n = Math.min(blocks.length, pays.length);
      showToast(
        `Filled ${n} payday${n === 1 ? "" : "s"}` +
          (blocks.length > pays.length
            ? ` · ${blocks.length - pays.length} extra block${blocks.length - pays.length === 1 ? "" : "s"} skipped`
            : ""),
      );
    },
  );
}
function importBills() {
  openModal(
    "Import bills",
    [
      {
        type: "note",
        label:
          "Copy the rows from your sheet (card/bank, date, expense, amount) and paste them here. Each becomes a monthly bill due that day.",
      },
      { key: "rows", label: "Rows", type: "textarea" },
      { key: "group", label: "Group", type: "select", options: Object.values(BILL_GROUPS) },
      { key: "paid", label: "Mark the ones due before today as paid this month", type: "checkbox" },
    ],
    { group: BILL_GROUPS.personal, paid: true },
    (v) => {
      const rows = parseBillRows(v.rows);
      if (!rows.length) {
        showToast("No bills found — paste rows with a date and a name", true);
        return;
      }
      const today = addDaysIso(0),
        key = today.slice(0, 7);
      const last = Number(monthEndIso(key).slice(8));
      rows.forEach((r) => {
        if (r.account && !budget.accounts.includes(r.account)) budget.accounts.push(r.account.slice(0, 40));
        const due = `${key}-${String(Math.min(r.day, last)).padStart(2, "0")}`;
        const b = {
          id: genId("bill"),
          name: r.name,
          amount: r.amount,
          due,
          day: r.day,
          repeat: "monthly",
          autopay: false,
          link: null,
          group: v.group === BILL_GROUPS.joint ? "joint" : "personal",
          account: r.account || null,
        };
        if (v.paid && due < today) {
          billPayments.push({
            id: genId("pay"),
            billId: b.id,
            name: b.name,
            amount: b.amount,
            due,
            date: due,
            group: b.group,
            account: b.account,
          });
          b.due = nextBillIso(due, "monthly", r.day);
        }
        bills.push(b);
      });
      saveBudgetData();
      showToast(`Imported ${rows.length} bill${rows.length === 1 ? "" : "s"}`);
    },
  );
}
