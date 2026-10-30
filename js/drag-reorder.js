// drag-reorder.js - Press-to-drag and drag-to-reorder interactions.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// Drag-to-reorder for sub-items: vertical drag reorders within the sub-list;
// dragging LEFT past the threshold promotes the sub-item back to a full to-do
// (the mirror of dragging a to-do right to nest it).
(function () {
  const mainEl = document.querySelector("main");
  const panel = document.getElementById("panel-todo");
  let sd = null;

  pressToDrag(
    panel,
    ".subitem-row",
    (row, x, y, pointerId, y0 = y) => {
      const list = row.closest(".subitem-list");
      const wrap = row.closest(".todo-wrap");
      if (!list || !wrap || sd) return;
      try {
        row.setPointerCapture(pointerId);
      } catch (err) {}
      const r = row.getBoundingClientRect();
      sd = {
        row,
        list,
        wrap,
        todoId: wrap.dataset.todoId,
        subId: row.dataset.subId,
        clientY: y,
        clientX: x,
        startX: x,
        grabOffset: y0 - r.top,
        promoting: false,
        moveTarget: null,
        raf: 0,
        clip: [wrap.closest(".coll-body"), wrap.closest(".pinned")].filter(Boolean),
      };
      sd.clip.forEach((el) => (el.style.overflow = "visible"));
      row.classList.add("drag-active-sub");
      document.body.classList.add("todo-dragging");
      tick();
    },
    "button, a, input, textarea",
  );

  panel.addEventListener("pointermove", (e) => {
    if (sd) {
      sd.clientY = e.clientY;
      sd.clientX = e.clientX;
    }
  });
  panel.addEventListener("pointerup", () => end(true));
  panel.addEventListener("pointercancel", () => end(false));

  function tick() {
    if (!sd) return;
    const mr = mainEl.getBoundingClientRect();
    if (sd.clientY < mr.top + 70) mainEl.scrollTop -= 9;
    else if (sd.clientY > mr.bottom - 110) mainEl.scrollTop += 9;
    const promoting = sd.startX - sd.clientX > 48;
    if (promoting !== sd.promoting) {
      sd.promoting = promoting;
      sd.row.classList.toggle("promoting", promoting);
    }
    // Hovering over a different to-do marks it as the re-parent target;
    // dropping there moves the sub-item into that to-do's sub-list.
    const target = promoting ? null : hoverWrap();
    if (target !== sd.moveTarget) {
      if (sd.moveTarget) sd.moveTarget.classList.remove("indent-target");
      sd.moveTarget = target;
      if (target) target.classList.add("indent-target");
    }
    if (!promoting && !sd.moveTarget) reorder();
    position();
    sd.raf = requestAnimationFrame(tick);
  }

  function hoverWrap() {
    const list = document.getElementById("todo-list");
    if (!list) return null;
    for (const w of list.querySelectorAll(".todo-wrap")) {
      if (w === sd.wrap) continue;
      const r = w.getBoundingClientRect();
      if (sd.clientY >= r.top && sd.clientY <= r.bottom) return w;
    }
    return null;
  }

  function reorder() {
    const siblings = [...sd.list.querySelectorAll(".subitem-row:not(.drag-active-sub)")];
    const next = siblings.find((s) => {
      const r = s.getBoundingClientRect();
      return sd.clientY <= r.top + r.height / 2;
    });
    if (next) {
      if (next.previousElementSibling !== sd.row) sd.list.insertBefore(sd.row, next);
    } else {
      // keep the row above the add pill/input, which stays last
      const addUi = sd.list.querySelector(".subitem-add-toggle, .subitem-add");
      if (addUi && sd.row.nextElementSibling !== addUi && addUi.previousElementSibling !== sd.row) {
        sd.list.insertBefore(sd.row, addUi);
      }
    }
  }

  function position() {
    sd.row.style.transform = "";
    const top = sd.row.getBoundingClientRect().top;
    const dx = sd.promoting ? -28 : 0;
    sd.row.style.transform = `translate(${dx}px, ${sd.clientY - sd.grabOffset - top}px)`;
  }

  function end(commit) {
    if (!sd) return;
    dragJustEnded = Date.now();
    cancelAnimationFrame(sd.raf);
    sd.row.style.transform = "";
    sd.row.classList.remove("drag-active-sub", "promoting");
    if (sd.moveTarget) sd.moveTarget.classList.remove("indent-target");
    sd.clip.forEach((el) => (el.style.overflow = ""));
    document.body.classList.remove("todo-dragging");
    const ctx = sd;
    sd = null;
    if (!commit) {
      renderHome();
      return;
    }
    const t = todoList.find((x) => x.id === ctx.todoId);
    if (!t || !t.subitems) {
      renderHome();
      return;
    }
    if (ctx.promoting) {
      const idx = t.subitems.findIndex((s) => s.id === ctx.subId);
      if (idx < 0) {
        renderHome();
        return;
      }
      const [s] = t.subitems.splice(idx, 1);
      todoList.splice(todoList.indexOf(t) + 1, 0, {
        id: genId("todo"),
        text: s.text,
        done: !!s.done,
        due: t.due || null,
        starred: false,
        subitems: [],
        completedAt: s.done ? Date.now() : null,
      });
    } else if (ctx.moveTarget) {
      const dest = todoList.find((x) => x.id === ctx.moveTarget.dataset.todoId);
      const idx = t.subitems.findIndex((s) => s.id === ctx.subId);
      if (!dest || dest === t || idx < 0) {
        renderHome();
        return;
      }
      const [s] = t.subitems.splice(idx, 1);
      if (!dest.subitems) dest.subitems = [];
      dest.subitems.push(s);
      expandedTodos.add(dest.id); // show where it landed
    } else {
      const order = [...ctx.list.querySelectorAll(".subitem-row")].map((r) => r.dataset.subId);
      t.subitems.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }
    saveContent("todo-content", todoList);
    renderHome();
  }
})();

// Press-and-drag for list rows: with a mouse, dragging starts once the pointer
// moves 6px; on touch, after a short hold (so a quick swipe still scrolls and a
// tap still taps). Buttons, links and inputs inside a row keep their own taps.
let dragJustEnded = 0; // the click that ends a drag mustn't open the editor
const pressDrag = { pending: null };
document.addEventListener(
  "click",
  (e) => {
    if (Date.now() - dragJustEnded < 400) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);
document.addEventListener(
  "touchmove",
  (e) => {
    if (document.body.classList.contains("todo-dragging")) e.preventDefault();
  },
  { passive: false },
);
document.addEventListener("contextmenu", (e) => {
  if (document.body.classList.contains("todo-dragging") || pressDrag.pending) e.preventDefault();
});
function pressToDrag(panel, rowSel, onStart, ignore = "button, a, input, textarea, select, label, .subitem-list") {
  const owner = {}; // several lists can share a panel: each only acts on its own press
  panel.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || pressDrag.pending || document.body.classList.contains("todo-dragging")) return;
    const row = e.target.closest(rowSel);
    const skip = row && e.target.closest(ignore);
    if (!row || (skip && skip !== row && row.contains(skip))) return;
    const p = { owner, row, x: e.clientX, y: e.clientY, id: e.pointerId, touch: e.pointerType !== "mouse", timer: 0 };
    pressDrag.pending = p;
    if (p.touch)
      p.timer = setTimeout(() => {
        if (pressDrag.pending !== p) return;
        pressDrag.pending = null;
        try {
          navigator.vibrate && navigator.vibrate(12);
        } catch (err) {}
        onStart(p.row, p.x, p.y, p.id, p.y);
      }, 300);
  });
  panel.addEventListener("pointermove", (e) => {
    const p = pressDrag.pending;
    if (!p || p.owner !== owner || e.pointerId !== p.id) return;
    const d = Math.hypot(e.clientX - p.x, e.clientY - p.y);
    if (p.touch) {
      if (d > 10) {
        clearTimeout(p.timer);
        pressDrag.pending = null;
      }
    } // it's a scroll
    else if (d > 6) {
      pressDrag.pending = null;
      onStart(p.row, e.clientX, e.clientY, p.id, p.y);
    }
  });
  const cancel = () => {
    const p = pressDrag.pending;
    if (p) {
      clearTimeout(p.timer);
      pressDrag.pending = null;
    }
  };
  panel.addEventListener("pointerup", cancel);
  panel.addEventListener("pointercancel", cancel);
}

// Drag-to-reorder for to-do items: press and drag a row and
// move it up or down the open list. The row follows the finger, rows shuffle
// live, holding near the top/bottom edge autoscrolls, and dropping under a
// different day header reassigns the to-do's day.
(function () {
  const mainEl = document.querySelector("main");
  const panel = document.getElementById("panel-todo");
  let drag = null;

  pressToDrag(panel, "#todo-list .todo-wrap[data-todo-id]", (wrap, x, y, id, y0) => begin(wrap, x, y, id, wrap, y0));

  function begin(wrap, x, y, pointerId, captureEl, grabY = y) {
    const list = document.getElementById("todo-list");
    if (!wrap || !list || !list.contains(wrap) || drag) return;
    try {
      captureEl.setPointerCapture(pointerId);
    } catch (err) {}
    const rect = wrap.getBoundingClientRect();
    drag = {
      wrap,
      list,
      clientY: y,
      grabOffset: grabY - rect.top,
      raf: 0,
      startX: x,
      clientX: x,
      indentTarget: null,
      clip: [wrap.closest(".coll-body"), wrap.closest(".pinned")].filter(Boolean),
    };
    drag.clip.forEach((el) => (el.style.overflow = "visible")); // don't clip the lifted row
    wrap.classList.add("drag-active");
    document.body.classList.add("todo-dragging");
    tick();
  }

  panel.addEventListener("pointermove", (e) => {
    if (drag) {
      drag.clientY = e.clientY;
      drag.clientX = e.clientX;
    }
  });
  panel.addEventListener("pointerup", () => endDrag(true));
  panel.addEventListener("pointercancel", () => endDrag(false));

  function tick() {
    if (!drag) return;
    const mr = mainEl.getBoundingClientRect();
    if (drag.clientY < mr.top + 70) mainEl.scrollTop -= 9;
    else if (drag.clientY > mr.bottom - 110) mainEl.scrollTop += 9;
    // Dragging right past the threshold switches to indent mode: the row above
    // becomes the nesting target and vertical reordering pauses.
    const prev = prevTodoWrap(drag.wrap);
    const wantIndent = drag.clientX - drag.startX > 48 && prev;
    const target = wantIndent ? prev : null;
    if (target !== drag.indentTarget) {
      if (drag.indentTarget) drag.indentTarget.classList.remove("indent-target");
      drag.indentTarget = target;
      if (target) target.classList.add("indent-target");
      drag.wrap.classList.toggle("indenting", !!target);
    }
    if (!drag.indentTarget) reorder();
    position();
    drag.raf = requestAnimationFrame(tick);
  }

  function prevTodoWrap(w) {
    let el = w.previousElementSibling;
    while (el && !(el.classList.contains("todo-wrap") && el.dataset.todoId)) el = el.previousElementSibling;
    return el;
  }

  function reorder() {
    const siblings = [...drag.list.querySelectorAll(".todo-wrap:not(.drag-active)")];
    let next = siblings.find((s) => {
      const r = s.getBoundingClientRect();
      return drag.clientY <= r.top + r.height / 2;
    });
    // A Wash hair row is pinned under its day header: dropping above it lands
    // at the end of the previous group, not between the header and the row
    if (next && next.matches(".wash-row, .workout-row")) {
      let el = next;
      while (el.previousElementSibling && el.previousElementSibling.matches(".wash-row, .workout-row"))
        el = el.previousElementSibling;
      if (el.previousElementSibling && el.previousElementSibling.classList.contains("cat-title"))
        next = el.previousElementSibling;
    }
    if (next) {
      if (next.previousElementSibling !== drag.wrap) drag.list.insertBefore(drag.wrap, next);
    } else if (drag.list.lastElementChild !== drag.wrap) {
      drag.list.appendChild(drag.wrap);
    }
  }

  function position() {
    // clear the transform first so the rect reflects the row's slot position
    drag.wrap.style.transform = "";
    const top = drag.wrap.getBoundingClientRect().top;
    const dx = drag.indentTarget ? 28 : 0;
    drag.wrap.style.transform = `translate(${dx}px, ${drag.clientY - drag.grabOffset - top}px)`;
  }

  function endDrag(commit) {
    if (!drag) return;
    dragJustEnded = Date.now();
    cancelAnimationFrame(drag.raf);
    drag.wrap.style.transform = "";
    drag.wrap.classList.remove("drag-active", "indenting");
    if (drag.indentTarget) drag.indentTarget.classList.remove("indent-target");
    drag.clip.forEach((el) => (el.style.overflow = ""));
    document.body.classList.remove("todo-dragging");
    const { list, wrap, indentTarget } = drag;
    drag = null;
    if (commit && indentTarget) commitNest(wrap, indentTarget);
    else if (commit) commitTodoOrder(list);
    else renderHome(); // put rows back where the data says they belong
  }

  // Fold the dragged to-do into the row above as a sub-item; its own
  // sub-items (if any) come along, flattened after it.
  function commitNest(wrap, targetWrap) {
    const t = todoList.find((x) => x.id === wrap.dataset.todoId);
    const target = todoList.find((x) => x.id === targetWrap.dataset.todoId);
    if (!t || !target || t === target) {
      renderHome();
      return;
    }
    if (t.repeat) {
      showToast("Repeating to-dos can't become sub-items");
      renderHome();
      return;
    }
    if (!target.subitems) target.subitems = [];
    target.subitems.push({ id: genId("sub"), text: t.text, done: false });
    (t.subitems || []).forEach((s) => target.subitems.push({ id: genId("sub"), text: s.text, done: s.done }));
    todoList = todoList.filter((x) => x.id !== t.id);
    expandedTodos.add(target.id);
    saveContent("todo-content", todoList);
    renderHome();
  }

  function commitTodoOrder(list) {
    const ordered = [];
    [...list.querySelectorAll(".todo-wrap[data-todo-id]")].forEach((w) => {
      const t = todoList.find((x) => x.id === w.dataset.todoId);
      if (!t) return;
      let el = w.previousElementSibling;
      while (el && !el.classList.contains("cat-title")) el = el.previousElementSibling;
      // Overdue/Later headers say "keep": dropping there reorders without
      // inventing a date. Other headers carry their own date ("" = Anytime).
      // a repeating to-do keeps a date (dropping it in Anytime leaves its date alone)
      if (el && el.dataset.due !== "keep" && !(t.repeat && !el.dataset.due)) {
        const due = el.dataset.due || null;
        if (t.repeat && due !== t.due) t.repeatDay = dayOf(due);
        t.due = due;
      }
      ordered.push(t);
    });
    const ids = new Set(ordered.map((t) => t.id));
    todoList = [...ordered, ...todoList.filter((t) => !ids.has(t.id))];
    saveContent("todo-content", todoList);
    renderHome();
  }
})();

// Press-and-drag reordering for the other lists (routine steps, rules, plan
// lines, goals, spending categories): a row moves among its siblings in the
// same container, and onDrop gets the new order of their data-sort-ids.
function sortable(panel, itemSel, onDrop, ignore) {
  const mainEl = document.querySelector("main");
  let d = null;
  pressToDrag(
    panel,
    itemSel,
    (row, x, y, id, y0 = y) => {
      if (d || !row.dataset.sortId) return;
      try {
        row.setPointerCapture(id);
      } catch (err) {}
      const r = row.getBoundingClientRect();
      d = {
        row,
        box: row.parentElement,
        clientY: y,
        grabOffset: y0 - r.top,
        raf: 0,
        clip: [row.closest(".coll-body"), row.closest(".pinned"), row.closest(".card")].filter(Boolean),
      };
      d.clip.forEach((el) => (el.style.overflow = "visible"));
      row.classList.add("sort-active");
      document.body.classList.add("todo-dragging");
      tick();
    },
    ignore,
  );
  panel.addEventListener("pointermove", (e) => {
    if (d) d.clientY = e.clientY;
  });
  panel.addEventListener("pointerup", () => end(true));
  panel.addEventListener("pointercancel", () => end(false));
  function tick() {
    if (!d) return;
    const mr = mainEl.getBoundingClientRect();
    if (d.clientY < mr.top + 70) mainEl.scrollTop -= 9;
    else if (d.clientY > mr.bottom - 110) mainEl.scrollTop += 9;
    const sibs = [...d.box.children].filter((el) => el !== d.row && el.matches(itemSel) && el.dataset.sortId);
    const next = sibs.find((el) => {
      const b = el.getBoundingClientRect();
      return d.clientY <= b.top + b.height / 2;
    });
    if (next) {
      if (next.previousElementSibling !== d.row) d.box.insertBefore(d.row, next);
    } else if (sibs.length) {
      const last = sibs[sibs.length - 1];
      if (last.nextElementSibling !== d.row) last.after(d.row);
    }
    d.row.style.transform = "";
    const top = d.row.getBoundingClientRect().top;
    d.row.style.transform = `translateY(${d.clientY - d.grabOffset - top}px)`;
    d.raf = requestAnimationFrame(tick);
  }
  function end(commit) {
    if (!d) return;
    dragJustEnded = Date.now();
    cancelAnimationFrame(d.raf);
    const { row, box } = d;
    row.style.transform = "";
    row.classList.remove("sort-active");
    d.clip.forEach((el) => (el.style.overflow = ""));
    document.body.classList.remove("todo-dragging");
    d = null;
    const ids = [...box.children]
      .filter((el) => el.matches(itemSel) && el.dataset.sortId)
      .map((el) => el.dataset.sortId);
    if (commit) onDrop(box, ids);
    else {
      renderSkin();
      renderBudget();
      renderFitness();
    }
  }
}
const byIds = (list, ids, key = (x) => x.id) =>
  ids
    .map((id) => list.find((x) => String(key(x)) === id))
    .filter(Boolean)
    .concat(list.filter((x) => !ids.includes(String(key(x))))); // anything not shown keeps its place at the end
// Skin & Hair: routine steps within their band, and the key rules
sortable(
  document.getElementById("panel-skin"),
  ".band[data-band] > .step.editable",
  (box, ids) => {
    const key = box.dataset.band;
    if (!skinRoutine[key]) return;
    skinRoutine[key] = byIds(skinRoutine[key], ids);
    saveContent("skin-routine-content", skinRoutine);
    renderSkin();
    renderHomePanel();
  },
  "a, input, textarea",
);
sortable(
  document.getElementById("panel-skin"),
  "#rules-skin .rule.editable",
  (box, ids) => {
    skinRules = ids.map((i) => skinRules[Number(i)]).filter((r) => r != null);
    saveContent("skin-rules-content", skinRules);
    renderSkin();
  },
  "a, input, textarea",
);
// Budget: a paycheck's plan lines, goals, and spending categories
sortable(
  document.getElementById("panel-budget"),
  ".pp[data-key] > .plan-row",
  (box, ids) => {
    const plan = budget.plans[box.dataset.key];
    if (plan) plan.lines = byIds(plan.lines, ids);
    saveBudgetData();
  },
  ".todo-check, a, input",
);
sortable(
  document.getElementById("panel-budget"),
  "#goals-card .goal",
  (box, ids) => {
    budget.goals = byIds(budget.goals, ids);
    saveBudgetData();
  },
  ".goal-actions, .goal-entries, a, input",
);
sortable(
  document.getElementById("panel-todo"),
  "#fit-plan .fp-row",
  (box, ids) => {
    fitness.plan = byIds(fitness.plan, ids);
    saveFitness();
  },
  "a, input",
);
sortable(
  document.getElementById("panel-jazz3"),
  ".p3-list > .p3-row",
  (box, ids) => {
    const moved = ids.map((id) => plan3.find((x) => x.id === id)).filter(Boolean);
    const slots = moved.map((x) => plan3.indexOf(x)).sort((a, b) => a - b);
    slots.forEach((slot, k) => {
      plan3[slot] = moved[k];
    }); // same places in the list, new order
    savePlan3();
  },
  ".todo-check, a, input",
);
sortable(
  document.getElementById("panel-budget"),
  "#spending-card .budget-cat",
  (box, ids) => {
    budget.categories = byIds(budget.categories, ids);
    saveBudgetData();
  },
  ".expense-list, a, input",
);

// Home: press and drag a to-do within the day's lists. Dropping it in another
// section moves it there: the day's list sets that date, Anytime clears it,
// Overdue keeps the date it has.
(function () {
  const mainEl = document.querySelector("main");
  const panel = document.getElementById("panel-home");
  let drag = null;
  pressToDrag(panel, ".home-list .todo-wrap[data-todo-id]", (wrap, x, y, id, y0 = y) => {
    if (drag) return;
    try {
      wrap.setPointerCapture(id);
    } catch (err) {}
    const rect = wrap.getBoundingClientRect();
    drag = { wrap, clientY: y, grabOffset: y0 - rect.top, raf: 0, clip: [...panel.querySelectorAll(".home-list")] };
    drag.clip.forEach((el) => (el.style.overflow = "visible"));
    wrap.classList.add("drag-active");
    document.body.classList.add("todo-dragging");
    tick();
  });
  panel.addEventListener("pointermove", (e) => {
    if (drag) drag.clientY = e.clientY;
  });
  panel.addEventListener("pointerup", () => end(true));
  panel.addEventListener("pointercancel", () => end(false));

  function tick() {
    if (!drag) return;
    const mr = mainEl.getBoundingClientRect();
    if (drag.clientY < mr.top + 70) mainEl.scrollTop -= 9;
    else if (drag.clientY > mr.bottom - 110) mainEl.scrollTop += 9;
    // move the row before the first to-do (in any list) whose middle is below the finger
    const rows = [...panel.querySelectorAll(".home-list .todo-wrap[data-todo-id]:not(.drag-active)")];
    const next = rows.find((r) => {
      const b = r.getBoundingClientRect();
      return drag.clientY <= b.top + b.height / 2;
    });
    if (next) {
      if (next.previousElementSibling !== drag.wrap) next.parentNode.insertBefore(drag.wrap, next);
    } else {
      // below every row: the end of the last list the finger is past
      const lists = [...panel.querySelectorAll(".home-list")].filter(
        (l) => l.getBoundingClientRect().top < drag.clientY,
      );
      const last = lists[lists.length - 1];
      if (last) {
        const anchor = last.querySelector(".home-more");
        if (anchor) {
          if (anchor.previousElementSibling !== drag.wrap) last.insertBefore(drag.wrap, anchor);
        } else if (last.lastElementChild !== drag.wrap) last.appendChild(drag.wrap);
      }
    }
    drag.wrap.style.transform = "";
    const top = drag.wrap.getBoundingClientRect().top;
    drag.wrap.style.transform = `translateY(${drag.clientY - drag.grabOffset - top}px)`;
    drag.raf = requestAnimationFrame(tick);
  }

  function end(commit) {
    if (!drag) return;
    dragJustEnded = Date.now();
    cancelAnimationFrame(drag.raf);
    const { wrap } = drag;
    wrap.style.transform = "";
    wrap.classList.remove("drag-active");
    drag.clip.forEach((el) => (el.style.overflow = ""));
    document.body.classList.remove("todo-dragging");
    drag = null;
    if (!commit) {
      renderHome();
      return;
    }
    // new order of the to-dos shown, and the date each one's section stands for
    const shown = [...panel.querySelectorAll(".home-list .todo-wrap[data-todo-id]")]
      .map((w) => {
        const head = w.closest(".home-list").previousElementSibling;
        return {
          t: todoList.find((x) => x.id === w.dataset.todoId),
          due: head && head.dataset.due != null ? head.dataset.due : "keep",
        };
      })
      .filter((x) => x.t);
    shown.forEach(({ t, due }) => {
      if (due === "keep" || (t.repeat && !due)) return; // a repeat keeps a date
      const d = due || null;
      if (d === t.due || (d && spansOn(t, d))) return;
      if (t.repeat && d) t.repeatDay = dayOf(d);
      t.due = d;
    });
    // the shown to-dos take the same slots in the list, in their new order
    const slots = shown.map((x) => todoList.indexOf(x.t)).sort((a, b) => a - b);
    const next = todoList.slice();
    slots.forEach((slot, k) => {
      next[slot] = shown[k].t;
    });
    todoList = next;
    saveContent("todo-content", todoList);
    renderHome();
  }
})();
