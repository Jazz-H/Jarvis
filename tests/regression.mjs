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
const TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function resolveRepoFile(pathname) {
  const file = path.resolve(ROOT, `.${pathname}`);
  const relative = path.relative(ROOT, file);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("outside root");
  }
  return file;
}

const server = http.createServer(async (req, res) => {
  try {
    const file = resolveRepoFile(decodeURIComponent(new URL(req.url, "http://localhost").pathname));
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const APP = `http://127.0.0.1:${server.address().port}/jazz2.0.html`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const failures = [];
let passed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` — got ${JSON.stringify(detail)}`}`);
}
const isoOffset = (n) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
// n days away but kept inside this month / this Sun–Sat week, so tests that read one month's
// tables or the week strip don't break near month-end or on weekends
const isoInMonth = (n) => (isoOffset(n).slice(0, 7) === isoOffset(0).slice(0, 7) ? isoOffset(n) : isoOffset(-n));
const isoInWeek = (n) => (new Date().getDay() + n <= 6 ? isoOffset(n) : isoOffset(-n));

// A fresh browser profile seeded with localStorage, plus a JS-error collector.
async function openApp({ seed = {}, phone = true, query = "", route } = {}) {
  const ctx = await browser.newContext(
    phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1280, height: 800 } },
  );
  if (route) await ctx.route("https://api.github.com/**", route);
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  }, seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(APP + query);
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}
function addMonthsLocal(k) {
  const [y, m] = k.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
// On Home the + button shows once the Planner is on screen (homeWatchPlanner); scroll there first
async function showFab(page) {
  if (!(await page.evaluate(() => document.body.dataset.tab === "home"))) return;
  await page.evaluate(() => document.querySelector("#panel-home .jv-planner-label").scrollIntoView());
  await page.waitForFunction(() => document.body.classList.contains("home-fab"));
  await page.waitForTimeout(250); // fade-in
}
async function section(name, fn) {
  const before = failures.length;
  try {
    await fn();
  } catch (e) {
    failures.push(`${name}: threw ${e.message.split("\n")[0]}`);
  }
  console.log(`${failures.length === before ? "ok  " : "FAIL"}  ${name}`);
}

await section("test server confines requested files to the repository root", async () => {
  check("normal app paths resolve", resolveRepoFile("/jazz2.0.html") === path.join(ROOT, "jazz2.0.html"));
  let rejected = false;
  try {
    resolveRepoFile("/../Jazz2.0-sibling/secret");
  } catch {
    rejected = true;
  }
  check("prefix-matching sibling paths are rejected", rejected);
});

await section("every tab renders without JS errors (phone + desktop)", async () => {
  for (const phone of [true, false]) {
    const { ctx, page, errors } = await openApp({ phone });
    for (const tab of ["home", "todo", "skin", "wants", "budget"]) {
      await page.evaluate((t) => activateTab(t), tab);
      check(`headline for ${tab}`, (await page.textContent("#headline")).length > 0);
    }
    check(`no JS errors (${phone ? "phone" : "desktop"})`, errors.length === 0, errors);
    await ctx.close();
  }
});

await section("to-do: legacy weekday migration, date parsing, completion + undo, edit", async () => {
  const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const { ctx, page, errors } = await openApp({
    query: "?tab=todo",
    seed: {
      "data-updated-at": "111",
      "todo-content": [
        {
          id: "a",
          text: "Renew registration",
          done: false,
          day: todayName,
          starred: false,
          subitems: [],
          completedAt: null,
        },
        { id: "b", text: "Return package", done: false, day: null, starred: false, subitems: [], completedAt: null },
      ],
    },
  });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("todo-content")));
  check("weekday migrates to today's date", stored[0].due === isoOffset(0) && !("day" in stored[0]), stored[0]);
  check(
    "migration does not bump the sync timestamp",
    (await page.evaluate(() => localStorage.getItem("data-updated-at"))) === "111",
  );

  // composer: the floating + button opens it; it stays open for several adds
  await showFab(page);
  await page.tap("#fab");
  check(
    "+ opens the composer with the text box focused",
    await page.evaluate(
      () =>
        document.getElementById("composer").classList.contains("open") && document.activeElement.id === "composer-text",
    ),
  );
  await page.fill("#composer-text", "Call mom tomorrow");
  check(
    "typed day lights up its chip",
    ((await page.textContent("#composer-chips .filter-chip.on")) || "").includes("Tomorrow"),
  );
  await page.press("#composer-text", "Enter");
  check(
    "Enter adds and keeps the composer open for the next one",
    await page.evaluate(
      () =>
        document.getElementById("composer").classList.contains("open") &&
        document.getElementById("composer-text").value === "",
    ),
  );
  check(
    "added counter names the date",
    (await page.textContent("#composer-count")) === "1 added · last for Tomorrow",
    await page.textContent("#composer-count"),
  );
  await page.fill("#composer-text", "Plan for friday");
  await page.click("#composer-chips .filter-chip.on"); // tap the lit chip: keep the words, no date
  await page.press("#composer-text", "Enter");
  await page.fill("#composer-text", "Pay rent");
  await page.click("#composer-chips .filter-chip >> text=Today");
  await page.click("#composer-chips .filter-chip >> text=Star");
  await page.click("#composer-chips .filter-chip >> text=Sub-items");
  await page.fill("#composer-subs", "log in\ntransfer");
  await page.click(".composer-add");
  await page.click(".composer-add"); // empty: no-op, refocuses
  const added = await page.evaluate(() => todoList.map((t) => [t.text, t.due, t.starred, (t.subitems || []).length]));
  check(
    "trailing day word is parsed",
    added.some(([t, d]) => t === "Call mom" && d === isoOffset(1)),
    added,
  );
  check(
    "dismissed chip keeps text and no date",
    added.some(([t, d]) => t === "Plan for friday" && d === null),
    added,
  );
  check(
    "chips set date, star, and sub-items",
    added.some(([t, d, st, n]) => t === "Pay rent" && d === isoOffset(0) && st && n === 2),
    added,
  );
  check("empty Add creates nothing", added.length === 5, added.length);
  check("to-dos are capped at 200 characters", (await page.getAttribute("#composer-text", "maxlength")) === "200");
  await page.keyboard.press("Escape");
  check(
    "Esc closes the composer",
    await page.evaluate(() => !document.getElementById("composer").classList.contains("open")),
  );

  await page.tap('#todo-list [data-todo-id="b"] .title');
  check("tapping text opens edit, does not complete", (await page.textContent("#modal-heading")) === "Edit to-do");
  check("sub-items fold away until asked for", !(await page.isVisible("#modal-subs")));
  await page.click("#modal-body .tde-subs-toggle");
  await page.fill("#modal-subs", "print label\ndrop off");
  await page.focus("#modal-text");
  await page.keyboard.press("Enter");
  const b = await page.evaluate(() => todoList.find((t) => t.id === "b"));
  check("edit adds sub-items and Enter saves", !b.done && b.subitems.length === 2, b);

  // When chips: Anytime / Today / Tomorrow / a date
  await page.evaluate(() => {
    const t = todoList.find((t) => t.id === "b");
    t.due = addDaysIso(3);
    editTodo("b");
  });
  check(
    "dated to-do: its date chip is on, Anytime off",
    await page.evaluate(
      () =>
        !!document.querySelector("#tde .tde-date.on") &&
        !document.querySelector('#tde .filter-chip.on[aria-pressed="true"]')?.textContent.includes("Anytime"),
    ),
  );
  await page.click("#tde .filter-chip >> text=Anytime");
  check("Anytime hides the multi-day option", !(await page.$("#tde .tde-span")));
  await page.click("#modal-backdrop .modal-btn.primary");
  check("saved as Anytime: no date", await page.evaluate(() => todoList.find((t) => t.id === "b").due === null));
  await page.evaluate(() => editTodo("b"));
  check(
    "undated to-do opens with Anytime on",
    (await page.textContent('#tde .filter-chip[aria-pressed="true"]')) === "Anytime",
  );
  await page.click("#tde .filter-chip >> text=Tomorrow");
  check("summary reads the choice back", (await page.textContent("#tde .tde-sum")).length > 3);
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "Tomorrow chip saves tomorrow",
    await page.evaluate(() => todoList.find((t) => t.id === "b").due === addDaysIso(1)),
  );
  await page.evaluate(() => editTodo("b"));
  await page.fill("#modal-due", await page.evaluate(() => addDaysIso(2)));
  await page.dispatchEvent("#modal-due", "change");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("picking a date saves it", await page.evaluate(() => todoList.find((t) => t.id === "b").due === addDaysIso(2)));

  await page.tap('#todo-list [data-todo-id="b"] .todo-check');
  check("checkbox completes", await page.evaluate(() => todoList.find((t) => t.id === "b").done));
  await page.tap(".toast-action");
  check("undo restores", await page.evaluate(() => !todoList.find((t) => t.id === "b").done));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("to-do: drag into another date group sets the date (desktop mouse)", async () => {
  const { ctx, page } = await openApp({
    phone: false,
    query: "?tab=todo",
    seed: {
      "todo-content": [
        { id: "x", text: "Undated", done: false, due: null, starred: false, subitems: [], completedAt: null },
        {
          id: "y",
          text: "Tomorrow thing",
          done: false,
          due: isoOffset(1),
          starred: false,
          subitems: [],
          completedAt: null,
        },
      ],
    },
  });
  const h = await page.locator('#todo-list [data-todo-id="x"] .title').boundingBox();
  const t = await page.locator('#todo-list .todo-wrap[data-todo-id="y"]').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, t.y + t.height + 6, { steps: 15 });
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(250);
  const due = await page.evaluate(() => todoList.find((t) => t.id === "x").due);
  check("dropped under Tomorrow", due === isoOffset(1), due);
  await ctx.close();
});

await section("to-do: completed items archive after 7 days, quietly", async () => {
  const { ctx, page } = await openApp({
    seed: {
      "data-updated-at": "111",
      "todo-content": [
        {
          id: "o",
          text: "Old",
          done: true,
          due: null,
          starred: false,
          subitems: [],
          completedAt: Date.now() - 10 * 864e5,
        },
        {
          id: "n",
          text: "New",
          done: true,
          due: null,
          starred: false,
          subitems: [],
          completedAt: Date.now() - 2 * 864e5,
        },
      ],
    },
  });
  const r = await page.evaluate(() => ({
    list: todoList.map((t) => t.id),
    archive: loadContent("todo-archive-content", []).map((a) => a.text),
    stamp: localStorage.getItem("data-updated-at"),
  }));
  check("old item archived, recent kept", JSON.stringify(r.list) === '["n"]' && r.archive[0] === "Old", r);
  check("archiving does not bump the sync timestamp", r.stamp === "111", r.stamp);
  await ctx.close();
});

await section("routine: merged routine matches the old per-day lists for 28 days", async () => {
  const { ctx, page } = await openApp();
  const fails = await page.evaluate(() => {
    const bad = [];
    for (let n = -7; n < 21; n++) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + n);
      const legacy = DEFAULT_SKIN_DAYS.find((x) => x.day === WEEKDAYS[d.getDay()]);
      // the original rule, computed independently: every other Thursday from Jul 16 2026
      const weeks = Math.round(
        (new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(2026, 6, 16)) / (7 * 864e5),
      );
      const wash = !!legacy.pmWash && ((weeks % 2) + 2) % 2 === 0;
      const exp = (s) => s.map((x) => decodeEntities(x[0]) + "|" + decodeEntities(x[1])).join(",");
      const added = new Set(ROUTINE_ADDITIONS.map((x) => x.step.id)); // later additions aren't in the legacy lists
      const got = (s) =>
        s
          .filter((x) => !added.has(x.id))
          .map((x) => x.label + "|" + x.product)
          .join(",");
      const r = routineForDate(d);
      if (exp(legacy.am) !== got(r.am) || exp(wash ? legacy.pmWash : legacy.pm) !== got(r.pm) || r.wash !== wash)
        bad.push(isoDate(d));
    }
    return bad;
  });
  check("identical on every date", fails.length === 0, fails);
  await ctx.close();
});

await section("routine: check-offs, toast, streak, editing days", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=skin",
    seed: {
      "routine-checks": {
        [isoOffset(-1)]: { am: [], pm: [], amDone: true, pmDone: true },
        [isoOffset(-2)]: { am: [], pm: [], amDone: true, pmDone: true },
      },
    },
  });
  check(
    "streak counts yesterday and the day before",
    ((await page.textContent(".routine-today .insight")) || "").includes("2-day"),
  );
  const steps = page.locator(".routine-band.am .routine-step");
  for (let i = 0, n = await steps.count(); i < n; i++) await steps.nth(i).tap();
  check("finishing AM shows toast", ((await page.textContent(".toast")) || "").includes("Morning routine done"));
  check("AM marked done", await page.evaluate(() => todayChecks().amDone));
  const ex = await page.evaluate(() => {
    const s = skinRoutine.pm.find((x) => x.label === "Exfoliate");
    editRoutineStep("pm", s.id);
    return s.id;
  });
  for (const d of ["1", "3", "5", "2", "4"])
    await page.locator(`#modal-days input[value="${d}"]`).evaluate((i) => i.click());
  await page.tap("#modal-backdrop .modal-btn.primary");
  const days = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem("skin-routine-content")).pm.find((s) => s.id === id).days,
    ex,
  );
  check("day chips edit is saved", JSON.stringify(days) === "[2,4]", days);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("wash day: pick a date on the calendar, change frequency, undo", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=skin" });
  await page.evaluate(() => {
    openPinned.add("wash-card");
    renderSkin();
  });
  const before = await page.evaluate(() => ({
    sched: washSchedule(),
    marked: document.querySelectorAll("#wash-card .cal-day.wash").length,
  }));
  check(
    "defaults to every 2 weeks from Jul 16",
    before.sched.anchor === "2026-07-16" && before.sched.everyDays === 14,
    before.sched,
  );
  check("calendar marks wash days", before.marked >= 2, before.marked);
  const target = isoOffset(2);
  await page.evaluate((iso) => setWashDate(iso), target);
  const after = await page.evaluate(
    (iso) => ({
      wash: routineForDate(noonOf(iso)).wash,
      stored: JSON.parse(localStorage.getItem("skin-routine-content")).wash,
      twoWeeksLater: isWashDate(noonOf(addDaysIso(16))),
      dayAfter: isWashDate(noonOf(addDaysIso(3))),
    }),
    target,
  );
  check("picked date becomes a wash day", after.wash, after);
  check("schedule saved with the routine", after.stored && after.stored.anchor === target, after.stored);
  check("repeats every 2 weeks from the picked date", after.twoWeeksLater && !after.dayAfter, after);
  await page.evaluate(() => setWashFrequency(7));
  check(
    "frequency change",
    await page.evaluate((iso) => washSchedule().everyDays === 7 && isWashDate(noonOf(addDaysIso(9))), target),
  );
  await page.tap(".toast-action");
  check("undo restores the previous schedule", await page.evaluate(() => washSchedule().everyDays === 14));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("wants: need/want tags, sorting, filters, editing", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=wants" });
  const r = await page.evaluate(() => ({
    beltKind: wantKind(wantsList.find((w) => w.id === "belt-brown")),
    pouchKind: wantKind(wantsList.find((w) => w.id === "pouch")),
    tags: document.querySelectorAll("#wants-pending-card .badge.kind-need, #wants-pending-card .badge.kind-want")
      .length,
    cards: document.querySelectorAll("#wants-pending-card .want-card").length,
    order: wantsList
      .filter((w) => !wantsState[w.id])
      .sort(wantsOrder)
      .map(wantKind),
  }));
  check("wardrobe items default to need, others to want", r.beltKind === "need" && r.pouchKind === "want", r);
  check("every item shows a tag", r.tags === r.cards && r.cards > 0, r);
  check("needs sort before wants", r.order.join(",") === [...r.order].sort().join(","), r.order);
  await page.click(".filter-chip >> text=Needs");
  const needsOnly = await page.$$eval("#wants-pending-card .want-card .badge.kind-want", (e) => e.length);
  check("Needs filter hides wants", needsOnly === 0, needsOnly);
  await showFab(page);
  await page.tap("#fab");
  await page.fill("#composer-text", "Phone charger");
  await page.press("#composer-text", "Enter");
  await page.keyboard.press("Escape");
  check(
    "adding under the Needs filter makes a need",
    await page.evaluate(() => wantKind(wantsList.find((w) => w.name === "Phone charger")) === "need"),
  );
  await page.evaluate(() => editWant("pouch"));
  await page.selectOption("#modal-kind", "Need");
  await page.tap("#modal-backdrop .modal-btn.primary");
  check(
    "tag changed in the edit form is saved",
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("wants-content")).find((w) => w.id === "pouch").kind === "need",
    ),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("shopping: page name and Moto category", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=wants" });
  check("page is titled Shopping", (await page.textContent("#headline")) === "Shopping");
  check(
    "tab is labeled Shopping",
    (await page.textContent('nav.tabbar button[data-tab="wants"]')).trim() === "Shopping",
  );
  await page.evaluate(() => editWant("pouch"));
  await page.selectOption("#modal-cat", "Moto");
  await page.tap("#modal-backdrop .modal-btn.primary");
  const h = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("wants-content")).find((w) => w.id === "pouch"),
  );
  check("Moto category saved", h.moto === true && !h.wardrobeCat, h);
  check(
    "Moto tag shown",
    (await page.locator("#wants-pending-card .want-card", { hasText: "Trailco" }).locator(".want-tag.moto").count()) ===
      1,
  );
  await page.click(".filter-chip >> text=Moto");
  const names = await page.$$eval("#wants-pending-card .want-card .name", (e) => e.map((x) => x.textContent));
  check("Moto filter shows only moto gear", names.length === 1 && names[0].startsWith("Trailco"), names);
  await showFab(page);
  await page.tap("#fab");
  await page.fill("#composer-text", "Riding gloves");
  await page.press("#composer-text", "Enter");
  await page.keyboard.press("Escape");
  check(
    "adding under the Moto filter makes moto gear",
    await page.evaluate(() => wantsList.find((w) => w.name === "Riding gloves").moto === true),
  );
  await page.evaluate(() => editWant("pouch"));
  await page.selectOption("#modal-cat", "Wardrobe · Outerwear");
  await page.tap("#modal-backdrop .modal-btn.primary");
  const h2 = await page.evaluate(() => wantsList.find((w) => w.id === "pouch"));
  check("categories are exclusive", !h2.moto && h2.wardrobeCat === "Outerwear", h2);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("wardrobe: needs move onto Wants, belt merges", async () => {
  const { ctx, page, errors } = await openApp({
    seed: { "style-state": { "tee-plum": "needed", "need-oxford": "owned" } },
  });
  const s = await page.evaluate(() => ({
    capsuleNeeded: capsule.filter((i) => i.state === "needed").length,
    plumMoved: wantsList.some((w) => w.id === "w-tee-plum"),
    oxfordKept: capsule.some((i) => i.id === "need-oxford"),
    belts: wantsList.filter((w) => /brown/i.test(w.name) && /belt/i.test(w.name)).length,
    styleState: Object.keys(styleState).length,
    snapshot: JSON.stringify([capsule, wantsList]),
  }));
  check("no needed items left in the capsule", s.capsuleNeeded === 0, s.capsuleNeeded);
  check("old toggles respected", s.plumMoved && s.oxfordKept, s);
  check("duplicate belt merged", s.belts === 1, s.belts);
  check("style-state cleared", s.styleState === 0);
  await page.reload();
  await page.waitForTimeout(500);
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
    URL.createObjectURL = (blob) => {
      captured = blob;
      return orig.call(URL, blob);
    };
    navigator.canShare = undefined;
    return downloadBackup()
      .then(() => captured.text())
      .then(JSON.parse);
  });
  check(
    "backup holds 16 lists (incl. bills, budget, fitness, plan)",
    Object.keys(backup.data).length === 16 &&
      "budget-content" in backup.data &&
      "fitness-content" in backup.data &&
      "plan3-content" in backup.data,
    Object.keys(backup.data),
  );
  backup.data["todo-content"] = [
    { id: "r1", text: "Restored", done: false, due: null, starred: false, subitems: [], completedAt: null },
  ];
  await page.evaluate(() => openSyncModal());
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("text=Restore…")]);
  await chooser.setFiles({ name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await page.waitForTimeout(300);
  check("restore applied", await page.evaluate(() => todoList.length === 1 && todoList[0].text === "Restored"));
  await page.evaluate(() => openSyncModal());
  const [chooser2] = await Promise.all([page.waitForEvent("filechooser"), page.click("text=Restore…")]);
  await chooser2.setFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await page.waitForTimeout(200);
  check("junk file rejected", ((await page.textContent(".toast")) || "").includes("isn't a Jazz backup"));
  await ctx.close();
});

await section("sync: stale device takes newer remote data; old-format remote migrates", async () => {
  const now = Date.now();
  const gist = {
    id: "g0",
    files: {
      "jazz2-data.json": {
        truncated: false,
        content: JSON.stringify({
          updatedAt: now,
          data: {
            "todo-content": [
              {
                id: "p1",
                text: "Phone edit",
                done: false,
                day: "Friday",
                starred: false,
                subitems: [],
                completedAt: null,
              },
            ],
          },
        }),
      },
    },
  };
  const route = async (r) => {
    const req = r.request(),
      url = new URL(req.url());
    const json = (status, body) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/gists" && req.method() === "GET") return json(200, [gist]);
    if (url.pathname === "/gists/g0" && req.method() === "GET") return json(200, gist);
    if (url.pathname === "/gists/g0" && req.method() === "PATCH") {
      Object.entries(JSON.parse(req.postData()).files).forEach(([n, f]) => {
        gist.files[n] = { truncated: false, content: f.content };
      });
      return json(200, gist);
    }
    return json(404, {});
  };
  const { ctx, page, errors } = await openApp({
    route,
    seed: {
      "sync-token": "tok",
      "sync-gist-id": "g0",
      "data-updated-at": String(now - 30 * 864e5),
      "todo-content": [
        { id: "s1", text: "Stale", done: false, due: null, starred: false, subitems: [], completedAt: null },
        {
          id: "s2",
          text: "Old done",
          done: true,
          due: null,
          starred: false,
          subitems: [],
          completedAt: now - 20 * 864e5,
        },
      ],
    },
  });
  await page.waitForTimeout(800);
  const local = await page.evaluate(() => todoList.map((t) => [t.text, t.due]));
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
    applyRemote({
      updatedAt: Date.now(),
      data: {
        "wants-content": [
          { id: evilId, name: evil, meta: evil, price: 1, link: "javascript:window.__pwned++", wardrobeCat: evil },
        ],
        "wants-state": {},
        "skin-rules-content": [evil],
        "style-rules-content": [evil],
        "sizes-content": [[evil, evil]],
        "capsule-content": [
          { id: "c1", title: evil, sub: evil, cat: evil, state: "owned", link: "javascript:window.__pwned++" },
        ],
        "todo-content": [
          {
            id: evilId,
            text: evil,
            done: false,
            due: null,
            starred: false,
            subitems: [{ id: evilId, text: evil, done: false }],
            completedAt: null,
          },
        ],
      },
    });
    openPinned.add("rules-skin");
    expandedTodos.add(todoList[0].id);
    renderSkin();
    renderWants();
    renderHome();
    await new Promise((r) => setTimeout(r, 300));
    document.querySelectorAll("[onclick]").forEach((el) => {
      if (el.getAttribute("onclick").includes("pwned")) el.click();
    });
    return {
      pwned: window.__pwned,
      jsLinks: [...document.querySelectorAll("a[href]")].filter((a) => /^\s*javascript:/i.test(a.getAttribute("href")))
        .length,
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
  check("+ is hidden at the top of Home (Quick add is there)", !(await page.isVisible("#fab")));
  await showFab(page);
  check("+ shows on Home once the Planner is on screen", await page.isVisible("#fab"));
  await page.evaluate(() => activateTab("skin"));
  check("+ hidden on Beauty", !(await page.isVisible("#fab")));
  const labels = await page.evaluate(() =>
    ["home", "todo", "wants", "budget"].map((t) => {
      activateTab(t);
      return document.getElementById("fab").getAttribute("aria-label");
    }),
  );
  check(
    "+ is labeled for each tab",
    labels.join("|") === "Add a to-do|Add a to-do|Add to shopping list|Add spending or a bill",
    labels,
  );
  await page.evaluate(() => activateTab("home"));
  await showFab(page);
  await page.tap("#fab");
  await page.fill("#composer-text", "From home");
  await page.press("#composer-text", "Enter");
  check("adding from Home works", await page.evaluate(() => todoList.some((t) => t.text === "From home")));
  await ctx.close();
  const shortcut = await openApp({ query: "?tab=todo&action=addtodo" });
  check(
    "Add a to-do shortcut opens the composer",
    await shortcut.page.evaluate(() => document.getElementById("composer").classList.contains("open")),
  );
  await shortcut.ctx.close();
});

await section("composer: shopping items (price, category, details, batches)", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=wants" });
  await showFab(page);
  await page.tap("#fab");
  check("+ opens the New item sheet", (await page.textContent("#composer-heading")) === "New item");
  check(
    "price and link fields show up front",
    (await page.isVisible("#cx-price")) && (await page.isVisible("#cx-link")),
  );
  await page.fill("#composer-text", "Helmet $250");
  check(
    "typed price lights a chip",
    ((await page.textContent("#composer-chips .filter-chip.on")) || "").includes("$250.00"),
  );
  await page.click("#composer-chips .filter-chip >> text=Moto");
  await page.press("#composer-text", "Enter");
  await page.fill("#composer-text", "Gloves"); // category sticks for the next add
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
  const items = await page.evaluate(() => wantsList.slice(-3).map((w) => ({ ...w, effKind: wantKind(w) })));
  const [helmet, gloves, shirt] = items;
  check("price parsed off the name", helmet.name === "Helmet" && helmet.price === 250 && helmet.moto === true, helmet);
  check(
    "category sticks between adds; details saved",
    gloves.moto === true &&
      gloves.price === 45 &&
      gloves.link === "https://example.com/gloves" &&
      gloves.meta === "Size S",
    gloves,
  );
  check(
    "dismissed price, wardrobe category, high priority",
    shirt.name === "Shirt $20" &&
      shirt.price === null &&
      shirt.wardrobeCat === "Tops" &&
      shirt.priority === "high" &&
      shirt.effKind === "need",
    shirt,
  );
  check(
    "counter",
    (await page.textContent("#composer-count")) === "3 added",
    await page.textContent("#composer-count"),
  );
  check(
    "price and link clear after each add",
    (await page.inputValue("#cx-price")) === "" && (await page.inputValue("#cx-link")) === "",
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("home: day agenda completes in place", async () => {
  const { ctx, page } = await openApp({
    seed: {
      "todo-content": [
        { id: "a", text: "Due today", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
      ],
    },
  });
  await page.evaluate(() => {
    skinRoutine.washPm = [];
    renderHome();
  }); // no Wash hair row, whatever day the suite runs
  await page.tap('#panel-home .home-list .todo-check[aria-label="Complete: Due today"]');
  check("completed from Home", await page.evaluate(() => todoList[0].done));
  check("still on Home", (await page.textContent("#headline")) === "Home");
  const r = await page.evaluate(() => ({
    struck:
      !document.querySelector('#panel-home .home-list .todo-check[aria-label="Mark not done: Due today"]') &&
      document.querySelector("#panel-home").textContent.includes("All done · 1 to-do finished"),
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
    const names = (iso) => holidaysOn(iso).map((x) => x.name);
    return {
      thx26: names("2026-11-26"),
      obs4th: names("2026-07-03"),
      easter26: names("2026-04-05"),
      easter27: names("2027-03-28"),
      jun27: names("2027-06-18"),
      nye27: names("2027-12-31"),
      mlk27: names("2027-01-18"),
      fedMom: holidaysOn("2026-05-10")[0].federal,
      count26: Object.values(holidaysOf(2026)).flat().length,
    };
  });
  check(
    "federal holidays by rule (Thanksgiving, MLK Day)",
    h.thx26.includes("Thanksgiving") && h.mlk27.includes("Martin Luther King Jr. Day"),
    h,
  );
  check(
    "weekend holidays get their observed weekday",
    h.obs4th.includes("Independence Day (observed)") &&
      h.jun27.includes("Juneteenth (observed)") &&
      h.nye27.includes("New Year's Day (observed)"),
    h,
  );
  check("Easter computed for 2026 and 2027", h.easter26.includes("Easter") && h.easter27.includes("Easter"), h);
  check("observances aren't marked as bank holidays", h.fedMom === false && h.count26 === 21, h);
  // Home: the day shows its holiday, and the calendar marks it
  await page.evaluate(() => selectHomeDate("2026-11-26"));
  const home = await page.evaluate(() => ({
    chip: (document.querySelector("#panel-home .home-hero .holiday-chip") || {}).textContent || "",
    cell: !!document.querySelector('#panel-home .home-day.holiday[aria-label*="Thanksgiving"]'),
  }));
  check("Home day shows the holiday", home.chip.includes("Thanksgiving") && home.chip.includes("banks closed"), home);
  check("Home calendar marks the holiday", home.cell, home);
  // Budget: federal holidays only
  await page.evaluate(() => {
    activateTab("budget");
    const t = addDaysIso(0);
    budgetMonthOffset = (2026 - Number(t.slice(0, 4))) * 12 + (10 - Number(t.slice(5, 7)));
    openPinned.add("budget-cal");
    renderBudget();
    selectBudgetDay("2026-10-12");
  });
  const bud = await page.evaluate(() => ({
    chip: (document.querySelector("#budget-cal .holiday-chip") || {}).textContent || "",
  }));
  check("Budget calendar notes bank holidays", bud.chip.includes("Columbus Day"), bud);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("home: calendar strip picks any day", async () => {
  const { ctx, page, errors } = await openApp({
    seed: {
      "todo-content": [
        {
          id: "o",
          text: "Late thing",
          done: false,
          due: isoOffset(-2),
          starred: false,
          subitems: [],
          completedAt: null,
        },
        {
          id: "t",
          text: "Today thing",
          done: false,
          due: isoOffset(0),
          starred: false,
          subitems: [],
          completedAt: null,
        },
        {
          id: "s",
          text: "Starred today",
          done: false,
          due: isoOffset(0),
          starred: true,
          subitems: [],
          completedAt: null,
        },
        {
          id: "f",
          text: "Far thing",
          done: false,
          due: isoOffset(40),
          starred: false,
          subitems: [],
          completedAt: null,
        },
        { id: "n", text: "Whenever", done: false, due: null, starred: false, subitems: [], completedAt: null },
      ],
    },
  });
  const titles = () =>
    page.$$eval("#panel-home .home-list .todo-wrap .title", (els) => els.map((e) => e.textContent.trim()));
  const wk = await page.evaluate(() => {
    const first = document.querySelector("#panel-home .home-week .home-day");
    return first && first.getAttribute("aria-label");
  });
  check("week strip starts on Sunday", /^Sunday/.test(wk || ""), wk);
  const lead = await page.evaluate(() => {
    setHomeCalOpen(true);
    const first = noonOf(homeSelected().slice(0, 8) + "01");
    const other = [...document.querySelectorAll("#panel-home .home-month .home-day.other")].map(
      (e) => e.textContent.trim().split(/\s/)[0],
    );
    const r = {
      n: other.length,
      want: first.getDay(),
      lastPrev: other[other.length - 1],
      prevEnd: String(new Date(first.getFullYear(), first.getMonth(), 0).getDate()),
    };
    setHomeCalOpen(false);
    return r;
  });
  check(
    "month view fills the first week with last month's days, greyed",
    lead.n === lead.want && (lead.n === 0 || lead.lastPrev === lead.prevEnd),
    lead,
  );
  const today = await page.evaluate(() => ({
    days: document.querySelectorAll(".home-week .home-day").length,
    secs: [...document.querySelectorAll(".home-sec")].map((e) => e.textContent),
    dots: document.querySelector(".home-day.today").querySelectorAll(".marks i").length,
  }));
  check("seven days in the strip", today.days === 7, today.days);
  check(
    "today shows Overdue, Today, Anytime",
    JSON.stringify(today.secs) === '["Overdue","Today","Anytime"]',
    today.secs,
  );
  check("today's dots count overdue + due", today.dots === 3, today.dots);
  const t0 = await titles();
  check("starred floats to the top of Today", t0.indexOf("Starred today") < t0.indexOf("Today thing"), t0);
  check("later items stay off today", !t0.includes("Far thing"), t0);

  // Swipes on the strip: down opens the month, sideways pages, up closes
  const swipe = (dx, dy) =>
    page.evaluate(
      ([dx, dy]) => {
        const el = document.querySelector(".home-cal"),
          r = el.getBoundingClientRect();
        const x = r.left + r.width / 2,
          y = r.top + 40;
        const t = (cx, cy) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
        el.dispatchEvent(
          new TouchEvent("touchstart", {
            bubbles: true,
            cancelable: true,
            touches: [t(x, y)],
            changedTouches: [t(x, y)],
          }),
        );
        el.dispatchEvent(
          new TouchEvent("touchmove", {
            bubbles: true,
            cancelable: true,
            touches: [t(x + dx, y + dy)],
            changedTouches: [t(x + dx, y + dy)],
          }),
        );
        el.dispatchEvent(
          new TouchEvent("touchend", {
            bubbles: true,
            cancelable: true,
            touches: [],
            changedTouches: [t(x + dx, y + dy)],
          }),
        );
      },
      [dx, dy],
    );
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
  check(
    "swipe up closes back to the week",
    await page.evaluate(
      () => !document.querySelector("#panel-home .home-month") && !!document.querySelector(".home-week"),
    ),
  );

  // Pick a date 40 days out from the month view
  await page.click(".home-cal-grab");
  const label = await page.evaluate(() =>
    noonOf(addDaysIso(40)).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
  );
  for (let i = 0; i < 3 && !(await page.$(`.home-day[aria-label^="${label}:"]`)); i++)
    await page.click('.cal-nav[aria-label="Next month"]');
  const cell = `.home-day[aria-label^="${label}:"]`;
  check("far date has a dot", (await page.$$eval(`${cell} .marks i`, (els) => els.length)) === 1);
  await page.click(cell);
  check("picking a far date shows its to-dos", JSON.stringify(await titles()) === '["Far thing"]', await titles());
  check("Today button appears away from today", !!(await page.$(".home-cal-today")));
  await showFab(page);
  await page.click("#fab");
  const due = await page.evaluate(() => composerDue().due);
  check("+ on a picked day presets that date", due === isoOffset(40), due);
  await page.fill("#composer-text", "Planned add");
  await page.press("#composer-text", "Enter");
  const added = await page.evaluate(() => todoList.find((t) => t.text === "Planned add").due === addDaysIso(40));
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
  const state = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".routine-today .routine-band")].map((b) => ({
        open: b.querySelector(".routine-band-head").getAttribute("aria-expanded") === "true",
        steps: b.querySelectorAll(".routine-step").length,
      })),
    );
  let s = await state();
  check(
    "bands start open while unfinished",
    s.every((b) => b.open && b.steps > 0),
    s,
  );
  await page.click(".routine-today .routine-band.am .routine-band-head");
  s = await state();
  check("tapping the AM header collapses it", !s[0].open && s[0].steps === 0 && s[1].open, s);
  await page.click(".routine-today .routine-band.am .routine-band-head");
  check("tapping again reopens it", (await state())[0].open);
  // Finishing PM folds it away on its own
  await page.evaluate(() => {
    const r = routineForDate(new Date());
    r.pm.forEach((st) => toggleRoutineStep("pm", st.id));
  });
  s = await state();
  check("a finished band closes itself", !s[1].open && s[1].steps === 0, s);
  check(
    "finished band reads Done",
    (await page.textContent(".routine-today .routine-band.pm .routine-count")).includes("Done"),
  );
  await page.click(".routine-today .routine-band.pm .routine-band-head");
  check("a finished band can be reopened", (await state())[1].open);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("routine: pore strips + teeth whitening added once", async () => {
  // A routine saved before the additions existed (no `added` marker)
  const saved = {
    am: [{ id: "am-1", label: "Cleanse", product: "Gel" }],
    pm: [
      { id: "pm-1", label: "Cleanse", product: "Gel" },
      { id: "pm-2", label: "Moisturize", product: "Cream" },
    ],
    washPm: [],
  };
  const { ctx, page, errors } = await openApp({ seed: { "skin-routine-content": saved } });
  const pm = () => page.evaluate(() => skinRoutine.pm.map((x) => x.id));
  check(
    "whitening first, pore strips after Cleanse",
    JSON.stringify(await pm()) === '["pm-teeth-whitening","pm-1","pm-pore-strips","pm-2"]',
    await pm(),
  );
  const r = await page.evaluate(() => {
    const on = (dow, id) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7));
      return skinRoutine.pm.find((x) => x.id === id).days.includes(d.getDay());
    };
    return {
      strips: skinRoutine.pm.find((x) => x.id === "pm-pore-strips").days,
      teeth: skinRoutine.pm.find((x) => x.id === "pm-teeth-whitening").days,
      stored: JSON.parse(localStorage.getItem("skin-routine-content")).added,
    };
  });
  check("pore strips on Sundays", JSON.stringify(r.strips) === "[0]", r.strips);
  check("whitening every night", r.teeth === undefined, r.teeth);
  check("marker saved with the routine", JSON.stringify(r.stored) === '["teeth-whitening","pore-strips"]', r.stored);
  await page.evaluate(() => {
    skinRoutine.pm = skinRoutine.pm.filter((x) => x.id !== "pm-pore-strips");
    saveRoutine();
  });
  await page.reload();
  await page.waitForTimeout(500);
  check("a deleted addition stays deleted", !(await pm()).includes("pm-pore-strips"), await pm());
  check("and nothing is duplicated", (await pm()).filter((id) => id === "pm-teeth-whitening").length === 1);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("skin: the three original rules are removed", async () => {
  const keep = "My own rule";
  const { ctx, page, errors } = await openApp({
    query: "?tab=skin",
    seed: { "skin-rules-content": ["SPF is the final AM step, no exceptions, even indoors.", keep] },
  });
  const r = await page.evaluate(() => ({
    rules: skinRules,
    stored: JSON.parse(localStorage.getItem("skin-rules-content")),
    card: !!document.getElementById("rules-skin"),
  }));
  check(
    "old rules dropped, the user's own kept",
    JSON.stringify(r.rules) === JSON.stringify([keep]) && JSON.stringify(r.stored) === JSON.stringify([keep]),
    r,
  );
  check("card still shows with a rule left", r.card);
  await page.evaluate(() => {
    skinRules.length = 0;
    renderSkin();
  });
  check("card hidden when empty", !(await page.$("#rules-skin")));
  await ctx.close();
  const fresh = await openApp({ query: "?tab=skin" });
  check("fresh install has no rules card", !(await fresh.page.$("#rules-skin")));
  check("no JS errors", errors.length === 0 && fresh.errors.length === 0, [...errors, ...fresh.errors]);
  await fresh.ctx.close();
});

await section("wash day shows as a Wash hair to-do", async () => {
  const { ctx, page, errors } = await openApp({
    seed: {
      "todo-content": [
        { id: "a", text: "Due today", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
      ],
    },
  });
  await page.evaluate(() => {
    skinRoutine.wash = { anchor: addDaysIso(0), everyDays: 14 };
    renderHome();
  });
  const home = await page.evaluate(() => ({
    row: !!document.querySelector("#panel-home .wash-row .todo-check"),
    ring: document.querySelector(".home-ring").getAttribute("aria-label"),
    todo: [...document.querySelectorAll("#todo-list > *")].slice(0, 2).map((e) => e.className),
  }));
  check("Home lists Wash hair today, checkable", home.row);
  check("ring counts it", home.ring === "0 of 2 done", home.ring);
  check(
    "To-Do shows it under Today",
    home.todo[0].startsWith("cat-title") && home.todo[1].includes("wash-row"),
    home.todo,
  );
  await page.click("#panel-home .wash-row .todo-check");
  const ticked = await page.evaluate(() => ({
    steps: washHairSteps().every((s) => todayChecks().pm.includes(s.id)),
    labels: washHairSteps().map((s) => s.label),
    checked: document.querySelector("#panel-home .wash-row .item").classList.contains("checked"),
    ring: document.querySelector(".home-ring").getAttribute("aria-label"),
  }));
  check("ticking it ticks the wash-only routine steps", ticked.steps && !ticked.labels.includes("Cleanse"), ticked);
  check("row shows done, ring moves", ticked.checked && ticked.ring === "1 of 2 done", ticked);
  await page.click("#panel-home .wash-row .todo-check");
  check(
    "unticking clears them",
    await page.evaluate(() => !washHairSteps().some((s) => todayChecks().pm.includes(s.id))),
  );
  await page.evaluate(() => {
    skinRoutine.wash = { anchor: addDaysIso(2), everyDays: 14 };
    renderHome();
  });
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
  check(
    "a past or future wash day can be ticked",
    await page.evaluate(
      () => washHairDone(addDaysIso(2)) && !washHairSteps().some((s) => todayChecks().pm.includes(s.id)),
    ),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("to-do: recurring to-dos", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=todo",
    seed: {
      "todo-content": [
        {
          id: "w",
          text: "Take out trash",
          done: false,
          due: isoOffset(-3),
          starred: false,
          subitems: [{ id: "s1", text: "Recycling too", done: true }],
          completedAt: null,
          repeat: "weekly",
        },
        {
          id: "d",
          text: "Vitamins",
          done: false,
          due: isoOffset(0),
          starred: false,
          subitems: [],
          completedAt: null,
          repeat: "daily",
        },
        {
          id: "x",
          text: "Bad rule",
          done: false,
          due: null,
          starred: false,
          subitems: [],
          completedAt: null,
          repeat: "hourly<script>",
        },
      ],
    },
  });
  const r0 = await page.evaluate(() => ({
    bad: "repeat" in todoList.find((t) => t.id === "x"),
    rows: [...document.querySelectorAll("#todo-recurring .recurring-row .title")].map((e) => e.textContent),
    meta: document.querySelector('#todo-list [data-todo-id="w"] .repeat-meta').textContent,
    next: [
      addDaysIso(1),
      addDaysIso(4),
      nextRepeatIso("2026-01-31", "monthly"),
      nextRepeatIso("2026-10-09", "weekdays"),
    ],
  }));
  check("unknown repeat rules are dropped", !r0.bad);
  check(
    "Recurring card starts closed",
    await page.evaluate(() => !document.getElementById("todo-recurring").classList.contains("open")),
  );
  check(
    "Recurring section lists repeating to-dos, soonest first",
    JSON.stringify(r0.rows) === '["Take out trash","Vitamins"]',
    r0.rows,
  );
  check("row shows its rule", r0.meta.startsWith("Weekly · "), r0.meta);
  check(
    "monthly clamps to the month's end; weekdays skip the weekend",
    r0.next[2] === "2026-02-28" && r0.next[3] === "2026-10-12",
    r0.next,
  );
  await page.click('#todo-list [data-todo-id="w"] .todo-check');
  const r1 = await page.evaluate(() => {
    const w = todoList.find((t) => t.id === "w");
    const copy = todoList.find((t) => t.id !== "w" && t.text === "Take out trash");
    return {
      due: w.due,
      done: w.done,
      subReset: w.subitems.every((s) => !s.done),
      copy: copy && { done: copy.done, due: copy.due, repeat: copy.repeat },
    };
  });
  check("ticking an overdue weekly moves it to the next date after today", r1.due === isoOffset(4) && !r1.done, r1);
  check("its sub-items reset for next time", r1.subReset);
  check(
    "a done copy is kept for the record",
    r1.copy && r1.copy.done && r1.copy.due === isoOffset(-3) && r1.copy.repeat === undefined,
    r1.copy,
  );
  await page.click(".toast button");
  const undone = await page.evaluate(() => ({
    due: todoList.find((t) => t.id === "w").due,
    n: todoList.filter((t) => t.text === "Take out trash").length,
  }));
  check("undo puts it back", undone.due === isoOffset(-3) && undone.n === 1, undone);
  // Home projects future repeats onto the calendar
  await page.evaluate(() => {
    activateTab("home");
    selectHomeDate(addDaysIso(2));
  });
  const ghosts = await page.$$eval("#panel-home .repeat-ghost .title", (els) => els.map((e) => e.textContent));
  check("future repeats show on Home's calendar", ghosts.includes("Vitamins"), ghosts);
  // Composer: Repeat chip
  await page.evaluate(() => selectHomeDate(addDaysIso(0)));
  await showFab(page);
  await page.click("#fab");
  await page.fill("#composer-text", "Water plants");
  await page.click("#composer-chips .filter-chip >> text=Repeat");
  await page.click("#composer-chips2 .filter-chip >> text=Every 2 weeks");
  await page.press("#composer-text", "Enter");
  const added = await page.evaluate(() => {
    const t = todoList.find((x) => x.text === "Water plants");
    return { repeat: t.repeat, due: t.due };
  });
  check(
    "composer Repeat chip makes a repeating to-do starting today",
    added.repeat === "biweekly" && added.due === isoOffset(0),
    added,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: tab, old closet links, spending, bills", async () => {
  const { ctx, page, errors } = await openApp({
    seed: {
      "bills-content": [
        {
          id: "<bad>",
          name: "Junk",
          amount: "abc",
          due: "nope",
          repeat: "hourly",
          autopay: 1,
          link: "javascript:alert(1)",
        },
      ],
    },
  });
  const nav = await page.$$eval("nav.tabbar button", (bs) => bs.map((b) => b.textContent.trim()));
  check(
    "nav: Home, To-Do, Jazz 3.0, Shopping, Beauty (Budget hidden)",
    JSON.stringify(nav) === '["Home","To-Do","Jazz 3.0","Shopping","Beauty"]',
    nav,
  );
  check(
    "swipe order matches the nav",
    await page.evaluate(
      () =>
        JSON.stringify(TAB_ORDER) ===
        JSON.stringify([...document.querySelectorAll("nav.tabbar button")].map((b) => b.dataset.tab)),
    ),
  );
  const junk = await page.evaluate(() => bills[0]);
  check(
    "bad bill data is coerced",
    /^bill-/.test(junk.id) && junk.amount === 0 && junk.repeat === "monthly" && /^\d{4}-/.test(junk.due),
    junk,
  );
  await page.evaluate(() => {
    bills = [];
    billPayments = [];
    saveBudgetData();
  }); // (the junk bill had autopay on, so it paid itself)

  // The closet view is gone: old links to it open Shopping
  await page.evaluate(() => activateTab("style"));
  const old = await page.evaluate(() => ({
    panel: document.getElementById("panel-wants").classList.contains("active"),
    nav: document.querySelector("nav.tabbar button.active").dataset.tab,
    closet: !!document.getElementById("panel-style"),
  }));
  check("old closet links land on Shopping", old.panel && old.nav === "wants" && !old.closet, old);

  // Spending
  await page.evaluate(() => activateTab("budget"));
  await showFab(page);
  await page.click("#fab");
  check("+ on Budget opens Add to budget", (await page.textContent("#composer-heading")) === "Add to budget");
  await page.fill("#composer-text", "Coffee");
  await page.press("#composer-text", "Enter");
  check(
    "no amount: not saved, sheet says why",
    (await page.evaluate(() => budget.expenses.length)) === 0 &&
      (await page.textContent("#composer-count")).includes("amount"),
  );
  await page.fill("#composer-text", "Groceries $54.25");
  await page.click("#composer-chips2 .filter-chip >> text=Groceries");
  await page.press("#composer-text", "Enter");
  const exp = await page.evaluate(() => budget.expenses[0]);
  check(
    "expense parsed: name, amount, category, today",
    exp.name === "Groceries" && exp.amount === 54.25 && exp.cat === "cat-groceries" && exp.date === isoOffset(0),
    exp,
  );

  // Bill
  await page.fill("#composer-text", "Rent $1200");
  await page.click("#composer-chips .filter-chip >> text=Bill");
  check("bill shows the link field", await page.isVisible("#cx-link"));
  await page.press("#composer-text", "Enter"); // (autopay has its own section; an autopay bill due today would pay itself)
  await page.evaluate(() => closeComposer());
  const bill = await page.evaluate(() => bills[0]);
  check(
    "bill saved: monthly, due today",
    bill.name === "Rent" &&
      bill.amount === 1200 &&
      bill.repeat === "monthly" &&
      bill.due === isoOffset(0) &&
      !bill.autopay,
    bill,
  );
  const sum = await page.textContent(".budget-kpis");
  check("summary shows spent and bills left", sum.includes("$54.25") && sum.includes("$1,200"), sum);

  // Pay it from Home
  await page.evaluate(() => activateTab("home"));
  check("bill shows on Home today", (await page.textContent("#panel-home")).includes("Pay Rent"));
  await page.click('#panel-home .home-list .bill-home .todo-check[aria-label="Mark paid: Rent"]');
  const paid = await page.evaluate(() => ({
    due: bills[0].due,
    pays: billPayments.length,
    next: addMonthsIso(addDaysIso(0), 1),
  }));
  check("paying logs it and moves the bill to next month", paid.pays === 1 && paid.due === paid.next, paid);
  check("paid bill stays on Home, struck", !!(await page.$("#panel-home .home-list .bill-home .item.checked")));
  await page.click(".toast button");
  check("undo un-pays", await page.evaluate(() => billPayments.length === 0 && bills[0].due === addDaysIso(0)));

  // Next month shows the projected due; over-budget category turns red
  await page.evaluate(() => {
    activateTab("budget");
    budget.expenses.push({ id: "exp-big", name: "Big shop", amount: 500, cat: "cat-groceries", date: addDaysIso(0) });
    renderBudget();
  });
  check("over-limit category is flagged", !!(await page.$(".budget-cat-amt.over")));
  await page.click('.budget-month .cal-nav[aria-label="Next month"]');
  check("next month projects the bill", (await page.textContent("#bills-mine")).includes("Rent"));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: sheet import, joint bills, paychecks, savings", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  const rows = [
    "Card/Bank\tDate\tExpense\tAmount",
    "Bank A\t2nd\tPhone\t$70.00",
    "Card B\t3rd\tGym\t-",
    "Card B\t28th\tInsurance\t$1,200.50",
    "Total\t\t\t$1,270.50",
  ].join("\n");
  await page.evaluate(() => importBills());
  await page.fill("#modal-rows", rows);
  await page.click("#modal-backdrop .modal-btn.primary");
  await page.evaluate(() => importBills());
  await page.fill("#modal-rows", "Card B\t20th\tStorage\t$60");
  await page.selectOption("#modal-group", "Joint");
  await page.click("#modal-backdrop .modal-btn.primary");
  const r = await page.evaluate(() => ({
    bills: bills.map((b) => [b.name, b.amount, b.account, b.group, Number(b.due.slice(8))]),
    accts: budget.accounts,
    total: billsInMonth(budgetMonthKey()).reduce((s, x) => s + x.amount, 0),
    subs: [document.querySelector("#bills-mine h3"), document.querySelector("#bills-joint h3")].map((e) =>
      e ? e.textContent : "",
    ),
  }));
  check(
    "rows import with account, amount ('-' = 0) and day; header and Total skipped",
    r.bills.length === 4 &&
      JSON.stringify(r.bills[0].slice(0, 4)) === '["Phone",70,"Bank A","personal"]' &&
      r.bills[1][1] === 0 &&
      r.bills[2][1] === 1200.5,
    r.bills,
  );
  check("new cards/banks are added to the list", r.accts.includes("Bank A") && r.accts.includes("Card B"), r.accts);
  check(
    "joint bills group separately with subtotals",
    r.bills[3][3] === "joint" &&
      r.subs[0] === "My Bills" &&
      r.subs[1] === "Joint Bills" &&
      (await page.textContent("#bills-joint")).includes("Storage"),
    r.subs,
  );
  check("month total covers both groups", Math.abs(r.total - 1330.5) < 0.001, r.total);
  // Paychecks
  const p = await page.evaluate(() => {
    budget.income.push({
      id: "inc-1",
      name: "Paycheck",
      amount: 2000,
      start: budgetMonthKey() + "-01",
      repeat: "biweekly",
    });
    saveBudgetData();
    const pays = incomeInMonth(budgetMonthKey());
    quickPlanLine(pays[0].key, "Card payment", 500);
    const after = incomeInMonth(budgetMonthKey());
    return {
      n: pays.length,
      left: after[0].left,
      hint: !!document.querySelector("#pay-periods .plan-hint"),
      head: document.querySelector(".budget-kpi span").textContent,
    };
  });
  check("a biweekly paycheck lands 2–3 times a month", p.n >= 2 && p.n <= 3, p.n);
  check("paycheck remaining = amount minus its lines", p.left === 1500, p.left);
  check("bills-before-next-payday hint offered", p.hint);
  check(
    "summary leads with Income once there's a paycheck",
    p.head === "Income" && (await page.textContent(".budget-kpis")).includes("Left over"),
    p.head,
  );
  // Savings goal
  await page.evaluate(() => editGoal());
  await page.fill("#modal-name", "House");
  await page.fill("#modal-target", "5000");
  await page.fill("#modal-saved", "2500");
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "savings goal tracks saved of target",
    (await page.textContent("#goals-card")).includes("$2,500 of $5,000") &&
      (await page.textContent("#goals-card .goal-meta")).startsWith("50%"),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: paycheck plans import from a sheet", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  const pays = await page.evaluate(() => {
    budget.income.push({
      id: "inc-1",
      name: "Paycheck",
      amount: 1000,
      start: budgetMonthKey() + "-01",
      repeat: "biweekly",
    });
    saveBudgetData();
    return incomeInMonth(budgetMonthKey()).length;
  });
  const sheet = [
    "Paycheck\t$1,050.00",
    "Rent share\t$400.00",
    "Card\t$100.00",
    "",
    "Remaining\t$550.00",
    "",
    "Paycheck\t$1,000.00",
    "Groceries\t$150.25",
    "Contacts\t",
    "Remaining\t$849.75",
  ].join("\n");
  await page.evaluate(() => openBudgetManage());
  await page.click("#budget-manage >> text=Import paycheck plans");
  await page.fill("#modal-rows", sheet);
  await page.click("#modal-backdrop .modal-btn.primary");
  const r = await page.evaluate(() =>
    incomeInMonth(budgetMonthKey()).map((p) => ({
      amount: p.amount,
      lines: p.plan.lines.map((l) => [l.name, l.amount]),
      left: p.left,
    })),
  );
  check(
    "first block sets the payday amount and its lines",
    r[0].amount === 1050 && JSON.stringify(r[0].lines) === '[["Rent share",400],["Card",100]]' && r[0].left === 550,
    r[0],
  );
  check(
    "second block fills the next payday; blank amount = $0; Remaining rows skipped",
    r[1].amount === 1000 &&
      JSON.stringify(r[1].lines) === '[["Groceries",150.25],["Contacts",0]]' &&
      Math.abs(r[1].left - 849.75) < 0.001,
    r[1],
  );
  check("paydays this month", pays >= 2);
  // Pasted without tabs (e.g. copied from a chat) still parses
  const loose = await page.evaluate(() =>
    parsePlanBlocks("Paycheck $2,000\n1/2 of bills $700.10\nFun spending $300.90"),
  );
  check(
    "space-separated rows parse too",
    loose.length === 1 &&
      loose[0].amount === 2000 &&
      loose[0].lines[0].name === "1/2 of bills" &&
      loose[0].lines[1].amount === 300.9,
    loose,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: pay that varies by check", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  // a biweekly check that started 4 weeks ago, so there are past and future paydays
  await page.evaluate(() => {
    budget.income.push({ id: "inc-v", name: "Work", amount: 2000, start: addDaysIso(-28), repeat: "biweekly" });
    saveBudgetData();
  });
  // the edit form's "Pay varies" switch
  await page.evaluate(() => editIncome("inc-v"));
  await page.check("#modal-varies");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("income can be marked as varying", await page.evaluate(() => budget.income[0].varies === true));
  const est0 = await page.evaluate(() => paycheckAt(budget.income[0], addDaysIso(14)));
  check("unreceived checks are expected, at the typical amount", est0.approx && est0.amount === 2000, est0);
  // tick a past check Received with its real amount
  const past = await page.evaluate(() => addDaysIso(-28));
  await page.evaluate((d) => editPaycheck("inc-v", d, true), past);
  check("Received is prefilled when marking received", await page.isChecked("#modal-received"));
  await page.fill("#modal-amount", "2100");
  await page.click("#modal-backdrop .modal-btn.primary");
  await page.evaluate((d) => editPaycheck("inc-v", d, true), await page.evaluate(() => addDaysIso(-14)));
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
  check(
    "saving an expected check unchanged keeps it an estimate",
    await page.evaluate(() => budget.plans[`inc-v|${addDaysIso(14)}`].amount == null),
  );
  // the page shows ~ for expected checks and the KPI counts them
  await page.evaluate(() => renderBudget());
  const ui = await page.evaluate(() => ({
    approx: document.querySelectorAll("#pay-periods .pp-head .approx").length,
    recv: document.querySelectorAll("#pay-periods .pp-head.recv .todo-check").length,
    kpi: document.querySelector(".budget-kpi i").textContent,
    manage: (openBudgetManage(), document.querySelector("#budget-manage").textContent),
  }));
  await page.evaluate(() => closeModal());
  check(
    "periods mark expected checks with ~ and offer Received",
    ui.recv >= 1 && ui.approx >= 1 && /expected/.test(ui.kpi),
    ui,
  );
  // the period checkbox: unticking goes back to expected, ticking asks for the amount
  const k1 = await page.evaluate(() => {
    const p = incomeInMonth(budgetMonthKey())[0];
    Object.assign(planFor(p.key), { amount: 2050, received: true });
    saveBudgetData();
    return p.key;
  });
  await page.click(`#pay-periods .pp-head.recv.got .todo-check`);
  check(
    "unticking Received returns the check to expected",
    await page.evaluate((k) => !budget.plans[k].received && budget.plans[k].amount === 2050, k1),
  );
  await page.click(`#pay-periods .pp-head.recv:not(.got) .todo-check >> nth=0`);
  check("ticking Received opens the amount, prefilled as received", await page.isChecked("#modal-received"));
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "ticked check shows as received",
    await page.evaluate(
      (k) => budget.plans[k].received === true && !!document.querySelector("#pay-periods .pp-head.recv.got"),
      k1,
    ),
  );
  check(
    "Manage lists the income as varying and offers import",
    ui.manage.includes("varies · ~$2,000") && ui.manage.includes("Import paychecks"),
    ui.manage,
  );
  // pasting the sheet's Income rows
  const rows = await page.evaluate(
    () =>
      [addDaysIso(-28), addDaysIso(14), addDaysIso(3)]
        .map((d) => `${Number(d.slice(5, 7))}/${d.slice(8)}/${d.slice(0, 4)} - Work\t$1,234.56`)
        .join("\n") + "\nTotal\t$9,999.00",
  );
  check(
    "income rows parse dates and amounts",
    await page.evaluate((t) => {
      const r = parseIncomeRows(t, 2026);
      return r.length === 3 && r[0].amount === 1234.56;
    }, rows),
  );
  await page.evaluate(() => importIncome());
  await page.fill("#modal-rows", rows);
  await page.click("#modal-backdrop .modal-btn.primary");
  const imp = await page.evaluate(() => {
    const src = budget.income[0];
    return {
      past: paycheckAt(src, addDaysIso(-28)),
      fut: paycheckAt(src, addDaysIso(14)),
      toast: document.getElementById("toast").textContent,
    };
  });
  check(
    "imported rows set each payday's amount",
    imp.past.amount === 1234.56 && imp.fut.amount === 1234.56 && imp.past.received && !imp.fut.received,
    imp,
  );
  check(
    "rows that aren't a payday are reported",
    imp.toast.includes("Set 2 paychecks") && imp.toast.includes("1 not on a payday"),
    imp.toast,
  );
  // varies + received survive a reload
  await page.reload();
  await page.waitForTimeout(300);
  check(
    "goals aren't repeated above the pay periods",
    await page.evaluate(() => !document.querySelector(".budget-goals-strip")),
  );
  const od = await page.evaluate(() => {
    const k = budgetMonthKey(),
      prev = addMonthsIso(k + "-20", -1);
    bills.push({
      id: "bill-od",
      name: "Late one",
      amount: 100,
      due: prev,
      day: 20,
      repeat: "once",
      autopay: false,
      link: null,
      group: "personal",
      account: null,
    });
    saveBudgetData();
    const tiles = [...document.querySelectorAll(".budget-kpi")].map((e) =>
      [...e.children].map((c) => c.textContent).join(" | "),
    );
    const rowsN = document.querySelectorAll("#panel-budget .btab-row").length;
    bills = bills.filter((b) => b.id !== "bill-od");
    saveBudgetData();
    const after = [...document.querySelectorAll(".budget-kpi")].map((e) =>
      [...e.children].map((c) => c.textContent).join(" | "),
    );
    return { tiles, after, rowsN };
  });
  const amt = (t) => Number((t.match(/\$([\d,]+\.?\d*)/) || [0, "0"])[1].replace(/,/g, ""));
  check(
    "a bill overdue from last month counts in Bills & spending",
    Math.abs(amt(od.tiles[1]) - amt(od.after[1]) - 100) < 0.01,
    od,
  );
  check("paid counts cover every row in the tables", od.tiles[1].includes(`of ${od.rowsN} bills`), od);
  check(
    "a month before the paycheck starts shows no red Left over",
    await page.evaluate(() => {
      shiftBudgetMonth(-3);
      const t = document.querySelector(".budget-kpis").textContent;
      const ok = incomeInMonth(budgetMonthKey()).length || (!t.includes("Left over") && t.includes("No paydays"));
      shiftBudgetMonth(3);
      return !!ok;
    }),
  );
  check(
    "no Month at a Glance in a month without paydays",
    await page.evaluate(() => {
      shiftBudgetMonth(-3);
      const none = !incomeInMonth(budgetMonthKey()).length;
      const ok = !none || !document.getElementById("glance");
      shiftBudgetMonth(3);
      return ok;
    }),
  );
  check(
    "the calendar starts folded at the bottom",
    await page.evaluate(() => {
      const c = document.getElementById("budget-cal");
      return (
        !!c &&
        !c.classList.contains("open") &&
        !!(c.compareDocumentPosition(document.getElementById("pay-periods")) & Node.DOCUMENT_POSITION_PRECEDING)
      );
    }),
  );
  check(
    "varies and received persist",
    await page.evaluate(() => budget.income[0].varies && budget.plans[`inc-v|${addDaysIso(-28)}`].received === true),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: long-term goals", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  // quick-start idea chip prefills the name
  check(
    "Manage is a quiet link, not a card",
    !(await page.$("#panel-budget #budget-manage")) && !!(await page.$("#panel-budget .budget-manage-link")),
  );
  await page.click("#panel-budget .budget-manage-link");
  check(
    "…that opens a Manage sheet with a Done button",
    (await page.textContent("#modal-heading")) === "Manage budget" &&
      (await page.textContent("#modal-backdrop .modal-btn.primary")) === "Done",
  );
  check(
    "no goals: just a one-line Goals row",
    !(await page.$("#goals-card")) && !!(await page.$("#budget-manage >> text=Goals")),
  );
  await page.click("#budget-manage >> text=Goals");
  check("other sheets still say Save", (await page.textContent("#modal-backdrop .modal-btn.primary")) === "Save");
  await page.click("#modal-body >> text=Big purchase");
  check("idea chip prefills the goal name", (await page.inputValue("#modal-name")) === "Big purchase");
  await page.fill("#modal-target", "6000");
  await page.evaluate(() => {
    document.getElementById("modal-date").value = addMonthsIso(addDaysIso(0), 12);
  });
  await page.fill("#modal-saved", "1000");
  await page.click("#modal-backdrop .modal-btn.primary");
  const g0 = await page.evaluate(() => {
    const g = budget.goals[0];
    return { s: goalStatus(g), date: g.date };
  });
  check(
    "goal saved with a date; $/month needed computed",
    g0.s.saved === 1000 && Math.abs(g0.s.perMonth - 5000 / 12) < 15,
    g0,
  );
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
    saveBudgetData();
    return { saved: goalStatus(g).saved, tag: !!document.querySelector("#pay-periods .goal-tag") };
  });
  check("past paycheck line counts, future one doesn't yet", linked.saved === 1700, linked);
  check("linked paycheck lines are tagged", linked.tag);
  // composer: To a goal
  await showFab(page);
  await page.click("#fab");
  await page.click("#composer-chips .filter-chip >> text=To a goal");
  await page.fill("#composer-text", "Birthday money $200");
  await page.press("#composer-text", "Enter");
  check("composer adds to a goal", await page.evaluate(() => goalStatus(budget.goals[0]).saved === 1900));
  await page.evaluate(() => closeComposer());
  // reaching the target
  await page.evaluate(() => {
    budget.goals[0].log.push({ id: "gl-big", date: addDaysIso(0), amount: 5000, note: "" });
    saveBudgetData();
  });
  // milestone bar: quarter marks, next milestone and a finish date at this pace
  const ms = await page.evaluate(() => {
    budget.goals = [
      {
        id: "goal-h",
        name: "House",
        target: 15000,
        saved: 2500,
        date: null,
        created: addDaysIso(-60),
        log: [{ id: "gl-1", date: addDaysIso(-10), amount: 1500, note: "" }],
      },
    ];
    saveBudgetData();
    const s = goalStatus(budget.goals[0]);
    return {
      marks: [...document.querySelectorAll("#goals-card .goal-mark em")].map((e) => e.textContent),
      hit: document.querySelectorAll("#goals-card .goal-mark.hit").length,
      outlook: document.querySelector("#goals-card .goal-outlook").textContent,
      insight: document.querySelector("#goals-card .insight").textContent,
      s,
    };
  });
  check("milestone marks at each quarter", ms.marks.join() === "$3,750,$7,500,$11,250,$15,000" && ms.hit === 1, ms);
  check(
    "next milestone and finish date shown",
    ms.outlook.includes("Next: $7,500 (50%) · $3,500 away") && ms.outlook.includes("At this pace:") && !!ms.s.eta,
    ms.outlook,
  );
  check("collapsed insight: % and amount to go", ms.insight === "27% · $11,000 to go", ms.insight);
  const behind = await page.evaluate(() => {
    budget.goals[0].date = addMonthsIso(addDaysIso(0), 10);
    saveBudgetData();
    return document.querySelector("#goals-card .insight").textContent;
  });
  check("collapsed insight flags a goal that's behind", /^Behind · needs \$[\d,]+\/mo$/.test(behind), behind);
  await page.evaluate(() => {
    budget.goals.push({
      id: "goal-r",
      name: "Ring",
      target: 100,
      saved: 100,
      date: null,
      created: addDaysIso(0),
      log: [],
    });
    saveBudgetData();
  });
  check(
    "several goals: overall % and how many are behind",
    (await page.textContent("#goals-card .insight")) === "27% · 1 behind",
    await page.textContent("#goals-card .insight"),
  );
  check("reached goals say so", (await page.textContent("#goals-card")).includes("Reached"));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: pay periods, copy plans, variable bills, shares, card totals", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  const setup = await page.evaluate(() => {
    const k = budgetMonthKey(),
      d = (n) => `${k}-${String(n).padStart(2, "0")}`;
    budget.income = [{ id: "inc-1", name: "Paycheck", amount: 2000, start: d(1), repeat: "biweekly" }];
    budget.accounts = ["Bank A", "Card B"];
    bills = [
      {
        id: "bill-a",
        name: "Rent",
        amount: 1000,
        due: d(3),
        repeat: "monthly",
        autopay: false,
        link: null,
        group: "joint",
        account: "Bank A",
        share: 50,
      },
      {
        id: "bill-b",
        name: "Electric",
        amount: 80,
        due: d(16),
        repeat: "monthly",
        autopay: false,
        link: null,
        group: "personal",
        account: "Card B",
        varies: true,
      },
    ];
    saveBudgetData();
    return { k };
  });
  const plan = await page.evaluate(() => ({
    checks: [...document.querySelectorAll("#pay-periods .pp")].length,
    pays: incomeInMonth(budgetMonthKey()).length,
    mine: document.querySelector("#bills-mine").textContent.replace(/\s+/g, " "),
    joint: document.querySelector("#bills-joint").textContent.replace(/\s+/g, " "),
  }));
  check("Paycheck Plan lists every check", plan.checks === plan.pays && plan.pays >= 2, plan);
  check(
    "My Bills and Joint Bills tables split the bills",
    plan.mine.includes("Electric") && !plan.mine.includes("Rent") && plan.joint.includes("Rent"),
    plan,
  );
  check("joint share counts your part", plan.joint.includes("$500.00") && plan.joint.includes("50%"), plan.joint);
  check(
    "each check offers its bills due as a plan line",
    await page.evaluate(() =>
      [...document.querySelectorAll("#pay-periods .plan-hint")].some((b) => b.textContent.includes("$500.00")),
    ),
  );
  check(
    "spending hides until something's logged",
    !(await page.$("#spending-card")) && (await page.evaluate(() => budgetManageHtml.includes("Spending by category"))),
  );
  // variable bill asks for the amount
  await page.evaluate(() => payBill("bill-b"));
  await page.fill("#modal-amount", "93.40");
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "a bill that varies records what it came to",
    await page.evaluate(() => billPayments[0] && billPayments[0].amount === 93.4),
  );
  // paid rows stay in the table, struck through; tap one to edit the payment
  check("paid bills stay listed, struck through", !!(await page.$("#bills-mine .btab-row.checked")));
  await page.click("#bills-mine .btab-row.checked .btab-name");
  await page.fill("#modal-amount", "95");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("tapping a paid bill edits the payment", await page.evaluate(() => billPayments[0].amount === 95));
  // plan lines tick off
  await page.evaluate(() => {
    const p = incomeInMonth(budgetMonthKey())[0];
    quickPlanLine(
      p.key,
      `1/2 of ${noonOf(budgetMonthKey() + "-01").toLocaleDateString("en-US", { month: "short" })} Bills`,
      500,
    );
  });
  await page.click("#pay-periods .plan-row .todo-check");
  check(
    "plan lines can be checked off",
    await page.evaluate(() => incomeInMonth(budgetMonthKey())[0].plan.lines[0].done === true),
  );
  check("done plan lines are struck through", !!(await page.$("#pay-periods .plan-row.done")));
  const half = await page.evaluate(() => {
    const ps = incomeInMonth(budgetMonthKey());
    return {
      tile: [...document.querySelectorAll(".budget-kpi")]
        .map((e) => e.textContent.replace(/\s+/g, " "))
        .find((t) => t.startsWith("Bills")),
      n: ps.filter((p) => !p.plan.lines.length).length,
    };
  });
  check(
    "half-planned month: unplanned checks count their bills due (marked ~)",
    half.n === 0 || (half.tile.includes("~") && half.tile.includes("not planned yet")),
    half,
  );
  check(
    "income names keep their case in the plan",
    await page.evaluate(() => {
      budget.income[0].name = "CCCI";
      renderBudget();
      const t = document.querySelector("#pay-periods .pp-title span").textContent;
      budget.income[0].name = "Paycheck";
      renderBudget();
      return t.includes("CCCI");
    }),
  );
  check(
    "Month at a Glance adds it up",
    await page.evaluate(() => {
      const t = document.querySelector("#glance").textContent;
      return t.includes("Income") && t.includes("Bills & spending") && t.includes("Left over");
    }),
  );
  // reload: joint group, account, share, varies and done all survive
  await page.reload();
  await page.waitForTimeout(500);
  await page.evaluate(() => activateTab("budget")); // the launch param is gone after the first load
  const kept = await page.evaluate(() => ({
    a: bills.find((b) => b.id === "bill-a"),
    b: bills.find((b) => b.id === "bill-b"),
    done: incomeInMonth(budgetMonthKey())[0].plan.lines[0].done,
  }));
  check(
    "bill details survive a reload",
    kept.a.group === "joint" &&
      kept.a.account === "Bank A" &&
      kept.a.share === 50 &&
      kept.b.varies === true &&
      kept.done === true,
    kept,
  );
  // next month: offer to copy the plans, renaming the month in line names
  await page.click('.budget-month .cal-nav[aria-label="Next month"]');
  check("next month offers to copy last month's plans", !!(await page.$(".copy-plans")));
  await page.click(".copy-plans");
  const copied = await page.evaluate(() => {
    const p = incomeInMonth(budgetMonthKey())[0];
    return {
      name: p.plan.lines[0].name,
      done: !!p.plan.lines[0].done,
      want: `1/2 of ${noonOf(budgetMonthKey() + "-01").toLocaleDateString("en-US", { month: "short" })} Bills`,
    };
  });
  check(
    "copied lines move the month name along and start unchecked",
    copied.name === copied.want && !copied.done,
    copied,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("sync: per-list merge keeps both devices' edits", async () => {
  const now = Date.now();
  const todos = [{ id: "t1", text: "Shared", done: false, due: null, starred: false, subitems: [], completedAt: null }];
  const rules = ["Rule A"];
  // both devices last synced the same data; then the other device edited rules
  const base = { "todo-content": JSON.stringify(todos), "skin-rules-content": JSON.stringify(rules) };
  const gist = {
    id: "g0",
    files: {
      "jazz2-data.json": {
        truncated: false,
        content: JSON.stringify({
          updatedAt: now,
          data: {
            "todo-content": todos,
            "skin-rules-content": ["Rule A", "Rule from desktop"],
          },
        }),
      },
    },
  };
  let patches = 0;
  const route = async (r) => {
    const req = r.request(),
      url = new URL(req.url());
    const json = (status, body) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/gists/g0" && req.method() === "GET") return json(200, gist);
    if (url.pathname === "/gists/g0" && req.method() === "PATCH") {
      patches++;
      Object.entries(JSON.parse(req.postData()).files).forEach(([n, f]) => {
        gist.files[n] = { truncated: false, content: f.content };
      });
      return json(200, gist);
    }
    return json(404, {});
  };
  const { ctx, page, errors } = await openApp({
    route,
    seed: {
      "sync-token": "tok",
      "sync-gist-id": "g0",
      "data-updated-at": String(now + 5000),
      "sync-base": base,
      // this device edited to-dos (and is "newer" by timestamp)
      "todo-content": [
        ...todos,
        { id: "t2", text: "Phone edit", done: false, due: null, starred: false, subitems: [], completedAt: null },
      ],
      "skin-rules-content": rules,
    },
  });
  await page.waitForTimeout(1200);
  const local = await page.evaluate(() => ({ todos: todoList.map((t) => t.text), rules: skinRules }));
  const remote = JSON.parse(gist.files["jazz2-data.json"].content).data;
  check("the other device's rule edit comes in", local.rules.includes("Rule from desktop"), local.rules);
  check("this device's to-do edit is kept", local.todos.includes("Phone edit"), local.todos);
  check(
    "the gist ends up with both",
    remote["todo-content"].some((x) => x.text === "Phone edit") &&
      remote["skin-rules-content"].includes("Rule from desktop") &&
      patches === 1,
    { patches },
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("robustness: malformed synced data can't stop the app", async () => {
  const { ctx, page, errors } = await openApp({
    seed: {
      "todo-content": [
        null,
        { id: "a", text: "Bad due", due: 20261006, subitems: "abc", done: 0 },
        { id: "b", text: "Fine", due: null, subitems: {} },
      ],
      "skin-routine-content": { am: "x", pm: [{ id: "p1", label: "Cleanse", product: "Gel", days: "Mon" }] },
      "routine-checks": "null",
      "sizes-content": [1, ["Shoe", "10"]],
      "wants-content": { not: "a list" },
      "style-state": [1, 2],
    },
  });
  const r = await page.evaluate(() => ({
    home: document.getElementById("panel-home").innerHTML.length,
    todos: todoList.map((t) => [t.text, t.due, Array.isArray(t.subitems)]),
    am: skinRoutine.am,
    wash: skinRoutine.washPm,
    sizes,
    wants: wantsList,
  }));
  check("app still renders", r.home > 100, r.home);
  check(
    "bad to-dos are dropped or coerced",
    r.todos.length === 2 && r.todos[0][1] === null && r.todos.every((x) => x[2]),
    r.todos,
  );
  check(
    "routine and lists fall back to safe shapes",
    Array.isArray(r.am) && Array.isArray(r.wash) && r.sizes.length === 1 && Array.isArray(r.wants),
    r,
  );
  // a wild wash interval can't freeze the app
  const t0 = Date.now();
  await page.evaluate(() => {
    skinRoutine.wash = { anchor: "2020-01-01", everyDays: 1e9 };
    renderSkin();
    renderHome();
  });
  check(
    "absurd wash interval is ignored",
    Date.now() - t0 < 2000 && (await page.evaluate(() => washSchedule().everyDays)) === 14,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("dates: monthly repeats keep their day; Home follows midnight", async () => {
  const { ctx, page, errors } = await openApp();
  const r = await page.evaluate(() => {
    let d = "2027-01-31",
      seq = [];
    for (let i = 0; i < 3; i++) {
      d = nextRepeatIso(d, "monthly", 31);
      seq.push(d);
    }
    let b = "2027-01-31",
      bseq = [];
    for (let i = 0; i < 3; i++) {
      b = nextBillIso(b, "monthly", 31);
      bseq.push(b);
    }
    budget.income = [{ id: "inc-m", name: "Monthly pay", amount: 100, start: "2027-01-31", repeat: "monthly" }];
    const mar = incomeInMonth("2027-03").map((p) => p.date);
    return { seq, bseq, mar };
  });
  check(
    "to-do repeat on the 31st comes back to the 31st",
    JSON.stringify(r.seq) === '["2027-02-28","2027-03-31","2027-04-30"]',
    r.seq,
  );
  check("bill repeat too", JSON.stringify(r.bseq) === '["2027-02-28","2027-03-31","2027-04-30"]', r.bseq);
  check("monthly income too", JSON.stringify(r.mar) === '["2027-03-31"]', r.mar);
  // pretend the date rolled over while the app stayed open
  const rolled = await page.evaluate(() => {
    renderedDay = "2000-01-01";
    homeDate = "2000-01-01";
    checkDayChange();
    return { day: renderedDay, home: homeDate };
  });
  check(
    "a new day resets Home to today",
    rolled.day === (await page.evaluate(() => addDaysIso(0))) && rolled.home === null,
    rolled,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("to-dos: custom repeat intervals and multi-day to-dos", async () => {
  const { ctx, page, errors } = await openApp({
    seed: {
      "todo-content": [
        {
          id: "w",
          text: "Filter change",
          done: false,
          due: isoOffset(0),
          starred: false,
          subitems: [],
          completedAt: null,
        },
        { id: "m", text: "Trip", done: false, due: isoOffset(-1), starred: false, subitems: [], completedAt: null },
      ],
    },
  });
  // every 3 weeks
  await page.evaluate(() => editTodo("w"));
  check("interval stepper hidden until Custom is picked", !(await page.$("#tde .tde-every")));
  await page.click("#tde .filter-chip >> text=Custom");
  check(
    "Custom shows the stepper, in weeks",
    !!(await page.$("#tde .tde-every")) && (await page.textContent("#tde .tde-seg button.on")) === "weeks",
  );
  await page.click('#tde .tde-step[aria-label="More"]');
  check("stepper counts up", (await page.textContent("#modal-every")) === "3");
  await page.click("#modal-backdrop .modal-btn.primary");
  const w = await page.evaluate(() => {
    const t = todoList.find((x) => x.id === "w");
    return {
      repeat: t.repeat,
      every: t.every,
      label: repeatLabel(t),
      on21: occursOn(t, addDaysIso(21)),
      on14: occursOn(t, addDaysIso(14)),
    };
  });
  check(
    "every 3 weeks is saved and labeled",
    w.repeat === "weeks" && w.every === 3 && /^Every 3 weeks · /.test(w.label),
    w,
  );
  check("it lands 3 weeks out, not 2", w.on21 && !w.on14, w);
  await page.evaluate(() => completeTodo("w"));
  check(
    "ticking it moves it 3 weeks on",
    await page.evaluate(() => todoList.find((x) => x.id === "w").due === addDaysIso(21)),
  );
  // every 2 months
  await page.evaluate(() => {
    const t = todoList.find((x) => x.id === "w");
    t.repeat = "months";
    t.every = 2;
    t.due = "2026-01-31";
    t.repeatDay = 31;
  });
  check(
    "yearly repeats a year on, keeping Feb 29 in leap years",
    await page.evaluate(() => {
      const t = { repeat: "yearly", due: "2028-02-29", repeatDay: 29 };
      return (
        todoNext("2026-02-19", { repeat: "yearly", due: "2026-02-19" }) === "2027-02-19" &&
        todoNext("2028-02-29", t) === "2029-02-28" &&
        todoNext("2031-02-28", t) === "2032-02-29" &&
        repeatLabel({ repeat: "yearly", due: "2027-02-19" }) === "Yearly on Feb 19"
      );
    }),
  );
  await page.evaluate(() => {
    const t = todoList.find((x) => x.id === "w");
    t.repeat = "months";
    t.every = 12;
    t.due = "2027-02-19";
    editTodo("w");
  });
  check(
    "an every-12-months repeat opens as Yearly",
    await page.evaluate(
      () =>
        tde.repeat === "yearly" &&
        [...document.querySelectorAll('#tde .filter-chip[aria-pressed="true"]')].some(
          (b) => b.textContent === "Yearly",
        ),
    ),
  );
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "…and saves as yearly",
    await page.evaluate(() => {
      const t = todoList.find((x) => x.id === "w");
      return t.repeat === "yearly" && !("every" in t);
    }),
  );
  check(
    "every 2 months keeps its day",
    await page.evaluate(() => {
      const t = todoList.find((x) => x.id === "w");
      Object.assign(t, { repeat: "months", every: 2, due: "2026-01-31", repeatDay: 31 });
      return todoNext("2026-01-31", t) === "2026-03-31" && todoNext("2026-03-31", t) === "2026-05-31";
    }),
  );
  // multi-day: started yesterday, runs through tomorrow
  await page.evaluate(() => editTodo("m"));
  await page.click("#tde .filter-chip >> text=Multi-day");
  await page.fill("#modal-end", await page.evaluate(() => addDaysIso(1)));
  await page.dispatchEvent("#modal-end", "change");
  check("summary shows the span", (await page.textContent("#tde .tde-sum")).includes("(3 days)"));
  await page.click("#modal-backdrop .modal-btn.primary");
  const m = await page.evaluate(() => {
    const t = todoList.find((x) => x.id === "m");
    return {
      days: t.days,
      group: todoGroup(t),
      today: homeDayItems(addDaysIso(0)).open.some((x) => x.id === "m"),
      tomorrow: homeDayItems(addDaysIso(1)).open.some((x) => x.id === "m"),
      after: homeDayItems(addDaysIso(2)).open.some((x) => x.id === "m"),
      counts: homeDueCounts(),
    };
  });
  check("last day sets a 3-day span", m.days === 3, m);
  check("a running multi-day to-do isn't overdue", m.group === "today", m);
  check("it shows on each of its days, not after", m.today && m.tomorrow && !m.after, m);
  check("calendar dots count each day", m.counts[await page.evaluate(() => addDaysIso(1))] >= 1, m.counts);
  await page.evaluate(() => {
    selectHomeDate(addDaysIso(0));
  });
  check("Home says which day of the span it is", (await page.textContent("#panel-home")).includes("Day 2 of 3"));
  // once its last day has passed it's overdue
  check(
    "overdue once the last day passes",
    await page.evaluate(() => {
      const t = { id: "x", text: "x", due: addDaysIso(-5), days: 3 };
      return todoGroup(t) === "overdue";
    }),
  );
  // junk from sync is cleaned up
  check(
    "bad interval/span values are dropped",
    await page.evaluate(() => {
      todoList.push({ id: "j", text: "j", done: false, due: null, days: 9, every: "x", subitems: [] });
      normalizeLoadedData();
      const t = todoList.find((x) => x.id === "j");
      return !("days" in t) && !("every" in t);
    }),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("to-do types get icons", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=todo",
    seed: {
      "todo-content": [
        {
          id: "a",
          text: "Therapy @ 10am",
          done: false,
          due: isoOffset(0),
          starred: false,
          subitems: [],
          completedAt: null,
        },
        { id: "b", text: "Gym", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
        { id: "c", text: "WWC @ 9am", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
        {
          id: "d",
          text: "Something vague",
          done: false,
          due: isoOffset(0),
          starred: false,
          subitems: [],
          completedAt: null,
        },
      ],
    },
  });
  const k = await page.evaluate(() =>
    [
      "Therapy @ 10am",
      "Gym",
      "WWC @ 9am",
      "Get eyebrows done",
      "Mom's birthday dinner",
      "Clean the kitchen",
      "Pick up dry cleaning",
      "Flight to Atlanta",
      "Oil change",
      "Something vague",
      "Update resume",
    ].map(detectKind),
  );
  check(
    "types are guessed from the words",
    JSON.stringify(k) ===
      JSON.stringify([
        "health",
        "fitness",
        "appointment",
        "appointment",
        "birthday",
        "chores",
        "errand",
        "travel",
        "car",
        null,
        null,
      ]),
    k,
  );
  const icons = await page.evaluate(() =>
    [...document.querySelectorAll("#todo-list .todo-wrap[data-todo-id]")].map((w) => [
      w.dataset.todoId,
      (w.querySelector(".kind-ic") || {}).title || "",
    ]),
  );
  check(
    "rows show the type's icon (none when nothing fits)",
    JSON.stringify(icons.sort()) ===
      JSON.stringify([
        ["a", "Health"],
        ["b", "Fitness"],
        ["c", "Appointment"],
        ["d", ""],
      ]),
    icons,
  );
  // pick a type by hand, then None
  await page.evaluate(() => editTodo("d"));
  check("Type row offers Automatic plus each type", (await page.$$("#tde .kind-chip")).length === 14);
  await page.click("#tde .kind-chip >> text=Work");
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "picked type is saved and shown",
    await page.evaluate(
      () =>
        todoList.find((t) => t.id === "d").kind === "work" &&
        document.querySelector('#todo-list [data-todo-id="d"] .kind-ic').title === "Work",
    ),
  );
  await page.evaluate(() => editTodo("b"));
  await page.click("#tde .kind-chip >> text=None");
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "None hides the icon",
    await page.evaluate(() => !document.querySelector('#todo-list [data-todo-id="b"] .kind-ic')),
  );
  // the Auto chip follows the text as it's typed
  await page.evaluate(() => editTodo("a"));
  await page.fill("#modal-text", "Flight home");
  check("Auto chip follows the text", (await page.textContent("#tde .kind-chip.on")).includes("Travel"));
  await page.evaluate(() => closeModal());
  check(
    "bad types from sync are dropped",
    await page.evaluate(() => {
      todoList[0].kind = "<x>";
      normalizeLoadedData();
      return !("kind" in todoList[0]);
    }),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("drag to reorder by pressing a row (Home and To-Do)", async () => {
  const { ctx, page, errors } = await openApp({
    phone: false,
    seed: {
      "todo-content": [
        { id: "a", text: "Alpha", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
        { id: "b", text: "Bravo", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
        { id: "c", text: "Charlie", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
        { id: "n", text: "Someday", done: false, due: null, starred: false, subitems: [], completedAt: null },
      ],
    },
  });
  await page.evaluate(() => {
    skinRoutine.washPm = [];
    renderHome();
  });
  const dragRow = async (from, to, below = false) => {
    await page.locator(to).scrollIntoViewIfNeeded(); // Home's planner sits below the Jarvis dashboard
    await page.locator(from).scrollIntoViewIfNeeded();
    const a = await page.locator(from).boundingBox(),
      b = await page.locator(to).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + (below ? b.height - 2 : 2), { steps: 12 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(150);
  };
  // Home: drag Charlie above Alpha
  await dragRow('#panel-home .home-list [data-todo-id="c"] .title', '#panel-home .home-list [data-todo-id="a"] .title');
  const homeOrder = await page.evaluate(() =>
    todoList
      .filter((t) => t.due === addDaysIso(0))
      .map((t) => t.id)
      .join(""),
  );
  check("Home: press and drag reorders the day's to-dos", homeOrder === "cab", homeOrder);
  check("the drop doesn't open the editor", !(await page.isVisible("#modal-backdrop.open")));
  // Home: drag Someday from Anytime into the day's list → gets today's date
  await dragRow('#panel-home .home-list [data-todo-id="n"] .title', '#panel-home .home-list [data-todo-id="b"] .title');
  check(
    "Home: dropping into the day's list sets that date",
    await page.evaluate(() => todoList.find((t) => t.id === "n").due === addDaysIso(0)),
  );
  // a plain click still edits
  await page.waitForTimeout(450);
  await page.click('#panel-home .home-list [data-todo-id="b"] .title');
  check("a plain click still opens the editor", await page.isVisible("#modal-backdrop.open"));
  await page.evaluate(() => closeModal());
  // To-Do: drag a row (no handle) to the end of Today
  await page.evaluate(() => activateTab("todo"));
  await dragRow('#todo-list [data-todo-id="c"] .title', '#todo-list [data-todo-id="b"] .title', true);
  const todoOrder = await page.evaluate(() =>
    todoList
      .filter((t) => t.due === addDaysIso(0) && t.id !== "n")
      .map((t) => t.id)
      .join(""),
  );
  check("To-Do: press and drag a row reorders it", todoOrder === "abc", todoOrder);
  // touch: a hold starts the drag, a quick move scrolls instead
  const touch = await page.evaluate(async () => {
    const row = document.querySelector('#todo-list [data-todo-id="a"] .title'),
      r = row.getBoundingClientRect();
    const ev = (type, y) =>
      row.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 7,
          pointerType: "touch",
          clientX: r.left + 20,
          clientY: y,
          isPrimary: true,
        }),
      );
    ev("pointerdown", r.top + 10);
    await new Promise((res) => setTimeout(res, 380));
    const held = document.body.classList.contains("todo-dragging");
    ev("pointerup", r.top + 10);
    await new Promise((res) => setTimeout(res, 50));
    ev("pointerdown", r.top + 10);
    ev("pointermove", r.top + 40);
    await new Promise((res) => setTimeout(res, 380));
    const scrolled = !document.body.classList.contains("todo-dragging");
    ev("pointerup", r.top + 40);
    return { held, scrolled };
  });
  check("touch: holding a row picks it up", touch.held, touch);
  check("touch: moving right away is a scroll, not a drag", touch.scrolled, touch);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("press and drag works across the app; no grip handles", async () => {
  const { ctx, page, errors } = await openApp({
    phone: false,
    query: "?tab=todo",
    seed: {
      "todo-content": [
        {
          id: "p",
          text: "Parent",
          done: false,
          due: null,
          starred: false,
          completedAt: null,
          subitems: [
            { id: "s1", text: "One", done: false },
            { id: "s2", text: "Two", done: false },
            { id: "s3", text: "Three", done: false },
          ],
        },
      ],
    },
  });
  const dragTo = async (from, to, below = false) => {
    await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: "center" }), to); // clear of the autoscroll edges
    const a = await page.locator(from).boundingBox(),
      b = await page.locator(to).boundingBox();
    await page.mouse.move(a.x + 30, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 30, a.y + a.height / 2 + 8, { steps: 3 });
    await page.mouse.move(a.x + 30, b.y + (below ? b.height - 2 : 2), { steps: 12 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(500);
  };
  check(
    "no grip handles anywhere",
    await page.evaluate(() => {
      expandedTodos.add("p");
      renderHome();
      return !document.querySelector(".drag-handle, .sub-drag-handle");
    }),
  );
  // sub-items: press the row
  await dragTo('#todo-list [data-sub-id="s3"] .subitem-text', '#todo-list [data-sub-id="s1"] .subitem-text');
  check(
    "sub-items reorder by pressing the row",
    await page.evaluate(() => todoList[0].subitems.map((s) => s.id).join() === "s3,s1,s2"),
    await page.evaluate(() => todoList[0].subitems.map((s) => s.id).join()),
  );
  // routine steps
  await page.evaluate(() => {
    activateTab("skin");
    openPinned.add("routine-card");
    renderSkin();
  });
  const am0 = await page.evaluate(() => skinRoutine.am.map((s) => s.id));
  await dragTo(
    `#routine-card .band[data-band="am"] [data-sort-id="${am0[2]}"]`,
    `#routine-card .band[data-band="am"] [data-sort-id="${am0[0]}"]`,
  );
  const am1 = await page.evaluate(() => skinRoutine.am.map((s) => s.id));
  check("routine steps reorder", am1[0] === am0[2] && am1[1] === am0[0] && am1.length === am0.length, am1);
  check("the drop doesn't open the step editor", !(await page.isVisible("#modal-backdrop.open")));
  // budget: plan lines and goals
  await page.evaluate(() => {
    activateTab("budget");
    const k = budgetMonthKey();
    budget.income = [{ id: "inc", name: "Paycheck", amount: 1000, start: k + "-01", repeat: "biweekly" }];
    budget.plans[`inc|${k}-01`] = {
      lines: [
        { id: "la", name: "A", amount: 1 },
        { id: "lb", name: "B", amount: 2 },
        { id: "lc", name: "C", amount: 3 },
      ],
    };
    budget.goals = [
      { id: "g1", name: "First", target: 100, saved: 0, date: null, created: k + "-01", log: [] },
      { id: "g2", name: "Second", target: 100, saved: 0, date: null, created: k + "-01", log: [] },
    ];
    saveBudgetData();
  });
  await dragTo('#pay-periods [data-sort-id="lc"] .plan-body', '#pay-periods [data-sort-id="la"] .plan-body');
  check(
    "plan lines reorder",
    await page.evaluate(() => budget.plans[`inc|${budgetMonthKey()}-01`].lines.map((l) => l.id).join() === "lc,la,lb"),
  );
  await dragTo('#goals-card [data-sort-id="g2"] .goal-head', '#goals-card [data-sort-id="g1"] .goal-head');
  check(
    "goals reorder (and the top tile follows)",
    await page.evaluate(
      () => budget.goals[0].id === "g2" && document.querySelector(".budget-kpi.goal span").textContent === "Second",
    ),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Home groups the day by type, with Bills on their own", async () => {
  const { ctx, page, errors } = await openApp({});
  const r = await page.evaluate(() => {
    const t = addDaysIso(0);
    todoList = ["Return clothes to Old Navy", "Gym", "Clean floors", "Laundry", "Chores"].map((x, i) => ({
      id: "t" + i,
      text: x,
      done: false,
      due: t,
      starred: false,
      subitems: [],
      completedAt: null,
    }));
    bills = [
      {
        id: "b1",
        name: "AT&T",
        amount: 25,
        due: t,
        day: Number(t.slice(8)),
        repeat: "monthly",
        autopay: false,
        link: null,
        group: "personal",
        account: null,
      },
    ];
    skinRoutine.washPm = [];
    saveContent("todo-content", todoList);
    saveBudgetData();
    renderHome();
    const list =
      document.querySelector("#panel-home .home-list:not(.overdue)") ||
      document.querySelector("#panel-home .home-list");
    return [...list.children].map((el) =>
      el.classList.contains("home-sub")
        ? "#" + el.textContent.trim()
        : (el.textContent.match(/Return|Gym|Clean floors|Laundry|Chores|AT&T/) || [""])[0],
    );
  });
  check(
    "each type under its own label (named one leading), then Bills",
    r.join("|") === "#Fitness|Gym|#Errands|Return|#Chores|Chores|Clean floors|Laundry|#Bills|AT&T",
    r,
  );
  check(
    "a to-do named like a type takes that type",
    await page.evaluate(() => detectKind("Chores") === "chores" && detectKind("errands") === "errand"),
  );
  check(
    "a type keeps its label with just one to-do",
    await page.evaluate(() => {
      todoList = todoList.filter((t) => t.text !== "Clean floors" && t.text !== "Chores");
      renderHome();
      return [...document.querySelectorAll("#panel-home .home-sub")].some((e) => e.textContent.includes("Chores"));
    }),
  );
  check(
    "to-dos with no type stay at the top, unlabeled",
    await page.evaluate(() => {
      todoList.push({
        id: "v",
        text: "Something vague",
        done: false,
        due: addDaysIso(0),
        starred: false,
        subitems: [],
        completedAt: null,
      });
      renderHome();
      const first = document.querySelector("#panel-home .home-list").firstElementChild;
      return first.textContent.includes("Something vague");
    }),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Fitness (Jazz 3.0): weight, weekly plan, Home, import link", async () => {
  const k = isoOffset(0);
  const payload = {
    app: "jazz3-fitness",
    start: 100,
    goal: 120,
    weights: [
      { date: isoOffset(-14), lbs: 110 },
      { date: k, lbs: 112 },
    ],
    plan: [
      { name: "Gym A", days: [0, 1, 2, 3, 4, 5, 6], every: 1, anchor: k, kind: "fitness" },
      { name: "Walk", days: [new Date().getDay()], every: 2, anchor: k, time: "09:00", kind: "pet" },
    ],
  };
  const hash = "#import=" + Buffer.from(JSON.stringify(payload)).toString("base64url");
  const { ctx, page, errors } = await openApp({ query: hash });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    tab: currentTab,
    start: fitness.start,
    goal: fitness.goal,
    n: fitness.weights.length,
    plan: fitness.plan.map((w) => [w.name, w.every, w.kind, w.time]),
    hash: location.hash,
    s: weightStatus(),
    title: document.title,
  }));
  check("app is named Jarvis", r.title === "Jarvis", r.title);
  check(
    "import link fills Fitness and opens the Jazz 3.0 tab",
    r.tab === "jazz3" && r.start === 100 && r.goal === 120 && r.n === 2 && r.plan.length === 2 && r.hash === "",
    r,
  );
  check(
    "weight progress, pace and finish date",
    r.s.cur === 112 && r.s.toGo === 8 && r.s.pct === 60 && r.s.rate === 1 && !!r.s.eta,
    r.s,
  );
  const ui = await page.evaluate(() => ({
    weight: document.getElementById("weight-card").textContent.replace(/\s+/g, " "),
    section: document.querySelector("#panel-jazz3 .j3-sec").textContent.trim(),
    tally: !!document.querySelector(".fit-tally"),
    week: document.getElementById("todo-list").textContent.replace(/\s+/g, " "),
    planOnFitness: !!document.querySelector("#panel-jazz3 #fit-plan"),
    plan: document.querySelector("#panel-todo #fit-plan").textContent.replace(/\s+/g, " "),
  }));
  check(
    "Weight card shows now, goal and to go",
    ui.weight.includes("112") && ui.weight.includes("Goal 120") && ui.weight.includes("8 lb to go"),
    ui.weight,
  );
  check("workouts fill the To-Do list on their days", ui.week.includes("Gym A") && ui.week.includes("Walk"), ui.week);
  check(
    "Jazz 3.0 tab: a Fitness section with Weight, no workout tally; plan lives in To-Do",
    ui.section === "Fitness" && !ui.tally && !ui.planOnFitness,
    ui,
  );
  check(
    "plan shows days, time and every 2 weeks",
    ui.plan.includes("Every day") && ui.plan.includes("9 AM") && ui.plan.includes("every 2 weeks"),
    ui.plan,
  );
  check(
    "every-2-weeks workouts skip alternate weeks",
    await page.evaluate(() => {
      const w = fitness.plan.find((x) => x.name === "Walk");
      return workoutOn(w, addDaysIso(0)) && !workoutOn(w, addDaysIso(7)) && workoutOn(w, addDaysIso(14));
    }),
  );
  check(
    "a plan doesn't count the weeks before it started",
    await page.evaluate(() => {
      const w = fitness.plan.find((x) => x.name === "Gym A");
      return !workoutOn(w, addDaysIso(-8));
    }),
  );
  await page.evaluate(() => activateTab("todo"));
  await page.click(`#todo-list .workout-row .todo-check[aria-label^="Done: Gym A"] >> nth=0`);
  check(
    "ticking a workout records it",
    await page.evaluate(() => workoutDone(addDaysIso(0), fitness.plan.find((x) => x.name === "Gym A").id)),
  );
  await page.evaluate(() => {
    skinRoutine.washPm = [];
    fitness.weighDay = -1;
    activateTab("home");
  }); // no weigh-in row, whatever day it is
  const home = await page.evaluate(() => ({
    text: document.querySelector("#panel-home .home-list").textContent.replace(/\s+/g, " "),
    ring: document.querySelector(".home-ring").getAttribute("aria-label"),
    subs: [...document.querySelectorAll("#panel-home .home-sub")].map((e) => e.textContent.trim()),
  }));
  check(
    "Home lists today's workouts under their type",
    home.text.includes("Gym A") && home.subs.includes("Fitness") && home.subs.includes("Pets"),
    home,
  );
  check("workouts count in the day's ring", home.ring === "1 of 2 done", home.ring);
  await page.evaluate(() => {
    activateTab("jazz3");
    logWeight();
  });
  await page.fill("#modal-lbs", "113.4");
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "logging today again updates today's weigh-in",
    await page.evaluate(() => fitness.weights.length === 2 && currentWeight() === 113.4),
  );
  // the one-time cleanup link removes open to-dos by name
  check(
    "Budget is hidden from the bar but still opens by link",
    await page.evaluate(
      () =>
        !document.querySelector('nav.tabbar [data-tab="budget"]') &&
        (activateTab("budget"), document.getElementById("panel-budget").classList.contains("active")),
    ),
  );
  check(
    "old Fitness links land on Jazz 3.0",
    await page.evaluate(
      () => (
        activateTab("fitness"),
        currentTab === "jazz3" && document.getElementById("panel-jazz3").classList.contains("active")
      ),
    ),
  );
  check(
    "cleanup removes open to-dos by name",
    await page.evaluate(() => {
      window.confirm = () => true;
      todoList.push(
        { id: "g", text: "Gym", done: false, due: addDaysIso(0), starred: false, subitems: [], completedAt: null },
        { id: "k", text: "Keep me", done: false, due: null, starred: false, subitems: [], completedAt: null },
      );
      applyCleanup({ removeTodos: ["gym", "Dog park"] });
      return !todoList.some((t) => t.id === "g") && todoList.some((t) => t.id === "k");
    }),
  );
  check(
    "a to-do link adds a daily to-do once (with its type)",
    await page.evaluate(() => {
      window.confirm = () => true;
      applyCleanup({ addTodos: [{ text: "Creatine (morning)", repeat: "daily", kind: "fitness" }] });
      applyCleanup({ addTodos: [{ text: "Creatine (morning)", repeat: "daily", kind: "fitness" }] }); // second time: already there
      const c = todoList.filter((t) => t.text === "Creatine (morning)");
      return (
        c.length === 1 &&
        c[0].repeat === "daily" &&
        c[0].due === addDaysIso(0) &&
        c[0].kind === "fitness" &&
        todoKind(c[0]) === "fitness"
      );
    }),
  );
  check(
    "junk fitness values are cleaned",
    await page.evaluate(() => {
      fitness.weights.push({ date: "x", lbs: 5 });
      fitness.plan.push({ name: "<b>", days: [9, 2], every: 9, kind: "zzz" });
      normalizeFitness();
      const w = fitness.plan[fitness.plan.length - 1];
      return fitness.weights.length === 2 && JSON.stringify(w.days) === "[2]" && w.every === 4 && w.kind === "fitness";
    }),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Jazz 3.0 plan: Glow and Leadership checklists", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=jazz3" });
  const r = await page.evaluate(() => ({
    secs: [
      document.querySelector("#panel-jazz3 .j3-sec").textContent.trim(),
      ...[...document.querySelectorAll("#panel-jazz3 .p3-title")].map((e) => e.textContent.trim()),
    ],
    glow: document.querySelectorAll("#p3-glow .p3-row").length,
    lead: document.querySelectorAll("#p3-leadership .p3-row").length,
    text: document.getElementById("p3-glow").textContent.replace(/\s+/g, " "),
    insight: document.querySelector("#p3-leadership .insight").textContent,
  }));
  check(
    "sections: Fitness, then Glow and Leadership",
    JSON.stringify(r.secs) === '["Fitness","Glow","Leadership"]',
    r.secs,
  );
  check(
    "Glow has 7 items, Leadership 4, with notes",
    r.glow === 7 && r.lead === 4 && r.text.includes("Nightly") && r.insight === "0/4 done",
    r,
  );
  await page.click('#p3-leadership .todo-check[aria-label="Done: Join a speaking club"]');
  check(
    "ticking an item marks it done",
    await page.evaluate(
      () =>
        plan3.find((x) => x.item === "Join a speaking club").done === true &&
        document.querySelector("#p3-leadership .insight").textContent === "1/4 done",
    ),
  );
  // add to a section, and start a new one
  await page.click("#p3-glow .add-row");
  check("+ Add item preselects its section", (await page.inputValue("#modal-cat")) === "Glow");
  await page.fill("#modal-item", "Silk pillowcase");
  await page.click("#modal-backdrop .modal-btn.primary");
  await page.click("#panel-jazz3 .p3-new");
  await page.fill("#modal-item", "Emergency fund");
  await page.fill("#modal-newcat", "Money's future");
  await page.click("#modal-backdrop .modal-btn.primary");
  const after = await page.evaluate(() => ({
    glow: plan3.filter((x) => x.cat === "Glow").length,
    cats: plan3Cats(),
    card: !!document.getElementById("p3-money-s-future"),
  }));
  check(
    "items add to a section; a new section gets its own card",
    after.glow === 8 && after.cats.includes("Money's future") && after.card,
    after,
  );
  await page.click("#p3-money-s-future .add-row");
  check(
    "a section name with an apostrophe still works for + Add item",
    (await page.inputValue("#modal-cat")) === "Money's future",
  );
  await page.evaluate(() => closeModal());
  check(
    "plan items survive a reload",
    await (async () => {
      await page.reload();
      await page.waitForTimeout(300);
      return page.evaluate(
        () => plan3.length === 13 && plan3.find((x) => x.item === "Join a speaking club").done === true,
      );
    })(),
  );
  check(
    "junk plan items are cleaned",
    await page.evaluate(() => {
      plan3.push({ item: "" }, { item: "<b>x</b>", cat: "" });
      normalizePlan3();
      const last = plan3[plan3.length - 1];
      return plan3.length === 14 && last.cat === "Goals";
    }),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Jazz 3.0 stands out: nav orb and hero chips", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=home" });
  check(
    "the Jazz 3.0 nav button has its gradient orb even when inactive",
    await page.evaluate(() => {
      const b = document.querySelector('nav.tabbar button[data-tab="jazz3"]');
      return !b.classList.contains("active") && !!b.querySelector(".j3-orb svg") && b.textContent.trim() === "Jazz 3.0";
    }),
  );
  await page.click('nav.tabbar button[data-tab="jazz3"]');
  await page.evaluate(() => {
    fitness.start = 115;
    fitness.goal = 130;
    fitness.weights = [{ id: "w1", date: "2026-01-05", lbs: 125.8 }];
    openPinned.delete("p3-leadership");
    renderFitness();
  });
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll("#panel-jazz3 .j3-hero .j3-chip")].map((c) =>
      c.textContent.replace(/\s+/g, " ").trim(),
    ),
  );
  check(
    "hero shows weight progress and each section's tally",
    JSON.stringify(chips) === '["Weight72%","Glow0/7","Leadership0/4"]',
    chips,
  );
  await page.click('#panel-jazz3 .j3-chip:has-text("Leadership")');
  await page.waitForTimeout(600);
  check(
    "tapping a chip opens and scrolls to its section",
    await page.evaluate(() => {
      const el = document.getElementById("p3-leadership");
      const r = el.getBoundingClientRect();
      return el.classList.contains("open") && r.top >= 0 && r.top < innerHeight / 2;
    }),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Fitness: month-by-month weight history", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=jazz3" });
  const r = await page.evaluate(() => {
    const d = (n) => addDaysIso(n);
    fitness.start = 115;
    fitness.goal = 130;
    fitness.weights = [
      [-140, 115],
      [-112, 117.6],
      [-84, 119.2],
      [-50, 124.4],
      [0, 125.8],
    ].map(([n, lbs], i) => ({ id: "w" + i, date: d(n), lbs }));
    renderFitness();
    const s = weightStatus();
    return {
      months: document.querySelectorAll("#weight-card .weight-months > div").length - 1,
      text: document.querySelector("#weight-card .goal-outlook").textContent.replace(/\s+/g, " "),
      rateAll: s.rateAll,
      rate: s.rate,
      eta: !!s.eta,
    };
  });
  check("a By month list appears once weigh-ins span months", r.months >= 4, r);
  check("the all-time change and monthly average show", /Since \w+.*\+10\.8 lb.*lb a month/.test(r.text), r.text);
  check(
    "sparse recent weigh-ins fall back to the all-time pace",
    r.rateAll === true && r.rate > 0.4 && r.eta && r.text.includes("on average"),
    r,
  );
  check(
    "one month of weigh-ins shows no By month list",
    await page.evaluate(() => {
      fitness.weights = [{ id: "a", date: addDaysIso(0), lbs: 125 }];
      renderFitness();
      return !document.querySelector(".weight-months");
    }),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Routine import link: add a PM step on set days", async () => {
  const data = {
    app: "jazz3-routine",
    steps: [
      {
        band: "pm",
        label: "Night serum",
        product: "Night serum",
        days: [0, 2, 4],
        before: "Moisturize",
      },
    ],
    doneItems: ["Night serum"],
  };
  const { ctx, page, errors } = await openApp({
    query: "#import=" + Buffer.from(JSON.stringify(data)).toString("base64url"),
  });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const pm = skinRoutine.pm.map((s) => s.label),
      i = pm.indexOf("Night serum"),
      st = skinRoutine.pm[i];
    return {
      i,
      next: pm[i + 1],
      days: st && st.days,
      tab: document.body.dataset.tab,
      done: plan3.find((x) => x.item === "Night serum").done,
      tue: routineForDate(new Date(2026, 9, 27)).pm.some((s) => s.label === "Night serum"),
      mon: routineForDate(new Date(2026, 9, 26)).pm.some((s) => s.label === "Night serum"),
    };
  });
  check(
    "the step lands before Moisturize, on Sun/Tue/Thu only",
    r.i >= 0 && r.next.startsWith("Moisturize") && JSON.stringify(r.days) === "[0,2,4]",
    r,
  );
  check("it shows on a Tuesday PM and not on a Monday", r.tue && !r.mon, r);
  check("the Glow plan item is ticked and Beauty opens", r.done === true && r.tab === "skin", r);
  check(
    "opening the link again adds nothing",
    await page.evaluate((d) => {
      applyRoutineImport(d);
      return skinRoutine.pm.filter((s) => s.label === "Night serum").length === 1;
    }, data),
  );
  // a follow-up link moves the step's days, adds it to wash-day PM, and rewrites the plan note
  const r2 = await page.evaluate(() => {
    applyRoutineImport({
      app: "jazz3-routine",
      updateSteps: [{ band: "pm", product: "night serum", days: [2, 4, 6], note: "New note" }],
      steps: [
        {
          band: "washPm",
          label: "Night serum",
          product: "Night serum",
          days: [0],
          before: "Moisturize",
        },
      ],
      planNotes: [{ item: "Night serum", note: "PM Tue/Thu/Sat" }],
    });
    const pm = skinRoutine.pm.find((s) => s.label === "Night serum"),
      w = skinRoutine.washPm.map((s) => s.label),
      wi = w.indexOf("Night serum");
    const wash = new Date(washSchedule().anchor + "T12:00");
    return {
      days: pm.days,
      note: pm.note,
      wi,
      next: w[wi + 1],
      washDays: skinRoutine.washPm[wi] && skinRoutine.washPm[wi].days,
      onWash: routineForDate(wash).pm.some((s) => s.label === "Night serum"),
      planNote: plan3.find((x) => x.item === "Night serum").note,
    };
  });
  check(
    "an update link moves the step to new days and note",
    JSON.stringify(r2.days) === "[2,4,6]" && r2.note === "New note",
    r2,
  );
  check(
    "a wash-day step lands before Moisturize with no days, and shows on wash day",
    r2.wi >= 0 && r2.next.startsWith("Moisturize") && !r2.washDays && r2.onWash,
    r2,
  );
  check("plan notes are rewritten", r2.planNote === "PM Tue/Thu/Sat", r2);
  check(
    "no wash-day list means a wash-day step is skipped",
    await page.evaluate(() => {
      const keep = skinRoutine.washPm;
      skinRoutine.washPm = [];
      applyRoutineImport({ app: "jazz3-routine", steps: [{ band: "washPm", label: "X", product: "Y" }] });
      const ok = skinRoutine.washPm.length === 0;
      skinRoutine.washPm = keep;
      return ok;
    }),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Fitness: weigh-in day reminder", async () => {
  const { ctx, page, errors } = await openApp({});
  const r = await page.evaluate(() => {
    const t = addDaysIso(0),
      dow = noonOf(t).getDay();
    fitness = {
      start: 115,
      goal: 130,
      weights: [{ id: "w1", date: addDaysIso(-3), lbs: 125.2 }],
      plan: [],
      checks: {},
      weighDay: dow,
    };
    skinRoutine.washPm = [];
    normalizeFitness();
    saveFitness();
    const row = document.querySelector("#panel-home .weigh-row");
    return {
      row: !!row,
      meta: row && row.textContent.replace(/\s+/g, " "),
      todo: !!document.querySelector("#todo-list .weigh-row"),
      ring: document.querySelector(".home-ring").getAttribute("aria-label"),
      sub: [...document.querySelectorAll("#panel-home .home-sub")].map((e) => e.textContent.trim()),
    };
  });
  check(
    "on weigh-in day, Home and To-Do show Weigh in (under Fitness) with the last weight",
    r.row && r.todo && r.meta.includes("Last 125.2 lb") && r.sub.includes("Fitness"),
    r,
  );
  check("it counts in the day's ring", r.ring === "0 of 1 done", r.ring);
  await page.click("#panel-home .weigh-row .todo-check");
  check(
    "ticking it opens Log weight for that day",
    (await page.textContent("#modal-heading")) === "Log weight" &&
      (await page.inputValue("#modal-date")) === (await page.evaluate(() => addDaysIso(0))),
  );
  await page.fill("#modal-lbs", "125.9");
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "logging a weigh-in ticks the reminder",
    await page.evaluate(
      () =>
        !!document.querySelector("#panel-home .weigh-row .item.checked") &&
        document.querySelector(".home-ring").getAttribute("aria-label") === "1 of 1 done",
    ),
  );
  const other = await page.evaluate(() => {
    const t = addDaysIso(0);
    fitness.weighDay = (noonOf(t).getDay() + 3) % 7;
    fitness.weights = [{ id: "w1", date: addDaysIso(-3), lbs: 125.2 }];
    saveFitness();
    const notToday = !document.querySelector("#panel-home .weigh-row");
    fitness.weights = [{ id: "w1", date: addDaysIso(-9), lbs: 125.2 }];
    saveFitness();
    const overdue = !!document.querySelector("#panel-home .weigh-row");
    fitness.weighDay = -1;
    saveFitness();
    return { notToday, overdue, off: !document.querySelector("#panel-home .weigh-row") };
  });
  check("not shown on other days while up to date", other.notToday, other);
  check("a week without a weigh-in shows it today", other.overdue, other);
  check("turning it off hides it", other.off, other);
  await page.evaluate(() => {
    activateTab("jazz3");
    editWeighDay();
  });
  await page.selectOption("#modal-day", "Thursday");
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "weigh-in day can be changed from the Weight card",
    await page.evaluate(
      () =>
        fitness.weighDay === 4 &&
        document.getElementById("weight-card").textContent.includes("Weigh-in day: Thursdays"),
    ),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

// Fitness tab Weight card (renderFitness) controls are delegated data-action handlers, in empty and populated states.
await section(
  "Fitness: Weight card controls are delegated (empty + populated), history edit targets the selected entry",
  async () => {
    const { ctx, page, errors } = await openApp({});
    const save = () => page.click("#modal-backdrop .modal-btn.primary");
    const modalOpen = () => page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open"));
    await page.evaluate(() => {
      skinRoutine.washPm = [];
      fitness = { start: null, goal: null, weights: [], plan: [], checks: {}, weighDay: -1 };
      normalizeFitness();
      activateTab("jazz3");
      openPinned.add("weight-card");
      renderFitness();
    });
    // empty state
    const empty = await page.evaluate(() =>
      [...document.querySelectorAll("#weight-card .goal-actions button")].map((b) => [
        b.getAttribute("data-action"),
        b.hasAttribute("onclick"),
      ]),
    );
    check(
      "empty-state controls are delegated, no inline onclick",
      JSON.stringify(empty) === '[["fitness-log-weight",false],["fitness-weight-goal",false]]',
      empty,
    );
    await page.click('#weight-card [data-action="fitness-weight-goal"]');
    check("empty Set goal opens Weight goal", (await page.textContent("#modal-heading")) === "Weight goal");
    await page.fill("#modal-start", "150");
    await page.fill("#modal-goal", "140");
    await save();
    check(
      "empty Set goal saves start and goal",
      await page.evaluate(() => fitness.start === 150 && fitness.goal === 140),
    );
    await page.evaluate(() => {
      fitness = { start: null, goal: null, weights: [], plan: [], checks: {}, weighDay: -1 };
      saveFitness();
    });
    await page.click('#weight-card [data-action="fitness-log-weight"]');
    check("empty + Log weight opens Log weight", (await page.textContent("#modal-heading")) === "Log weight");
    await page.fill("#modal-lbs", "148.5");
    await save();
    check(
      "empty + Log weight saves a weigh-in",
      await page.evaluate(() => fitness.weights.length === 1 && fitness.weights[0].lbs === 148.5),
    );
    // populated state
    await page.evaluate(() => {
      fitness = {
        start: 150,
        goal: 140,
        weights: [
          { id: "wa", date: addDaysIso(-10), lbs: 149 },
          { id: "wb", date: addDaysIso(-5), lbs: 147 },
          { id: "wc", date: addDaysIso(-1), lbs: 145 },
        ],
        plan: [],
        checks: {},
        weighDay: 1,
      };
      normalizeFitness();
      saveFitness();
      showWeighIns = false;
      renderFitness();
    });
    check(
      "populated card controls have no inline onclick (shared collapsible header is out of scope)",
      await page.evaluate(() => document.querySelectorAll("#weight-card .coll-body [onclick]").length === 0),
    );
    await page.click('#weight-card [data-action="fitness-weight-goal"]');
    check(
      "goal button opens Weight goal",
      (await page.textContent("#modal-heading")) === "Weight goal" && (await page.inputValue("#modal-goal")) === "140",
    );
    await page.fill("#modal-goal", "138");
    await save();
    check("goal change saves", await page.evaluate(() => fitness.goal === 138));
    await page.click('#weight-card [data-action="fitness-weigh-day"]');
    check("weigh-in day link opens Weigh-in day", (await page.textContent("#modal-heading")) === "Weigh-in day");
    await page.selectOption("#modal-day", "Friday");
    await save();
    check(
      "weigh-in day change saves",
      await page.evaluate(
        () =>
          fitness.weighDay === 5 &&
          document.getElementById("weight-card").textContent.includes("Weigh-in day: Fridays"),
      ),
    );
    await page.click('#weight-card .goal-actions [data-action="fitness-log-weight"]');
    check("populated + Log weight opens a new entry", (await page.textContent("#modal-heading")) === "Log weight");
    await page.fill("#modal-lbs", "144");
    await save();
    check(
      "populated + Log weight adds today's weigh-in",
      await page.evaluate(() => fitness.weights.length === 4 && currentWeight() === 144),
    );
    // history toggle
    check("history starts collapsed", await page.evaluate(() => !document.querySelector("#weight-card .goal-entry")));
    await page.click('#weight-card [data-action="fitness-weigh-history"]');
    check(
      "history toggle expands entries",
      await page.evaluate(
        () =>
          showWeighIns === true &&
          document.querySelectorAll("#weight-card .goal-entry").length === 4 &&
          document.querySelector('#weight-card [data-action="fitness-weigh-history"]').getAttribute("aria-expanded") ===
            "true",
      ),
    );
    await page.click('#weight-card [data-action="fitness-weigh-history"]');
    check(
      "history toggle collapses entries",
      await page.evaluate(() => showWeighIns === false && !document.querySelector("#weight-card .goal-entry")),
    );
    // edit the selected history record
    await page.click('#weight-card [data-action="fitness-weigh-history"]');
    check(
      "history entries carry delegated ids, no inline onclick",
      await page.evaluate(
        () =>
          [...document.querySelectorAll("#weight-card .goal-entry")].every(
            (b) => !b.hasAttribute("onclick") && b.getAttribute("data-action") === "fitness-weigh-edit",
          ) &&
          [...document.querySelectorAll("#weight-card .goal-entry")]
            .map((b) => b.getAttribute("data-weight-id"))
            .includes("wb"),
      ),
    );
    await page.click('#weight-card .goal-entry[data-weight-id="wb"]');
    check(
      "clicking an entry opens Edit weigh-in prefilled with that record",
      (await page.textContent("#modal-heading")) === "Edit weigh-in" && (await page.inputValue("#modal-lbs")) === "147",
    );
    await page.fill("#modal-lbs", "146.2");
    await save();
    check(
      "editing changes only the selected record",
      await page.evaluate(() => {
        const m = Object.fromEntries(fitness.weights.map((w) => [w.id, w.lbs]));
        return m.wa === 149 && m.wb === 146.2 && m.wc === 145 && fitness.weights.length === 4;
      }),
    );
    // invalid / stale ids are no-ops
    await page.evaluate(() => {
      window.__log = [];
      const real = window.logWeight;
      window.logWeight = (...a) => {
        window.__log.push(a);
      };
      window.__real = real;
    });
    const before = await page.evaluate(() => JSON.stringify(fitness));
    await page.evaluate(() => {
      const mk = (attrs) => {
        const b = document.createElement("button");
        for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
        document.body.appendChild(b);
        b.click();
        b.remove();
      };
      mk({ "data-action": "fitness-weigh-edit" });
      for (const v of ["", "nope", "gone", "wb');alert(1);('", "wb ", "w b"])
        mk({ "data-action": "fitness-weigh-edit", "data-weight-id": v });
    });
    check(
      "missing/invalid/stale entry ids do nothing",
      (await page.evaluate(() => window.__log.length)) === 0 &&
        (await page.evaluate(() => JSON.stringify(fitness))) === before &&
        !(await modalOpen()),
    );
    await page.click('#weight-card .goal-entry[data-weight-id="wc"]');
    check(
      "valid id still reaches logWeight with that id",
      JSON.stringify(await page.evaluate(() => window.__log)) === '[["wc"]]',
    );
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
);
await section("to-dos: repeat undo after a sync, un-ticking a repeat, day words on a picked day", async () => {
  const { ctx, page, errors } = await openApp({
    seed: {
      "todo-content": [
        {
          id: "r",
          text: "Water plants",
          done: false,
          due: isoOffset(0),
          starred: false,
          subitems: [],
          completedAt: null,
          repeat: "weekly",
        },
      ],
    },
  });
  await page.click('#panel-home .home-list .todo-check[aria-label="Complete: Water plants"]');
  // a sync swaps in fresh objects before Undo is tapped
  await page.evaluate(() => {
    todoList = JSON.parse(JSON.stringify(todoList));
  });
  await page.click(".toast button");
  const u = await page.evaluate(() => todoList.map((t) => [t.text, t.due, t.done]));
  check("undo still restores the repeat after a sync", u.length === 1 && u[0][1] === isoOffset(0), u);
  // complete again, then un-tick the done copy on Home: the series comes back
  await page.click('#panel-home .home-list .todo-check[aria-label="Complete: Water plants"]');
  check(
    "finished repeat leaves Home",
    !(await page.$('#panel-home .home-list .todo-check[aria-label="Mark not done: Water plants"]')),
  );
  await page.evaluate(() => toggleTodo(todoList.find((t) => t.done && t.text === "Water plants").id));
  const back = await page.evaluate(() => todoList.map((t) => [t.due, t.done]));
  check(
    "un-ticking a repeat's done copy rolls the series back",
    back.length === 1 && back[0][0] === isoOffset(0) && !back[0][1],
    back,
  );
  // a day word wins over Home's picked day
  await page.evaluate(() => selectHomeDate(addDaysIso(3)));
  await showFab(page);
  await page.click("#fab");
  await page.fill("#composer-text", "Dentist tomorrow");
  await page.press("#composer-text", "Enter");
  const added = await page.evaluate(() => {
    const t = todoList.find((x) => x.text === "Dentist");
    return t && t.due;
  });
  check("typed day word beats the picked day", added === isoOffset(1), added);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: fixes from the review", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  const r = await page.evaluate(() => {
    const k = budgetMonthKey();
    budget.income = [
      { id: "inc-a", name: "A", amount: 0.3, start: k + "-02", repeat: "biweekly" },
      { id: "inc-b", name: "B", amount: 500, start: k + "-02", repeat: "biweekly" },
    ];
    bills = [
      {
        id: "bill-1",
        name: "Rent",
        amount: 900,
        due: k + "-05",
        repeat: "monthly",
        autopay: false,
        link: null,
        group: "personal",
        account: null,
      },
    ];
    const pa = incomeInMonth(k).find((p) => p.src.id === "inc-a");
    planFor(pa.key).lines = [
      { id: "l1", name: "x", amount: 0.1 },
      { id: "l2", name: "y", amount: 0.2 },
    ];
    budget.goals = [{ id: "goal-1", name: "Trip", target: 100, saved: 0, date: null, created: k + "-01", log: [] }];
    planFor(pa.key).lines.push({ id: "l3", name: "to trip", amount: 10, goal: "goal-1" });
    saveBudgetData();
    const left = incomeInMonth(k).find((p) => p.src.id === "inc-a").left;
    // A and B are both paid on the 2nd: only the first offers the bills due as a line
    const second = noonOf(k + "-02").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const rentListed = [...document.querySelectorAll("#pay-periods .plan-hint")].filter((b) =>
      b.textContent.includes(`due ${second}–`),
    ).length;
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
  const after = await page.evaluate(() => ({
    plans: Object.keys(budget.plans).filter((k) => k.startsWith("inc-a|")).length,
    saved: goalSaved(budget.goals[0]),
  }));
  check("deleting an income removes its plans", after.plans === 0 && after.saved === 0, after);
  // ...and Undo brings everything back
  await page.click(".toast button");
  check(
    "undo restores a delete",
    await page.evaluate(
      () =>
        budget.income.some((i) => i.id === "inc-a") && Object.keys(budget.plans).some((k) => k.startsWith("inc-a|")),
    ),
  );
  // blank paycheck amount goes back to the usual amount
  await page.evaluate((k) => {
    const p = incomeInMonth(k).find((x) => x.src.id === "inc-b");
    planFor(p.key).amount = 123;
    saveBudgetData();
    editPaycheck("inc-b", p.date);
  }, r.k);
  await page.fill("#modal-amount", "");
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "clearing a payday's amount resets it",
    await page.evaluate((k) => incomeInMonth(k).find((x) => x.src.id === "inc-b").amount === 500, r.k),
  );
  // duplicate goal names are refused
  await page.evaluate(() => editGoal());
  await page.fill("#modal-name", "trip");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("duplicate goal names are refused", await page.evaluate(() => budget.goals.length === 1));
  await page.evaluate(() => closeModal());
  // a bill named "Monthly gym" imports
  check(
    "import keeps bills whose name starts with a heading word",
    await page.evaluate(() => parseBillRows("Card\t3rd\tMonthly gym\t$30").length === 1),
  );
  // no Edit modes: cards carry no Edit chip; Cards & banks opens its own sheet
  check("cards have no Edit chip", !(await page.$(".edit-chip")));
  check(
    "no pencil buttons anywhere",
    await page.evaluate(() => {
      renderHome();
      return !document.querySelector(".row-edit-btn, .inline-pencil");
    }),
  );
  // tapping things edits them
  await page.evaluate(() => {
    activateTab("skin");
    openPinned.add("routine-card");
    renderSkin();
  });
  await page.click("#routine-card .band .step.editable >> nth=0");
  check(
    "tapping a routine step opens its editor",
    (await page.textContent("#modal-heading")).length > 0 && (await page.isVisible("#modal-backdrop.open")),
  );
  await page.evaluate(() => closeModal());
  check("+ Add step is always there", (await page.$$("#routine-card .add-row")).length === 3);
  await page.evaluate(() => openAccounts());
  check(
    "Cards & banks opens as a sheet",
    (await page.textContent("#modal-heading")) === "Cards & banks" && !!(await page.$("#modal-body .acct-add")),
  );
  await page.evaluate(() => closeModal());
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("shopping: Later list", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=wants" });
  const first = await page.evaluate(() => {
    const w = wantsList.find((x) => !wantsState[x.id]);
    return { id: w.id, name: w.name, n: document.querySelectorAll("#wants-pending-card .want-card").length };
  });
  check("no Later card until something's saved for later", !(await page.$("#wants-later-card")));
  await page.click(`#wants-pending-card .later-chip[aria-label="Save ${first.name} for later"]`);
  const r = await page.evaluate(
    (id) => ({
      later: wantsList.find((w) => w.id === id).later,
      n: document.querySelectorAll("#wants-pending-card .want-card").length,
      card: !!document.getElementById("wants-later-card"),
      open: document.getElementById("wants-later-card").classList.contains("open"),
      all: document.querySelector(".filter-chips .fc-count").textContent,
    }),
    first.id,
  );
  check("Later moves it off To buy", r.later === true && r.n === first.n - 1, r);
  check("Later card appears, folded (hidden list)", r.card && !r.open, r);
  check("filter counts leave Later items out", Number(r.all) === first.n - 1, r);
  await page.click(".toast-action");
  check("Undo brings it back", await page.evaluate((id) => !wantsList.find((w) => w.id === id).later, first.id));
  await page.evaluate((id) => setWantLater(id, true), first.id);
  await page.evaluate(() => {
    openPinned.add("wants-later-card");
    renderWants();
  });
  await page.click('#wants-later-card [data-action="want-later"]');
  check(
    "Back to list returns it",
    await page.evaluate(
      (id) => !wantsList.find((w) => w.id === id).later && !document.getElementById("wants-later-card"),
      first.id,
    ),
  );
  // edit modal + composer
  await page.evaluate((id) => editWant(id), first.id);
  await page.check("#modal-later");
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "Edit's Later box saves it for later",
    await page.evaluate((id) => wantsList.find((w) => w.id === id).later === true, first.id),
  );
  await showFab(page);
  await page.click("#fab");
  await page.click("#composer-chips .filter-chip >> text=Later");
  await page.fill("#composer-text", "Someday lamp");
  await page.press("#composer-text", "Enter");
  check(
    "composer's Later chip adds it straight to Later",
    await page.evaluate(() => wantsList.find((w) => w.name === "Someday lamp").later === true),
  );
  await page.evaluate(() => closeComposer());
  check(
    "junk later values are dropped",
    await page.evaluate(() => {
      wantsList[0].later = "yes";
      sanitizeCoreData();
      return !("later" in wantsList[0]);
    }),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("shopping + backup: review fixes", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=wants" });
  await page.click("#panel-wants .want-card .body >> nth=0");
  check("tapping a Shopping item opens its editor", await page.isVisible("#modal-backdrop.open"));
  await page.evaluate(() => closeModal());
  // deleting by id never removes a different item when the id is already gone
  const kept = await page.evaluate(() => {
    const n = wantsList.length;
    editWant(wantsList[0].id);
    wantsList = wantsList.slice(1);
    modalDelete();
    return wantsList.length === n - 1;
  });
  check("delete of an already-gone item removes nothing else", kept);
  // a filtered empty list says so and offers Show all
  await page.evaluate(() => {
    activateTab("wants");
    wantsFilter = "moto";
    wantsList = wantsList.filter((w) => !w.moto);
    renderWants();
  });
  check("filtered empty list offers Show all", (await page.textContent("#wants-pending-card")).includes("Show all"));
  // restoring an older backup resets lists it doesn't have
  const restored = await page.evaluate(() => {
    localStorage.setItem(
      "bills-content",
      JSON.stringify([{ id: "bill-x", name: "Old", amount: 1, due: "2026-01-01", repeat: "monthly" }]),
    );
    const data = { "todo-content": [] };
    SYNC_KEYS.forEach((k) => {
      if (!(k in data)) localStorage.removeItem(k);
    });
    applyRemote({ updatedAt: Date.now(), data });
    return bills.length;
  });
  check("restore clears lists the backup doesn't have", restored === 0, restored);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: import link adds data without replacing anything", async () => {
  const k = isoOffset(0).slice(0, 7);
  const payload = {
    app: "jazz2-budget",
    month: k,
    accounts: ["Bank A"],
    bills: [
      { name: "Rent", amount: 1000, day: 1, group: "joint", account: "Bank A", paid: true },
      { name: "Gym", amount: 20, day: 28 },
      { name: "Existing", amount: 5, day: 3 },
    ],
    income: [
      {
        name: "Paycheck",
        amount: 2000,
        start: k + "-01",
        repeat: "biweekly",
        plans: [{ date: k + "-01", amount: 2100, lines: [{ name: "Card", amount: 300 }] }],
      },
    ],
    goals: [{ name: "House", target: 5000 }],
  };
  const hash = "#import=" + Buffer.from(JSON.stringify(payload)).toString("base64url");
  const { ctx, page, errors } = await openApp({
    query: hash,
    seed: { "bills-content": [{ id: "bill-e", name: "Existing", amount: 99, due: k + "-03", repeat: "monthly" }] },
  });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    bills: bills.map((b) => [b.name, b.amount, b.group, b.account]),
    pays: billPayments.map((p) => p.name),
    rentDue: (bills.find((b) => b.name === "Rent") || {}).due,
    pay1: incomeInMonth(budgetMonthKey())[0],
    goals: budget.goals.map((g) => g.name),
    hash: location.hash,
    tab: currentTab,
  }));
  check(
    "bills added; same-name bill left alone",
    r.bills.length === 3 &&
      r.bills.find((b) => b[0] === "Existing")[1] === 99 &&
      r.bills.some((b) => b[0] === "Rent" && b[2] === "joint" && b[3] === "Bank A"),
    r.bills,
  );
  check(
    "bills marked paid are logged and moved to next month",
    r.pays.includes("Rent") && r.rentDue === addMonthsLocal(k),
    r.rentDue,
  );
  check(
    "paycheck and its plan come in",
    r.pay1 && r.pay1.amount === 2100 && r.pay1.plan.lines[0].name === "Card",
    r.pay1,
  );
  check("goal added, link cleared, Budget opened", r.goals.includes("House") && r.hash === "" && r.tab === "budget", r);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: import link switches an existing paycheck to varying pay", async () => {
  const k = isoOffset(0).slice(0, 7);
  const payload = {
    app: "jazz2-budget",
    month: k,
    income: [
      {
        name: "Paycheck",
        amount: 2000,
        start: k + "-01",
        repeat: "biweekly",
        varies: true,
        plans: [
          { date: k + "-01", amount: 2100, received: true },
          { date: k + "-15", amount: 2000 },
        ],
      },
    ],
  };
  const hash = "#import=" + Buffer.from(JSON.stringify(payload)).toString("base64url");
  const seed = {
    "budget-content": {
      categories: [],
      expenses: [],
      accounts: [],
      goals: [],
      income: [{ id: "inc-x", name: "Paycheck", amount: 2000, start: k + "-01", repeat: "biweekly" }],
      plans: { [`inc-x|${k}-01`]: { lines: [{ id: "line-a", name: "Bills", amount: 500 }] } },
    },
  };
  const { ctx, page, errors } = await openApp({ query: hash, seed });
  await page.waitForTimeout(400);
  const r = await page.evaluate(
    (k) => ({
      n: budget.income.length,
      varies: budget.income[0].varies,
      p1: budget.plans[`inc-x|${k}-01`],
      p15: budget.plans[`inc-x|${k}-15`],
    }),
    k,
  );
  check("existing paycheck reused and set to vary", r.n === 1 && r.varies === true, r);
  check(
    "payday with lines keeps them; gets its amount and Received",
    r.p1.amount === 2100 && r.p1.received === true && r.p1.lines.length === 1,
    r.p1,
  );
  check("expected payday gets its exact amount", r.p15 && r.p15.amount === 2000 && !r.p15.received, r.p15);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("bill logos", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  const r = await page.evaluate(() => ({
    guess: [
      billDomain({ name: "Spotify" }),
      billDomain({ name: "Prime Membership" }),
      billDomain({ name: "AT&T" }),
      billDomain({ name: "Duke" }),
      billDomain({ name: "Rent" }),
    ],
    link: billDomain({ name: "Phone", link: "https://www.verizon.com/pay" }),
    site: billDomain({ name: "Phone", site: "mint.com", link: "https://www.verizon.com/pay" }),
    clean: [
      cleanDomain("https://www.att.com/pay"),
      cleanDomain("ATT.com"),
      cleanDomain("not a site"),
      cleanDomain("javascript:alert(1)"),
    ],
    letter: billLogoHtml({ name: "Rent" }),
    withLink: billLogoHtml({ name: "Spotify", link: "https://spotify.com/account" }),
  }));
  check(
    "logos guessed from well-known names",
    JSON.stringify(r.guess) === JSON.stringify(["spotify.com", "amazon.com", "att.com", "duke-energy.com", ""]),
    r.guess,
  );
  check(
    "pay link's site wins over the guess; a set website wins over both",
    r.link === "verizon.com" && r.site === "mint.com",
    r,
  );
  check(
    "websites are cleaned and junk refused",
    JSON.stringify(r.clean) === JSON.stringify(["att.com", "att.com", "", ""]),
    r.clean,
  );
  check("no logo: a colored first letter", r.letter.includes("bill-logo letter") && r.letter.includes(">R<"), r.letter);
  check(
    "with a pay link, the logo is the pay button",
    r.withLink.includes('class="bill-logo-link"') &&
      r.withLink.includes("https://spotify.com/account") &&
      r.withLink.includes("icons.duckduckgo.com/ip3/spotify.com.ico"),
    r.withLink,
  );
  // editing a bill: the website field shows the guess, and only a real override is stored
  await page.evaluate(() => {
    bills = [
      {
        id: "bill-s",
        name: "Spotify",
        amount: 12,
        due: addDaysIso(3),
        repeat: "monthly",
        autopay: false,
        link: null,
        group: "personal",
        account: null,
      },
    ];
    saveBudgetData();
    editBill("bill-s");
  });
  check("website field prefilled with the guess", (await page.inputValue("#modal-site")) === "spotify.com");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("an unchanged guess isn't stored", await page.evaluate(() => !("site" in bills[0])));
  await page.evaluate(() => editBill("bill-s"));
  await page.fill("#modal-site", "https://www.tidal.com/");
  await page.click("#modal-backdrop .modal-btn.primary");
  check("a typed website is cleaned and stored", await page.evaluate(() => bills[0].site === "tidal.com"));
  check(
    "bad site values from sync are dropped",
    await page.evaluate(() => {
      bills[0].site = "<x>";
      normalizeBudgetData();
      return !("site" in bills[0]);
    }),
  );
  check("no JS errors", errors.filter((e) => !/Failed to load resource/.test(e)).length === 0, errors);
  await ctx.close();
});

await section("budget: month calendar", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  const k = await page.evaluate(() => {
    const k = budgetMonthKey(),
      d = (n) => `${k}-${String(n).padStart(2, "0")}`;
    budget.income = [{ id: "inc-1", name: "Paycheck", amount: 2000, start: d(1), repeat: "biweekly" }];
    bills = [
      {
        id: "bill-a",
        name: "Rent",
        amount: 900,
        due: d(28),
        repeat: "monthly",
        autopay: false,
        link: null,
        group: "personal",
        account: null,
      },
    ];
    openPinned.add("budget-cal"); // it starts folded
    saveBudgetData();
    return k;
  });
  check(
    "calendar starts as one week",
    (await page.$$eval("#budget-cal .home-day:not(.blank)", (els) => els.length)) === 7,
  );
  await page.click("#budget-cal .home-cal-grab");
  const cells = await page.$$eval("#budget-cal .home-day:not(.blank):not(.other)", (els) => els.length);
  const days = await page.evaluate((k) => Number(monthEndIso(k).slice(8)), k);
  check("calendar shows every day of the month", cells === days, [cells, days]);
  check(
    "paydays and bill days are marked",
    (await page.$$("#budget-cal .marks em.pay")).length >= 2 && (await page.$$("#budget-cal .marks i")).length >= 1,
  );
  await page.click(
    `#budget-cal .home-day[aria-label^="${await page.evaluate((k) => noonOf(k + "-28").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }), k)}"]`,
  );
  check("tapping a day lists its bills", (await page.textContent("#budget-cal .bcal-detail")).includes("Rent"));
  await page.click('#budget-cal .bcal-detail .todo-check[aria-label="Mark paid: Rent"]');
  check("bills can be paid from the calendar", await page.evaluate(() => billPayments.length === 1));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: autopay pays bills on their due date", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=budget",
    seed: {
      "bills-content": [
        {
          id: "bill-auto",
          name: "Phone",
          amount: 70,
          due: isoOffset(-3),
          repeat: "monthly",
          autopay: true,
          account: null,
        },
        {
          id: "bill-man",
          name: "Rent",
          amount: 900,
          due: isoOffset(-3),
          repeat: "monthly",
          autopay: false,
          account: null,
        },
        {
          id: "bill-soon",
          name: "Gym",
          amount: 20,
          due: isoOffset(2),
          repeat: "monthly",
          autopay: true,
          account: null,
        },
      ],
    },
  });
  const r = await page.evaluate(() => {
    const gymDue = bills.find((b) => b.id === "bill-soon").due;
    if (gymDue.slice(0, 7) !== addDaysIso(0).slice(0, 7)) {
      budgetMonthOffset = 1; // near month-end the upcoming bill is in next month's table
      renderBudget();
    }
    return {
      pays: billPayments.map((p) => [p.name, p.date, !!p.auto]),
      phoneDue: bills.find((b) => b.id === "bill-auto").due,
      rentDue: bills.find((b) => b.id === "bill-man").due,
      gymMeta: [...document.querySelectorAll("#panel-budget .btab-row")]
        .map((e) => e.textContent.replace(/\s+/g, " "))
        .find((t) => t.includes("Gym")),
    };
  });
  check(
    "a due autopay bill is logged as paid on its due date",
    r.pays.length === 1 && r.pays[0][0] === "Phone" && r.pays[0][1] === isoOffset(-3) && r.pays[0][2],
    r.pays,
  );
  check(
    "…and moves to next month; manual bills stay overdue",
    r.phoneDue > isoOffset(0) && r.rentDue === isoOffset(-3),
    r,
  );
  check("upcoming autopay bills say so", (r.gymMeta || "").includes("Autopay"), r.gymMeta);
  // un-paying an autopaid bill holds it instead of re-paying it at once
  await page.evaluate(() => unpayBill(billPayments[0].id));
  check(
    "un-paying an autopaid bill sticks",
    await page.evaluate(
      () => billPayments.length === 0 && bills.find((b) => b.id === "bill-auto").due === addDaysIso(-3),
    ),
  );
  // turning autopay on for an overdue bill pays it
  await page.evaluate(() => editBill("bill-man"));
  await page.check("#modal-autopay");
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "switching Autopay on pays what's already due",
    await page.evaluate(() => billPayments.some((p) => p.name === "Rent" && p.auto)),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("refresh stays on the same tab; Wash hair opens its card", async () => {
  const { ctx, page, errors } = await openApp();
  await page.evaluate(() => {
    skinRoutine.wash = { anchor: addDaysIso(0), everyDays: 14 };
    activateTab("home");
    renderHome();
  });
  await page.click("#panel-home .wash-row .body");
  const w = await page.evaluate(() => ({
    tab: currentTab,
    open: document.getElementById("wash-card").classList.contains("open"),
  }));
  check("tapping Wash hair opens the Wash day card on Beauty", w.tab === "skin" && w.open, w);
  await page.evaluate(() => {
    activateTab("budget");
    sessionStorage.setItem("resume-view", JSON.stringify({ tab: currentTab, scroll: 0 }));
  });
  const cacheState = await page.evaluate(async () => {
    await caches.open("jazz2-cache-v113");
    await caches.open("unrelated-app-cache");
    const registration = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    const worker = registration.active;
    if (worker.state !== "activated")
      await new Promise((resolve) => {
        const onStateChange = () => {
          if (worker.state === "activated") {
            worker.removeEventListener("statechange", onStateChange);
            resolve();
          }
        };
        worker.addEventListener("statechange", onStateChange);
        onStateChange();
      });
    await caches.open("jazz2-cache-v117");
    return (await caches.keys()).sort();
  });
  check(
    "service-worker activation preserves caches owned by other apps",
    cacheState.includes("unrelated-app-cache") && !cacheState.includes("jazz2-cache-v113"),
    cacheState,
  );
  const reload = page.waitForNavigation({ waitUntil: "load" });
  await page.evaluate(() => setTimeout(hardRefresh, 0));
  await reload;
  const r = await page.evaluate(async () => ({
    tab: currentTab,
    panel: document.getElementById("panel-budget").classList.contains("active"),
    left: sessionStorage.getItem("resume-view"),
    caches: await caches.keys(),
    jazzWorker: (await navigator.serviceWorker.getRegistrations()).some((reg) =>
      [reg.active, reg.waiting, reg.installing].some(
        (worker) => worker && worker.scriptURL === new URL("sw.js", location.href).href,
      ),
    ),
  }));
  check("pull-to-refresh comes back to the same tab", r.tab === "budget" && r.panel && r.left === null, r);
  check(
    "hard refresh clears only Jazz caches and its own worker",
    r.caches.includes("unrelated-app-cache") && !r.caches.some((k) => k.startsWith("jazz2-cache-")) && !r.jazzWorker,
    r,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("external stylesheet loads and the app stays styled offline", async () => {
  const { ctx, page, errors } = await openApp();
  const cssRes = await page.request.get(new URL("css/app.css", APP).href);
  check(
    "stylesheet is served as text/css",
    cssRes.ok() && (cssRes.headers()["content-type"] || "").startsWith("text/css"),
    [cssRes.status(), cssRes.headers()["content-type"]],
  );
  const styled = () =>
    page.evaluate(() => ({
      links: document.querySelectorAll('link[rel="stylesheet"][href="css/app.css"]').length,
      inline: document.querySelectorAll("style").length,
      bg: getComputedStyle(document.body).backgroundColor,
      token: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || null,
      tabbar: getComputedStyle(document.querySelector(".tabbar, nav")).position,
    }));
  const online = await styled();
  check("page links css/app.css and has no inline style block", online.links === 1 && online.inline === 0, online);
  check("stylesheet applies online", online.bg !== "rgba(0, 0, 0, 0)" && online.bg !== "rgb(255, 255, 255)", online);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: "load" });
  check("service worker controls the page", await page.evaluate(() => !!navigator.serviceWorker.controller));
  check("stylesheet is precached", await page.evaluate(async () => !!(await caches.match("css/app.css"))));
  check(
    "app scripts are precached",
    await page.evaluate(async () => {
      const srcs = [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src"));
      const hits = await Promise.all(srcs.map((s) => caches.match(s)));
      return srcs.length > 1 && hits.every(Boolean);
    }),
  );
  await ctx.setOffline(true);
  await page.reload({ waitUntil: "load" });
  check(
    "app JS runs after an offline controlled reload (all tabs render)",
    await page.evaluate(() => {
      if (typeof activateTab !== "function") return false;
      for (const t of ["home", "todo", "jazz3", "wants", "skin", "budget"]) {
        activateTab(t);
        if (!document.getElementById("headline").textContent) return false;
      }
      return true;
    }),
  );
  const offline = await styled();
  check(
    "app stays styled after an offline controlled reload",
    offline.bg === online.bg &&
      offline.token === online.token &&
      offline.tabbar === online.tabbar &&
      offline.links === 1,
    [online, offline],
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.setOffline(false);
  await ctx.close();
});

// Phase 2a safety net: representative inline-handler interactions by tab, including
// nested "row opens editor" vs "inner button does something else" cases, so a later
// move to delegated handlers can't change which action fires.
await section("handlers: to-do rows vs inner buttons, sub-items, modal backdrop", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=todo",
    seed: {
      "todo-content": [
        {
          id: "ha",
          text: "Alpha",
          done: false,
          due: isoOffset(0),
          starred: false,
          subitems: [{ id: "s1", text: "One", done: false }],
          completedAt: null,
        },
        { id: "hb", text: "Beta", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
        {
          id: "hc",
          text: "Gamma",
          done: true,
          due: isoOffset(0),
          starred: false,
          subitems: [],
          completedAt: Date.now(),
        },
      ],
    },
  });
  const modalOpen = () => page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open"));
  const row = (id) => `#todo-list .todo-wrap[data-todo-id="${id}"]`;
  await page.click(`${row("hb")} .todo-check`);
  check(
    "to-do check completes without opening the editor",
    (await page.evaluate(() => todoList.find((t) => t.id === "hb").done)) && !(await modalOpen()),
  );
  await page.click(`${row("ha")} .todo-icon-btn[aria-label$="to-do"]`);
  check(
    "to-do star toggles without opening the editor",
    (await page.evaluate(() => todoList.find((t) => t.id === "ha").starred)) && !(await modalOpen()),
  );
  await page.click(`${row("ha")} .todo-icon-btn[aria-label$="sub-items"]`);
  check(
    "sub-item toggle expands the list without opening the editor",
    (await page.$$(`${row("ha")} .subitem-row`)).length === 1 && !(await modalOpen()),
  );
  await page.click(`${row("ha")} .subitem-check`);
  check(
    "sub-item check toggles only the sub-item",
    (await page.evaluate(() => {
      const t = todoList.find((x) => x.id === "ha");
      return t.subitems[0].done && !t.done;
    })) && !(await modalOpen()),
  );
  await page.click(`${row("ha")} .subitem-list`, { position: { x: 3, y: 3 } });
  check("clicking inside the sub-item list does not open the editor", !(await modalOpen()));
  await page.click(`${row("ha")} .subitem-add-toggle`);
  await page.fill(`#subitem-input-ha`, "Two");
  await page.press(`#subitem-input-ha`, "Enter");
  check(
    "Enter in the sub-item input adds a sub-item",
    (await page.evaluate(() =>
      todoList
        .find((t) => t.id === "ha")
        .subitems.map((s) => s.text)
        .join(),
    )) === "One,Two",
  );
  await page.click(`${row("ha")} .subitem-del >> nth=0`);
  check(
    "sub-item delete removes only that sub-item",
    (await page.evaluate(() =>
      todoList
        .find((t) => t.id === "ha")
        .subitems.map((s) => s.text)
        .join(),
    )) === "Two",
  );
  await page.click(`${row("ha")} .body`);
  check("tapping the row body opens the editor", await modalOpen());
  await page.click("#modal-heading");
  check("clicking inside the modal does not close it", await modalOpen());
  await page.mouse.click(2, 2);
  check("clicking the backdrop closes the modal", !(await modalOpen()));
  await page.click("#todo-card .completed-toggle");
  await page.click('.item:has-text("Gamma") button[aria-label="Duplicate to-do"]');
  check(
    "completed-row duplicate button copies the to-do",
    (await page.evaluate(() => todoList.filter((t) => t.text.startsWith("Gamma")).length)) === 2 &&
      !(await modalOpen()),
  );
  await page.click('.item:has-text("Beta") button[aria-label="Delete to-do"]');
  check(
    "completed-row delete button removes only its to-do without opening the editor",
    (await page.evaluate(() => todoList.some((t) => t.id === "hc") && !todoList.some((t) => t.id === "hb"))) &&
      !(await modalOpen()),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("handlers: Home bill pay button vs row, composer chips and date input", async () => {
  const { ctx, page, errors } = await openApp({
    seed: {
      "bills-content": [
        { id: "hbill", name: "Rent", amount: 900, due: isoOffset(0), repeat: "monthly", autopay: false, account: null },
      ],
    },
  });
  const modalOpen = () => page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open"));
  await page.click('#panel-home button[aria-label="Mark paid: Rent"]');
  check(
    "Home bill check pays it without opening the editor",
    (await page.evaluate(() => billPayments.length)) === 1 && !(await modalOpen()),
  );
  await page.click('#panel-home button[aria-label="Mark not paid: Rent"]');
  check(
    "Home paid bill check un-pays it",
    (await page.evaluate(() => billPayments.length)) === 0 && !(await modalOpen()),
  );
  await page.click("#panel-home .home-list .todo-wrap .body >> text=Rent");
  check("Home bill row opens its editor", await modalOpen());
  await page.evaluate(() => closeModal());
  await showFab(page);
  await page.click("#fab");
  check(
    "+ opens the composer",
    await page.evaluate(() => document.getElementById("composer").classList.contains("open")),
  );
  await page.click("#composer-chips .filter-chip >> text=Star");
  check("composer chip toggles its flag", await page.evaluate(() => composer.star === true));
  await page.click("#composer-chips .filter-chip >> text=Repeat");
  check("composer repeat chip sets weekly", await page.evaluate(() => composer.repeat === "weekly"));
  await page.evaluate(() => {
    const i = document.querySelector("#composer input[type=date]");
    i.value = addDaysIso(3);
    i.dispatchEvent(new Event("change", { bubbles: true }));
  });
  check(
    "composer date input change sets a manual date",
    await page.evaluate(() => composer.manual === true && composer.date === addDaysIso(3)),
  );
  await page.fill("#composer-text", "Handler check item");
  await page.click("#composer-add-btn");
  check(
    "composer Add saves the to-do",
    await page.evaluate(() => todoList.some((t) => t.text.startsWith("Handler check item"))),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("handlers: wants card vs buttons, filter chips; routine, budget, fitness rows", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=wants" });
  const modalOpen = () => page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open"));
  const first = "#wants-pending-card .want-card >> nth=0";
  const id0 = await page.evaluate(() => [...wantsList].filter((w) => !wantsState[w.id]).sort(wantsOrder)[0].id);
  await page.click(`${first} >> .todo-check`);
  check(
    "Mark bought marks it without opening the editor",
    (await page.evaluate((i) => !!wantsState[i], id0)) && !(await modalOpen()),
  );
  await page.click("#wants-pending-card .want-card >> nth=0 >> .body");
  check("want card body opens its editor", await modalOpen());
  await page.evaluate(() => closeModal());
  await page.click(".filter-chip >> text=Moto");
  check("Moto filter chip sets the filter", (await page.evaluate(() => wantsFilter)) === "moto");
  await page.click(".filter-chip >> text=All");
  check("All filter chip clears the filter", (await page.evaluate(() => wantsFilter)) === "all");
  await page.evaluate(() => activateTab("skin"));
  const band = await page.evaluate(() => {
    const b = document.querySelector("#panel-skin .routine-band .routine-band-head");
    return !!b;
  });
  if (band) {
    const before = await page.evaluate(() => document.querySelectorAll("#panel-skin .routine-step").length);
    await page.click("#panel-skin .routine-band-head >> nth=0");
    check(
      "routine band header toggles its band",
      (await page.evaluate(() => document.querySelectorAll("#panel-skin .routine-step").length)) !== before,
    );
  }
  await page.evaluate(() => {
    fitness.plan = [
      { id: "hw1", name: "Handler Gym", days: [0, 1, 2, 3, 4, 5, 6], every: 1, anchor: addDaysIso(0), kind: "fitness" },
    ];
    activateTab("todo");
    renderHome();
  });
  await page.click('#todo-list button[aria-label="Done: Handler Gym"]');
  check(
    "workout check logs it without opening the editor",
    (await page.evaluate(() => workoutDone(addDaysIso(0), "hw1"))) && !(await modalOpen()),
  );
  await page.click("#todo-list .workout-row .body >> text=Handler Gym");
  check("workout row body opens its editor", await modalOpen());
  await page.evaluate(() => closeModal());
  await ctx.close();
  const b = await openApp({
    query: "?tab=budget",
    seed: {
      "bills-content": [
        { id: "hb1", name: "Phone", amount: 70, due: isoOffset(0), repeat: "monthly", autopay: false, account: null },
      ],
    },
  });
  const bOpen = () => b.page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open"));
  await b.page.click('#panel-budget button.todo-check[aria-label="Mark paid: Phone"] >> visible=true >> nth=0');
  check(
    "Budget bill check pays it without opening the editor",
    (await b.page.evaluate(() => billPayments.length)) === 1 && !(await bOpen()),
  );
  await b.page.click("#panel-budget .btab-name >> visible=true >> text=Phone");
  check("Budget bill name opens the payment editor", await bOpen());
  check("no JS errors", errors.length === 0 && b.errors.length === 0, [...errors, ...b.errors]);
  await b.ctx.close();
});

// Phase 2a-plus gates: things a delegated-handler rewrite is most likely to break.
await section("handlers: hostile ids stay inert through load, restore and sync, and actions still work", async () => {
  const evilId = `x');window.__pwned++;('"<&\\`;
  const evilTodo = {
    id: evilId,
    text: "Evil todo",
    done: false,
    due: isoOffset(0),
    starred: false,
    subitems: [{ id: evilId, text: "Evil sub", done: false }],
    completedAt: null,
  };
  const evilWant = { id: evilId, name: "Evil want", meta: "", price: 5, link: "" };
  const probe = async (page, label) => {
    await page.evaluate(() => {
      window.__pwned = 0;
      activateTab("todo");
      expandedTodos.clear();
      expandedTodos.add(todoList[0].id);
      renderHome();
    });
    const r = await page.evaluate(() => {
      const t = todoList[0];
      return { todoId: t.id, subId: t.subitems[0].id, wantIds: wantsList.map((w) => w.id), pwned: window.__pwned };
    });
    check(
      `${label}: ids are sanitized to safe characters`,
      /^[A-Za-z0-9_-]+$/.test(r.todoId) &&
        /^[A-Za-z0-9_-]+$/.test(r.subId) &&
        r.wantIds.every((i) => /^[A-Za-z0-9_-]+$/.test(i)),
      r,
    );
    await page.click("#todo-list .todo-wrap[data-todo-id] .subitem-check");
    check(`${label}: sub-item action works`, await page.evaluate(() => todoList[0].subitems[0].done === true));
    await page.click("#todo-list .todo-wrap[data-todo-id] .todo-check");
    check(`${label}: to-do action works`, await page.evaluate(() => todoList[0].done === true));
    await page.evaluate(() => {
      activateTab("wants");
      renderWants();
    });
    await page.click(`#wants-pending-card .want-card:has-text("Evil want") >> .todo-check`);
    check(
      `${label}: want action works`,
      await page.evaluate(() => {
        const w = wantsList.find((x) => x.name === "Evil want");
        return !!wantsState[w.id];
      }),
    );
    check(`${label}: no injected script ran`, (await page.evaluate(() => window.__pwned)) === 0);
  };
  {
    // load from storage
    const { ctx, page, errors } = await openApp({
      seed: { "todo-content": [evilTodo], "wants-content": [evilWant], "wants-state": {} },
    });
    await probe(page, "load");
    check("load: no JS errors", errors.length === 0, errors);
    await ctx.close();
  }
  {
    // restore from a backup file
    const { ctx, page, errors } = await openApp();
    const backup = await page.evaluate(() => {
      let captured;
      const orig = URL.createObjectURL;
      URL.createObjectURL = (blob) => {
        captured = blob;
        return orig.call(URL, blob);
      };
      navigator.canShare = undefined;
      return downloadBackup()
        .then(() => captured.text())
        .then(JSON.parse);
    });
    backup.data["todo-content"] = [evilTodo];
    backup.data["wants-content"] = [evilWant];
    backup.data["wants-state"] = {};
    await page.evaluate(() => openSyncModal());
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("text=Restore…")]);
    await chooser.setFiles({
      name: "evil.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await page.waitForFunction(() => todoList.length === 1 && todoList[0].text === "Evil todo");
    await page.evaluate(() => {
      if (document.getElementById("modal-backdrop").classList.contains("open")) closeModal();
    });
    await probe(page, "restore");
    check("restore: no JS errors", errors.length === 0, errors);
    await ctx.close();
  }
  {
    // sync from a remote copy
    const { ctx, page, errors } = await openApp();
    await page.evaluate(
      ([t, w]) =>
        applyRemote({ updatedAt: Date.now(), data: { "todo-content": [t], "wants-content": [w], "wants-state": {} } }),
      [evilTodo, evilWant],
    );
    await probe(page, "sync");
    check("sync: no JS errors", errors.length === 0, errors);
    await ctx.close();
  }
});

await section("handlers: bill logo falls back to a letter when the icon host fails", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=budget",
    seed: {
      "bills-content": [
        { id: "lg1", name: "Spotify", amount: 12, due: isoOffset(1), repeat: "monthly", autopay: false, account: null },
      ],
    },
  });
  await ctx.route("https://icons.duckduckgo.com/**", (route) => route.abort());
  await page.evaluate(() => {
    activateTab("budget");
    renderBudget();
  });
  await page.waitForFunction(() => document.querySelectorAll("#panel-budget .bill-logo").length > 0);
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({
    imgs: document.querySelectorAll("#panel-budget img.bill-logo").length,
    letters: [...document.querySelectorAll("#panel-budget .btab-row .bill-logo.letter")].map((e) => e.textContent),
  }));
  check("failed icon request is replaced by the first-letter fallback", r.imgs === 0 && r.letters.includes("S"), r);
  check("no JS errors", errors.filter((e) => !/Failed to load resource|ERR_FAILED/.test(e)).length === 0, errors);
  await ctx.close();
});

await section("handlers: keyboard, nested children, re-render, double-click and drag-tap guard", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=todo",
    seed: {
      "todo-content": [
        {
          id: "k1",
          text: "Key one",
          done: false,
          due: isoOffset(0),
          starred: false,
          subitems: [{ id: "ks1", text: "Sub", done: false }],
          completedAt: null,
        },
        { id: "k2", text: "Key two", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
        {
          id: "k3",
          text: "Key three",
          done: false,
          due: isoOffset(0),
          starred: false,
          subitems: [],
          completedAt: null,
        },
        { id: "k4", text: "Key four", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
      ],
    },
  });
  const modalOpen = () => page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open"));
  const row = (id) => `#todo-list .todo-wrap[data-todo-id="${id}"]`;
  const get = (id, f) => page.evaluate(([i, k]) => todoList.find((t) => t.id === i)[k], [id, f]);
  // keyboard: native buttons activate on Enter and Space
  await page.focus(`${row("k1")} .todo-check`);
  await page.keyboard.press("Enter");
  check("Enter activates a to-do check", (await get("k1", "done")) === true && !(await modalOpen()));
  await page.focus(`${row("k2")} .todo-check`);
  await page.keyboard.press("Space");
  check("Space activates a to-do check", (await get("k2", "done")) === true && !(await modalOpen()));
  await page.focus(`${row("k3")} .todo-icon-btn[aria-label$="to-do"]`);
  await page.keyboard.press("Enter");
  check(
    "Enter on the star button stars without opening the editor",
    (await get("k3", "starred")) === true && !(await modalOpen()),
  );
  // nested child: clicking the SVG inside a check resolves the check, not the row
  await page.click(`${row("k4")} .todo-check svg`);
  check(
    "clicking the SVG inside a check completes it and doesn't open the editor",
    (await get("k4", "done")) === true && !(await modalOpen()),
  );
  // re-render: a to-do added after the first render is actionable
  await page.evaluate(() => {
    todoList.push({
      id: "k5",
      text: "Added later",
      done: false,
      due: addDaysIso(0),
      starred: false,
      subitems: [],
      completedAt: null,
    });
    renderHome();
  });
  await page.click(`${row("k5")} .todo-check`);
  check("a row created by a later render is actionable", (await get("k5", "done")) === true);
  // double-click on a toggle: records the current behavior (the second click lands on the re-rendered node)
  await page.evaluate(() => {
    todoList.push({
      id: "k6",
      text: "Double",
      done: false,
      due: addDaysIso(0),
      starred: false,
      subitems: [],
      completedAt: null,
    });
    renderHome();
  });
  await page.dblclick(`${row("k6")} .todo-icon-btn[aria-label$="to-do"]`);
  check(
    "double-clicking the star toggles once (current behavior: the second click is lost to the re-render)",
    (await get("k6", "starred")) === true,
  );
  // sub-item input: other keys and an empty Enter do nothing
  await page.evaluate(() => {
    todoList.push({
      id: "k1b",
      text: "Sub host",
      done: false,
      due: addDaysIso(0),
      starred: false,
      subitems: [{ id: "kb1", text: "Sub", done: false }],
      completedAt: null,
    });
    expandedTodos.clear();
    expandedTodos.add("k1b");
    subAddOpen.add("k1b");
    renderHome();
  });
  const before = await page.evaluate(() => todoList.find((t) => t.id === "k1b").subitems.length);
  await page.fill("#subitem-input-k1b", "typed");
  await page.press("#subitem-input-k1b", "a");
  await page.press("#subitem-input-k1b", "Space");
  check(
    "non-Enter keys don't add a sub-item",
    (await page.evaluate(() => todoList.find((t) => t.id === "k1b").subitems.length)) === before,
  );
  await page.fill("#subitem-input-k1b", "");
  await page.press("#subitem-input-k1b", "Enter");
  check(
    "Enter on an empty sub-item input adds nothing",
    (await page.evaluate(() => todoList.find((t) => t.id === "k1b").subitems.length)) === before,
  );
  // the click that ends a drag is swallowed for 400 ms, then clicks work again
  await page.evaluate(() => {
    todoList.push({
      id: "k7",
      text: "Drag tap",
      done: false,
      due: addDaysIso(0),
      starred: false,
      subitems: [],
      completedAt: null,
    });
    renderHome();
  });
  await page.evaluate(() => {
    dragJustEnded = Date.now();
    document.querySelector('#todo-list .todo-wrap[data-todo-id="k7"] .todo-check').click();
  });
  check("a click right after a drag ends is suppressed", (await get("k7", "done")) === false && !(await modalOpen()));
  await page.waitForFunction(() => Date.now() - dragJustEnded > 600);
  await page.click(`${row("k7")} .todo-check`);
  check("clicks work again after the drag window", (await get("k7", "done")) === true);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section(
  "handlers: generated sub-item actions (toggle, delete, open-add, add, Enter, propagation, invalid ids)",
  async () => {
    const { ctx, page, errors } = await openApp({
      query: "?tab=todo",
      seed: {
        "todo-content": [
          {
            id: "p1",
            text: "Parent one",
            done: false,
            due: isoOffset(0),
            starred: false,
            subitems: [
              { id: "s1", text: "First", done: false },
              { id: "s2", text: "Second", done: false },
            ],
            completedAt: null,
          },
          {
            id: "p2",
            text: "Parent two",
            done: false,
            due: isoOffset(0),
            starred: false,
            subitems: [{ id: "t1", text: "Other", done: false }],
            completedAt: null,
          },
        ],
      },
    });
    const modalOpen = () => page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open"));
    const subs = (id) =>
      page.evaluate((i) => todoList.find((t) => t.id === i).subitems.map((s) => [s.id, s.text, s.done]), id);
    const wrap = (id) => `#todo-list .todo-wrap[data-todo-id="${id}"]`;
    const focusedId = () => page.evaluate(() => document.activeElement && document.activeElement.id);
    await page.evaluate(() => {
      expandedTodos.clear();
      expandedTodos.add("p1");
      expandedTodos.add("p2");
      renderHome();
      window.__docClicks = 0;
      document.addEventListener("click", () => window.__docClicks++);
    });
    // markup: no inline handlers inside the generated sub-item list
    check(
      "sub-item list has no inline handlers",
      await page.evaluate(
        () =>
          ![...document.querySelectorAll(".subitem-list, .subitem-list *")].some(
            (n) => n.hasAttribute("onclick") || n.hasAttribute("onkeydown"),
          ),
      ),
    );
    // toggle
    await page.click(`${wrap("p1")} .subitem-row[data-sub-id="s1"] .subitem-check`);
    check(
      "sub-item check toggles only that sub-item",
      JSON.stringify(await subs("p1")) ===
        JSON.stringify([
          ["s1", "First", true],
          ["s2", "Second", false],
        ]) && (await subs("p2"))[0][2] === false,
      await subs("p1"),
    );
    check(
      "toggle leaves parent row alone (no editor, still expanded, not done)",
      !(await modalOpen()) && (await page.evaluate(() => expandedTodos.has("p1") && !todoList[0].done)),
    );
    await page.click(`${wrap("p1")} .subitem-row[data-sub-id="s1"] .subitem-check svg`);
    check("clicking the SVG inside a sub-item check toggles it back", (await subs("p1"))[0][2] === false);
    // propagation: clicks inside the list never reach document or the row editor
    await page.evaluate(() => {
      window.__docClicks = 0;
    });
    await page.click(`${wrap("p1")} .subitem-row[data-sub-id="s2"] .subitem-text`);
    await page.click(`${wrap("p1")} .subitem-list`, { position: { x: 2, y: 2 } });
    check(
      "clicks on list text/background are swallowed",
      !(await modalOpen()) && (await page.evaluate(() => window.__docClicks)) === 0,
    );
    await page.click(`${wrap("p1")} .subitem-row[data-sub-id="s2"] .subitem-check`);
    check(
      "sub-item action click doesn't propagate past the list",
      (await page.evaluate(() => window.__docClicks)) === 0 && !(await modalOpen()),
    );
    await page.click(`${wrap("p1")} .subitem-row[data-sub-id="s2"] .subitem-check`);
    // delete
    await page.click(`${wrap("p1")} .subitem-row[data-sub-id="s1"] .subitem-del`);
    check(
      "delete removes only that sub-item",
      JSON.stringify((await subs("p1")).map((s) => s[0])) === '["s2"]' &&
        (await subs("p2")).length === 1 &&
        !(await modalOpen()),
      await subs("p1"),
    );
    // open-add + focus
    await page.click(`${wrap("p1")} .subitem-add-toggle`);
    check(
      "open-add shows the input for that parent only and focuses it",
      (await focusedId()) === "subitem-input-p1" &&
        (await page.locator("#subitem-input-p2").count()) === 0 &&
        !(await modalOpen()),
    );
    // blank no-op (button + Enter)
    await page.fill("#subitem-input-p1", "   ");
    await page.click(`${wrap("p1")} .subitem-add button`);
    await page.press("#subitem-input-p1", "Enter");
    check("blank/whitespace input adds nothing via button or Enter", (await subs("p1")).length === 1);
    // add via button: trimmed, rerender, focus returns to fresh input
    await page.fill("#subitem-input-p1", "  via button  ");
    await page.click(`${wrap("p1")} .subitem-add button`);
    let r = await subs("p1");
    check(
      "add button adds a trimmed sub-item to the right parent",
      r.length === 2 && r[1][1] === "via button" && r[1][2] === false && (await subs("p2")).length === 1,
      r,
    );
    check(
      "after add the fresh empty input is focused",
      (await focusedId()) === "subitem-input-p1" && (await page.inputValue("#subitem-input-p1")) === "",
    );
    // add via Enter
    await page.type("#subitem-input-p1", "via enter");
    await page.keyboard.press("Enter");
    r = await subs("p1");
    check(
      "Enter adds a sub-item and refocuses the input",
      r.length === 3 && r[2][1] === "via enter" && (await focusedId()) === "subitem-input-p1" && !(await modalOpen()),
      r,
    );
    check("Enter in a sub-item input doesn't touch the other parent", (await subs("p2")).length === 1);
    // rerendered rows are actionable
    await page.click(`${wrap("p1")} .subitem-row:nth-child(3) .subitem-check`);
    check("a sub-item created by a later render is actionable", (await subs("p1"))[2][2] === true);
    // invalid / stale metadata does nothing
    const snap = async () => JSON.stringify(await page.evaluate(() => [todoList, [...subAddOpen]]));
    const base = await snap();
    const tamper = (sel, attr, val) =>
      page.evaluate(
        ([s, a, v]) => {
          const el = document.querySelector(s);
          if (v === null) el.removeAttribute(a);
          else el.setAttribute(a, v);
        },
        [sel, attr, val],
      );
    const tamperClick = async (sel, attr, val, label) => {
      const orig = await page.evaluate(([s, a]) => document.querySelector(s).getAttribute(a), [sel, attr]);
      await tamper(sel, attr, val);
      await page.evaluate((s) => document.querySelector(s).click(), sel);
      await tamper(sel, attr, orig);
      check(`${label} does nothing`, (await snap()) === base && !(await modalOpen()));
    };
    const chk = `${wrap("p1")} .subitem-row[data-sub-id="s2"] .subitem-check`,
      del = `${wrap("p1")} .subitem-row[data-sub-id="s2"] .subitem-del`;
    for (const [attr, val, label] of [
      ["data-todo-id", null, "missing todo id"],
      ["data-todo-id", "bad id'\"", "malformed todo id"],
      ["data-todo-id", "gone", "stale todo id"],
      ["data-sub-id", null, "missing sub id"],
      ["data-sub-id", "x y", "malformed sub id"],
      ["data-sub-id", "gone", "stale sub id"],
      ["data-sub-id", "t1", "sub id from another parent"],
    ]) {
      await tamperClick(chk, attr, val, `toggle with ${label}`);
      await tamperClick(del, attr, val, `delete with ${label}`);
    }
    const addBtn = `${wrap("p1")} .subitem-add button`,
      input = "#subitem-input-p1";
    await page.fill(input, "should not add");
    for (const [val, label] of [
      [null, "missing"],
      ["bad id'\"", "malformed"],
      ["gone", "stale"],
      ["p2", "other parent without an input"],
    ]) {
      await tamperClick(addBtn, "data-todo-id", val, `add button with ${label} todo id`);
      await tamper(input, "data-todo-id", val);
      await page.press(input, "Enter");
      await tamper(input, "data-todo-id", "p1");
      check(
        `Enter with ${label} todo id does nothing`,
        (await subs("p1")).length === 3 && (await subs("p2")).length === 1 && !(await modalOpen()),
      );
    }
    await page.evaluate(() => {
      const a = document.querySelector('#todo-list .todo-wrap[data-todo-id="p2"] .subitem-add-toggle');
      a.setAttribute("data-todo-id", "gone");
      a.click();
    });
    check(
      "open-add with a stale id opens nothing",
      !(await page.evaluate(() => subAddOpen.has("gone") || subAddOpen.has("p2"))),
    );
    // stale after the to-do/sub-item disappears without a re-render
    await page.evaluate(() => {
      todoList.find((t) => t.id === "p1").subitems = [];
    });
    await page.fill(input, "");
    await page.evaluate(
      ([c, d, a]) => {
        for (const s of [c, d, a]) document.querySelector(s).click();
      },
      [chk, del, addBtn],
    );
    await page.press(input, "Enter");
    check("stale rendered sub-item controls do nothing and don't throw", (await subs("p1")).length === 0);
    await page.evaluate(() => {
      todoList.splice(0, 1);
    });
    await page.evaluate(([a]) => document.querySelector(a).click(), [addBtn]);
    await page.press(input, "Enter");
    check("controls of a removed parent do nothing", (await page.evaluate(() => todoList.length)) === 1);
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
);
await section("handlers: bold child inside a button, filter chip keyboard, date input change events", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  const modalOpen = () => page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open"));
  const kpi = page.locator('#panel-budget button.budget-kpi:has-text("Add your paycheck")');
  if (await kpi.count()) {
    await kpi.first().locator("b").click();
    check("clicking the <b> inside a KPI button triggers the button's action", await modalOpen());
    await page.evaluate(() => closeModal());
  }
  await page.evaluate(() => activateTab("wants"));
  await page.focus('.filter-chip:has-text("Moto")');
  await page.keyboard.press("Enter");
  check("Enter activates a filter chip", (await page.evaluate(() => wantsFilter)) === "moto");
  await page.focus('.filter-chip:has-text("All")');
  await page.keyboard.press("Space");
  check("Space activates a filter chip", (await page.evaluate(() => wantsFilter)) === "all");
  await page.evaluate(() => activateTab("home"));
  await showFab(page);
  await page.click("#fab");
  await page.fill("#composer-text", "Tomorrow dentist");
  const dateChange = (v) =>
    page.evaluate((val) => {
      const i = document.querySelector("#composer input[type=date]");
      i.value = val;
      i.dispatchEvent(new Event("change", { bubbles: true }));
      return composer.manual === true && composer.date === val;
    }, v);
  check("composer date change with a value sets a manual date", await dateChange(isoOffset(4)));
  const keptDate = await page.evaluate(() => {
    const i = document.querySelector("#composer input[type=date]");
    i.value = "";
    i.dispatchEvent(new Event("change", { bubbles: true }));
    return composer.date;
  });
  check("composer date change with an empty value keeps the previous date", keptDate === isoOffset(4), keptDate);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

// Phase 2b: the static shell uses data-action + delegated listeners instead of inline handlers.
await section("shell: static handlers are delegated (sync, refresh, FAB, composer, modal)", async () => {
  const { ctx, page, errors } = await openApp({
    seed: {
      "todo-content": [
        { id: "sh1", text: "Shell", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
      ],
    },
  });
  const isOpen = (id) => page.evaluate((i) => document.getElementById(i).classList.contains("open"), id);
  const staticInline = await page.evaluate(
    () =>
      [...document.querySelectorAll("body > *, body > * *")].filter(
        (el) => !el.closest("[id^=panel-]") && [...el.attributes].some((a) => /^on/i.test(a.name)),
      ).length,
  );
  check("no inline on* attributes remain in the static shell", staticInline === 0, staticInline);
  await page.click("#sync-btn");
  check(
    "sync button opens the Sync modal",
    (await isOpen("modal-backdrop")) && (await page.textContent("#modal-heading")).includes("Sync"),
  );
  await page.click("#modal-heading");
  check("clicking inside the modal doesn't close it", await isOpen("modal-backdrop"));
  await page.click("#modal-backdrop .modal-x");
  check("modal close button closes it", !(await isOpen("modal-backdrop")));
  await page.click("#sync-btn");
  await page.mouse.click(2, 2);
  check("clicking the modal backdrop closes it", !(await isOpen("modal-backdrop")));
  await page.focus("#sync-btn");
  await page.keyboard.press("Enter");
  check("Enter on the sync button opens the modal (native button keyboard)", await isOpen("modal-backdrop"));
  await page.keyboard.press("Escape");
  await showFab(page);
  await page.focus("#fab");
  await page.keyboard.press("Space");
  check("Space on the FAB opens the composer", await isOpen("composer"));
  await page.fill("#composer-text", "Shell item " + "x".repeat(3));
  check(
    "typing updates the composer count (input delegate)",
    (await page.evaluate(() => composer.text || document.getElementById("composer-text").value)).startsWith(
      "Shell item",
    ),
  );
  await page.click("#composer-sheet .modal-head");
  check("clicking inside the composer sheet doesn't close it", await isOpen("composer"));
  const d = isoOffset(5);
  const set = (v) =>
    page.evaluate((val) => {
      const i = document.getElementById("composer-date");
      i.value = val;
      i.dispatchEvent(new Event("change", { bubbles: true }));
      return [composer.manual, composer.date];
    }, v);
  check(
    "composer date change with a value sets a manual date",
    JSON.stringify(await set(d)) === JSON.stringify([true, d]),
  );
  check("composer date change with an empty value keeps the previous date", (await set(""))[1] === d);
  await page.click("#composer-add-btn");
  check(
    "composer Add saves the to-do",
    await page.evaluate(() => todoList.some((t) => t.text.startsWith("Shell item"))),
  );
  await page.evaluate(() => closeComposer());
  await showFab(page);
  await page.click("#fab");
  await page.click("#composer .modal-x");
  check("composer close button closes it", !(await isOpen("composer")));
  await showFab(page);
  await page.click("#fab");
  await page.mouse.click(2, 2);
  check("clicking the composer backdrop closes it", !(await isOpen("composer")));
  // drag suppressor still runs first: a click right after a drag does nothing
  await page.evaluate(() => {
    dragJustEnded = Date.now();
    document.getElementById("fab").click();
  });
  check("the drag suppressor still swallows a click on a shell button", !(await isOpen("composer")));
  await page.waitForFunction(() => Date.now() - dragJustEnded > 600);
  // modal Save / Delete via the delegated buttons
  await page.evaluate(() => {
    window.__saved = 0;
    window.__deleted = 0;
    openModal(
      "T",
      [{ key: "a", label: "A", type: "text" }],
      {},
      () => {
        window.__saved++;
      },
      () => {
        window.__deleted++;
      },
    );
  });
  await page.click("#modal-backdrop .modal-btn.primary");
  check("modal Save runs the save callback", (await page.evaluate(() => window.__saved)) === 1);
  await page.evaluate(() =>
    openModal(
      "T",
      [{ key: "a", label: "A", type: "text" }],
      {},
      () => {},
      () => {
        window.__deleted++;
      },
    ),
  );
  await page.click("#modal-delete-btn");
  check("modal Delete runs the delete callback", (await page.evaluate(() => window.__deleted)) === 1);
  // hard refresh: spinner class first, then the refresh
  await page.evaluate(() => {
    window.__order = [];
    window.hardRefresh = () => {
      window.__order.push(document.querySelector(".hard-refresh-btn").classList.contains("spinning"));
      return Promise.resolve();
    };
  });
  await page.evaluate(() => document.querySelector(".hard-refresh-btn").click()); // desktop-only button, hidden on the phone profile
  check(
    "hard refresh adds the spinner, then calls hardRefresh",
    JSON.stringify(await page.evaluate(() => window.__order)) === "[true]",
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

// Phase 2c-1: Home date strip / calendar controls use data-action + data-date/-delta/-open.
await section("home calendar: generated controls are delegated and validate metadata", async () => {
  const { ctx, page, errors } = await openApp({
    seed: {
      "todo-content": [
        { id: "hc1", text: "Cal", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
      ],
    },
  });
  const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  const state = () => page.evaluate(() => ({ date: homeDate, anchor: homeAnchor, open: homeCalOpen }));
  const inline = await page.evaluate(() => document.querySelectorAll(".home-cal [onclick], .home-cal[onclick]").length);
  check("Home calendar markup has no inline onclick", inline === 0, inline);
  const target = isoInWeek(2);
  await click(`.home-cal [data-action=home-select-date][data-date="${target}"]`);
  check("date cell selects that date", (await state()).date === target, await state());
  check(
    "Today button appears once off today",
    await page.evaluate(() => !!document.querySelector(".home-cal-today[data-action=home-select-date]")),
  );
  await click(".home-cal-today");
  check("Today returns to today (null)", (await state()).date === null);
  await click(".home-cal .cal-nav[data-delta='1']");
  const a1 = (await state()).anchor;
  check("next shifts the week anchor", !!a1);
  await click(".home-cal .cal-nav[data-delta='-1']");
  await click(".home-cal .cal-nav[data-delta='-1']");
  check("previous shifts the anchor back", (await state()).anchor < a1);
  await click(".home-cal-grab");
  check(
    "grab opens the month",
    (await state()).open === true && (await page.getAttribute(".home-cal-grab", "aria-expanded")) === "true",
  );
  await click(".home-cal .cal-nav[data-delta='1']");
  check("next in month view moves by month", (await state()).anchor.endsWith("-01"));
  await click(".home-cal-grab");
  check(
    "grab closes the month",
    (await state()).open === false && (await page.getAttribute(".home-cal-grab", "aria-expanded")) === "false",
  );
  await page.focus(".home-cal-grab");
  await page.keyboard.press("Enter");
  check("Enter on the grab toggles via native button keyboard", (await state()).open === true);
  // malformed metadata is ignored
  const before = JSON.stringify(await state());
  await page.evaluate(() => {
    const mk = (attrs) => {
      const b = document.createElement("button");
      for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
      document.body.appendChild(b);
      b.click();
      b.remove();
    };
    for (const v of ["", "nope", "2026-13-45", "2026-02-30", "2026-1-1", "1);alert(1)", null])
      mk(v === null ? { "data-action": "home-select-date" } : { "data-action": "home-select-date", "data-date": v });
    for (const v of ["", "0", "2", "-2", "1.0", "abc", null])
      mk(v === null ? { "data-action": "home-shift-cal" } : { "data-action": "home-shift-cal", "data-delta": v });
    for (const v of ["", "1", "TRUE", "yes", "null", null])
      mk(v === null ? { "data-action": "home-cal-open" } : { "data-action": "home-cal-open", "data-open": v });
  });
  check("malformed date/delta/open metadata is ignored", JSON.stringify(await state()) === before, await state());
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

// Home "more anytime" / "All to-dos" links are delegated and open the To-Do tab without touching data.
await section("home links: more anytime and All to-dos are delegated and open To-Do", async () => {
  const mkTodo = (id, due, done = false) => ({
    id,
    text: `Item ${id}`,
    done,
    due,
    starred: false,
    subitems: [],
    completedAt: done ? Date.now() : null,
  });
  const seed = {
    "todo-content": [1, 2, 3, 4, 5, 6]
      .map((n) => mkTodo(`an${n}`, null))
      .concat([mkTodo("dated1", isoOffset(3)), mkTodo("fin1", null, true)]),
  };
  const { ctx, page, errors } = await openApp({ seed });
  const info = () =>
    page.evaluate(() => ({
      more: document.querySelector(".home-more:not(.home-all)")?.textContent.trim() ?? null,
      moreClass: document.querySelector(".home-more:not(.home-all)")?.className ?? null,
      all: document.querySelector(".home-all")?.textContent.trim() ?? null,
      allClass: document.querySelector(".home-all")?.className ?? null,
      tab: document.body.dataset.tab,
      todoActive: document.getElementById("panel-todo").classList.contains("active"),
      data: JSON.stringify(todoList),
    }));
  const before = await info();
  check(
    "no inline onclick on Home links",
    (await page.evaluate(() => document.querySelectorAll(".home-more[onclick]").length)) === 0,
  );
  check(
    "more link keeps label and class",
    before.more === "2 more anytime →" && before.moreClass === "home-more",
    before,
  );
  check(
    "All link keeps label, count and classes",
    before.all === "All to-dos (7) →" && before.allClass === "home-more home-all",
    before,
  );
  check(
    "both links use the delegated action",
    (await page.evaluate(() => document.querySelectorAll(".home-more[data-action=home-open-todo]").length)) === 2,
  );
  for (const sel of [".home-more:not(.home-all)", ".home-all"]) {
    await page.evaluate(() => activateTab("home"));
    check(`starts on Home (${sel})`, (await info()).tab === "home");
    await page.evaluate((s) => document.querySelector(s).click(), sel);
    const after = await info();
    check(`${sel} opens To-Do`, after.tab === "todo" && after.todoActive, after);
    check(`${sel} leaves to-do data unchanged`, after.data === before.data);
  }
  // 4 or fewer anytime to-dos: no "more" link, All link still shown with its count
  await page.evaluate(() => {
    todoList = todoList.filter((t) => !["an5", "an6"].includes(t.id));
    activateTab("home");
  });
  const few = await info();
  check("no more link at the display limit", few.more === null, few);
  check("All link count follows open to-dos", few.all === "All to-dos (5) →", few);
  await page.evaluate(() => {
    todoList = [];
    activateTab("home");
  });
  const none = await info();
  check(
    "no anytime section means no more link; All shows 0",
    none.more === null && none.all === "All to-dos (0) →",
    none,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

// Recurring card rows (renderTodoPanel) use the delegated home-todo-edit action.
await section(
  "recurring rows: edit is delegated, opens the right to-do, validates ids and leaves data alone",
  async () => {
    const { ctx, page, errors } = await openApp({
      query: "?tab=todo",
      seed: {
        "todo-content": [
          {
            id: "rc2",
            text: "Second repeat",
            done: false,
            due: isoOffset(5),
            starred: false,
            subitems: [],
            completedAt: null,
            repeat: "daily",
          },
          {
            id: "rc1",
            text: "First repeat",
            done: false,
            due: isoOffset(1),
            starred: false,
            subitems: [],
            completedAt: null,
            repeat: "weekly",
          },
          { id: "rc3", text: "Plain", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
        ],
      },
    });
    const modalOpen = () => page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open"));
    const markup = await page.evaluate(() =>
      [...document.querySelectorAll("#todo-recurring .recurring-row")].map((r) => ({
        id: r.getAttribute("data-todo-id"),
        action: r.getAttribute("data-action"),
        onclick: r.hasAttribute("onclick"),
        inline: r.querySelectorAll("[onclick]").length,
        title: r.querySelector(".title").textContent,
        meta: r.querySelector(".todo-meta").textContent,
      })),
    );
    check(
      "recurring rows are delegated with no inline handler, in due order",
      markup.length === 2 &&
        markup.every((m) => m.action === "home-todo-edit" && !m.onclick && m.inline === 0) &&
        JSON.stringify(markup.map((m) => [m.id, m.title])) === '[["rc1","First repeat"],["rc2","Second repeat"]]',
      markup,
    );
    check(
      "recurring rows keep their repeat labels",
      markup[0].meta.startsWith("Weekly · ") &&
        markup[0].meta.includes(" · next ") &&
        markup[1].meta.startsWith("Daily · next "),
      markup.map((m) => m.meta),
    );
    const before = await page.evaluate(() => JSON.stringify(todoList));
    // each row opens its own to-do in the real editor
    for (const [id, text] of [
      ["rc2", "Second repeat"],
      ["rc1", "First repeat"],
    ]) {
      await page.evaluate(
        (i) => document.querySelector(`#todo-recurring .recurring-row[data-todo-id="${i}"]`).click(),
        id,
      );
      check(
        `recurring row ${id} opens its own editor`,
        (await modalOpen()) && (await page.inputValue("#modal-text")) === text,
      );
      await page.mouse.click(2, 2);
      check(`editor for ${id} closes without saving`, !(await modalOpen()));
    }
    // invalid, missing and stale ids are inert
    await page.evaluate(() => {
      window.__edited = [];
      window.editTodo = (id) => window.__edited.push(id);
      const mk = (attrs) => {
        const b = document.createElement("button");
        for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
        document.body.appendChild(b);
        b.click();
        b.remove();
      };
      mk({ "data-action": "home-todo-edit" });
      for (const v of ["", "nope", "rc1');alert(1);('", "a b", "rc1 "])
        mk({ "data-action": "home-todo-edit", "data-todo-id": v });
      todoList.splice(
        todoList.findIndex((t) => t.id === "rc2"),
        1,
      ); // stale: row still rendered, to-do gone
      document.querySelector('#todo-recurring .recurring-row[data-todo-id="rc2"]').click();
    });
    check(
      "invalid/stale recurring ids open nothing",
      (await page.evaluate(() => window.__edited.length)) === 0 && !(await modalOpen()),
    );
    const after = await page.evaluate(() => JSON.stringify(todoList));
    check(
      "recurring row interactions leave persisted to-dos unchanged",
      JSON.parse(after).length === 2 &&
        JSON.stringify(JSON.parse(before).filter((t) => t.id !== "rc2")) === after &&
        JSON.stringify(await page.evaluate(() => JSON.parse(localStorage.getItem("todo-content")))) === before,
      after,
    );
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
);
// Home future-repeat preview rows (repeatGhostHtml) use the delegated home-todo-edit action.
await section(
  "home repeat previews: edit is delegated, opens the right to-do, validates ids and leaves data alone",
  async () => {
    const { ctx, page, errors } = await openApp({
      seed: {
        "todo-content": [
          {
            id: "gp1",
            text: "Preview one",
            done: false,
            due: isoOffset(0),
            starred: false,
            subitems: [],
            completedAt: null,
            repeat: "daily",
          },
          {
            id: "gp2",
            text: "Preview two",
            done: false,
            due: isoOffset(0),
            starred: false,
            subitems: [],
            completedAt: null,
            repeat: "daily",
          },
        ],
      },
    });
    const modalOpen = () => page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open"));
    await page.evaluate(() => selectHomeDate(addDaysIso(2)));
    const rows = () =>
      page.evaluate(() =>
        [...document.querySelectorAll("#panel-home .repeat-ghost:not(.workout-row)")].map((r) => {
          const b = r.querySelector(".body");
          return {
            id: b.getAttribute("data-todo-id"),
            action: b.getAttribute("data-action"),
            inline: r.querySelectorAll("[onclick]").length,
            title: r.querySelector(".title").textContent,
            meta: r.querySelector(".todo-meta").textContent,
            icon: !!r.querySelector(".repeat-icon"),
            checks: r.querySelectorAll(".todo-check").length,
          };
        }),
      );
    const markup = await rows();
    check(
      "preview rows are delegated with no inline handler",
      markup.length === 2 &&
        markup.every((m) => m.action === "home-todo-edit" && m.inline === 0 && m.icon && m.checks === 0),
      markup,
    );
    check(
      "preview rows keep titles and repeat labels",
      markup.every((m) => m.meta.startsWith("Daily")) &&
        markup
          .map((m) => m.title)
          .sort()
          .join() === "Preview one,Preview two",
      markup,
    );
    check(
      "preview ids are distinct",
      new Set(markup.map((m) => m.id)).size === 2 &&
        markup
          .map((m) => m.id)
          .sort()
          .join() === "gp1,gp2",
      markup,
    );
    const before = await page.evaluate(() => JSON.stringify(todoList));
    for (const [id, text] of [
      ["gp2", "Preview two"],
      ["gp1", "Preview one"],
    ]) {
      await page.evaluate(
        (i) => document.querySelector(`#panel-home .repeat-ghost .body[data-todo-id="${i}"]`).click(),
        id,
      );
      check(
        `preview ${id} opens its own editor`,
        (await modalOpen()) && (await page.inputValue("#modal-text")) === text,
      );
      await page.mouse.click(2, 2);
      check(`editor for ${id} closes without saving`, !(await modalOpen()));
    }
    await page.evaluate(() => {
      window.__edited = [];
      window.editTodo = (id) => window.__edited.push(id);
      const mk = (attrs) => {
        const b = document.createElement("button");
        for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
        document.body.appendChild(b);
        b.click();
        b.remove();
      };
      mk({ "data-action": "home-todo-edit" });
      for (const v of ["", "nope", "gp1');alert(1);('", "a b", "gp1 "])
        mk({ "data-action": "home-todo-edit", "data-todo-id": v });
      todoList.splice(
        todoList.findIndex((t) => t.id === "gp2"),
        1,
      ); // stale: preview still rendered, to-do gone
      document.querySelector('#panel-home .repeat-ghost .body[data-todo-id="gp2"]').click();
    });
    check(
      "invalid/stale preview ids open nothing",
      (await page.evaluate(() => window.__edited.length)) === 0 && !(await modalOpen()),
    );
    const after = await page.evaluate(() => JSON.stringify(todoList));
    check(
      "preview interactions leave persisted to-dos unchanged",
      JSON.stringify(JSON.parse(before).filter((t) => t.id !== "gp2")) === after &&
        JSON.stringify(await page.evaluate(() => JSON.parse(localStorage.getItem("todo-content")))) === before,
      after,
    );
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
); // Phase 2c-2: regular Home to-do rows (homeRowHtml) use delegated data-action handlers.
await section("home to-do rows: complete/toggle/edit are delegated and validate ids", async () => {
  const { ctx, page, errors } = await openApp({
    seed: {
      "todo-content": [
        {
          id: "hr1",
          text: "Open row",
          done: false,
          due: isoOffset(0),
          starred: false,
          subitems: [],
          completedAt: null,
        },
        {
          id: "hr2",
          text: "Done row",
          done: true,
          due: isoOffset(0),
          starred: false,
          subitems: [],
          completedAt: Date.now(),
        },
      ],
    },
  });
  const click = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
  const row = (id) => `.home-list .todo-wrap[data-todo-id="${id}"]`;
  const inline = await page.evaluate(
    () =>
      [...document.querySelectorAll(".home-list .todo-wrap[data-todo-id]")].filter((w) => w.querySelector("[onclick]"))
        .length,
  );
  check("regular Home rows have no inline onclick", inline === 0, inline);
  await page.evaluate(() => {
    window.__edited = [];
    window.__realEdit = editTodo;
    window.editTodo = (id) => window.__edited.push(id);
  });
  await click(`${row("hr1")} .body[data-action=home-todo-edit]`);
  check(
    "row body opens that to-do for editing",
    JSON.stringify(await page.evaluate(() => window.__edited)) === '["hr1"]',
  );
  await click(`${row("hr1")} .todo-check[data-action=home-todo-complete]`);
  check("open check completes the item", await page.evaluate(() => todoList.find((t) => t.id === "hr1").done === true));
  // finished to-dos leave today's Home list, so render the done row's generated markup directly
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.id = "done-host";
    d.innerHTML = homeRowHtml(todoList.find((t) => t.id === "hr2"));
    document.body.appendChild(d);
  });
  check(
    "done row check is delegated, not inline",
    await page.evaluate(
      () =>
        !document.querySelector("#done-host [onclick]") &&
        !!document.querySelector("#done-host .todo-check[data-action=home-todo-toggle]"),
    ),
  );
  await click("#done-host .todo-check");
  check("done check re-opens the item", await page.evaluate(() => todoList.find((t) => t.id === "hr2").done === false)); // invalid, missing, unknown and wrong-state ids are ignored
  const before = await page.evaluate(() => JSON.stringify(todoList));
  await page.evaluate(() => {
    const mk = (attrs) => {
      const b = document.createElement("button");
      for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
      document.body.appendChild(b);
      b.click();
      b.remove();
    };
    for (const a of ["home-todo-complete", "home-todo-toggle", "home-todo-edit"]) {
      mk({ "data-action": a });
      for (const v of ["", "nope", "hr1');alert(1);('", "a b", "hr1 "]) mk({ "data-action": a, "data-todo-id": v });
    }
    mk({ "data-action": "home-todo-complete", "data-todo-id": "hr1" }); // already done
    mk({ "data-action": "home-todo-toggle", "data-todo-id": "hr2" }); // not done
  });
  check(
    "invalid/missing/wrong-state ids change nothing",
    (await page.evaluate(() => JSON.stringify(todoList))) === before &&
      (await page.evaluate(() => window.__edited.length)) === 1,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

// Phase 2c-4: the main To-Do tab rows (todoRow) use delegated data-action handlers.
await section(
  "to-do tab rows: check/edit/star/expand are delegated, validate ids, keep propagation and repeat rollover",
  async () => {
    const { ctx, page, errors } = await openApp({
      query: "?tab=todo",
      seed: {
        "todo-content": [
          { id: "tr1", text: "Plain", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
          {
            id: "tr2",
            text: "Parent",
            done: false,
            due: isoOffset(0),
            starred: false,
            subitems: [{ id: "ts1", text: "Kid", done: false }],
            completedAt: null,
          },
          {
            id: "tr3",
            text: "Daily",
            done: false,
            due: isoOffset(0),
            starred: false,
            repeat: "daily",
            subitems: [],
            completedAt: null,
          },
        ],
      },
    });
    const row = (id) => `#todo-list .todo-wrap[data-todo-id="${id}"]`;
    const modalOpen = () => page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open"));
    const markup = await page.evaluate(() => {
      const w = document.querySelector('#todo-list .todo-wrap[data-todo-id="tr2"]');
      const q = (s) => w.querySelector(s);
      return {
        inline: w.querySelectorAll("[onclick]").length,
        check: q(".todo-check").getAttribute("data-action"),
        body: q(".body").getAttribute("data-action"),
        star: q('.todo-icon-btn[aria-label$="to-do"]').getAttribute("data-action"),
        exp: q('.todo-icon-btn[aria-label$="sub-items"]').getAttribute("data-action"),
        aria: [
          q(".todo-check").getAttribute("aria-label"),
          q(".todo-check").getAttribute("aria-checked"),
          q('.todo-icon-btn[aria-label$="sub-items"]').getAttribute("aria-label"),
          q('.todo-icon-btn[aria-label$="sub-items"]').getAttribute("aria-expanded"),
        ],
      };
    });
    check(
      "to-do tab row controls are delegated with aria preserved",
      markup.inline === 0 &&
        markup.check === "home-todo-complete" &&
        markup.body === "home-todo-edit" &&
        markup.star === "todo-star" &&
        markup.exp === "todo-expand" &&
        JSON.stringify(markup.aria) === '["Complete: Parent","false","Show sub-items","false"]',
      markup,
    );
    // star and expand stop propagation at the delegated listener (on body): a click must not reach document or open the editor
    await page.evaluate(() => {
      window.__bubbled = 0;
      document.addEventListener("click", () => window.__bubbled++);
    });
    await page.click(`${row("tr2")} .todo-icon-btn[aria-label$="to-do"]`);
    check(
      "star toggles and moves to top without bubbling or editing",
      (await page.evaluate(() => todoList[0].id === "tr2" && todoList[0].starred && window.__bubbled === 0)) &&
        !(await modalOpen()),
    );
    await page.click(`${row("tr2")} .todo-icon-btn[aria-label$="sub-items"]`);
    check(
      "expand shows sub-items without bubbling or editing",
      (await page.$$(`${row("tr2")} .subitem-row`)).length === 1 &&
        (await page.evaluate(() => window.__bubbled === 0 && expandedTodos.has("tr2"))) &&
        !(await modalOpen()),
    );
    check(
      "expanded aria state updates",
      await page.evaluate(() => {
        const b = document.querySelector('#todo-list [data-todo-id="tr2"] .todo-icon-btn[aria-label$="sub-items"]');
        return b.getAttribute("aria-label") === "Hide sub-items" && b.getAttribute("aria-expanded") === "true";
      }),
    );
    await page.click(`${row("tr2")} .todo-icon-btn[aria-label$="sub-items"]`);
    check(
      "expand collapses again",
      (await page.$$(`${row("tr2")} .subitem-row`)).length === 0 &&
        (await page.evaluate(() => !expandedTodos.has("tr2"))),
    );
    await page.click(`${row("tr2")} .body`);
    check("row body opens the editor", await modalOpen());
    await page.mouse.click(2, 2);
    await page.click(`${row("tr1")} .todo-check`);
    check(
      "check completes a plain to-do",
      await page.evaluate(() => todoList.find((t) => t.id === "tr1").done === true),
    );
    await page.click(`${row("tr3")} .todo-check`);
    check(
      "check on a repeating to-do rolls it over and logs a done copy",
      await page.evaluate(() => {
        const open = todoList.find((t) => t.id === "tr3"),
          copy = todoList.find((t) => t.seriesId === "tr3");
        return !open.done && open.due > addDaysIso(0) && copy && copy.done;
      }),
    );
    // invalid, missing, stale and wrong-state ids change nothing
    const before = await page.evaluate(() => JSON.stringify(todoList) + [...expandedTodos]);
    await page.evaluate(() => {
      window.__edited = [];
      window.editTodo = (id) => window.__edited.push(id);
      const mk = (attrs) => {
        const b = document.createElement("button");
        for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
        document.body.appendChild(b);
        b.click();
        b.remove();
      };
      for (const a of ["home-todo-complete", "home-todo-edit", "todo-star", "todo-expand"]) {
        mk({ "data-action": a });
        for (const v of ["", "nope", "tr2');alert(1);('", "a b", "tr2 "]) mk({ "data-action": a, "data-todo-id": v });
      }
      mk({ "data-action": "home-todo-complete", "data-todo-id": "tr1" }); // already done
    });
    check(
      "invalid/stale/wrong-state ids change nothing",
      (await page.evaluate(() => JSON.stringify(todoList) + [...expandedTodos])) === before &&
        (await page.evaluate(() => window.__edited.length)) === 0,
    );
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
);
await section(
  "completed to-do rows: restore/duplicate/delete are delegated, isolated, confirm-aware and validate ids",
  async () => {
    const { ctx, page, errors } = await openApp({
      query: "?tab=todo",
      seed: {
        "todo-content": [
          {
            id: "cd1",
            text: "Done one",
            done: true,
            due: isoOffset(0),
            starred: false,
            subitems: [{ id: "cs1", text: "Kid", done: true }],
            completedAt: Date.now(),
          },
          {
            id: "cd2",
            text: "Done two",
            done: true,
            due: isoOffset(0),
            starred: false,
            subitems: [],
            completedAt: Date.now(),
          },
          { id: "cd3", text: "Open", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
        ],
      },
    });
    const modalOpen = () => page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open"));
    const row = (id) => `#todo-completed .item:has([data-todo-id="${id}"])`;
    if (!(await page.$("#todo-completed"))) await page.click(".completed-toggle");
    const markup = await page.evaluate(() => {
      const r = document.querySelector('#todo-completed .item:has([data-todo-id="cd1"])');
      const q = (s) => r.querySelector(s);
      return {
        inline: r.querySelectorAll("[onclick]").length,
        check: [
          q(".todo-check").getAttribute("data-action"),
          q(".todo-check").getAttribute("data-todo-id"),
          q(".todo-check").getAttribute("aria-label"),
          q(".todo-check").getAttribute("aria-checked"),
        ],
        dup: [
          q('[aria-label="Duplicate to-do"]').getAttribute("data-action"),
          q('[aria-label="Duplicate to-do"]').getAttribute("data-todo-id"),
        ],
        del: [
          q('[aria-label="Delete to-do"]').getAttribute("data-action"),
          q('[aria-label="Delete to-do"]').getAttribute("data-todo-id"),
        ],
      };
    });
    check(
      "completed row controls are delegated with aria preserved",
      markup.inline === 0 &&
        JSON.stringify(markup.check) === '["home-todo-toggle","cd1","Mark not done: Done one","true"]' &&
        JSON.stringify(markup.dup) === '["todo-duplicate","cd1"]' &&
        JSON.stringify(markup.del) === '["todo-delete","cd1"]',
      markup,
    );
    await page.evaluate(() => {
      window.__bubbled = 0;
      document.addEventListener("click", () => window.__bubbled++);
    });
    // duplicate: fresh open copy with reset sub-items; original untouched; no editor, no bubbling
    await page.click(`${row("cd1")} [data-action="todo-duplicate"]`);
    check(
      "duplicate keeps semantics and leaves the original alone",
      (await page.evaluate(() => {
        const o = todoList.find((t) => t.id === "cd1"),
          c = todoList.filter((t) => t.id !== "cd1" && t.text === "Done one");
        return (
          todoList.length === 4 &&
          o.done &&
          c.length === 1 &&
          !c[0].done &&
          c[0].completedAt === null &&
          !c[0].starred &&
          c[0].id !== "cd1" &&
          c[0].subitems.length === 1 &&
          c[0].subitems[0].text === "Kid" &&
          !c[0].subitems[0].done &&
          c[0].subitems[0].id !== "cs1" &&
          window.__bubbled === 0
        );
      })) && !(await modalOpen()),
    );
    // delete canceled, then confirmed (only that row)
    await page.evaluate(() => {
      window.__asked = 0;
      window.confirm = () => {
        window.__asked++;
        return false;
      };
    });
    const n = await page.evaluate(() => todoList.length);
    await page.click(`${row("cd2")} [data-action="todo-delete"]`);
    check(
      "canceled delete keeps the to-do",
      (await page.evaluate(
        (n0) => window.__asked === 1 && todoList.length === n0 && todoList.some((t) => t.id === "cd2"),
        n,
      )) && !(await modalOpen()),
    );
    await page.evaluate(() => {
      window.confirm = () => {
        window.__asked++;
        return true;
      };
    });
    await page.click(`${row("cd2")} [data-action="todo-delete"]`);
    check(
      "confirmed delete removes only that to-do",
      (await page.evaluate(
        (n0) =>
          !todoList.some((t) => t.id === "cd2") &&
          todoList.length === n0 - 1 &&
          todoList.some((t) => t.id === "cd1") &&
          todoList.some((t) => t.id === "cd3"),
        n,
      )) && !(await modalOpen()),
    );
    // restore: only the clicked row changes
    await page.click(`${row("cd1")} .todo-check`);
    check(
      "restore reopens only that to-do",
      (await page.evaluate(() => {
        const o = todoList.find((t) => t.id === "cd1");
        return !o.done && o.completedAt === null && todoList.find((t) => t.id === "cd3").done === false;
      })) && !(await modalOpen()),
    );
    // invalid, missing, stale and wrong-state ids change nothing
    const before = await page.evaluate(() => JSON.stringify(todoList));
    await page.evaluate(() => {
      window.__asked = 0;
      window.confirm = () => {
        window.__asked++;
        return true;
      };
      const mk = (attrs) => {
        const b = document.createElement("button");
        for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
        document.body.appendChild(b);
        b.click();
        b.remove();
      };
      for (const a of ["home-todo-toggle", "todo-duplicate", "todo-delete"]) {
        mk({ "data-action": a });
        for (const v of ["", "nope", "cd1');alert(1);('", "a b", "cd1 ", "cd2"])
          mk({ "data-action": a, "data-todo-id": v });
      }
      mk({ "data-action": "home-todo-toggle", "data-todo-id": "cd3" }); // open to-do: toggle is for done rows only
    });
    check(
      "invalid/stale/wrong-state ids change nothing",
      (await page.evaluate(() => JSON.stringify(todoList))) === before &&
        (await page.evaluate(() => window.__asked)) === 0 &&
        !(await modalOpen()),
    );
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
); // Phase 2c-3: the Wash hair row (washRowHtml) uses delegated data-action handlers.
await section("wash hair row: toggle/open are delegated, validate the date, and keep propagation", async () => {
  const { ctx, page, errors } = await openApp({
    seed: {
      "todo-content": [
        { id: "wh1", text: "Anchor", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
      ],
    },
  });
  await page.evaluate(() => {
    skinRoutine.wash = { anchor: addDaysIso(0), everyDays: 14 };
    renderHome();
  });
  const markup = await page.evaluate(() => {
    const w = document.querySelector("#panel-home .wash-row");
    return {
      inline: w.querySelectorAll("[onclick]").length,
      date: w.querySelector(".todo-check").getAttribute("data-date"),
      toggle: w.querySelector(".todo-check").getAttribute("data-action"),
      open: w.querySelector(".body").getAttribute("data-action"),
    };
  });
  check(
    "wash row markup is delegated, no inline onclick",
    markup.inline === 0 &&
      markup.toggle === "home-wash-toggle" &&
      markup.open === "home-wash-open" &&
      markup.date === isoOffset(0),
    markup,
  );
  const done = () => page.evaluate(() => washHairDone(addDaysIso(0)));
  await page.evaluate(() => {
    window.__opened = 0;
    window.openWashCard = () => {
      window.__opened++;
    };
  });
  await page.click("#panel-home .wash-row .todo-check");
  check("check ticks the wash steps", await done());
  check(
    "check aria-checked/row reflect done",
    await page.evaluate(
      () =>
        document.querySelector("#panel-home .wash-row .todo-check").getAttribute("aria-checked") === "true" &&
        document.querySelector("#panel-home .wash-row .item").classList.contains("checked"),
    ),
  );
  await page.click("#panel-home .wash-row .todo-check");
  check("check again unticks (round-trip)", !(await done()));
  check("checkbox clicks do not open the wash card", (await page.evaluate(() => window.__opened)) === 0);
  await page.click("#panel-home .wash-row .body");
  check(
    "body click opens the wash card, no toggle",
    (await page.evaluate(() => window.__opened)) === 1 && !(await done()),
  );
  // invalid or missing dates are no-ops
  const before = await page.evaluate(() => JSON.stringify(routineChecks));
  await page.evaluate(() => {
    const mk = (attrs) => {
      const b = document.createElement("button");
      for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
      document.body.appendChild(b);
      b.click();
      b.remove();
    };
    mk({ "data-action": "home-wash-toggle" });
    for (const v of ["", "nope", "2026-13-45", "2026-02-30", "2026-1-1", "1');alert(1);('", " 2026-01-01"])
      mk({ "data-action": "home-wash-toggle", "data-date": v });
  });
  check(
    "invalid/missing date changes nothing",
    (await page.evaluate(() => JSON.stringify(routineChecks))) === before &&
      (await page.evaluate(() => window.__opened)) === 1,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

// Bill pay/unpay checks (Home + Budget rows) use delegated data-action handlers.
await section("bill pay/unpay checks: delegated from Home and Budget, validated, no editor opening", async () => {
  const mkBill = (id, name, extra = {}) => ({
    id,
    name,
    amount: 40,
    due: isoOffset(0),
    repeat: "monthly",
    autopay: false,
    link: null,
    group: "personal",
    account: null,
    ...extra,
  });
  const { ctx, page, errors } = await openApp({
    seed: { "bills-content": [mkBill("bw", "Water"), mkBill("be", "Electric", { amount: 80, varies: true })] },
  });
  const trap = () =>
    page.evaluate(() => {
      window.__edit = [];
      window.editBill = (id) => window.__edit.push("bill:" + id);
      window.editPayment = (id) => window.__edit.push("pay:" + id);
      window.activateTabReal = activateTab;
    });
  await trap();
  const homeRow = (name) => `#panel-home .home-list .bill-home:has(.title:text-is("Pay ${name}"))`;
  const markup = await page.evaluate(() =>
    [...document.querySelectorAll("#panel-home .home-list .bill-home")].map((w) => ({
      inline: w.querySelectorAll(".todo-check[onclick]").length,
      a: w.querySelector(".todo-check").getAttribute("data-action"),
      d: w.querySelector(".todo-check").getAttribute("data-due"),
    })),
  );
  check(
    "Home bill checks are delegated with bill id and due date",
    markup.length === 2 && markup.every((m) => m.inline === 0 && m.a === "bill-pay" && m.d === isoOffset(0)),
    markup,
  );
  // pay a fixed bill from Home
  const water = () =>
    page.evaluate(() => ({
      pays: billPayments.map((p) => ({
        billId: p.billId,
        name: p.name,
        amount: p.amount,
        due: p.due,
        date: p.date,
        auto: !!p.auto,
      })),
      due: bills.find((b) => b.id === "bw").due,
      done: !!bills.find((b) => b.id === "bw").done,
    }));
  const nextDue = await page.evaluate(() => nextBillIso(addDaysIso(0), "monthly", undefined));
  await page.click(`${homeRow("Water")} .todo-check`);
  let w = await water();
  check(
    "Home pay records one payment at the bill's due date, dated today, and advances the bill",
    w.pays.length === 1 &&
      w.pays[0].billId === "bw" &&
      w.pays[0].amount === 40 &&
      w.pays[0].due === isoOffset(0) &&
      w.pays[0].date === isoOffset(0) &&
      !w.pays[0].auto &&
      w.due === nextDue,
    w,
  );
  check("checkbox click did not open the editor or the bill", (await page.evaluate(() => window.__edit.length)) === 0);
  check(
    "paid row now offers un-pay",
    await page.evaluate(
      () =>
        !!document.querySelector(
          '#panel-home .home-list .bill-home .todo-check[data-action="bill-unpay"][aria-checked="true"]',
        ),
    ),
  );
  await page.click(`#panel-home .home-list .bill-home .todo-check[data-action="bill-unpay"]`);
  w = await water();
  check(
    "Home un-pay removes the payment and restores the due date",
    w.pays.length === 0 && w.due === isoOffset(0) && !w.done,
    w,
  );
  check("un-pay click did not open an editor", (await page.evaluate(() => window.__edit.length)) === 0);
  // body click still opens the editor (and does not pay)
  await page.click(`${homeRow("Water")} .body`);
  check(
    "row body still opens the bill editor, no payment",
    JSON.stringify(await page.evaluate(() => window.__edit)) === '["bill:bw"]' && (await water()).pays.length === 0,
  );
  // variable bill asks for the amount first
  await page.click(`${homeRow("Electric")} .todo-check`);
  check(
    "variable bill opens the amount prompt without paying yet",
    await page.evaluate(
      () => billPayments.length === 0 && document.getElementById("modal-backdrop").classList.contains("open"),
    ),
  );
  await page.fill("#modal-amount", "93.40");
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "variable bill records the entered amount",
    await page.evaluate(
      () =>
        billPayments.length === 1 &&
        billPayments[0].billId === "be" &&
        billPayments[0].amount === 93.4 &&
        billPayments[0].due === addDaysIso(0),
    ),
  );
  await page.evaluate(() => unpayBill(billPayments[0].id));
  // non-payable projected rows have no action; stale/invalid metadata is ignored
  const proj = await page.evaluate(() => {
    const b = bills.find((x) => x.id === "bw");
    const h = document.createElement("div");
    h.innerHTML = homeBillHtml(b, { projected: true });
    const r = document.createElement("div");
    r.innerHTML = billTableRowHtml(
      { bill: b, name: b.name, amount: 40, due: addDaysIso(60), current: false },
      addDaysIso(0),
      addDaysIso(0).slice(0, 7) + "-01",
    );
    const c = document.createElement("div");
    c.innerHTML = billRowHtml(
      { bill: b, name: b.name, amount: 40, due: addDaysIso(60), current: false },
      addDaysIso(0),
    );
    return [h, r, c].map(
      (e) =>
        e.querySelectorAll(
          "[data-action]:not(.body[data-action=home-bill-open]):not(.body[data-action=bill-row-open]):not(.btab-name[data-action=bill-row-open]), [onclick]:not(.body):not(.btab-name)",
        ).length,
    );
  });
  check(
    "projected/future rows are not actionable",
    proj.every((n) => n === 0),
    proj,
  );
  const before = await page.evaluate(() => JSON.stringify([bills, billPayments]));
  await page.evaluate(() => {
    bills.push({ id: "bdone", name: "Old", amount: 5, due: addDaysIso(0), repeat: "monthly", done: true });
    const mk = (attrs) => {
      const b = document.createElement("button");
      for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
      document.body.appendChild(b);
      b.click();
      b.remove();
    };
    mk({ "data-action": "bill-pay" });
    mk({ "data-action": "bill-unpay" });
    for (const v of ["", "nope", "bw');alert(1);('", "bw ", "b w"]) {
      mk({ "data-action": "bill-pay", "data-bill-id": v, "data-due": addDaysIso(0) });
      mk({ "data-action": "bill-unpay", "data-payment-id": v });
    }
    mk({ "data-action": "bill-pay", "data-bill-id": "bw" }); // missing due
    mk({ "data-action": "bill-pay", "data-bill-id": "bw", "data-due": addDaysIso(-1) }); // stale due
    mk({ "data-action": "bill-pay", "data-bill-id": "bdone", "data-due": addDaysIso(0) }); // finished bill
    mk({ "data-action": "bill-unpay", "data-payment-id": "pay-missing" });
  });
  const after = await page.evaluate(() => {
    bills = bills.filter((b) => b.id !== "bdone");
    return JSON.stringify([bills, billPayments]);
  });
  check("invalid/missing/stale/finished ids change nothing", after === before, after);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

// Home bill row body (homeBillHtml) uses a delegated data-action instead of an inline onclick.
await section(
  "home bill row body: delegated edit/budget branches, validated, checkbox does not open editor",
  async () => {
    const mkBill = (id, name, extra = {}) => ({
      id,
      name,
      amount: 40,
      due: isoOffset(0),
      repeat: "monthly",
      autopay: false,
      link: null,
      group: "personal",
      account: null,
      ...extra,
    });
    const { ctx, page, errors } = await openApp({ seed: { "bills-content": [mkBill("bw", "Water")] } });
    await page.evaluate(() => {
      window.__log = [];
      window.editBill = (id) => window.__log.push("edit:" + id);
      const real = activateTab;
      window.activateTab = (t) => {
        window.__log.push("tab:" + t);
        return real(t);
      };
    });
    const log = () => page.evaluate(() => JSON.stringify(window.__log));
    const row = `#panel-home .home-list .bill-home:has(.title:text-is("Pay Water"))`;
    const markup = await page.evaluate(() => {
      const b = bills[0],
        p = { id: "px", billId: b.id, name: b.name, amount: 40 };
      return [homeBillHtml(b), homeBillHtml(b, { projected: true }), homeBillHtml(null, { payment: p })].map((h) => {
        const d = document.createElement("div");
        d.innerHTML = h;
        const e = d.querySelector(".body");
        return {
          inline: d.querySelectorAll("[onclick]").length,
          raw: /onclick/i.test(h),
          a: e.getAttribute("data-action"),
          id: e.getAttribute("data-bill-id"),
          mode: e.getAttribute("data-mode"),
        };
      });
    });
    check(
      "markup has no inline onclick and carries id/mode",
      markup.every((m) => !m.inline && !m.raw && m.a === "home-bill-open") &&
        markup[0].id === "bw" &&
        markup[0].mode === "edit" &&
        markup[1].mode === "edit" &&
        markup[2].mode === "budget" &&
        markup[2].id === null,
      markup,
    );
    await page.click(`${row} .body`);
    check("edit branch opens the bill editor only", (await log()) === '["edit:bw"]', await log());
    await page.click(`${row} .todo-check`);
    check(
      "checkbox click pays without opening the editor",
      (await log()) === '["edit:bw"]' && (await page.evaluate(() => billPayments.length)) === 1,
    );
    await page.click(`#panel-home .home-list .bill-home.bill-home:has(.todo-check[data-action="bill-unpay"]) .body`);
    check(
      "paid row body opens the Budget tab, not the editor",
      (await log()) === '["edit:bw","tab:budget"]' &&
        (await page.evaluate(() => document.getElementById("panel-budget").classList.contains("active"))),
      await log(),
    );
    await page.evaluate(() => {
      activateTab("home");
      window.__log = [];
    });
    const before = await page.evaluate(() => JSON.stringify([bills, billPayments]));
    await page.evaluate(() => {
      const mk = (attrs) => {
        const b = document.createElement("div");
        for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
        document.body.appendChild(b);
        b.click();
        b.remove();
      };
      mk({ "data-action": "home-bill-open" });
      mk({ "data-action": "home-bill-open", "data-mode": "edit" });
      mk({ "data-action": "home-bill-open", "data-mode": "nope", "data-bill-id": "bw" });
      mk({ "data-action": "home-bill-open", "data-mode": "BUDGET" });
      for (const v of ["", "nope", "gone", "bw');alert(1);('", "bw ", "b w"])
        mk({ "data-action": "home-bill-open", "data-mode": "edit", "data-bill-id": v });
    });
    check(
      "invalid/stale ids and modes are inert",
      (await log()) === "[]" && (await page.evaluate(() => JSON.stringify([bills, billPayments]))) === before,
      await log(),
    );
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
);

await section("budget bill rows: pay/unpay delegated; latest-payment-only and autopay hold still apply", async () => {
  const mkBill = (id, name, extra = {}) => ({
    id,
    name,
    amount: 40,
    due: isoOffset(0),
    repeat: "monthly",
    autopay: false,
    link: null,
    group: "personal",
    account: null,
    ...extra,
  });
  const { ctx, page, errors } = await openApp({
    query: "?tab=budget",
    seed: {
      "bills-content": [
        mkBill("bw", "Water"),
        mkBill("be", "Electric", { amount: 80, varies: true }),
        mkBill("bk", "Weekly", { repeat: "weekly" }),
        mkBill("ba", "Phone", { autopay: true, due: isoOffset(-3) }),
      ],
      "bill-payments": [
        {
          id: "pay-k1",
          billId: "bk",
          name: "Weekly",
          amount: 40,
          due: isoOffset(-14),
          date: isoOffset(-14),
          group: "personal",
          account: null,
        },
        {
          id: "pay-k2",
          billId: "bk",
          name: "Weekly",
          amount: 40,
          due: isoOffset(-7),
          date: isoOffset(-7),
          group: "personal",
          account: null,
        },
      ],
    },
  });
  await page.evaluate(() => {
    window.__edit = [];
    window.editBill = (id) => window.__edit.push("bill:" + id);
    window.editPayment = (id) => window.__edit.push("pay:" + id);
  });
  const inline = await page.evaluate(
    () =>
      [...document.querySelectorAll("#bills-mine .btab-row .todo-check")].filter((b) => b.hasAttribute("onclick"))
        .length,
  );
  check("Budget table checks carry no inline onclick", inline === 0, inline);
  const nextDue = await page.evaluate(() => nextBillIso(addDaysIso(0), "monthly", undefined));
  await page.click('#bills-mine .todo-check[aria-label="Mark paid: Water"]');
  const w = await page.evaluate(() => ({
    pays: billPayments.filter((p) => p.billId === "bw").map((p) => [p.amount, p.due, p.date]),
    due: bills.find((b) => b.id === "bw").due,
  }));
  check(
    "Budget pay records payment at due date and advances the bill",
    JSON.stringify(w.pays) === JSON.stringify([[40, isoOffset(0), isoOffset(0)]]) && w.due === nextDue,
    w,
  );
  check("Budget checkbox click did not open an editor", (await page.evaluate(() => window.__edit.length)) === 0);
  // variable bill from Budget
  await page.click('#bills-mine .todo-check[aria-label="Mark paid: Electric"]');
  check(
    "variable bill prompts first",
    await page.evaluate(
      () =>
        !billPayments.some((p) => p.billId === "be") &&
        document.getElementById("modal-backdrop").classList.contains("open"),
    ),
  );
  await page.fill("#modal-amount", "55.25");
  await page.click("#modal-backdrop .modal-btn.primary");
  check(
    "variable bill records entered amount from Budget",
    await page.evaluate(() => billPayments.some((p) => p.billId === "be" && p.amount === 55.25)),
  );
  // un-pay Water from its paid row
  await page.click('#bills-mine .btab-row.checked .todo-check[aria-label="Mark not paid: Water"]');
  const u = await page.evaluate(() => ({
    n: billPayments.filter((p) => p.billId === "bw").length,
    due: bills.find((b) => b.id === "bw").due,
  }));
  check("Budget un-pay removes the payment and restores the due date", u.n === 0 && u.due === isoOffset(0), u);
  check("un-pay click did not open an editor", (await page.evaluate(() => window.__edit.length)) === 0);
  // latest-payment-only: rows are injected so they don't depend on the visible month
  const host = await page.evaluate(() => {
    const d = document.createElement("div");
    d.id = "bt-host";
    const rows = (id) => {
      const p = billPayments.find((x) => x.id === id);
      return billTableRowHtml(
        { bill: bills.find((b) => b.id === p.billId), name: p.name, amount: p.amount, due: p.due, payment: p },
        addDaysIso(0),
        "2000-01-01",
      );
    };
    d.innerHTML = `<div id="h-k1">${rows("pay-k1")}</div><div id="h-k2">${rows("pay-k2")}</div>`;
    document.body.appendChild(d);
    return d.querySelectorAll("[onclick].todo-check").length;
  });
  check("injected paid rows are delegated", host === 0);
  await page.evaluate(() => document.querySelector("#h-k1 .todo-check").click());
  check(
    "older payment cannot be undone",
    await page.evaluate(
      () =>
        billPayments.some((p) => p.id === "pay-k1") &&
        billPayments.some((p) => p.id === "pay-k2") &&
        bills.find((b) => b.id === "bk").due === addDaysIso(0),
    ),
  );
  await page.evaluate(() => document.querySelector("#h-k2 .todo-check").click());
  check(
    "latest payment can be undone and restores its due date",
    await page.evaluate(
      () =>
        !billPayments.some((p) => p.id === "pay-k2") &&
        billPayments.some((p) => p.id === "pay-k1") &&
        bills.find((b) => b.id === "bk").due === addDaysIso(-7),
    ),
  );
  // autopay: un-paying holds the date so it is not re-paid
  const auto = await page.evaluate(() => {
    const p = billPayments.find((x) => x.billId === "ba");
    return p && { id: p.id, auto: !!p.auto };
  });
  check("autopay bill was auto-paid on load", !!auto && auto.auto, auto);
  await page.evaluate((id) => {
    const p = billPayments.find((x) => x.id === id);
    const d = document.createElement("div");
    d.id = "ap-host";
    d.innerHTML = billTableRowHtml(
      { bill: bills.find((b) => b.id === "ba"), name: p.name, amount: p.amount, due: p.due, payment: p },
      addDaysIso(0),
      "2000-01-01",
    );
    document.body.appendChild(d);
  }, auto.id);
  await page.evaluate(() => document.querySelector("#ap-host .todo-check").click());
  check(
    "autopay un-pay sticks (hold set, not re-paid)",
    await page.evaluate(
      () =>
        !billPayments.some((p) => p.billId === "ba") &&
        bills.find((b) => b.id === "ba").due === addDaysIso(-3) &&
        bills.find((b) => b.id === "ba").hold === addDaysIso(-3),
    ),
  );
  // calendar-day rows (billRowHtml) are delegated too
  const cal = await page.evaluate(() => {
    const b = bills.find((x) => x.id === "bw");
    const d = document.createElement("div");
    d.id = "cal-host";
    d.innerHTML = `<div id="cal-wrap">${billRowHtml({ bill: b, name: b.name, amount: 40, due: b.due, current: true }, addDaysIso(0))}</div>`;
    document.body.appendChild(d);
    return d.querySelectorAll("[onclick].todo-check").length;
  });
  check("calendar bill row check is delegated", cal === 0);
  await page.evaluate(() => document.querySelector("#cal-host .todo-check").click());
  check(
    "calendar-row pay works and opens no editor",
    await page.evaluate(() => billPayments.some((p) => p.billId === "bw") && window.__edit.length === 0),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});
await section(
  "fitness Workouts card: rows and + Add workout are delegated; editor, order, re-render and drag hold",
  async () => {
    const { ctx, page, errors } = await openApp({ phone: false, query: "?tab=todo" });
    const save = () => page.click("#modal-backdrop .modal-btn.primary");
    const modalOpen = () => page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open"));
    const order = () => page.evaluate(() => fitness.plan.map((w) => w.id).join());
    const domOrder = () =>
      page.evaluate(() => [...document.querySelectorAll("#fit-plan .fp-row")].map((r) => r.dataset.sortId).join());
    const seed = () =>
      page.evaluate(() => {
        fitness.plan = [
          ["wa", "Gym"],
          ["wb", "Yoga"],
          ["wc", "Run"],
        ].map(([id, name]) => ({ id, name, days: [1], time: "", every: 1, anchor: addDaysIso(0), kind: "fitness" }));
        saveFitness();
        openPinned.add("fit-plan");
        renderFitness();
        renderTodoPanel();
      });
    await seed();
    const markup = await page.evaluate(() =>
      [...document.querySelectorAll("#fit-plan .fp-row, #fit-plan .add-row")].map((b) => [
        b.getAttribute("data-action"),
        b.getAttribute("data-workout-id"),
        b.hasAttribute("onclick"),
      ]),
    );
    check(
      "generated rows + Add carry delegated attributes, no inline onclick",
      markup.length === 4 &&
        markup.every((m) => !m[2]) &&
        markup[0][0] === "fitness-workout-edit" &&
        markup[1][1] === "wb" &&
        markup[3][0] === "fitness-workout-add",
      markup,
    );
    // existing workout editor
    await page.click('#fit-plan .fp-row[data-workout-id="wb"]');
    check(
      "row opens Edit workout prefilled with that workout, with Delete",
      (await page.textContent("#modal-heading")) === "Edit workout" &&
        (await page.inputValue("#modal-name")) === "Yoga" &&
        (await page.isVisible("#modal-delete-btn")),
    );
    await page.fill("#modal-name", "Yoga 2");
    await save();
    check(
      "editing changes only the selected workout and keeps order",
      await page.evaluate(() => fitness.plan.map((w) => w.id + "=" + w.name).join() === "wa=Gym,wb=Yoga 2,wc=Run"),
    );
    check(
      "card re-renders with the new name, same order",
      (await domOrder()) === "wa,wb,wc" &&
        (await page.evaluate(() =>
          document.querySelector('#fit-plan .fp-row[data-workout-id="wb"]').textContent.includes("Yoga 2"),
        )),
    );
    // blank add editor
    await page.click("#fit-plan .add-row");
    check(
      "+ Add workout opens a blank Add workout editor without Delete",
      (await page.textContent("#modal-heading")) === "Add workout" &&
        (await page.inputValue("#modal-name")) === "" &&
        !(await page.isVisible("#modal-delete-btn")),
    );
    await page.fill("#modal-name", "Swim");
    await save();
    check("add without a day is rejected (nothing added, existing behavior)", (await order()) === "wa,wb,wc");
    await page.click("#fit-plan .add-row");
    await page.fill("#modal-name", "Swim");
    await page.click('#modal-days .day-chip:has(input[value="3"])');
    await save();
    check(
      "add appends the new workout last and re-renders",
      (await page.evaluate(
        () => fitness.plan.length === 4 && fitness.plan[3].name === "Swim" && fitness.plan[3].days.join() === "3",
      )) &&
        (await domOrder()).split(",").length === 4 &&
        !(await modalOpen()),
    );
    // stale / hostile ids are inert
    await page.evaluate(() => {
      window.__edit = [];
      window.__real = window.editWorkout;
      window.editWorkout = (...a) => window.__edit.push(a);
    });
    const before = await page.evaluate(() => JSON.stringify(fitness.plan));
    await page.evaluate(() => {
      const mk = (attrs) => {
        const b = document.createElement("button");
        for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
        document.body.appendChild(b);
        b.click();
        b.remove();
      };
      mk({ "data-action": "fitness-workout-edit" });
      for (const v of ["", "nope", "gone", "wb');alert(1);('", "wb ", "w b"])
        mk({ "data-action": "fitness-workout-edit", "data-workout-id": v });
    });
    check(
      "missing/invalid/stale workout ids do nothing",
      (await page.evaluate(() => window.__edit.length)) === 0 &&
        (await page.evaluate(() => JSON.stringify(fitness.plan))) === before &&
        !(await modalOpen()),
    );
    await page.click('#fit-plan .fp-row[data-workout-id="wa"]');
    check(
      "valid id reaches editWorkout with that id only",
      JSON.stringify(await page.evaluate(() => window.__edit)) === '[["wa"]]',
    );
    await page.evaluate(() => {
      window.editWorkout = window.__real;
    });
    // drag reorders and the drop doesn't open the editor
    await seed();
    await page.evaluate(() => document.querySelector("#fit-plan").scrollIntoView({ block: "center" }));
    const from = await page.locator('#fit-plan .fp-row[data-workout-id="wc"]').boundingBox(),
      to = await page.locator('#fit-plan .fp-row[data-workout-id="wa"]').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 8, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 12 });
    await page.waitForTimeout(120);
    await page.mouse.up();
    await page.waitForTimeout(500);
    check("drag reorders the plan", (await order()) === "wc,wa,wb", await order());
    check("drag drop did not open the editor", !(await modalOpen()));
    await page.evaluate(() => renderFitness());
    check("DOM follows the saved order after re-render", (await domOrder()) === "wc,wa,wb");
    await page.click('#fit-plan .fp-row[data-workout-id="wa"]');
    check(
      "a plain click after the drag still edits that workout",
      (await modalOpen()) && (await page.inputValue("#modal-name")) === "Gym",
    );
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
);
// Workout occurrence rows (workoutRowHtml) in Home's selected-date list and To-Do upcoming groups use delegated actions.
await section(
  "workout occurrence rows: delegated in Home and To-Do, validated, future preview, persistence",
  async () => {
    const { ctx, page, errors } = await openApp({ phone: false });
    await page.evaluate(() => {
      fitness.plan = [
        ["wa", "Gym"],
        ["wb", "Yoga"],
      ].map(([id, name]) => ({
        id,
        name,
        days: [0, 1, 2, 3, 4, 5, 6],
        time: "",
        every: 1,
        anchor: addDaysIso(-30),
        kind: "fitness",
      }));
      fitness.checks = {};
      saveFitness();
      activateTab("home");
      selectHomeDate(addDaysIso(0));
      window.__edit = [];
      window.__realEdit = window.editWorkout;
      window.editWorkout = (...a) => {
        window.__edit.push(a);
        return window.__realEdit(...a);
      };
    });
    const modalOpen = () => page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open"));
    const closeIt = () =>
      page.evaluate(() => {
        if (document.getElementById("modal-backdrop").classList.contains("open")) closeModal();
      });
    const markup = (sel) =>
      page.evaluate(
        (s) =>
          [...document.querySelectorAll(s)].map((r) => ({
            inline: r.querySelectorAll("[onclick]").length,
            chk:
              r.querySelector(".todo-check") &&
              [
                r.querySelector(".todo-check").getAttribute("data-action"),
                r.querySelector(".todo-check").getAttribute("data-workout-id"),
                r.querySelector(".todo-check").getAttribute("data-date"),
              ].join("|"),
            body: [
              r.querySelector(".body").getAttribute("data-action"),
              r.querySelector(".body").getAttribute("data-workout-id"),
              r.querySelector(".body").getAttribute("data-date"),
            ].join("|"),
          })),
        sel,
      );
    const today = await page.evaluate(() => addDaysIso(0));
    const hm = await markup("#panel-home .workout-row");
    check(
      "Home rows delegated, no inline handlers",
      hm.length === 2 &&
        hm.every((m) => m.inline === 0) &&
        hm[0].chk === `workout-occ-toggle|wa|${today}` &&
        hm[1].body === `workout-occ-edit|wb|${today}`,
      hm,
    );
    const done = (id, iso) => page.evaluate(([i, d]) => workoutDone(d, i), [id, iso]);
    // toggle the right occurrence in Home; no editor
    await page.click('#panel-home .workout-row:has(.title:text-is("Yoga")) .todo-check');
    check(
      "Home check toggles only that workout/date, opens no editor",
      (await done("wb", today)) &&
        !(await done("wa", today)) &&
        !(await modalOpen()) &&
        (await page.evaluate(() => window.__edit.length)) === 0,
    );
    check(
      "done styling and persistence",
      await page.evaluate(() => {
        const r = [...document.querySelectorAll("#panel-home .workout-row")].find((x) =>
          x.textContent.includes("Yoga"),
        );
        return (
          r.querySelector(".item").classList.contains("checked") &&
          r.querySelector(".todo-check").getAttribute("aria-checked") === "true" &&
          JSON.parse(localStorage.getItem("fitness-content")).checks[`${addDaysIso(0)}|wb`] === true
        );
      }),
    );
    await page.click('#panel-home .workout-row:has(.title:text-is("Yoga")) .todo-check');
    check("Home check again unticks", !(await done("wb", today)));
    // edit the right workout
    await page.click('#panel-home .workout-row:has(.title:text-is("Gym")) .body');
    check(
      "Home body opens that workout's editor",
      (await modalOpen()) && (await page.inputValue("#modal-name")) === "Gym" && !(await done("wa", today)),
    );
    await closeIt();
    // future date: preview, no check, still editable
    const fut = await page.evaluate(() => {
      selectHomeDate(addDaysIso(2));
      return addDaysIso(2);
    });
    const fm = await page.evaluate(() =>
      [...document.querySelectorAll("#panel-home .workout-row")].map((r) => ({
        ghost: r.classList.contains("repeat-ghost"),
        checks: r.querySelectorAll(".todo-check").length,
        icon: !!r.querySelector(".repeat-icon"),
        body: r.querySelector(".body").getAttribute("data-date"),
      })),
    );
    check(
      "future rows are previews: no check, repeat icon, dated body",
      fm.length === 2 && fm.every((m) => m.ghost && m.checks === 0 && m.icon && m.body === fut),
      fm,
    );
    await page.click('#panel-home .workout-row:has(.title:text-is("Yoga")) .body');
    check(
      "future preview still opens editor",
      (await modalOpen()) && (await page.inputValue("#modal-name")) === "Yoga",
    );
    await closeIt();
    // a forged future toggle is a no-op
    await page.evaluate((d) => {
      const b = document.createElement("button");
      b.setAttribute("data-action", "workout-occ-toggle");
      b.setAttribute("data-workout-id", "wa");
      b.setAttribute("data-date", d);
      document.body.appendChild(b);
      b.click();
      b.remove();
    }, fut);
    check("future toggle does nothing", !(await done("wa", fut)));
    // To-Do upcoming groups
    await page.evaluate(() => {
      selectHomeDate(addDaysIso(0));
      activateTab("todo");
      renderTodoPanel();
    });
    const tm = await page.evaluate(() =>
      [...document.querySelectorAll("#todo-card .workout-row")].map((r) => ({
        inline: r.querySelectorAll("[onclick]").length,
        ghost: r.classList.contains("repeat-ghost"),
        checks: r.querySelectorAll(".todo-check").length,
        body:
          r.querySelector(".body").getAttribute("data-action") +
          "|" +
          r.querySelector(".body").getAttribute("data-date"),
        group: r.closest(".todo-group, .group, [data-group]") ? 1 : 0,
      })),
    );
    check(
      "To-Do shows 7 days x 2 rows, delegated, only today is checkable",
      tm.length === 14 &&
        tm.every((m) => m.inline === 0 && m.body.startsWith("workout-occ-edit|")) &&
        tm.filter((m) => m.checks).length === 2 &&
        tm.filter((m) => m.ghost).length === 12,
      tm.length,
    );
    const dates = await page.evaluate(() =>
      [...document.querySelectorAll("#todo-card .workout-row .body")].map((b) => b.getAttribute("data-date")),
    );
    const expected = await page.evaluate(() => [0, 1, 2, 3, 4, 5, 6].flatMap((n) => [addDaysIso(n), addDaysIso(n)]));
    check("To-Do rows keep date grouping order", JSON.stringify(dates) === JSON.stringify(expected));
    await page.click('#todo-card .workout-row:has(.title:text-is("Gym")) .todo-check');
    check(
      "To-Do check toggles that occurrence, opens no editor",
      (await done("wa", today)) && !(await done("wb", today)) && !(await modalOpen()),
    );
    check(
      "To-Do row re-renders checked and persists",
      await page.evaluate(
        () =>
          document.querySelector("#todo-card .workout-row .item.checked") !== null &&
          JSON.parse(localStorage.getItem("fitness-content")).checks[`${addDaysIso(0)}|wa`] === true,
      ),
    );
    await page.click('#todo-card .workout-row:has(.title:text-is("Yoga")) >> nth=1 >> .body');
    check(
      "To-Do future row body opens that workout's editor",
      (await modalOpen()) && (await page.inputValue("#modal-name")) === "Yoga",
    );
    await closeIt();
    // invalid / missing / stale metadata is inert
    await page.evaluate(() => {
      window.__edit = [];
    });
    const before = await page.evaluate(() => JSON.stringify([fitness.checks, fitness.plan]));
    await page.evaluate(() => {
      const t = addDaysIso(0);
      const mk = (attrs) => {
        const b = document.createElement("button");
        for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
        document.body.appendChild(b);
        b.click();
        b.remove();
      };
      for (const action of ["workout-occ-edit", "workout-occ-toggle"]) {
        mk({ "data-action": action });
        mk({ "data-action": action, "data-workout-id": "wa" });
        mk({ "data-action": action, "data-date": t });
        for (const id of ["", "nope", "gone", "wa');alert(1);('", "wa ", "w a"])
          mk({ "data-action": action, "data-workout-id": id, "data-date": t });
        for (const d of ["", "nope", "2026-13-45", "2026-02-30", "2026-1-1", " " + t])
          mk({ "data-action": action, "data-workout-id": "wa", "data-date": d });
      }
      // a real workout that does not land on the date (stale occurrence)
      fitness.plan[0].days = [(noonOf(t).getDay() + 1) % 7];
      fitness.plan[0].every = 1;
      mk({ "data-action": "workout-occ-edit", "data-workout-id": "wa", "data-date": t });
      mk({ "data-action": "workout-occ-toggle", "data-workout-id": "wa", "data-date": t });
    });
    const after = await page.evaluate(() =>
      JSON.stringify([
        fitness.checks,
        fitness.plan.map((w, i) => (i === 0 ? { ...w, days: [0, 1, 2, 3, 4, 5, 6] } : w)),
      ]),
    );
    check(
      "invalid/missing/stale metadata does nothing",
      (await page.evaluate(() => window.__edit.length)) === 0 && !(await modalOpen()) && after === before,
    );
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
);
// Completed section toggle + Clear completed run through delegated data-action handlers.
await section("handlers: completed to-do toggle and clear completed", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=todo",
    seed: {
      "todo-content": [
        { id: "ca", text: "Open one", done: false, due: isoOffset(0), starred: false, subitems: [], completedAt: null },
        {
          id: "cb",
          text: "Done one",
          done: true,
          due: isoOffset(0),
          starred: false,
          subitems: [],
          completedAt: Date.now(),
        },
        {
          id: "cc",
          text: "Done two",
          done: true,
          due: isoOffset(0),
          starred: false,
          subitems: [],
          completedAt: Date.now(),
        },
      ],
    },
  });
  const toggle = "#todo-card .completed-toggle";
  const state = () =>
    page.evaluate(() => ({
      expanded: document.querySelector("#todo-card .completed-toggle")?.getAttribute("aria-expanded"),
      list: !!document.getElementById("todo-completed"),
      ids: todoList.map((t) => t.id).join(),
    }));
  check(
    "completed toggle uses data-action, no inline handlers",
    await page.evaluate(
      () =>
        document.querySelector("#todo-card .completed-toggle").getAttribute("data-action") ===
          "todo-completed-toggle" && !document.querySelector("#todo-card .completed-toggle").hasAttribute("onclick"),
    ),
  );
  let s = await state();
  check("completed section starts collapsed", s.expanded === "false" && !s.list, s);
  await page.click(toggle);
  s = await state();
  check("toggle opens: aria-expanded true and list visible", s.expanded === "true" && s.list, s);
  check(
    "clear button uses data-action, no inline handler",
    await page.evaluate(() => {
      const b = document.querySelector("#todo-completed .reset-btn");
      return b.getAttribute("data-action") === "todo-completed-clear" && !b.hasAttribute("onclick");
    }),
  );
  await page.click(toggle);
  s = await state();
  check("toggle closes: aria-expanded false and list hidden", s.expanded === "false" && !s.list, s);
  await page.click(toggle);
  page.removeAllListeners("dialog");
  let msg = null;
  page.once("dialog", (d) => {
    msg = d.message();
    d.dismiss();
  });
  await page.click("#todo-completed .reset-btn");
  s = await state();
  check(
    "cancelling clear confirm changes nothing",
    /Clear all completed/.test(msg || "") && s.ids === "ca,cb,cc" && s.list,
    [msg, s],
  );
  page.once("dialog", (d) => d.accept());
  await page.click("#todo-completed .reset-btn");
  s = await state();
  check(
    "confirming clear removes only completed items and rerenders section",
    s.ids === "ca" && !s.list && s.expanded === undefined,
    s,
  );
  check("open item still rendered", (await page.locator('#todo-list .todo-wrap[data-todo-id="ca"]').count()) === 1);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});
// Inline-handler migration, batch 1: composer chips and the edit-to-do sheet use delegated data-action markup.
// `bad` clicks/changes synthetic elements carrying invalid or stale metadata; the caller asserts nothing changed.
const fireSynthetic = (page, specs, event = "click") =>
  page.evaluate(
    ([specs, event]) => {
      for (const attrs of specs) {
        const b = document.createElement("button");
        for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
        document.body.appendChild(b);
        b.dispatchEvent(new Event(event, { bubbles: true }));
        b.remove();
      }
    },
    [specs, event],
  );
await section("composer chips: delegated, mode-validated, invalid metadata inert", async () => {
  const { ctx, page, errors } = await openApp({
    seed: {
      "budget-content": {
        categories: [{ id: "cg", name: "Groceries", limit: 100 }],
        accounts: ["Visa"],
        goals: [],
        paychecks: [],
      },
    },
  });
  const state = () => page.evaluate(() => JSON.stringify(composer));
  await page.evaluate(() => openComposer("todo"));
  check(
    "to-do chips have no inline handlers",
    await page.evaluate(
      () =>
        !document.querySelector("#composer [onclick], #composer [onchange]") &&
        document.querySelectorAll("#composer-chips [data-action]").length >= 6,
    ),
  );
  await page.click('#composer-chips [data-action="composer-toggle"][data-key="star"]');
  check(
    "Star toggles and aria-pressed follows",
    await page.evaluate(
      () =>
        composer.star === true && document.querySelector('[data-key="star"]').getAttribute("aria-pressed") === "true",
    ),
  );
  await page.click('#composer-chips [data-action="composer-repeat-toggle"]');
  check(
    "Repeat chip turns on weekly and shows the second row",
    await page.evaluate(
      () =>
        composer.repeat === "weekly" && document.querySelectorAll('#composer-chips2 [data-key="repeat"]').length > 3,
    ),
  );
  await page.click('#composer-chips2 [data-val="monthly"]');
  check("repeat choice applies", await page.evaluate(() => composer.repeat === "monthly"));
  await page.click('#composer-chips [data-action="composer-pick-date"] >> nth=1');
  check("date chip picks Tomorrow", await page.evaluate(() => composer.date === addDaysIso(1) && composer.manual));
  const before = await state();
  await fireSynthetic(page, [
    { "data-action": "composer-set", "data-key": "repeat", "data-val": "constructor" },
    { "data-action": "composer-set", "data-key": "repeat", "data-val": "custom" },
    { "data-action": "composer-set", "data-key": "__proto__", "data-val": "x" },
    { "data-action": "composer-set", "data-key": "cat", "data-val": "moto" },
    { "data-action": "composer-set", "data-key": "type", "data-val": "bill" },
    { "data-action": "composer-toggle", "data-key": "high" },
    { "data-action": "composer-toggle", "data-key": "mode" },
    { "data-action": "composer-pick-date", "data-date": "2026-02-31" },
    { "data-action": "composer-pick-date", "data-date": "x');alert(1);('" },
    { "data-action": "composer-set-date", "data-date": isoOffset(2) },
    { "data-action": "composer-account", "data-index": "0" },
    { "data-action": "composer-group-toggle" },
    { "data-action": "composer-ignore-parse" },
  ]);
  check("invalid / wrong-mode to-do chip metadata is inert", (await state()) === before, await state());
  await page.evaluate(() => closeComposer());
  // shopping mode
  await page.evaluate(() => openComposer("shop"));
  await page.click('#composer-chips [data-key="cat"][data-val="wardrobe"]');
  await page.click('#composer-chips2 [data-key="wcat"][data-val="Shoes"]');
  await page.click('#composer-chips [data-action="composer-toggle"][data-key="high"]');
  await page.click('#composer-chips [data-key="kind"][data-val="need"]');
  check(
    "shop chips set cat/wcat/high/kind",
    await page.evaluate(
      () =>
        composer.cat === "wardrobe" && composer.wcat === "Shoes" && composer.high === true && composer.kind === "need",
    ),
    await state(),
  );
  const shopBefore = await state();
  await fireSynthetic(page, [
    { "data-action": "composer-set", "data-key": "cat", "data-val": "cg" },
    { "data-action": "composer-set", "data-key": "wcat", "data-val": "Hats" },
    { "data-action": "composer-set", "data-key": "kind", "data-val": "both" },
    { "data-action": "composer-toggle", "data-key": "star" },
  ]);
  check("invalid shop metadata is inert", (await state()) === shopBefore, await state());
  await page.evaluate(() => closeComposer());
  // money mode
  await page.evaluate(() => openComposer("money"));
  await page.click('#composer-chips [data-key="cat"][data-val="cg"], #composer-chips2 [data-key="cat"][data-val="cg"]');
  check("expense category chip applies", await page.evaluate(() => composer.cat === "cg"));
  await page.click('#composer-chips [data-key="type"][data-val="bill"]');
  await page.click('#composer-chips [data-action="composer-group-toggle"]');
  await page.click('#composer-chips [data-action="composer-toggle"][data-key="autopay"]');
  await page.click('#composer-chips2 [data-key="repeat"][data-val="weekly"]');
  await page.click('#composer-chips2 [data-action="composer-account"]');
  const bill = await page.evaluate(() => ({
    g: composer.group,
    a: composer.autopay,
    r: composer.repeat,
    acct: composer.account,
  }));
  check(
    "bill chips apply (group, autopay, repeat, account)",
    bill.g === "joint" && bill.a === true && bill.r === "weekly" && bill.acct === "Visa",
    bill,
  );
  await page.click('#composer-chips2 [data-action="composer-account"]');
  check("account chip toggles off", await page.evaluate(() => composer.account === null));
  const moneyBefore = await state();
  await fireSynthetic(page, [
    { "data-action": "composer-account", "data-index": "9" },
    { "data-action": "composer-account", "data-index": "-1" },
    { "data-action": "composer-account", "data-index": "0 " },
    { "data-action": "composer-set", "data-key": "repeat", "data-val": "daily" },
    { "data-action": "composer-set", "data-key": "goal", "data-val": "nope" },
    { "data-action": "composer-set", "data-key": "type", "data-val": "goal" },
    { "data-action": "composer-set-date", "data-date": "nope" },
  ]);
  check("invalid money metadata is inert", (await state()) === moneyBefore, await state());
  check(
    "no inline handlers in money composer",
    await page.evaluate(() => !document.querySelector("#composer [onclick]")),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});
await section("edit to-do sheet: delegated chips, date inputs, stale/invalid metadata inert", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=todo",
    seed: {
      "todo-content": [
        {
          id: "ea",
          text: "Plan trip",
          done: false,
          due: isoOffset(0),
          starred: false,
          subitems: [],
          completedAt: null,
        },
      ],
    },
  });
  await page.evaluate(() => editTodo("ea"));
  check(
    "sheet markup has no inline handlers",
    await page.evaluate(
      () =>
        document.querySelectorAll("#modal-backdrop [onclick], #modal-backdrop [onchange]").length === 0 &&
        !!document.querySelector('.tde-subs-toggle[data-action="tde-open-subs"]'),
    ),
  );
  await page.click('#tde [data-action="tde-repeat"][data-repeat=""]');
  await page.click('#tde [data-action="tde-repeat"]:text-is("Custom")');
  check(
    "Custom reveals the stepper with weeks selected",
    await page.evaluate(
      () =>
        tde.repeat === "weeks" &&
        !!document.getElementById("modal-every") &&
        document.querySelector('.tde-seg [aria-pressed="true"]').textContent.trim().startsWith("week"),
    ),
  );
  await page.click('[data-action="tde-every"][data-delta="1"]');
  await page.click('[data-action="tde-every"][data-delta="1"]');
  await page.click('[data-action="tde-every"][data-delta="-1"]');
  await page.click('.tde-seg [data-repeat="months"]');
  check(
    "stepper and unit apply",
    await page.evaluate(
      () => tde.every === 3 && tde.repeat === "months" && document.getElementById("modal-every").textContent === "3",
    ),
  );
  await page.click('#tde [data-action="tde-end"]:has-text("Multi-day")');
  check(
    "Multi-day sets an end date the next day",
    await page.evaluate(() => tde.end === addDaysIso(1) && !!document.getElementById("modal-end")),
  );
  await page.fill("#modal-end", isoOffset(4));
  check("date input change flows through tdeSet", await page.evaluate((iso) => tde.end === iso, isoOffset(4)));
  await page.click(".tde-x");
  check("✕ clears the end date", await page.evaluate(() => tde.end === null));
  await page.fill("#modal-due", isoOffset(9));
  check("due date input applies", await page.evaluate((iso) => tde.due === iso, isoOffset(9)));
  await page.click('#tde [data-action="tde-kind"][data-kind="pet"]');
  check(
    "kind chip applies with aria-pressed",
    await page.evaluate(
      () =>
        tde.kind === "pet" && document.querySelector('#tde [data-kind="pet"]').getAttribute("aria-pressed") === "true",
    ),
  );
  await page.click('#tde [data-action="tde-due"][data-date=""]');
  check("Anytime clears date and repeat", await page.evaluate(() => tde.due === null && tde.repeat === null));
  const snap = () => page.evaluate(() => JSON.stringify(tde));
  const before = await snap();
  await fireSynthetic(page, [
    { "data-action": "tde-due", "data-date": "2026-13-45" },
    { "data-action": "tde-due", "data-date": "x" },
    { "data-action": "tde-end", "data-date": "'+alert(1)+'" },
    { "data-action": "tde-repeat", "data-repeat": "constructor" },
    { "data-action": "tde-repeat", "data-repeat": "hourly" },
    { "data-action": "tde-every", "data-delta": "5" },
    { "data-action": "tde-kind", "data-kind": "evil" },
    { "data-action": "tde-kind", "data-kind": "toString" },
  ]);
  await fireSynthetic(page, [{ "data-change-action": "tde-date", "data-field": "kind" }], "change");
  check("invalid tde metadata is inert", (await snap()) === before, await snap());
  await page.click(".tde-subs-toggle");
  check(
    "Add sub-items reveals and focuses the field, removing the button",
    await page.evaluate(
      () =>
        !document.querySelector(".tde-subs-toggle") &&
        !document.getElementById("modal-subs").closest(".modal-field").hidden &&
        document.activeElement.id === "modal-subs",
    ),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});
// Inline-handler migration, batch 2: Skin tab (routine, week, editor, rules, wash calendar), collapsible headers and Shopping.
await section("skin + shopping controls: delegated markup, behavior, invalid/stale metadata inert", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=skin",
    seed: { "skin-rules-content": ["First rule", "Second rule"] },
  });
  await page.evaluate(() => {
    openPinned.add("wash-card");
    openPinned.add("routine-card");
    openPinned.add("rules-skin");
    renderSkin();
  });
  check(
    "skin markup has no inline handlers",
    await page.evaluate(
      () => !document.querySelector("#panel-skin [onclick], #panel-skin [onchange], #panel-skin [onerror]"),
    ),
  );
  const stepSel = ".routine-band.am .routine-step";
  const n0 = await page.evaluate(() => todayChecks().am.length);
  await page.click(`${stepSel} >> nth=0`);
  check(
    "routine step toggles and aria-checked follows",
    await page.evaluate(
      (n) =>
        todayChecks().am.length === n + 1 &&
        document.querySelector(".routine-band.am .routine-step").getAttribute("aria-checked") === "true",
      n0,
    ),
  );
  await page.click(".routine-band.pm .routine-band-head");
  const pmOpen = await page.evaluate(() =>
    document.querySelector(".routine-band.pm .routine-band-head").getAttribute("aria-expanded"),
  );
  await page.click(".routine-band.pm .routine-band-head");
  check(
    "band head toggles aria-expanded",
    pmOpen !==
      (await page.evaluate(() =>
        document.querySelector(".routine-band.pm .routine-band-head").getAttribute("aria-expanded"),
      )),
    pmOpen,
  );
  await page.click(".week-day-head >> nth=0");
  check(
    "week day expands",
    await page.evaluate(() => document.querySelectorAll(".week-day.open").length === 1 && openWeekDays.size === 1),
  );
  // collapsible header (shared)
  await page.click("#wash-card .coll-head");
  check(
    "collapsible header toggles open",
    await page.evaluate(() => !document.getElementById("wash-card").classList.contains("open")),
  );
  await page.click("#wash-card .coll-head");
  // wash calendar
  const target = isoOffset(3);
  const hasTarget = await page.locator(`#wash-card .cal-day[data-date="${target}"]`).count();
  if (hasTarget) {
    await page.click(`#wash-card .cal-day[data-date="${target}"]`);
    check("calendar day sets wash date", await page.evaluate((iso) => washSchedule().anchor === iso, target));
  }
  await page.click('#wash-card .wash-freq [data-days="21"]');
  check("frequency chip applies", await page.evaluate(() => washSchedule().everyDays === 21));
  const month0 = await page.evaluate(() => washCalOffset);
  await page.click('#wash-card [data-action="wash-month"][data-delta="1"]');
  check("month nav shifts", await page.evaluate((m) => washCalOffset === m + 1, month0));
  // routine editor + rules (editor buttons keep the sortable .band[data-band] > .step.editable shape)
  check(
    "editor steps are direct children of band boxes",
    await page.evaluate(
      () =>
        document.querySelectorAll(".band[data-band] > .step.editable").length > 3 &&
        ![...document.querySelectorAll("[data-step-band]")].some((b) => b.hasAttribute("data-band")),
    ),
  );
  await page.click(".band.am > .step.editable >> nth=0");
  check(
    "step editor opens",
    await page.evaluate(
      () =>
        document.getElementById("modal-backdrop").classList.contains("open") &&
        document.getElementById("modal-heading").textContent === "Edit step",
    ),
  );
  await page.evaluate(() => closeModal());
  await page.click('.band[data-band="pm"] [data-action="routine-step-add"]');
  check(
    "add-step opens an empty editor",
    await page.evaluate(() => document.getElementById("modal-heading").textContent === "Add step"),
  );
  await page.evaluate(() => closeModal());
  check(
    "rules rows and Add are delegated",
    await page.evaluate(
      () =>
        document.querySelectorAll('[data-action="skin-rule-edit"]').length === 2 &&
        !!document.querySelector('[data-action="skin-rule-add"]'),
    ),
  );
  await page.click('[data-action="skin-rule-edit"][data-index="1"]');
  check(
    "rule editor opens for that rule",
    await page.evaluate(
      () =>
        document.getElementById("modal-heading").textContent === "Edit rule" &&
        document.getElementById("modal-text").value === "Second rule",
    ),
  );
  await page.evaluate(() => closeModal());
  // invalid / stale metadata
  const snap = () =>
    page.evaluate(() =>
      JSON.stringify([
        routineChecks,
        skinRoutine,
        skinRules,
        washSchedule(),
        [...openWeekDays],
        washCalOffset,
        document.getElementById("modal-backdrop").classList.contains("open"),
      ]),
    );
  const before = await snap();
  await fireSynthetic(page, [
    { "data-action": "routine-step", "data-band": "washPm", "data-step-id": "x" },
    { "data-action": "routine-step", "data-band": "am", "data-step-id": "gone" },
    { "data-action": "routine-step", "data-band": "constructor", "data-step-id": "a'b" },
    { "data-action": "routine-band", "data-band": "washPm" },
    { "data-action": "week-day", "data-date": "2026-02-30" },
    { "data-action": "week-day", "data-date": "x" },
    { "data-action": "routine-step-edit", "data-step-band": "am", "data-step-id": "gone" },
    { "data-action": "routine-step-edit", "data-step-band": "zz", "data-step-id": "a" },
    { "data-action": "routine-step-add", "data-step-band": "zz" },
    { "data-action": "routine-step-add", "data-step-band": "__proto__" },
    { "data-action": "skin-rule-edit", "data-index": "999" },
    { "data-action": "skin-rule-edit", "data-index": "-1" },
    { "data-action": "skin-rule-edit", "data-index": "1e0" },
    { "data-action": "wash-date", "data-date": "nope" },
    { "data-action": "wash-frequency", "data-days": "5" },
    { "data-action": "wash-frequency", "data-days": "" },
    { "data-action": "wash-month", "data-delta": "9" },
    { "data-action": "coll-toggle", "data-card-id": "nope" },
    { "data-action": "coll-toggle", "data-card-id": "panel-skin" },
    { "data-action": "coll-toggle", "data-card-id": "a b" },
  ]);
  check("invalid/stale skin metadata is inert", (await snap()) === before);
  // shopping
  await page.evaluate(() => {
    activateTab("wants");
    ["wants-pending-card", "wants-later-card", "wants-purchased-card"].forEach((i) => openPinned.add(i));
    renderWants();
  });
  check(
    "shopping markup has no inline handlers",
    await page.evaluate(() => !document.querySelector("#panel-wants [onclick], #panel-wants [onchange]")),
  );
  await page.click('.filter-chips [data-filter="moto"]');
  check(
    "filter chip applies with aria-pressed",
    await page.evaluate(
      () =>
        wantsFilter === "moto" &&
        document.querySelector('[data-filter="moto"]').getAttribute("aria-pressed") === "true",
    ),
  );
  await page.evaluate(() => {
    wantsFilter = "wardrobe";
    wantsList.forEach((w) => {
      delete w.wardrobeCat;
    });
    renderWants();
  });
  check("empty filter shows Show all", (await page.locator('.link-btn[data-filter="all"]').count()) === 1);
  await page.click('.link-btn[data-filter="all"]');
  check("Show all resets the filter", await page.evaluate(() => wantsFilter === "all"));
  const id = await page.evaluate(() => wantsList.find((w) => !wantsState[w.id] && !w.later).id);
  await page.click(`#wants-pending-card .want-card:has([data-want-id="${id}"]) [data-action="want-later"]`);
  check(
    "Later moves the item off To buy",
    await page.evaluate(
      (id) =>
        wantsList.find((w) => w.id === id).later === true &&
        !!document.querySelector(`#wants-later-card [data-want-id="${id}"]`),
      id,
    ),
  );
  await page.click(`#wants-later-card [data-action="want-later"][data-want-id="${id}"]`);
  check("Back to list restores it", await page.evaluate((id) => !wantsList.find((w) => w.id === id).later, id));
  await page.click(`#wants-pending-card [data-action="want-toggle"][data-want-id="${id}"]`);
  check(
    "Mark bought moves it to Purchased",
    await page.evaluate(
      (id) =>
        wantsState[id] === true &&
        !!document.querySelector(`#wants-purchased-card [data-action="want-toggle"][data-want-id="${id}"]`),
      id,
    ),
  );
  await page.click(`#wants-purchased-card [data-action="want-toggle"][data-want-id="${id}"]`);
  await page.evaluate(() => {
    window.__e = [];
    const real = editWant;
    window.editWant = (i) => window.__e.push(i);
  });
  await page.click(`#wants-pending-card .want-card .body[data-want-id="${id}"] .name`);
  check(
    "body click opens the editor for that item",
    (await page.evaluate(() => JSON.stringify(window.__e))) === JSON.stringify([id]),
  );
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = "x";
    a.addEventListener("click", (e) => e.preventDefault());
    document.querySelector("#wants-pending-card .want-card .body").appendChild(a);
    a.click();
  });
  check("a link inside the body does not open the editor", (await page.evaluate(() => window.__e.length)) === 1);
  const wsnap = () => page.evaluate(() => JSON.stringify([wantsList, wantsState, wantsFilter]));
  const wb = await wsnap();
  await fireSynthetic(page, [
    { "data-action": "want-toggle", "data-want-id": "nope" },
    { "data-action": "want-toggle", "data-want-id": "a b'c" },
    { "data-action": "want-toggle" },
    { "data-action": "want-later", "data-want-id": id, "data-later": "maybe" },
    { "data-action": "want-later", "data-want-id": "nope", "data-later": "true" },
    { "data-action": "want-edit", "data-want-id": "nope" },
    { "data-action": "wants-filter", "data-filter": "bogus" },
    { "data-action": "wants-filter", "data-filter": "constructor" },
  ]);
  check(
    "invalid/stale want metadata is inert",
    (await wsnap()) === wb && (await page.evaluate(() => window.__e.length)) === 1,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});
// Inline-handler migration, batch 3: Jazz 3.0 (Plan 3 rows/sections/hero chips) and the weigh-in row.
await section("jazz 3.0: plan rows, sections, hero chips and weigh-in rows are delegated and validated", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=jazz3",
    seed: {
      "fitness-content": {
        goal: 120,
        start: 100,
        weights: [{ id: "wk1", date: isoOffset(-3), lbs: 110 }],
        plan: [],
        weighDay: new Date().getDay(),
      },
    },
  });
  check(
    "no inline handlers in Jazz 3.0 / Home weigh-in",
    await page.evaluate(() => !document.querySelector("#panel-jazz3 [onclick], #panel-jazz3 [onchange]")),
  );
  const first = await page.evaluate(() => plan3[0].id);
  await page.evaluate(() => {
    activateTab("jazz3");
  });
  await page.click(`#panel-jazz3 [data-action="plan3-toggle"][data-plan3-id="${first}"]`);
  check(
    "check toggles done and keeps aria-checked/label",
    await page.evaluate(
      (id) =>
        plan3.find((x) => x.id === id).done === true &&
        document.querySelector(`[data-plan3-id="${id}"][data-action="plan3-toggle"]`).getAttribute("aria-checked") ===
          "true" &&
        /^Not done:/.test(
          document.querySelector(`[data-plan3-id="${id}"][data-action="plan3-toggle"]`).getAttribute("aria-label"),
        ),
      first,
    ),
  );
  await page.click(`#panel-jazz3 [data-action="plan3-toggle"][data-plan3-id="${first}"]`);
  check("check toggles back", await page.evaluate((id) => !plan3.find((x) => x.id === id).done, first));
  await page.click(`#panel-jazz3 [data-action="plan3-edit"][data-plan3-id="${first}"]`);
  check(
    "row body opens the editor for that item",
    await page.evaluate(
      (id) =>
        document.getElementById("modal-heading").textContent === "Edit item" &&
        document.getElementById("modal-item").value === plan3.find((x) => x.id === id).item,
      first,
    ),
  );
  await page.evaluate(() => closeModal());
  await page.click('#panel-jazz3 [data-action="plan3-add"][data-cat-index="1"]');
  check(
    "Add item preselects its section by position",
    await page.evaluate(
      () =>
        document.getElementById("modal-heading").textContent === "Add item" &&
        document.getElementById("modal-cat").value === plan3Cats()[1],
    ),
  );
  await page.evaluate(() => closeModal());
  await page.click('[data-action="plan3-new-section"]');
  check(
    "New section opens the add form on the new-section option",
    await page.evaluate(() => document.getElementById("modal-cat").value === "New section…"),
  );
  await page.evaluate(() => closeModal());
  check(
    "sortable rows still match .p3-list > .p3-row",
    await page.evaluate(() => document.querySelectorAll(".p3-list > .p3-row[data-sort-id]").length === plan3.length),
  );
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll('[data-action="j3-jump"]')].map((b) => b.getAttribute("data-target")),
  );
  check("hero chips carry targets", chips[0] === "weight-card" && chips.some((c) => c.startsWith("p3-")), chips);
  await page.evaluate(() => {
    openPinned.delete("p3-glow");
    renderFitness();
    window.__scroll = 0;
    Element.prototype.scrollIntoView = function () {
      window.__scroll++;
    };
  });
  await page.click('[data-action="j3-jump"][data-target="p3-glow"]');
  check(
    "hero chip opens and scrolls to its card",
    await page.evaluate(() => openPinned.has("p3-glow") && window.__scroll === 1),
  );
  const snap = () =>
    page.evaluate(() =>
      JSON.stringify([
        plan3,
        [...openPinned].sort(),
        fitness.weights,
        document.getElementById("modal-backdrop").classList.contains("open"),
        window.__scroll,
      ]),
    );
  const before = await snap();
  await fireSynthetic(page, [
    { "data-action": "plan3-toggle", "data-plan3-id": "nope" },
    { "data-action": "plan3-toggle", "data-plan3-id": "p3-1');alert(1)" },
    { "data-action": "plan3-toggle" },
    { "data-action": "plan3-edit", "data-plan3-id": "gone" },
    { "data-action": "plan3-add", "data-cat-index": "99" },
    { "data-action": "plan3-add", "data-cat-index": "-1" },
    { "data-action": "plan3-add", "data-cat-index": "x" },
    { "data-action": "j3-jump", "data-target": "panel-home" },
    { "data-action": "j3-jump", "data-target": "p3-nope" },
    { "data-action": "j3-jump", "data-target": "constructor" },
    { "data-action": "weigh-row-open", "data-weight-id": "nope", "data-date": isoOffset(0) },
    { "data-action": "weigh-row-open", "data-weight-id": "", "data-date": "2026-02-30" },
    { "data-action": "weigh-row-check", "data-weight-id": "wk1", "data-date": "x" },
    { "data-action": "weigh-row-check", "data-weight-id": "a b", "data-date": isoOffset(0) },
  ]);
  check("invalid/stale plan3 and weigh-row metadata is inert", (await snap()) === before);
  // weigh-in rows (Home): weigh-in day is today so the row shows
  await page.evaluate(() => activateTab("home"));
  const row = "#panel-home .weigh-row";
  check(
    "weigh row renders delegated, no inline handlers",
    await page.evaluate((sel) => {
      const r = document.querySelector(sel);
      return (
        !!r &&
        r.querySelectorAll("[onclick]").length === 0 &&
        r.querySelector(".todo-check").getAttribute("data-action") === "weigh-row-check" &&
        r.querySelector(".body").getAttribute("data-action") === "weigh-row-open"
      );
    }, row),
  );
  await page.click(`${row} .todo-check`);
  check(
    "weigh row check opens the log form",
    await page.evaluate(
      () =>
        document.getElementById("modal-heading").textContent === "Log weight" &&
        document.getElementById("modal-date").value === addDaysIso(0),
    ),
  );
  await page.evaluate(() => closeModal());
  await page.click(`${row} .body`);
  check(
    "weigh row body opens the log form",
    await page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open")),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});
await section(
  "budget: bills, plan lines, paychecks, goals, spending, manage rows and logo fallback are delegated and validated",
  async () => {
    const k = isoOffset(0).slice(0, 7);
    const seed = {
      "budget-content": {
        categories: [
          { id: "cg", name: "Groceries", limit: 100 },
          { id: "co", name: "Other", limit: 50 },
        ],
        expenses: [{ id: "ex1", name: "Milk", amount: 4, cat: "cg", date: isoOffset(0) }],
        accounts: ["Visa", "Ally"],
        income: [{ id: "inc1", name: "Paycheck", amount: 2000, start: k + "-01", repeat: "monthly" }],
        plans: { ["inc1|" + k + "-01"]: { lines: [{ id: "ln1", name: "Card", amount: 300 }] } },
        goals: [
          {
            id: "gl1",
            name: "Trip",
            target: 1000,
            saved: 10,
            log: [{ id: "ge1", amount: 20, date: isoOffset(-1), note: "x" }],
          },
        ],
      },
      "bills-content": [
        {
          id: "bl1",
          name: "Rent",
          amount: 500,
          due: isoInMonth(2),
          repeat: "monthly",
          link: "https://example.com/pay",
        },
      ],
    };
    const { ctx, page, errors } = await openApp({ query: "?tab=budget", seed });
    await page.evaluate(() => {
      activateTab("budget");
      ["goals-card", "spending-card", "bills-mine", "pay-plan"].forEach((i) => openPinned.add(i));
      openGoals.add("gl1");
      renderBudget();
    });
    check(
      "no inline handlers in the Budget tab",
      await page.evaluate(
        () => !document.querySelector("#panel-budget [onclick], #panel-budget [onerror], #panel-budget [onchange]"),
      ),
    );
    const modalHead = () =>
      page.evaluate(() =>
        document.getElementById("modal-backdrop").classList.contains("open")
          ? document.getElementById("modal-heading").textContent
          : "",
      );
    await page.click('#panel-budget [data-action="plan-line-toggle"]');
    check(
      "plan line check toggles done",
      await page.evaluate((k) => budget.plans["inc1|" + k + "-01"].lines[0].done === true, k),
    );
    await page.click('#panel-budget [data-action="plan-line-toggle"]');
    await page.click('#panel-budget [data-action="plan-line-edit"]');
    check("plan line body opens Edit line", (await modalHead()) === "Edit line");
    await page.evaluate(() => closeModal());
    await page.click('#panel-budget [data-action="plan-line-add"]');
    check("+ Add line opens the sheet", (await modalHead()) === "Add to this paycheck");
    await page.evaluate(() => closeModal());
    await page.click('#panel-budget [data-action="paycheck-edit"]');
    check("paycheck title opens the paycheck editor", (await modalHead()) !== "");
    await page.evaluate(() => closeModal());
    await page.click('#panel-budget [data-action="goal-edit"]');
    check("goal head opens Edit goal", (await modalHead()) === "Edit goal");
    await page.evaluate(() => closeModal());
    await page.click('#panel-budget [data-action="goal-add"][data-entry-id="ge1"]');
    check("goal entry opens Edit entry", (await modalHead()) === "Edit entry");
    await page.evaluate(() => closeModal());
    await page.click("#panel-budget .goal-hist");
    check(
      "goal history toggle collapses and updates aria-expanded",
      await page.evaluate(
        () =>
          !openGoals.has("gl1") &&
          document.querySelector("#panel-budget .goal-hist").getAttribute("aria-expanded") === "false",
      ),
      await page.evaluate(() => [
        [...openGoals],
        [...document.querySelectorAll(".goal-hist")].map((b) => b.getAttribute("aria-expanded")),
      ]),
    );
    await page.click('#panel-budget [data-action="goal-new"]');
    check("New goal sheet offers delegated name ideas", (await modalHead()) === "New goal");
    await page.click('[data-action="goal-idea"][data-idea="1"]');
    check(
      "idea fills the goal name",
      await page.evaluate(() => document.getElementById("modal-name").value === GOAL_IDEAS[1]),
    );
    await page.evaluate(() => closeModal());
    await page.click('#panel-budget [data-action="budget-cat-toggle"]');
    check(
      "category row toggles with aria-expanded",
      await page.evaluate(
        () =>
          openBudgetCats.has("cg") &&
          document.querySelector('[data-action="budget-cat-toggle"]').getAttribute("aria-expanded") === "true",
      ),
    );
    await page.click('#panel-budget [data-action="expense-edit"]');
    check("expense row opens Edit expense", (await modalHead()) === "Edit expense");
    await page.evaluate(() => closeModal());
    const m0 = await page.evaluate(() => budgetMonthOffset);
    await page.click('#panel-budget [data-action="budget-month"][data-delta="1"]');
    check("month arrow shifts the month", await page.evaluate((m) => budgetMonthOffset === m + 1, m0));
    await page.click('#panel-budget [data-action="budget-month"][data-delta="-1"]');
    await page.click('#panel-budget [data-action="budget-manage-open"]');
    check(
      "Manage opens and its rows are delegated",
      (await modalHead()) === "Manage budget" &&
        (await page.evaluate(
          () =>
            !document.querySelector("#budget-manage [onclick]") &&
            document.querySelectorAll('#budget-manage [data-action="manage-run"]').length >= 5,
        )),
    );
    await page.click('#budget-manage [data-op="accounts"]');
    check("Cards & banks row opens the accounts sheet", (await modalHead()) === "Cards & banks");
    await page.click('.acct-editor [data-action="account-edit"][data-index="1"]');
    check(
      "account pill opens its editor",
      (await modalHead()) === "Edit card or bank" &&
        (await page.evaluate(() => document.getElementById("modal-name").value === "Ally")),
    );
    await page.evaluate(() => closeModal());
    // bill logo error → letter fallback; link click doesn't open the editor
    await page.evaluate(() => {
      closeModal();
      const img = document.createElement("img");
      img.className = "bill-logo";
      img.setAttribute("data-fb", '<span class="bill-logo">R</span>');
      document.getElementById("panel-budget").appendChild(img);
      img.dispatchEvent(new Event("error"));
    });
    check(
      "bill-logo error swaps in the letter fallback",
      await page.evaluate(() => {
        const l = document.querySelector("#panel-budget > span.bill-logo");
        return !!l && l.textContent === "R" && !document.querySelector("#panel-budget > img.bill-logo");
      }),
    );
    await page.evaluate(() => {
      const l = document.querySelector("#panel-budget > span.bill-logo");
      if (l) l.remove();
    });
    await page.click("#panel-budget .btab-name");
    check("bill table row opens Edit bill", (await modalHead()) !== "");
    await page.evaluate(() => closeModal());
    const snap = () =>
      page.evaluate(() =>
        JSON.stringify([
          budget,
          bills,
          billPayments,
          [...openGoals],
          [...openBudgetCats],
          budgetMonthOffset,
          document.getElementById("modal-backdrop").classList.contains("open"),
        ]),
      );
    const before = await snap();
    await fireSynthetic(page, [
      { "data-action": "bill-row-open", "data-mode": "bill", "data-bill-id": "nope" },
      { "data-action": "bill-row-open", "data-mode": "payment", "data-payment-id": "nope" },
      { "data-action": "bill-row-open", "data-mode": "x", "data-bill-id": "bl1" },
      { "data-action": "bill-row-open", "data-mode": "bill", "data-bill-id": "a b" },
      { "data-action": "expense-edit", "data-expense-id": "gone" },
      { "data-action": "budget-cat-toggle", "data-cat-id": "nope" },
      { "data-action": "budget-cat-edit", "data-cat-id": "nope" },
      { "data-action": "account-edit", "data-index": "9" },
      { "data-action": "account-edit", "data-index": "-1" },
      { "data-action": "account-edit", "data-index": "1.5" },
      { "data-action": "budget-select-day", "data-date": "2026-02-30" },
      { "data-action": "budget-cal-open", "data-open": "maybe" },
      { "data-action": "budget-month", "data-delta": "5" },
      { "data-action": "paycheck-edit", "data-src-id": "nope", "data-date": isoOffset(0) },
      { "data-action": "paycheck-received", "data-src-id": "inc1", "data-date": "bad" },
      { "data-action": "plan-line-toggle", "data-plan-key": "inc1|" + k + "-15", "data-line-id": "ln1" },
      { "data-action": "plan-line-toggle", "data-plan-key": "inc1|" + k + "-01", "data-line-id": "x y" },
      { "data-action": "plan-line-edit", "data-plan-key": "nope", "data-line-id": "ln1" },
      { "data-action": "plan-line-add", "data-plan-key": "inc1|2020-01-01" },
      { "data-action": "plan-hint", "data-plan-key": "zzz|" + k + "-01" },
      { "data-action": "manage-run", "data-op": "constructor" },
      { "data-action": "manage-run", "data-op": "edit-income", "data-id": "nope" },
      { "data-action": "goal-edit", "data-goal-id": "nope" },
      { "data-action": "goal-add", "data-goal-id": "gl1", "data-entry-id": "nope" },
      { "data-action": "goal-add", "data-goal-id": "nope" },
      { "data-action": "goal-toggle", "data-goal-id": "nope" },
      { "data-action": "goal-idea", "data-idea": "99" },
    ]);
    check("invalid/stale budget metadata is inert", (await snap()) === before);
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
);
// ---------- Jarvis briefing ----------
function briefingFixture(over = {}) {
  const today = isoOffset(0);
  const meta = { agent: "Weather", model: "claude-haiku-5-5", updatedAt: new Date().toISOString() };
  return {
    version: 1,
    id: `${today}T10:47:00Z`,
    date: today,
    generatedAt: new Date().toISOString(),
    trigger: "schedule",
    headline: "Rain by noon <img src=x onerror=window.__pwned=1>",
    summary: [
      { text: "Light rain by noon; bring a jacket.", source: "weather" },
      { text: "Rent is due Saturday.", source: "jazz" },
      { text: "Bad source falls back", source: "<script>" },
    ],
    summaryBy: "jarvis",
    cards: {
      weather: {
        status: "ok",
        ...meta,
        data: {
          location: "Springfield, IL",
          date: today,
          conditions: "Light rain",
          currentF: 51,
          highF: 69,
          lowF: 49,
          humidityPct: 75,
          rainChanceMax: 60,
          hourlyRain: [
            { hour: 6, chance: 10 },
            { hour: 9, chance: 30 },
            { hour: 12, chance: 60, tempF: 64, conditions: "Light rain" },
          ],
          washDay: true,
          summary: "Light rain by noon.",
          wear: "Rain jacket.",
          washDayNote: "Humid: expect frizz.",
        },
      },
      news: {
        status: "ok",
        ...meta,
        agent: "News",
        data: {
          stories: [
            {
              id: "ai-1",
              topic: "ai",
              title: "Safe story",
              source: "The Verge",
              link: "https://news.google.com/a1",
              published: "",
              summary: "A model did well.",
            },
            {
              id: "ai-2",
              topic: "ai",
              title: "Evil link",
              source: "X",
              link: "javascript:window.__pwned=1",
              published: "",
              summary: "s",
            },
          ],
        },
      },
    },
    notes: [],
    ...over,
  };
}

await section("jarvis: main tab is Jarvis; empty state when not set up; ?tab=jarvis opens it", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=todo" });
  check("headline is To-Do via launch param", (await page.textContent("#headline")) === "To-Do");
  await ctx.close();
  const a = await openApp({ query: "?tab=jarvis" });
  check("?tab=jarvis opens the main tab", (await a.page.textContent("#headline")) === "Home");
  check("empty state shows", (await a.page.textContent("#panel-home .jv-empty")).includes("once Jarvis is set up"));
  check("planner still renders below", await a.page.isVisible("#panel-home .home-cal"));
  check("no JS errors", errors.length === 0 && a.errors.length === 0, [...errors, ...a.errors]);
  await a.ctx.close();
});

await section("jarvis: stored briefing renders escaped, with agent cards and safe links only", async () => {
  const { ctx, page, errors } = await openApp({ seed: { "jarvis-briefing": briefingFixture() } });
  const first = await page.evaluate(() => ({
    newPill: !!document.querySelector(".jv-pill"),
    seen: localStorage.getItem("jarvis-briefing-seen"),
    weatherOpen: !!document.getElementById("jarvis-weather"),
    tile: document.querySelector('.jv-tile[data-go="weather"] .jv-tile-value').textContent,
  }));
  check(
    "weather tile shows high/low; its detail starts closed",
    first.tile === "69° / 49°" && !first.weatherOpen,
    first,
  );
  await page.tap('.jv-sum-drill[data-go="weather"]'); // a Weather line in the briefing drills into Weather
  const r = await page.evaluate(() => ({
    pwned: window.__pwned || 0,
    headline: document.querySelector(".jv-headline").textContent,
    imgs: document.querySelectorAll("#panel-home .jv-card img").length,
    items: [...document.querySelectorAll(".jv-summary li")].map((li) => li.textContent),
    sources: [...document.querySelectorAll(".jv-summary .jv-src")].map((s) => s.className),
    expanded: document.querySelector('.jv-tile[data-go="weather"]').getAttribute("aria-expanded"),
    wash: document.querySelector("#jarvis-weather .jv-wash")?.textContent || "",
    hours: [...document.querySelectorAll("#jarvis-weather .jv-hour")].map((h) =>
      h.textContent.replace(/\s+/g, " ").trim(),
    ),
    meta: document.querySelector("#jarvis-weather .jv-meta").textContent,
    links: [...document.querySelectorAll("#jarvis-news a")].map((a) => a.getAttribute("href")),
    titles: [...document.querySelectorAll("#jarvis-news .jv-story-title")].map((t) => t.textContent),
    order: [...document.getElementById("panel-home").children].map((c) => c.className.split(" ")[0]).slice(0, 3),
  }));
  check("headline text is escaped, not markup", r.headline.includes("<img") && r.imgs === 0 && r.pwned === 0, r);
  check("summary items render", r.items.length === 3 && r.items[0].includes("bring a jacket"), r.items);
  check("unknown source falls back to Jarvis", r.sources[2].includes("jv-src-jarvis"), r.sources);
  check("briefing weather line opens the Weather detail", r.expanded === "true", r.expanded);
  check("wash-day note shows", r.wash.includes("frizz"), r.wash);
  check(
    "hour-by-hour list (every third hour, temp and conditions when present)",
    r.hours.length === 3 && r.hours[2] === "12p 64° Light rain 60%" && r.hours[0] === "6a 10%",
    r.hours,
  );
  check("card names its agent", r.meta.startsWith("Weather agent ·"), r.meta);
  check("only the http link is a link", JSON.stringify(r.links) === '["https://news.google.com/a1"]', r.links);
  check("unsafe-link story still shows as text", r.titles.includes("Evil link"), r.titles);
  check(
    "dashboard sits above the planner",
    r.order[0] === "jv-wrap" && r.order[1] === "jv-label" && r.order[2] === "home-cal",
    r.order,
  );
  check("first view shows New and marks it seen", first.newPill && first.seen === briefingFixture().id, first);
  await page.evaluate(() => renderHome());
  check("New goes away after it's been seen", !(await page.$(".jv-pill")));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("jarvis: error cards, stale briefing and junk data", async () => {
  const b = briefingFixture({
    date: isoOffset(-1),
    summaryBy: "fallback",
    notes: ["News didn't finish: timed out after 120s"],
  });
  b.cards.news = {
    status: "error",
    agent: "News",
    model: "m",
    updatedAt: b.generatedAt,
    error: "News didn't finish: timed out",
  };
  b.cards.weather.data.highF = "hot"; // invalid data turns the card into an error, not a crash
  const { ctx, page, errors } = await openApp({ seed: { "jarvis-briefing": b } });
  await page.tap('.jv-tile[data-go="weather"]');
  const r = await page.evaluate(() => ({
    weatherTile: document.querySelector('.jv-tile[data-go="weather"] .jv-tile-sub').textContent,
    when: document.querySelector(".jv-when").textContent,
    stale: document.querySelector(".jv-hero").classList.contains("jv-stale"),
    newsErr: document.querySelector("#jarvis-news .jv-error").textContent,
    newsInsight: document.querySelector("#jarvis-news .insight").textContent,
    weatherErr: document.querySelector("#jarvis-weather .jv-error")?.textContent || "",
    notes: document.querySelector(".jv-notes summary").textContent,
    fallback: document.querySelector(".jv-card > .jv-meta").textContent,
  }));
  check("yesterday's briefing is labeled and dimmed", r.when.startsWith("From ") && r.stale, r);
  check("failed agent shows its error", r.newsErr.includes("timed out") && r.newsInsight === "Unavailable", r);
  check(
    "unreadable card data shows an error",
    r.weatherErr.includes("couldn't be read") && r.weatherTile === "Unavailable",
    r,
  );
  check("notes are listed", r.notes === "1 note", r.notes);
  check("fallback summary is labeled", r.fallback.includes("Assembled automatically"), r.fallback);
  for (const junk of [
    "not json",
    JSON.stringify({ version: 2 }),
    JSON.stringify([1, 2]),
    JSON.stringify({ version: 1, id: "x", date: "nope" }),
  ]) {
    await page.evaluate((j) => {
      localStorage.setItem("jarvis-briefing", j);
      renderHome();
    }, junk);
    check(`junk briefing falls back to the empty state (${junk.slice(0, 20)})`, !!(await page.$(".jv-empty")));
  }
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("jarvis: sync pulls the briefing from the gist, notifies in-app, and never pushes it", async () => {
  const now = Date.now();
  const briefing = briefingFixture();
  const gist = {
    id: "g0",
    files: {
      "jazz2-data.json": { truncated: false, content: JSON.stringify({ updatedAt: now - 1000, data: {} }) },
      "jazz2-briefing.json": { truncated: false, content: JSON.stringify(briefing) },
    },
  };
  const patches = [];
  const route = async (r) => {
    const req = r.request(),
      url = new URL(req.url());
    const json = (status, body) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/gists/g0" && req.method() === "GET") return json(200, gist);
    if (url.pathname === "/gists/g0" && req.method() === "PATCH") {
      const files = JSON.parse(req.postData()).files;
      patches.push(Object.keys(files));
      Object.entries(files).forEach(([n, f]) => (gist.files[n] = { truncated: false, content: f.content }));
      return json(200, gist);
    }
    return json(404, {});
  };
  const { ctx, page, errors } = await openApp({
    route,
    query: "?tab=todo",
    seed: { "sync-token": "tok", "sync-gist-id": "g0", "data-updated-at": String(now) },
  });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({
    stored: JSON.parse(localStorage.getItem("jarvis-briefing") || "null")?.id,
    toast: document.getElementById("toast").textContent,
    dot: document.querySelector('nav.tabbar button[data-tab="home"]').classList.contains("jv-new"),
    inSyncKeys: SYNC_KEYS.includes("jarvis-briefing"),
  }));
  check("briefing stored on this device", r.stored === briefing.id, r);
  check("toast shows Jarvis's headline", r.toast.startsWith("Jarvis: Rain by noon"), r.toast);
  check("tab gets a dot when the briefing arrives off-screen", r.dot, r);
  check("briefing is not a synced list", !r.inSyncKeys);
  await page.tap('nav.tabbar button[data-tab="home"]');
  const seen = await page.evaluate(() => ({
    dot: document.querySelector('nav.tabbar button[data-tab="home"]').classList.contains("jv-new"),
    seen: localStorage.getItem("jarvis-briefing-seen"),
    headline: document.querySelector(".jv-headline")?.textContent || "",
  }));
  check("opening Jarvis clears the dot and marks it seen", !seen.dot && seen.seen === briefing.id, seen);
  check("briefing renders after sync", seen.headline.startsWith("Rain by noon"), seen);
  // an edit pushes jazz2-data.json only
  await page.evaluate(async () => {
    todoList.push({ id: "n1", text: "New", done: false, due: null, starred: false, subitems: [], completedAt: null });
    saveContent("todo-content", todoList, { toast: false });
    await syncNow();
  });
  check(
    "push sends only the app data file",
    patches.length > 0 && patches.every((p) => p.join() === "jazz2-data.json"),
    patches,
  );
  check("gist briefing untouched by the push", gist.files["jazz2-briefing.json"].content === JSON.stringify(briefing));
  // an older briefing never replaces a newer one; the same one doesn't re-announce
  const older = { ...briefing, id: "old", generatedAt: "2000-01-01T00:00:00.000Z" };
  const after = await page.evaluate(async (o) => {
    document.getElementById("toast").textContent = "";
    await ingestBriefingFile({ content: JSON.stringify(o) });
    await ingestBriefingFile({ content: localStorage.getItem("jarvis-briefing") });
    await ingestBriefingFile({ truncated: true, raw_url: "https://evil.example/x" });
    return {
      id: JSON.parse(localStorage.getItem("jarvis-briefing")).id,
      toast: document.getElementById("toast").textContent,
    };
  }, older);
  check(
    "older or repeated briefings are ignored, foreign raw URLs refused",
    after.id === briefing.id && after.toast === "",
    after,
  );
  check(
    "sync payload and backup leave the briefing out",
    !(await page.evaluate(() => JSON.stringify([collectLocal(), liveData()]).includes("Rain by noon"))),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("theme: follows the system, cycles system → light → dark, stays on this device", async () => {
  const { ctx, page, errors } = await openApp();
  const state = () =>
    page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      pref: document.getElementById("theme-btn").dataset.pref,
      label: document.getElementById("theme-btn").getAttribute("aria-label"),
      meta: document.querySelector('meta[name="theme-color"]').getAttribute("content"),
      bg: getComputedStyle(document.body).backgroundColor,
    }));
  await page.emulateMedia({ colorScheme: "light" });
  let s = await state();
  check("system light → light theme", s.theme === "light" && s.pref === "system" && s.meta === "#eef4f8", s);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(100);
  s = await state();
  check("system change is followed live", s.theme === "dark" && s.meta === "#02060b", s);
  await page.tap("#theme-btn");
  s = await state();
  check("first tap pins light", s.theme === "light" && s.pref === "light" && s.label === "Theme: light", s);
  check("light ground is light", s.bg === "rgb(238, 244, 248)", s.bg);
  await page.tap("#theme-btn");
  check("second tap pins dark", (await state()).theme === "dark");
  await page.reload();
  await page.waitForTimeout(400);
  s = await state();
  check("choice survives a reload", s.theme === "dark" && s.pref === "dark" && s.bg === "rgb(2, 6, 11)", s);
  await page.tap("#theme-btn");
  check("third tap goes back to the system", (await state()).pref === "system");
  check(
    "theme choice is not synced or backed up",
    await page.evaluate(
      () => !SYNC_KEYS.includes("theme-pref") && !JSON.stringify([collectLocal(), liveData()]).includes("theme-pref"),
    ),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("home dashboard: tiles drill into details, details into tabs, nothing shown twice", async () => {
  const td = (id, text, due, extra = {}) => ({
    id,
    text,
    done: false,
    due,
    starred: false,
    subitems: [],
    completedAt: null,
    ...extra,
  });
  const briefing = briefingFixture({
    summary: [{ text: "Grab the rain jacket from your list today.", source: "jarvis" }],
  });
  const { ctx, page, errors } = await openApp({
    seed: {
      "jarvis-briefing": briefing,
      "todo-content": [
        td("a", "Today thing", isoOffset(0)),
        td("b", "Late thing", isoOffset(-2)),
        td("c", "Starred today", isoOffset(0), { starred: true }),
        td("d", "Next week", isoOffset(9)),
      ],
      "bills-content": [
        {
          id: "b1",
          name: "Rent",
          amount: 1450,
          due: isoOffset(3),
          repeat: "monthly",
          autopay: false,
          group: "personal",
        },
        { id: "b2", name: "Gym", amount: 30, due: isoOffset(20), repeat: "monthly", autopay: false, group: "personal" },
      ],
      "wants-content": [
        { id: "w1", name: "Rain jacket", kind: "need", price: 120 },
        { id: "w2", name: "Desk lamp", kind: "want", price: 48 },
      ],
      "fitness-content": {
        start: 200,
        goal: 180,
        weights: [
          { id: "x1", date: isoOffset(-30), lbs: 200 },
          { id: "x2", date: isoOffset(-1), lbs: 190 },
        ],
        plan: [],
        checks: {},
      },
    },
  });
  const tiles = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".jv-tile")].map((t) => ({
        go: t.dataset.go,
        value: t.querySelector(".jv-tile-value").textContent,
        open: t.getAttribute("aria-expanded"),
      })),
    );
  const r = await page.evaluate(() => ({
    hello: document.querySelector(".jv-hello").textContent,
    status: document.querySelector(".jv-status").textContent,
    details: document.querySelectorAll(".jv-detail").length,
    oldCards: ["jv-todo", "jv-money", "jv-skin", "jv-jazz3", "jv-shop"].filter((id) => document.getElementById(id)),
  }));
  const t0 = await tiles();
  const needN = await page.evaluate(() => dashShopData().needs.length); // built-in wardrobe needs count too
  check("greeting names Jazz", /^Good (morning|afternoon|evening), Jazz\.$/.test(r.hello), r.hello);
  check(
    "status says when Jarvis briefed (once)",
    r.status.includes("Online") && r.status.includes("Briefed"),
    r.status,
  );
  check(
    "six tiles, one per feed",
    JSON.stringify(t0.map((t) => t.go)) === '["weather","inbox","money","skin","jazz3","shop"]',
    t0,
  );
  check("details start closed and there are no duplicate cards", r.details === 0 && r.oldCards.length === 0, r);
  check("inbox tile says it's not connected yet", t0[1].value === "—", t0);
  const todoRow = await page.evaluate(() => document.querySelector('.jv-day-row[data-go="todo"] b')?.textContent);
  check("Your day counts overdue + today's to-dos", todoRow === "3 to-dos left", todoRow);
  check("money tile totals bills due this week", t0[2].value === "$1,450", t0);
  check("jazz 3.0 tile shows weight-goal progress", t0[4].value === "50%", t0);
  check("shopping tile counts needs", t0[5].value === `${needN} need${needN === 1 ? "" : "s"}`, [t0, needN]);

  // Money: open its detail, pay a bill in place, then drill on to Budget
  await page.tap('.jv-tile[data-go="money"]');
  let m = await page.evaluate(() => ({
    open: [...document.querySelectorAll(".jv-detail")].map((d) => d.id),
    bills: [...document.querySelectorAll("#jv-detail-money .bill-home .title")].map((t) => t.textContent.trim()),
  }));
  check("money tile opens its detail", JSON.stringify(m.open) === '["jv-detail-money"]', m);
  check("money detail: only bills due within 7 days", m.bills.length === 1 && m.bills[0].endsWith("Pay Rent"), m);
  await page.tap('#jv-detail-money .todo-check[aria-label="Mark paid: Rent"]');
  check("bill pays from the detail", await page.evaluate(() => billPayments.some((p) => p.billId === "b1")));

  // one detail at a time; tapping the open tile closes it
  await page.tap('.jv-tile[data-go="skin"]');
  m = await page.evaluate(() => [...document.querySelectorAll(".jv-detail")].map((d) => d.id));
  check("opening another tile closes the first", JSON.stringify(m) === '["jv-detail-skin"]', m);
  const step = await page.evaluate(() => routineForDate(new Date()).am[0].id);
  await page.tap(`#jv-detail-skin .jv-step[data-band="am"][data-step-id="${step}"]`);
  check("routine step ticks from the detail", await page.evaluate((id) => todayChecks().am.includes(id), step));
  await page.tap('.jv-tile[data-go="skin"]');
  check("tapping the open tile closes it", (await page.$$(".jv-detail")).length === 0);

  // Shopping: Jarvis's matching line, tick a need, tap a name to edit it
  await page.tap('.jv-tile[data-go="shop"]');
  const shop = await page.evaluate(() => document.querySelector("#jv-detail-shop .jv-shop-match")?.textContent || "");
  check("shopping detail shows Jarvis's matching line", shop.includes("rain jacket"), shop);
  await page.tap('#jv-detail-shop .jv-shop-name[data-want-id="w1"]');
  check("tapping a need opens its editor", await page.isVisible("#modal-backdrop.open"));
  await page.evaluate(() => closeModal());
  await page.tap('#jv-detail-shop .todo-check[aria-label="Bought: Rain jacket"]');
  check("need ticks off from the detail", await page.evaluate(() => !!wantsState.w1));

  // Jazz 3.0: a goal bar drills into its own card on the Jazz 3.0 tab
  await page.tap('.jv-tile[data-go="jazz3"]');
  const glow = await page.evaluate(() => "p3-" + plan3Slug(plan3Cats()[0]));
  await page.tap(`#jv-detail-jazz3 .jv-goal[data-card="${glow}"]`);
  check(
    "goal bar opens Jazz 3.0 with that section open",
    (await page.textContent("#headline")) === "Jazz 3.0" &&
      (await page.evaluate((id) => document.getElementById(id).classList.contains("open"), glow)),
  );

  // To-Do: its tile goes to the Planner (today's list) rather than repeating it
  await page.evaluate(() => {
    activateTab("home");
    homeDate = addDaysIso(3);
    renderHome();
  });
  await page.tap('.jv-day-row[data-go="todo"]');
  check("the to-do row shows today in the Planner", await page.evaluate(() => homeDate === null));

  // forged targets do nothing
  await page.evaluate(() => {
    dashDrill("constructor");
    dashGo("nope");
    dashGo("jazz3", "../x");
  });
  check("unknown drill targets are inert", (await page.textContent("#headline")) === "Jazz 3.0");
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("home quick wins: quick add, evening Tomorrow view, icon badge, pull to sync", async () => {
  const tomorrowIso = isoOffset(1);
  const b = briefingFixture();
  b.cards.weather.data.tomorrow = {
    date: tomorrowIso,
    conditions: "Partly cloudy",
    highF: 72,
    lowF: 52,
    rainChanceMax: 20,
  };
  const { ctx, page, errors } = await openApp({
    seed: {
      "jarvis-briefing": b,
      "todo-content": [
        {
          id: "late",
          text: "Late one",
          done: false,
          due: isoOffset(-1),
          starred: false,
          subitems: [],
          completedAt: null,
        },
        {
          id: "tm",
          text: "Oil change",
          done: false,
          due: tomorrowIso,
          starred: false,
          subitems: [],
          completedAt: null,
        },
      ],
      "bills-content": [
        {
          id: "b1",
          name: "Rent",
          amount: 1450,
          due: tomorrowIso,
          repeat: "monthly",
          autopay: false,
          group: "personal",
        },
        { id: "b2", name: "Gym", amount: 30, due: isoOffset(0), repeat: "monthly", autopay: false, group: "personal" },
      ],
    },
  });

  // quick add: parses the date, clears, keeps focus for the next one
  await page.fill("#jv-quick", "Call mom tomorrow");
  await page.press("#jv-quick", "Enter");
  const added = await page.evaluate(() => ({
    t: todoList.find((t) => t.text === "Call mom"),
    value: document.getElementById("jv-quick").value,
    focused: document.activeElement && document.activeElement.id,
    toast: document.getElementById("toast").textContent,
  }));
  check("quick add parses the date like the + sheet", !!added.t && added.t.due === tomorrowIso, added);
  check("quick add clears and stays ready", added.value === "" && added.focused === "jv-quick", added);
  check("quick add confirms", added.toast.startsWith("Added for"), added.toast);
  const n0 = await page.evaluate(() => todoList.length);
  await page.press("#jv-quick", "Enter");
  check("empty quick add does nothing", (await page.evaluate(() => todoList.length)) === n0);
  await page.fill("#jv-quick", "Draft in progress");
  const kept = await page.evaluate(() => {
    const busy = isEditing();
    renderHome();
    return { busy, value: document.getElementById("jv-quick").value };
  });
  check("sync waits while typing in quick add", kept.busy, kept);
  check("typed text survives a re-render", kept.value === "Draft in progress", kept);
  await page.click(".jv-quick-add");
  check("the + button adds too", await page.evaluate(() => todoList.some((t) => t.text === "Draft in progress")));

  // Tomorrow: evening only, with forecast, to-dos, bills; drills to the Planner
  const tm = await page.evaluate(() => {
    const at = (h) => {
      const d = new Date();
      d.setHours(h, 0, 0, 0);
      return d;
    };
    return { morning: dashTomorrowHtml(loadBriefing(), at(9)), evening: dashTomorrowHtml(loadBriefing(), at(19)) };
  });
  check("no Tomorrow view in the morning", tm.morning === "", tm.morning);
  check(
    "evening Tomorrow view has the forecast, to-dos and bills",
    tm.evening.includes("72° / 52° · Partly cloudy · 20% rain") &&
      tm.evening.includes("Oil change") &&
      tm.evening.includes("Rent $1,450"),
    tm.evening,
  );
  await page.evaluate(() => dashDrill("tomorrow"));
  check("Plan tomorrow opens tomorrow in the Planner", await page.evaluate(() => homeDate === addDaysIso(1)));

  // icon badge: open to-dos for today (incl. overdue) + unpaid bills due today or earlier
  const badge = await page.evaluate(() => {
    window.__badge = [];
    navigator.setAppBadge = (n) => (window.__badge.push(n), Promise.resolve());
    navigator.clearAppBadge = () => (window.__badge.push(0), Promise.resolve());
    dashBadgeShown = -1;
    renderHome();
    renderHome(); // unchanged count isn't sent twice
    return { calls: window.__badge, expected: dashBadgeCount(dashTodoData()) };
  });
  check(
    "app badge shows what still needs you today",
    JSON.stringify(badge.calls) === "[2]" && badge.expected === 2,
    badge,
  );

  // pull to sync: without sync it just redraws
  await page.evaluate(() => refreshData());
  check("refresh without sync says so", (await page.textContent("#toast")) === "Refreshed");
  check("pull label says sync", (await page.textContent("#pull-indicator .pull-label")) === "Pull to sync");
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("loading skeleton shows before the scripts run, then gives way to Home", async () => {
  const html = await readFile(path.join(ROOT, "jazz2.0.html"), "utf8");
  check(
    "the page ships a skeleton in Home, marked busy",
    /id="panel-home" aria-busy="true"/.test(html) && html.includes("sk-tiles"),
  );
  const { ctx, page, errors } = await openApp();
  const r = await page.evaluate(() => ({
    busy: document.getElementById("panel-home").hasAttribute("aria-busy"),
    skeleton: !!document.querySelector("#panel-home .sk"),
    dashboard: !!document.querySelector("#panel-home .jv-wrap"),
  }));
  check("after load the skeleton is replaced by the dashboard", !r.busy && !r.skeleton && r.dashboard, r);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("phase 2 on Home: Your day timeline, Calendar, Deliveries and Inbox", async () => {
  const today = isoOffset(0);
  const meta = (agent) => ({ status: "ok", agent, model: "m", updatedAt: new Date().toISOString() });
  const b = briefingFixture();
  b.cards.calendar = {
    ...meta("Calendar"),
    data: {
      date: today,
      summary: "Busy midday.",
      overlaps: [{ a: "Lunch with Sam", b: "Call with the bank" }],
      events: [
        { title: "Dentist", day: "today", allDay: false, start: "15:00", end: "16:00", location: "Midtown" },
        { title: "Lunch with Sam", day: "today", allDay: false, start: "12:00", end: "13:00", location: "" },
        { title: "Call with the bank", day: "today", allDay: false, start: "12:30", end: "13:00", location: "" },
        {
          title: "<img src=x onerror=window.__pwned=1>",
          day: "today",
          allDay: true,
          start: null,
          end: null,
          location: "",
        },
        { title: "Bad time", day: "today", allDay: false, start: "nope", end: null, location: "" },
        { title: "Oil change", day: "tomorrow", allDay: false, start: "10:00", end: "11:00", location: "" },
      ],
    },
  };
  b.cards.inbox = {
    ...meta("Inbox"),
    data: {
      unread: 14,
      urgent: [{ from: "Bank", summary: "Verify a new card" }],
      needsReply: [{ from: "Sam Lee", summary: "Pick a lunch spot" }],
      bills: [
        {
          payee: "City Power",
          amount: 112.4,
          due: isoOffset(6),
          budgetName: "Power",
          budgetAmount: 100,
          status: "differs",
        },
        { payee: "Verizon", amount: 85, due: null, budgetName: "Phone", budgetAmount: 85, status: "bogus" },
      ],
    },
  };
  b.cards.deliveries = {
    ...meta("Deliveries"),
    data: {
      packages: [
        { item: "Columbia rain jacket", status: "out", eta: today, etaText: "by 8 PM", shoppingMatch: "Rain jacket" },
        { item: "Desk lamp", status: "teleported", eta: "soon", etaText: null, shoppingMatch: null },
      ],
    },
  };
  const { ctx, page, errors } = await openApp({
    seed: { "jarvis-briefing": b, "wants-content": [{ id: "w1", name: "Rain jacket", kind: "need", price: 120 }] },
  });
  const rows = await page.$$eval(".jv-day-row", (els) =>
    els.map((e) => [
      e.dataset.go,
      e.querySelector(".jv-day-time").textContent,
      e.querySelector("b").textContent,
      e.className.includes("warn"),
    ]),
  );
  const timed = rows.filter((r) => r[0] === "calendar").map((r) => r[1] + " " + r[2]);
  check(
    "timeline lists today's events in time order (all-day first), escaped, bad times dropped",
    JSON.stringify(timed) ===
      JSON.stringify([
        "All day <img src=x onerror=window.__pwned=1>",
        "12p Lunch with Sam",
        "12:30p Call with the bank",
        "3p Dentist",
      ]) && !(await page.evaluate(() => window.__pwned)),
    timed,
  );
  check("overlapping events are flagged", rows.filter((r) => r[3] && r[0] === "calendar").length === 2, rows);
  check(
    "rain and the delivery are on the timeline",
    rows.some((r) => r[0] === "weather") && rows.some((r) => r[2] === "Columbia rain jacket arrives"),
    rows,
  );
  check("no 'connect your calendar' once it's connected", !(await page.$(".jv-day-connect")));

  // Calendar detail (agenda list) opens from its chip and from an event row
  await page.tap('.jv-chip-sm[data-go="calendar"]');
  const cal = await page.evaluate(() => {
    const d = document.getElementById("jv-detail-calendar");
    const ev = [...d.querySelectorAll(".jv-cal-ev")];
    return {
      head: d.querySelector(".jv-headline")?.textContent,
      days: [...d.querySelectorAll(".jv-cal-day")].map((e) => [...e.children].map((c) => c.textContent).join(" ")),
      allDay: [...d.querySelectorAll(".jv-cal-allday span")].map((e) => e.textContent),
      timed: ev.map(
        (e) => e.querySelector(".jv-cal-time b").textContent + " " + e.querySelector(".jv-cal-what b").textContent,
      ),
      warn: ev.filter((e) => e.classList.contains("warn") && e.querySelector(".jv-cal-badge.warn")).length,
    };
  });
  check("the summary is the detail's headline, like the Outfit card", cal.head === "Busy midday.", cal);
  check(
    "calendar detail: a header per day with its date and count",
    cal.days.length === 2 && /^Today .*\d+ events$/.test(cal.days[0]) && /^Tomorrow .*1 event$/.test(cal.days[1]),
    cal.days,
  );
  check("all-day events are chips (escaped)", cal.allDay.length === 1 && cal.allDay[0].startsWith("<img"), cal.allDay);
  check(
    "timed events in time order, tomorrow's after today's",
    JSON.stringify(cal.timed) ===
      JSON.stringify(["12p Lunch with Sam", "12:30p Call with the bank", "3p Dentist", "10a Oil change"]),
    cal.timed,
  );
  check("overlapping events get an amber bar and an Overlaps badge", cal.warn === 2, cal);
  await page.tap('.jv-chip-sm[data-go="calendar"]');
  check("tapping again closes it", !(await page.$("#jv-detail-calendar")));

  // Deliveries detail: Mark bought ticks the Shopping item; unknown status/eta are normalized
  await page.tap('.jv-day-row[data-go="deliveries"]');
  const pk = await page.$$eval("#jv-detail-deliveries .jv-pkg", (els) =>
    els.map((e) => [e.querySelector("b").textContent, e.querySelectorAll(".jv-pkg-steps .on").length]),
  );
  check(
    "packages show progress (out = 3 steps, unknown = ordered)",
    JSON.stringify(pk) === '[["Columbia rain jacket",3],["Desk lamp",1]]',
    pk,
  );
  await page.tap('#jv-detail-deliveries [data-action="want-toggle"]');
  check("Mark bought ticks the matching Shopping item", await page.evaluate(() => !!wantsState.w1));

  // Inbox tile + detail: count on the tile only, rows for urgent/reply/bills, Budget mismatch flagged
  const tile = await page.$eval('.jv-tile[data-go="inbox"]', (e) => e.textContent.replace(/\s+/g, " "));
  check(
    "inbox tile shows unread and what needs you",
    tile.includes("14 unread") && tile.includes("1 bill ≠ Budget"),
    tile,
  );
  await page.tap('.jv-tile[data-go="inbox"]');
  const mail = await page.$$eval("#jv-detail-inbox .jv-mail-row", (els) =>
    els.map((e) => e.textContent.replace(/\s+/g, " ").trim()),
  );
  check(
    "inbox detail lists urgent, reply and bills",
    mail.length === 4 && mail[0].startsWith("Urgent") && mail[0].includes("Bank"),
    mail,
  );
  check(
    "a bill that differs from Budget is flagged",
    !!(await page.$('#jv-detail-inbox .jv-chip-sm.warn[data-go="money"]')),
  );
  check(
    "the unread count isn't repeated in the detail",
    !(await page.$eval("#jv-detail-inbox", (e) => /\b14 unread\b|unread\D{0,3}14\b/i.test(e.textContent))),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();

  // not connected: a connect prompt on the timeline and setup steps in the details
  const plain = await openApp({ seed: { "jarvis-briefing": briefingFixture() } });
  check("calendar not connected shows a connect prompt", !!(await plain.page.$(".jv-day-connect")));
  await plain.page.tap(".jv-day-connect");
  check(
    "…which explains the setup",
    (await plain.page.textContent("#jv-detail-calendar")).includes("GOOGLE_CALENDAR_ICS_URL"),
  );
  check("no JS errors (not connected)", plain.errors.length === 0, plain.errors);
  await plain.ctx.close();
});

await section("skin weather: UV with SPF advice and air quality, on Weather and the Skin tile", async () => {
  const b = briefingFixture();
  Object.assign(b.cards.weather.data, { uvMax: 7, uvHigh: { from: 11, to: 15 }, aqi: 42 });
  const { ctx, page, errors } = await openApp({ seed: { "jarvis-briefing": b } });
  const skinSub = await page.$eval('.jv-tile[data-go="skin"] .jv-tile-sub', (e) => e.textContent);
  check("Beauty tile flags a high-UV day", skinSub.includes("UV 7 · SPF"), skinSub);
  await page.tap('.jv-tile[data-go="weather"]');
  const rows = await page.$$eval("#jarvis-weather .jv-skinwx-row", (els) =>
    els.map((e) => e.textContent.replace(/\s+/g, " ").trim()),
  );
  check(
    "Weather detail shows UV with SPF advice and the hours, and air quality",
    rows.length === 2 &&
      rows[0].endsWith("High (7) 11a–3p: SPF 50, reapply every 2 h") &&
      rows[1].endsWith("Good (AQI 42)"),
    rows,
  );
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("jarvis-briefing"));
    Object.assign(raw.cards.weather.data, { uvMax: "lots", uvHigh: { from: "x" }, aqi: -5 });
    localStorage.setItem("jarvis-briefing", JSON.stringify(raw));
    renderHome();
  });
  const junk = await page.$$eval("#jarvis-weather .jv-skinwx-row", (els) => els.map((e) => e.textContent.trim()));
  check(
    "bad UV / AQI values are dropped or clamped, never shown raw",
    junk.length === 1 && junk[0].includes("AQI 0"),
    junk,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("wash-day swap: suggests a drier day, moves the schedule, or keeps today", async () => {
  const routine = {
    am: [],
    pm: [],
    washPm: [{ id: "ws1", label: "Shampoo", product: "x" }],
    wash: { anchor: isoOffset(0), everyDays: 7 },
  };
  const wet = () => {
    const b = briefingFixture();
    Object.assign(b.cards.weather.data, {
      rainChanceMax: 60,
      humidityPct: 78,
      tomorrow: { date: isoOffset(1), conditions: "Clear", highF: 70, lowF: 50, rainChanceMax: 10 },
    });
    return b;
  };
  const { ctx, page, errors } = await openApp({ seed: { "jarvis-briefing": wet(), "skin-routine-content": routine } });
  const head = await page.evaluate(() => {
    // the suggestion is hidden after 9 PM; check its content with a daytime clock
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    return dashWashSwap(loadBriefing(), { skin: dashSkinData() }, d);
  });
  check(
    "suggests moving a rainy, humid wash day to a drier tomorrow",
    !!head && head.why === "60% rain + 78% humidity",
    head,
  );
  const card = await page.$(".jv-suggest");
  if (card && new Date().getHours() < 21) {
    await page.tap('[data-action="jv-wash-move"]');
    const after = await page.evaluate(() => ({
      anchor: skinRoutine.wash.anchor,
      every: skinRoutine.wash.everyDays,
      card: !!document.querySelector(".jv-suggest"),
    }));
    check(
      "Move shifts the schedule to tomorrow, same rhythm",
      after.anchor === isoOffset(1) && after.every === 7 && !after.card,
      after,
    );
  }
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();

  const k = await openApp({ seed: { "jarvis-briefing": wet(), "skin-routine-content": routine } });
  await k.page.evaluate(() => dashWashKeep());
  check(
    "Keep hides it for today",
    !(await k.page.$(".jv-suggest")) &&
      (await k.page.evaluate(() => localStorage.getItem("jv-wash-keep") === addDaysIso(0))),
  );
  await k.ctx.close();

  const dry = wet();
  dry.cards.weather.data.tomorrow.rainChanceMax = 70;
  const n = await openApp({ seed: { "jarvis-briefing": dry, "skin-routine-content": routine } });
  check(
    "no suggestion when tomorrow is wet too",
    !(await n.page.evaluate(() => dashWashSwap(loadBriefing(), { skin: dashSkinData() }))),
  );
  await n.ctx.close();
});

await section("goal of the day: one unfinished item, Done ticks it, Another picks a different one", async () => {
  const { ctx, page, errors } = await openApp({
    seed: {
      "plan3-content": [
        { id: "g1", cat: "Glow", item: "Hand cream", note: "Hand cream" },
        { id: "g2", cat: "Glow", item: "Morning routine", note: "" },
        { id: "g3", cat: "Leadership", item: "Join a speaking club", note: "", done: true },
      ],
    },
  });
  const pick = () => page.evaluate(() => dashGoalOfDay() && dashGoalOfDay().id);
  const first = await pick();
  check("picks an unfinished item", first === "g1" || first === "g2", first);
  const tileSub = await page.$eval('.jv-tile[data-go="jazz3"] .jv-tile-sub', (e) => e.textContent);
  check("the Jazz 3.0 tile names today's goal", tileSub.startsWith("Today: "), tileSub);
  check("the pick is stable on re-render", (await page.evaluate(() => (renderHome(), dashGoalOfDay().id))) === first);
  await page.tap('.jv-tile[data-go="jazz3"]');
  await page.tap('[data-action="jv-goal-another"]');
  const second = await pick();
  check("Another picks a different item", second && second !== first, [first, second]);
  await page.tap(`#jv-detail-jazz3 [data-action="plan3-toggle"][data-plan3-id="${second}"]`);
  check(
    "Done ticks it off in Jazz 3.0",
    await page.evaluate((id) => plan3.find((x) => x.id === id).done === true, second),
  );
  check("the next pick is still unfinished", (await pick()) !== second);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("consistency: last 7 days of routine, workouts and weigh-ins in the Jazz 3.0 detail", async () => {
  const checks = {};
  [-6, -4, -2, -1].forEach((n) => (checks[isoOffset(n)] = { am: [], pm: [], amDone: true, pmDone: true }));
  checks[isoOffset(-3)] = { am: [], pm: [], amDone: true, pmDone: false }; // half a day doesn't count
  const { ctx, page, errors } = await openApp({
    seed: {
      "routine-checks": checks,
      "fitness-content": {
        start: 200,
        goal: 180,
        weights: [{ id: "x1", date: isoOffset(-1), lbs: 190 }],
        plan: [
          {
            id: "wk1",
            name: "Push",
            days: [0, 1, 2, 3, 4, 5, 6],
            every: 1,
            anchor: isoOffset(-30),
            time: "",
            kind: "fitness",
          },
        ],
        checks: { [`${isoOffset(-2)}|wk1`]: true, [`${isoOffset(-1)}|wk1`]: true },
      },
    },
  });
  await page.tap('.jv-tile[data-go="jazz3"]');
  const rows = await page.$$eval("#jv-detail-jazz3 .jv-streak-row", (els) =>
    els.map((e) => [
      e.querySelector(".jv-mini").textContent,
      e.querySelector(".jv-streak-n").textContent,
      e.querySelectorAll("i.on").length,
    ]),
  );
  check("routine counts only days with both AM and PM done", JSON.stringify(rows[0]) === '["Routine","4/7",4]', rows);
  check("workouts count planned vs done", rows[1][0] === "Workout" && rows[1][1] === "2/7", rows);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("coming up: next 14 days of birthdays, car and appointments in the evening view", async () => {
  const td = (id, text, due, kind) => ({
    id,
    text,
    done: false,
    due,
    starred: false,
    subitems: [],
    completedAt: null,
    kind,
  });
  const { ctx, page, errors } = await openApp({
    seed: {
      "todo-content": [
        td("c1", "Mom's birthday", isoOffset(5), "birthday"),
        td("c2", "Oil change", isoOffset(9), "car"),
        td("c3", "Pick up stamps", isoOffset(4), "errand"),
        td("c4", "Sam's birthday", isoOffset(20), "birthday"),
        td("c5", "Dentist", isoOffset(1), "appointment"),
      ],
      "wants-content": [{ id: "w1", name: "Candle gift set", kind: "want", price: 30 }],
    },
  });
  const html = await page.evaluate(() => {
    const d = new Date();
    d.setHours(19, 0, 0, 0);
    return dashTomorrowHtml(loadBriefing(), d);
  });
  check(
    "lists birthdays and car upkeep within 2–14 days",
    html.includes("Mom's birthday") && html.includes("Oil change"),
    html,
  );
  check(
    "leaves out other kinds, tomorrow (already shown) and anything past 14 days",
    !html.includes("Pick up stamps") && !html.includes("Sam's birthday") && (html.match(/Dentist/g) || []).length === 1,
    html,
  );
  check("suggests the gift from Shopping when a birthday is coming", html.includes("Candle gift set"), html);
  check("callouts use the pink style", html.includes('class="jv-coming"'));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("outfit: picked from the saved wardrobe by weather and day", async () => {
  const cap = [
    { id: "t1", title: "Classic Button-Down — white", state: "owned", cat: "Tops" },
    { id: "t2", title: "Basic tank — white", state: "owned", cat: "Tops" },
    { id: "b1", title: "Dark-wash slim jeans", state: "owned", cat: "Bottoms" },
    { id: "b2", title: "Bermuda shorts", state: "owned", cat: "Bottoms" },
    { id: "s1", title: "Black sneakers", state: "owned", cat: "Shoes" },
    { id: "s2", title: "Black Chelsea boots", state: "owned", cat: "Shoes" },
    { id: "p1", title: "Pending pants", state: "pending", cat: "Bottoms" },
  ];
  const b = briefingFixture();
  Object.assign(b.cards.weather.data, { highF: 69, rainChanceMax: 60 });
  const { ctx, page, errors } = await openApp({ seed: { "jarvis-briefing": b, "capsule-content": cap } });
  const pick = (dayOfWeek, high, rain) =>
    page.evaluate(
      ([dow, hi, r]) => {
        const raw = loadBriefing();
        raw.weather.data.highF = hi;
        raw.weather.data.rainChanceMax = r;
        const d = new Date();
        d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7)); // a day with that weekday (same pick rules)
        const o = dashOutfit(raw, d);
        return o && { title: o.title, items: o.items.map((i) => i.id), needsLayer: o.needsLayer };
      },
      [dayOfWeek, high, rain],
    );
  const rainyWeekday = await pick(3, 69, 60);
  check(
    "rainy weekday: button-down, jeans, boots, and a note that there's no rain layer",
    rainyWeekday.title === "Business casual, rain-ready" &&
      JSON.stringify(rainyWeekday.items) === '["t1","b1","s2"]' &&
      rainyWeekday.needsLayer,
    rainyWeekday,
  );
  const hotWeekend = await pick(6, 88, 0);
  check(
    "hot dry weekend: tank, shorts, sneakers",
    hotWeekend.title === "Weekend, warm day" && JSON.stringify(hotWeekend.items) === '["t2","b2","s1"]',
    hotWeekend,
  );
  check("pending items are never picked", !JSON.stringify(hotWeekend).includes("p1"));
  const card = await page.$(".jv-outfit");
  check("the outfit card is on Home", !!card);
  if (card) {
    const rows = await page.$$eval(".jv-outfit-grid .jv-piece", (els) =>
      els.map((e) => e.querySelector(".jv-mini").textContent + " " + e.querySelector("b").textContent),
    );
    check("one labeled tile per piece", rows.length >= 3 && /^Top /.test(rows[0]) && /^Bottom /.test(rows[1]), rows);
    check(
      "each tile has its icon",
      (await page.$$eval(".jv-outfit-grid .jv-piece svg", (els) => els.length)) === rows.length,
    );
    check(
      "Swap sits in the card header, not among the pieces",
      !!(await page.$('.jv-outfit-head [data-action="jv-outfit-swap"]')),
    );
    await page.tap('[data-action="jv-outfit-swap"]');
    check("Swap is remembered for today", await page.evaluate(() => dashOutfitSwapN() === 1));
  }
  await page.evaluate(() => {
    capsule = capsule.filter((i) => i.cat !== "Bottoms");
    renderHome();
  });
  check("no card without at least a top and a bottom", !(await page.$(".jv-outfit")));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("money extras: safe to spend, payday countdown, and bills that aren't on autopay", async () => {
  const { ctx, page, errors } = await openApp({
    seed: {
      "bills-content": [
        {
          id: "m1",
          name: "Rent",
          amount: 1450,
          due: isoOffset(2),
          repeat: "monthly",
          autopay: false,
          group: "personal",
        },
        {
          id: "m2",
          name: "Power",
          amount: 100,
          due: isoOffset(1),
          repeat: "monthly",
          autopay: true,
          group: "personal",
        },
        { id: "m3", name: "Gym", amount: 30, due: isoOffset(6), repeat: "monthly", autopay: false, group: "personal" },
      ],
      "budget-content": {
        categories: [],
        expenses: [],
        accounts: [],
        income: [{ id: "inc1", name: "Paycheck", amount: 2400, start: isoOffset(-6), repeat: "biweekly" }],
        plans: {},
        goals: [],
      },
    },
  });
  const tile = await page.$eval('.jv-tile[data-go="money"]', (e) => ({
    sub: e.querySelector(".jv-tile-sub").textContent,
    warn: e.classList.contains("warn"),
  }));
  check(
    "Money tile calls out a manual bill due within 3 days",
    tile.sub.startsWith("Rent due ") && tile.sub.endsWith("· not autopay") && tile.warn,
    tile,
  );
  await page.tap('.jv-tile[data-go="money"]');
  const d = await page.evaluate(() => ({
    warn: document.querySelector("#jv-detail-money .jv-money-warn")?.textContent || "",
    safe: document.querySelector("#jv-detail-money .jv-safe")?.textContent.replace(/\s+/g, " ").trim() || "",
  }));
  check(
    "the detail warns about it (and not about autopay or later bills)",
    d.warn.includes("Rent ($1,450)") && !d.warn.includes("Power") && !d.warn.includes("Gym"),
    d,
  );
  check(
    "safe to spend counts down to payday",
    d.safe.includes("Safe to spend") && d.safe.includes("until payday in 8 days"),
    d,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("your layout: reorder and hide Home's tiles (this device only)", async () => {
  const { ctx, page, errors } = await openApp();
  const order = () => page.$$eval(".jv-tile", (els) => els.map((e) => e.dataset.go).join(","));
  check("default order", (await order()) === "weather,inbox,money,skin,jazz3,shop", await order());
  await page.tap('[data-action="jv-layout-open"]');
  await page.tap('[data-action="jv-layout-move"][data-go="money"][data-dir="-1"]');
  await page.tap('[data-action="jv-layout-move"][data-go="money"][data-dir="-1"]');
  await page.tap('[data-action="jv-layout-toggle"][data-go="shop"]');
  check("Money moved to the top, Shopping hidden", (await order()) === "money,weather,inbox,skin,jazz3", await order());
  check(
    "the first row can't move up",
    await page.$eval('[data-action="jv-layout-move"][data-go="money"][data-dir="-1"]', (b) => b.disabled),
  );
  await page.reload();
  await page.waitForTimeout(500);
  check("the layout survives a reload", (await order()) === "money,weather,inbox,skin,jazz3", await order());
  await page.evaluate(() => {
    ["money", "weather", "inbox", "skin", "jazz3"].forEach((k) => dashLayoutToggle(k));
    dashLayoutMove("constructor", 1);
    dashLayoutMove("money", 7);
  });
  check("at least one tile always stays", (await order()).split(",").filter(Boolean).length === 1, await order());
  check(
    "the layout isn't synced or backed up",
    await page.evaluate(
      () => !SYNC_KEYS.includes("home-tiles") && !JSON.stringify([collectLocal(), liveData()]).includes("home-tiles"),
    ),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("phone notifications: turning them on saves this phone's push address to the gist", async () => {
  const gist = {
    id: "g0",
    files: {
      "jazz2-data.json": { truncated: false, content: JSON.stringify({ updatedAt: Date.now(), data: {} }) },
      "jazz2-push.json": {
        truncated: false,
        content: JSON.stringify({ subs: [{ endpoint: "https://push.example/old", keys: { p256dh: "k", auth: "a" } }] }),
      },
    },
  };
  const patches = [];
  const route = async (r) => {
    const req = r.request(),
      url = new URL(req.url());
    const json = (status, body) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/gists/g0" && req.method() === "GET") return json(200, gist);
    if (url.pathname === "/gists/g0" && req.method() === "PATCH") {
      const files = JSON.parse(req.postData()).files;
      patches.push(files);
      Object.entries(files).forEach(([n, f]) => (gist.files[n] = { truncated: false, content: f.content }));
      return json(200, gist);
    }
    return json(404, {});
  };
  const { ctx, page, errors } = await openApp({
    route,
    seed: { "sync-token": "tok", "sync-gist-id": "g0", "data-updated-at": String(Date.now()) },
  });
  await page.evaluate(() => {
    // a fake phone: permission granted and a push address from the push service
    Notification.requestPermission = async () => "granted";
    Object.defineProperty(Notification, "permission", { get: () => window.__perm || "default", configurable: true });
    const sub = { toJSON: () => ({ endpoint: "https://push.example/new", keys: { p256dh: "p256", auth: "auth" } }) };
    Object.defineProperty(navigator.serviceWorker, "ready", {
      value: Promise.resolve({ pushManager: { subscribe: async () => ((window.__perm = "granted"), sub) } }),
    });
    renderHome();
  });
  check("the card offers notifications when sync is on", !!(await page.$('[data-action="jv-push-on"]')));
  await page.tap('[data-action="jv-push-on"]');
  await page.waitForTimeout(400);
  const pushPatch = patches.find((f) => f["jazz2-push.json"]);
  check("only the push file is written (never the app data)", !!pushPatch && !pushPatch["jazz2-data.json"], patches);
  const subs = JSON.parse(gist.files["jazz2-push.json"].content).subs.map((x) => x.endpoint);
  check(
    "this phone is added and other phones are kept",
    JSON.stringify(subs) === '["https://push.example/old","https://push.example/new"]',
    subs,
  );
  check("the card goes away once it's on", !(await page.$('[data-action="jv-push-on"]')));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();

  // headless Chrome reports notifications as blocked; pretend this phone hasn't been asked yet
  const unasked = (pg) =>
    pg.evaluate(() => {
      Object.defineProperty(Notification, "permission", { get: () => "default", configurable: true });
      renderHome();
    });
  const card = (pg) => pg.$('[data-action="jv-push-on"]');
  const later = await openApp({ seed: { "sync-token": "tok", "sync-gist-id": "g0" }, route });
  await unasked(later.page);
  check("the card shows before Not now", !!(await card(later.page)));
  await later.page.tap('[data-action="jv-push-later"]');
  check("Not now hides the card on this device", !(await card(later.page)));
  await unasked(later.page);
  check("and it stays hidden (for 2 weeks)", !(await card(later.page)));
  await later.ctx.close();
  const stale = await openApp({
    seed: { "sync-token": "tok", "sync-gist-id": "g0", "push-later": String(Date.now() - 15 * 864e5) },
    route,
  });
  await unasked(stale.page);
  check("the card comes back 2 weeks after Not now", !!(await card(stale.page)));
  await stale.ctx.close();
  const nosync = await openApp();
  await unasked(nosync.page);
  check("no card without sync (there's nowhere to save the address)", !(await card(nosync.page)));
  await nosync.ctx.close();
});

await section("a long notice wraps on a phone instead of running off the screen", async () => {
  const { ctx, page, errors } = await openApp();
  const r = await page.evaluate(() => {
    showToast("Jarvis: Rent ($612.50) is due Sunday and isn't on autopay, so pay it today before the weekend");
    const t = document.getElementById("toast").getBoundingClientRect();
    return { left: t.left, right: t.right, vw: innerWidth, lines: Math.round(t.height / 16) };
  });
  check("the notice stays inside the screen", r.left >= 0 && r.right <= r.vw, r);
  check("and wraps onto more lines", r.lines >= 2, r);
  const short = await page.evaluate(() => {
    showToast("Saved");
    return document.getElementById("toast").getBoundingClientRect().width;
  });
  check("a short notice stays a small pill", short < 120, short);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("phone notifications repair themselves when the phone's push address goes away", async () => {
  const gist = {
    id: "g0",
    files: {
      "jazz2-data.json": { truncated: false, content: JSON.stringify({ updatedAt: Date.now(), data: {} }) },
      "jazz2-push.json": { truncated: false, content: JSON.stringify({ subs: [] }) }, // Jarvis pruned it
    },
  };
  let patches = 0;
  const route = async (r) => {
    const req = r.request(),
      url = new URL(req.url());
    const json = (status, body) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/gists/g0" && req.method() === "GET") return json(200, gist);
    if (url.pathname === "/gists/g0" && req.method() === "PATCH") {
      patches++;
      Object.entries(JSON.parse(req.postData()).files).forEach(
        ([n, f]) => (gist.files[n] = { truncated: false, content: f.content }),
      );
      return json(200, gist);
    }
    return json(404, {});
  };
  const { ctx, page, errors } = await openApp({
    route,
    seed: {
      "sync-token": "tok",
      "sync-gist-id": "g0",
      "data-updated-at": String(Date.now()),
      "push-endpoint": "https://push.example/gone",
    },
  });
  // the phone allowed notifications earlier, but its old push address is gone (reinstalled app)
  await page.evaluate(() => {
    Object.defineProperty(Notification, "permission", { get: () => "granted", configurable: true });
    const sub = { endpoint: "https://push.example/fresh" };
    sub.toJSON = () => ({ endpoint: sub.endpoint, keys: { p256dh: "p256", auth: "auth" } });
    window.__sub = null;
    Object.defineProperty(navigator.serviceWorker, "ready", {
      value: Promise.resolve({
        pushManager: { getSubscription: async () => window.__sub, subscribe: async () => (window.__sub = sub) },
      }),
    });
  });
  await page.evaluate(() => pushCheck());
  const endpoints = () => JSON.parse(gist.files["jazz2-push.json"].content).subs.map((x) => x.endpoint);
  check(
    "a new push address is made and saved",
    JSON.stringify(endpoints()) === '["https://push.example/fresh"]',
    endpoints(),
  );
  check(
    "and remembered on this phone",
    (await page.evaluate(() => localStorage.getItem("push-endpoint"))) === "https://push.example/fresh",
  );
  const n = patches;
  await page.evaluate(() => pushCheck());
  check("no extra gist writes the same day", patches === n, patches);
  // Jarvis dropped it from the gist, but the phone still has it: the next day it's saved again
  gist.files["jazz2-push.json"].content = JSON.stringify({ subs: [] });
  await page.evaluate(() => localStorage.setItem("push-saved", "2000-01-01"));
  await page.evaluate(() => pushCheck());
  check("re-saved once a day, so a dropped address comes back", endpoints().length === 1, endpoints());
  check("no toasts for this background repair", !(await page.$("#toast.show")));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("weight by month: colored by whether it moved toward the goal", async () => {
  const weights = [
    { date: "2026-09-02", lbs: 200 },
    { date: "2026-09-28", lbs: 196 },
    { date: "2026-10-05", lbs: 194 },
    { date: "2026-10-26", lbs: 196 },
  ];
  const tones = async (fit) => {
    const { ctx, page } = await openApp({ seed: { "fitness-content": fit } });
    await page.evaluate(() => activateTab("jazz3"));
    const t = await page.$$eval(".weight-months span[class]", (els) => els.map((e) => e.className));
    await ctx.close();
    return t;
  };
  const losing = await tones({ start: 200, goal: 180, weights, plan: [], checks: {} });
  check(
    "losing toward a lower goal is good; a gain month is muted",
    JSON.stringify(losing) === '["wm-away","wm-toward"]',
    losing,
  );
  const gaining = await tones({ start: 200, goal: 210, weights, plan: [], checks: {} });
  check("with a higher goal it's the other way round", JSON.stringify(gaining) === '["wm-toward","wm-away"]', gaining);
  const none = await tones({ start: null, goal: null, weights, plan: [], checks: {} });
  check("no goal: plain up/down colors", JSON.stringify(none) === '["wm-up","wm-down"]', none);
});

await section("shopping: a tick box marks an item bought, like to-dos", async () => {
  const { ctx, page, errors } = await openApp({
    seed: { "wants-content": [{ id: "w1", name: "Shampoo", kind: "need", price: 18 }] },
  });
  await page.evaluate(() => activateTab("wants"));
  const box = '#wants-pending-card .want-card .todo-check[role="checkbox"]';
  check("each row leads with an unticked box", (await page.getAttribute(box, "aria-checked")) === "false");
  check("no Mark bought button anymore", !(await page.$("#wants-panel .toggle, #panel-wants .toggle")));
  check("Later is still on the row", !!(await page.$('#wants-pending-card [data-action="want-later"]')));
  await page.click(box);
  const bought = '#wants-purchased-card .want-card.bought .todo-check[aria-checked="true"]';
  check(
    "ticking moves it to Purchased, ticked",
    (await page.evaluate(() => !!wantsState.w1)) && !!(await page.$(bought)),
  );
  check("no Later on a bought item", !(await page.$('#wants-purchased-card [data-action="want-later"]')));
  // the folded Purchased card sits low on the page, under the tab bar and the Undo notice
  await page.$eval(bought, (e) => e.click());
  check("unticking puts it back", await page.evaluate(() => !wantsState.w1));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

// ---- Home polish: placeholder, briefing rows, card spacing, outfit title, news source + Read ----
function homePolishSeed() {
  const meta = (agent) => ({ status: "ok", agent, model: "m", updatedAt: new Date().toISOString() });
  const b = briefingFixture({
    summary: [
      { text: "Light rain by noon; bring a jacket.", source: "weather" },
      { text: "Rent is due Saturday and isn't on autopay, so pay it before the weekend gets busy.", source: "jazz" },
      { text: "Sample headline: new reasoning models raise the bar on coding benchmarks.", source: "news" },
    ],
  });
  b.cards.calendar = {
    ...meta("Calendar"),
    data: {
      date: isoOffset(0),
      summary: "Busy midday.",
      overlaps: [],
      events: [{ title: "Lunch", day: "today", allDay: false, start: "12:00", end: "13:00", location: "" }],
    },
  };
  b.cards.deliveries = {
    ...meta("Deliveries"),
    data: {
      packages: [{ item: "Desk lamp", status: "shipped", eta: isoOffset(2), etaText: null, shoppingMatch: null }],
    },
  };
  b.cards.news.data.stories.push({
    id: "cars-1",
    topic: "cars",
    title: "A story from a source with a very long name",
    source: "The Extremely Long Automotive News And Reviews Network Of America",
    link: "https://example.com/cars",
    published: "",
    summary: "s",
  });
  const cap = [
    { id: "t1", title: "Classic Button-Down — white", state: "owned", cat: "Tops" },
    { id: "b1", title: "Dark-wash slim jeans", state: "owned", cat: "Bottoms" },
    { id: "s2", title: "Black Chelsea boots", state: "owned", cat: "Shoes" },
  ];
  return { "jarvis-briefing": b, "capsule-content": cap };
}

await section("home polish: quick add says plainly what it does", async () => {
  const { ctx, page, errors } = await openApp({ seed: homePolishSeed() });
  const q = await page.evaluate(() => {
    const el = document.getElementById("jv-quick");
    return { ph: el.getAttribute("placeholder"), label: el.getAttribute("aria-label") };
  });
  check("placeholder is a short 'Add a to-do'", q.ph === "Add a to-do", q);
  check("accessible label is kept", q.label === "Quick add a to-do", q);
  // the date words still parse even though the placeholder no longer advertises them
  await page.fill("#jv-quick", "call mom tomorrow");
  await page.tap('[data-action="jv-quick-add"]');
  const t = await page.evaluate(() => todoList.find((x) => x.text === "call mom"));
  const tomorrow = await page.evaluate(() => addDaysIso(1));
  check("'tomorrow' still sets the due date", !!t && t.due === tomorrow, t);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("home polish: briefing items are divided rows, tag on the first line", async () => {
  const { ctx, page, errors } = await openApp({ seed: homePolishSeed() });
  const r = await page.evaluate(() => {
    const hl = document.querySelector(".jv-hero .jv-headline").getBoundingClientRect();
    const lis = [...document.querySelectorAll(".jv-hero .jv-summary > li")];
    return {
      headlineBottom: hl.bottom,
      rows: lis.map((li) => {
        const row = li.matches(".jv-sum-row") ? li : li.querySelector(".jv-sum-row");
        const box = row.getBoundingClientRect();
        const src = row.querySelector(".jv-src").getBoundingClientRect();
        const txt = row.querySelector(".jv-sum-text");
        const range = document.createRange();
        range.selectNodeContents(txt);
        const lines = [...range.getClientRects()];
        const cue = row.querySelector(".jv-sum-cue");
        const c = cue && cue.getBoundingClientRect();
        return {
          border: getComputedStyle(li).borderTopWidth,
          top: box.top,
          bottom: box.bottom,
          height: box.height,
          srcMid: (src.top + src.bottom) / 2,
          line1: [lines[0].top, lines[0].bottom],
          lineCount: new Set(lines.map((l) => Math.round(l.top))).size,
          txtTop: txt.getBoundingClientRect().top,
          txtBottom: txt.getBoundingClientRect().bottom,
          cue: c && { top: c.top, bottom: c.bottom },
          drill: row.matches("button"),
        };
      }),
    };
  });
  check("three rows, each with a divider rule", r.rows.length === 3 && r.rows.every((x) => x.border === "1px"), r.rows);
  check("the list sits clearly below the headline", r.rows[0].top - r.headlineBottom >= 10, r);
  check(
    "each tag lines up with its first text line",
    r.rows.every((x) => x.srcMid >= x.line1[0] && x.srcMid <= x.line1[1]),
    r.rows,
  );
  check(
    "rows don't overlap and are padded",
    r.rows.every((x, i) => i === 0 || x.top >= r.rows[i - 1].bottom) && r.rows[0].txtTop - r.rows[0].top >= 10,
    r.rows,
  );
  check(
    "long items wrap inside their row",
    r.rows[1].lineCount >= 2 && r.rows[1].txtBottom <= r.rows[1].bottom,
    r.rows[1],
  );
  const drills = r.rows.filter((x) => x.drill);
  check(
    "every row drills (weather, Budget, news), with the › on the row (not wrapped below) and a 44px target",
    drills.length === 3 &&
      drills.every((x) => x.cue && x.cue.top < x.txtBottom && x.cue.bottom > x.txtTop && x.height >= 44),
    drills,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("home polish: open details keep the same 12px gap as every Home card", async () => {
  const { ctx, page, errors } = await openApp({ seed: homePolishSeed() });
  const gap = (a, b) =>
    page.evaluate(
      ([a, b]) => {
        const x = document.querySelector(a);
        const y = document.querySelector(b);
        return x && y ? Math.round(y.getBoundingClientRect().top - x.getBoundingClientRect().bottom) : null;
      },
      [a, b],
    );
  check("Your day → Outfit: 12px", (await gap(".jv-day", ".jv-outfit")) === 12, await gap(".jv-day", ".jv-outfit"));
  for (const go of ["calendar", "deliveries"]) {
    await page.tap(`.jv-label [data-go="${go}"]`);
    const above = await gap(".jv-day", `#jv-detail-${go}`);
    const below = await gap(`#jv-detail-${go}`, ".jv-outfit");
    check(`${go} detail: 12px from Your day and 12px above Outfit`, above === 12 && below === 12, { above, below });
    await page.tap(`.jv-label [data-go="${go}"]`);
  }
  check(
    "Systems tiles → News: 12px",
    (await gap(".jv-tiles", "#jarvis-news")) === 12,
    await gap(".jv-tiles", "#jarvis-news"),
  );
  await page.tap('.jv-tile[data-go="money"]');
  const t = await page.evaluate(() => {
    const d = document.getElementById("jv-detail-money");
    const tile = document.querySelector('.jv-tile[data-go="money"]').getBoundingClientRect();
    const r = d.getBoundingClientRect();
    // dense flow backfills the neighbour tile beside the opened one, so look for what sits below
    const below = [...document.querySelectorAll(".jv-tiles > *, #jarvis-news")]
      .map((e) => Math.round(e.getBoundingClientRect().top - r.bottom))
      .filter((g) => g >= 0);
    return { above: Math.round(r.top - tile.bottom), below: Math.min(...below) };
  });
  check("a Systems tile detail: 12px above and below, like the tiles", t.above === 12 && t.below === 12, t);
  await page.tap('.jv-tile[data-go="money"]');
  await page.tap('[data-action="jv-layout-open"]');
  check(
    "Customize panel → tiles: 12px",
    (await gap(".jv-layout", ".jv-tiles")) === 12,
    await gap(".jv-layout", ".jv-tiles"),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("home polish: the outfit title is spaced from its pieces", async () => {
  const { ctx, page, errors } = await openApp({ seed: homePolishSeed() });
  const o = await page.evaluate(() => {
    const h = document.querySelector(".jv-outfit .jv-headline");
    const ctx = document.querySelector(".jv-outfit .jv-ctx");
    const tile = document.querySelector(".jv-outfit-grid .jv-piece");
    return {
      ctxGap: ctx.getBoundingClientRect().top - h.getBoundingClientRect().bottom,
      tileGap: tile.getBoundingClientRect().top - ctx.getBoundingClientRect().bottom,
      hSize: parseFloat(getComputedStyle(h).fontSize),
      rowSize: parseFloat(getComputedStyle(tile.querySelector("b")).fontSize),
    };
  });
  check("the context chips sit clear of the title", o.ctxGap >= 8, o);
  check("the pieces sit clear of the chips", o.tileGap >= 12, o);
  check("title outranks the pieces", o.hSize >= o.rowSize + 4, o);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("home polish: news shows 'topic · source' and one safe Read link per story", async () => {
  const { ctx, page, errors } = await openApp({ seed: homePolishSeed() });
  const n = await page.evaluate(() => {
    const card = document.getElementById("jarvis-news").getBoundingClientRect();
    return [...document.querySelectorAll("#jarvis-news .jv-story")].map((s) => {
      const head = s.querySelector(".jv-story-head");
      const a = s.querySelector("a");
      const r = a && a.getBoundingClientRect();
      return {
        topic: head?.querySelector(".jv-story-topic")?.textContent || "",
        src: head?.querySelector(".jv-story-src")?.textContent || "",
        sep: !!head?.querySelector(".jv-story-sep"),
        loneSrc: !!s.querySelector(":scope > .jv-story-src"),
        links: s.querySelectorAll("a").length,
        titleIsLink: !!s.querySelector("a.jv-story-title, .jv-story-title a"),
        href: a && a.getAttribute("href"),
        target: a && a.getAttribute("target"),
        rel: a && a.getAttribute("rel"),
        label: a && a.getAttribute("aria-label"),
        text: a && a.textContent.trim(),
        h: r && r.height,
        w: r && r.width,
        inside: !r || r.right <= card.right,
        headFits: head ? head.scrollWidth <= head.clientWidth : true,
      };
    });
  });
  const [safe, evil, long] = n;
  check(
    "the source sits next to the topic label",
    safe.topic === "ai" && safe.src === "The Verge" && safe.sep && !n.some((x) => x.loneSrc),
    safe,
  );
  check(
    "a link icon per safe story: new tab, noopener noreferrer, labeled, 44px",
    safe.links === 1 &&
      safe.text === "" && // icon only; the aria-label names it
      safe.href === "https://news.google.com/a1" &&
      safe.target === "_blank" &&
      /\bnoopener\b/.test(safe.rel) &&
      /\bnoreferrer\b/.test(safe.rel) &&
      safe.label.includes("Safe story") &&
      safe.label.includes("The Verge") &&
      safe.h >= 44 &&
      safe.w >= 44,
    safe,
  );
  check(
    "the headline is plain text, not a second link",
    n.every((x) => !x.titleIsLink),
    n,
  );
  check("an unsafe link gets no Read link (source still shows)", evil.links === 0 && evil.src === "X", evil);
  check(
    "a long source truncates instead of pushing Read off the card",
    long.inside && long.headFits && long.links === 1,
    long,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await browser.close();
server.close();
console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log("  ✗ " + f));
  process.exit(1);
}
