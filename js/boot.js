// boot.js - Startup: header date, midnight rollover and the init sequence. Must load last.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// Persists housekeeping (format migrations, auto-archive) WITHOUT bumping
// data-updated-at. Bumping it would make a device holding stale data look
// newest on its next sync and push that stale copy over the other device's
// real edits. Every device applies the same housekeeping rules on its own,
// so nothing is lost by not syncing these writes.
// The app can stay open past midnight: when the date changes, everything that
// says "today" (header, Home, the routine, budget) is redrawn for the new day
let renderedDay = addDaysIso(0);
function setHeaderDate() {
  const now = new Date();
  document.getElementById("header-date").textContent =
    `${now.toLocaleDateString("en-US", { weekday: "short" })} · ${now.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
function checkDayChange() {
  const today = addDaysIso(0);
  if (today === renderedDay) return;
  renderedDay = today;
  if (homeDate && homeDate < today) homeDate = null;
  homeAnchor = null;
  setHeaderDate();
  archiveOldTodos();
  if (processAutopay()) {
    writeQuietly("bills-content", bills);
    writeQuietly("bill-payments", billPayments);
  }
  renderSkin();
  renderBudget();
  renderFitness();
  renderHome();
  loadConsoleFeed(); // drops entries older than 7 days
  renderConsole();
}
function writeQuietly(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("write failed", key, e);
  }
}
(async function init() {
  loadAllContent();
  archiveOldTodos();

  setHeaderDate();
  setInterval(checkDayChange, 60000);

  renderSkin();
  styleState = loadState("style-state");
  wantsState = loadState("wants-state");
  migrateWardrobeNeeds();
  renderBudget();
  renderWants();
  renderFitness();
  renderHome();
  renderConsole();
  applyLaunchParams();
  if (!location.search) resumeView();
  initSync();
  importFromLink();
  pushCheck();
})();
