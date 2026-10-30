// budget-goals.js - Budget: long-term goals.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- long-term goals ----------
// A goal (savings goal, big purchase…) has a target, an optional
// target date, a starting amount, and a log of money put in or taken out.
// Paycheck plan lines can point at a goal; once that payday arrives, the line
// counts toward it automatically. With a date, the card shows what's needed
// each month and whether the last 3 months kept pace.
const GOAL_IDEAS = ["Savings goal", "Big purchase", "Emergency fund", "Vacation", "New car"];
const GOAL_MILESTONES = [25, 50, 75, 100];
const openGoals = new Set();
function goalById(id) {
  return budget.goals.find((g) => g.id === id);
}
function goalLinkedLines(g) {
  const today = addDaysIso(0),
    out = [];
  Object.entries(budget.plans).forEach(([key, plan]) => {
    const [srcId, date] = key.split("|");
    if (date > today || !isPayday(srcId, date)) return; // plans left over from an edited income don't count
    plan.lines.forEach((l) => {
      if (l.goal === g.id) out.push({ date, amount: l.amount, note: `${l.name} · paycheck`, linked: true });
    });
  });
  return out;
}
function goalEntries(g) {
  return [...g.log.map((e) => ({ ...e })), ...goalLinkedLines(g)].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
}
function goalSaved(g) {
  return Math.max(0, g.saved + goalEntries(g).reduce((s, e) => s + e.amount, 0));
}
function monthYear(iso) {
  return noonOf(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
// one line for a collapsed card: done, past date, behind, on pace or how far
function goalInsight(g, s = goalStatus(g)) {
  if (s.reached) return "Done";
  if (s.late) return "Past date";
  if (s.behind) return `Behind · needs ${moneyShort(Math.ceil(s.perMonth))}/mo`;
  if (s.perMonth != null) return `On pace · ${s.pct}%`;
  return `${s.pct}% · ${moneyShort(Math.round(s.left))} to go`;
}
function monthsUntil(iso) {
  return Math.max(0, (noonOf(iso) - noonOf(addDaysIso(0))) / (864e5 * 30.44));
}
function goalStatus(g) {
  const saved = goalSaved(g),
    left = Math.max(0, g.target - saved);
  const pct = g.target ? Math.min(100, Math.round((saved / g.target) * 100)) : 0;
  const out = { saved, left, pct, reached: g.target > 0 && saved >= g.target };
  if (out.reached) return out;
  if (g.date) {
    const months = monthsUntil(g.date);
    out.perMonth = months >= 1 ? left / months : left; // due within a month: all of it
    out.late = g.date < addDaysIso(0);
  }
  // pace: what went in over the last 3 months, per month
  const since = addMonthsIso(addDaysIso(0), -3),
    recent = goalEntries(g).filter((e) => e.date >= since);
  if (recent.length) out.pace = recent.reduce((s, e) => s + e.amount, 0) / 3;
  if (out.pace > 0) out.eta = addDaysIso(Math.ceil((left / out.pace) * 30.44)); // finish date at this pace
  out.behind = out.perMonth != null && !out.late && !(out.pace >= out.perMonth);
  // next milestone: the first quarter mark not yet passed
  const m = GOAL_MILESTONES.find((q) => saved < (g.target * q) / 100);
  if (m) out.next = { pct: m, amount: (g.target * m) / 100, away: (g.target * m) / 100 - saved };
  return out;
}
function editGoal(id, preset = "") {
  const g = id ? goalById(id) : null;
  // a new goal offers one-tap names (app-authored, so safe as note HTML)
  const ideas = g ? [] : GOAL_IDEAS.filter((n) => !budget.goals.some((x) => x.name.toLowerCase() === n.toLowerCase()));
  openModal(
    g ? "Edit goal" : "New goal",
    [
      ...(ideas.length
        ? [
            {
              type: "note",
              label: `<span class="goal-ideas">${ideas.map((n) => `<button type="button" class="acct-add" data-action="goal-idea" data-idea="${GOAL_IDEAS.indexOf(n)}">${n}</button>`).join("")}</span>`,
            },
          ]
        : []),
      { key: "name", label: "Goal (e.g. Savings goal)", type: "text" },
      { key: "target", label: "Target amount", type: "number", step: "0.01" },
      { key: "date", label: "Target date (optional)", type: "date" },
      {
        key: "saved",
        label: g ? "Starting amount (before tracking here)" : "Already saved",
        type: "number",
        step: "0.01",
      },
    ],
    g ? { name: g.name, target: g.target, date: g.date || "", saved: g.saved } : { name: preset },
    (v) => {
      const name = (v.name || "").trim().slice(0, 60);
      if (!name) return;
      if (budget.goals.some((x) => x !== g && x.name.toLowerCase() === name.toLowerCase())) {
        showToast("You already have a goal with that name", true);
        return;
      }
      const t = g || { id: genId("goal"), created: addDaysIso(0), log: [] };
      t.name = name;
      t.target = Math.max(0, Number(v.target) || 0);
      t.date = /^\d{4}-\d{2}-\d{2}$/.test(v.date || "") ? v.date : null;
      t.saved = Math.max(0, Number(v.saved) || 0);
      if (!g) budget.goals.push(t);
      saveBudgetData();
    },
    g
      ? () => {
          budget.goals = budget.goals.filter((x) => x.id !== id);
          Object.values(budget.plans).forEach((p) =>
            p.lines.forEach((l) => {
              if (l.goal === id) delete l.goal;
            }),
          );
          saveBudgetData();
        }
      : null,
  );
}
function addToGoal(id, entryId) {
  const g = goalById(id);
  if (!g) return;
  const e = entryId ? g.log.find((x) => x.id === entryId) : null;
  openModal(
    e ? "Edit entry" : `Add to ${g.name}`,
    [
      { key: "amount", label: "Amount", type: "number", step: "0.01" },
      { key: "withdraw", label: "Taking money out", type: "checkbox" },
      { key: "date", label: "Date", type: "date" },
      { key: "note", label: "Note (optional)", type: "text" },
    ],
    e
      ? { amount: Math.abs(e.amount), withdraw: e.amount < 0, date: e.date, note: e.note || "" }
      : { date: addDaysIso(0) },
    (v) => {
      const n = Math.abs(Number(v.amount) || 0);
      if (!n) return;
      const t = e || { id: genId("gl") };
      t.amount = v.withdraw ? -n : n;
      t.date = /^\d{4}-\d{2}-\d{2}$/.test(v.date || "") ? v.date : addDaysIso(0);
      t.note = (v.note || "").trim().slice(0, 80);
      if (!e) g.log.push(t);
      openGoals.add(g.id);
      saveBudgetData();
      if (!e) {
        const s = goalStatus(g);
        showToast(s.reached ? `${g.name} reached!` : `${money(t.amount)} · ${s.pct}% of ${g.name}`);
      }
    },
    e
      ? () => {
          g.log = g.log.filter((x) => x.id !== entryId);
          saveBudgetData();
        }
      : null,
  );
}
function toggleGoal(id) {
  if (openGoals.has(id)) openGoals.delete(id);
  else openGoals.add(id);
  renderBudget();
}
function goalsCardHtml() {
  const today = addDaysIso(0);
  const rows = budget.goals
    .map((g) => {
      const s = goalStatus(g);
      const meta = [];
      if (s.reached) meta.push(`<span class="goal-done">${BOX_CHECK_SVG}Reached</span>`);
      else {
        meta.push(`${moneyShort(Math.round(s.left))} to go`);
        if (g.date) meta.push(`by ${escapeHtml(monthYear(g.date))}`);
        if (s.late) meta.push(`<span class="overdue">past date</span>`);
        else if (s.perMonth != null) meta.push(`<b>${moneyShort(Math.ceil(s.perMonth))}/mo</b> needed`);
      }
      const pace =
        s.pace == null || s.late || s.reached || s.perMonth == null
          ? ""
          : !s.behind
            ? `<span class="goal-pace on">On pace · ${moneyShort(Math.round(s.pace))}/mo lately</span>`
            : `<span class="goal-pace">Behind · ${moneyShort(Math.round(s.pace))}/mo lately</span>`;
      // milestone bar: quarter marks, the ones passed light up
      const marks = GOAL_MILESTONES.map((q) => {
        const hit = s.pct >= q || s.reached;
        return `<span class="goal-mark ${hit ? "hit" : ""} ${q === 100 ? "end" : ""}" style="left:${q}%"><i></i><em>${moneyShort(Math.round((g.target * q) / 100))}</em></span>`;
      }).join("");
      const outlook = s.reached
        ? ""
        : [
            s.next
              ? `Next: <b>${moneyShort(Math.round(s.next.amount))}</b> (${s.next.pct}%) · ${moneyShort(Math.round(s.next.away))} away`
              : "",
            s.eta
              ? `At this pace: <b>${escapeHtml(monthYear(s.eta))}</b>`
              : s.pace != null && s.pace <= 0
                ? "No progress lately"
                : "Add money to see a finish date",
          ]
            .filter(Boolean)
            .map((t) => `<div>${t}</div>`)
            .join("");
      const entries = goalEntries(g),
        open = openGoals.has(g.id);
      const hist = entries
        .map(
          (
            e,
          ) => `<${e.linked ? "div" : `button data-action="goal-add" data-goal-id="${escapeAttr(g.id)}" data-entry-id="${escapeAttr(e.id)}"`} class="goal-entry">
        <span>${escapeHtml(noonOf(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: e.date.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric" }))}</span>
        <span class="goal-note">${escapeHtml(e.note || (e.amount < 0 ? "Taken out" : "Added"))}</span>
        <b class="${e.amount < 0 ? "neg" : ""}">${e.amount < 0 ? "−" : "+"}${money(Math.abs(e.amount))}</b>
      </${e.linked ? "div" : "button"}>`,
        )
        .join("");
      return `<div class="goal ${s.reached ? "reached" : ""}" data-sort-id="${g.id}">
        <button class="goal-head" data-action="goal-edit" data-goal-id="${escapeAttr(g.id)}"><b>${escapeHtml(g.name)}</b><span>${moneyShort(Math.round(s.saved))} of ${moneyShort(g.target)}</span></button>
        <div class="goal-track"><div class="progress-bar"><div class="progress-fill" style="width:${s.pct}%"></div></div>${marks}</div>
        <div class="goal-meta"><span>${s.pct}%</span> · ${meta.join(" · ")}</div>
        ${pace}
        ${outlook ? `<div class="goal-outlook">${outlook}</div>` : ""}
        <div class="goal-actions">
          <button class="goal-add" data-action="goal-add" data-goal-id="${escapeAttr(g.id)}">+ Add money</button>
          ${entries.length || g.saved ? `<button class="goal-hist" data-action="goal-toggle" data-goal-id="${escapeAttr(g.id)}" aria-expanded="${open}">History (${entries.length})${CHEVRON_DOWN}</button>` : ""}
        </div>
        ${open ? `<div class="goal-entries">${hist}${g.saved ? `<div class="goal-entry"><span>Start</span><span class="goal-note">Already saved</span><b>${money(g.saved)}</b></div>` : ""}</div>` : ""}
      </div>`;
    })
    .join("");
  return collapsibleCard({
    id: "goals-card",
    title: "Goals",
    insight: escapeHtml(goalsInsight()),
    body:
      (rows ||
        `<div class="empty">Save toward the big things: a savings goal, an big purchase, an emergency fund.</div>`) +
      `<button class="add-row" data-action="goal-new">+ New goal</button>`,
  });
}
// collapsed Goals card: one goal speaks for itself; several sum up
function goalsInsight() {
  const gs = budget.goals;
  if (!gs.length) return "None";
  if (gs.length === 1) return goalInsight(gs[0]);
  const st = gs.map((g) => goalStatus(g)),
    open = st.filter((x) => !x.reached);
  if (!open.length) return "All done";
  const saved = gs.reduce((t, g) => t + goalSaved(g), 0),
    target = gs.reduce((t, g) => t + g.target, 0);
  const behind = open.filter((x) => x.behind || x.late).length;
  return `${target ? Math.min(100, Math.round((saved / target) * 100)) : 0}% · ${behind ? `${behind} behind` : `${moneyShort(Math.round(open.reduce((t, x) => t + x.left, 0)))} to go`}`;
}
