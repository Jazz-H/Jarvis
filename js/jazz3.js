// jazz3.js - Jazz 3.0 plan: goal sections beyond fitness.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- JAZZ 3.0 PLAN ----------
// Goal areas beyond fitness (Glow, Leadership…): each is a section of the
// Jazz 3.0 tab holding a checklist of items with a short note. One synced list:
//   plan3-content: [{id, cat, item, note, done?}]
const DEFAULT_PLAN3 = [
  ["Glow", "Night serum", "PM, three nights a week"],
  ["Glow", "Daily floss", "Any brand"],
  ["Glow", "Lip balm (AM/PM)", "SPF 30"],
  ["Glow", "Book a checkup", "Every 6–8 weeks"],
  ["Glow", "Hand cream", "Nightly"],
  ["Glow", "Weekly self-care", ""],
  ["Glow", "Morning routine", "AM"],
  ["Leadership", "Join a speaking club", "Check for a local club"],
  ["Leadership", "Blazer", "Structured"],
  ["Leadership", "Work pants", ""],
  ["Leadership", "Read a leadership book", "Any author"],
].map(([cat, item, note], i) => ({ id: `p3-${i + 1}`, cat, item, note })); // fixed ids, so two devices agree
let plan3 = [];
const plan3Slug = (cat) =>
  String(cat)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "goals";
function normalizePlan3() {
  plan3 = (Array.isArray(plan3) ? plan3 : [])
    .filter((x) => x && typeof x === "object" && String(x.item || "").trim())
    .map((x) => ({
      id: safeId(x.id, "p3"),
      cat:
        String(x.cat || "Goals")
          .trim()
          .slice(0, 30) || "Goals",
      item: String(x.item).trim().slice(0, 80),
      note: String(x.note || "").slice(0, 160),
      ...(x.done ? { done: true } : {}),
    }));
}
function plan3Cats() {
  return [...new Set(plan3.map((x) => x.cat))];
}
function savePlan3() {
  saveContent("plan3-content", plan3, { toast: false });
  renderFitness();
  renderHome(); // Home's Jazz 3.0 tile, goal bars and goal of the day
}
function togglePlan3(id) {
  const x = plan3.find((p) => p.id === id);
  if (!x) return;
  if (x.done) delete x.done;
  else x.done = true;
  savePlan3();
}
function editPlan3(id, cat = "") {
  const x = id ? plan3.find((p) => p.id === id) : null;
  const cats = plan3Cats(),
    NEW = "New section…";
  openModal(
    x ? "Edit item" : "Add item",
    [
      { key: "item", label: "Item", type: "text" },
      { key: "note", label: "Note (optional)", type: "text" },
      { key: "cat", label: "Section", type: "select", options: [...cats, NEW] },
      { key: "newcat", label: "New section name (if adding one)", type: "text" },
    ],
    x ? { item: x.item, note: x.note, cat: x.cat } : { cat: cat || (cats.length ? cats[0] : NEW) },
    (v) => {
      const item = (v.item || "").trim().slice(0, 80);
      if (!item) return;
      const c = v.cat === NEW || !cats.length ? (v.newcat || "").trim().slice(0, 30) : v.cat;
      if (!c) {
        showToast("Name the new section", true);
        return;
      }
      const t = x || { id: genId("p3") };
      t.item = item;
      t.note = (v.note || "").trim().slice(0, 160);
      t.cat = c;
      if (!x) plan3.push(t);
      openPinned.add("p3-" + plan3Slug(c));
      savePlan3();
    },
    x
      ? () => {
          plan3 = plan3.filter((p) => p.id !== id);
          savePlan3();
        }
      : null,
  );
}
const seenPlan3Cards = new Set(); // a section's card starts open the first time it's shown
// Banner at the top of Jazz 3.0: how many goal steps are done overall
function j3HeroHtml() {
  const done = plan3.filter((x) => x.done).length,
    pct = dashPct(done, plan3.length);
  return `<div class="j3-hero"><h2>Jazz 3.0</h2><p>Your next chapter${plan3.length ? ` · ${done} of ${plan3.length} steps done` : ""}</p>
    ${plan3.length ? `<div class="progress-bar j3-bar" role="progressbar" aria-label="Goal steps done" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill" style="width:${pct}%"></div></div>` : ""}</div>`;
}
// Days in a row with every planned workout done; rest days don't break it,
// and today counts once its workouts are done
function workoutStreak() {
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const iso = addDaysIso(-i),
      ws = workoutsOn(iso);
    if (!ws.length) continue;
    if (ws.every((w) => workoutDone(iso, w.id))) n++;
    else if (i > 0) break;
  }
  return n;
}
// Today: today's workouts and one goal step (Another picks a different one)
function j3TodayHtml() {
  const today = addDaysIso(0),
    ws = workoutsOn(today),
    g = dashGoalOfDay();
  if (!ws.length && !g) return "";
  const left = ws.filter((w) => !workoutDone(today, w.id)).length,
    streak = workoutStreak();
  const w = left ? `${left} workout${left === 1 ? "" : "s"}` : ws.length ? "Workouts done" : "";
  const head = g
    ? left
      ? `${w} and one step toward ${g.cat}`
      : w
        ? `${w}, one step toward ${g.cat}`
        : `One step toward ${g.cat}`
    : left
      ? `${w} today`
      : "Workouts done for today";
  const check = (on, label, attrs) =>
    `<button class="todo-check" role="checkbox" aria-checked="${on}" aria-label="${on ? "Not done" : "Done"}: ${escapeAttr(label)}" ${attrs}><span class="box">${BOX_CHECK_SVG}</span></button>`;
  const rows = ws.map((x) => {
    const done = workoutDone(today, x.id),
      attrs = `data-workout-id="${x.id}" data-date="${today}"`;
    return `<div class="p3-row j3-trow ${done ? "done" : ""}">${check(done, x.name, `data-action="workout-occ-toggle" ${attrs}`)}
      <button class="p3-body" data-action="workout-occ-edit" ${attrs}><b>${escapeHtml(x.name)}</b><i>${escapeHtml(["Workout", fmtTime(x.time)].filter(Boolean).join(" · "))}</i></button></div>`;
  });
  if (g) {
    const attrs = `data-plan3-id="${escapeAttr(g.id)}"`;
    rows.push(`<div class="p3-row j3-trow">${check(false, g.item, `data-action="plan3-toggle" ${attrs}`)}
      <button class="p3-body" data-action="plan3-edit" ${attrs}><b>${escapeHtml(g.item)}</b><i>${escapeHtml([g.cat, g.note].filter(Boolean).join(" · "))}</i></button>
      ${plan3.filter((x) => !x.done).length > 1 ? `<button class="jv-chip-sm" data-action="jv-goal-another">Another</button>` : ""}</div>`);
  }
  return `<section class="card j3-today" id="j3-today" aria-label="Today">
    <div class="j3-label on">Today${streak >= 2 ? `<span class="j3-streak">${streak}-day streak</span>` : ""}</div>
    <h2 class="j3-head">${escapeHtml(head)}</h2>${rows.join("")}</section>`;
}
// Last 4 weeks: a square a day for the skin routine and workouts.
// Lit = done, dim = missed, dashed = nothing planned, outlined = today, still to do.
function j3GridHtml() {
  const days = Array.from({ length: 28 }, (_, i) => addDaysIso(i - 27)),
    today = days[27];
  const hasRoutine = skinRoutine.am.length + skinRoutine.pm.length > 0;
  const routine = days.map((iso) => {
    const c = routineChecks[iso];
    return c && c.amDone && c.pmDone ? "on" : iso === today ? "wait" : "off";
  });
  const workouts = days.map((iso) => {
    const ws = workoutsOn(iso);
    return !ws.length ? "none" : ws.every((w) => workoutDone(iso, w.id)) ? "on" : iso === today ? "wait" : "off";
  });
  let best = 0;
  const row = (label, tone, cells) => {
    const done = cells.filter((c) => c === "on").length,
      planned = done + cells.filter((c) => c === "off").length;
    if (!planned && !cells.includes("wait")) return "";
    let run = 0;
    cells.forEach((c) => {
      if (c === "on") best = Math.max(best, ++run);
      else if (c === "off") run = 0;
    });
    return `<div class="j3-grid-row ${tone}"><span class="jv-mini">${label}</span><span class="j3-cells" role="img" aria-label="${label}: ${done} of ${planned} days done">${cells
      .map((c) => `<i class="${c}"></i>`)
      .join("")}</span><span class="jv-streak-n">${done}/${planned}</span></div>`;
  };
  const rows = (hasRoutine ? row("Routine", "pm", routine) : "") + row("Workout", "warn", workouts);
  if (!rows) return "";
  return `<section class="card j3-grid" id="j3-grid" aria-label="Last 4 weeks">
    <div class="j3-label">Last 4 weeks${best >= 2 ? `<span>best streak ${best} days</span>` : ""}</div>
    ${rows}<div class="j3-legend">Lit = done · dim = missed · dashed = rest day</div></section>`;
}
const P3_TONES = ["pm", "warn", "olive", "am"]; // ring colors, by section position
function plan3SectionsHtml() {
  let html = plan3.length ? `<div class="jv-label j3-areas"><span>Goal areas</span><i></i></div>` : "";
  plan3Cats().forEach((cat, ci) => {
    // the add button names its section by position, so no name lands in code
    const id = "p3-" + plan3Slug(cat),
      list = plan3.filter((x) => x.cat === cat);
    if (!seenPlan3Cards.has(id)) {
      seenPlan3Cards.add(id);
      openPinned.add(id);
    }
    const doneN = list.filter((x) => x.done).length,
      next = list.find((x) => !x.done);
    const rows = list
      .map(
        (x) => `<div class="p3-row ${x.done ? "done" : ""}" data-sort-id="${x.id}">
        <button class="todo-check" role="checkbox" aria-checked="${!!x.done}"         aria-label="${x.done ? "Not done" : "Done"}: ${escapeAttr(x.item)}" data-action="plan3-toggle" data-plan3-id="${escapeAttr(x.id)}"><span class="box">${BOX_CHECK_SVG}</span></button>
                <button class="p3-body" data-action="plan3-edit" data-plan3-id="${escapeAttr(x.id)}"><b>${escapeHtml(x.item)}</b>${x.note ? `<i>${escapeHtml(x.note)}</i>` : ""}</button>
      </div>`,
      )
      .join("");
    html += collapsibleCard({
      id,
      title: `<span class="p3-title"><span role="img" class="p3-ring ${P3_TONES[ci % P3_TONES.length]}" style="--p:${dashPct(doneN, list.length)}" aria-label="${doneN} of ${list.length} done"><span aria-hidden="true">${doneN}/${list.length}</span></span><span class="p3-name">${escapeHtml(cat)}<i>${next ? `Next: ${escapeHtml(next.item)}` : "All done"}</i></span></span>`,
      body: `<div class="p3-list">${rows}</div>      <button class="add-row" data-action="plan3-add" data-cat-index="${ci}">+ Add to ${escapeHtml(cat)}</button>`,
    });
  });
  return html + `<button class="add-row p3-new" data-action="plan3-new-section">+ New goal area</button>`;
}
