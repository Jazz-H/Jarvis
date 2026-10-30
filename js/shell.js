// shell.js - App shell: tab switching and the delegated click/keydown/input/change action tables.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- TAB SWITCHING ----------
const TAB_ORDER = ["home", "todo", "jazz3", "wants", "skin"]; // nav bar and swipe order
// Tabs kept but not in the bar (Budget is hidden for now): links can still open them
const HIDDEN_TABS = ["budget"];
const isTab = (tab) => TAB_ORDER.includes(tab) || HIDDEN_TABS.includes(tab);
// Old links to the removed closet view (?tab=style) land on Shopping
// ?tab=jarvis is the briefing link: Jarvis lives at the top of the main (home) tab
const NAV_TAB = (tab) => (tab === "style" ? "wants" : tab === "fitness" ? "jazz3" : tab === "jarvis" ? "home" : tab); // old links
let currentTab = "home";

function activateTab(tab) {
  tab = NAV_TAB(tab);
  currentTab = tab;
  document.body.dataset.tab = tab; // shows/hides the floating + button
  const fabCfg = COMPOSER_MODES[FAB_MODE_BY_TAB[tab]];
  if (fabCfg) document.getElementById("fab").setAttribute("aria-label", fabCfg.fab);
  if (tab === "home") renderHome(); // picks up whatever changed on other tabs
  document.querySelectorAll("nav.tabbar button").forEach((b) => {
    const active = b.dataset.tab === NAV_TAB(tab);
    b.classList.toggle("active", active);
    if (active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  document.querySelectorAll(".tabpanel").forEach((p) => p.classList.toggle("active", p.id === "panel-" + tab));
  document.getElementById("headline").textContent = HEADLINES[tab];
  document.querySelector("main").scrollTop = 0;
}

// Static shell actions (header, FAB, composer, modal) use data-action attributes and one
// delegated listener per event on <body>. The listener is in the bubbling phase and below
// `document`, so the capture-phase drag click suppressor still runs first. `el` is the matched
// element (the logical currentTarget); backdrops only act when the click landed on themselves.
const isIsoDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && isoDate(noonOf(s)) === s;
// Per-key value rules for the composer's generic "composer-set" chips, and which keys each mode may toggle.
const COMPOSER_SET = {
  kind: (v) => composer.mode === "shop" && (v === "need" || v === "want"),
  cat: (v) =>
    composer.mode === "shop"
      ? ["general", "moto", "wardrobe"].includes(v)
      : composer.mode === "money" && composer.type === "expense" && budget.categories.some((c) => c.id === v),
  wcat: (v) => composer.mode === "shop" && composer.cat === "wardrobe" && [...CAP_CATS, "Other"].includes(v),
  type: (v) =>
    composer.mode === "money" && (v === "expense" || v === "bill" || (v === "goal" && budget.goals.length > 0)),
  goal: (v) => composer.mode === "money" && composer.type === "goal" && budget.goals.some((g) => g.id === v),
  repeat: (v) =>
    composer.mode === "money"
      ? composer.type === "bill" && Object.prototype.hasOwnProperty.call(BILL_REPEATS, v)
      : composer.mode === "todo" &&
        !!composer.repeat &&
        Object.prototype.hasOwnProperty.call(REPEATS, v) &&
        !CUSTOM_REPEATS[v],
};
const COMPOSER_TOGGLES = { todo: ["star"], shop: ["high", "later"], money: ["autopay"] };
const ROUTINE_BANDS = ["am", "pm", "washPm"];
// "srcId|YYYY-MM-DD" for a real income source on one of its paydays; otherwise "" (inert)
function planKeyOk(k) {
  if (typeof k !== "string") return "";
  const i = k.lastIndexOf("|"),
    s = k.slice(0, i),
    d = k.slice(i + 1);
  return i > 0 && SAFE_ID.test(s) && isIsoDate(d) && isPayday(s, d) ? k : "";
}
function weighRowOpen(el) {
  const id = el.getAttribute("data-weight-id"),
    date = el.getAttribute("data-date");
  if (!isIsoDate(date)) return;
  if (id === "") logWeight(null, date);
  else if (SAFE_ID.test(id || "") && fitness.weights.some((w) => w.id === id)) logWeight(id, date);
}
function plan3FromEl(el) {
  const id = el.getAttribute("data-plan3-id");
  return id && SAFE_ID.test(id) ? plan3.find((x) => x.id === id) : undefined;
}
function wantFromEl(el) {
  const id = el.getAttribute("data-want-id");
  return id && SAFE_ID.test(id) ? wantsList.find((w) => w.id === id) : undefined;
}
function homeRowTodo(el) {
  const id = el.getAttribute("data-todo-id");
  return id && SAFE_ID.test(id) ? todoList.find((x) => x.id === id) : undefined;
}
function workoutOccurrence(el) {
  const id = el.getAttribute("data-workout-id"),
    iso = el.getAttribute("data-date");
  if (!id || !SAFE_ID.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(iso) || isoDate(noonOf(iso)) !== iso) return null;
  const w = fitness.plan.find((x) => x.id === id);
  return w && workoutOn(w, iso) ? w : null;
}
// Sub-item actions need the parent to-do AND the sub-item to still exist; add needs the parent and its rendered input.
function homeRowSubitem(el) {
  const t = homeRowTodo(el),
    sid = el.getAttribute("data-sub-id");
  return t && sid && SAFE_ID.test(sid) && (t.subitems || []).some((x) => x.id === sid) ? t : undefined;
}
function subitemAddFrom(el) {
  const t = homeRowTodo(el);
  if (t && document.getElementById(`subitem-input-${t.id}`)) addSubitem(t.id);
}
const SHELL_CLICK = {
  "open-sync": () => openSyncModal(),
  "hard-refresh": (el) => {
    el.classList.add("spinning");
    hardRefresh();
  },
  "open-composer": () => openComposer(fabMode()),
  "composer-backdrop": (el, e) => {
    if (e.target === el) closeComposer();
  },
  "close-composer": () => closeComposer(),
  "composer-add": () => composerAdd(),
  "modal-backdrop": (el, e) => {
    if (e.target === el) closeModal();
  },
  "close-modal": () => closeModal(),
  "modal-delete": () => modalDelete(),
  "modal-save": () => modalSave(),
  // Home date strip / calendar (generated markup). Metadata is validated before calling through.
  "home-select-date": (el) => {
    const iso = el.getAttribute("data-date");
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && isoDate(noonOf(iso)) === iso) selectHomeDate(iso);
  },
  "home-shift-cal": (el) => {
    const delta = el.getAttribute("data-delta");
    if (delta === "-1" || delta === "1") shiftHomeCal(Number(delta));
  },
  // Regular Home to-do rows (homeRowHtml). The id must be safe and still match a to-do in the right state.
  "home-todo-complete": (el) => {
    const t = homeRowTodo(el);
    if (t && !t.done) completeTodo(t.id);
  },
  "home-todo-toggle": (el) => {
    const t = homeRowTodo(el);
    if (t && t.done) toggleTodo(t.id);
  },
  "home-todo-edit": (el) => {
    const t = homeRowTodo(el);
    if (t) editTodo(t.id);
  },
  // To-Do tab rows (todoRow) reuse the three home-todo-* actions for check/body (open items only). Star and sub-items expand
  // are To-Do tab only; both stop propagation so the click never reaches the row body editor.
  "todo-star": (el, e) => {
    e.stopPropagation();
    const t = homeRowTodo(el);
    if (t) toggleTodoStar(t.id);
  },
  "todo-expand": (el, e) => {
    e.stopPropagation();
    const t = homeRowTodo(el);
    if (t) toggleTodoExpand(t.id);
  },
  // Completed to-do rows (renderTodoPanel): restore reuses home-todo-toggle (done rows only). Duplicate and delete stop
  // propagation; delete keeps its confirm() inside deleteTodoPermanently, so cancelling changes nothing.
  "todo-duplicate": (el, e) => {
    e.stopPropagation();
    const t = homeRowTodo(el);
    if (t) duplicateTodo(t.id);
  },
  "todo-delete": (el, e) => {
    e.stopPropagation();
    const t = homeRowTodo(el);
    if (t) deleteTodoPermanently(t.id);
  },
  // Completed section header toggle and Clear completed; clearCompletedTodos keeps its confirm(), so cancelling changes nothing.
  "todo-completed-toggle": () => toggleCompletedTodos(),
  "todo-completed-clear": () => clearCompletedTodos(),
  // Sub-item list (renderSubitems). Ids must be safe and still match the current to-do / sub-item. Every action stops
  // propagation (like the old inline handlers did) so nothing reaches the parent row; the list itself swallows stray clicks.
  "subitem-list": (el, e) => e.stopPropagation(),
  "subitem-toggle": (el, e) => {
    e.stopPropagation();
    if (homeRowSubitem(el)) toggleSubitem(el.getAttribute("data-todo-id"), el.getAttribute("data-sub-id"));
  },
  "subitem-delete": (el, e) => {
    e.stopPropagation();
    if (homeRowSubitem(el)) deleteSubitem(el.getAttribute("data-todo-id"), el.getAttribute("data-sub-id"));
  },
  "subitem-open-add": (el, e) => {
    e.stopPropagation();
    const t = homeRowTodo(el);
    if (t) openSubitemAdd(t.id);
  },
  "subitem-add": (el, e) => {
    e.stopPropagation();
    subitemAddFrom(el);
  },
  // Wash-hair row (washRowHtml). The check validates its date; the body just opens the card.
  "home-wash-toggle": (el) => {
    const iso = el.getAttribute("data-date");
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && isoDate(noonOf(iso)) === iso) toggleWashHair(iso);
  },
  "home-wash-open": () => openWashCard(),
  // Bill pay/unpay checks (Home and Budget rows). Ids must be safe and still match current state: pay needs an open bill on the
  // rendered due date; unpay needs an existing payment (unpayBill itself enforces latest-payment-only). stopPropagation keeps
  // the click from reaching anything else, e.g. a row editor.
  "bill-pay": (el, e) => {
    e.stopPropagation();
    const id = el.getAttribute("data-bill-id"),
      due = el.getAttribute("data-due");
    if (!id || !SAFE_ID.test(id)) return;
    const b = bills.find((x) => x.id === id);
    if (b && !b.done && b.due && b.due === due) payBill(b.id);
  },
  "bill-unpay": (el, e) => {
    e.stopPropagation();
    const id = el.getAttribute("data-payment-id");
    if (id && SAFE_ID.test(id) && billPayments.some((x) => x.id === id)) unpayBill(id);
  },
  // Home bill row body (homeBillHtml): mode "edit" needs a safe id that still matches a bill; mode "budget" (paid rows) opens the Budget tab.
  "home-bill-open": (el) => {
    const mode = el.getAttribute("data-mode");
    if (mode === "budget") {
      activateTab("budget");
      return;
    }
    const id = el.getAttribute("data-bill-id");
    if (mode === "edit" && id && SAFE_ID.test(id) && bills.some((x) => x.id === id)) editBill(id);
  },
  // Fitness tab Weight card (renderFitness). Entry ids must be safe and still match a logged weigh-in.
  "fitness-weight-goal": () => editWeightGoal(),
  "fitness-weigh-day": () => editWeighDay(),
  "fitness-log-weight": () => logWeight(),
  "fitness-weigh-history": () => {
    showWeighIns = !showWeighIns;
    renderFitness();
  },
  "fitness-weigh-edit": (el) => {
    const id = el.getAttribute("data-weight-id");
    if (id && SAFE_ID.test(id) && fitness.weights.some((w) => w.id === id)) logWeight(id);
  },
  // Fitness Workouts card (workoutsCardHtml). Edit needs a safe id that still matches a planned workout; Add opens a blank editor.
  "fitness-workout-edit": (el) => {
    const id = el.getAttribute("data-workout-id");
    if (id && SAFE_ID.test(id) && fitness.plan.some((w) => w.id === id)) editWorkout(id);
  },
  "fitness-workout-add": () => editWorkout(),
  // Workout occurrence rows (workoutRowHtml; Home day list and To-Do upcoming groups). The row must name a planned workout that
  // really lands on the rendered date. Only today and earlier dates can be checked (future rows are previews with no check).
  "workout-occ-edit": (el) => {
    if (workoutOccurrence(el)) editWorkout(el.getAttribute("data-workout-id"));
  },
  "workout-occ-toggle": (el, e) => {
    e.stopPropagation();
    const iso = el.getAttribute("data-date");
    if (workoutOccurrence(el) && iso <= addDaysIso(0)) toggleWorkout(iso, el.getAttribute("data-workout-id"));
  },
  // Generated Home links (more anytime / All to-dos) both open the To-Do tab through the existing tab route.
  "home-open-todo": () => activateTab("todo"),
  "theme-cycle": () => cycleTheme(),
  // Jarvis dashboard: tiles and briefing lines drill into details; links go to a tab (and a Jazz 3.0 card).
  // Both only accept their own section names and card ids.
  "jv-drill": (el) => dashDrill(el.getAttribute("data-go")),
  "jv-quick-add": () => dashQuickAdd(),
  "jv-wash-move": () => dashWashMove(), // re-checks the suggestion before changing anything
  "jv-wash-keep": () => dashWashKeep(),
  "jv-goal-another": () => dashGoalAnother(),
  "jv-outfit-swap": () => dashOutfitSwap(),
  "jv-layout-open": () => dashLayoutToggleOpen(),
  "jv-push-on": () => enablePush(),
  "jv-push-later": () => pushLater(),
  "jv-layout-move": (el) => dashLayoutMove(el.getAttribute("data-go"), Number(el.getAttribute("data-dir"))),
  "jv-layout-toggle": (el) => dashLayoutToggle(el.getAttribute("data-go")),
  "jv-go": (el) => dashGo(el.getAttribute("data-go"), el.getAttribute("data-card")),
  // Budget / bills. Every id, date and index is revalidated against live data; stale or forged metadata does nothing.
  "stop-click": (el, e) => e.stopPropagation(),
  "bill-row-open": (el) => {
    const mode = el.getAttribute("data-mode");
    if (mode === "payment") {
      const id = el.getAttribute("data-payment-id");
      if (SAFE_ID.test(id || "") && billPayments.some((p) => p.id === id)) editPayment(id);
    } else if (mode === "bill") {
      const id = el.getAttribute("data-bill-id");
      if (SAFE_ID.test(id || "") && bills.some((b) => b.id === id)) editBill(id);
    }
  },
  "bill-add": () => addBill(),
  "expense-edit": (el) => {
    const id = el.getAttribute("data-expense-id");
    if (SAFE_ID.test(id || "")) editExpense(id);
  },
  "budget-cat-toggle": (el) => {
    const id = el.getAttribute("data-cat-id");
    if (SAFE_ID.test(id || "") && budgetCat(id)) toggleBudgetCat(id);
  },
  "budget-cat-edit": (el) => {
    const id = el.getAttribute("data-cat-id");
    if (SAFE_ID.test(id || "") && budgetCat(id)) editBudgetCat(id);
  },
  "budget-cat-add": () => editBudgetCat(),
  "account-edit": (el) => {
    const i = Number(el.getAttribute("data-index"));
    if (Number.isInteger(i) && i >= 0 && i < budget.accounts.length) editAccount(i);
  },
  "account-add": () => editAccount(),
  "budget-select-day": (el) => {
    const d = el.getAttribute("data-date");
    if (isIsoDate(d)) selectBudgetDay(d);
  },
  "budget-cal-open": (el) => {
    const v = el.getAttribute("data-open");
    if (v === "true" || v === "false") setBudgetCalMonth(v === "true");
  },
  "budget-month": (el) => {
    const n = el.getAttribute("data-delta");
    if (n === "1" || n === "-1") shiftBudgetMonth(Number(n));
  },
  "budget-add-income": () => addIncome(),
  "budget-goals-scroll": () => {
    const g = document.getElementById("goals-card");
    if (g) g.scrollIntoView({ behavior: "smooth" });
  },
  "budget-manage-open": () => openBudgetManage(),
  "paycheck-edit": (el) => {
    const s = el.getAttribute("data-src-id"),
      d = el.getAttribute("data-date");
    if (SAFE_ID.test(s || "") && isIsoDate(d) && budget.income.some((i) => i.id === s)) editPaycheck(s, d);
  },
  "paycheck-received": (el) => {
    const s = el.getAttribute("data-src-id"),
      d = el.getAttribute("data-date");
    if (SAFE_ID.test(s || "") && isIsoDate(d) && budget.income.some((i) => i.id === s)) toggleReceived(s, d);
  },
  "plan-line-toggle": (el) => {
    const k = planKeyOk(el.getAttribute("data-plan-key")),
      id = el.getAttribute("data-line-id");
    if (k && SAFE_ID.test(id || "")) togglePlanLine(k, id);
  },
  "plan-line-edit": (el) => {
    const k = planKeyOk(el.getAttribute("data-plan-key")),
      id = el.getAttribute("data-line-id");
    if (k && SAFE_ID.test(id || "")) editPlanLine(k, id);
  },
  "plan-line-add": (el) => {
    const k = planKeyOk(el.getAttribute("data-plan-key"));
    if (k) addPlanLine(k);
  },
  // The hint's label/amount are recomputed here (never carried in markup).
  "plan-hint": (el) => {
    const k = planKeyOk(el.getAttribute("data-plan-key"));
    if (!k) return;
    const date = k.slice(k.lastIndexOf("|") + 1),
      plan = budget.plans[k];
    if (plan && plan.lines.some((l) => /bill/i.test(l.name))) return;
    const next = nextPayday(date) || isoDate(new Date(noonOf(monthEndIso(date.slice(0, 7))).getTime() + 864e5));
    const end = isoDate(new Date(noonOf(next).getTime() - 864e5)),
      due = r2(sum(billRowsBetween(date, next)));
    if (due > 0) quickPlanLine(k, `Bills due ${shortDate(date)}–${shortDate(end)}`, due);
  },
  "plans-copy-prev": () => copyPrevPlans(),
  "manage-run": (el) => {
    const op = el.getAttribute("data-op"),
      id = el.getAttribute("data-id");
    if (op === "edit-income") {
      if (SAFE_ID.test(id || "") && budget.income.some((i) => i.id === id)) editIncome(id);
    } else if (op === "add-income") addIncome();
    else if (op === "new-goal") editGoal();
    else if (op === "show-spending") {
      closeModal();
      showSpending = true;
      renderBudget();
    } else if (op === "accounts") openAccounts();
    else if (op === "import-bills") importBills();
    else if (op === "import-income") importIncome();
    else if (op === "import-plans") importPlans();
  },
  // Goals
  "goal-new": () => editGoal(),
  "goal-edit": (el) => {
    const id = el.getAttribute("data-goal-id");
    if (SAFE_ID.test(id || "") && goalById(id)) editGoal(id);
  },
  "goal-add": (el) => {
    const id = el.getAttribute("data-goal-id"),
      eid = el.getAttribute("data-entry-id"),
      g = SAFE_ID.test(id || "") && goalById(id);
    if (!g) return;
    if (eid === null) addToGoal(id);
    else if (SAFE_ID.test(eid) && g.log.some((x) => x.id === eid)) addToGoal(id, eid);
  },
  "goal-toggle": (el) => {
    const id = el.getAttribute("data-goal-id");
    if (SAFE_ID.test(id || "") && goalById(id)) toggleGoal(id);
  },
  "goal-idea": (el) => {
    const n = GOAL_IDEAS[Number(el.getAttribute("data-idea"))],
      input = document.getElementById("modal-name");
    if (n && input) input.value = n;
  },
  // Backup (Settings sheet)
  "backup-download": () => downloadBackup(),
  "backup-restore": () => restoreBackup(),
  // Composer chips (cchip). Each validates the key/value against the composer's current mode before mutating, then re-renders the chips.
  "composer-set": (el) => {
    const key = el.getAttribute("data-key"),
      val = el.getAttribute("data-val");
    const rule = Object.prototype.hasOwnProperty.call(COMPOSER_SET, key) && COMPOSER_SET[key];
    if (composer && rule && rule(val)) {
      composer[key] = val;
      renderComposerChips();
    }
  },
  "composer-toggle": (el) => {
    const key = el.getAttribute("data-key");
    if (composer && (COMPOSER_TOGGLES[composer.mode] || []).includes(key)) {
      composer[key] = !composer[key];
      renderComposerChips();
    }
  },
  "composer-pick-date": (el) => {
    if (composer && composer.mode === "todo" && isIsoDate(el.getAttribute("data-date")))
      composerPickDate(el.getAttribute("data-date"));
  },
  "composer-set-date": (el) => {
    if (composer && composer.mode === "money" && isIsoDate(el.getAttribute("data-date"))) {
      composer.date = el.getAttribute("data-date");
      renderComposerChips();
    }
  },
  "composer-open-picker": () => {
    if (composer && (composer.mode === "todo" || composer.mode === "money")) composerOpenPicker();
  },
  "composer-toggle-more": () => {
    if (composer && (composer.mode === "todo" || composer.mode === "shop")) composerToggleMore();
  },
  "composer-repeat-toggle": () => {
    if (composer && composer.mode === "todo") {
      composer.repeat = composer.repeat ? null : "weekly";
      renderComposerChips();
    }
  },
  "composer-ignore-parse": () => {
    if (composer && (composer.mode === "shop" || composer.mode === "money")) {
      composer.ignoreParse = true;
      renderComposerChips();
    }
  },
  "composer-group-toggle": () => {
    if (composer && composer.mode === "money" && composer.type === "bill") {
      composer.group = composer.group === "joint" ? "personal" : "joint";
      renderComposerChips();
    }
  },
  "composer-account": (el) => {
    const i = el.getAttribute("data-index");
    if (
      composer &&
      composer.mode === "money" &&
      composer.type === "bill" &&
      /^\d+$/.test(i) &&
      budget.accounts[Number(i)] != null
    ) {
      const a = budget.accounts[Number(i)];
      composer.account = composer.account === a ? null : a;
      renderComposerChips();
    }
  },
  // To-do editor sheet (tdeHtml). tdeSet itself clamps/normalises; these only pass through values of the right shape.
  "tde-open-subs": (el) => {
    const subs = document.getElementById("modal-subs"),
      field = subs && subs.closest(".modal-field");
    if (!field) return;
    el.remove();
    field.hidden = false;
    subs.focus();
  },
  "tde-due": (el) => {
    const d = el.getAttribute("data-date");
    if (tde && (d === "" || isIsoDate(d))) tdeSet({ due: d || null });
  },
  "tde-end": (el) => {
    const d = el.getAttribute("data-date");
    if (tde && (d === "" || isIsoDate(d))) tdeSet({ end: d || null });
  },
  "tde-repeat": (el) => {
    const r = el.getAttribute("data-repeat");
    if (tde && (r === "" || TDE_REPEATS.some(([k]) => k === r) || CUSTOM_REPEATS[r] === r))
      tdeSet({ repeat: r || null });
  },
  "tde-every": (el) => {
    const d = el.getAttribute("data-delta");
    if (tde && (d === "-1" || d === "1")) tdeSet({ every: tde.every + Number(d) });
  },
  "tde-kind": (el) => {
    const k = el.getAttribute("data-kind");
    if (tde && (k === "" || k === "none" || KIND_ORDER.includes(k))) tdeSet({ kind: k || null });
  },
  "tde-show-picker": (el) => {
    try {
      el.showPicker();
    } catch (err) {}
  },
  // Collapsible card header (collapsibleCard): the id must be safe and name a rendered card.
  "coll-toggle": (el) => {
    const id = el.getAttribute("data-card-id"),
      card = id && SAFE_ID.test(id) ? document.getElementById(id) : null;
    if (card && card.classList.contains("pinned")) toggleRules(id);
  },
  // Skin tab: Today checklist, band folds, week days, routine editor, rules, wash-day calendar.
  "routine-step": (el) => {
    const band = el.getAttribute("data-band"),
      id = el.getAttribute("data-step-id");
    if ((band === "am" || band === "pm") && id && routineForDate(new Date())[band].some((s) => s.id === id))
      toggleRoutineStep(band, id);
  },
  "routine-band": (el) => {
    const band = el.getAttribute("data-band");
    if (band === "am" || band === "pm") toggleRoutineBand(band);
  },
  "week-day": (el) => {
    if (isIsoDate(el.getAttribute("data-date"))) toggleWeekDay(el.getAttribute("data-date"));
  },
  "routine-step-edit": (el) => {
    const band = el.getAttribute("data-step-band"),
      id = el.getAttribute("data-step-id");
    if (ROUTINE_BANDS.includes(band) && id && skinRoutine[band].some((s) => s.id === id)) editRoutineStep(band, id);
  },
  "routine-step-add": (el) => {
    const band = el.getAttribute("data-step-band");
    if (ROUTINE_BANDS.includes(band)) addRoutineStep(band);
  },
  "skin-rule-edit": (el) => {
    const i = el.getAttribute("data-index");
    if (/^\d+$/.test(i) && Number(i) < skinRules.length) editSkinRule(Number(i));
  },
  "skin-rule-add": () => addSkinRule(),
  "wash-date": (el) => {
    if (isIsoDate(el.getAttribute("data-date"))) setWashDate(el.getAttribute("data-date"));
  },
  "wash-frequency": (el) => {
    const n = el.getAttribute("data-days");
    if (WASH_FREQUENCIES.some(([d]) => String(d) === n)) setWashFrequency(Number(n));
  },
  "wash-month": (el) => {
    const d = el.getAttribute("data-delta");
    if (d === "-1" || d === "1") shiftWashMonth(Number(d));
  },
  // Weigh-in row (weighRowHtml; Home and To-Do). Date must be real; an id (when present) must still match a logged weigh-in.
  "weigh-row-open": (el) => weighRowOpen(el),
  "weigh-row-check": (el, e) => {
    e.stopPropagation();
    weighRowOpen(el);
  },
  // Jazz 3.0 (Plan 3): hero chips jump to a card; rows toggle/edit by id; add buttons name their section by position.
  "j3-jump": (el) => {
    const id = el.getAttribute("data-target");
    if (id === "weight-card" || (id && plan3Cats().some((c) => id === "p3-" + plan3Slug(c)))) jumpToJ3(id);
  },
  "plan3-toggle": (el) => {
    const x = plan3FromEl(el);
    if (x) togglePlan3(x.id);
  },
  "plan3-edit": (el) => {
    const x = plan3FromEl(el);
    if (x) editPlan3(x.id);
  },
  "plan3-add": (el) => {
    const i = el.getAttribute("data-cat-index"),
      cat = /^\d+$/.test(i) ? plan3Cats()[Number(i)] : undefined;
    if (cat !== undefined) editPlan3(null, cat);
  },
  "plan3-new-section": () => editPlan3(null, "New section…"),
  // Shopping tab: filter chips, want rows (body opens the editor unless a link inside was clicked), bought and Later buttons.
  "wants-filter": (el) => {
    const f = el.getAttribute("data-filter");
    if (["all", "need", "want", "wardrobe", "moto"].includes(f)) {
      wantsFilter = f;
      renderWants();
    }
  },
  "want-edit": (el, e) => {
    if (!e.target.closest("a") && wantFromEl(el)) editWant(el.getAttribute("data-want-id"));
  },
  "want-toggle": (el) => {
    if (wantFromEl(el)) toggleWant(el.getAttribute("data-want-id"));
  },
  "want-later": (el) => {
    const later = el.getAttribute("data-later");
    if ((later === "true" || later === "false") && wantFromEl(el))
      setWantLater(el.getAttribute("data-want-id"), later === "true");
  },
  "home-cal-open": (el) => {
    const open = el.getAttribute("data-open");
    if (open === "true" || open === "false") setHomeCalOpen(open === "true");
  },
};
const SHELL_KEYDOWN = {
  "jv-quick-key": (el, e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      dashQuickAdd();
    }
  },
  "subitem-add-key": (el, e) => {
    if (e.key === "Enter") subitemAddFrom(el);
  },
};
const SHELL_INPUT = {
  "composer-text": () => composerTextChanged(),
  "jv-quick-input": (el) => {
    dashQuickText = el.value; // kept across re-renders while typing
  },
};
const SHELL_CHANGE = {
  "tde-date": (el) => {
    const f = el.getAttribute("data-field");
    if (tde && (f === "due" || f === "end")) tdeSet({ [f]: el.value });
  },
  "composer-date": (el) => {
    if (el.value) {
      composer.manual = true;
      composer.date = el.value;
      renderComposerChips();
    }
  },
};
function delegateShell(type, attr, table) {
  document.body.addEventListener(type, (e) => {
    const el = e.target.closest && e.target.closest(`[${attr}]`);
    const fn = el && table[el.getAttribute(attr)];
    if (!fn) return;
    const hadFocus = type === "click" && document.activeElement === el;
    fn(el, e);
    // a re-render replaced the control the keyboard was on (a star, a tick): focus its new copy
    const lost = !document.activeElement || document.activeElement === document.body;
    if (hadFocus && lost && !document.contains(el)) refocusTwin(el);
  });
}
function refocusTwin(el) {
  const sel = [...el.attributes]
    .filter((a) => a.name.startsWith("data-"))
    .map((a) => `[${a.name}="${CSS.escape(a.value)}"]`)
    .join("");
  const twin = sel && document.querySelector(el.tagName.toLowerCase() + sel);
  if (twin) twin.focus({ preventScroll: true });
}
delegateShell("click", "data-action", SHELL_CLICK);
delegateShell("keydown", "data-keydown-action", SHELL_KEYDOWN);
delegateShell("input", "data-input-action", SHELL_INPUT);
delegateShell("change", "data-change-action", SHELL_CHANGE);
// Rows that act as buttons but hold block content (a to-do's text, a card header) are
// role="button" tabindex="0"; Enter and Space activate them like a real button.
document.body.addEventListener("keydown", (e) => {
  if ((e.key !== "Enter" && e.key !== " ") || e.defaultPrevented) return;
  const el = e.target;
  if (!el || el.tagName === "BUTTON" || el.getAttribute("role") !== "button" || !el.hasAttribute("data-action")) return;
  e.preventDefault();
  el.click();
});
// `error` doesn't bubble, so catch it in the capture phase: a bill logo that fails to load swaps in its letter fallback.
document.addEventListener(
  "error",
  (e) => {
    const t = e.target;
    if (t && t.tagName === "IMG" && t.classList.contains("bill-logo") && t.hasAttribute("data-fb") && t.parentNode)
      t.outerHTML = t.getAttribute("data-fb");
  },
  true,
);

document.querySelectorAll("nav.tabbar button").forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});
