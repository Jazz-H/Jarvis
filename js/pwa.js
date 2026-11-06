// pwa.js - PWA: hard refresh, view resume and service-worker registration.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// Pull-to-refresh (a normal pull): sync, which also brings in a new Jarvis briefing, and redraw.
// A long pull still does hardRefresh() below, the escape hatch for a stuck update.
async function refreshData() {
  checkDayChange();
  if (localStorage.getItem("sync-token")) {
    try {
      showToast((await pullSync()) ? "Up to date" : "Syncing in a moment");
    } catch (e) {
      showToast(syncErrorText(e, "Sync failed — check your connection"), true);
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
  // The repo was renamed (Jazz2.0 → Jarvis, Nov 5 2026), which moved the app to /Jarvis/. The copy
  // installed at the old address left a worker there that would keep showing notifications that open
  // a page that's gone: drop its notification sign-up and the worker. Same site, so data and tokens stay.
  const OLD_SCOPES = ["/Jazz2.0/"];
  if (navigator.serviceWorker.getRegistrations)
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) =>
        regs
          .filter(
            (r) =>
              OLD_SCOPES.includes(new URL(r.scope).pathname) &&
              !location.pathname.startsWith(new URL(r.scope).pathname),
          )
          .forEach((r) =>
            (r.pushManager ? r.pushManager.getSubscription() : Promise.resolve(null))
              .then((sub) => sub && sub.unsubscribe())
              .catch(() => {})
              .finally(() => r.unregister()),
          ),
      )
      .catch(() => {});
  // An installed app that's switched back to resumes without loading, so the browser never looks
  // for a new version. Look when it comes back to the screen (at most every 10 minutes); a new
  // worker then takes over and the reload below picks up the deploy.
  let swChecked = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || Date.now() - swChecked < 10 * 60 * 1000) return;
    swChecked = Date.now();
    navigator.serviceWorker
      .getRegistration()
      .then((r) => r && r.update())
      .catch(() => {});
  });
  // A deploy: the page itself comes from the network but the old worker still serves the old
  // CSS/JS, so new markup can show unstyled. When the new worker takes over, reload once (later,
  // when the app is in the background, if you're typing or in a dialog).
  const hadController = !!navigator.serviceWorker.controller;
  let swReloaded = false;
  const swReload = () => {
    if (swReloaded) return;
    swReloaded = true;
    location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    const busy =
      document.querySelector("#modal-backdrop.open") || (document.activeElement || {}).matches?.("input, textarea");
    if (!busy || document.hidden) return swReload();
    document.addEventListener("visibilitychange", () => document.hidden && swReload());
  });
}
