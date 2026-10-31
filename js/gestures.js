// gestures.js - Gestures: swipe between tabs and pull-to-refresh.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// Swipe left/right between views (ignored if the gesture looks like a vertical scroll)
(function () {
  const mainEl = document.querySelector("main");
  let startX = 0,
    startY = 0,
    tracking = false;
  mainEl.addEventListener(
    "touchstart",
    (e) => {
      if (e.target.closest(".home-cal, .bcal-wrap, .cn-chips")) {
        tracking = false;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    },
    { passive: true },
  );
  mainEl.addEventListener(
    "touchend",
    (e) => {
      if (!tracking) return;
      tracking = false;
      if (Date.now() - dragJustEnded < 400) return; // that was a drag, not a swipe
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      // One flat left-to-right order (SWIPE_ORDER): inside Wallet or You a swipe first moves to the
      // group's other view, then on to the next tab, so every view is one step from its neighbours
      const idx = SWIPE_ORDER.indexOf(NAV_TAB(currentTab));
      if (idx < 0) return;
      if (dx < 0 && idx < SWIPE_ORDER.length - 1) activateTab(SWIPE_ORDER[idx + 1]);
      if (dx > 0 && idx > 0) activateTab(SWIPE_ORDER[idx - 1]);
    },
    { passive: true },
  );
})();

// Pull-to-refresh: a normal pull syncs (refreshData); pulling all the way down reloads the app,
// clearing Jazz-owned caches and its worker without disturbing other apps on the same origin.
(function () {
  const mainEl = document.querySelector("main");
  const indicator = document.getElementById("pull-indicator");
  const label = indicator.querySelector(".pull-label");
  const THRESHOLD = 70;
  const MAX_PULL = 110;
  let startY = 0,
    pulling = false,
    dragging = false;

  mainEl.addEventListener(
    "touchstart",
    (e) => {
      if (e.target.closest(".home-cal, .bcal-wrap")) {
        pulling = false;
        dragging = false;
        return;
      }
      pulling = mainEl.scrollTop <= 0;
      dragging = false;
      startY = e.touches[0].clientY;
    },
    { passive: true },
  );

  mainEl.addEventListener(
    "touchmove",
    (e) => {
      if (!pulling) return;
      if (document.body.classList.contains("todo-dragging") || pressDrag.pending) {
        pulling = false;
        return;
      }
      if (mainEl.scrollTop > 0) {
        pulling = false;
        return;
      }
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) return;
      dragging = true;
      e.preventDefault();
      indicator.classList.remove("animated");
      const pull = Math.min(dy * 0.5, MAX_PULL);
      indicator.style.height = pull + "px";
      const ready = pull >= THRESHOLD,
        deep = pull >= MAX_PULL;
      indicator.classList.toggle("ready", ready);
      indicator.classList.toggle("deep", deep);
      label.textContent = deep ? "Release to reload the app" : ready ? "Release to sync" : "Pull to sync";
    },
    { passive: false },
  );

  mainEl.addEventListener(
    "touchend",
    () => {
      if (!dragging) {
        pulling = false;
        return;
      }
      dragging = false;
      indicator.classList.add("animated");
      if (indicator.classList.contains("deep")) {
        indicator.classList.add("refreshing");
        label.textContent = "Reloading…";
        indicator.style.height = THRESHOLD + "px";
        hardRefresh();
      } else if (indicator.classList.contains("ready")) {
        indicator.classList.add("refreshing");
        label.textContent = "Syncing…";
        indicator.style.height = THRESHOLD + "px";
        refreshData().finally(() => {
          indicator.classList.remove("refreshing", "ready");
          indicator.style.height = "0px";
        });
      } else {
        indicator.style.height = "0px";
      }
      pulling = false;
    },
    { passive: true },
  );
})();
