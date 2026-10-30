// backup.js - Manual backup download/restore.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- BACKUP ----------
// One JSON file holding every synced key. Works with or without gist sync, so
// it doubles as a manual way to move data between devices.
async function downloadBackup() {
  // Live values, not just what's in localStorage: a list still on its built-in
  // defaults has no stored key, and a backup missing it wouldn't fully replace
  // a device where that list was customized.
  const data = liveData();
  const payload = { app: "jazz2", version: 1, exportedAt: new Date().toISOString(), data };
  return saveBackupFile(payload);
}
// Every synced list as it is in memory (lists still on their defaults have no
// stored key, so localStorage alone isn't the full picture)
function liveData() {
  return {
    "skin-rules-content": skinRules,
    "skin-routine-content": skinRoutine,
    "routine-checks": routineChecks,
    "style-rules-content": styleRules,
    "sizes-content": sizes,
    "capsule-content": capsule,
    "wants-content": wantsList,
    "todo-content": todoList,
    "todo-archive-content": loadContent("todo-archive-content", []),
    "style-state": styleState,
    "wants-state": wantsState,
    "bills-content": bills,
    "bill-payments": billPayments,
    "budget-content": budget,
    "fitness-content": fitness,
    "plan3-content": plan3,
  };
}
async function saveBackupFile(payload) {
  const name = `jazz2-backup-${isoDate(new Date())}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  // Installed iOS PWAs handle <a download> poorly; the share sheet offers "Save to Files"
  const file = new File([blob], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Jazz backup" });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function restoreBackup() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    let payload;
    try {
      payload = JSON.parse(await f.text());
    } catch (e) {
      showToast("That file isn't a valid backup", true);
      return;
    }
    const data = payload && payload.app === "jazz2" && payload.data;
    if (!data || !Object.keys(data).some((k) => SYNC_KEYS.includes(k))) {
      showToast("That file isn't a Jazz backup", true);
      return;
    }
    const when = payload.exportedAt
      ? new Date(payload.exportedAt).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "an unknown date";
    if (
      !confirm(
        `Replace everything on this device with the backup from ${when}? If sync is on, your other device will get it too.`,
      )
    )
      return;
    closeModal();
    // "Replace everything": lists the backup doesn't have (e.g. one made before
    // Budget existed) go back to their defaults instead of keeping this device's
    SYNC_KEYS.forEach((k) => {
      if (!(k in data)) localStorage.removeItem(k);
    });
    // A restore is a deliberate edit: stamp it now so sync pushes it out
    applyRemote({ updatedAt: Date.now(), data });
    scheduleSyncPush();
    showToast("Backup restored");
  };
  input.click();
}
function openSyncModal() {
  const connected = !!localStorage.getItem("sync-token");
  openModal(
    "Sync & backup",
    [
      {
        type: "note",
        label: `Syncs everything (to-dos, routines, shopping, budget) through a private gist on
      your GitHub account. Create a <b>classic</b> personal access token with only the
      <b>gist</b> scope at github.com &rsaquo; Settings &rsaquo; Developer settings &rsaquo; Tokens (classic),
      then paste the same token into the app on each device. Newest change wins when
      two devices disagree.`,
      },
      { key: "token", label: "GitHub token", type: "password" },
      {
        type: "note",
        label: `<span class="modal-section">Backup</span>
      Save everything to one file, or restore from one. Works with or without sync.
      <span class="backup-actions">
        <button type="button" class="backup-btn" data-action="backup-download">Download backup</button>
        <button type="button" class="backup-btn" data-action="backup-restore">Restore…</button>
      </span>`,
      },
    ],
    { token: localStorage.getItem("sync-token") || "" },
    (v) => {
      if (!v.token) return; // closing without a token (e.g. after a backup) is fine
      localStorage.setItem("sync-token", v.token);
      localStorage.removeItem("sync-gist-id"); // re-resolve under the (possibly new) account
      localStorage.removeItem(SYNC_BASE_KEY);
      showToast("Connecting…");
      pullSync()
        .then(() => showToast("Sync is on"))
        .catch(() => showToast("Couldn't connect — check the token", true));
    },
    connected
      ? () => {
          localStorage.removeItem("sync-token");
          localStorage.removeItem("sync-gist-id");
          localStorage.removeItem(SYNC_BASE_KEY);
          setSyncStatus("off");
          showToast("Sync turned off");
        }
      : null,
    {
      label: "Turn off",
      confirm: "Turn off sync on this device? Your data stays on the device and in the gist.",
      noUndo: true,
    },
  );
}
function initSync() {
  if (localStorage.getItem("sync-token")) {
    pullSync().catch(() => {});
  } else {
    setSyncStatus("off");
  }
  // Re-pull when the app regains foreground — the phone-edits-then-desktop case.
  // Also a natural moment to expire old completed to-dos in long-lived sessions.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    checkDayChange();
    if (archiveOldTodos()) renderHome();
    pullSync().catch(() => {});
  });
}
