// gestures.js - Gestures: swipe between tabs and pull-to-refresh.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// Swipe left/right between tabs (ignored if the gesture looks like a vertical scroll)
(function(){
  const mainEl = document.querySelector("main");
  let startX = 0, startY = 0, tracking = false;
  mainEl.addEventListener("touchstart", e => {
    if (e.target.closest(".home-cal, .bcal-wrap")){ tracking = false; return; }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, {passive:true});
  mainEl.addEventListener("touchend", e => {
    if (!tracking) return;
    tracking = false;
    if (Date.now() - dragJustEnded < 400) return; // that was a drag, not a swipe
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    const idx = TAB_ORDER.indexOf(NAV_TAB(currentTab));
    if (dx < 0 && idx < TAB_ORDER.length - 1) activateTab(TAB_ORDER[idx + 1]);
    if (dx > 0 && idx > 0) activateTab(TAB_ORDER[idx - 1]);
  }, {passive:true});
})();

// Pull-to-refresh: clear Jazz-owned caches and unregister its worker before
// reloading, without disturbing other apps hosted on the same origin.
(function(){
  const mainEl = document.querySelector("main");
  const indicator = document.getElementById("pull-indicator");
  const label = indicator.querySelector(".pull-label");
  const THRESHOLD = 70;
  const MAX_PULL = 110;
  let startY = 0, pulling = false, dragging = false;

  mainEl.addEventListener("touchstart", e => {
    if (e.target.closest(".home-cal, .bcal-wrap")){ pulling = false; dragging = false; return; }
    pulling = mainEl.scrollTop <= 0;
    dragging = false;
    startY = e.touches[0].clientY;
  }, {passive:true});

  mainEl.addEventListener("touchmove", e => {
    if (!pulling) return;
    if (document.body.classList.contains("todo-dragging") || pressDrag.pending){ pulling = false; return; }
    if (mainEl.scrollTop > 0){ pulling = false; return; }
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) return;
    dragging = true;
    e.preventDefault();
    indicator.classList.remove("animated");
    const pull = Math.min(dy * 0.5, MAX_PULL);
    indicator.style.height = pull + "px";
    const ready = pull >= THRESHOLD;
    indicator.classList.toggle("ready", ready);
    label.textContent = ready ? "Release to refresh" : "Pull to refresh";
  }, {passive:false});

  mainEl.addEventListener("touchend", () => {
    if (!dragging){ pulling = false; return; }
    dragging = false;
    indicator.classList.add("animated");
    if (indicator.classList.contains("ready")){
      indicator.classList.add("refreshing");
      label.textContent = "Refreshing…";
      indicator.style.height = THRESHOLD + "px";
      hardRefresh();
    } else {
      indicator.style.height = "0px";
    }
    pulling = false;
  }, {passive:true});
})();

