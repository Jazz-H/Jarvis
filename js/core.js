// core.js - Storage helpers (one JSON blob per key), toasts, HTML escaping, shared UI state.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- storage helpers (one JSON blob per key, plain localStorage) ----------
function loadContent(key, defaults) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return JSON.parse(JSON.stringify(defaults));
}
// Flag maps ({id: true}) — anything that isn't a plain object becomes {}
function loadState(key) {
  const v = loadContent(key, {});
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function saveContent(key, data, { toast = true } = {}) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    markDataChanged();
    if (toast) showToast("Saved");
  } catch (e) {
    console.error("save failed", e);
    showToast("Save failed — storage may be full or disabled", true);
  }
}
function genId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
let toastTimer;
let undoPending = false; // an Undo toast is showing: plain notices ("Saved") don't replace it
const UNDO_MS = 8000;
function showToast(msg, isError) {
  if (undoPending && !isError) return;
  undoPending = false;
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("actionable");
  t.classList.toggle("error", !!isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), isError ? 2600 : 1400);
}
function showUndoToast(msg, onUndo) {
  const t = document.getElementById("toast");
  t.innerHTML = `<span>${escapeHtml(msg)}</span><button type="button" class="toast-action">Undo</button>`;
  t.classList.remove("error");
  t.classList.add("show", "actionable");
  undoPending = true;
  const hide = () => {
    undoPending = false;
    t.classList.remove("show", "actionable");
  };
  t.querySelector(".toast-action").onclick = () => {
    clearTimeout(toastTimer);
    hide();
    onUndo();
  };
  // 8 seconds, paused while the pointer or keyboard focus is on it
  const start = () => {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hide, UNDO_MS);
  };
  t.onmouseenter = t.onfocusin = () => clearTimeout(toastTimer);
  t.onmouseleave = t.onfocusout = start;
  start();
}
// Undo for a change: put back only what it changed (removed items return to their place, items it
// edited go back to how they were), so anything else edited or synced in the meantime stays.
// before/after/now are copies of liveData(); returns just the keys to restore.
function undoMerge(before, after, now) {
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const byId = (x) => Array.isArray(x) && x.every((i) => i && typeof i === "object" && "id" in i);
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  const out = {};
  Object.keys(before).forEach((k) => {
    const b = before[k],
      a = after[k],
      c = now[k];
    if (same(b, a)) return; // the change didn't touch it
    if (same(c, a)) {
      out[k] = b; // nothing else changed it since
      return;
    }
    if (byId(b) && byId(a) && byId(c)) {
      const res = c.slice();
      const inAfter = new Map(a.map((i) => [i.id, i]));
      b.forEach((item, idx) => {
        const at = res.findIndex((x) => x.id === item.id);
        if (!inAfter.has(item.id)) {
          if (at < 0) res.splice(Math.min(idx, res.length), 0, item);
        } else if (at >= 0 && !same(inAfter.get(item.id), item) && same(res[at], inAfter.get(item.id))) res[at] = item;
      });
      a.forEach((item) => {
        if (b.some((x) => x.id === item.id)) return;
        const at = res.findIndex((x) => x.id === item.id);
        if (at >= 0 && same(res[at], item)) res.splice(at, 1); // added by the change, untouched since
      });
      out[k] = res;
    } else if (isObj(b) && isObj(a) && isObj(c)) {
      const res = { ...c };
      new Set([...Object.keys(b), ...Object.keys(a)]).forEach((f) => {
        if (same(b[f], a[f]) || !same(c[f], a[f])) return;
        if (f in b) res[f] = b[f];
        else delete res[f];
      });
      out[k] = res;
    } // anything else changed since in a way that can't be merged keeps its current value
  });
  return out;
}
function dataSnapshot() {
  return JSON.parse(JSON.stringify(liveData()));
}
function undoTo(before, after) {
  const patch = undoMerge(before, after, dataSnapshot());
  if (!Object.keys(patch).length) return;
  applyRemote({ updatedAt: Date.now(), data: patch });
  markDataChanged();
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}
function escapeAttr(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;");
}
// Only http(s) links are rendered; anything else (javascript:, data:, junk) is dropped.
function safeUrl(u) {
  if (!u) return "";
  try {
    const url = new URL(String(u), location.href);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch (e) {
    return "";
  }
}
function linkHtml(u, attrs, inner) {
  const href = safeUrl(u);
  return href ? `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" ${attrs}>${inner}</a>` : "";
}

let styleState = {};
let wantsState = {};
// Collapsible open/closed state is tracked here (not just DOM classes) because
// edits trigger full re-renders, which would otherwise silently re-collapse
// whatever the user had open.
let openPinned = new Set([
  "todo-card",
  "wants-pending-card",
  "weight-card",
  "fit-plan",
  "bills-mine",
  "bills-joint",
  "pay-plan",
  "glance",
  "goals-card",
  "spending-card",
]); // Recurring and Budget's calendar start closed
let expandedTodos = new Set();
let subAddOpen = new Set(); // to-dos whose sub-list currently shows the add input
