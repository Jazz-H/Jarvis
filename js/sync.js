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
  "jarvis-memory", // Jarvis's brain (brain.js)
  "jarvis-notes", // the Notebook (brain.js)
  "jarvis-feedback",
  "jarvis-settings",
];
const GIST_FILENAME = "jazz2-data.json";
let syncPushTimer = null;
let syncBusy = false;

function markDataChanged() {
  localStorage.setItem("data-updated-at", String(Date.now()));
  scheduleSyncPush();
}
let syncOkAt = 0; // last good sync this session, for the desktop status bar
// notNew: putting the button back without saying a sync just worked
function setSyncStatus(state, notNew = false) {
  const btn = document.getElementById("sync-btn");
  if (btn) btn.dataset.state = state;
  if (state === "ok" && !notNew) syncOkAt = Date.now();
  renderDeskFooter();
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
  if (!res.ok) {
    const err = new Error("GitHub API " + res.status + " on " + path);
    err.status = res.status;
    throw err;
  }
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
// Callers overlap (a sync, a question, a push address), and each would otherwise make its own gist
let gistLookup = null;
function findOrCreateGist() {
  if (gistLookup) return gistLookup;
  const lookup = lookUpGist().finally(() => {
    if (gistLookup === lookup) gistLookup = null; // forgetGist may have started over
  });
  gistLookup = lookup;
  return lookup;
}
function gistLostError() {
  const err = new Error("The sync gist can't be found");
  err.gistLost = true;
  return err;
}
async function lookUpGist() {
  const token = localStorage.getItem("sync-token");
  const gists = await gistApi("/gists?per_page=100");
  const hits = gists.filter((g) => g.files && g.files[GIST_FILENAME]);
  // The gist this device last synced with settles it (turning sync off and on again). Otherwise guessing,
  // or making one while a full page may be hiding the real one, could leave the backend's gist.
  const known = hits.find((g) => g.id === localStorage.getItem(SYNC_BASE_GIST_KEY));
  if (!known && (hits.length > 1 || (!hits.length && gists.length >= 100))) throw gistLostError();
  if (localStorage.getItem("sync-token") !== token) throw new Error("The sync token changed");
  let id = (known || hits[0] || {}).id;
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
  if (localStorage.getItem("sync-token") !== token) throw new Error("The sync token changed");
  localStorage.setItem("sync-gist-id", id);
  return id;
}
// The base describes one gist, and sync-base-gist says which. A base from before that was recorded
// describes the gist saved now, so it's labelled before that id goes away.
function labelBase() {
  const id = localStorage.getItem("sync-gist-id");
  if (id && localStorage.getItem(SYNC_BASE_KEY) != null && localStorage.getItem(SYNC_BASE_GIST_KEY) == null)
    localStorage.setItem(SYNC_BASE_GIST_KEY, id);
}
// Reconnecting or turning sync off: this device no longer has a gist, and a lookup still running
// for the old token mustn't be joined or save its answer; a sync still running stops at its next step.
// The base stays: if this device comes back to the same gist it's still right (see syncNow).
let syncEpoch = 0;
function forgetGist() {
  syncEpoch++;
  gistLookup = null;
  gistRecovery = null;
  labelBase();
  localStorage.removeItem("sync-gist-id");
}
// A token pasted in the Sync dialog. It's checked before anything changes, so a typo costs nothing,
// and the gist already in use stays in use if the token can see it (rotating a token changes nothing
// about the data). Moving only happens to a gist that's clearly the one, and never away from a
// working connection on a guess. A token that sees no data gist at all (the Ask key pasted here,
// another account) changes nothing either; starting a new gist on purpose means turning sync off
// first. Resolves true if a sync finished, false if one is still to come, null if this was overtaken
// (sync turned off, or another token saved), whichever way it ended: then it has nothing to report.
let syncConnecting = 0;
async function connectSync(token) {
  const mine = ++syncConnecting;
  let epoch = syncEpoch;
  const overtaken = () => mine !== syncConnecting || epoch !== syncEpoch;
  try {
    const gists = await gistApi("/gists?per_page=100", { headers: { Authorization: "Bearer " + token } });
    if (overtaken()) return null;
    const saved = localStorage.getItem("sync-gist-id");
    const hits = gists.filter((g) => g.files && g.files[GIST_FILENAME]);
    if (!saved || !hits.some((g) => g.id === saved)) {
      if (saved && !hits.length) {
        const err = new Error("This token can't see the sync gist");
        err.gistHidden = true;
        throw err;
      }
      if (saved && (hits.length > 1 || gists.length >= 100)) throw gistLostError();
      forgetGist();
      epoch = syncEpoch;
    }
    localStorage.setItem("sync-token", token);
    const finished = await syncNow();
    return overtaken() ? null : finished;
  } catch (e) {
    if (overtaken()) return null;
    throw e;
  }
}
// What to tell the owner when a sync fails; only they can fix these
function syncErrorText(e, fallback) {
  if (e && e.gistHidden)
    return "This token can't see your sync gist, so nothing changed. To start a new gist, turn sync off first";
  if (e && e.gistLost) return "Sync can't tell which gist to use — check your gists on GitHub";
  if (e && e.badData) return "Sync stopped: the gist's data file can't be read. Nothing was changed";
  return fallback;
}
// The saved gist answered 404. If it was replaced (a rotation, to clear its old versions), exactly
// one other gist holds the data file: move there. This never makes a gist: that would move the device
// off the one the backend uses, with no error. No clear answer keeps the saved id and fails.
let gistRecovery = null;
function recoverGist(staleId) {
  if (gistRecovery) return gistRecovery;
  const recovery = findReplacedGist(staleId).finally(() => {
    if (gistRecovery === recovery) gistRecovery = null;
  });
  gistRecovery = recovery;
  return recovery;
}
async function findReplacedGist(staleId) {
  const saved = localStorage.getItem("sync-gist-id");
  if (saved && saved !== staleId) return saved; // another caller just moved this device
  const token = localStorage.getItem("sync-token");
  const gists = await gistApi("/gists?per_page=100");
  const hits = gists.filter((g) => g.files && g.files[GIST_FILENAME]);
  // A full page may be hiding another match
  if (gists.length >= 100 || hits.length !== 1 || hits[0].id === staleId) throw gistLostError();
  if (localStorage.getItem("sync-token") !== token) throw new Error("The sync token changed");
  labelBase();
  localStorage.setItem("sync-gist-id", hits[0].id);
  return hits[0].id;
}
// Runs work(gistId) on this device's gist, moving to the replacement once if the gist is gone
async function withGist(work) {
  const id = localStorage.getItem("sync-gist-id") || (await findOrCreateGist());
  try {
    return await work(id);
  } catch (e) {
    if (e.status !== 404) throw e;
    return work(await recoverGist(id));
  }
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
// only when both changed the very same field does this device's copy of it win.
// The gist is always re-read right before writing.
const SYNC_BASE_KEY = "sync-base";
const SYNC_BASE_GIST_KEY = "sync-base-gist"; // the gist that base describes
// base/local/remote are one list's parsed values, and this goes all the way down: budget-content is
// one object holding lists of expenses, and debts holding logs of payments. A list merges per item
// (adds and deletes from both sides, the other side's edits to items this side left alone), matching
// by id, or by the whole item in a list without ids. An object merges per field the same way. A value
// with nothing left to merge, changed on both sides, goes to this device. A missing base is an empty one.
const MERGE_WHOLE = new Set(["location"]); // fields that only mean something together: lat and lon are one place
function mergeLists(base, local, remote) {
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  if (same(local, remote)) return local;
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  if (Array.isArray(local) && Array.isArray(remote)) {
    const was = Array.isArray(base) ? base : [];
    const byId = [was, local, remote].every((l) => l.every((i) => i && typeof i === "object" && "id" in i));
    const key = byId ? (i) => i.id : (i) => JSON.stringify(i);
    const b = new Map(was.map((i) => [key(i), i])),
      r = new Map(remote.map((i) => [key(i), i]));
    const out = [];
    local.forEach((item) => {
      const k = key(item);
      const untouched = b.has(k) && same(item, b.get(k));
      if (!r.has(k)) {
        if (!untouched) out.push(item); // added here, or deleted there but edited here: keep the edit
      } else if (untouched)
        out.push(r.get(k)); // only they changed it
      else out.push(mergeLists(b.get(k), item, r.get(k)));
    });
    // added on the other device: insert after the item it followed there
    const kept = new Set(out.map(key));
    remote.forEach((item, idx) => {
      const k = key(item);
      if (b.has(k) || kept.has(k)) return;
      const prev = idx > 0 ? out.findIndex((x) => key(x) === key(remote[idx - 1])) : -1;
      out.splice(prev + 1, 0, item);
      kept.add(k);
    });
    return out;
  }
  if (isObj(local) && isObj(remote)) {
    const was = isObj(base) ? base : {};
    const out = { ...local };
    new Set([...Object.keys(was), ...Object.keys(remote)]).forEach((f) => {
      const l = local[f],
        r = remote[f],
        b = was[f];
      if (same(r, b)) return; // not changed there
      if (same(l, b)) {
        if (f in remote) out[f] = r;
        else delete out[f];
      } else if (f in local && f in remote && !MERGE_WHOLE.has(f)) out[f] = mergeLists(b, l, r);
    });
    // A debt's balance follows its log, so if both sides moved it, whatever merging added to this
    // device's log comes off too. Going by the log gets it right even when the base is out of date.
    const moved = (n) => typeof n === "number" && !same(n, was.balance);
    if (moved(local.balance) && moved(remote.balance) && Array.isArray(local.log) && Array.isArray(out.log)) {
      const paid = (log) => log.reduce((sum, e) => sum + (Number(e && e.amount) || 0), 0);
      out.balance = Math.max(0, Math.round((local.balance + paid(local.log) - paid(out.log)) * 100) / 100);
    }
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
// A gist file's text, or null if there's no such file. A truncated file is fetched from
// gist.githubusercontent.com only, and a failed fetch throws: callers that write back must not treat
// a file they couldn't read as an empty one.
async function readGistFile(file) {
  if (!file || typeof file !== "object") return null;
  if (!file.truncated) return typeof file.content === "string" ? file.content : null;
  const raw = safeUrl(file.raw_url);
  if (!raw || new URL(raw).hostname !== "gist.githubusercontent.com") throw new Error("Unexpected gist file link");
  const res = await fetch(raw);
  if (!res.ok) throw new Error("Couldn't read the gist file: " + res.status);
  return res.text();
}
async function fetchRemote(gistId) {
  const g = await gistApi("/gists/" + gistId);
  ingestBriefingFile(g.files && g.files[BRIEFING_FILENAME]); // Jarvis's read-only briefing rides along
  ingestReviewFile(g.files && g.files[REVIEWS_FILENAME]); // and so do the weekly reviews
  ingestCalendarFile(g.files && g.files[CALENDAR_FILENAME]); // and the calendar history for the Planner
  ingestAskFile(g.files && g.files[ASK_FILE]); // Ask Jarvis: questions from other devices, Clear history
  ingestAnswersFile(g.files && g.files[ANSWERS_FILE]); // and Jarvis's answers (read-only)
  const file = g.files && g.files[GIST_FILENAME];
  if (!file) return null; // nothing there yet: the only case where syncNow may fill it in
  // From here the file exists, so failing to read it must stop the sync: returning null would have
  // syncNow write this device's copy over the owner's data
  const text = await readGistFile(file);
  let p = null;
  try {
    p = JSON.parse(text);
  } catch (e) {}
  if (!p || typeof p !== "object" || !p.data || typeof p.data !== "object" || Array.isArray(p.data)) {
    const err = new Error("The gist file isn't sync data");
    err.badData = true;
    throw err;
  }
  return p;
}
async function syncNow() {
  if (!localStorage.getItem("sync-token")) return;
  // never swap data out from under an open edit form; try again shortly
  if (syncBusy || isEditing()) {
    scheduleSyncPush();
    return false;
  }
  syncBusy = true;
  const epoch = syncEpoch;
  const wasState = (document.getElementById("sync-btn") || { dataset: {} }).dataset.state;
  setSyncStatus("busy");
  try {
    const { gistId, remote } = await withGist(async (id) => ({ gistId: id, remote: await fetchRemote(id) }));
    if (epoch !== syncEpoch) return false; // turned off or reconnected meanwhile: this sync is over
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
    // A base from another gist says nothing about this one, so it's an empty one: each list merges item
    // by item and both sides' items survive (one deleted on either side may come back). With nothing to
    // tell whose change is whose, what both sides have goes to whichever copy was saved last, not to
    // whichever device syncs now.
    const baseGist = localStorage.getItem(SYNC_BASE_GIST_KEY);
    const otherGist = !!base && !!baseGist && baseGist !== gistId;
    if (otherGist) base = {};
    const localUpdated = Number(localStorage.getItem("data-updated-at")) || 0;
    const remoteUpdated = (remote && remote.updatedAt) || 0;
    let merged = {},
      takeRemote = [],
      sendUp = false;
    if (!base || !remote) {
      // First sync on this device (or the first since this kind of sync existed):
      // fall back to "newest copy wins", which is what earlier versions did.
      // A gist with no data file gets everything here, not just what changed since the base.
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
        if (l !== b && r !== undefined && l !== undefined && r !== b && l !== r) {
          // changed on both devices (or new on both): merge item by item
          const was = b === undefined ? null : JSON.parse(b);
          const theirsWins = otherGist && remoteUpdated > localUpdated;
          const m = JSON.stringify(
            theirsWins ? mergeLists(was, JSON.parse(r), JSON.parse(l)) : mergeLists(was, JSON.parse(l), JSON.parse(r)),
          );
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
    }
    // A form opened while the gist was being read: nothing has changed yet, so try again once it's closed
    if (takeRemote.length && isEditing()) {
      scheduleSyncPush();
      setSyncStatus(wasState || "off", true);
      return false;
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
    localStorage.setItem(SYNC_BASE_GIST_KEY, gistId);
    if (epoch !== syncEpoch) return false;
    setSyncStatus("ok");
    return true;
  } catch (e) {
    if (epoch !== syncEpoch) return false;
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
    showToast(syncErrorText(e, "Sync failed — will retry when you're back online"), true);
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
