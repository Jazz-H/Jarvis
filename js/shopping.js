// shopping.js - Shopping tab: wardrobe items and wants list.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- wardrobe items on the shopping list ----------
// Clothes to buy live on the shopping list, tagged with a wardrobe category
// (`wardrobeCat`). (The closet view was removed; its data — capsule, sizes, fit
// rules — is still loaded, synced and backed up, just not shown.)
const WANT_CAT_OPTIONS = ["General", "Moto", ...CAP_CATS.map((c) => "Wardrobe · " + c), "Wardrobe · Other"];
const DEFAULT_BELT_META = "Pending: merge with wardrobe belt? Price/link not locked in";
// Older data kept a separate "Still need" list inside the capsule (state
// "needed", or toggled via style-state). Move those onto Wants. Ids are derived
// ("w-" + capsule id) so every device migrates to the same result; housekeeping,
// so it saves quietly like the other migrations.
function migrateWardrobeNeeds() {
  const stateOf = (item) =>
    styleState[item.id] !== undefined
      ? styleState[item.id]
      : item.state === "owned" || item.state === "pending"
        ? "owned"
        : "needed";
  const moved = capsule.filter((item) => stateOf(item) !== "owned");
  const stale = Object.keys(styleState).length > 0;
  if (!moved.length && !stale) return false;
  capsule.forEach((item) => {
    if (stateOf(item) === "owned" && item.state === "needed") item.state = "owned";
  });
  capsule = capsule.filter((item) => stateOf(item) === "owned");
  moved.forEach((item) => {
    // The original data listed the brown belt twice (wardrobe + wants); fold them together
    if (item.id === "need-belt-brown") {
      const twin = wantsList.find((w) => w.id === "belt-brown");
      if (twin) {
        if (!twin.wardrobeCat) twin.wardrobeCat = item.cat || "Accessories";
        if (twin.meta === DEFAULT_BELT_META) twin.meta = "Price/link not locked in";
        return;
      }
    }
    const id = "w-" + item.id;
    if (wantsList.some((w) => w.id === id)) return;
    const w = {
      id,
      name: item.title,
      meta: item.sub || "",
      price: item.price ?? null,
      link: item.link || null,
      wardrobeCat: item.cat || "Other",
    };
    if (item.estimated) w.estimated = true;
    wantsList.push(w);
  });
  styleState = {};
  writeQuietly("capsule-content", capsule);
  writeQuietly("wants-content", wantsList);
  writeQuietly("style-state", styleState);
  return true;
}
let wantsFilter = "all";
// Money summary for a list where some items may have no price yet. Each total
// appears once: a complete sum goes in the card-header badge (visible even when
// the card is collapsed); a partial sum goes in an in-card row labeled as
// partial so it never reads as the full cost; no prices at all shows nothing.
function priceSummary(items) {
  const priced = items.filter((i) => i.price != null);
  const sum = priced.reduce((s, i) => s + i.price, 0);
  const missing = items.length - priced.length;
  const full = priced.length > 0 && missing === 0;
  return {
    badge: full ? ` · $${fmtMoney(sum)}` : "",
    row:
      priced.length && !full
        ? `<div class="total-row">Known prices · ${missing} unpriced <span>$${fmtMoney(sum)}</span></div>`
        : "",
  };
}
// ---------- RENDER: WANTS ----------
function fmtMoney(n) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Category is one of: General, Moto (motorcycle gear, `moto: true`), or a
// wardrobe category (`wardrobeCat`) — mutually exclusive.
function setWantCategory(w, choice) {
  delete w.wardrobeCat;
  delete w.moto;
  if (choice === "Moto") w.moto = true;
  else if (choice && choice.startsWith("Wardrobe · ")) w.wardrobeCat = choice.slice("Wardrobe · ".length);
}
function wantCategoryChoice(w) {
  return w.wardrobeCat ? "Wardrobe · " + w.wardrobeCat : w.moto ? "Moto" : "General";
}
// Every item is a "need" or a "want". Unless set explicitly, wardrobe items
// (which came from the old "still need" list) count as needs, everything else as wants.
function wantKind(w) {
  return w.kind === "need" || w.kind === "want" ? w.kind : w.wardrobeCat ? "need" : "want";
}
// High priority first, then needs before wants, then cheapest; unpriced last.
function wantsOrder(a, b) {
  return (
    (b.priority === "high") - (a.priority === "high") ||
    (wantKind(a) === "need" ? 0 : 1) - (wantKind(b) === "need" ? 0 : 1) ||
    (a.price ?? Infinity) - (b.price ?? Infinity)
  );
}
function renderWants() {
  const el = document.getElementById("panel-wants");
  let pending = "",
    done = "";
  const inFilter = (w) =>
    wantsFilter === "all" ||
    (wantsFilter === "wardrobe" ? !!w.wardrobeCat : wantsFilter === "moto" ? !!w.moto : wantKind(w) === wantsFilter);
  // "Later" items leave To buy (and its counts) for a folded Later card
  const allPending = wantsList.filter((w) => !wantsState[w.id] && !w.later);
  const laterItems = wantsList.filter((w) => !wantsState[w.id] && w.later).sort(wantsOrder);
  const pendingItems = allPending.filter(inFilter).sort(wantsOrder);
  const doneItems = wantsList.filter((w) => !!wantsState[w.id] && inFilter(w)).sort(wantsOrder);
  const pendingSum = priceSummary(pendingItems),
    doneSum = priceSummary(doneItems);
  const wantRow = (w, isDone, isLater = false) => {
    const priceStr =
      w.price != null ? `${w.estimated ? "~" : ""}$${fmtMoney(w.price)}${w.estimated ? " (est.)" : ""}` : "—";
    const linkLine = linkHtml(w.link, 'class="link"', "View product →");
    // bought is a tick box, like to-dos (Later items get theirs back with Back to list)
    const check = isLater
      ? ""
      : `<button class="todo-check" role="checkbox" aria-checked="${isDone}" aria-label="${isDone ? "Not bought" : "Bought"}: ${escapeAttr(w.name)}" data-action="want-toggle" data-want-id="${escapeAttr(w.id)}"><span class="box">${BOX_CHECK_SVG}</span></button>`;
    return `<div class="want-card${isDone ? " bought" : ""}">
        ${check}
        <div class="body" role="button" tabindex="0" aria-label="Edit ${escapeAttr(w.name)}" data-action="want-edit" data-want-id="${escapeAttr(w.id)}">
          <div class="name">${escapeHtml(w.name)} <span class="badges"><span class="badge kind-${wantKind(w)}">${wantKind(w) === "need" ? "Need" : "Want"}</span>${w.priority === "high" && !isDone ? '<span class="badge high">High</span>' : ""}</span></div>
          ${w.wardrobeCat ? `<div class="want-tag">${SHIRT_ICON}Wardrobe · ${escapeHtml(w.wardrobeCat)}</div>` : ""}
          ${w.moto ? `<div class="want-tag moto">${MOTO_ICON}Moto</div>` : ""}
          ${w.meta ? `<div class="meta">${escapeHtml(w.meta)}</div>` : ""}
          ${w.price != null ? `<div class="price">${priceStr}</div>` : ""}
          ${linkLine}
        </div>
        ${
          isDone
            ? ""
            : `<div class="want-actions">${
                isLater
                  ? `<button class="later-chip" data-action="want-later" data-want-id="${escapeAttr(w.id)}" data-later="false" aria-label="Move ${escapeAttr(w.name)} back to the list">Back to list</button>`
                  : `<button class="later-chip" data-action="want-later" data-want-id="${escapeAttr(w.id)}" data-later="true" aria-label="Save ${escapeAttr(w.name)} for later">${LATER_ICON}Later</button>`
              }</div>`
        }
      </div>`;
  };
  pendingItems.forEach((w) => {
    pending += wantRow(w, false);
  });
  doneItems.forEach((w) => {
    done += wantRow(w, true);
  });
  let html = "";
  const chip = (key, label, n) =>
    `<button class="filter-chip ${wantsFilter === key ? "on" : ""}" aria-pressed="${wantsFilter === key}" data-action="wants-filter" data-filter="${key}"><span class="fc-label">${label}</span><span class="fc-count">${n}</span></button>`;
  html += `<div class="filter-chips">
      ${chip("all", "All", allPending.length)}
      ${chip("need", "Needs", allPending.filter((w) => wantKind(w) === "need").length)}
      ${chip("want", "Wants", allPending.filter((w) => wantKind(w) === "want").length)}
      ${chip("wardrobe", "Wardrobe", allPending.filter((w) => w.wardrobeCat).length)}
      ${chip("moto", "Moto", allPending.filter((w) => w.moto).length)}
    </div>`;
  html += collapsibleCard({
    id: "wants-pending-card",
    title: "To buy",
    insight: `${pendingItems.length}${pendingSum.badge}`,
    body: `
        ${
          pending ||
          (wantsFilter === "all"
            ? '<div class="empty">All caught up.</div>'
            : `<div class="empty">Nothing here in this filter. <button class="link-btn" data-action="wants-filter" data-filter="all">Show all</button></div>`)
        }
        ${pendingSum.row}`,
  });
  if (laterItems.length) {
    const laterSum = priceSummary(laterItems);
    html += collapsibleCard({
      id: "wants-later-card",
      title: "Later",
      insight: `${laterItems.length}${laterSum.badge}`,
      body: `
        <p class="later-note">Saved for later. They're off To buy until you bring them back.</p>
        ${laterItems.map((w) => wantRow(w, false, true)).join("")}
        ${laterSum.row}`,
    });
  }
  html += collapsibleCard({
    id: "wants-purchased-card",
    title: "Purchased",
    insight: doneItems.length ? doneItems.length + doneSum.badge : "None yet",
    body: `
        ${done || '<div class="empty">Nothing marked yet.</div>'}
        ${doneSum.row}`,
  });
  const prevScroll = el.querySelector(".filter-chips")?.scrollLeft || 0;
  el.innerHTML = html;
  const row = el.querySelector(".filter-chips"),
    active = row && row.querySelector(".filter-chip.on");
  if (row) {
    row.scrollLeft = prevScroll;
    if (active) {
      const r = row.getBoundingClientRect(),
        a = active.getBoundingClientRect();
      if (a.left < r.left + 16) row.scrollLeft -= r.left + 16 - a.left;
      else if (a.right > r.right - 28) row.scrollLeft += a.right - (r.right - 28);
    }
  }
}
function setWantLater(id, on) {
  const w = wantsList.find((x) => x.id === id);
  if (!w) return;
  if (on) w.later = true;
  else delete w.later;
  saveContent("wants-content", wantsList, { toast: false });
  renderWants();
  renderHomePanel();
  showUndoToast(on ? `${w.name} saved for later` : `${w.name} is back on the list`, () => {
    const cur = wantsList.find((x) => x.id === id);
    if (!cur) return;
    if (on) delete cur.later;
    else cur.later = true;
    saveContent("wants-content", wantsList, { toast: false });
    renderWants();
    renderHomePanel();
  });
}
async function toggleWant(id) {
  wantsState[id] = !wantsState[id];
  const w = wantsList.find((x) => x.id === id);
  renderWants();
  saveContent("wants-state", wantsState);
}
function editWant(id) {
  const w = wantsList.find((x) => x.id === id);
  openModal(
    "Edit item",
    [
      { key: "name", label: "Name", type: "text" },
      { key: "meta", label: "Notes (optional)", type: "text" },
      { key: "price", label: "Price", type: "number", step: "0.01" },
      { key: "link", label: "Link (optional)", type: "url" },
      { key: "estimated", label: "Estimated price", type: "checkbox" },
      { key: "kind", label: "Need or want", type: "select", options: ["Need", "Want"] },
      { key: "high", label: "High priority", type: "checkbox" },
      { key: "later", label: "Later (hide it from To buy for now)", type: "checkbox" },
      { key: "cat", label: "Category", type: "select", options: WANT_CAT_OPTIONS },
    ],
    {
      name: w.name,
      meta: w.meta || "",
      price: w.price,
      link: w.link || "",
      estimated: !!w.estimated,
      high: w.priority === "high",
      later: !!w.later,
      kind: wantKind(w) === "need" ? "Need" : "Want",
      cat: wantCategoryChoice(w),
    },
    (v) => {
      if (!v.name) return;
      w.name = v.name;
      w.meta = v.meta || "";
      w.price = v.price;
      w.link = v.link || null;
      w.estimated = v.estimated;
      if (v.high) w.priority = "high";
      else delete w.priority;
      if (v.later) w.later = true;
      else delete w.later;
      setWantCategory(w, v.cat);
      w.kind = v.kind === "Need" ? "need" : "want";
      saveContent("wants-content", wantsList);
      renderWants();
      renderHomePanel();
    },
    () => {
      wantsList = wantsList.filter((x) => x.id !== id);
      delete wantsState[id];
      saveContent("wants-content", wantsList);
      saveContent("wants-state", wantsState);
      renderWants();
      renderHomePanel();
    },
  );
}
