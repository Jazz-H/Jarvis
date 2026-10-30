// theme.js - Light/dark theme. Loads in <head> (before the page paints) so there's no flash.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- THEME ----------
// "system" follows the phone/computer setting (and changes with it); "light" and "dark" pin it.
// The choice is this device's only: it's not synced and not in backups. css/app.css reads
// <html data-theme="light|dark">, the resolved theme.
const THEME_KEY = "theme-pref";
const THEME_PREFS = ["system", "light", "dark"];
const THEME_LABELS = { system: "Theme: match system", light: "Theme: light", dark: "Theme: dark" };
const THEME_COLORS = { dark: "#02060b", light: "#eef4f8" }; // browser chrome, same as --bg
const themeQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

function themePref() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEME_PREFS.includes(v) ? v : "system";
  } catch (e) {
    return "system";
  }
}
function resolvedTheme(pref = themePref()) {
  if (pref !== "system") return pref;
  return themeQuery && themeQuery.matches ? "light" : "dark";
}
function applyTheme() {
  const pref = themePref(),
    theme = resolvedTheme(pref);
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
  const btn = document.getElementById("theme-btn");
  if (btn) {
    btn.dataset.pref = pref;
    btn.setAttribute("aria-label", THEME_LABELS[pref]);
    btn.title = THEME_LABELS[pref];
  }
}
// The header button steps system → light → dark → system
function cycleTheme() {
  const next = THEME_PREFS[(THEME_PREFS.indexOf(themePref()) + 1) % THEME_PREFS.length];
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (e) {}
  applyTheme();
  if (typeof showToast === "function") showToast(THEME_LABELS[next]);
}

applyTheme();
if (themeQuery) {
  if (themeQuery.addEventListener) themeQuery.addEventListener("change", applyTheme);
  else if (themeQuery.addListener) themeQuery.addListener(applyTheme);
}
document.addEventListener("DOMContentLoaded", applyTheme); // labels the header button once it exists
