// jazz3.js - Jazz 3.0 plan: goal sections beyond fitness.
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- JAZZ 3.0 PLAN ----------
// Goal areas beyond fitness (Glow, Leadership…): each is a section of the
// Jazz 3.0 tab holding a checklist of items with a short note. One synced list:
//   plan3-content: [{id, cat, item, note, done?}]
const DEFAULT_PLAN3 = [
  ["Glow", "Night serum", "PM, three nights a week"],
  ["Glow", "Daily floss", "Any brand"],
  ["Glow", "Lip balm (AM/PM)", "SPF 30"],
  ["Glow", "Book a checkup", "Every 6–8 weeks"],
  ["Glow", "Hand cream", "Nightly"],
  ["Glow", "Weekly self-care", ""],
  ["Glow", "Morning routine", "AM"],
  ["Leadership", "Join a speaking club", "Check for a local club"],
  ["Leadership", "Blazer", "Structured"],
  ["Leadership", "Work pants", ""],
  ["Leadership", "Read a leadership book", "Any author"],
].map(([cat, item, note], i) => ({id:`p3-${i + 1}`, cat, item, note})); // fixed ids, so two devices agree
let plan3 = [];
const PLAN3_ICONS = {
  glow:'<path d="M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15.4l-1.6-4.6L6 9.2l4.4-1.6z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"/>',
  leadership:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
};
const plan3Slug = cat => String(cat).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "goals";
function plan3Icon(cat){ return KIND_SVG(PLAN3_ICONS[plan3Slug(cat)] || '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'); }
function normalizePlan3(){
  plan3 = (Array.isArray(plan3) ? plan3 : []).filter(x => x && typeof x === "object" && String(x.item || "").trim()).map(x => ({
    id:safeId(x.id, "p3"), cat:String(x.cat || "Goals").trim().slice(0, 30) || "Goals", item:String(x.item).trim().slice(0, 80),
    note:String(x.note || "").slice(0, 160), ...(x.done ? {done:true} : {})}));
}
function plan3Cats(){ return [...new Set(plan3.map(x => x.cat))]; }
function savePlan3(){ saveContent("plan3-content", plan3, {toast:false}); renderFitness(); }
function togglePlan3(id){
  const x = plan3.find(p => p.id === id);
  if (!x) return;
  if (x.done) delete x.done; else x.done = true;
  savePlan3();
}
function editPlan3(id, cat = ""){
  const x = id ? plan3.find(p => p.id === id) : null;
  const cats = plan3Cats(), NEW = "New section…";
  openModal(x ? "Edit item" : "Add item", [
    {key:"item", label:"Item", type:"text"},
    {key:"note", label:"Note (optional)", type:"text"},
    {key:"cat", label:"Section", type:"select", options:[...cats, NEW]},
    {key:"newcat", label:"New section name (if adding one)", type:"text"},
  ], x ? {item:x.item, note:x.note, cat:x.cat} : {cat:cat || (cats.length ? cats[0] : NEW)},
    v => {
      const item = (v.item || "").trim().slice(0, 80);
      if (!item) return;
      const c = v.cat === NEW || !cats.length ? (v.newcat || "").trim().slice(0, 30) : v.cat;
      if (!c){ showToast("Name the new section", true); return; }
      const t = x || {id:genId("p3")};
      t.item = item; t.note = (v.note || "").trim().slice(0, 160); t.cat = c;
      if (!x) plan3.push(t);
      openPinned.add("p3-" + plan3Slug(c));
      savePlan3();
    },
    x ? () => { plan3 = plan3.filter(p => p.id !== id); savePlan3(); } : null);
}
const seenPlan3Cards = new Set(); // a section's card starts open the first time it's shown
// Banner at the top of Jazz 3.0: a chip per section that jumps to it
function j3HeroHtml(s){
  const chips = [];
  if (s.goal != null && s.start != null) chips.push(["weight-card", "Weight", (s.reached ? 100 : s.pct) + "%"]);
  plan3Cats().forEach(cat => {
    const list = plan3.filter(x => x.cat === cat);
    chips.push(["p3-" + plan3Slug(cat), escapeHtml(cat), `${list.filter(x => x.done).length}/${list.length}`]);
  });
  return `<div class="j3-hero"><h2>Jazz 3.0</h2><p>Your next chapter</p>
    <div class="j3-chips">${chips.map(([id, name, val]) => `<button class="j3-chip" data-action="j3-jump" data-target="${escapeAttr(id)}">${name}<b>${val}</b></button>`).join("")}</div></div>`;
}
function jumpToJ3(id){
  if (!openPinned.has(id)){ openPinned.add(id); renderFitness(); }
  document.getElementById(id)?.scrollIntoView({behavior:"smooth", block:"start"});
}
function plan3SectionsHtml(){
  let html = "";
  plan3Cats().forEach((cat, ci) => { // the add button names its section by position, so no name lands in code
    const id = "p3-" + plan3Slug(cat), list = plan3.filter(x => x.cat === cat);
    if (!seenPlan3Cards.has(id)){ seenPlan3Cards.add(id); openPinned.add(id); }
    const doneN = list.filter(x => x.done).length;
    const rows = list.map(x => `<div class="p3-row ${x.done ? "done" : ""}" data-sort-id="${x.id}">
        <button class="todo-check" role="checkbox" aria-checked="${!!x.done}"         aria-label="${x.done ? "Not done" : "Done"}: ${escapeAttr(x.item)}" data-action="plan3-toggle" data-plan3-id="${escapeAttr(x.id)}"><span class="box">${BOX_CHECK_SVG}</span></button>
                <button class="p3-body" data-action="plan3-edit" data-plan3-id="${escapeAttr(x.id)}"><b>${escapeHtml(x.item)}</b>${x.note ? `<i>${escapeHtml(x.note)}</i>` : ""}</button>
      </div>`).join("");
    html += collapsibleCard({id, title:`<span class="p3-title">${plan3Icon(cat)}${escapeHtml(cat)}</span>`, insight:`${doneN}/${list.length} done`,
      body:`<div class="p3-list">${rows}</div>      <button class="add-row" data-action="plan3-add" data-cat-index="${ci}">+ Add item</button>`});
  });
        return html + `<button class="add-row p3-new" data-action="plan3-new-section">+ New section</button>`;
}

