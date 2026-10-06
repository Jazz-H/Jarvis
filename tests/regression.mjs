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
async function section(name, fn) {
  const before = failures.length;
  try { await fn(); } catch (e) { failures.push(`${name}: threw ${e.message.split("\n")[0]}`); }
  console.log(`${failures.length === before ? "ok  " : "FAIL"}  ${name}`);
}

await section("every tab renders without JS errors (phone + desktop)", async () => {
  for (const phone of [true, false]) {
    const { ctx, page, errors } = await openApp({ phone });
    for (const tab of ["home", "todo", "skin", "style", "wants"]) {
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

  await page.fill("#todo-quick-add-input", "Call mom tomorrow");
  await page.dispatchEvent("#todo-quick-add-input", "input");
  check("date preview chip", ((await page.textContent(".due-hint")) || "").includes("Tomorrow"));
  await page.press("#todo-quick-add-input", "Enter");
  await page.fill("#todo-quick-add-input", "Plan for friday");
  await page.dispatchEvent("#todo-quick-add-input", "input");
  await page.tap(".due-hint button");
  await page.press("#todo-quick-add-input", "Enter");
  const added = await page.evaluate(() => todoList.map(t => [t.text, t.due]));
  check("trailing day word is parsed", added.some(([t, d]) => t === "Call mom" && d === isoOffset(1)), added);
  check("dismissed chip keeps text and no date", added.some(([t, d]) => t === "Plan for friday" && d === null), added);

  await page.tap('[data-todo-id="b"] .title');
  check("tapping text opens edit, does not complete", (await page.textContent("#modal-heading")) === "Edit to-do");
  await page.fill("#modal-subs", "print label\ndrop off");
  await page.focus("#modal-text");
  await page.keyboard.press("Enter");
  const b = await page.evaluate(() => todoList.find(t => t.id === "b"));
  check("edit adds sub-items and Enter saves", !b.done && b.subitems.length === 2, b);

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
      const wash = !!legacy.pmWash && isWashThursday(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
      const exp = s => s.map(x => decodeEntities(x[0]) + "|" + decodeEntities(x[1])).join(",");
      const got = s => s.map(x => x.label + "|" + x.product).join(",");
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
  await page.tap(".modal-btn.primary");
  const days = await page.evaluate(id => JSON.parse(localStorage.getItem("skin-routine-content")).pm.find(s => s.id === id).days, ex);
  check("day chips edit is saved", JSON.stringify(days) === "[2,4]", days);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("wardrobe: needs move onto Wants, belt merges, buy puts it in the closet", async () => {
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
  check("bought wardrobe item is in the closet", await page.evaluate(() => closetItems().some(c => c.title === "Structured blazer")));
  await page.evaluate(() => toggleWant("w-need-blazer"));
  check("un-buying removes it", await page.evaluate(() => !closetItems().some(c => c.title === "Structured blazer")));
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
  check("backup holds 11 lists", Object.keys(backup.data).length === 11, Object.keys(backup.data));
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
    openPinned.add("rules-skin"); openPinned.add("rules-style"); openPinned.add("sizes-card"); expandedTodos.add(todoList[0].id);
    renderSkin(); renderStyle(); renderWants(); renderHome();
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

await section("home: to-do summary completes in place", async () => {
  const { ctx, page } = await openApp({ seed: { "todo-content": [
    { id: "a", text: "Due today", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
  ]}});
  await page.tap(".todo-glance .todo-check");
  check("completed from Home", await page.evaluate(() => todoList[0].done));
  check("still on Home", (await page.textContent("#headline")) === "Home");
  await ctx.close();
});

await browser.close();
server.close();
console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach(f => console.log("  ✗ " + f));
  process.exit(1);
}
