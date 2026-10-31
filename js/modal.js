// modal.js - Modal engine reused by every add/edit form.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- MODAL ENGINE (reused for every add/edit form) ----------
let modalFields = [];
let modalOnSave = null;
let modalOnDelete = null;
let modalDeleteOpts = {};

let modalReturnFocus = null;
function openModal(title, fields, values, onSave, onDelete, deleteOpts) {
  modalReturnFocus = document.activeElement;
  document.getElementById("modal-heading").textContent = title;
  modalFields = fields;
  modalOnSave = onSave;
  modalOnDelete = onDelete || null;
  modalDeleteOpts = deleteOpts || {};
  document.getElementById("modal-delete-btn").textContent = (deleteOpts && deleteOpts.label) || "Delete";
  document.querySelector("#modal-backdrop .modal-btn.primary").textContent =
    (deleteOpts && deleteOpts.saveLabel) || "Save";
  const body = document.getElementById("modal-body");
  body.innerHTML = fields
    .map((f) => {
      const val = values && values[f.key] != null ? values[f.key] : f.type === "checkbox" ? false : "";
      if (f.type === "note") {
        return `<p class="modal-note">${f.label}</p>`; // f.label is trusted app-authored HTML
      }
      if (f.type === "html") return f.label; // app-authored block with its own controls
      if (f.type === "days") {
        const sel = Array.isArray(val) ? val : [];
        const chips = [0, 1, 2, 3, 4, 5, 6]
          .map(
            (d) =>
              `<label class="day-chip"><input type="checkbox" value="${d}" ${sel.includes(d) ? "checked" : ""}><span>${DAY_SHORT[d]}</span></label>`,
          )
          .join("");
        return `<div class="modal-field"><span>${f.label}</span><div class="day-chips" id="modal-${f.key}">${chips}</div></div>`;
      }
      if (f.type === "select") {
        const opts = f.options
          .map((o) => `<option value="${escapeAttr(o)}" ${o === val ? "selected" : ""}>${escapeHtml(o)}</option>`)
          .join("");
        return `<label class="modal-field"><span>${f.label}</span><select id="modal-${f.key}">${opts}</select></label>`;
      }
      if (f.type === "textarea") {
        // enterSaves: a wrapping single-value field (e.g. a long to-do title) — Enter saves instead of adding a newline
        return `<label class="modal-field"><span>${f.label}</span><textarea id="modal-${f.key}" rows="2"${f.enterSaves ? ' data-enter-saves enterkeyhint="done"' : ""}${f.maxlength ? ` maxlength="${f.maxlength}"` : ""}>${escapeHtml(val)}</textarea></label>`;
      }
      if (f.type === "checkbox") {
        return `<label class="modal-field modal-checkbox"><input id="modal-${f.key}" type="checkbox" ${val ? "checked" : ""}><span>${f.label}</span></label>`;
      }
      return `<label class="modal-field"><span>${f.label}</span><input id="modal-${f.key}" type="${f.type || "text"}" value="${escapeAttr(val)}"${f.step ? ` step="${f.step}"` : ""}></label>`;
    })
    .join("");
  document.getElementById("modal-delete-btn").style.display = modalOnDelete ? "block" : "none";
  document.getElementById("modal-backdrop").classList.add("open");
  syncSheets();
  // Autofocus the first field — desktop only, so mobile doesn't pop the keyboard
  // over the sheet the moment it opens. On touch, focus goes to the heading instead,
  // so a screen reader (or the next Tab) starts inside the sheet.
  if (window.matchMedia("(hover:hover) and (pointer:fine)").matches) {
    const first = body.querySelector("input, textarea, select");
    if (first) setTimeout(() => first.focus(), 60);
  } else {
    const h = document.getElementById("modal-heading");
    h.setAttribute("tabindex", "-1");
    h.focus({ preventScroll: true });
  }
}
document.addEventListener("keydown", (e) => {
  if (document.getElementById("composer").classList.contains("open")) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeComposer();
    } else if (
      e.key === "Enter" &&
      !e.shiftKey &&
      (e.target.id === "composer-text" || e.target.matches("#composer-extra input, #composer-buy input"))
    ) {
      e.preventDefault();
      composerAdd();
    }
    return;
  }
  if (!document.getElementById("modal-backdrop").classList.contains("open")) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeModal();
  } else if (
    e.key === "Enter" &&
    e.target.matches(".modal-body input:not([type=checkbox]), .modal-body textarea[data-enter-saves]")
  ) {
    e.preventDefault(); // Enter from a text field saves; other textareas keep Enter for newlines
    modalSave();
  }
});
// While a sheet (edit form or + composer) is open it's the only thing Tab and screen readers
// reach; a closed one is out of reach entirely (it stays in the page, just hidden).
function syncSheets() {
  const modal = document.getElementById("modal-backdrop"),
    comp = document.getElementById("composer");
  const review = document.getElementById("review-sheet"); // the Weekly Review (review.js)
  const mo = modal.classList.contains("open"),
    co = comp.classList.contains("open"),
    ro = !!review && review.classList.contains("open");
  modal.inert = !mo;
  comp.inert = !co || mo;
  if (review) review.inert = !ro || mo || co;
  document.querySelectorAll("body > header, main, #fab, nav.tabbar").forEach((x) => (x.inert = mo || co || ro));
}
function closeModal() {
  document.getElementById("modal-backdrop").classList.remove("open");
  syncSheets();
  // back to whatever opened it, if it's still on the page (keyboard/screen-reader users)
  if (modalReturnFocus && document.contains(modalReturnFocus))
    try {
      modalReturnFocus.focus({ preventScroll: true });
    } catch (e) {}
  modalReturnFocus = null;
}
function modalSave() {
  const values = {};
  modalFields.forEach((f) => {
    const el = document.getElementById("modal-" + f.key);
    if (!el) return; // note fields render no input
    if (f.type === "days") {
      values[f.key] = [...el.querySelectorAll("input:checked")].map((i) => Number(i.value)).sort((a, b) => a - b);
      return;
    }
    let v = f.type === "checkbox" ? el.checked : el.value;
    if (f.type === "number") v = v === "" ? null : parseFloat(v);
    if (typeof v === "string") v = v.trim();
    values[f.key] = v;
  });
  if (modalOnSave) modalOnSave(values);
  closeModal();
}
// Deletes happen right away with an Undo (no "are you sure?"): the undo puts
// back whatever the delete changed in any list (a goal's links, a category's
// spending…) and keeps other edits made since (undoMerge).
function modalDelete() {
  if (!modalOnDelete) return;
  if (modalDeleteOpts.noUndo) {
    // not a data change (e.g. turning sync off): ask instead
    if (confirm(modalDeleteOpts.confirm)) {
      modalOnDelete();
      closeModal();
    }
    return;
  }
  const before = dataSnapshot();
  const label = document.getElementById("modal-delete-btn").textContent;
  modalOnDelete();
  closeModal();
  const after = dataSnapshot();
  showUndoToast(/delete/i.test(label) ? "Deleted" : "Done", () => undoTo(before, after));
}
