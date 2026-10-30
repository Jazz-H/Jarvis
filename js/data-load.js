// data-load.js - Loading, sanitizing and migrating stored data.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- INIT ----------
function loadAllContent() {
  skinRules = loadContent("skin-rules-content", DEFAULT_SKIN_RULES);
  // skin-routine-content wins; before the first routine edit it's derived from the
  // legacy per-day lists (or the defaults), deterministically, so nothing is written here
  skinRoutine =
    loadContent("skin-routine-content", null) || routineFromDays(loadContent("skin-days-content", DEFAULT_SKIN_DAYS));
  routineChecks = loadContent("routine-checks", {});
  styleRules = loadContent("style-rules-content", DEFAULT_STYLE_RULES);
  sizes = loadContent("sizes-content", DEFAULT_SIZES);
  capsule = loadContent("capsule-content", DEFAULT_CAPSULE);
  wantsList = loadContent("wants-content", DEFAULT_WANTS);
  todoList = loadContent("todo-content", DEFAULT_TODO);
  sanitizeCoreData(); // before anything walks these lists
  if (migrateTodoDays(todoList)) writeQuietly("todo-content", todoList);
  bills = loadContent("bills-content", []);
  billPayments = loadContent("bill-payments", []);
  budget = loadContent("budget-content", JSON.parse(JSON.stringify(DEFAULT_BUDGET)));
  normalizeBudgetData();
  pruneBudgetHistory();
  if (processAutopay()) {
    writeQuietly("bills-content", bills);
    writeQuietly("bill-payments", billPayments);
  }
  fitness = loadContent("fitness-content", JSON.parse(JSON.stringify(DEFAULT_FITNESS)));
  normalizeFitness();
  plan3 = loadContent(
    "plan3-content",
    DEFAULT_PLAN3.map((x) => ({ ...x })),
  );
  normalizePlan3();
  normalizeLoadedData(); // last: needs every list loaded
  loadConsoleFeed(); // Console's feed (this device only; never synced) is re-checked on every load and sync
  if (applyRoutineAdditions(skinRoutine)) writeQuietly("skin-routine-content", skinRoutine);
  const keptRules = skinRules.filter((r) => !RETIRED_SKIN_RULES.includes(r));
  if (keptRules.length !== skinRules.length) {
    skinRules = keptRules;
    writeQuietly("skin-rules-content", skinRules);
  }
}
// Steps added to an existing routine after it was set up. Each is applied once
// per routine (tracked in `added`, which syncs with it), so deleting a step
// later sticks. Ids are fixed so two devices adding the same step agree.
const ROUTINE_ADDITIONS = [
  // Every night (no `days`) for the box's 20-day course
  {
    key: "teeth-whitening",
    band: "pm",
    step: {
      id: "pm-teeth-whitening",
      label: "Teeth whitening",
      product: "Crest 3D Whitestrips Professional Effects",
      note: "Brush first; 30 min. 20-day course, then delete this step or set touch-up days",
    },
  },
  {
    key: "pore-strips",
    band: "pm",
    after: /^cleanse/i,
    step: {
      id: "pm-pore-strips",
      label: "Pore strips",
      product: "Bioré Witch Hazel Ultra Strength Blackhead Remover Pore Strips",
      note: "Wet your nose, press on, peel after 10–15 min. No more than every 3 days",
      days: [0],
    },
  },
];
function applyRoutineAdditions(r) {
  r.added = Array.isArray(r.added) ? r.added : [];
  let changed = false;
  ROUTINE_ADDITIONS.forEach(({ key, band, after, step }) => {
    if (r.added.includes(key)) return;
    const list = r[band] || (r[band] = []);
    if (!list.some((x) => x.id === step.id)) {
      const i = after ? list.findIndex((x) => after.test(x.label)) : -1;
      list.splice(i + 1, 0, JSON.parse(JSON.stringify(step))); // no anchor: goes first
    }
    r.added.push(key);
    changed = true;
  });
  return changed;
}
// Stored data can arrive from sync or a backup file, so it's treated as untrusted:
// text is escaped wherever it's rendered, and ids — which are interpolated into
// inline onclick handlers — must be plain tokens or they're replaced. Older builds
// also stored a few strings as HTML ("&amp;"); those are decoded so all text is
// plain. Runs on every load (idempotent), so nothing is written here.
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
function safeId(id, prefix) {
  return SAFE_ID.test(String(id)) ? id : genId(prefix);
}
// Shape checks for everything outside Budget (which has normalizeBudgetData).
// Synced or restored data is untrusted: wrong types are coerced or dropped, so
// one malformed record can't stop the app from starting. Runs on every load.
function sanitizeCoreData() {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const str = (v, max) => String(v == null ? "" : v).slice(0, max);
  const isIso = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  todoList = arr(todoList).filter(isObj);
  todoList.forEach((t) => {
    t.text = str(t.text, 500);
    t.done = !!t.done;
    t.starred = !!t.starred;
    if ("due" in t && t.due !== null && !isIso(t.due)) t.due = null; // (an absent due is left for migrateTodoDays)
    if (t.completedAt != null && !isFinite(Number(t.completedAt))) t.completedAt = null;
    t.subitems = arr(t.subitems)
      .filter(isObj)
      .map((st) => ({ ...st, text: str(st.text, 500), done: !!st.done }));
    if ("repeatDay" in t && !(Number.isInteger(t.repeatDay) && t.repeatDay >= 1 && t.repeatDay <= 31))
      delete t.repeatDay;
  });
  if (!isObj(skinRoutine)) skinRoutine = routineFromDays(DEFAULT_SKIN_DAYS);
  ["am", "pm", "washPm"].forEach((b) => {
    skinRoutine[b] = arr(skinRoutine[b])
      .filter(isObj)
      .map((st) => {
        const step = { ...st, label: str(st.label, 120), product: str(st.product, 200) };
        if (st.note != null) step.note = str(st.note, 200);
        else delete step.note;
        const days = arr(st.days).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
        if (days.length && days.length < 7) step.days = [...new Set(days)];
        else delete step.days;
        return step;
      });
  });
  if (!isObj(routineChecks)) routineChecks = {};
  Object.keys(routineChecks).forEach((k) => {
    const c = routineChecks[k];
    if (!isIso(k) || !isObj(c)) {
      delete routineChecks[k];
      return;
    }
    c.am = arr(c.am).map(String);
    c.pm = arr(c.pm).map(String);
  });
  skinRules = arr(skinRules).filter((r) => typeof r === "string");
  styleRules = arr(styleRules).filter((r) => typeof r === "string");
  sizes = arr(sizes)
    .filter((x) => Array.isArray(x) && x.length >= 2)
    .map(([k, v]) => [str(k, 60), str(v, 120)]);
  capsule = arr(capsule)
    .filter(isObj)
    .map((i) => ({ ...i, title: str(i.title, 200) }));
  wantsList = arr(wantsList)
    .filter(isObj)
    .map((w) => {
      const x = {
        ...w,
        name: str(w.name, 200),
        price: w.price == null || !isFinite(Number(w.price)) ? null : Math.max(0, Number(w.price)),
      };
      if (x.later !== true) delete x.later;
      return x;
    });
}
function normalizeLoadedData() {
  skinRules = skinRules.map(decodeEntities);
  styleRules = styleRules.map(decodeEntities);
  sizes = sizes.map(([k, v]) => [decodeEntities(k), decodeEntities(v)]);
  capsule.forEach((i) => {
    i.id = safeId(i.id, "cap");
    i.title = decodeEntities(i.title);
    if (i.sub) i.sub = decodeEntities(i.sub);
  });
  wantsList.forEach((w) => {
    w.id = safeId(w.id, "want");
    w.name = decodeEntities(w.name);
    if (w.meta) w.meta = decodeEntities(w.meta);
  });
  todoList.forEach((t) => {
    t.id = safeId(t.id, "todo");
    (t.subitems || []).forEach((st) => {
      st.id = safeId(st.id, "sub");
    });
  });
  todoList.forEach((t) => {
    if ("repeat" in t && !REPEATS[t.repeat]) delete t.repeat;
  }); // unknown rules from sync/backup
  todoList.forEach((t) => {
    if ("every" in t) {
      const n = parseInt(t.every, 10);
      if (CUSTOM_REPEATS[t.repeat] && n >= 1) t.every = Math.min(99, n);
      else delete t.every;
    }
    if ("days" in t) {
      const n = parseInt(t.days, 10);
      if (t.due && n > 1) t.days = Math.min(60, n);
      else delete t.days;
    }
    if ("kind" in t && !TODO_KINDS[t.kind] && t.kind !== "none") delete t.kind;
  });
  ["am", "pm", "washPm"].forEach((b) =>
    (skinRoutine[b] || []).forEach((st) => {
      st.id = safeId(st.id, b);
    }),
  );
}
