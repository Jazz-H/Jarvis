// import-link.js - Budget import from a #import= link and launch parameters.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- import link ----------
// A link ending in #import=<base64url JSON> adds budget data (bills, paychecks
// and their plans, goals) after the user confirms. The data rides in the URL
// fragment, which never reaches a server, so personal numbers don't have to live
// in this public repo. Nothing is replaced: bills/goals already present by name,
// and paydays that already have plan lines, are skipped. Everything still goes
// through normalizeBudgetData on the next load like any other stored data.
function importFromLink() {
  const m = location.hash.match(/^#import=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);
  let data;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64 + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    showToast("That import link is damaged", true);
    return;
  }
  const wait = localStorage.getItem("sync-token") ? 2500 : 0; // let the first sync pull land before adding on top of it
  if (data && data.app === "jazz3-fitness") {
    setTimeout(() => applyFitnessImport(data), wait);
    return;
  }
  if (data && data.app === "jazz3-routine") {
    setTimeout(() => applyRoutineImport(data), wait);
    return;
  }
  if (data && data.app === "jazz3-cleanup") {
    setTimeout(() => applyCleanup(data), wait);
    return;
  }
  if (!data || data.app !== "jazz2-budget" || !/^\d{4}-\d{2}$/.test(data.month || "")) {
    showToast("That isn't an import link", true);
    return;
  }
  setTimeout(() => applyBudgetImport(data), wait);
}
// To-do changes from a link (after a confirm, with Undo): removeTodos drops
// open to-dos with those exact names; addTodos adds [{text, repeat?, kind?}]
// unless an open one with that text exists (a repeat starts today)
function applyCleanup(data) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const names = arr(data.removeTodos)
    .map((n) => String(n).trim().toLowerCase())
    .filter(Boolean);
  const hit = todoList.filter((t) => !t.done && names.includes(String(t.text).trim().toLowerCase()));
  // to-dos to add: skipped when an open one with the same text is already there
  const adds = arr(data.addTodos)
    .filter((a) => a && String(a.text || "").trim())
    .map((a) => ({
      text: String(a.text).trim().slice(0, TODO_MAX_LEN),
      repeat: REPEATS[a.repeat] && !CUSTOM_REPEATS[a.repeat] ? a.repeat : null,
      kind: TODO_KINDS[a.kind] ? a.kind : null,
    }))
    .filter((a) => !todoList.some((t) => !t.done && t.text.toLowerCase() === a.text.toLowerCase()));
  if (!hit.length && !adds.length) {
    showToast("Nothing to change: your to-dos already match");
    return;
  }
  const parts = [
    adds.length &&
      `add ${adds.map((a) => `"${a.text}"${a.repeat ? ` (${REPEATS[a.repeat].short.toLowerCase()})` : ""}`).join(", ")}`,
    hit.length && `remove ${[...new Set(hit.map((t) => `"${t.text}"`))].join(", ")}`,
  ].filter(Boolean);
  if (!confirm(`${parts.join(" and ").replace(/^./, (c) => c.toUpperCase())}?`)) return;
  const before = dataSnapshot();
  todoList = todoList.filter((t) => !hit.includes(t));
  const today = addDaysIso(0);
  adds.forEach((a) =>
    todoList.unshift({
      id: genId("todo"),
      text: a.text,
      done: false,
      due: a.repeat ? today : null,
      starred: false,
      subitems: [],
      completedAt: null,
      ...(a.repeat ? { repeat: a.repeat, repeatDay: dayOf(today) } : {}),
      ...(a.kind ? { kind: a.kind } : {}),
    }),
  );
  saveContent("todo-content", todoList, { toast: false });
  renderHome();
  activateTab("todo");
  const after = dataSnapshot();
  showUndoToast(
    [adds.length && `Added ${adds.length}`, hit.length && `removed ${hit.length}`]
      .filter(Boolean)
      .join(", ")
      .replace(/^./, (c) => c.toUpperCase()) + ` to-do${adds.length + hit.length === 1 ? "" : "s"}`,
    () => undoTo(before, after),
  );
}
// Skin routine changes from a link:
//   steps: [{band:"am"|"pm"|"washPm", label, product, note, days, before}] go in
//     before the step named by "before" (or before a "… last step"); skipped if
//     that product is already in the band. Wash-day steps only land in an
//     existing wash-day list (an empty one means no wash days) and take no days.
//   updateSteps: [{band, product, days?, note?}] change the step with that product
//   doneItems: [names] ticks Jazz 3.0 plan items; planNotes: [{item, note}] rewrites their notes
function applyRoutineImport(data) {
  const arr = (v) => (Array.isArray(v) ? v : []),
    low = (v) =>
      String(v || "")
        .trim()
        .toLowerCase();
  const BANDS = { am: "AM", pm: "PM", washPm: "wash-day PM" };
  const dayList = (v) => arr(v).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const daysKey = (d) => (d && d.length && d.length < 7 ? d.join() : ""); // as applyStepValues stores them
  const find = (band, product) => (skinRoutine[band] || []).find((s) => low(s.product) === low(product));
  const steps = arr(data.steps).filter(
    (x) =>
      x &&
      BANDS[x.band] &&
      String(x.label || "").trim() &&
      String(x.product || "").trim() &&
      !find(x.band, x.product) &&
      (x.band !== "washPm" || skinRoutine.washPm.length),
  );
  const updates = arr(data.updateSteps)
    .map((x) => x && BANDS[x.band] && { x, step: find(x.band, x.product) })
    .filter(
      (u) =>
        u &&
        u.step &&
        ((u.x.days && u.x.band !== "washPm" && daysKey(dayList(u.x.days)) !== daysKey(u.step.days)) ||
          (u.x.note != null && String(u.x.note).trim() !== (u.step.note || ""))),
    );
  const done = arr(data.doneItems).map(low).filter(Boolean);
  const ticks = plan3.filter((x) => !x.done && done.includes(low(x.item)));
  const notes = arr(data.planNotes)
    .map((n) => n && { n, item: plan3.find((x) => low(x.item) === low(n.item)) })
    .filter((u) => u && u.item && String(u.n.note || "").trim() && u.item.note !== String(u.n.note).trim());
  if (!steps.length && !updates.length && !ticks.length && !notes.length) {
    showToast("Your routine already has that");
    return;
  }
  const dayNames = (d) => (d && d.length ? d.map((i) => WEEKDAYS[i].slice(0, 3)).join("/") : "every day");
  const parts = [
    steps.length && `add ${steps.map((x) => `"${x.label}" to ${BANDS[x.band]}`).join(", ")}`,
    updates.length &&
      `change ${updates.map((u) => `"${u.step.label}"${u.x.days ? ` to ${dayNames(dayList(u.x.days))}` : ""}`).join(", ")}`,
    ticks.length && `tick ${ticks.map((x) => `"${x.item}"`).join(", ")} in Jazz 3.0`,
    notes.length && `update the note on ${notes.map((u) => `"${u.item.item}"`).join(", ")}`,
  ].filter(Boolean);
  if (!confirm(`${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}?`)) return;
  const before = dataSnapshot();
  steps.forEach((x) => {
    const step = { id: genId(x.band) };
    applyStepValues(step, {
      label: String(x.label).trim(),
      product: String(x.product).trim(),
      note: String(x.note || "").trim(),
      days: x.band === "washPm" ? [] : dayList(x.days),
    });
    const list = skinRoutine[x.band];
    let at = x.before ? list.findIndex((s) => low(s.label).startsWith(low(x.before))) : -1;
    if (at < 0) at = list.length && /last step/i.test(list[list.length - 1].label) ? list.length - 1 : list.length;
    list.splice(at, 0, step);
  });
  updates.forEach(({ x, step }) =>
    applyStepValues(step, {
      label: step.label,
      product: step.product,
      note: x.note != null ? String(x.note).trim() : step.note || "",
      days: x.days && x.band !== "washPm" ? dayList(x.days) : step.days || [],
    }),
  );
  ticks.forEach((x) => (x.done = true));
  notes.forEach((u) => (u.item.note = String(u.n.note).trim()));
  if (ticks.length || notes.length) savePlan3();
  saveRoutine();
  activateTab("skin");
  const after = dataSnapshot();
  showUndoToast(`${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}`, () => undoTo(before, after));
}
// Fitness set-up from a link: weight start/goal (if not set yet), weigh-ins on
// dates without one, and workouts not already in the plan (by name)
function applyFitnessImport(data) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const has = (name) => fitness.plan.some((w) => w.name.toLowerCase() === String(name).toLowerCase());
  const plan = arr(data.plan).filter((w) => w && w.name && !has(w.name));
  const weights = arr(data.weights).filter(
    (w) => w && /^\d{4}-\d{2}-\d{2}$/.test(w.date || "") && !fitness.weights.some((x) => x.date === w.date),
  );
  const setGoal = (data.goal != null && fitness.goal == null) || (data.start != null && fitness.start == null);
  const parts = [
    plan.length && `${plan.length} workout${plan.length === 1 ? "" : "s"}`,
    weights.length && `${weights.length} weigh-in${weights.length === 1 ? "" : "s"}`,
    setGoal && "your weight goal",
  ].filter(Boolean);
  if (!parts.length) {
    showToast("Everything in that link is already in Fitness");
    return;
  }
  if (!confirm(`Add ${parts.join(", ")} to Fitness? Nothing already there is changed.`)) return;
  if (fitness.start == null && data.start != null) fitness.start = data.start;
  if (fitness.goal == null && data.goal != null) fitness.goal = data.goal;
  weights.forEach((w) => fitness.weights.push({ id: genId("wt"), date: w.date, lbs: w.lbs }));
  plan.forEach((w) =>
    fitness.plan.push({
      id: genId("wo"),
      name: w.name,
      days: w.days,
      every: w.every,
      anchor: w.anchor,
      time: w.time,
      kind: w.kind,
    }),
  );
  normalizeFitness(); // checks every field
  saveFitness();
  activateTab("jazz3");
  showToast(`Added ${parts.join(", ")}`);
}
function applyBudgetImport(data) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const num = (v) => {
    const n = Number(v);
    return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
  };
  const has = (list, name) => list.some((x) => String(x.name).toLowerCase() === String(name).toLowerCase());
  const newBills = arr(data.bills).filter((b) => b && b.name && !has(bills, b.name));
  const newGoals = arr(data.goals).filter((g) => g && g.name && !has(budget.goals, g.name));
  const incomes = arr(data.income).filter((x) => x && x.name && /^\d{4}-\d{2}-\d{2}$/.test(x.start || ""));
  const planCount = incomes.reduce((n, x) => n + arr(x.plans).length, 0);
  const parts = [
    newBills.length && `${newBills.length} bill${newBills.length === 1 ? "" : "s"}`,
    incomes.length &&
      `${incomes.length} paycheck${incomes.length === 1 ? "" : "s"} with ${planCount} payday plan${planCount === 1 ? "" : "s"}`,
    newGoals.length && `${newGoals.length} goal${newGoals.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  if (!parts.length) {
    showToast("Everything in that link is already in your budget");
    return;
  }
  if (!confirm(`Add ${parts.join(", ")} to your budget? Bills, goals and plan lines already there aren't changed.`))
    return;
  const month = data.month,
    last = Number(monthEndIso(month).slice(8));
  arr(data.accounts).forEach((a) => {
    a = String(a).trim().slice(0, 40);
    if (a && !budget.accounts.includes(a)) budget.accounts.push(a);
  });
  newBills.forEach((b) => {
    const day = Math.min(31, Math.max(1, parseInt(b.day, 10) || 1));
    const due = `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
    const bill = {
      id: genId("bill"),
      name: String(b.name).slice(0, 120),
      amount: num(b.amount),
      due,
      day,
      repeat: BILL_REPEATS[b.repeat] ? b.repeat : "monthly",
      autopay: !!b.autopay,
      link: null,
      group: b.group === "joint" ? "joint" : "personal",
      account: budget.accounts.includes(b.account) ? b.account : null,
      ...(b.varies ? { varies: true } : {}),
    };
    if (b.paid) {
      // already paid this month: log it and move on to next month's due
      billPayments.push({
        id: genId("pay"),
        billId: bill.id,
        name: bill.name,
        amount: bill.amount,
        due,
        date: due,
        group: bill.group,
        account: bill.account,
      });
      bill.due = nextBillIso(due, bill.repeat, day);
    }
    bills.push(bill);
  });
  incomes.forEach((x) => {
    const repeat = BILL_REPEATS[x.repeat] ? x.repeat : "biweekly";
    let src = budget.income.find(
      (i) => i.name.toLowerCase() === String(x.name).toLowerCase() && i.start === x.start && i.repeat === repeat,
    );
    if (!src) {
      src = { id: genId("inc"), name: String(x.name).slice(0, 60), amount: num(x.amount), start: x.start, repeat };
      budget.income.push(src);
    }
    if (x.varies) src.varies = true; // an existing paycheck can be switched to "varies"
    arr(x.plans).forEach((pl) => {
      if (!pl || !/^\d{4}-\d{2}-\d{2}$/.test(pl.date || "")) return;
      const key = `${src.id}|${pl.date}`,
        ex = budget.plans[key];
      const amount =
        pl.amount != null && (src.varies || num(pl.amount) !== src.amount) ? { amount: num(pl.amount) } : {};
      const received = pl.received && src.varies ? { received: true } : {};
      if (ex && ex.lines.length) {
        Object.assign(ex, amount, received);
        return;
      } // keep its lines; just set the check
      budget.plans[key] = {
        ...amount,
        ...received,
        lines: arr(pl.lines)
          .filter((l) => l && l.name)
          .map((l) => ({ id: genId("line"), name: String(l.name).slice(0, 80), amount: num(l.amount) })),
      };
    });
  });
  newGoals.forEach((g) =>
    budget.goals.push({
      id: genId("goal"),
      name: String(g.name).slice(0, 60),
      target: num(g.target),
      saved: num(g.saved),
      date: /^\d{4}-\d{2}-\d{2}$/.test(g.date || "") ? g.date : null,
      created: addDaysIso(0),
      log: [],
    }),
  );
  saveBudgetData();
  budgetMonthOffset = 0;
  activateTab("budget");
  showToast(`Added ${parts.join(", ")}`);
}

// Handles ?tab=&action= launch params from the home-screen icon shortcuts
// (manifest.json "shortcuts") so long-pressing the app icon can jump straight
// to a tab or straight into the new-to-do composer.
function applyLaunchParams() {
  const params = new URLSearchParams(location.search);
  const tab = params.get("tab");
  const action = params.get("action");
  if (!tab && !action) return;
  if (action === "addtodo") activateTab("todo");
  else if (tab && (isTab(NAV_TAB(tab)) || tab === "style") && tab !== "home") activateTab(tab);
  if (action === "addtodo") openComposer("todo");
  history.replaceState(null, "", location.pathname);
}
