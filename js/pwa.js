// pwa.js - PWA: hard refresh, view resume and service-worker registration.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// Pull-to-refresh (a normal pull): sync, which also brings in a new Jarvis briefing, and redraw.
// A long pull still does hardRefresh() below, the escape hatch for a stuck update.
async function refreshData() {
  checkDayChange();
  if (localStorage.getItem("sync-token")) {
    try {
      await pullSync();
      showToast("Up to date");
    } catch (e) {
      showToast("Sync failed — check your connection", true);
    }
  } else showToast("Refreshed");
  renderHome();
}
async function hardRefresh() {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(APP_CACHE_PREFIX)).map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      const scriptUrl = new URL("sw.js", location.href).href;
      await Promise.all(
        regs
          .filter((r) => [r.active, r.waiting, r.installing].some((worker) => worker && worker.scriptURL === scriptUrl))
          .map((r) => r.unregister()),
      );
    }
  } catch (e) {
    console.error("hard refresh cleanup failed", e);
  }
  // come back to the same tab and spot after the reload (this tab only)
  try {
    sessionStorage.setItem(
      "resume-view",
      JSON.stringify({ tab: currentTab, scroll: document.querySelector("main").scrollTop }),
    );
  } catch (e) {}
  location.reload();
}
function resumeView() {
  let v = null;
  try {
    v = JSON.parse(sessionStorage.getItem("resume-view"));
    sessionStorage.removeItem("resume-view");
  } catch (e) {}
  if (!v || !isTab(v.tab) || v.tab === currentTab) return;
  activateTab(v.tab);
  const y = Number(v.scroll) || 0;
  if (y)
    requestAnimationFrame(() => {
      document.querySelector("main").scrollTop = y;
    });
}

// ---------- PWA: service worker registration (only works when hosted on a real http(s) origin) ----------
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js", { updateViaCache: "none" })
      .catch((err) => console.log("SW registration skipped:", err));
  });
}
