// todo.js - To-do actions, sub-items, types/kinds, edit sheet, archive and the To-Do tab renderer.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

function toggleTodo(id) {
  const t = todoList.find((x) => x.id === id);
  if (!t) return;
  // Un-ticking a repeat's done copy puts the series back on that date instead
  // of leaving a stray one-off to-do next to it
  const series = t.done && t.seriesId && todoList.find((x) => x.id === t.seriesId && !x.done && x.repeat);
  if (series && series.due > t.due) {
    series.due = t.due;
    todoList = todoList.filter((x) => x.id !== t.id);
    saveContent("todo-content", todoList);
    renderHome();
    return;
  }
  t.done = !t.done;
  t.completedAt = t.done ? Date.now() : null;
  saveContent("todo-content", todoList);
  renderHome();
}
// Completing from the open list hides the row in the collapsed Completed card,
// so offer a short undo window. Array position never changes on toggle, so
// undoing puts the item back exactly where it was.
function completeTodo(id) {
  try {
    navigator.vibrate && navigator.vibrate(12);
  } catch (e) {} // Android only; iOS ignores it
  const r = todoList.find((x) => x.id === id);
  if (r && r.repeat && !r.done) {
    completeRepeating(r);
    return;
  }
  toggleTodo(id);
  showUndoToast("To-do completed", () => {
    const t = todoList.find((x) => x.id === id);
    if (!t || !t.done) return;
    t.done = false;
    t.completedAt = null;
    saveContent("todo-content", todoList);
    renderHome();
  });
}
function toggleTodoStar(id) {
  const t = todoList.find((x) => x.id === id);
  t.starred = !t.starred;
  if (t.starred) {
    // float to the top of the list once; drag order takes over from there
    todoList.splice(todoList.indexOf(t), 1);
    todoList.unshift(t);
  }
  saveContent("todo-content", todoList);
  renderHome();
}
function toggleTodoExpand(id) {
  if (expandedTodos.has(id)) {
    expandedTodos.delete(id);
    subAddOpen.delete(id); // reset to view-only next time it opens
  } else {
    expandedTodos.add(id);
  }
  renderHome();
}
function openSubitemAdd(id) {
  subAddOpen.add(id);
  renderHome();
  const input = document.getElementById(`subitem-input-${id}`);
  if (input) input.focus();
}
function addSubitem(todoId) {
  const input = document.getElementById(`subitem-input-${todoId}`);
  const text = input.value.trim();
  if (!text) return;
  const t = todoList.find((x) => x.id === todoId);
  if (!t.subitems) t.subitems = [];
  t.subitems.push({ id: genId("sub"), text, done: false });
  saveContent("todo-content", todoList);
  renderHome();
  const fresh = document.getElementById(`subitem-input-${todoId}`);
  if (fresh) fresh.focus();
}
function toggleSubitem(todoId, subId) {
  const t = todoList.find((x) => x.id === todoId);
  const s = t.subitems.find((x) => x.id === subId);
  s.done = !s.done;
  saveContent("todo-content", todoList);
  renderHome();
}
function deleteSubitem(todoId, subId) {
  const t = todoList.find((x) => x.id === todoId);
  t.subitems = t.subitems.filter((x) => x.id !== subId);
  saveContent("todo-content", todoList);
  renderHome();
}
function duplicateTodo(id) {
  const t = todoList.find((x) => x.id === id);
  const copy = {
    id: genId("todo"),
    text: t.text,
    done: false,
    due: t.due || null,
    starred: false,
    completedAt: null,
    subitems: (t.subitems || []).map((s) => ({ id: genId("sub"), text: s.text, done: false })),
  };
  todoList.push(copy);
  saveContent("todo-content", todoList);
  renderHome();
}
function deleteTodoPermanently(id) {
  if (!confirm("Delete this to-do? This can't be undone.")) return;
  todoList = todoList.filter((x) => x.id !== id); // (by id: never splice(-1) if it's already gone)
  saveContent("todo-content", todoList);
  renderHome();
}
// ---------- to-do types ----------
// Each to-do gets a small colored icon for its kind, guessed from its words
// ("Therapy @ 10am" → health, "Gym" → fitness). Edit to-do can pick another
// type, or None; `kind` is stored only when picked by hand.
const KIND_SVG = (p) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const TODO_KINDS = {
  health: {
    label: "Health",
    hue: 350,
    icon: KIND_SVG(
      '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/><path d="M3.5 12h4l1.5-3 2 6 1.5-3h4"/>',
    ),
    words:
      /\b(therap(y|ist)|doctor|dr\.?|dentist|derm(atologist)?|ob-?gyn|physical|pharmacy|meds|medicine|prescription|refill|contacts|eye exam|checkup|check-up|labs?|blood work|vaccine|shot|clinic|hospital|counsel(ing|or))\b/i,
  },
  appointment: {
    label: "Appointment",
    hue: 275,
    icon: KIND_SVG(
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15.5 2 2 4-4"/>',
    ),
    words:
      /\b(appt|appointment|eyebrows?|brows?|lashes|nails?|mani(cure)?|pedi(cure)?|hair ?cut|haircut|salon|barber|spa|massage|wax(ing)?|facial|braids?|retwist|silk press)\b/i,
  },
  fitness: {
    label: "Fitness",
    hue: 25,
    icon: KIND_SVG('<path d="M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11"/>'),
    words:
      /\b(gym|work ?out|workout|yoga|pilates|run|running|jog|hike|swim|lift(ing)?|spin|cycling|bootcamp|stretch|peloton|steps)\b/i,
  },
  birthday: {
    label: "Birthday",
    hue: 320,
    icon: KIND_SVG(
      '<path d="M4 21h16M5 21v-8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8"/><path d="M5 16c2 0 2-1.5 3.5-1.5S10 16 12 16s2-1.5 3.5-1.5S17 16 19 16M12 11V7"/><path d="M12 3.5c.8.8.8 1.7 0 2.5-.8-.8-.8-1.7 0-2.5Z"/>',
    ),
    words: /\b(birthday|bday|b-day|anniversary)\b|\b\w+'s (birthday|bday)\b/i,
  },
  social: {
    label: "Social",
    hue: 195,
    icon: KIND_SVG(
      '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    ),
    words:
      /\b(party|dinner|brunch|lunch with|drinks|happy hour|wedding|shower|concert|show|game night|date night|date|movie|hang ?out|bbq|cookout|visit|church|game)\b/i,
  },
  travel: {
    label: "Travel",
    hue: 210,
    icon: KIND_SVG(
      '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/>',
    ),
    words: /\b(flight|fly|trip|travel|airport|hotel|vacation|cruise|road ?trip|pack(ing)?|passport|airbnb|beach)\b/i,
  },
  car: {
    label: "Car",
    hue: 180,
    icon: KIND_SVG(
      '<path d="M5 17H3v-4l2-5.5A2 2 0 0 1 6.9 6h10.2a2 2 0 0 1 1.9 1.5L21 13v4h-2"/><path d="M3 13h18"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/><path d="M9.5 17h5"/>',
    ),
    words:
      /\b(cars?|oil change|tires?|registration|inspection|car wash|smog|mechanic|moto(rcycle)?|gas|dmv|emissions)\b/i,
  },
  pet: {
    label: "Pet",
    hue: 35,
    icon: KIND_SVG(
      '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
    ),
    words: /\b(dog|dogs|puppy|cat|cats|kitten|vet|groomer|grooming|walk the dog|litter|flea)\b/i,
  },
  work: {
    label: "Work",
    hue: 230,
    icon: KIND_SVG(
      '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    ),
    words:
      /\b(work|meeting|interview|deadline|shift|presentation|report|client|standup|1:1|one on one|timesheet|email)\b/i,
  },
  call: {
    label: "Call",
    hue: 160,
    icon: KIND_SVG(
      '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
    ),
    words: /\b(call|phone|facetime|zoom|text (back|mom|dad))\b/i,
  },
  chores: {
    label: "Chores",
    hue: 130,
    icon: KIND_SVG('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
    words:
      /\b(clean(ing)?|laundry|dishes|vacuum|mop|trash|garbage|recycling|mow|organi[sz]e|declutter|tidy|dust|wash (the )?(sheets|towels)|change sheets|meal prep|cook)\b/i,
  },
  errand: {
    label: "Errand",
    hue: 48,
    icon: KIND_SVG('<path d="M6 7h12l1 14H5L6 7Z"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>'),
    words:
      /\b(pick ?up|pickup|drop ?off|return|groceries|grocery|store|target|costco|walmart|mail|post office|ship|package|bank|deposit|buy|order|shopping)\b/i,
  },
};
// order matters: the more specific kinds win ("dinner for mom's birthday" → birthday)
const KIND_ORDER = [
  "birthday",
  "travel",
  "health",
  "appointment",
  "pet",
  "fitness",
  "car",
  "work",
  "call",
  "social",
  "errand",
  "chores",
];
function isKindName(text, k) {
  return new RegExp(`^${TODO_KINDS[k].label}s?$`, "i").test(String(text || "").trim());
}
function detectKind(text) {
  const s = String(text || "");
  const named = KIND_ORDER.find((k) => isKindName(s, k));
  if (named) return named;
  const k = KIND_ORDER.find((k) => TODO_KINDS[k].words.test(s));
  if (k) return k;
  return /@\s*\d{1,2}(:\d{2})?\s*(am|pm)?\b|\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(s) ? "appointment" : null; // a time of day reads as an appointment
}
function todoKind(t) {
  if (t.kind === "none") return null;
  return TODO_KINDS[t.kind] ? t.kind : detectKind(t.text);
}
function kindIconHtml(t) {
  const k = todoKind(t);
  return k
    ? `<span class="kind-ic" style="--k:${TODO_KINDS[k].hue}" title="${TODO_KINDS[k].label}" aria-label="${TODO_KINDS[k].label}">${TODO_KINDS[k].icon}</span>`
    : "";
}
// Edit to-do: one compact sheet. When (Anytime / Today / Tomorrow / a date, and
// an optional last day) and Repeat are chip rows; a custom repeat adds an
// "every N weeks|months" stepper; sub-items fold away until asked for.
let tde = null; // the sheet's working copy: {due, end, repeat, every}
const TDE_REPEATS = [
  [null, "Never"],
  ["daily", "Daily"],
  ["weekdays", "Weekdays"],
  ["weekly", "Weekly"],
  ["biweekly", "2 weeks"],
  ["monthly", "Monthly"],
  ["yearly", "Yearly"],
];
function editTodo(id) {
  const t = todoList.find((x) => x.id === id);
  if (!t) return;
  tde = {
    due: t.due || null,
    end: t.days > 1 ? todoEnd(t) : null,
    repeat: t.repeat === "months" && todoEvery(t) === 12 ? "yearly" : REPEATS[t.repeat] ? t.repeat : null,
    every: CUSTOM_REPEATS[t.repeat] ? todoEvery(t) : 2,
    kind: TODO_KINDS[t.kind] || t.kind === "none" ? t.kind : null,
  }; // null = pick automatically
  openModal(
    "Edit to-do",
    [
      { key: "text", label: "To-do", type: "textarea", enterSaves: true, maxlength: TODO_MAX_LEN },
      { type: "html", label: `<div class="tde" id="tde">${tdeHtml()}</div>` },
      {
        type: "html",
        label: `<button type="button" class="tde-subs-toggle" data-action="tde-open-subs">${SMALL_PLUS_ICON} Add sub-items</button>`,
      },
      { key: "subs", label: "Sub-items — one per line", type: "textarea" },
    ],
    { text: t.text },
    (v) => {
      const text = (v.text || "").replace(/\s*\n\s*/g, " ").trim();
      if (!text) return;
      t.text = text;
      t.due = tde.due;
      if (tde.repeat) {
        t.repeat = tde.repeat;
        if (!t.due) t.due = addDaysIso(0);
        t.repeatDay = dayOf(t.due);
      } // a repeat needs a start date
      else delete t.repeat;
      if (CUSTOM_REPEATS[tde.repeat]) t.every = Math.max(1, Math.min(99, tde.every));
      else delete t.every;
      if (tde.kind) t.kind = tde.kind;
      else delete t.kind;
      // a last day after the due date makes it multi-day (up to 60 days)
      const days = t.due && tde.end ? Math.round((noonOf(tde.end) - noonOf(t.due)) / 864e5) + 1 : 0;
      if (days > 1) t.days = Math.min(60, days);
      else delete t.days;
      const newSubs = (v.subs || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (newSubs.length) {
        if (!t.subitems) t.subitems = [];
        newSubs.forEach((s) => t.subitems.push({ id: genId("sub"), text: s, done: false }));
        expandedTodos.add(t.id);
      }
      saveContent("todo-content", todoList);
      renderHome();
    },
    () => {
      todoList = todoList.filter((x) => x.id !== id);
      saveContent("todo-content", todoList);
      renderHome();
    },
  );
  document.getElementById("modal-subs").closest(".modal-field").hidden = true;
  document.getElementById("modal-text").addEventListener("input", () => {
    if (!tde.kind) tdeSet({});
  });
  tdeSet({}); // now the text box exists, the Auto chip can show its guess
}
function tdeSet(patch) {
  Object.assign(tde, patch);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tde.due || "")) tde.due = null;
  if (!tde.due) {
    tde.end = null;
    if ("due" in patch) tde.repeat = null;
  } // Anytime: no span, no repeat
  if (tde.repeat && !tde.due) tde.due = addDaysIso(0); // picking a repeat on an Anytime to-do starts it today
  if (tde.end && (!/^\d{4}-\d{2}-\d{2}$/.test(tde.end) || tde.end <= tde.due)) tde.end = null;
  if (tde.end && Math.round((noonOf(tde.end) - noonOf(tde.due)) / 864e5) > 59)
    tde.end = isoDate(new Date(noonOf(tde.due).getTime() + 59 * 864e5));
  tde.every = Math.max(1, Math.min(99, parseInt(tde.every, 10) || 1));
  const el = document.getElementById("tde");
  if (el) el.innerHTML = tdeHtml();
}
function tdeDateChip(id, value, label, field) {
  // a chip with a native date input laid over it, so a tap opens the picker (delegated: tde-date change, tde-show-picker click)
  return `<label class="filter-chip tde-date ${value ? "on" : ""}">${CALENDAR_ICON}<span>${label}</span>
      <input type="date" id="${id}" value="${value || ""}" data-change-action="tde-date" data-field="${field}" data-action="tde-show-picker" aria-label="${label}"></label>`;
}
function tdeHtml() {
  const today = addDaysIso(0),
    tomorrow = addDaysIso(1),
    d = tde.due;
  const short = (iso) => noonOf(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const chip = (label, on, attrs) =>
    `<button type="button" class="filter-chip ${on ? "on" : ""}" aria-pressed="${on}" ${attrs}>${label}</button>`;
  const custom = !!CUSTOM_REPEATS[tde.repeat];
  let html = `<div class="tde-sec">When</div><div class="tde-chips">
      ${chip("Anytime", !d, dataAttrs("tde-due", { date: "" }))}
      ${chip("Today", d === today, dataAttrs("tde-due", { date: today }))}
      ${chip("Tomorrow", d === tomorrow, dataAttrs("tde-due", { date: tomorrow }))}
      ${tdeDateChip("modal-due", d && d !== today && d !== tomorrow ? d : "", d && d !== today && d !== tomorrow ? short(d) : "Pick date", "due")}
    </div>`;
  if (d)
    html += `<div class="tde-chips tde-span">${
      tde.end
        ? `<span class="tde-through">Through</span>${tdeDateChip("modal-end", tde.end, short(tde.end), "end")}<button type="button" class="tde-x" aria-label="Just one day" ${dataAttrs("tde-end", { date: "" })}>✕</button>`
        : chip(
            `${SMALL_PLUS_ICON} Multi-day`,
            false,
            dataAttrs("tde-end", { date: isoDate(new Date(noonOf(d).getTime() + 864e5)) }),
          )
    }</div>`;
  html += `<div class="tde-sec">Repeat</div><div class="tde-chips">
      ${TDE_REPEATS.map(([k, l]) => chip(l, tde.repeat === k, dataAttrs("tde-repeat", { repeat: k || "" }))).join("")}
      ${chip("Custom", custom, dataAttrs("tde-repeat", { repeat: custom ? tde.repeat : "weeks" }))}
    </div>`;
  if (custom)
    html += `<div class="tde-every"><span>Every</span>
      <button type="button" class="tde-step" aria-label="Fewer" ${dataAttrs("tde-every", { delta: -1 })}>−</button>
      <b id="modal-every">${tde.every}</b>
      <button type="button" class="tde-step" aria-label="More" ${dataAttrs("tde-every", { delta: 1 })}>+</button>
      <span class="tde-seg">${["weeks", "months"].map((u) => `<button type="button" class="${tde.repeat === u ? "on" : ""}" aria-pressed="${tde.repeat === u}" ${dataAttrs("tde-repeat", { repeat: u })}>${tde.every === 1 ? u.slice(0, -1) : u}</button>`).join("")}</span>
    </div>`;
  // one line that reads back the choice
  const sum = [];
  if (!d) sum.push("No date · it sits under Anytime");
  else {
    sum.push(
      tde.end
        ? `${short(d)} – ${short(tde.end)} (${Math.round((noonOf(tde.end) - noonOf(d)) / 864e5) + 1} days)`
        : short(d),
    );
    if (tde.repeat) sum.push(repeatLabel({ repeat: tde.repeat, every: tde.every, due: d }));
  }
  // Type: Automatic (shows what it guessed from the text), a type, or None
  const textEl = document.getElementById("modal-text"),
    guess = detectKind(textEl ? textEl.value : "");
  const kchip = (k, label, on, icon = "", hue = null) =>
    `<button type="button" class="filter-chip kind-chip ${on ? "on" : ""}" aria-pressed="${on}" ${hue != null ? `style="--k:${hue}"` : ""} ${dataAttrs("tde-kind", { kind: k || "" })}>${icon}${label}</button>`;
  html += `<div class="tde-sec">Type</div><div class="tde-chips tde-kinds">
      ${kchip(null, `Auto${guess ? ` · ${TODO_KINDS[guess].label}` : ""}`, !tde.kind, guess ? TODO_KINDS[guess].icon : "", guess ? TODO_KINDS[guess].hue : null)}
      ${KIND_ORDER.map((k) => kchip(k, TODO_KINDS[k].label, tde.kind === k, TODO_KINDS[k].icon, TODO_KINDS[k].hue)).join("")}
      ${kchip("none", "None", tde.kind === "none")}
    </div>`;
  return html + `<div class="tde-sum">${escapeHtml(sum.join(" · "))}</div>`;
}
function clearCompletedTodos() {
  if (!confirm("Clear all completed to-dos? This can't be undone.")) return;
  todoList = todoList.filter((t) => !t.done);
  saveContent("todo-content", todoList);
  renderHome();
}

// Completed to-dos auto-move to a hidden archive (todo-archive-content, synced,
// capped) once they're 7+ days old, keeping the Completed card short-term only.
// Runs on load, after a sync pull, and on return to foreground; saves silently
// (no "Saved" toast) since the user didn't do anything. Returns true if it
// changed anything so callers know to re-render.
const TODO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TODO_ARCHIVE_MAX = 200;
function archiveOldTodos() {
  let changed = false;
  // done items missing a stamp (older data): stamp now so their 7 days start today
  todoList.forEach((t) => {
    if (t.done && !t.completedAt) {
      t.completedAt = Date.now();
      changed = true;
    }
  });
  const cutoff = Date.now() - TODO_RETENTION_MS;
  const old = todoList.filter((t) => t.done && t.completedAt < cutoff);
  if (old.length) {
    const archive = loadContent("todo-archive-content", []);
    archive.push(
      ...old.map((t) => ({
        text: t.text,
        completedAt: t.completedAt,
        due: t.due || null,
        subitems: (t.subitems || []).map((s) => ({ text: s.text, done: !!s.done })),
      })),
    );
    archive.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    if (archive.length > TODO_ARCHIVE_MAX) archive.length = TODO_ARCHIVE_MAX;
    todoList = todoList.filter((t) => !old.includes(t));
    writeQuietly("todo-archive-content", archive);
    changed = true;
  }
  if (changed) writeQuietly("todo-content", todoList);
  return changed;
}

function renderTodoPanel() {
  const el = document.getElementById("panel-todo");
  let html = "";

  const totalOpen = todoList.filter((t) => !t.done).length;
  const completedItems = todoList.filter((t) => t.done).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const renderSubitems = (t) => {
    const subs = t.subitems || [];
    const rows = subs
      .map(
        (s) => `<div class="subitem-row" data-sub-id="${s.id}">
        <button class="subitem-check" role="checkbox" aria-checked="${!!s.done}" aria-label="Complete: ${escapeAttr(s.text)}" data-action="subitem-toggle" data-todo-id="${t.id}" data-sub-id="${s.id}"><span class="subitem-box ${s.done ? "checked" : ""}">${BOX_CHECK_SVG}</span></button>
        <div class="subitem-text ${s.done ? "checked" : ""}">${escapeHtml(s.text)}</div>
        <button class="subitem-del" data-action="subitem-delete" data-todo-id="${t.id}" data-sub-id="${s.id}" aria-label="Delete sub-item">${X_ICON}</button>
      </div>`,
      )
      .join("");
    const addUi = subAddOpen.has(t.id)
      ? `<div class="subitem-add">
          <input type="text" id="subitem-input-${t.id}" placeholder="Add sub-item" autocomplete="off" data-keydown-action="subitem-add-key" data-todo-id="${t.id}">
          <button data-action="subitem-add" data-todo-id="${t.id}" aria-label="Add sub-item">${SMALL_PLUS_ICON}</button>
        </div>`
      : `<button class="subitem-add-toggle" data-action="subitem-open-add" data-todo-id="${t.id}">${SMALL_PLUS_ICON} Add sub-item</button>`;
    return `<div class="subitem-list" data-action="subitem-list">
        ${rows}
        ${addUi}
      </div>`;
  };
  const todoRow = (t) => {
    const subs = t.subitems || [];
    const subDone = subs.filter((s) => s.done).length;
    const expanded = expandedTodos.has(t.id);
    const group = todoGroup(t);
    const meta = [];
    if (group === "overdue") meta.push(`<span class="overdue">${escapeHtml(dueLabel(t.due))}</span>`);
    else if (group === "later") meta.push(escapeHtml(dueLabel(t.due)));
    if (t.days > 1) meta.push(escapeHtml(spanRange(t)));
    if (subs.length) meta.push(`${subDone}/${subs.length} sub-items`);
    if (t.repeat) meta.push(`<span class="repeat-meta">${REPEAT_ICON}${escapeHtml(repeatLabel(t))}</span>`);
    return `<div class="todo-wrap" data-todo-id="${t.id}">
        <div class="item ${t.done ? "checked" : ""}">
          <button class="todo-check" role="checkbox" aria-checked="${t.done}" aria-label="Complete: ${escapeAttr(t.text)}" data-action="home-todo-complete" data-todo-id="${t.id}"><span class="box">${BOX_CHECK_SVG}</span></button>
          <div class="body" data-action="home-todo-edit" data-todo-id="${t.id}"><div class="title">${kindIconHtml(t)}${escapeHtml(t.text)}</div>${meta.length ? `<div class="todo-meta">${meta.join(" · ")}</div>` : ""}</div>
          <button class="todo-icon-btn ${t.starred ? "starred" : ""}" style="order:3;" data-action="todo-star" data-todo-id="${t.id}" aria-label="${t.starred ? "Unstar" : "Star"} to-do">${t.starred ? STAR_FILLED_ICON : STAR_ICON}</button>
          ${subs.length ? `<button class="todo-icon-btn ${expanded ? "active" : ""}" style="order:4;" data-action="todo-expand" data-todo-id="${t.id}" aria-label="${expanded ? "Hide" : "Show"} sub-items" aria-expanded="${expanded}">${SUBLIST_ICON}</button>` : ""}
        </div>
        ${expanded && subs.length ? renderSubitems(t) : ""}
      </div>`;
  };
  const overdueCount = todoList.filter((t) => !t.done && todoGroup(t) === "overdue").length;
  const countLabel =
    todoList.length === 0
      ? "Empty"
      : totalOpen
        ? `${totalOpen} open${overdueCount ? ` · <span class="overdue">${overdueCount} overdue</span>` : ""}`
        : "All done";
  // Wash days and planned workouts in the next week get their own rows in
  // their date group (worked out from the schedule, not stored as to-dos)
  const washGroups = new Map(),
    workoutGroups = new Map();
  for (let n = 0; n < 7; n++) {
    const iso = addDaysIso(n),
      key = n === 0 ? "today" : "d" + n;
    if (isWashDay(noonOf(iso))) washGroups.set(key, iso);
    const ws = workoutsOn(iso),
      weigh = weighInDue(iso) ? weighRowHtml(iso) : "";
    if (ws.length || weigh) workoutGroups.set(key, weigh + ws.map((w) => workoutRowHtml(w, iso)).join(""));
  }
  html += `<div class="card" id="todo-card">
    <div class="todo-card-head"><span class="insight">${countLabel}</span></div>`;
  if (todoList.length === 0 && !washGroups.size && !workoutGroups.size) {
    html += `<div class="empty">Nothing on your list — tap + to add one.</div>`;
  } else if (totalOpen === 0 && !washGroups.size && !workoutGroups.size) {
    html += `<div class="empty">All done for now.</div>`;
  } else {
    // Within a group, array order IS display order (drag-to-reorder writes it
    // back); Overdue and Later sort by date instead.
    html += `<div id="todo-list">`;
    let firstGroup = true;
    todoGroups().forEach((g) => {
      let items = todoList.filter((t) => !t.done && todoGroup(t) === g.key);
      if (g.key === "overdue" || g.key === "later")
        items = items.slice().sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
      const washIso = washGroups.get(g.key),
        workoutRows = workoutGroups.get(g.key) || "";
      if (!items.length && !washIso && !workoutRows) return;
      html += `<div class="cat-title${g.key === "overdue" ? " overdue" : ""}" data-due="${g.due}"${firstGroup ? ' style="margin-top:0;"' : ""}>${g.label}</div>`;
      firstGroup = false;
      if (washIso) html += washRowHtml(washIso);
      html += workoutRows;
      items.forEach((t) => {
        html += todoRow(t);
      });
    });
    html += `</div>`;
  }

  // Completed lives inside the to-do card behind a one-line toggle, so it
  // doesn't take a whole card of Home's height while collapsed.
  if (completedItems.length) {
    const completedOpen = openPinned.has("todo-completed");
    const completedRows = completedItems
      .map((t) => {
        const dateLabel = t.completedAt
          ? new Date(t.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : "";
        return `<div class="item checked">
          <button class="todo-check" role="checkbox" aria-checked="true" aria-label="Mark not done: ${escapeAttr(t.text)}" data-action="home-todo-toggle" data-todo-id="${t.id}"><span class="box">${BOX_CHECK_SVG}</span></button>
          <div class="body"><div class="title">${kindIconHtml(t)}${escapeHtml(t.text)}</div>${dateLabel ? `<div class="sub">Completed ${dateLabel}</div>` : ""}</div>
          <button class="completed-actions" style="order:3;" data-action="todo-duplicate" data-todo-id="${t.id}" aria-label="Duplicate to-do">${DUPLICATE_ICON}</button>
          <button class="completed-actions" style="order:4;" data-action="todo-delete" data-todo-id="${t.id}" aria-label="Delete to-do">${TRASH_ICON}</button>
        </div>`;
      })
      .join("");
    const archivedCount = loadContent("todo-archive-content", []).length;
    html += `<button class="completed-toggle ${completedOpen ? "open" : ""}" data-action="todo-completed-toggle" aria-expanded="${completedOpen}">
        ${CHECK_ICON}<span>${completedItems.length} completed</span>
        ${CHEVRON_DOWN}
      </button>`;
    if (completedOpen) {
      html += `<div id="todo-completed">
          ${completedRows}
          <button class="reset-btn" data-action="todo-completed-clear">Clear completed</button>
          <p class="footnote">Completed to-dos are archived automatically after 7 days${archivedCount ? ` · ${archivedCount} archived so far` : ""}.</p>
        </div>`;
    }
  }
  html += `</div>`;

  // Recurring: every repeating to-do in one place, soonest first; tap to edit
  const recurring = todoList.filter((t) => t.repeat && !t.done).sort(byDue);
  const recRows = recurring
    .map(
      (t) => `<div class="item recurring-row" data-action="home-todo-edit" data-todo-id="${t.id}">
      <span class="row-icon repeat-icon" aria-hidden="true">${REPEAT_ICON}</span>
      <div class="body"><div class="title">${kindIconHtml(t)}${escapeHtml(t.text)}</div><div class="todo-meta">${escapeHtml(repeatLabel(t))} · next ${escapeHtml(t.due ? dueLabel(t.due).replace(/^(Today|Tomorrow|Yesterday)$/, (w) => w.toLowerCase()) : "today")}</div></div>
    </div>`,
    )
    .join("");
  html += collapsibleCard({
    id: "todo-recurring",
    title: "Recurring",
    insight: recurring.length ? `${recurring.length}` : "None",
    body:
      recRows ||
      `<div class="empty">Set <b>Repeat</b> on a to-do (tap it to edit, or use the Repeat chip when adding) and it shows up here.</div>`,
  });
  html += workoutsCardHtml();
  el.innerHTML = html;
}
