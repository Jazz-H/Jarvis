// Regression suite for Jazz 2.0. Drives the real app in headless Chromium.
//
//   npm install && npx playwright install chromium   (once)
//   npm test
//
// Set CHROMIUM_PATH to use an existing Chromium binary instead of Playwright's.
// Serves the repo root on a random local port; no other setup needed.
import { chromium, devices } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };

const server = http.createServer(async (req, res) => {
  try {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(ROOT)) throw new Error("outside root");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const APP = `http://127.0.0.1:${server.address().port}/jazz2.0.html`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const failures = [];
let passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; return; }
  failures.push(`${name}${detail === undefined ? "" : ` — got ${JSON.stringify(detail)}`}`);
}
const isoOffset = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// A fresh browser profile seeded with localStorage, plus a JS-error collector.
async function openApp({ seed = {}, phone = true, query = "", route } = {}) {
  const ctx = await browser.newContext(phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1280, height: 800 } });
  if (route) await ctx.route("https://api.github.com/**", route);
  await ctx.addInitScript(s => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  }, seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.goto(APP + query);
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}
function addMonthsLocal(k) { const [y, m] = k.split("-").map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; }
async function section(name, fn) {
  const before = failures.length;
  try { await fn(); } catch (e) { failures.push(`${name}: threw ${e.message.split("\n")[0]}`); }
  console.log(`${failures.length === before ? "ok  " : "FAIL"}  ${name}`);
}

await section("every tab renders without JS errors (phone + desktop)", async () => {
  for (const phone of [true, false]) {
    const { ctx, page, errors } = await openApp({ phone });
    for (const tab of ["home", "todo", "skin", "wants", "budget"]) {
      await page.evaluate(t => activateTab(t), tab);
      check(`headline for ${tab}`, (await page.textContent("#headline")).length > 0);
    }
    check(`no JS errors (${phone ? "phone" : "desktop"})`, errors.length === 0, errors);
    await ctx.close();
  }
});

await section("to-do: legacy weekday migration, date parsing, completion + undo, edit", async () => {
  const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const { ctx, page, errors } = await openApp({ query: "?tab=todo", seed: {
    "data-updated-at": "111",
    "todo-content": [
      { id: "a", text: "Renew registration", done: false, day: todayName, starred: false, subitems: [], completedAt: null },
      { id: "b", text: "Return package", done: false, day: null, starred: false, subitems: [], completedAt: null },
    ],
  }});
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-content")));
  check("weekday migrates to today's date", stored[0].due === isoOffset(0) && !("day" in stored[0]), stored[0]);
  check("migration does not bump the sync timestamp", (await page.evaluate(() => localStorage.getItem("data-updated-at"))) === "111");

  // composer: the floating + button opens it; it stays open for several adds
  await page.tap("#fab");
  check("+ opens the composer with the text box focused",
    await page.evaluate(() => document.getElementById("composer").classList.contains("open") && document.activeElement.id === "composer-text"));
  await page.fill("#composer-text", "Call mom tomorrow");
  check("typed day lights up its chip", ((await page.textContent("#composer-chips .filter-chip.on")) || "").includes("Tomorrow"));
  await page.press("#composer-text", "Enter");
  check("Enter adds and keeps the composer open for the next one",
    await page.evaluate(() => document.getElementById("composer").classList.contains("open") && document.getElementById("composer-text").value === ""));
  check("added counter names the date", (await page.textContent("#composer-count")) === "1 added · last for Tomorrow", await page.textContent("#composer-count"));
  await page.fill("#composer-text", "Plan for friday");
  await page.click("#composer-chips .filter-chip.on");          // tap the lit chip: keep the words, no date
  await page.press("#composer-text", "Enter");
  await page.fill("#composer-text", "Pay rent");
  await page.click("#composer-chips .filter-chip >> text=Today");
  await page.click("#composer-chips .filter-chip >> text=Star");
  await page.click("#composer-chips .filter-chip >> text=Sub-items");
  await page.fill("#composer-subs", "log in\ntransfer");
  await page.click(".composer-add");
  await page.click(".composer-add");                              // empty: no-op, refocuses
  const added = await page.evaluate(() => todoList.map(t => [t.text, t.due, t.starred, (t.subitems || []).length]));
  check("trailing day word is parsed", added.some(([t, d]) => t === "Call mom" && d === isoOffset(1)), added);
  check("dismissed chip keeps text and no date", added.some(([t, d]) => t === "Plan for friday" && d === null), added);
  check("chips set date, star, and sub-items", added.some(([t, d, st, n]) => t === "Pay rent" && d === isoOffset(0) && st && n === 2), added);
  check("empty Add creates nothing", added.length === 5, added.length);
  check("to-dos are capped at 200 characters", (await page.getAttribute("#composer-text", "maxlength")) === "200");
  await page.keyboard.press("Escape");
  check("Esc closes the composer", await page.evaluate(() => !document.getElementById("composer").classList.contains("open")));

  await page.tap('[data-todo-id="b"] .title');
  check("tapping text opens edit, does not complete", (await page.textContent("#modal-heading")) === "Edit to-do");
  check("sub-items fold away until asked for", !(await page.isVisible("#modal-subs")));
  await page.click("#modal-body .tde-subs-toggle");
  await page.fill("#modal-subs", "print label\ndrop off");
  await page.focus("#modal-text");
  await page.keyboard.press("Enter");
  const b = await page.evaluate(() => todoList.find(t => t.id === "b"));
  check("edit adds sub-items and Enter saves", !b.done && b.subitems.length === 2, b);

  // When chips: Anytime / Today / Tomorrow / a date
  await page.evaluate(() => { const t = todoList.find(t => t.id === "b"); t.due = addDaysIso(3); editTodo("b"); });
  check("dated to-do: its date chip is on, Anytime off", await page.evaluate(() => !!document.querySelector("#tde .tde-date.on") && !document.querySelector('#tde .filter-chip.on[aria-pressed="true"]')?.textContent.includes("Anytime")));
  await page.click("#tde .filter-chip >> text=Anytime");
  check("Anytime hides the multi-day option", !(await page.$("#tde .tde-span")));
  await page.click("#modal-backdrop .modal-btn.primary");
  check("saved as Anytime: no date", await page.evaluate(() => todoList.find(t => t.id === "b").due === null));
  await page.evaluate(() => editTodo("b"));
  check("undated to-do opens with Anytime on", (await page.textContent('#tde .filter-chip[aria-pressed="true"]')) === "Anytime");
  await page.click("#tde .filter-chip >> text=Tomorrow");
  check("summary reads the choice back", (await page.textContent("#tde .tde-sum")).length > 3);
  await page.click("#modal-backdrop .modal-btn.primary");
  check("Tomorrow chip saves tomorrow", await page.evaluate(() => todoList.find(t => t.id === "b").due === addDaysIso(1)));
  await page.evaluate(() => editTodo("b"));
  await page.fill("#modal-due", await page.evaluate(() => addDaysIso(2)));
  await page.dispatchEvent("#modal-due", "change");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("picking a date saves it", await page.evaluate(() => todoList.find(t => t.id === "b").due === addDaysIso(2)));

  await page.tap('[data-todo-id="b"] .todo-check');
  check("checkbox completes", await page.evaluate(() => todoList.find(t => t.id === "b").done));
  await page.tap(".toast-action");
  check("undo restores", await page.evaluate(() => !todoList.find(t => t.id === "b").done));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("to-do: drag into another date group sets the date (desktop mouse)", async () => {
  const { ctx, page } = await openApp({ phone: false, query: "?tab=todo", seed: { "todo-content": [
    { id: "x", text: "Undated", done: false, due: null, starred: false, subitems: [], completedAt: null },
    { id: "y", text: "Tomorrow thing", done: false, due: isoOffset(1), starred: false, subitems: [], completedAt: null },
  ]}});
  const h = await page.locator('[data-todo-id="x"] .drag-handle').boundingBox();
  const t = await page.locator('[data-todo-id="y"]').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, t.y + t.height + 6, { steps: 15 });
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(250);
  const due = await page.evaluate(() => todoList.find(t => t.id === "x").due);
  check("dropped under Tomorrow", due === isoOffset(1), due);
  await ctx.close();
});

await section("to-do: completed items archive after 7 days, quietly", async () => {
  const { ctx, page } = await openApp({ seed: { "data-updated-at": "111", "todo-content": [
    { id: "o", text: "Old", done: true, due: null, starred: false, subitems: [], completedAt: Date.now() - 10 * 864e5 },
    { id: "n", text: "New", done: true, due: null, starred: false, subitems: [], completedAt: Date.now() - 2 * 864e5 },
  ]}});
  const r = await page.evaluate(() => ({ list: todoList.map(t => t.id), archive: loadContent("todo-archive-content", []).map(a => a.text), stamp: localStorage.getItem("data-updated-at") }));
  check("old item archived, recent kept", JSON.stringify(r.list) === '["n"]' && r.archive[0] === "Old", r);
  check("archiving does not bump the sync timestamp", r.stamp === "111", r.stamp);
  await ctx.close();
});

await section("routine: merged routine matches the old per-day lists for 28 days", async () => {
  const { ctx, page } = await openApp();
  const fails = await page.evaluate(() => {
    const bad = [];
    for (let n = -7; n < 21; n++) {
      const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n);
      const legacy = DEFAULT_SKIN_DAYS.find(x => x.day === WEEKDAYS[d.getDay()]);
      // the original rule, computed independently: every other Thursday from Jul 16 2026
      const weeks = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(2026, 6, 16)) / (7 * 864e5));
      const wash = !!legacy.pmWash && ((weeks % 2) + 2) % 2 === 0;
      const exp = s => s.map(x => decodeEntities(x[0]) + "|" + decodeEntities(x[1])).join(",");
      const added = new Set(ROUTINE_ADDITIONS.map(x => x.step.id)); // later additions aren't in the legacy lists
      const got = s => s.filter(x => !added.has(x.id)).map(x => x.label + "|" + x.product).join(",");
      const r = routineForDate(d);
      if (exp(legacy.am) !== got(r.am) || exp(wash ? legacy.pmWash : legacy.pm) !== got(r.pm) || r.wash !== wash) bad.push(isoDate(d));
    }
    return bad;
  });
  check("identical on every date", fails.length === 0, fails);
  await ctx.close();
});

await section("routine: check-offs, toast, streak, editing days", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=skin", seed: { "routine-checks": {
    [isoOffset(-1)]: { am: [], pm: [], amDone: true, pmDone: true },
    [isoOffset(-2)]: { am: [], pm: [], amDone: true, pmDone: true },
  }}});
  check("streak counts yesterday and the day before", ((await page.textContent(".routine-today .insight")) || "").includes("2-day"));
  const steps = page.locator(".routine-band.am .routine-step");
  for (let i = 0, n = await steps.count(); i < n; i++) await steps.nth(i).tap();
  check("finishing AM shows toast", ((await page.textContent(".toast")) || "").includes("Morning routine done"));
  check("AM marked done", await page.evaluate(() => todayChecks().amDone));
  const ex = await page.evaluate(() => {
    const s = skinRoutine.pm.find(x => x.label === "Exfoliate");
    editRoutineStep("pm", s.id);
    return s.id;
  });
  for (const d of ["1", "3", "5", "2", "4"]) await page.locator(`#modal-days input[value="${d}"]`).evaluate(i => i.click());
  await page.tap("#modal-backdrop .modal-btn.primary");
  const days = await page.evaluate(id => JSON.parse(localStorage.getItem("skin-routine-content")).pm.find(s => s.id === id).days, ex);
  check("day chips edit is saved", JSON.stringify(days) === "[2,4]", days);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("wash day: pick a date on the calendar, change frequency, undo", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=skin" });
  await page.evaluate(() => { openPinned.add("wash-card"); renderSkin(); });
  const before = await page.evaluate(() => ({ sched: washSchedule(), marked: document.querySelectorAll("#wash-card .cal-day.wash").length }));
  check("defaults to every 2 weeks from Jul 16", before.sched.anchor === "2026-07-16" && before.sched.everyDays === 14, before.sched);
  check("calendar marks wash days", before.marked >= 2, before.marked);
  const target = isoOffset(2);
  await page.evaluate(iso => setWashDate(iso), target);
  const after = await page.evaluate(iso => ({
    wash: routineForDate(noonOf(iso)).wash, stored: JSON.parse(localStorage.getItem("skin-routine-content")).wash,
    twoWeeksLater: isWashDate(noonOf(addDaysIso(16))), dayAfter: isWashDate(noonOf(addDaysIso(3))),
  }), target);
  check("picked date becomes a wash day", after.wash, after);
  check("schedule saved with the routine", after.stored && after.stored.anchor === target, after.stored);
  check("repeats every 2 weeks from the picked date", after.twoWeeksLater && !after.dayAfter, after);
  await page.evaluate(() => setWashFrequency(7));
  check("frequency change", await page.evaluate(iso => washSchedule().everyDays === 7 && isWashDate(noonOf(addDaysIso(9))), target));
  await page.tap(".toast-action");
  check("undo restores the previous schedule", await page.evaluate(() => washSchedule().everyDays === 14));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("wants: need/want tags, sorting, filters, editing", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=wants" });
  const r = await page.evaluate(() => ({
    beltKind: wantKind(wantsList.find(w => w.id === "belt-brown")),
    pouchKind: wantKind(wantsList.find(w => w.id === "pouch")),
    tags: document.querySelectorAll("#wants-pending-card .badge.kind-need, #wants-pending-card .badge.kind-want").length,
    cards: document.querySelectorAll("#wants-pending-card .want-card").length,
    order: wantsList.filter(w => !wantsState[w.id]).sort(wantsOrder).map(wantKind),
  }));
  check("wardrobe items default to need, others to want", r.beltKind === "need" && r.pouchKind === "want", r);
  check("every item shows a tag", r.tags === r.cards && r.cards > 0, r);
  check("needs sort before wants", r.order.join(",") === [...r.order].sort().join(","), r.order);
  await page.click(".filter-chip >> text=Needs");
  const needsOnly = await page.$$eval("#wants-pending-card .want-card .badge.kind-want", e => e.length);
  check("Needs filter hides wants", needsOnly === 0, needsOnly);
  await page.tap("#fab");
  await page.fill("#composer-text", "Phone charger");
  await page.press("#composer-text", "Enter");
  await page.keyboard.press("Escape");
  check("adding under the Needs filter makes a need", await page.evaluate(() => wantKind(wantsList.find(w => w.name === "Phone charger")) === "need"));
  await page.evaluate(() => editWant("pouch"));
  await page.selectOption("#modal-kind", "Need");
  await page.tap("#modal-backdrop .modal-btn.primary");
  check("tag changed in the edit form is saved",
    await page.evaluate(() => JSON.parse(localStorage.getItem("wants-content")).find(w => w.id === "pouch").kind === "need"));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("shopping: page name and Moto category", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=wants" });
  check("page is titled Shopping", (await page.textContent("#headline")) === "Shopping");
  check("tab is labeled Shopping", (await page.textContent('nav.tabbar button[data-tab="wants"]')).trim() === "Shopping");
  await page.evaluate(() => editWant("pouch"));
  await page.selectOption("#modal-cat", "Moto");
  await page.tap("#modal-backdrop .modal-btn.primary");
  const h = await page.evaluate(() => JSON.parse(localStorage.getItem("wants-content")).find(w => w.id === "pouch"));
  check("Moto category saved", h.moto === true && !h.wardrobeCat, h);
  check("Moto tag shown", await page.locator('#wants-pending-card .want-card', { hasText: "Trailco" }).locator(".want-tag.moto").count() === 1);
  await page.click(".filter-chip >> text=Moto");
  const names = await page.$$eval("#wants-pending-card .want-card .name", e => e.map(x => x.textContent));
  check("Moto filter shows only moto gear", names.length === 1 && names[0].startsWith("Trailco"), names);
  await page.tap("#fab");
  await page.fill("#composer-text", "Riding gloves");
  await page.press("#composer-text", "Enter");
  await page.keyboard.press("Escape");
  check("adding under the Moto filter makes moto gear", await page.evaluate(() => wantsList.find(w => w.name === "Riding gloves").moto === true));
  await page.evaluate(() => editWant("pouch"));
  await page.selectOption("#modal-cat", "Wardrobe · Outerwear");
  await page.tap("#modal-backdrop .modal-btn.primary");
  const h2 = await page.evaluate(() => wantsList.find(w => w.id === "pouch"));
  check("categories are exclusive", !h2.moto && h2.wardrobeCat === "Outerwear", h2);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("wardrobe: needs move onto Wants, belt merges", async () => {
  const { ctx, page, errors } = await openApp({ seed: { "style-state": { "tee-plum": "needed", "need-oxford": "owned" } } });
  const s = await page.evaluate(() => ({
    capsuleNeeded: capsule.filter(i => i.state === "needed").length,
    plumMoved: wantsList.some(w => w.id === "w-tee-plum"),
    oxfordKept: capsule.some(i => i.id === "need-oxford"),
    belts: wantsList.filter(w => /brown/i.test(w.name) && /belt/i.test(w.name)).length,
    styleState: Object.keys(styleState).length,
    snapshot: JSON.stringify([capsule, wantsList]),
  }));
  check("no needed items left in the capsule", s.capsuleNeeded === 0, s.capsuleNeeded);
  check("old toggles respected", s.plumMoved && s.oxfordKept, s);
  check("duplicate belt merged", s.belts === 1, s.belts);
  check("style-state cleared", s.styleState === 0);
  await page.reload(); await page.waitForTimeout(500);
  check("migration is idempotent", (await page.evaluate(() => JSON.stringify([capsule, wantsList]))) === s.snapshot);
  await page.evaluate(() => toggleWant("w-need-blazer"));
  check("a wardrobe item can be marked bought", await page.evaluate(() => wantsState["w-need-blazer"] === true));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("totals: partial sums are labeled, full sums shown once", async () => {
  const { ctx, page } = await openApp();
  const r = await page.evaluate(() => ({
    partial: priceSummary([{ price: 10 }, { price: null }]),
    full: priceSummary([{ price: 10 }, { price: 5 }]),
    none: priceSummary([{ price: null }]),
  }));
  check("partial", r.partial.badge === "" && r.partial.row.includes("1 unpriced"), r.partial);
  check("full", r.full.badge === " · $15.00" && r.full.row === "", r.full);
  check("none", r.none.badge === "" && r.none.row === "", r.none);
  await ctx.close();
});

await section("backup: download has every list, restore replaces data, junk rejected", async () => {
  const { ctx, page } = await openApp();
  const backup = await page.evaluate(() => {
    let captured;
    const orig = URL.createObjectURL;
    URL.createObjectURL = blob => { captured = blob; return orig.call(URL, blob); };
    navigator.canShare = undefined;
    return downloadBackup().then(() => captured.text()).then(JSON.parse);
  });
  check("backup holds 14 lists (incl. bills + budget)", Object.keys(backup.data).length === 14 && "budget-content" in backup.data, Object.keys(backup.data));
  backup.data["todo-content"] = [{ id: "r1", text: "Restored", done: false, due: null, starred: false, subitems: [], completedAt: null }];
  await page.evaluate(() => openSyncModal());
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("text=Restore…")]);
  await chooser.setFiles({ name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await page.waitForTimeout(300);
  check("restore applied", await page.evaluate(() => todoList.length === 1 && todoList[0].text === "Restored"));
  await page.evaluate(() => openSyncModal());
  const [chooser2] = await Promise.all([page.waitForEvent("filechooser"), page.click("text=Restore…")]);
  await chooser2.setFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await page.waitForTimeout(200);
  check("junk file rejected", ((await page.textContent(".toast")) || "").includes("isn't a Jazz 2.0 backup"));
  await ctx.close();
});

await section("sync: stale device takes newer remote data; old-format remote migrates", async () => {
  const now = Date.now();
  const gist = { id: "g0", files: { "jazz2-data.json": { truncated: false, content: JSON.stringify({ updatedAt: now, data: {
    "todo-content": [{ id: "p1", text: "Phone edit", done: false, day: "Friday", starred: false, subitems: [], completedAt: null }],
  }})}}};
  const route = async r => {
    const req = r.request(), url = new URL(req.url());
    const json = (status, body) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/gists" && req.method() === "GET") return json(200, [gist]);
    if (url.pathname === "/gists/g0" && req.method() === "GET") return json(200, gist);
    if (url.pathname === "/gists/g0" && req.method() === "PATCH") {
      Object.entries(JSON.parse(req.postData()).files).forEach(([n, f]) => { gist.files[n] = { truncated: false, content: f.content }; });
      return json(200, gist);
    }
    return json(404, {});
  };
  const { ctx, page, errors } = await openApp({ route, seed: {
    "sync-token": "tok", "sync-gist-id": "g0", "data-updated-at": String(now - 30 * 864e5),
    "todo-content": [
      { id: "s1", text: "Stale", done: false, due: null, starred: false, subitems: [], completedAt: null },
      { id: "s2", text: "Old done", done: true, due: null, starred: false, subitems: [], completedAt: now - 20 * 864e5 },
    ],
  }});
  await page.waitForTimeout(800);
  const local = await page.evaluate(() => todoList.map(t => [t.text, t.due]));
  check("remote edit wins over stale local data", local.length === 1 && local[0][0] === "Phone edit", local);
  check("gist not overwritten", gist.files["jazz2-data.json"].content.includes("Phone edit"));
  check("old-format remote migrated to a date", /^\d{4}-\d{2}-\d{2}$/.test(local[0][1] || ""), local);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("security: a malicious backup cannot run script", async () => {
  const { ctx, page } = await openApp();
  const r = await page.evaluate(async () => {
    window.__pwned = 0;
    const evil = '<img src=x onerror="window.__pwned++">';
    const evilId = "x');window.__pwned++;('";
    applyRemote({ updatedAt: Date.now(), data: {
      "wants-content": [{ id: evilId, name: evil, meta: evil, price: 1, link: "javascript:window.__pwned++", wardrobeCat: evil }],
      "wants-state": {}, "skin-rules-content": [evil], "style-rules-content": [evil], "sizes-content": [[evil, evil]],
      "capsule-content": [{ id: "c1", title: evil, sub: evil, cat: evil, state: "owned", link: "javascript:window.__pwned++" }],
      "todo-content": [{ id: evilId, text: evil, done: false, due: null, starred: false, subitems: [{ id: evilId, text: evil, done: false }], completedAt: null }],
    }});
    openPinned.add("rules-skin"); expandedTodos.add(todoList[0].id);
    renderSkin(); renderWants(); renderHome();
    await new Promise(r => setTimeout(r, 300));
    document.querySelectorAll("[onclick]").forEach(el => { if (el.getAttribute("onclick").includes("pwned")) el.click(); });
    return {
      pwned: window.__pwned,
      jsLinks: [...document.querySelectorAll("a[href]")].filter(a => /^\s*javascript:/i.test(a.getAttribute("href"))).length,
      shownAsText: document.getElementById("panel-wants").textContent.includes("<img src=x"),
    };
  });
  check("no injected script ran", r.pwned === 0, r);
  check("no javascript: links", r.jsLinks === 0, r);
  check("markup shown as plain text", r.shownAsText, r);
  await ctx.close();
});

await section("composer: + on Home, hidden elsewhere, launch shortcut opens it", async () => {
  const { ctx, page } = await openApp();
  check("+ shows on Home", await page.isVisible("#fab"));
  await page.evaluate(() => activateTab("skin"));
  check("+ hidden on Skin & Hair", !(await page.isVisible("#fab")));
  const labels = await page.evaluate(() => ["home", "todo", "wants", "budget"].map(t => { activateTab(t); return document.getElementById("fab").getAttribute("aria-label"); }));
  check("+ is labeled for each tab", labels.join("|") === "Add a to-do|Add a to-do|Add to shopping list|Add spending or a bill", labels);
  await page.evaluate(() => activateTab("home"));
  await page.tap("#fab");
  await page.fill("#composer-text", "From home");
  await page.press("#composer-text", "Enter");
  check("adding from Home works", await page.evaluate(() => todoList.some(t => t.text === "From home")));
  await ctx.close();
  const shortcut = await openApp({ query: "?tab=todo&action=addtodo" });
  check("Add a to-do shortcut opens the composer", await shortcut.page.evaluate(() => document.getElementById("composer").classList.contains("open")));
  await shortcut.ctx.close();
});

await section("composer: shopping items (price, category, details, batches)", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=wants" });
  await page.tap("#fab");
  check("+ opens the New item sheet", (await page.textContent("#composer-heading")) === "New item");
  check("price and link fields show up front", (await page.isVisible("#cx-price")) && (await page.isVisible("#cx-link")));
  await page.fill("#composer-text", "Helmet $250");
  check("typed price lights a chip", ((await page.textContent("#composer-chips .filter-chip.on")) || "").includes("$250.00"));
  await page.click("#composer-chips .filter-chip >> text=Moto");
  await page.press("#composer-text", "Enter");
  await page.fill("#composer-text", "Gloves");                     // category sticks for the next add
  await page.fill("#cx-price", "45");
  await page.fill("#cx-link", "https://example.com/gloves");
  await page.click("#composer-chips .filter-chip >> text=Notes");
  await page.fill("#cx-meta", "Size S");
  await page.press("#cx-meta", "Enter");
  await page.fill("#composer-text", "Shirt $20");
  await page.click("#composer-chips .filter-chip.on >> text=$20.00"); // keep "$20" as text
  await page.click("#composer-chips .filter-chip >> text=Wardrobe");
  await page.click("#composer-chips2 .filter-chip >> text=Tops");
  await page.click("#composer-chips .filter-chip >> text=High priority");
  await page.press("#composer-text", "Enter");
  const items = await page.evaluate(() => wantsList.slice(-3).map(w => ({ ...w, effKind: wantKind(w) })));
  const [helmet, gloves, shirt] = items;
  check("price parsed off the name", helmet.name === "Helmet" && helmet.price === 250 && helmet.moto === true, helmet);
  check("category sticks between adds; details saved", gloves.moto === true && gloves.price === 45 && gloves.link === "https://example.com/gloves" && gloves.meta === "Size S", gloves);
  check("dismissed price, wardrobe category, high priority", shirt.name === "Shirt $20" && shirt.price === null && shirt.wardrobeCat === "Tops" && shirt.priority === "high" && shirt.effKind === "need", shirt);
  check("counter", (await page.textContent("#composer-count")) === "3 added", await page.textContent("#composer-count"));
  check("price and link clear after each add", (await page.inputValue("#cx-price")) === "" && (await page.inputValue("#cx-link")) === "");
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("home: day agenda completes in place", async () => {
  const { ctx, page } = await openApp({ seed: { "todo-content": [
    { id: "a", text: "Due today", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
  ]}});
  await page.evaluate(() => { skinRoutine.washPm = []; renderHome(); }); // no Wash hair row, whatever day the suite runs
  await page.tap('#panel-home .todo-check[aria-label="Complete: Due today"]');
  check("completed from Home", await page.evaluate(() => todoList[0].done));
  check("still on Home", (await page.textContent("#headline")) === "Home");
  const r = await page.evaluate(() => ({
    struck: !document.querySelector('#panel-home .todo-check[aria-label="Mark not done: Due today"]') && document.querySelector("#panel-home").textContent.includes("All done · 1 to-do finished"),
    ring: document.querySelector(".home-ring").getAttribute("aria-label"),
    sub: document.querySelector(".home-hero .sub").textContent,
  }));
  check("finished to-do leaves Home", r.struck, r);
  check("progress ring counts it", r.ring === "1 of 1 done", r.ring);
  check("hero says all done", r.sub.startsWith("All done for today"), r.sub);
  await ctx.close();
});

await section("US holidays", async () => {
  const { ctx, page, errors } = await openApp({});
  const h = await page.evaluate(() => {
    const names = iso => holidaysOn(iso).map(x => x.name);
    return { thx26: names("2026-11-26"), obs4th: names("2026-07-03"), easter26: names("2026-04-05"), easter27: names("2027-03-28"),
      jun27: names("2027-06-18"), nye27: names("2027-12-31"), mlk27: names("2027-01-18"), fedMom: holidaysOn("2026-05-10")[0].federal,
      count26: Object.values(holidaysOf(2026)).flat().length };
  });
  check("federal holidays by rule (Thanksgiving, MLK Day)", h.thx26.includes("Thanksgiving") && h.mlk27.includes("Martin Luther King Jr. Day"), h);
  check("weekend holidays get their observed weekday", h.obs4th.includes("Independence Day (observed)") && h.jun27.includes("Juneteenth (observed)") && h.nye27.includes("New Year's Day (observed)"), h);
  check("Easter computed for 2026 and 2027", h.easter26.includes("Easter") && h.easter27.includes("Easter"), h);
  check("observances aren't marked as bank holidays", h.fedMom === false && h.count26 === 21, h);
  // Home: the day shows its holiday, and the calendar marks it
  await page.evaluate(() => selectHomeDate("2026-11-26"));
  const home = await page.evaluate(() => ({ chip: (document.querySelector("#panel-home .home-hero .holiday-chip") || {}).textContent || "",
    cell: !!document.querySelector('#panel-home .home-day.holiday[aria-label*="Thanksgiving"]') }));
  check("Home day shows the holiday", home.chip.includes("Thanksgiving") && home.chip.includes("banks closed"), home);
  check("Home calendar marks the holiday", home.cell, home);
  // Budget: federal holidays only
  await page.evaluate(() => { activateTab("budget"); const t = addDaysIso(0);
    budgetMonthOffset = (2026 - Number(t.slice(0, 4))) * 12 + (10 - Number(t.slice(5, 7))); renderBudget(); selectBudgetDay("2026-10-12"); });
  const bud = await page.evaluate(() => ({ chip: (document.querySelector("#budget-cal .holiday-chip") || {}).textContent || "" }));
  check("Budget calendar notes bank holidays", bud.chip.includes("Columbus Day"), bud);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("home: calendar strip picks any day", async () => {
  const { ctx, page, errors } = await openApp({ seed: { "todo-content": [
    { id: "o", text: "Late thing", done: false, due: isoOffset(-2), starred: false, subitems: [], completedAt: null },
    { id: "t", text: "Today thing", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
    { id: "s", text: "Starred today", done: false, due: isoOffset(0), starred: true, subitems: [], completedAt: null },
    { id: "f", text: "Far thing", done: false, due: isoOffset(40), starred: false, subitems: [], completedAt: null },
    { id: "n", text: "Whenever", done: false, due: null, starred: false, subitems: [], completedAt: null },
  ]}});
  const titles = () => page.$$eval("#panel-home .todo-wrap .title", els => els.map(e => e.textContent.trim()));
  const wk = await page.evaluate(() => { const first = document.querySelector("#panel-home .home-week .home-day"); return first && first.getAttribute("aria-label"); });
  check("week strip starts on Sunday", /^Sunday/.test(wk || ""), wk);
  const lead = await page.evaluate(() => { setHomeCalOpen(true); const first = noonOf(homeSelected().slice(0, 8) + "01");
    const other = [...document.querySelectorAll("#panel-home .home-month .home-day.other")].map(e => e.textContent.trim().split(/\s/)[0]);
    const r = { n: other.length, want: first.getDay(), lastPrev: other[other.length - 1], prevEnd: String(new Date(first.getFullYear(), first.getMonth(), 0).getDate()) };
    setHomeCalOpen(false); return r; });
  check("month view fills the first week with last month's days, greyed", lead.n === lead.want && (lead.n === 0 || lead.lastPrev === lead.prevEnd), lead);
  const today = await page.evaluate(() => ({
    days: document.querySelectorAll(".home-week .home-day").length,
    secs: [...document.querySelectorAll(".home-sec")].map(e => e.textContent),
    dots: document.querySelector(".home-day.today").querySelectorAll(".marks i").length,
  }));
  check("seven days in the strip", today.days === 7, today.days);
  check("today shows Overdue, Today, Anytime", JSON.stringify(today.secs) === '["Overdue","Today","Anytime"]', today.secs);
  check("today's dots count overdue + due", today.dots === 3, today.dots);
  const t0 = await titles();
  check("starred floats to the top of Today", t0.indexOf("Starred today") < t0.indexOf("Today thing"), t0);
  check("later items stay off today", !t0.includes("Far thing"), t0);

  // Swipes on the strip: down opens the month, sideways pages, up closes
  const swipe = (dx, dy) => page.evaluate(([dx, dy]) => {
    const el = document.querySelector(".home-cal"), r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + 40;
    const t = (cx, cy) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
    el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [t(x, y)], changedTouches: [t(x, y)] }));
    el.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [t(x + dx, y + dy)], changedTouches: [t(x + dx, y + dy)] }));
    el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [t(x + dx, y + dy)] }));
  }, [dx, dy]);
  await swipe(0, 120);
  const opened = await page.evaluate(() => ({
    month: !!document.querySelector("#panel-home .home-month"),
    cells: document.querySelectorAll("#panel-home .home-month .home-day:not(.blank):not(.other)").length,
    refreshing: document.getElementById("pull-indicator").classList.contains("refreshing"),
  }));
  check("swipe down opens the month", opened.month, opened);
  check("month shows every day", opened.cells >= 28 && opened.cells <= 31, opened.cells);
  check("swipe down on the calendar is not pull-to-refresh", !opened.refreshing);
  const title0 = await page.textContent(".home-cal-title");
  await swipe(-120, 0);
  check("swipe left pages to the next month", (await page.textContent(".home-cal-title")) !== title0);
  check("still on Home after a sideways swipe", (await page.textContent("#headline")) === "Home");
  await swipe(0, -120);
  check("swipe up closes back to the week", await page.evaluate(() => !document.querySelector("#panel-home .home-month") && !!document.querySelector(".home-week")));

  // Pick a date 40 days out from the month view
  await page.click(".home-cal-grab");
  const label = await page.evaluate(() => noonOf(addDaysIso(40)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }));
  for (let i = 0; i < 3 && !(await page.$(`.home-day[aria-label^="${label}:"]`)); i++) await page.click('.cal-nav[aria-label="Next month"]');
  const cell = `.home-day[aria-label^="${label}:"]`;
  check("far date has a dot", (await page.$$eval(`${cell} .marks i`, els => els.length)) === 1);
  await page.click(cell);
  check("picking a far date shows its to-dos", JSON.stringify(await titles()) === '["Far thing"]', await titles());
  check("Today button appears away from today", !!(await page.$(".home-cal-today")));
  await page.click("#fab");
  const due = await page.evaluate(() => composerDue().due);
  check("+ on a picked day presets that date", due === isoOffset(40), due);
  await page.fill("#composer-text", "Planned add");
  await page.press("#composer-text", "Enter");
  const added = await page.evaluate(() => todoList.find(t => t.text === "Planned add").due === addDaysIso(40));
  check("added to-do lands on the picked day", added);
  await page.evaluate(() => closeComposer());
  await page.click(".home-cal-today");
  check("Today button returns to today", (await titles()).includes("Today thing"));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("routine: AM/PM bands on Today collapse", async () => {
  const { ctx, page, errors } = await openApp();
  await page.evaluate(() => activateTab("skin"));
  const state = () => page.evaluate(() => [...document.querySelectorAll(".routine-today .routine-band")].map(b => ({
    open: b.querySelector(".routine-band-head").getAttribute("aria-expanded") === "true",
    steps: b.querySelectorAll(".routine-step").length,
  })));
  let s = await state();
  check("bands start open while unfinished", s.every(b => b.open && b.steps > 0), s);
  await page.click(".routine-today .routine-band.am .routine-band-head");
  s = await state();
  check("tapping the AM header collapses it", !s[0].open && s[0].steps === 0 && s[1].open, s);
  await page.click(".routine-today .routine-band.am .routine-band-head");
  check("tapping again reopens it", (await state())[0].open);
  // Finishing PM folds it away on its own
  await page.evaluate(() => { const r = routineForDate(new Date()); r.pm.forEach(st => toggleRoutineStep("pm", st.id)); });
  s = await state();
  check("a finished band closes itself", !s[1].open && s[1].steps === 0, s);
  check("finished band reads Done", (await page.textContent(".routine-today .routine-band.pm .routine-count")).includes("Done"));
  await page.click(".routine-today .routine-band.pm .routine-band-head");
  check("a finished band can be reopened", (await state())[1].open);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("routine: pore strips + teeth whitening added once", async () => {
  // A routine saved before the additions existed (no `added` marker)
  const saved = { am: [{ id: "am-1", label: "Cleanse", product: "Gel" }], pm: [{ id: "pm-1", label: "Cleanse", product: "Gel" }, { id: "pm-2", label: "Moisturize", product: "Cream" }], washPm: [] };
  const { ctx, page, errors } = await openApp({ seed: { "skin-routine-content": saved } });
  const pm = () => page.evaluate(() => skinRoutine.pm.map(x => x.id));
  check("whitening first, pore strips after Cleanse", JSON.stringify(await pm()) === '["pm-teeth-whitening","pm-1","pm-pore-strips","pm-2"]', await pm());
  const r = await page.evaluate(() => {
    const on = (dow, id) => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7));
      return skinRoutine.pm.find(x => x.id === id).days.includes(d.getDay()); };
    return { strips: skinRoutine.pm.find(x => x.id === "pm-pore-strips").days, teeth: skinRoutine.pm.find(x => x.id === "pm-teeth-whitening").days,
      stored: JSON.parse(localStorage.getItem("skin-routine-content")).added };
  });
  check("pore strips on Sundays", JSON.stringify(r.strips) === "[0]", r.strips);
  check("whitening every night", r.teeth === undefined, r.teeth);
  check("marker saved with the routine", JSON.stringify(r.stored) === '["teeth-whitening","pore-strips"]', r.stored);
  await page.evaluate(() => { skinRoutine.pm = skinRoutine.pm.filter(x => x.id !== "pm-pore-strips"); saveRoutine(); });
  await page.reload(); await page.waitForTimeout(500);
  check("a deleted addition stays deleted", !(await pm()).includes("pm-pore-strips"), await pm());
  check("and nothing is duplicated", (await pm()).filter(id => id === "pm-teeth-whitening").length === 1);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("skin: the three original rules are removed", async () => {
  const keep = "My own rule";
  const { ctx, page, errors } = await openApp({ query: "?tab=skin", seed: { "skin-rules-content": [
    "SPF is the final AM step, no exceptions, even indoors.", keep,
  ]}});
  const r = await page.evaluate(() => ({ rules: skinRules, stored: JSON.parse(localStorage.getItem("skin-rules-content")), card: !!document.getElementById("rules-skin") }));
  check("old rules dropped, the user's own kept", JSON.stringify(r.rules) === JSON.stringify([keep]) && JSON.stringify(r.stored) === JSON.stringify([keep]), r);
  check("card still shows with a rule left", r.card);
  await page.evaluate(() => { skinRules.length = 0; renderSkin(); });
  check("card hidden when empty", !(await page.$("#rules-skin")));
  await ctx.close();
  const fresh = await openApp({ query: "?tab=skin" });
  check("fresh install has no rules card", !(await fresh.page.$("#rules-skin")));
  check("no JS errors", errors.length === 0 && fresh.errors.length === 0, [...errors, ...fresh.errors]);
  await fresh.ctx.close();
});

await section("wash day shows as a Wash hair to-do", async () => {
  const { ctx, page, errors } = await openApp({ seed: { "todo-content": [
    { id: "a", text: "Due today", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
  ]}});
  await page.evaluate(() => { skinRoutine.wash = { anchor: addDaysIso(0), everyDays: 14 }; renderHome(); });
  const home = await page.evaluate(() => ({
    row: !!document.querySelector("#panel-home .wash-row .todo-check"),
    ring: document.querySelector(".home-ring").getAttribute("aria-label"),
    todo: [...document.querySelectorAll("#todo-list > *")].slice(0, 2).map(e => e.className),
  }));
  check("Home lists Wash hair today, checkable", home.row);
  check("ring counts it", home.ring === "0 of 2 done", home.ring);
  check("To-Do shows it under Today", home.todo[0].startsWith("cat-title") && home.todo[1].includes("wash-row"), home.todo);
  await page.click("#panel-home .wash-row .todo-check");
  const ticked = await page.evaluate(() => ({
    steps: washHairSteps().every(s => todayChecks().pm.includes(s.id)),
    labels: washHairSteps().map(s => s.label),
    checked: document.querySelector("#panel-home .wash-row .item").classList.contains("checked"),
    ring: document.querySelector(".home-ring").getAttribute("aria-label"),
  }));
  check("ticking it ticks the wash-only routine steps", ticked.steps && !ticked.labels.includes("Cleanse"), ticked);
  check("row shows done, ring moves", ticked.checked && ticked.ring === "1 of 2 done", ticked);
  await page.click("#panel-home .wash-row .todo-check");
  check("unticking clears them", await page.evaluate(() => !washHairSteps().some(s => todayChecks().pm.includes(s.id))));
  await page.evaluate(() => { skinRoutine.wash = { anchor: addDaysIso(2), everyDays: 14 }; renderHome(); });
  const later = await page.evaluate(() => ({
    homeRow: !!document.querySelector("#panel-home .wash-row"),
    icons: document.querySelectorAll("#todo-list .wash-row svg:not(.box svg)").length,
    todoCheck: !!document.querySelector("#todo-list .wash-row .todo-check"),
  }));
  check("not on Home on a non-wash day", !later.homeRow);
  check("upcoming wash day is checkable with one droplet", later.todoCheck && later.icons === 1, later);
  // ticking another day's row ticks that day's steps
  await page.evaluate(() => activateTab("todo"));
  await page.click("#todo-list .wash-row .todo-check");
  check("a past or future wash day can be ticked", await page.evaluate(() => washHairDone(addDaysIso(2)) && !washHairSteps().some(s => todayChecks().pm.includes(s.id))));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("to-do: recurring to-dos", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=todo", seed: { "todo-content": [
    { id: "w", text: "Take out trash", done: false, due: isoOffset(-3), starred: false, subitems: [{ id: "s1", text: "Recycling too", done: true }], completedAt: null, repeat: "weekly" },
    { id: "d", text: "Vitamins", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null, repeat: "daily" },
    { id: "x", text: "Bad rule", done: false, due: null, starred: false, subitems: [], completedAt: null, repeat: "hourly<script>" },
  ]}});
  const r0 = await page.evaluate(() => ({
    bad: "repeat" in todoList.find(t => t.id === "x"),
    rows: [...document.querySelectorAll("#todo-recurring .recurring-row .title")].map(e => e.textContent),
    meta: document.querySelector('[data-todo-id="w"] .repeat-meta').textContent,
    next: [addDaysIso(1), addDaysIso(4), nextRepeatIso("2026-01-31", "monthly"), nextRepeatIso("2026-10-09", "weekdays")],
  }));
  check("unknown repeat rules are dropped", !r0.bad);
  check("Recurring card starts closed", await page.evaluate(() => !document.getElementById("todo-recurring").classList.contains("open")));
  check("Recurring section lists repeating to-dos, soonest first", JSON.stringify(r0.rows) === '["Take out trash","Vitamins"]', r0.rows);
  check("row shows its rule", r0.meta.startsWith("Weekly · "), r0.meta);
  check("monthly clamps to the month's end; weekdays skip the weekend", r0.next[2] === "2026-02-28" && r0.next[3] === "2026-10-12", r0.next);
  await page.click('[data-todo-id="w"] .todo-check');
  const r1 = await page.evaluate(() => {
    const w = todoList.find(t => t.id === "w");
    const copy = todoList.find(t => t.id !== "w" && t.text === "Take out trash");
    return { due: w.due, done: w.done, subReset: w.subitems.every(s => !s.done), copy: copy && { done: copy.done, due: copy.due, repeat: copy.repeat } };
  });
  check("ticking an overdue weekly moves it to the next date after today", r1.due === isoOffset(4) && !r1.done, r1);
  check("its sub-items reset for next time", r1.subReset);
  check("a done copy is kept for the record", r1.copy && r1.copy.done && r1.copy.due === isoOffset(-3) && r1.copy.repeat === undefined, r1.copy);
  await page.click(".toast button");
  const undone = await page.evaluate(() => ({ due: todoList.find(t => t.id === "w").due, n: todoList.filter(t => t.text === "Take out trash").length }));
  check("undo puts it back", undone.due === isoOffset(-3) && undone.n === 1, undone);
  // Home projects future repeats onto the calendar
  await page.evaluate(() => { activateTab("home"); selectHomeDate(addDaysIso(2)); });
  const ghosts = await page.$$eval("#panel-home .repeat-ghost .title", els => els.map(e => e.textContent));
  check("future repeats show on Home's calendar", ghosts.includes("Vitamins"), ghosts);
  // Composer: Repeat chip
  await page.evaluate(() => selectHomeDate(addDaysIso(0)));
  await page.click("#fab");
  await page.fill("#composer-text", "Water plants");
  await page.click("#composer-chips .filter-chip >> text=Repeat");
  await page.click("#composer-chips2 .filter-chip >> text=Every 2 weeks");
  await page.press("#composer-text", "Enter");
  const added = await page.evaluate(() => { const t = todoList.find(x => x.text === "Water plants"); return { repeat: t.repeat, due: t.due }; });
  check("composer Repeat chip makes a repeating to-do starting today", added.repeat === "biweekly" && added.due === isoOffset(0), added);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: tab, old closet links, spending, bills", async () => {
  const { ctx, page, errors } = await openApp({ seed: {
    "bills-content": [{ id: "<bad>", name: "Junk", amount: "abc", due: "nope", repeat: "hourly", autopay: 1, link: "javascript:alert(1)" }],
  }});
  const nav = await page.$$eval("nav.tabbar button", bs => bs.map(b => b.textContent.trim()));
  check("nav: Home, To-Do, Budget, Shopping, Skin & Hair", JSON.stringify(nav) === '["Home","To-Do","Budget","Shopping","Skin & Hair"]', nav);
  check("swipe order matches the nav", await page.evaluate(() => JSON.stringify(TAB_ORDER) === JSON.stringify([...document.querySelectorAll("nav.tabbar button")].map(b => b.dataset.tab))));
  const junk = await page.evaluate(() => bills[0]);
  check("bad bill data is coerced", /^bill-/.test(junk.id) && junk.amount === 0 && junk.repeat === "monthly" && /^\d{4}-/.test(junk.due), junk);
  await page.evaluate(() => { bills = []; billPayments = []; saveBudgetData(); }); // (the junk bill had autopay on, so it paid itself)

  // The closet view is gone: old links to it open Shopping
  await page.evaluate(() => activateTab("style"));
  const old = await page.evaluate(() => ({ panel: document.getElementById("panel-wants").classList.contains("active"),
    nav: document.querySelector("nav.tabbar button.active").dataset.tab, closet: !!document.getElementById("panel-style") }));
  check("old closet links land on Shopping", old.panel && old.nav === "wants" && !old.closet, old);

  // Spending
  await page.evaluate(() => activateTab("budget"));
  await page.click("#fab");
  check("+ on Budget opens Add to budget", (await page.textContent("#composer-heading")) === "Add to budget");
  await page.fill("#composer-text", "Coffee");
  await page.press("#composer-text", "Enter");
  check("no amount: not saved, sheet says why", (await page.evaluate(() => budget.expenses.length)) === 0 && (await page.textContent("#composer-count")).includes("amount"));
  await page.fill("#composer-text", "Groceries $54.25");
  await page.click("#composer-chips2 .filter-chip >> text=Groceries");
  await page.press("#composer-text", "Enter");
  const exp = await page.evaluate(() => budget.expenses[0]);
  check("expense parsed: name, amount, category, today", exp.name === "Groceries" && exp.amount === 54.25 && exp.cat === "cat-groceries" && exp.date === isoOffset(0), exp);

  // Bill
  await page.fill("#composer-text", "Rent $1200");
  await page.click("#composer-chips .filter-chip >> text=Bill");
  check("bill shows the link field", await page.isVisible("#cx-link"));
  await page.press("#composer-text", "Enter"); // (autopay has its own section; an autopay bill due today would pay itself)
  await page.evaluate(() => closeComposer());
  const bill = await page.evaluate(() => bills[0]);
  check("bill saved: monthly, due today", bill.name === "Rent" && bill.amount === 1200 && bill.repeat === "monthly" && bill.due === isoOffset(0) && !bill.autopay, bill);
  const sum = await page.textContent(".budget-kpis");
  check("summary shows spent and bills left", sum.includes("$54.25") && sum.includes("$1,200"), sum);

  // Pay it from Home
  await page.evaluate(() => activateTab("home"));
  check("bill shows on Home today", (await page.textContent("#panel-home")).includes("Pay Rent"));
  await page.click('#panel-home .bill-home .todo-check[aria-label="Mark paid: Rent"]');
  const paid = await page.evaluate(() => ({ due: bills[0].due, pays: billPayments.length, next: addMonthsIso(addDaysIso(0), 1) }));
  check("paying logs it and moves the bill to next month", paid.pays === 1 && paid.due === paid.next, paid);
  check("paid bill stays on Home, struck", !!(await page.$("#panel-home .bill-home .item.checked")));
  await page.click(".toast button");
  check("undo un-pays", await page.evaluate(() => billPayments.length === 0 && bills[0].due === addDaysIso(0)));

  // Next month shows the projected due; over-budget category turns red
  await page.evaluate(() => { activateTab("budget"); budget.expenses.push({ id: "exp-big", name: "Big shop", amount: 500, cat: "cat-groceries", date: addDaysIso(0) }); renderBudget(); });
  check("over-limit category is flagged", !!(await page.$(".budget-cat-amt.over")));
  await page.click('.budget-month .cal-nav[aria-label="Next month"]');
  check("next month projects the bill", (await page.textContent("#bills-card")).includes("Rent"));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: sheet import, joint bills, paychecks, savings", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  const rows = ["Card/Bank\tDate\tExpense\tAmount", "Bank A\t2nd\tPhone\t$70.00", "Card B\t3rd\tGym\t-", "Card B\t28th\tInsurance\t$1,200.50", "Total\t\t\t$1,270.50"].join("\n");
  await page.evaluate(() => importBills());
  await page.fill("#modal-rows", rows);
  await page.click("#modal-backdrop .modal-btn.primary");
  await page.evaluate(() => importBills());
  await page.fill("#modal-rows", "Card B\t20th\tStorage\t$60");
  await page.selectOption("#modal-group", "Joint");
  await page.click("#modal-backdrop .modal-btn.primary");
  const r = await page.evaluate(() => ({
    bills: bills.map(b => [b.name, b.amount, b.account, b.group, Number(b.due.slice(8))]),
    accts: budget.accounts,
    total: billsInMonth(budgetMonthKey()).reduce((s, x) => s + x.amount, 0),
    subs: [...document.querySelectorAll("#bills-card .budget-sub")].map(e => e.textContent).filter(t => /^(Monthly|Joint)/.test(t)),
  }));
  check("rows import with account, amount ('-' = 0) and day; header and Total skipped", r.bills.length === 4
    && JSON.stringify(r.bills[0].slice(0, 4)) === '["Phone",70,"Bank A","personal"]' && r.bills[1][1] === 0 && r.bills[2][1] === 1200.5, r.bills);
  check("new cards/banks are added to the list", r.accts.includes("Bank A") && r.accts.includes("Card B"), r.accts);
  check("joint bills group separately with subtotals", r.bills[3][3] === "joint" && r.subs.length === 2 && r.subs[1].startsWith("Joint"), r.subs);
  check("month total covers both groups", Math.abs(r.total - 1330.5) < 0.001, r.total);
  // Paychecks
  const p = await page.evaluate(() => {
    budget.income.push({ id: "inc-1", name: "Paycheck", amount: 2000, start: budgetMonthKey() + "-01", repeat: "biweekly" });
    saveBudgetData();
    const pays = incomeInMonth(budgetMonthKey());
    quickPlanLine(pays[0].key, "Card payment", 500);
    const after = incomeInMonth(budgetMonthKey());
    return { n: pays.length, left: after[0].left, hint: !!document.querySelector("#pay-periods .plan-hint"), head: document.querySelector(".budget-kpi span").textContent };
  });
  check("a biweekly paycheck lands 2–3 times a month", p.n >= 2 && p.n <= 3, p.n);
  check("paycheck remaining = amount minus its lines", p.left === 1500, p.left);
  check("bills-before-next-payday hint offered", p.hint);
  check("summary switches to Remaining once there's income", p.head === "Remaining", p.head);
  // Savings goal
  await page.evaluate(() => editGoal());
  await page.fill("#modal-name", "House");
  await page.fill("#modal-target", "5000");
  await page.fill("#modal-saved", "2500");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("savings goal tracks saved of target", (await page.textContent("#goals-card")).includes("$2,500 of $5,000") && (await page.textContent("#goals-card .goal-meta")).startsWith("50%"));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: paycheck plans import from a sheet", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  const pays = await page.evaluate(() => {
    budget.income.push({ id: "inc-1", name: "Paycheck", amount: 1000, start: budgetMonthKey() + "-01", repeat: "biweekly" });
    saveBudgetData();
    return incomeInMonth(budgetMonthKey()).length;
  });
  const sheet = ["Paycheck\t$1,050.00", "Rent share\t$400.00", "Card\t$100.00", "", "Remaining\t$550.00", "",
    "Paycheck\t$1,000.00", "Groceries\t$150.25", "Contacts\t", "Remaining\t$849.75"].join("\n");
  await page.click("#budget-manage >> text=Import paycheck plans");
  await page.fill("#modal-rows", sheet);
  await page.click("#modal-backdrop .modal-btn.primary");
  const r = await page.evaluate(() => incomeInMonth(budgetMonthKey()).map(p => ({ amount: p.amount, lines: p.plan.lines.map(l => [l.name, l.amount]), left: p.left })));
  check("first block sets the payday amount and its lines", r[0].amount === 1050 && JSON.stringify(r[0].lines) === '[["Rent share",400],["Card",100]]' && r[0].left === 550, r[0]);
  check("second block fills the next payday; blank amount = $0; Remaining rows skipped", r[1].amount === 1000 && JSON.stringify(r[1].lines) === '[["Groceries",150.25],["Contacts",0]]' && Math.abs(r[1].left - 849.75) < 0.001, r[1]);
  check("paydays this month", pays >= 2);
  // Pasted without tabs (e.g. copied from a chat) still parses
  const loose = await page.evaluate(() => parsePlanBlocks("Paycheck $2,000\n1/2 of bills $700.10\nFun spending $300.90"));
  check("space-separated rows parse too", loose.length === 1 && loose[0].amount === 2000 && loose[0].lines[0].name === "1/2 of bills" && loose[0].lines[1].amount === 300.9, loose);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: pay that varies by check", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  // a biweekly check that started 4 weeks ago, so there are past and future paydays
  await page.evaluate(() => { budget.income.push({ id: "inc-v", name: "Work", amount: 2000, start: addDaysIso(-28), repeat: "biweekly" }); saveBudgetData(); });
  // the edit form's "Pay varies" switch
  await page.evaluate(() => editIncome("inc-v"));
  await page.check("#modal-varies");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("income can be marked as varying", await page.evaluate(() => budget.income[0].varies === true));
  const est0 = await page.evaluate(() => paycheckAt(budget.income[0], addDaysIso(14)));
  check("unreceived checks are expected, at the typical amount", est0.approx && est0.amount === 2000, est0);
  // tick a past check Received with its real amount
  const past = await page.evaluate(() => addDaysIso(-28));
  await page.evaluate(d => editPaycheck("inc-v", d, true), past);
  check("Received is prefilled when marking received", await page.isChecked("#modal-received"));
  await page.fill("#modal-amount", "2100");
  await page.click("#modal-backdrop .modal-btn.primary");
  await page.evaluate(d => editPaycheck("inc-v", d, true), await page.evaluate(() => addDaysIso(-14)));
  await page.fill("#modal-amount", "2300");
  await page.click("#modal-backdrop .modal-btn.primary");
  const r = await page.evaluate(() => {
    const src = budget.income[0];
    return { got: paycheckAt(src, addDaysIso(-28)), next: paycheckAt(src, addDaysIso(14)), est: incomeEstimate(src) };
  });
  check("received check keeps its real amount, no ~", r.got.received && !r.got.approx && r.got.amount === 2100, r.got);
  check("later checks are estimated from received ones", r.est === 2200 && r.next.amount === 2200 && r.next.approx, r);
  // saving an expected check unchanged doesn't pin the estimate
  await page.evaluate(() => editPaycheck("inc-v", addDaysIso(14)));
  await page.click("#modal-backdrop .modal-btn.primary");
  check("saving an expected check unchanged keeps it an estimate", await page.evaluate(() => budget.plans[`inc-v|${addDaysIso(14)}`].amount == null));
  // the page shows ~ for expected checks and the KPI counts them
  await page.evaluate(() => { incomeInMonth(budgetMonthKey()).forEach(p => { periodOpen[p.key] = true; }); renderBudget(); });
  const ui = await page.evaluate(() => ({ approx: document.querySelectorAll("#pay-periods .period-head .approx").length, recv: document.querySelectorAll("#pay-periods .period-head.recv .todo-check").length,
    kpi: document.querySelector(".budget-kpi i").textContent, manage: document.querySelector("#budget-manage").textContent }));
  check("periods mark expected checks with ~ and offer Received", ui.recv >= 1 && ui.approx >= 1 && /expected/.test(ui.kpi), ui);
  // the period checkbox: unticking goes back to expected, ticking asks for the amount
  const k1 = await page.evaluate(() => { const p = incomeInMonth(budgetMonthKey())[0]; Object.assign(planFor(p.key), { amount: 2050, received: true }); periodOpen[p.key] = true; saveBudgetData(); return p.key; });
  await page.click(`#pay-periods .period-head.recv.got .todo-check`);
  check("unticking Received returns the check to expected", await page.evaluate(k => !budget.plans[k].received && budget.plans[k].amount === 2050, k1));
  await page.click(`#pay-periods .period-head.recv:not(.got) .todo-check >> nth=0`);
  check("ticking Received opens the amount, prefilled as received", await page.isChecked("#modal-received"));
  await page.click("#modal-backdrop .modal-btn.primary");
  check("ticked check shows as received", await page.evaluate(k => budget.plans[k].received === true && !!document.querySelector("#pay-periods .period-head.recv.got"), k1));
  check("Manage lists the income as varying and offers import", ui.manage.includes("varies · ~$2,000") && ui.manage.includes("Import paychecks"), ui.manage);
  // pasting the sheet's Income rows
  const rows = await page.evaluate(() => [addDaysIso(-28), addDaysIso(14), addDaysIso(3)].map(d => `${Number(d.slice(5, 7))}/${d.slice(8)}/${d.slice(0, 4)} - Work\t$1,234.56`).join("\n") + "\nTotal\t$9,999.00");
  check("income rows parse dates and amounts", await page.evaluate(t => { const r = parseIncomeRows(t, 2026); return r.length === 3 && r[0].amount === 1234.56; }, rows));
  await page.evaluate(() => importIncome());
  await page.fill("#modal-rows", rows);
  await page.click("#modal-backdrop .modal-btn.primary");
  const imp = await page.evaluate(() => { const src = budget.income[0]; return { past: paycheckAt(src, addDaysIso(-28)), fut: paycheckAt(src, addDaysIso(14)), toast: document.getElementById("toast").textContent }; });
  check("imported rows set each payday's amount", imp.past.amount === 1234.56 && imp.fut.amount === 1234.56 && imp.past.received && !imp.fut.received, imp);
  check("rows that aren't a payday are reported", imp.toast.includes("Set 2 paychecks") && imp.toast.includes("1 not on a payday"), imp.toast);
  // varies + received survive a reload
  await page.reload(); await page.waitForTimeout(300);
  check("goals aren't repeated above the pay periods", await page.evaluate(() => !document.querySelector(".budget-goals-strip")));
  check("a divider sets the pay periods apart", await page.evaluate(() => { const hr = document.querySelector("#panel-budget .budget-divider"); return !!hr && !!hr.nextElementSibling && hr.compareDocumentPosition(document.getElementById("pay-periods")) & Node.DOCUMENT_POSITION_FOLLOWING; }));
  check("varies and received persist", await page.evaluate(() => budget.income[0].varies && budget.plans[`inc-v|${addDaysIso(-28)}`].received === true));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: long-term goals", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  // quick-start idea chip prefills the name
  check("no goals: just a one-line Goals row", !(await page.$("#goals-card")) && !!(await page.$("#budget-manage >> text=Goals")));
  await page.click("#budget-manage >> text=Goals");
  await page.click("#modal-body >> text=Big purchase");
  check("idea chip prefills the goal name", (await page.inputValue("#modal-name")) === "Big purchase");
  await page.fill("#modal-target", "6000");
  await page.evaluate(() => { document.getElementById("modal-date").value = addMonthsIso(addDaysIso(0), 12); });
  await page.fill("#modal-saved", "1000");
  await page.click("#modal-backdrop .modal-btn.primary");
  const g0 = await page.evaluate(() => { const g = budget.goals[0]; return { s: goalStatus(g), date: g.date }; });
  check("goal saved with a date; $/month needed computed", g0.s.saved === 1000 && Math.abs(g0.s.perMonth - 5000 / 12) < 15, g0);
  check("card shows what's needed per month", (await page.textContent("#goals-card")).includes("/mo needed"));
  // add money, then a withdrawal
  await page.click("#goals-card .goal-add");
  await page.fill("#modal-amount", "500");
  await page.fill("#modal-note", "Bonus");
  await page.click("#modal-backdrop .modal-btn.primary");
  await page.click("#goals-card .goal-add");
  await page.fill("#modal-amount", "100");
  await page.check("#modal-withdraw");
  await page.click("#modal-backdrop .modal-btn.primary");
  const g1 = await page.evaluate(() => goalStatus(budget.goals[0]));
  check("add money and take money out", g1.saved === 1400, g1);
  check("recent contributions give a pace", g1.pace != null && Math.abs(g1.pace - 400 / 3) < 0.01, g1.pace);
  check("history lists entries", (await page.$$("#goals-card .goal-entry")).length >= 2);
  // a paycheck line pointed at the goal counts once its payday has passed
  const linked = await page.evaluate(() => {
    const g = budget.goals[0];
    budget.income.push({ id: "inc-1", name: "Paycheck", amount: 2000, start: addDaysIso(-14), repeat: "biweekly" });
    planFor(`inc-1|${addDaysIso(-14)}`).lines.push({ id: "line-1", name: "Ring fund", amount: 300, goal: g.id });
    planFor(`inc-1|${addDaysIso(14)}`).lines.push({ id: "line-2", name: "Ring fund", amount: 300, goal: g.id });
    incomeInMonth(budgetMonthKey()).forEach(p => { periodOpen[p.key] = true; }); // show past periods too
    saveBudgetData();
    return { saved: goalStatus(g).saved, tag: !!document.querySelector("#pay-periods .goal-tag") };
  });
  check("past paycheck line counts, future one doesn't yet", linked.saved === 1700, linked);
  check("linked paycheck lines are tagged", linked.tag);
  // composer: To a goal
  await page.click("#fab");
  await page.click("#composer-chips .filter-chip >> text=To a goal");
  await page.fill("#composer-text", "Birthday money $200");
  await page.press("#composer-text", "Enter");
  check("composer adds to a goal", await page.evaluate(() => goalStatus(budget.goals[0]).saved === 1900));
  await page.evaluate(() => closeComposer());
  // reaching the target
  await page.evaluate(() => { budget.goals[0].log.push({ id: "gl-big", date: addDaysIso(0), amount: 5000, note: "" }); saveBudgetData(); });
  // milestone bar: quarter marks, next milestone and a finish date at this pace
  const ms = await page.evaluate(() => {
    budget.goals = [{ id: "goal-h", name: "House", target: 15000, saved: 2500, date: null, created: addDaysIso(-60), log: [{ id: "gl-1", date: addDaysIso(-10), amount: 1500, note: "" }] }];
    saveBudgetData();
    const s = goalStatus(budget.goals[0]);
    return { marks: [...document.querySelectorAll("#goals-card .goal-mark em")].map(e => e.textContent), hit: document.querySelectorAll("#goals-card .goal-mark.hit").length,
      outlook: document.querySelector("#goals-card .goal-outlook").textContent, insight: document.querySelector("#goals-card .insight").textContent, s };
  });
  check("milestone marks at each quarter", ms.marks.join() === "$3,750,$7,500,$11,250,$15,000" && ms.hit === 1, ms);
  check("next milestone and finish date shown", ms.outlook.includes("Next: $7,500 (50%) · $3,500 away") && ms.outlook.includes("At this pace:") && !!ms.s.eta, ms.outlook);
  check("collapsed insight: % and amount to go", ms.insight === "27% · $11,000 to go", ms.insight);
  const behind = await page.evaluate(() => { budget.goals[0].date = addMonthsIso(addDaysIso(0), 10); saveBudgetData(); return document.querySelector("#goals-card .insight").textContent; });
  check("collapsed insight flags a goal that's behind", /^Behind · needs \$[\d,]+\/mo$/.test(behind), behind);
  await page.evaluate(() => { budget.goals.push({ id: "goal-r", name: "Ring", target: 100, saved: 100, date: null, created: addDaysIso(0), log: [] }); saveBudgetData(); });
  check("several goals: overall % and how many are behind", (await page.textContent("#goals-card .insight")) === "27% · 1 behind", await page.textContent("#goals-card .insight"));
  check("reached goals say so", (await page.textContent("#goals-card")).includes("Reached"));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: pay periods, copy plans, variable bills, shares, card totals", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  const setup = await page.evaluate(() => {
    const k = budgetMonthKey(), d = n => `${k}-${String(n).padStart(2, "0")}`;
    budget.income = [{ id: "inc-1", name: "Paycheck", amount: 2000, start: d(1), repeat: "biweekly" }];
    budget.accounts = ["Bank A", "Card B"];
    bills = [
      { id: "bill-a", name: "Rent", amount: 1000, due: d(3), repeat: "monthly", autopay: false, link: null, group: "joint", account: "Bank A", share: 50 },
      { id: "bill-b", name: "Electric", amount: 80, due: d(16), repeat: "monthly", autopay: false, link: null, group: "personal", account: "Card B", varies: true },
    ];
    saveBudgetData();
    return { k };
  });
  const folded = await page.evaluate(() => ({ open: document.querySelectorAll("#pay-periods .card.period").length, rows: document.querySelectorAll("#pay-periods .period-row").length }));
  check("only the current pay period is open; the rest fold to a line", folded.open === 1 && folded.rows >= 1, folded);
  await page.evaluate(() => { incomeInMonth(budgetMonthKey()).forEach(p => { periodOpen[p.key] = true; }); renderBudget(); });
  const periods = await page.evaluate(() => [...document.querySelectorAll("#pay-periods .card.period")].map(c => c.textContent.replace(/\s+/g, " ")));
  check("each payday is its own period with the bills due in it", periods.length >= 2 && periods[0].includes("Rent") && !periods[0].includes("Electric") && periods[1].includes("Electric"), periods);
  check("joint share counts your part", periods[0].includes("$500.00") && periods[0].includes("50%"), periods[0]);
  check("spending hides until something's logged", !(await page.$("#spending-card")) && (await page.textContent("#panel-budget")).includes("Spending by category"));
  // by-card totals
  const acct = await page.$$eval("#bills-card .acct-total", els => els.map(e => e.textContent.replace(/\s+/g, " ").trim()));
  check("totals by card/bank", acct.some(a => a.startsWith("Bank A") && a.includes("$500.00")) && acct.some(a => a.startsWith("Card B") && a.includes("$80.00")), acct);
  // variable bill asks for the amount
  await page.evaluate(() => payBill("bill-b"));
  await page.fill("#modal-amount", "93.40");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("a bill that varies records what it came to", await page.evaluate(() => billPayments[0] && billPayments[0].amount === 93.4));
  // paid rows fold away; open them and edit the payment
  check("paid bills fold behind a toggle", !!(await page.$("#pay-periods .paid-toggle")));
  await page.click("#pay-periods .paid-toggle");
  await page.click("#pay-periods .bill-row.checked .body");
  await page.fill("#modal-amount", "95");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("tapping a paid bill edits the payment", await page.evaluate(() => billPayments[0].amount === 95));
  // plan lines tick off
  await page.evaluate(() => { const p = incomeInMonth(budgetMonthKey())[0]; quickPlanLine(p.key, `1/2 of ${noonOf(budgetMonthKey() + "-01").toLocaleDateString("en-US", { month: "short" })} Bills`, 500); });
  await page.click("#pay-periods .plan-row .todo-check");
  check("plan lines can be checked off", await page.evaluate(() => incomeInMonth(budgetMonthKey())[0].plan.lines[0].done === true));
  check("a fully done plan folds away", await page.evaluate(() => { const b = document.querySelector("#pay-periods .plan-toggle"); return b && b.getAttribute("aria-expanded") === "false" && !document.querySelector("#pay-periods .card.period .plan-row"); }));
  await page.click("#pay-periods .plan-toggle");
  check("and opens again with a tap", !!(await page.$("#pay-periods .plan-row")));
  // reload: joint group, account, share, varies and done all survive
  await page.reload(); await page.waitForTimeout(500);
  await page.evaluate(() => activateTab("budget")); // the launch param is gone after the first load
  const kept = await page.evaluate(() => ({ a: bills.find(b => b.id === "bill-a"), b: bills.find(b => b.id === "bill-b"), done: incomeInMonth(budgetMonthKey())[0].plan.lines[0].done }));
  check("bill details survive a reload", kept.a.group === "joint" && kept.a.account === "Bank A" && kept.a.share === 50 && kept.b.varies === true && kept.done === true, kept);
  // next month: offer to copy the plans, renaming the month in line names
  await page.click('.budget-month .cal-nav[aria-label="Next month"]');
  check("next month offers to copy last month's plans", !!(await page.$(".copy-plans")));
  await page.click(".copy-plans");
  const copied = await page.evaluate(() => { const p = incomeInMonth(budgetMonthKey())[0]; return { name: p.plan.lines[0].name, done: !!p.plan.lines[0].done,
    want: `1/2 of ${noonOf(budgetMonthKey() + "-01").toLocaleDateString("en-US", { month: "short" })} Bills` }; });
  check("copied lines move the month name along and start unchecked", copied.name === copied.want && !copied.done, copied);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("sync: per-list merge keeps both devices' edits", async () => {
  const now = Date.now();
  const todos = [{ id: "t1", text: "Shared", done: false, due: null, starred: false, subitems: [], completedAt: null }];
  const rules = ["Rule A"];
  // both devices last synced the same data; then the other device edited rules
  const base = { "todo-content": JSON.stringify(todos), "skin-rules-content": JSON.stringify(rules) };
  const gist = { id: "g0", files: { "jazz2-data.json": { truncated: false, content: JSON.stringify({ updatedAt: now, data: {
    "todo-content": todos, "skin-rules-content": ["Rule A", "Rule from desktop"] } }) } } };
  let patches = 0;
  const route = async r => {
    const req = r.request(), url = new URL(req.url());
    const json = (status, body) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/gists/g0" && req.method() === "GET") return json(200, gist);
    if (url.pathname === "/gists/g0" && req.method() === "PATCH") {
      patches++;
      Object.entries(JSON.parse(req.postData()).files).forEach(([n, f]) => { gist.files[n] = { truncated: false, content: f.content }; });
      return json(200, gist);
    }
    return json(404, {});
  };
  const { ctx, page, errors } = await openApp({ route, seed: {
    "sync-token": "tok", "sync-gist-id": "g0", "data-updated-at": String(now + 5000), "sync-base": base,
    // this device edited to-dos (and is "newer" by timestamp)
    "todo-content": [...todos, { id: "t2", text: "Phone edit", done: false, due: null, starred: false, subitems: [], completedAt: null }],
    "skin-rules-content": rules,
  }});
  await page.waitForTimeout(1200);
  const local = await page.evaluate(() => ({ todos: todoList.map(t => t.text), rules: skinRules }));
  const remote = JSON.parse(gist.files["jazz2-data.json"].content).data;
  check("the other device's rule edit comes in", local.rules.includes("Rule from desktop"), local.rules);
  check("this device's to-do edit is kept", local.todos.includes("Phone edit"), local.todos);
  check("the gist ends up with both", remote["todo-content"].some(x => x.text === "Phone edit") && remote["skin-rules-content"].includes("Rule from desktop") && patches === 1, { patches });
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("robustness: malformed synced data can't stop the app", async () => {
  const { ctx, page, errors } = await openApp({ seed: {
    "todo-content": [null, { id: "a", text: "Bad due", due: 20261006, subitems: "abc", done: 0 }, { id: "b", text: "Fine", due: null, subitems: {} }],
    "skin-routine-content": { am: "x", pm: [{ id: "p1", label: "Cleanse", product: "Gel", days: "Mon" }] },
    "routine-checks": "null",
    "sizes-content": [1, ["Shoe", "10"]],
    "wants-content": { not: "a list" },
    "style-state": [1, 2],
  }});
  const r = await page.evaluate(() => ({ home: document.getElementById("panel-home").innerHTML.length, todos: todoList.map(t => [t.text, t.due, Array.isArray(t.subitems)]),
    am: skinRoutine.am, wash: skinRoutine.washPm, sizes, wants: wantsList }));
  check("app still renders", r.home > 100, r.home);
  check("bad to-dos are dropped or coerced", r.todos.length === 2 && r.todos[0][1] === null && r.todos.every(x => x[2]), r.todos);
  check("routine and lists fall back to safe shapes", Array.isArray(r.am) && Array.isArray(r.wash) && r.sizes.length === 1 && Array.isArray(r.wants), r);
  // a wild wash interval can't freeze the app
  const t0 = Date.now();
  await page.evaluate(() => { skinRoutine.wash = { anchor: "2020-01-01", everyDays: 1e9 }; renderSkin(); renderHome(); });
  check("absurd wash interval is ignored", Date.now() - t0 < 2000 && (await page.evaluate(() => washSchedule().everyDays)) === 14);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("dates: monthly repeats keep their day; Home follows midnight", async () => {
  const { ctx, page, errors } = await openApp();
  const r = await page.evaluate(() => {
    let d = "2027-01-31", seq = [];
    for (let i = 0; i < 3; i++){ d = nextRepeatIso(d, "monthly", 31); seq.push(d); }
    let b = "2027-01-31", bseq = [];
    for (let i = 0; i < 3; i++){ b = nextBillIso(b, "monthly", 31); bseq.push(b); }
    budget.income = [{ id: "inc-m", name: "Monthly pay", amount: 100, start: "2027-01-31", repeat: "monthly" }];
    const mar = incomeInMonth("2027-03").map(p => p.date);
    return { seq, bseq, mar };
  });
  check("to-do repeat on the 31st comes back to the 31st", JSON.stringify(r.seq) === '["2027-02-28","2027-03-31","2027-04-30"]', r.seq);
  check("bill repeat too", JSON.stringify(r.bseq) === '["2027-02-28","2027-03-31","2027-04-30"]', r.bseq);
  check("monthly income too", JSON.stringify(r.mar) === '["2027-03-31"]', r.mar);
  // pretend the date rolled over while the app stayed open
  const rolled = await page.evaluate(() => { renderedDay = "2000-01-01"; homeDate = "2000-01-01"; checkDayChange(); return { day: renderedDay, home: homeDate }; });
  check("a new day resets Home to today", rolled.day === await page.evaluate(() => addDaysIso(0)) && rolled.home === null, rolled);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("to-dos: custom repeat intervals and multi-day to-dos", async () => {
  const { ctx, page, errors } = await openApp({ seed: { "todo-content": [
    { id: "w", text: "Filter change", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
    { id: "m", text: "Trip", done: false, due: isoOffset(-1), starred: false, subitems: [], completedAt: null },
  ]}});
  // every 3 weeks
  await page.evaluate(() => editTodo("w"));
  check("interval stepper hidden until Custom is picked", !(await page.$("#tde .tde-every")));
  await page.click("#tde .filter-chip >> text=Custom");
  check("Custom shows the stepper, in weeks", !!(await page.$("#tde .tde-every")) && (await page.textContent("#tde .tde-seg button.on")) === "weeks");
  await page.click('#tde .tde-step[aria-label="More"]');
  check("stepper counts up", (await page.textContent("#modal-every")) === "3");
  await page.click("#modal-backdrop .modal-btn.primary");
  const w = await page.evaluate(() => { const t = todoList.find(x => x.id === "w"); return { repeat: t.repeat, every: t.every, label: repeatLabel(t), on21: occursOn(t, addDaysIso(21)), on14: occursOn(t, addDaysIso(14)) }; });
  check("every 3 weeks is saved and labeled", w.repeat === "weeks" && w.every === 3 && /^Every 3 weeks · /.test(w.label), w);
  check("it lands 3 weeks out, not 2", w.on21 && !w.on14, w);
  await page.evaluate(() => completeTodo("w"));
  check("ticking it moves it 3 weeks on", await page.evaluate(() => todoList.find(x => x.id === "w").due === addDaysIso(21)));
  // every 2 months
  await page.evaluate(() => { const t = todoList.find(x => x.id === "w"); t.repeat = "months"; t.every = 2; t.due = "2026-01-31"; t.repeatDay = 31; });
  check("every 2 months keeps its day", await page.evaluate(() => { const t = todoList.find(x => x.id === "w"); return todoNext("2026-01-31", t) === "2026-03-31" && todoNext("2026-03-31", t) === "2026-05-31"; }));
  // multi-day: started yesterday, runs through tomorrow
  await page.evaluate(() => editTodo("m"));
  await page.click("#tde .filter-chip >> text=Multi-day");
  await page.fill("#modal-end", await page.evaluate(() => addDaysIso(1)));
  await page.dispatchEvent("#modal-end", "change");
  check("summary shows the span", (await page.textContent("#tde .tde-sum")).includes("(3 days)"));
  await page.click("#modal-backdrop .modal-btn.primary");
  const m = await page.evaluate(() => { const t = todoList.find(x => x.id === "m"); return { days: t.days, group: todoGroup(t), today: homeDayItems(addDaysIso(0)).open.some(x => x.id === "m"),
    tomorrow: homeDayItems(addDaysIso(1)).open.some(x => x.id === "m"), after: homeDayItems(addDaysIso(2)).open.some(x => x.id === "m"), counts: homeDueCounts() }; });
  check("last day sets a 3-day span", m.days === 3, m);
  check("a running multi-day to-do isn't overdue", m.group === "today", m);
  check("it shows on each of its days, not after", m.today && m.tomorrow && !m.after, m);
  check("calendar dots count each day", m.counts[await page.evaluate(() => addDaysIso(1))] >= 1, m.counts);
  await page.evaluate(() => { selectHomeDate(addDaysIso(0)); });
  check("Home says which day of the span it is", (await page.textContent("#panel-home")).includes("Day 2 of 3"));
  // once its last day has passed it's overdue
  check("overdue once the last day passes", await page.evaluate(() => { const t = { id: "x", text: "x", due: addDaysIso(-5), days: 3 }; return todoGroup(t) === "overdue"; }));
  // junk from sync is cleaned up
  check("bad interval/span values are dropped", await page.evaluate(() => { todoList.push({ id: "j", text: "j", done: false, due: null, days: 9, every: "x", subitems: [] }); normalizeLoadedData(); const t = todoList.find(x => x.id === "j"); return !("days" in t) && !("every" in t); }));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("to-do types get icons", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=todo", seed: { "todo-content": [
    { id: "a", text: "Therapy @ 10am", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
    { id: "b", text: "Gym", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
    { id: "c", text: "WWC @ 9am", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
    { id: "d", text: "Something vague", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
  ]}});
  const k = await page.evaluate(() => ["Therapy @ 10am", "Gym", "WWC @ 9am", "Get eyebrows done", "Mom's birthday dinner", "Clean the kitchen", "Pick up dry cleaning", "Flight to Atlanta", "Oil change", "Something vague", "Update resume"].map(detectKind));
  check("types are guessed from the words", JSON.stringify(k) === JSON.stringify(["health", "fitness", "appointment", "appointment", "birthday", "chores", "errand", "travel", "car", null, null]), k);
  const icons = await page.evaluate(() => [...document.querySelectorAll("#todo-list .todo-wrap")].map(w => [w.dataset.todoId, (w.querySelector(".kind-ic") || {}).title || ""]));
  check("rows show the type's icon (none when nothing fits)", JSON.stringify(icons.sort()) === JSON.stringify([["a", "Health"], ["b", "Fitness"], ["c", "Appointment"], ["d", ""]]), icons);
  // pick a type by hand, then None
  await page.evaluate(() => editTodo("d"));
  check("Type row offers Automatic plus each type", (await page.$$("#tde .kind-chip")).length === 14);
  await page.click("#tde .kind-chip >> text=Work");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("picked type is saved and shown", await page.evaluate(() => todoList.find(t => t.id === "d").kind === "work" && document.querySelector('[data-todo-id="d"] .kind-ic').title === "Work"));
  await page.evaluate(() => editTodo("b"));
  await page.click("#tde .kind-chip >> text=None");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("None hides the icon", await page.evaluate(() => !document.querySelector('[data-todo-id="b"] .kind-ic')));
  // the Auto chip follows the text as it's typed
  await page.evaluate(() => editTodo("a"));
  await page.fill("#modal-text", "Flight home");
  check("Auto chip follows the text", (await page.textContent("#tde .kind-chip.on")).includes("Travel"));
  await page.evaluate(() => closeModal());
  check("bad types from sync are dropped", await page.evaluate(() => { todoList[0].kind = "<x>"; normalizeLoadedData(); return !("kind" in todoList[0]); }));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("to-dos: repeat undo after a sync, un-ticking a repeat, day words on a picked day", async () => {
  const { ctx, page, errors } = await openApp({ seed: { "todo-content": [
    { id: "r", text: "Water plants", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null, repeat: "weekly" },
  ]}});
  await page.click('#panel-home .todo-check[aria-label="Complete: Water plants"]');
  // a sync swaps in fresh objects before Undo is tapped
  await page.evaluate(() => { todoList = JSON.parse(JSON.stringify(todoList)); });
  await page.click(".toast button");
  const u = await page.evaluate(() => todoList.map(t => [t.text, t.due, t.done]));
  check("undo still restores the repeat after a sync", u.length === 1 && u[0][1] === isoOffset(0), u);
  // complete again, then un-tick the done copy on Home: the series comes back
  await page.click('#panel-home .todo-check[aria-label="Complete: Water plants"]');
  check("finished repeat leaves Home", !(await page.$('#panel-home .todo-check[aria-label="Mark not done: Water plants"]')));
  await page.evaluate(() => toggleTodo(todoList.find(t => t.done && t.text === "Water plants").id));
  const back = await page.evaluate(() => todoList.map(t => [t.due, t.done]));
  check("un-ticking a repeat's done copy rolls the series back", back.length === 1 && back[0][0] === isoOffset(0) && !back[0][1], back);
  // a day word wins over Home's picked day
  await page.evaluate(() => selectHomeDate(addDaysIso(3)));
  await page.click("#fab");
  await page.fill("#composer-text", "Dentist tomorrow");
  await page.press("#composer-text", "Enter");
  const added = await page.evaluate(() => { const t = todoList.find(x => x.text === "Dentist"); return t && t.due; });
  check("typed day word beats the picked day", added === isoOffset(1), added);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: fixes from the review", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  const r = await page.evaluate(() => {
    const k = budgetMonthKey();
    budget.income = [{ id: "inc-a", name: "A", amount: 0.3, start: k + "-02", repeat: "biweekly" }, { id: "inc-b", name: "B", amount: 500, start: k + "-02", repeat: "biweekly" }];
    bills = [{ id: "bill-1", name: "Rent", amount: 900, due: k + "-05", repeat: "monthly", autopay: false, link: null, group: "personal", account: null }];
    const pa = incomeInMonth(k).find(p => p.src.id === "inc-a");
    planFor(pa.key).lines = [{ id: "l1", name: "x", amount: 0.1 }, { id: "l2", name: "y", amount: 0.2 }];
    budget.goals = [{ id: "goal-1", name: "Trip", target: 100, saved: 0, date: null, created: k + "-01", log: [] }];
    planFor(pa.key).lines.push({ id: "l3", name: "to trip", amount: 10, goal: "goal-1" });
    saveBudgetData();
    const left = incomeInMonth(k).find(p => p.src.id === "inc-a").left;
    // the first two periods are both the 2nd (A and B); only the first lists the bills
    const cards = [...document.querySelectorAll("#pay-periods .card.period")].slice(0, 2);
    const rentListed = cards.filter(c => c.textContent.includes("Rent")).length;
    return { left, rentListed, k };
  });
  check("paycheck remaining rounds to cents (no −$0.00)", r.left === -10, r.left);
  check("two paychecks on one day don't both list the same bills", r.rentListed === 1, r.rentListed);
  // deleting an income removes its plans (and their goal money)
  const g = await page.evaluate(() => {
    editIncome("inc-a");
    return true;
  });
  await page.click("#modal-delete-btn");
  const after = await page.evaluate(() => ({ plans: Object.keys(budget.plans).filter(k => k.startsWith("inc-a|")).length, saved: goalSaved(budget.goals[0]) }));
  check("deleting an income removes its plans", after.plans === 0 && after.saved === 0, after);
  // ...and Undo brings everything back
  await page.click(".toast button");
  check("undo restores a delete", await page.evaluate(() => budget.income.some(i => i.id === "inc-a") && Object.keys(budget.plans).some(k => k.startsWith("inc-a|"))));
  // blank paycheck amount goes back to the usual amount
  await page.evaluate(k => { const p = incomeInMonth(k).find(x => x.src.id === "inc-b"); planFor(p.key).amount = 123; saveBudgetData(); editPaycheck("inc-b", p.date); }, r.k);
  await page.fill("#modal-amount", "");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("clearing a payday's amount resets it", await page.evaluate(k => incomeInMonth(k).find(x => x.src.id === "inc-b").amount === 500, r.k));
  // duplicate goal names are refused
  await page.evaluate(() => editGoal());
  await page.fill("#modal-name", "trip");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("duplicate goal names are refused", await page.evaluate(() => budget.goals.length === 1));
  await page.evaluate(() => closeModal());
  // a bill named "Monthly gym" imports
  check("import keeps bills whose name starts with a heading word", await page.evaluate(() => parseBillRows("Card\t3rd\tMonthly gym\t$30").length === 1));
  // no Edit modes: cards carry no Edit chip; Cards & banks opens its own sheet
  check("cards have no Edit chip", !(await page.$(".edit-chip")));
  // tapping things edits them
  await page.evaluate(() => { activateTab("skin"); openPinned.add("routine-card"); renderSkin(); });
  await page.click("#routine-card .band .step.editable >> nth=0");
  check("tapping a routine step opens its editor", (await page.textContent("#modal-heading")).length > 0 && await page.isVisible("#modal-backdrop.open"));
  await page.evaluate(() => closeModal());
  check("+ Add step is always there", (await page.$$("#routine-card .add-row")).length === 3);
  await page.evaluate(() => openAccounts());
  check("Cards & banks opens as a sheet", (await page.textContent("#modal-heading")) === "Cards & banks" && !!(await page.$("#modal-body .acct-add")));
  await page.evaluate(() => closeModal());
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("shopping + backup: review fixes", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=wants" });
  await page.click("#panel-wants .want-card .body >> nth=0");
  check("tapping a Shopping item opens its editor", await page.isVisible("#modal-backdrop.open"));
  await page.evaluate(() => closeModal());
  // deleting by id never removes a different item when the id is already gone
  const kept = await page.evaluate(() => { const n = wantsList.length; editWant(wantsList[0].id); wantsList = wantsList.slice(1); modalDelete(); return wantsList.length === n - 1; });
  check("delete of an already-gone item removes nothing else", kept);
  // a filtered empty list says so and offers Show all
  await page.evaluate(() => { activateTab("wants"); wantsFilter = "moto"; wantsList = wantsList.filter(w => !w.moto); renderWants(); });
  check("filtered empty list offers Show all", (await page.textContent("#wants-pending-card")).includes("Show all"));
  // restoring an older backup resets lists it doesn't have
  const restored = await page.evaluate(() => {
    localStorage.setItem("bills-content", JSON.stringify([{ id: "bill-x", name: "Old", amount: 1, due: "2026-01-01", repeat: "monthly" }]));
    const data = { "todo-content": [] };
    SYNC_KEYS.forEach(k => { if (!(k in data)) localStorage.removeItem(k); });
    applyRemote({ updatedAt: Date.now(), data });
    return bills.length;
  });
  check("restore clears lists the backup doesn't have", restored === 0, restored);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: import link adds data without replacing anything", async () => {
  const k = isoOffset(0).slice(0, 7);
  const payload = { app: "jazz2-budget", month: k, accounts: ["Bank A"],
    bills: [{ name: "Rent", amount: 1000, day: 1, group: "joint", account: "Bank A", paid: true }, { name: "Gym", amount: 20, day: 28 }, { name: "Existing", amount: 5, day: 3 }],
    income: [{ name: "Paycheck", amount: 2000, start: k + "-01", repeat: "biweekly", plans: [{ date: k + "-01", amount: 2100, lines: [{ name: "Card", amount: 300 }] }] }],
    goals: [{ name: "House", target: 5000 }] };
  const hash = "#import=" + Buffer.from(JSON.stringify(payload)).toString("base64url");
  const { ctx, page, errors } = await openApp({ query: hash, seed: { "bills-content": [{ id: "bill-e", name: "Existing", amount: 99, due: k + "-03", repeat: "monthly" }] } });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ bills: bills.map(b => [b.name, b.amount, b.group, b.account]), pays: billPayments.map(p => p.name),
    rentDue: (bills.find(b => b.name === "Rent") || {}).due, pay1: incomeInMonth(budgetMonthKey())[0], goals: budget.goals.map(g => g.name), hash: location.hash, tab: currentTab }));
  check("bills added; same-name bill left alone", r.bills.length === 3 && r.bills.find(b => b[0] === "Existing")[1] === 99 && r.bills.some(b => b[0] === "Rent" && b[2] === "joint" && b[3] === "Bank A"), r.bills);
  check("bills marked paid are logged and moved to next month", r.pays.includes("Rent") && r.rentDue === addMonthsLocal(k), r.rentDue);
  check("paycheck and its plan come in", r.pay1 && r.pay1.amount === 2100 && r.pay1.plan.lines[0].name === "Card", r.pay1);
  check("goal added, link cleared, Budget opened", r.goals.includes("House") && r.hash === "" && r.tab === "budget", r);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: import link switches an existing paycheck to varying pay", async () => {
  const k = isoOffset(0).slice(0, 7);
  const payload = { app: "jazz2-budget", month: k, income: [{ name: "Paycheck", amount: 2000, start: k + "-01", repeat: "biweekly", varies: true,
    plans: [{ date: k + "-01", amount: 2100, received: true }, { date: k + "-15", amount: 2000 }] }] };
  const hash = "#import=" + Buffer.from(JSON.stringify(payload)).toString("base64url");
  const seed = { "budget-content": { categories: [], expenses: [], accounts: [], goals: [],
    income: [{ id: "inc-x", name: "Paycheck", amount: 2000, start: k + "-01", repeat: "biweekly" }],
    plans: { [`inc-x|${k}-01`]: { lines: [{ id: "line-a", name: "Bills", amount: 500 }] } } } };
  const { ctx, page, errors } = await openApp({ query: hash, seed });
  await page.waitForTimeout(400);
  const r = await page.evaluate(k => ({ n: budget.income.length, varies: budget.income[0].varies, p1: budget.plans[`inc-x|${k}-01`], p15: budget.plans[`inc-x|${k}-15`] }), k);
  check("existing paycheck reused and set to vary", r.n === 1 && r.varies === true, r);
  check("payday with lines keeps them; gets its amount and Received", r.p1.amount === 2100 && r.p1.received === true && r.p1.lines.length === 1, r.p1);
  check("expected payday gets its exact amount", r.p15 && r.p15.amount === 2000 && !r.p15.received, r.p15);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: month calendar", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  const k = await page.evaluate(() => {
    const k = budgetMonthKey(), d = n => `${k}-${String(n).padStart(2, "0")}`;
    budget.income = [{ id: "inc-1", name: "Paycheck", amount: 2000, start: d(1), repeat: "biweekly" }];
    bills = [{ id: "bill-a", name: "Rent", amount: 900, due: d(28), repeat: "monthly", autopay: false, link: null, group: "personal", account: null }];
    saveBudgetData();
    return k;
  });
  check("calendar starts as one week", (await page.$$eval("#budget-cal .home-day:not(.blank)", els => els.length)) === 7);
  await page.click("#budget-cal .home-cal-grab");
  const cells = await page.$$eval("#budget-cal .home-day:not(.blank):not(.other)", els => els.length);
  const days = await page.evaluate(k => Number(monthEndIso(k).slice(8)), k);
  check("calendar shows every day of the month", cells === days, [cells, days]);
  check("paydays and bill days are marked", (await page.$$("#budget-cal .marks em.pay")).length >= 2 && (await page.$$("#budget-cal .marks i")).length >= 1);
  await page.click(`#budget-cal .home-day[aria-label^="${await page.evaluate(k => noonOf(k + "-28").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }), k)}"]`);
  check("tapping a day lists its bills", (await page.textContent("#budget-cal .bcal-detail")).includes("Rent"));
  await page.click('#budget-cal .bcal-detail .todo-check[aria-label="Mark paid: Rent"]');
  check("bills can be paid from the calendar", await page.evaluate(() => billPayments.length === 1));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: autopay pays bills on their due date", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget", seed: { "bills-content": [
    { id: "bill-auto", name: "Phone", amount: 70, due: isoOffset(-3), repeat: "monthly", autopay: true, account: null },
    { id: "bill-man", name: "Rent", amount: 900, due: isoOffset(-3), repeat: "monthly", autopay: false, account: null },
    { id: "bill-soon", name: "Gym", amount: 20, due: isoOffset(2), repeat: "monthly", autopay: true, account: null },
  ]}});
  const r = await page.evaluate(() => ({
    pays: billPayments.map(p => [p.name, p.date, !!p.auto]), phoneDue: bills.find(b => b.id === "bill-auto").due,
    rentDue: bills.find(b => b.id === "bill-man").due, gymMeta: [...document.querySelectorAll("#panel-budget .bill-row")].map(e => e.textContent.replace(/\s+/g, " ")).find(t => t.includes("Gym")) }));
  check("a due autopay bill is logged as paid on its due date", r.pays.length === 1 && r.pays[0][0] === "Phone" && r.pays[0][1] === isoOffset(-3) && r.pays[0][2], r.pays);
  check("…and moves to next month; manual bills stay overdue", r.phoneDue > isoOffset(0) && r.rentDue === isoOffset(-3), r);
  check("upcoming autopay bills say so", (r.gymMeta || "").includes("Autopays"), r.gymMeta);
  // un-paying an autopaid bill holds it instead of re-paying it at once
  await page.evaluate(() => unpayBill(billPayments[0].id));
  check("un-paying an autopaid bill sticks", await page.evaluate(() => billPayments.length === 0 && bills.find(b => b.id === "bill-auto").due === addDaysIso(-3)));
  // turning autopay on for an overdue bill pays it
  await page.evaluate(() => editBill("bill-man"));
  await page.check("#modal-autopay");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("switching Autopay on pays what's already due", await page.evaluate(() => billPayments.some(p => p.name === "Rent" && p.auto)));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("refresh stays on the same tab; Wash hair opens its card", async () => {
  const { ctx, page, errors } = await openApp();
  await page.evaluate(() => { skinRoutine.wash = { anchor: addDaysIso(0), everyDays: 14 }; activateTab("home"); renderHome(); });
  await page.click("#panel-home .wash-row .body");
  const w = await page.evaluate(() => ({ tab: currentTab, open: document.getElementById("wash-card").classList.contains("open") }));
  check("tapping Wash hair opens the Wash day card on Skin & Hair", w.tab === "skin" && w.open, w);
  // what hardRefresh leaves behind, then the reload
  await page.evaluate(() => { activateTab("budget"); sessionStorage.setItem("resume-view", JSON.stringify({ tab: currentTab, scroll: 0 })); });
  await page.reload(); await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({ tab: currentTab, panel: document.getElementById("panel-budget").classList.contains("active"), left: sessionStorage.getItem("resume-view") }));
  check("pull-to-refresh comes back to the same tab", r.tab === "budget" && r.panel && r.left === null, r);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await browser.close();
server.close();
console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach(f => console.log("  ✗ " + f));
  process.exit(1);
}
