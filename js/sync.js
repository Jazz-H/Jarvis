// sync.js - Optional cross-device sync through a private GitHub Gist.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- GIST SYNC ----------
// Optional cross-device sync through a private GitHub Gist. The gist holds one
// JSON file with every content/state key plus an updatedAt stamp; conflicts are
// merged per list (see syncNow). Requires a classic PAT with only the `gist`
// scope (fine-grained tokens can't use the Gist API), pasted once per device
// via the cloud button in the header. Token + gist id live in localStorage and
// are never synced themselves.
const SYNC_KEYS = [
  "skin-rules-content",
  "skin-routine-content",
  "routine-checks",
  "skin-days-content",
  "style-rules-content",
  "sizes-content",
  "capsule-content",
  "wants-content",
  "todo-content",
  "todo-archive-content",
  "style-state",
  "wants-state",
  "bills-content",
  "bill-payments",
  "budget-content",
  "fitness-content",
  "plan3-content",
];
const GIST_FILENAME = "jazz2-data.json";
let syncPushTimer = null;
let syncBusy = false;

function markDataChanged() {
  localStorage.setItem("data-updated-at", String(Date.now()));
  scheduleSyncPush();
}
function setSyncStatus(state) {
  const btn = document.getElementById("sync-btn");
  if (btn) btn.dataset.state = state;
}
async function gistApi(path, opts = {}) {
  const res = await fetch("https://api.github.com" + path, {
    ...opts,
    headers: {
      Authorization: "Bearer " + localStorage.getItem("sync-token"),
      Accept: "application/vnd.github+json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error("GitHub API " + res.status + " on " + path);
  return res.json();
}
function collectLocal() {
  const data = {};
  SYNC_KEYS.forEach((k) => {
    const raw = localStorage.getItem(k);
    if (raw != null) {
      try {
        data[k] = JSON.parse(raw);
      } catch (e) {}
    }
  });
  return { updatedAt: Number(localStorage.getItem("data-updated-at")) || 0, data };
}
function applyRemote(payload) {
  SYNC_KEYS.forEach((k) => {
    if (payload.data && k in payload.data) localStorage.setItem(k, JSON.stringify(payload.data[k]));
  });
  // Data from an older app version (or an old backup) has per-day skin lists but
  // no merged routine: drop the local routine so it's rebuilt from those lists
  if (payload.data && "skin-days-content" in payload.data && !("skin-routine-content" in payload.data)) {
    localStorage.removeItem("skin-routine-content");
  }
  localStorage.setItem("data-updated-at", String(payload.updatedAt || Date.now()));
  loadAllContent();
  styleState = loadState("style-state");
  wantsState = loadState("wants-state");
  migrateWardrobeNeeds(); // data from an older app version may still have a wardrobe "Still need" list
  archiveOldTodos(); // the other device may have carried expired completed items
  renderSkin();
  renderWants();
  renderBudget();
  renderFitness();
  renderHome();
}
async function findOrCreateGist() {
  const gists = await gistApi("/gists?per_page=100");
  const hit = gists.find((g) => g.files && g.files[GIST_FILENAME]);
  let id = hit && hit.id;
  if (!id) {
    const created = await gistApi("/gists", {
      method: "POST",
      body: JSON.stringify({
        description: "Jazz 2.0 app data (auto-sync)",
        public: false,
        files: { [GIST_FILENAME]: { content: JSON.stringify(collectLocal()) } },
      }),
    });
    id = created.id;
  }
  localStorage.setItem("sync-gist-id", id);
  return id;
}
function scheduleSyncPush() {
  if (!localStorage.getItem("sync-token")) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(() => pushSync().catch(() => {}), 1500);
}
// Sync is a three-way merge per list (each SYNC_KEYS entry). "sync-base" keeps
// every list as it was at the last successful sync. A list this device changed
// since then is sent up; a list only the other device changed is taken from
// the gist. If both changed the same list, it's merged item by item (mergeLists),
// so a to-do added on the phone and another ticked on the laptop both survive;
// only when both changed the very same item does this device's copy of it win.
// The gist is always re-read right before writing.
const SYNC_BASE_KEY = "sync-base";
// base/local/remote are one list's parsed values. Lists of {id} items merge per item (adds and
// deletes from both sides, the other side's edits to items this side left alone); plain objects
// (flag maps, settings) merge per field the same way. Anything else: this device wins.
function mergeLists(base, local, remote) {
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const byId = (x) => Array.isArray(x) && x.every((i) => i && typeof i === "object" && "id" in i);
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  if (byId(base) && byId(local) && byId(remote)) {
    const b = new Map(base.map((i) => [i.id, i])),
      r = new Map(remote.map((i) => [i.id, i]));
    const out = [];
    local.forEach((item) => {
      const was = b.get(item.id),
        theirs = r.get(item.id);
      if (was && !theirs) {
        if (same(item, was)) return; // deleted there, untouched here
        out.push(item); // deleted there but edited here: keep the edit
      } else if (was && theirs && same(item, was))
        out.push(theirs); // only they changed it
      else out.push(item);
    });
    // added on the other device: insert after the item it followed there
    remote.forEach((item, idx) => {
      if (b.has(item.id) || out.some((x) => x.id === item.id)) return;
      const prev = idx > 0 ? out.findIndex((x) => x.id === remote[idx - 1].id) : -1;
      out.splice(prev + 1, 0, item);
    });
    return out;
  }
  if (isObj(base) && isObj(local) && isObj(remote)) {
    const out = { ...local };
    new Set([...Object.keys(base), ...Object.keys(remote)]).forEach((f) => {
      if (!same(local[f], base[f]) || same(remote[f], base[f])) return; // changed here, or not there
      if (f in remote) out[f] = remote[f];
      else delete out[f];
    });
    return out;
  }
  return local;
}
function isEditing() {
  const active = document.activeElement;
  return (
    document.getElementById("modal-backdrop").classList.contains("open") ||
    document.getElementById("composer").classList.contains("open") ||
    !!(active && (active.id === "jv-quick" || active.id === "console-input")) || // typing in Home's quick add or Console
    voiceListening() // or speaking into one of them
  );
}
function localSnapshot() {
  const out = {};
  SYNC_KEYS.forEach((k) => {
    const raw = localStorage.getItem(k);
    if (raw != null) {
      try {
        out[k] = JSON.stringify(JSON.parse(raw));
      } catch (e) {}
    }
  });
  return out;
}
async function fetchRemote(gistId) {
  const g = await gistApi("/gists/" + gistId);
  ingestBriefingFile(g.files && g.files[BRIEFING_FILENAME]); // Jarvis's read-only briefing rides along
  ingestReviewFile(g.files && g.files[REVIEWS_FILENAME]); // and so do the weekly reviews
  ingestCalendarFile(g.files && g.files[CALENDAR_FILENAME]); // and the calendar history for the Planner
  ingestAskFile(g.files && g.files[ASK_FILE]); // Ask Jarvis: questions from other devices, Clear history
  ingestAnswersFile(g.files && g.files[ANSWERS_FILE]); // and Jarvis's answers (read-only)
  const file = g.files && g.files[GIST_FILENAME];
  if (!file) return null;
  const text = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
  try {
    const p = JSON.parse(text);
    return p && typeof p === "object" && p.data && typeof p.data === "object" ? p : null;
  } catch (e) {
    return null;
  }
}
async function syncNow() {
  if (!localStorage.getItem("sync-token")) return;
  // never swap data out from under an open edit form; try again shortly
  if (syncBusy || isEditing()) {
    scheduleSyncPush();
    return;
  }
  syncBusy = true;
  setSyncStatus("busy");
  try {
    const gistId = localStorage.getItem("sync-gist-id") || (await findOrCreateGist());
    const remote = await fetchRemote(gistId);
    const local = localSnapshot();
    const remoteStr = {};
    if (remote)
      Object.entries(remote.data).forEach(([k, v]) => {
        remoteStr[k] = JSON.stringify(v);
      });
    let baseRaw = localStorage.getItem(SYNC_BASE_KEY),
      base = null;
    try {
      base = baseRaw ? JSON.parse(baseRaw) : null;
    } catch (e) {
      base = null;
    }
    let merged = {},
      takeRemote = [],
      sendUp = false;
    if (!base) {
      // First sync on this device (or the first since this kind of sync existed):
      // fall back to "newest copy wins", which is what earlier versions did
      const localUpdated = Number(localStorage.getItem("data-updated-at")) || 0;
      const remoteUpdated = (remote && remote.updatedAt) || 0;
      if (remote && remoteUpdated > localUpdated) {
        merged = { ...remoteStr };
        takeRemote = Object.keys(remoteStr);
      } else {
        merged = { ...local };
        sendUp = true;
      }
    } else {
      new Set([...SYNC_KEYS, ...Object.keys(remoteStr)]).forEach((k) => {
        const l = local[k],
          r = remoteStr[k],
          b = base[k];
        if (l !== b && r !== undefined && b !== undefined && l !== undefined && r !== b && l !== r) {
          // changed on both devices: merge item by item
          const m = JSON.stringify(mergeLists(JSON.parse(b), JSON.parse(l), JSON.parse(r)));
          merged[k] = m;
          if (m !== r) sendUp = true;
          if (m !== l) takeRemote.push(k);
        } else if (l !== b) {
          if (l !== undefined) merged[k] = l;
          if (l !== r) sendUp = true;
        } // changed here
        else if (r !== undefined) {
          merged[k] = r;
          if (r !== l) takeRemote.push(k);
        } // unchanged here
      });
      if (!remote) sendUp = true;
    }
    if (takeRemote.length) {
      const data = {};
      takeRemote.forEach((k) => {
        data[k] = JSON.parse(merged[k]);
      });
      applyRemote({ updatedAt: (remote && remote.updatedAt) || Date.now(), data });
      showToast("Synced from your other device");
    }
    if (sendUp) {
      const data = {};
      Object.entries(merged).forEach(([k, v]) => {
        data[k] = JSON.parse(v);
      });
      const updatedAt = Math.max(Date.now(), (remote && remote.updatedAt) || 0);
      await gistApi("/gists/" + gistId, {
        method: "PATCH",
        body: JSON.stringify({
          files: { [GIST_FILENAME]: { content: JSON.stringify({ updatedAt, data }) } },
        }),
      });
      localStorage.setItem("data-updated-at", String(updatedAt));
    }
    localStorage.setItem(SYNC_BASE_KEY, JSON.stringify(merged));
    setSyncStatus("ok");
  } catch (e) {
    console.error("sync failed", e);
    setSyncStatus("error");
    throw e;
  } finally {
    syncBusy = false;
  }
}
async function pushSync() {
  try {
    await syncNow();
  } catch (e) {
    showToast("Sync failed — will retry when you're back online", true);
    throw e;
  }
}
function pullSync() {
  return syncNow();
}
// A failed sync (offline, a GitHub hiccup) tries again when the connection comes back or the app
// is opened again, not only on the next edit
window.addEventListener("online", scheduleSyncPush);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleSyncPush();
});
