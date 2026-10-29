// sync.js - Optional cross-device sync through a private GitHub Gist.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- GIST SYNC ----------
// Optional cross-device sync through a private GitHub Gist. The gist holds one
// JSON file with every content/state key plus an updatedAt stamp; conflicts are
// merged per list (see syncNow). Requires a classic PAT with only the `gist`
// scope (fine-grained tokens can't use the Gist API), pasted once per device
// via the cloud button in the header. Token + gist id live in localStorage and
// are never synced themselves.
const SYNC_KEYS = ["skin-rules-content","skin-routine-content","routine-checks","skin-days-content","style-rules-content","sizes-content",
                   "capsule-content","wants-content","todo-content","todo-archive-content",
                   "style-state","wants-state","bills-content","bill-payments","budget-content","fitness-content","plan3-content"];
const GIST_FILENAME = "jazz2-data.json";
let syncPushTimer = null;
let syncBusy = false;

function markDataChanged(){
  localStorage.setItem("data-updated-at", String(Date.now()));
  scheduleSyncPush();
}
function setSyncStatus(state){
  const btn = document.getElementById("sync-btn");
  if (btn) btn.dataset.state = state;
}
async function gistApi(path, opts = {}){
  const res = await fetch("https://api.github.com" + path, {
    ...opts,
    headers:{
      "Authorization": "Bearer " + localStorage.getItem("sync-token"),
      "Accept": "application/vnd.github+json",
      ...(opts.headers || {})
    }
  });
  if (!res.ok) throw new Error("GitHub API " + res.status + " on " + path);
  return res.json();
}
function collectLocal(){
  const data = {};
  SYNC_KEYS.forEach(k => {
    const raw = localStorage.getItem(k);
    if (raw != null){ try{ data[k] = JSON.parse(raw); }catch(e){} }
  });
  return {updatedAt: Number(localStorage.getItem("data-updated-at")) || 0, data};
}
function applyRemote(payload){
  SYNC_KEYS.forEach(k => {
    if (payload.data && k in payload.data) localStorage.setItem(k, JSON.stringify(payload.data[k]));
  });
  // Data from an older app version (or an old backup) has per-day skin lists but
  // no merged routine: drop the local routine so it's rebuilt from those lists
  if (payload.data && "skin-days-content" in payload.data && !("skin-routine-content" in payload.data)){
    localStorage.removeItem("skin-routine-content");
  }
  localStorage.setItem("data-updated-at", String(payload.updatedAt || Date.now()));
  loadAllContent();
  styleState = loadState("style-state");
  wantsState = loadState("wants-state");
  migrateWardrobeNeeds(); // data from an older app version may still have a wardrobe "Still need" list
  archiveOldTodos(); // the other device may have carried expired completed items
  renderSkin(); renderWants(); renderBudget(); renderFitness(); renderHome();
}
async function findOrCreateGist(){
  const gists = await gistApi("/gists?per_page=100");
  const hit = gists.find(g => g.files && g.files[GIST_FILENAME]);
  let id = hit && hit.id;
  if (!id){
    const created = await gistApi("/gists", {method:"POST", body: JSON.stringify({
      description:"Jazz 2.0 app data (auto-sync)", public:false,
      files:{[GIST_FILENAME]:{content: JSON.stringify(collectLocal())}}
    })});
    id = created.id;
  }
  localStorage.setItem("sync-gist-id", id);
  return id;
}
function scheduleSyncPush(){
  if (!localStorage.getItem("sync-token")) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(() => pushSync().catch(() => {}), 1500);
}
// Sync is a three-way merge per list (each SYNC_KEYS entry). "sync-base" keeps
// every list as it was at the last successful sync. A list this device changed
// since then is sent up; a list only the other device changed is taken from
// the gist. If both changed the same list, this device's copy wins for that
// list only, so edits to different lists on two devices never clobber each
// other. The gist is always re-read right before writing.
const SYNC_BASE_KEY = "sync-base";
function isEditing(){
  return document.getElementById("modal-backdrop").classList.contains("open")
    || document.getElementById("composer").classList.contains("open");
}
function localSnapshot(){
  const out = {};
  SYNC_KEYS.forEach(k => {
    const raw = localStorage.getItem(k);
    if (raw != null){ try{ out[k] = JSON.stringify(JSON.parse(raw)); }catch(e){} }
  });
  return out;
}
async function fetchRemote(gistId){
  const g = await gistApi("/gists/" + gistId);
  const file = g.files && g.files[GIST_FILENAME];
  if (!file) return null;
  const text = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
  try{ const p = JSON.parse(text); return p && typeof p === "object" && p.data && typeof p.data === "object" ? p : null; }catch(e){ return null; }
}
async function syncNow(){
  if (!localStorage.getItem("sync-token")) return;
  // never swap data out from under an open edit form; try again shortly
  if (syncBusy || isEditing()){ scheduleSyncPush(); return; }
  syncBusy = true; setSyncStatus("busy");
  try{
    const gistId = localStorage.getItem("sync-gist-id") || await findOrCreateGist();
    const remote = await fetchRemote(gistId);
    const local = localSnapshot();
    const remoteStr = {};
    if (remote) Object.entries(remote.data).forEach(([k, v]) => { remoteStr[k] = JSON.stringify(v); });
    let baseRaw = localStorage.getItem(SYNC_BASE_KEY), base = null;
    try{ base = baseRaw ? JSON.parse(baseRaw) : null; }catch(e){ base = null; }
    let merged = {}, takeRemote = [], sendUp = false;
    if (!base){
      // First sync on this device (or the first since this kind of sync existed):
      // fall back to "newest copy wins", which is what earlier versions did
      const localUpdated = Number(localStorage.getItem("data-updated-at")) || 0;
      const remoteUpdated = (remote && remote.updatedAt) || 0;
      if (remote && remoteUpdated > localUpdated){ merged = {...remoteStr}; takeRemote = Object.keys(remoteStr); }
      else { merged = {...local}; sendUp = true; }
    } else {
      new Set([...SYNC_KEYS, ...Object.keys(remoteStr)]).forEach(k => {
        const l = local[k], r = remoteStr[k], b = base[k];
        if (l !== b){ if (l !== undefined) merged[k] = l; if (l !== r) sendUp = true; }        // changed here
        else if (r !== undefined){ merged[k] = r; if (r !== l) takeRemote.push(k); }           // unchanged here
      });
      if (!remote) sendUp = true;
    }
    if (takeRemote.length){
      const data = {};
      takeRemote.forEach(k => { data[k] = JSON.parse(merged[k]); });
      applyRemote({updatedAt:(remote && remote.updatedAt) || Date.now(), data});
      showToast("Synced from your other device");
    }
    if (sendUp){
      const data = {};
      Object.entries(merged).forEach(([k, v]) => { data[k] = JSON.parse(v); });
      const updatedAt = Math.max(Date.now(), (remote && remote.updatedAt) || 0);
      await gistApi("/gists/" + gistId, {method:"PATCH", body: JSON.stringify({
        files:{[GIST_FILENAME]:{content: JSON.stringify({updatedAt, data})}}
      })});
      localStorage.setItem("data-updated-at", String(updatedAt));
    }
    localStorage.setItem(SYNC_BASE_KEY, JSON.stringify(merged));
    setSyncStatus("ok");
  }catch(e){
    console.error("sync failed", e);
    setSyncStatus("error");
    throw e;
  }finally{
    syncBusy = false;
  }
}
async function pushSync(){
  try{ await syncNow(); }
  catch(e){ showToast("Sync failed — will retry on next change", true); throw e; }
}
function pullSync(){ return syncNow(); }
