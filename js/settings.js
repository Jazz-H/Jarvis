// settings.js - The Settings page (the gear in the header): sync and backup, appearance,
// notifications, Jarvis's brain and the app itself.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- SETTINGS ----------
// A page of its own (shell.js HIDDEN_TABS: not in the tab bar). The gear opens it and, tapped again or
// with Back, returns to the tab you were on. It carries the sync state (data-state, set by sync.js),
// so a failed sync still shows in the header as a dot on the gear.
let settingsFrom = "home"; // the tab Settings was opened from
let settingsBrainOpened = false;

function settingsToggle() {
  if (currentTab === "settings") settingsBack();
  else {
    settingsFrom = currentTab;
    activateTab("settings");
  }
}
function settingsBack() {
  activateTab(settingsFrom && settingsFrom !== "settings" ? settingsFrom : "home");
}
// The line under Sync: the same words as the desktop status bar
function syncStatusText() {
  const state = (document.getElementById("settings-btn") || { dataset: {} }).dataset.state || "off";
  const mins = syncOkAt ? Math.round((Date.now() - syncOkAt) / 60000) : null;
  return state === "busy"
    ? "Syncing…"
    : state === "error"
      ? "Sync failed: open it to retry"
      : state === "ok" && mins != null
        ? `Synced ${mins < 1 ? "just now" : `${mins} min ago`}`
        : localStorage.getItem("sync-token")
          ? "On"
          : "Off: this device only";
}
const SETTINGS_PUSH = {
  on: "On: the morning headline and anything urgent",
  off: "Off",
  denied: "Blocked in the browser's site settings",
  unsupported: "Not available in this browser",
};
function settingsHtml() {
  const row = (title, sub, action = "") =>
    `<div class="set-row"><div class="set-text"><b>${title}</b><span>${sub}</span></div>${action}</div>`;
  const pref = themePref();
  const theme = THEME_PREFS.map(
    (p) =>
      `<button type="button" class="cn-seg${p === pref ? " on" : ""}" data-action="theme-set" data-pref="${p}" aria-pressed="${p === pref}">${{ system: "System", light: "Light", dark: "Dark" }[p]}</button>`,
  ).join("");
  const push = pushState();
  const pushBtn =
    push === "off" && localStorage.getItem("sync-token")
      ? `<button type="button" class="jv-chip-sm on" data-action="jv-push-on">Turn on</button>`
      : "";
  if (!settingsBrainOpened) {
    openPinned.add("cn-brain-card"); // the brain opens on its own page
    settingsBrainOpened = true;
  }
  return `<div class="set-wrap">
    <button type="button" class="set-back" data-action="settings-back">‹ Back</button>
    <div class="jv-label"><span>Sync &amp; backup</span><i></i></div>
    <section class="card set-card">
      ${row("Sync", escapeHtml(syncStatusText()), `<button type="button" class="jv-chip-sm" data-action="open-sync">Open</button>`)}
      <p class="set-note">Keeps your lists the same on every device through a private gist, with backup and restore.</p>
    </section>
    <div class="jv-label"><span>Appearance</span><i></i></div>
    <section class="card set-card">
      <div class="cn-switch set-theme" role="group" aria-label="Theme">${theme}</div>
      <p class="set-note">System follows your phone's light or dark setting.</p>
    </section>
    <div class="jv-label"><span>Your week</span><i></i></div>
    <section class="card set-card">
      <div class="set-text"><b>Office, home or off</b><span>${escapeHtml(settingsWeekText())}</span></div>
      <div class="set-days" role="group" aria-label="How you spend each day">${SETTINGS_WEEKDAYS.map(
        ([d, short, name]) => {
          const k = jarvisSettings.week[d];
          return `<button type="button" class="set-day ${k}" data-action="week-day-cycle" data-day="${d}" aria-label="${name}: ${WEEK_KINDS[k]}. Tap to change"><b>${short}</b><span>${WEEK_KINDS[k]}</span></button>`;
        },
      ).join("")}</div>
      <p class="set-note">Tap a day to change it. The outfit dresses for it: business casual at the office, comfortable at home, casual on days off. Synced to your other devices.</p>
    </section>
    <div class="jv-label"><span>Notifications</span><i></i></div>
    <section class="card set-card">
      ${row("Phone notifications", escapeHtml(SETTINGS_PUSH[push] || "Off"), pushBtn)}
      ${push === "off" && !localStorage.getItem("sync-token") ? `<p class="set-note">Turn on sync first: notifications come through it.</p>` : ""}
    </section>
    <div class="jv-label"><span>Jarvis</span><i></i></div>
    <div id="set-brain">${brainCardHtml()}</div>
    <div class="jv-label"><span>App</span><i></i></div>
    <section class="card set-card">
      ${row("Reload the app", "Fetches the newest version; your data is kept", `<button type="button" class="jv-chip-sm" data-action="hard-refresh">Reload</button>`)}
    </section>
  </div>`;
}
// Monday first on screen; the day numbers are Date's (Sunday 0)
const SETTINGS_WEEKDAYS = [
  [1, "Mon", "Monday"],
  [2, "Tue", "Tuesday"],
  [3, "Wed", "Wednesday"],
  [4, "Thu", "Thursday"],
  [5, "Fri", "Friday"],
  [6, "Sat", "Saturday"],
  [0, "Sun", "Sunday"],
];
// "Office Mon–Thu · Home Fri · Off Sat, Sun": runs of days in a row read as a range
function settingsWeekText() {
  return Object.keys(WEEK_KINDS)
    .map((k) => {
      const days = SETTINGS_WEEKDAYS.filter(([d]) => jarvisSettings.week[d] === k).map(([, s]) => s);
      if (!days.length) return "";
      const all = SETTINGS_WEEKDAYS.map(([, s]) => s);
      const run = days.length > 2 && all.indexOf(days[days.length - 1]) - all.indexOf(days[0]) === days.length - 1;
      return `${WEEK_KINDS[k]} ${run ? `${days[0]}–${days[days.length - 1]}` : days.join(", ")}`;
    })
    .filter(Boolean)
    .join(" · ");
}
// Office → Home → Off → Office; the outfit on Home follows at once
function settingsCycleDay(day) {
  const d = Number(day);
  if (!SETTINGS_WEEKDAYS.some(([x]) => x === d)) return;
  const order = Object.keys(WEEK_KINDS);
  jarvisSettings.week[d] = order[(order.indexOf(jarvisSettings.week[d]) + 1) % order.length];
  saveBrain("jarvis-settings");
  renderSettings();
  renderHome();
}
function renderSettings() {
  const el = document.getElementById("panel-settings");
  if (el) el.innerHTML = settingsHtml();
}
function settingsSetTheme(pref) {
  if (!THEME_PREFS.includes(pref)) return;
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch (e) {}
  applyTheme();
  if (currentTab === "settings") renderSettings();
}
