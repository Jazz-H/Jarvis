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
function showToast(msg, isError) {
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
  t.querySelector(".toast-action").onclick = () => {
    clearTimeout(toastTimer);
    t.classList.remove("show", "actionable");
    onUndo();
  };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show", "actionable"), 5000);
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
