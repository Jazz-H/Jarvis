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
    for (const tab of ["home", "todo", "console", "skin", "wants", "budget"]) {
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
  check("the header names the Wallet tab", (await page.textContent("#headline")) === "Wallet");
  check(
    "the switch is on Shopping",
    (await page.textContent('#tab-switch .tab-seg[aria-pressed="true"]')).trim() === "Shopping",
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
      "budget-month-open": "1", // the month view (folded under the Budget top) starts open
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
    "nav: Home, To-Do, Console, Wallet, You",
    JSON.stringify(nav) === '["Home","To-Do","Console","Wallet","Glow"]',
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
  check("old closet links land on Shopping", old.panel && old.nav === "wallet" && !old.closet, old);

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
  const { ctx, page, errors } = await openApp({ query: "?tab=budget", seed: { "budget-month-open": "1" } });
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
    "varies and received persist",
    await page.evaluate(() => budget.income[0].varies && budget.plans[`inc-v|${addDaysIso(-28)}`].received === true),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget: long-term goals", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget", seed: { "budget-month-open": "1" } });
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
  const { ctx, page, errors } = await openApp({ query: "?tab=budget", seed: { "budget-month-open": "1" } });
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
      "budget-month-open": "1", // the month view (folded under the Budget top) starts open
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
    order: [...document.querySelectorAll("#panel-jazz3 > [id]")].map((e) => e.id).slice(0, 3).join(),
    tally: !!document.querySelector(".fit-tally"),
    week: document.getElementById("todo-list").textContent.replace(/\s+/g, " "),
    planOnFitness: !!document.querySelector("#panel-jazz3 #fit-plan"),
    plan: document.querySelector("#panel-todo #fit-plan").textContent.replace(/\s+/g, " "),
  }));
  check(
    "Weight card shows now, goal and to go",
    ui.weight.includes("112") && ui.weight.includes("goal 120") && ui.weight.includes("8 to go"),
    ui.weight,
  );
  check("workouts fill the To-Do list on their days", ui.week.includes("Gym A") && ui.week.includes("Walk"), ui.week);
  check(
    "Jazz 3.0 tab: banner, Today, then Weight; no workout tally; plan lives in To-Do",
    ui.order === "j3-today,weight-card,j3-grid" && !ui.tally && !ui.planOnFitness,
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
    "Budget opens in the Wallet tab",
    await page.evaluate(
      () => (
        activateTab("budget"),
        document.getElementById("panel-budget").classList.contains("active") &&
          document.querySelector("nav.tabbar button.active").dataset.tab === "wallet"
      ),
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
      document.querySelector("#panel-jazz3 .j3-areas").textContent.trim(),
      ...[...document.querySelectorAll("#panel-jazz3 .p3-name")].map((e) => e.firstChild.textContent.trim()),
    ],
    glow: document.querySelectorAll("#p3-glow .p3-row").length,
    lead: document.querySelectorAll("#p3-leadership .p3-row").length,
    text: document.getElementById("p3-glow").textContent.replace(/\s+/g, " "),
    insight: document.querySelector("#p3-leadership .p3-ring").textContent,
  }));
  check(
    "sections: Goal areas, then Glow and Leadership",
    JSON.stringify(r.secs) === '["Goal areas","Glow","Leadership"]',
    r.secs,
  );
  check(
    "Glow has 7 items, Leadership 4, with notes",
    r.glow === 7 && r.lead === 4 && r.text.includes("Nightly") && r.insight === "0/4",
    r,
  );
  await page.click('#p3-leadership .todo-check[aria-label="Done: Join a speaking club"]');
  check(
    "ticking an item marks it done",
    await page.evaluate(
      () =>
        plan3.find((x) => x.item === "Join a speaking club").done === true &&
        document.querySelector("#p3-leadership .p3-ring").textContent === "1/4" &&
        document.querySelector("#p3-leadership .p3-name i").textContent === "Next: Blazer",
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

await section("Console orb stands out; Jazz 3.0 banner", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=home" });
  check(
    "the Console nav button has its orb even when inactive",
    await page.evaluate(() => {
      const b = document.querySelector('nav.tabbar button[data-tab="console"]');
      return (
        !b.classList.contains("active") && !!b.querySelector(".orb-core svg") && b.textContent.trim() === "Console"
      );
    }),
  );
  await page.evaluate(() => activateTab("jazz3"));
  await page.evaluate(() => {
    fitness.start = 115;
    fitness.goal = 130;
    fitness.weights = [{ id: "w1", date: "2026-01-05", lbs: 125.8 }];
    openPinned.delete("p3-leadership");
    renderFitness();
  });
  check(
    "banner counts goal steps done",
    await page.evaluate(() => {
      plan3[0].done = true;
      renderFitness();
      const h = document.querySelector("#panel-jazz3 .j3-hero");
      return h.textContent.includes("1 of 11 steps done") && h.querySelector(".progress-fill").style.width === "9%";
    }),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Briefing: suggested to-dos and Bill Guard", async () => {
  const b = briefingFixture({
    suggestions: [
      { text: "Pay Rent", due: isoOffset(2) },
      { text: "<img src=x onerror=window.__pwned=1>", due: "not-a-date" },
      { text: "", due: null },
      { text: "Fourth", due: null },
      { text: "Fifth", due: null },
    ],
  });
  b.summary.push({ text: "Bills before payday are $40 more than your paycheck.", source: "money" });
  b.cards.money = {
    status: "ok",
    agent: "Bill Guard",
    model: "code",
    updatedAt: b.generatedAt,
    data: {
      period: null,
      guard: [
        { reason: "short", name: "Bills before payday", amount: 40, due: isoOffset(9), budgetAmount: null },
        { reason: "differs", name: "Electric <b>x</b>", amount: 142, due: null, budgetAmount: 110 },
        { reason: "not-in-budget", name: "Spotify", amount: 12, due: null, budgetAmount: null },
        { reason: "manual", name: "Rent", amount: 1450, due: isoOffset(1), budgetAmount: null },
        { reason: "nope", name: "Junk", amount: 1, due: null, budgetAmount: null },
      ],
      overspent: [{ name: "Dining out", spent: 150.5, limit: 100 }],
    },
  };
  const { ctx, page, errors } = await openApp({ seed: { "jarvis-briefing": b } });
  const r = await page.evaluate(() => ({
    chips: [...document.querySelectorAll(".jv-suggest .rv-chip")].map((c) => c.textContent.replace(/\s+/g, " ").trim()),
    tag: [...document.querySelectorAll(".jv-hero .jv-src")].map((x) => x.textContent).pop(),
    pwned: !!window.__pwned,
  }));
  check("suggested to-dos show as chips (at most 3, blanks dropped)", r.chips.length === 3, r.chips);
  check("unsafe suggestion text is shown as text", r.chips[1].includes("<img") && !r.pwned, r.chips);
  check("Bill Guard items are tagged Bill Guard", r.tag === "Bill Guard", r.tag);
  const n0 = await page.evaluate(() => todoList.length);
  await page.click('.jv-suggest .rv-chip[data-index="0"]');
  check(
    "tapping a chip adds the to-do with its due date",
    await page.evaluate(
      (n) => todoList.length === n + 1 && todoList.some((t) => t.text === "Pay Rent" && t.due === addDaysIso(2)),
      n0,
    ),
  );
  check(
    "the chip then reads Added, and a second tap adds nothing",
    await page.evaluate(() => document.querySelector('.jv-suggest .rv-chip[data-index="0"]').classList.contains("added")),
  );
  await page.evaluate(() => document.getElementById("toast").querySelector("button")?.click());
  check(
    "Undo removes it again",
    await page.evaluate((n) => todoList.length === n && !todoList.some((t) => t.text === "Pay Rent"), n0),
  );
  await page.tap('.jv-tile[data-go="money"]');
  const guard = await page.evaluate(() =>
    [...document.querySelectorAll("#jv-detail-money .jv-guard li")].map((li) => li.textContent),
  );
  check(
    "Money detail lists Bill Guard's findings (not the bills Budget already shows)",
    JSON.stringify(guard) ===
      JSON.stringify([
        "Bills due before payday are $40 more than your paycheck.",
        "Electric <b>x</b>: the email says $142, Budget says $110.",
        "Spotify ($12) emailed a bill that isn't in Budget.",
        "Dining out: $150.50 spent of $100 this month.",
      ]),
    guard,
  );
  check(
    "an older briefing's Bill Guard isn't shown",
    await page.evaluate(() => billGuardLines({ ...loadBriefing(), date: addDaysIso(-1) }).length === 0),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Jazz 3.0: Today card, workout streak and the last 4 weeks", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=jazz3" });
  const r = await page.evaluate(() => {
    const all = [0, 1, 2, 3, 4, 5, 6];
    fitness = { start: null, goal: null, weights: [], weighDay: -1, checks: {}, plan: [
      { id: "wo1", name: "Gym", days: all, every: 1, anchor: addDaysIso(-40), time: "07:30", kind: "fitness" },
    ] };
    normalizeFitness();
    // the last 3 days done, 4 days ago missed
    [-1, -2, -3].forEach((n) => (fitness.checks[addDaysIso(n) + "|wo1"] = true));
    routineChecks = {};
    [-1, -2, -5].forEach((n) => (routineChecks[addDaysIso(n)] = { am: [], pm: [], amDone: true, pmDone: true }));
    localStorage.removeItem("jv-goal-skip");
    renderFitness();
    const t = document.getElementById("j3-today");
    return {
      head: t.querySelector(".j3-head").textContent,
      streak: t.querySelector(".j3-streak")?.textContent,
      rows: t.querySelectorAll(".j3-trow").length,
      goal: dashGoalOfDay().item,
      shown: t.querySelector('[data-action="plan3-edit"] b').textContent,
      grid: [...document.querySelectorAll("#j3-grid .j3-grid-row")].map((x) => [
        x.querySelector(".jv-mini").textContent,
        x.querySelectorAll(".j3-cells i").length,
        x.querySelector(".jv-streak-n").textContent,
        x.querySelector(".j3-cells i:last-child").className,
      ]),
      best: document.querySelector("#j3-grid .j3-label span")?.textContent,
    };
  });
  check("Today headline counts workouts and names the goal area", /^1 workout and one step toward \S/.test(r.head), r);
  check("streak counts days in a row with workouts done", r.streak === "3-day streak", r);
  check("Today lists the workout and the goal of the day", r.rows === 2 && r.shown === r.goal, r);
  check(
    "grid: 28 days per row, today outlined until done",
    JSON.stringify(r.grid) === '[["Routine",28,"3/27","wait"],["Workout",28,"3/27","wait"]]',
    r.grid,
  );
  check("grid shows the best streak", r.best === "best streak 3 days", r);
  await page.click('#j3-today [data-action="workout-occ-toggle"]');
  check(
    "ticking today's workout counts it and grows the streak",
    await page.evaluate(
      () =>
        workoutDone(addDaysIso(0), "wo1") &&
        document.querySelector("#j3-today .j3-streak").textContent === "4-day streak" &&
        document.querySelector("#j3-today .j3-head").textContent.startsWith("Workouts done, one step toward") &&
        document.querySelector("#j3-grid .j3-grid-row.warn .j3-cells i:last-child").className === "on",
    ),
  );
  const before = r.goal;
  await page.click('#j3-today [data-action="jv-goal-another"]');
  check(
    "Another swaps the goal step on Jazz 3.0",
    await page.evaluate(
      (b) => {
        const shown = document.querySelector('#j3-today [data-action="plan3-edit"] b').textContent;
        return shown !== b && shown === dashGoalOfDay().item;
      },
      before,
    ),
  );
  check(
    "no Today card and no grid with nothing planned",
    await page.evaluate(() => {
      fitness.plan = [];
      plan3.forEach((x) => (x.done = true));
      skinRoutine.am = [];
      skinRoutine.pm = [];
      renderFitness();
      return !document.getElementById("j3-today") && !document.getElementById("j3-grid");
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
      text: document.getElementById("weight-card").textContent.replace(/\s+/g, " "),
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
      j3WeightMore = true;
      renderFitness();
    });
    check(
      "populated card controls have no inline onclick",
      await page.evaluate(() => document.querySelectorAll("#weight-card [onclick]").length === 0),
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
    await page.click("#weight-card .j3-log");
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
      for (const t of ["home", "todo", "console", "jazz3", "wants", "skin", "budget"]) {
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
      "budget-month-open": "1", // the month view (folded under the Budget top) starts open
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
      "budget-month-open": "1", // the month view (folded under the Budget top) starts open
      "bills-content": [
        {
          id: "lg1",
          name: "Spotify",
          amount: 12,
          due: isoInMonth(1),
          repeat: "monthly",
          autopay: false,
          account: null,
        },
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
  const { ctx, page, errors } = await openApp({ query: "?tab=budget", seed: { "budget-month-open": "1" } });
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
      "budget-month-open": "1", // the month view (folded under the Budget top) starts open
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
await section("jazz 3.0: plan rows, sections and weigh-in rows are delegated and validated", async () => {
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
  await page.evaluate(() => {
    openPinned.delete("p3-glow");
    renderFitness();
    window.__scroll = 0;
  });
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
      "budget-month-open": "1", // the month view (folded under the Budget top) starts open
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
    newsInsight: document.querySelector(".jv-news-label .jv-label-count").textContent,
    weatherErr: document.querySelector("#jarvis-weather .jv-error")?.textContent || "",
    notes: document.querySelector(".jv-notes summary").textContent,
    fallback: document.querySelector(".jv-card > .jv-meta").textContent,
  }));
  check(
    "yesterday's briefing is labeled and dimmed (or flagged late after 8 AM)",
    (new Date().getHours() >= 8 ? r.when.startsWith("Today's briefing hasn't arrived. Showing ") : r.when.startsWith("From ")) && r.stale,
    r,
  );
  check(
    "the late notice turns on at 8 AM",
    await page.evaluate(() => {
      const b = { date: addDaysIso(-1) };
      const at = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return briefingLateHtml(b, d); };
      return at(7).includes("From ") && !at(7).includes("jv-late") && at(8).includes("jv-late") && !briefingLateHtml({ date: addDaysIso(0) }).includes("jv-late");
    }),
  );
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
    "goal bar opens Jazz 3.0 (in You) with that section open",
    (await page.textContent("#headline")) === "Glow" &&
      (await page.evaluate(() => currentTab)) === "jazz3" &&
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
  check(
    "unknown drill targets are inert",
    (await page.textContent("#headline")) === "Glow" && (await page.evaluate(() => currentTab)) === "jazz3",
  );
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
        { item: "Desk lamp", status: "teleported", eta: "soon", etaText: null, shoppingMatch: null, carrier: "UPS <b>" },
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
  check(
    "a package names its carrier (as text)",
    await page.evaluate(() =>
      document.querySelectorAll("#jv-detail-deliveries .jv-pkg-what span")[1].textContent.startsWith("UPS <b> · "),
    ),
  );
  await page.tap('#jv-detail-deliveries [data-action="want-toggle"]');
  check("Mark bought ticks the matching Shopping item", await page.evaluate(() => !!wantsState.w1));

  // Inbox tile + detail: count on the tile only, rows for urgent/reply/bills, Budget mismatch flagged
  const tile = await page.$eval('.jv-tile[data-go="inbox"]', (e) => e.textContent.replace(/\s+/g, " "));
  check(
    "inbox tile shows unread and what needs you",
    tile.includes("14 new") && tile.includes("1 bill ≠ Budget"),
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
    "News has a section label like Systems, 10px above its card",
    (await gap(".jv-news-label", "#jarvis-news")) === 10,
    await gap(".jv-news-label", "#jarvis-news"),
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

await section("undo: survives a quick edit after it and only puts back what was deleted", async () => {
  const todo = (id, text) => ({ id, text, done: false, due: null, starred: false, subitems: [], completedAt: null });
  const { ctx, page, errors } = await openApp({
    seed: { "todo-content": [todo("a", "Alpha"), todo("b", "Bravo"), todo("c", "Charlie")] },
  });
  await page.evaluate(() => {
    activateTab("todo");
    editTodo("b");
  });
  await page.click("#modal-delete-btn");
  check("deleted", await page.evaluate(() => !todoList.some((t) => t.id === "b")));
  // within the undo window: star another to-do and rename a third (each saves)
  await page.evaluate(() => {
    todoList.find((t) => t.id === "a").starred = true;
    saveContent("todo-content", todoList);
    todoList.find((t) => t.id === "c").text = "Charlie 2";
    saveContent("todo-content", todoList);
    renderHome();
  });
  check("the Undo stays on screen after other saves", await page.isVisible(".toast.actionable .toast-action"));
  await page.click(".toast .toast-action");
  const r = await page.evaluate(() => todoList.map((t) => `${t.id}:${t.text}:${t.starred}`));
  check(
    "undo brings the deleted to-do back in its place and keeps the star and rename",
    JSON.stringify(r) === '["a:Alpha:true","b:Bravo:false","c:Charlie 2:false"]',
    r,
  );
  check("undo is saved", await page.evaluate(() => JSON.parse(localStorage.getItem("todo-content")).length === 3));
  // the window: 8 seconds, paused while hovered
  await page.evaluate(() => {
    editTodo("c");
  });
  await page.click("#modal-delete-btn");
  await page.hover(".toast.actionable");
  await page.waitForTimeout(8600);
  check("hovering keeps the Undo open past 8 s", await page.isVisible(".toast.actionable"));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(8300);
  check("it closes 8 s after the pointer leaves", !(await page.isVisible(".toast.actionable")));
  check(
    "errors still show over an Undo",
    await page.evaluate(() => {
      showUndoToast("Deleted", () => {});
      showToast("Save failed", true);
      return document.getElementById("toast").textContent === "Save failed";
    }),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("sync: both devices changed the same list → merged item by item", async () => {
  const t = (id, extra = {}) => ({
    id,
    text: id,
    done: false,
    due: null,
    starred: false,
    subitems: [],
    completedAt: null,
    ...extra,
  });
  const { ctx: c0, page: p0 } = await openApp();
  const m = await p0.evaluate(() => {
    const b = [
      { id: "a", v: 1 },
      { id: "b", v: 1 },
      { id: "c", v: 1 },
    ];
    const l = [
      { id: "a", v: 2 },
      { id: "b", v: 1 },
      { id: "c", v: 1 },
      { id: "n", v: 1 },
    ]; // edited a, added n
    const r = [
      { id: "a", v: 1 },
      { id: "x", v: 1 },
      { id: "b", v: 3 },
    ]; // deleted c, added x after a, edited b
    const both = mergeLists([{ id: "a", v: 1 }], [{ id: "a", v: 2 }], [{ id: "a", v: 3 }]);
    const flags = mergeLists({ p: 1, q: 1 }, { p: 2, q: 1 }, { p: 1, q: 1, z: 1 });
    return { list: mergeLists(b, l, r), both, flags, odd: mergeLists("x", "y", "z") };
  });
  check(
    "lists: both sides' adds, their delete and edit, my edit",
    JSON.stringify(m.list) ===
      JSON.stringify([
        { id: "a", v: 2 },
        { id: "x", v: 1 },
        { id: "b", v: 3 },
        { id: "n", v: 1 },
      ]),
    m.list,
  );
  check("the same item edited on both: this device wins", m.both[0].v === 2, m.both);
  check("flag maps merge per field", JSON.stringify(m.flags) === '{"p":2,"q":1,"z":1}', m.flags);
  check("anything else: this device wins", m.odd === "y", m.odd);
  await c0.close();

  // end to end: added a to-do here while the other device ticked a different one
  const base = [t("a"), t("b")];
  const gist = {
    id: "g0",
    files: {
      "jazz2-data.json": {
        truncated: false,
        content: JSON.stringify({ updatedAt: Date.now(), data: { "todo-content": [t("a", { done: true }), t("b")] } }),
      },
    },
  };
  let sent = null;
  const route = async (r) => {
    const req = r.request(),
      url = new URL(req.url());
    const json = (status, body) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/gists/g0" && req.method() === "GET") return json(200, gist);
    if (url.pathname === "/gists/g0" && req.method() === "PATCH") {
      sent = JSON.parse(JSON.parse(req.postData()).files["jazz2-data.json"].content).data;
      gist.files["jazz2-data.json"].content = JSON.stringify({ updatedAt: Date.now(), data: sent });
      return json(200, gist);
    }
    return json(404, {});
  };
  const { ctx, page, errors } = await openApp({
    route,
    seed: {
      "sync-token": "tok",
      "sync-gist-id": "g0",
      "todo-content": [...base, t("c")],
      "sync-base": JSON.stringify({ "todo-content": JSON.stringify(base) }),
      "data-updated-at": String(Date.now()),
    },
  });
  await page.evaluate(() => syncNow());
  const here = await page.evaluate(() => todoList.map((x) => `${x.id}${x.done ? "✓" : ""}`));
  check("this device keeps its new to-do and gets the other's tick", JSON.stringify(here) === '["a✓","b","c"]', here);
  check(
    "and the gist gets both",
    !!sent && JSON.stringify(sent["todo-content"].map((x) => `${x.id}${x.done ? "✓" : ""}`)) === '["a✓","b","c"]',
    sent && sent["todo-content"],
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("keyboard: closed sheets are out of reach; rows and card headers work with Enter/Space", async () => {
  const todo = (id, text) => ({ id, text, done: false, due: null, starred: false, subitems: [], completedAt: null });
  const { ctx, page, errors } = await openApp({ seed: { "todo-content": [todo("a", "Alpha"), todo("b", "Bravo")] } });
  await page.evaluate(() => activateTab("todo"));
  const inert = await page.evaluate(() => ({
    composer: document.getElementById("composer").inert,
    modal: document.getElementById("modal-backdrop").inert,
    main: document.querySelector("main").inert,
  }));
  check("closed sheets are inert, the page isn't", inert.composer && inert.modal && !inert.main, inert);
  // Tab through the whole page: never lands in a closed sheet
  const landed = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    landed.push(await page.evaluate(() => !!document.activeElement.closest("#composer, #modal-backdrop")));
  }
  check("Tab never reaches the closed composer or edit form", !landed.some(Boolean));
  // Enter on a to-do's text opens its editor, and the page behind goes inert
  await page.focus('#panel-todo [data-action="home-todo-edit"][data-todo-id="a"]');
  await page.keyboard.press("Enter");
  const open = await page.evaluate(() => ({
    open: document.getElementById("modal-backdrop").classList.contains("open"),
    modalInert: document.getElementById("modal-backdrop").inert,
    mainInert: document.querySelector("main").inert,
  }));
  check(
    "Enter on a to-do opens its editor; only the editor is reachable",
    open.open && !open.modalInert && open.mainInert,
    open,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  check("closing it makes the page reachable again", await page.evaluate(() => !document.querySelector("main").inert));
  // a card header toggles with Space and reports its state
  const head = "#panel-todo .card.pinned .coll-head";
  const before = await page.getAttribute(head, "aria-expanded");
  await page.focus(head);
  await page.keyboard.press(" ");
  const after = await page.getAttribute(head, "aria-expanded");
  check(
    "Space toggles a card header and aria-expanded follows",
    before !== after && ["true", "false"].includes(after),
    {
      before,
      after,
    },
  );
  // starring with the keyboard keeps focus on the (redrawn) star
  await page.focus('#panel-todo [data-action="todo-star"][data-todo-id="b"]');
  await page.keyboard.press("Enter");
  const f = await page.evaluate(() => ({
    action: document.activeElement.getAttribute("data-action"),
    id: document.activeElement.getAttribute("data-todo-id"),
    starred: todoList.find((t) => t.id === "b").starred,
  }));
  check("focus stays on the star after it redraws", f.starred && f.action === "todo-star" && f.id === "b", f);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Console: tab order, the orb opens Console, one-time tabs-back notice, no + button", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=home" });
  const r = await page.evaluate(() => ({
    order: TAB_ORDER,
    hidden: HIDDEN_TABS,
    nav: [...document.querySelectorAll("nav.tabbar button")].map((b) => b.dataset.tab),
  }));
  check(
    "TAB_ORDER is home, todo, console, wallet, you and matches the bar",
    JSON.stringify(r.order) === '["home","todo","console","wallet","glow"]' &&
      JSON.stringify(r.nav) === JSON.stringify(r.order),
    r,
  );
  check("no tab is hidden any more", r.hidden.length === 0, r.hidden);
  await page.tap('nav.tabbar button[data-tab="console"]');
  const opened = await page.evaluate(() => ({
    tab: currentTab,
    headline: document.getElementById("headline").textContent,
    panel: document.getElementById("panel-console").classList.contains("active"),
    navActive: document.querySelector('nav.tabbar button[data-tab="console"]').getAttribute("aria-current"),
    toast: document.getElementById("toast").textContent,
    shown: document.getElementById("toast").classList.contains("show"),
    flag: localStorage.getItem("tabs-back-seen"),
  }));
  check(
    "the orb opens Console (headline, panel, current tab)",
    opened.tab === "console" && opened.headline === "Console" && opened.panel && opened.navActive === "page",
    opened,
  );
  check(
    "the first tab-bar tap says Budget and Jazz 3.0 are back, and remembers it on this device",
    opened.shown && opened.toast === "Budget and Jazz 3.0 are back: Wallet and Glow" && !!opened.flag,
    opened,
  );
  check("the floating + stays hidden on Console", !(await page.isVisible("#fab")));
  await page.evaluate(() => {
    document.getElementById("toast").textContent = "";
    activateTab("home");
  });
  await page.tap('nav.tabbar button[data-tab="console"]');
  check(
    "the tabs-back notice shows only once",
    !(await page.evaluate(() => document.getElementById("toast").textContent.includes("are back"))),
  );
  // layout: switch, box, one chip row, hint, feed; nothing scrolls sideways at 390px (Capture has the chips)
  await page.tap('.cn-seg[data-mode="capture"]');
  const lay = await page.evaluate(() => {
    const chips = [...document.querySelectorAll("#cn-chips .cn-chip")];
    const row = document.getElementById("cn-chips");
    const order = [".cn-switch", ".cn-box", "#cn-chips", "#cn-hint", "#cn-feed"].map(
      (s) => document.querySelector("#panel-console " + s).getBoundingClientRect().top,
    );
    return {
      width: innerWidth,
      pageW: document.scrollingElement.scrollWidth,
      oneRow: new Set(chips.map((c) => c.offsetTop)).size === 1,
      scrolls: row.scrollWidth > row.clientWidth,
      chipH: Math.min(...chips.map((c) => c.getBoundingClientRect().height)),
      send: document.querySelector(".cn-send").getBoundingClientRect().height,
      segs: [...document.querySelectorAll(".cn-seg")].map((b) => b.getBoundingClientRect().height),
      sorted: order.every((y, i) => i === 0 || y > order[i - 1]),
      label: document.querySelector('label[for="console-input"]').textContent,
      review: document.getElementById("cn-review").innerHTML,
      hook: consoleReviewHtml(),
    };
  });
  check("no sideways page scroll at 390px", lay.width === 390 && lay.pageW <= 390, lay);
  check("suggestions are one swipeable row", lay.oneRow && lay.scrolls, lay);
  check(
    "tap targets: chips ≥36px, send and switch ≥44px",
    lay.chipH >= 36 && lay.send >= 44 && lay.segs.every((h) => h >= 44),
    lay,
  );
  check("top-to-bottom order: switch, box, chips, hint, feed", lay.sorted, lay);
  check("the input is labelled", lay.label.length > 0, lay.label);
  check("the Weekly Review slot renders nothing yet", lay.review === "" && lay.hook === "", lay);
  check("Console no longer has a Jazz 3.0 row (You has the tab)", !(await page.$("#panel-console .cn-j3")));
  check("Console shows no group switch", !(await page.isVisible("#tab-switch")));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Console: every Jazz 3.0 entry point still works", async () => {
  for (const q of ["?tab=jazz3", "?tab=fitness"]) {
    const { ctx, page, errors } = await openApp({ query: q });
    const r = await page.evaluate(() => ({
      tab: currentTab,
      panel: document.getElementById("panel-jazz3").classList.contains("active"),
      weight: !!document.getElementById("weight-card"),
    }));
    check(`${q} opens Jazz 3.0`, r.tab === "jazz3" && r.panel && r.weight, r);
    check(`no JS errors (${q})`, errors.length === 0, errors);
    await ctx.close();
  }
  const { ctx, page, errors } = await openApp({ query: "?tab=home" });
  // Home tile → detail: goal of the day, Last 7 days, and the Open Jazz 3.0 link
  await page.evaluate(() => {
    plan3 = [{ id: "g1", cat: "Glow", item: "Hand cream", note: "", done: false }];
    renderHome();
  });
  await page.tap('.jv-tile[data-go="jazz3"]');
  const det = await page.evaluate(() => {
    const d = document.getElementById("jv-detail-jazz3");
    return {
      goal: !!d.querySelector(".jv-goalday") && d.textContent.includes("Hand cream"),
      last7: d.textContent.includes("Last 7 days"),
      open: !!d.querySelector('[data-action="jv-go"][data-go="jazz3"]:not([data-card])'),
    };
  });
  check("Home's Jazz 3.0 detail still has the goal of the day and Last 7 days", det.goal && det.last7, det);
  await page.tap('#jv-detail-jazz3 [data-action="plan3-toggle"]');
  check("goal of the day Done still ticks the item", await page.evaluate(() => plan3[0].done === true));
  await page.evaluate(() => {
    plan3[0].done = false;
    renderHome();
  });
  if (!(await page.isVisible("#jv-detail-jazz3"))) await page.tap('.jv-tile[data-go="jazz3"]');
  await page.tap('#jv-detail-jazz3 [data-action="jv-go"][data-go="jazz3"]:not([data-card])');
  check(
    "the detail's Open Jazz 3.0 link opens Jazz 3.0 under You",
    (await page.evaluate(() => currentTab)) === "jazz3" && (await page.textContent("#headline")) === "Glow",
  );
  await page.evaluate(() => {
    activateTab("home");
    dashGo("jazz3", "weight-card");
  });
  check(
    'dashGo("jazz3", "weight-card") lands on the Weight card',
    await page.evaluate(
      () => currentTab === "jazz3" && !!document.querySelector("#panel-jazz3.active #weight-card"),
    ),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
  // #import= jazz3 link still ends on Jazz 3.0
  const hash =
    "#import=" + Buffer.from(JSON.stringify({ app: "jazz3-fitness", start: 100, goal: 120 })).toString("base64url");
  const imp = await openApp({ query: hash });
  await imp.page.waitForTimeout(300);
  check(
    "#import= jazz3-fitness link still opens Jazz 3.0",
    (await imp.page.evaluate(() => [currentTab, fitness.goal].join())) === "jazz3,120",
  );
  check("no JS errors (import)", imp.errors.length === 0, imp.errors);
  await imp.ctx.close();
  // the manifest shortcut still points at a tab that opens
  const manifest = JSON.parse(await readFile(path.join(ROOT, "manifest.json"), "utf8"));
  check(
    "manifest keeps a Jazz 3.0 shortcut (?tab=jazz3)",
    manifest.shortcuts.some((s) => s.url.endsWith("?tab=jazz3")),
  );
});

await section("Console: mode guess, lock until cleared, chips fill the box", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=console" });
  const mode = () =>
    page.evaluate(() => ({
      ask: document.querySelector('.cn-seg[data-mode="ask"]').getAttribute("aria-pressed"),
      cap: document.querySelector('.cn-seg[data-mode="capture"]').getAttribute("aria-pressed"),
      ph: document.getElementById("console-input").placeholder,
      hint: document.getElementById("cn-hint").textContent,
    }));
  let m = await mode();
  check("empty box starts on Ask", m.ask === "true" && m.cap === "false" && m.ph === "Ask Jarvis…", m);
  await page.fill("#console-input", "dentist fri");
  m = await mode();
  check(
    "plain text guesses Capture, with its placeholder and the switched hint",
    m.cap === "true" && m.ask === "false" && /Switched by what you typed/.test(m.hint),
    m,
  );
  await page.fill("#console-input", "what's due this week");
  check("a question word guesses Ask", (await mode()).ask === "true");
  await page.fill("#console-input", "groceries for the week?");
  check("a trailing ? guesses Ask", (await mode()).ask === "true");
  await page.fill("#console-input", "do laundry sat");
  check('"do laundry" is not a question', (await mode()).cap === "true");
  await page.fill("#console-input", "dentist fri / what's due?");
  check("several pieces guess Capture", (await mode()).cap === "true");
  await page.fill("#console-input", "dentist fri");
  await page.tap('.cn-seg[data-mode="ask"]');
  await page.fill("#console-input", "dentist fri and more");
  m = await mode();
  check("tapping the switch locks it while typing", m.ask === "true" && !/Switched/.test(m.hint), m);
  await page.fill("#console-input", "");
  await page.fill("#console-input", "dentist fri");
  check("clearing the box unlocks the guess", (await mode()).cap === "true");
  check(
    "parser helpers guess like the box",
    await page.evaluate(
      () =>
        consoleGuess("") === "ask" &&
        consoleGuess("Can I afford the helmet") === "ask" &&
        consoleGuess("How’s my budget") === "ask" &&
        consoleGuess("helmet $250") === "capture",
    ),
  );
  // chips: different per mode; a tap fills the box
  await page.fill("#console-input", "");
  const askChips = await page.$$eval("#cn-chips .cn-chip", (b) => b.map((x) => x.textContent));
  await page.tap('.cn-seg[data-mode="capture"]');
  const capChips = await page.$$eval("#cn-chips .cn-chip", (b) => b.map((x) => x.textContent));
  check("Ask has no suggestion chips; Capture keeps its examples", askChips.length === 0 && capChips.length >= 3, [
    askChips,
    capChips,
  ]);
  await page.tap('#cn-chips .cn-chip[data-index="1"]');
  check(
    "tapping a chip fills the box (and focuses it)",
    await page.evaluate(
      () =>
        document.getElementById("console-input").value === CONSOLE_MODES.capture.chips[1] &&
        document.activeElement.id === "console-input",
    ),
  );
  check(
    "forged chip metadata does nothing",
    await page.evaluate(() => {
      consoleUseChip("nope", 0);
      consoleUseChip("ask", 99);
      return document.getElementById("console-input").value === CONSOLE_MODES.capture.chips[1];
    }),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Console: capture parsing reuses the app's rules", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=console" });
  const r = await page.evaluate(() => {
    const one = (s) => {
      const row = consoleParse(s)[0];
      const f =
        row.type === "todo"
          ? consoleTodoOf(row)
          : row.type === "shop"
            ? consoleShopOf(row)
            : row.type === "expense"
              ? consoleExpenseOf(row)
              : { text: row.src };
      return { type: row.type, ...f };
    };
    return {
      dump: consoleParse("dentist fri / buy eggs $5 / call mom tomorrow").map((x) => x.type),
      dentist: one("dentist fri"),
      fri: nextWeekdayIso(5),
      mom: one("call mom tomorrow"),
      tomorrow: addDaysIso(1),
      eggs: one("buy eggs $5"),
      helmet: one("helmet $250"),
      need: one("need batteries"),
      haircut: one("get a haircut"),
      rx: one("pick up prescription"),
      getEggs: one("get eggs"),
      rent: one("pay rent $1,200"),
      question: one("what's due friday?"),
      expense: one("groceries $54 spent"),
      spentOn: one("spent $12.50 on lunch"),
      note: one("note: gift ideas for mom"),
      semi: consoleParse("a; b\nc").length,
      slashWord: consoleParse("w/ friends and 1/2 cup").length,
      commas: consoleParse("eggs, milk, and bread").map((x) => [x.type, x.src]),
      buyList: consoleParse("buy eggs, milk, bread").map((x) => x.type),
      longCommas: consoleParse("call mom, tell her about the trip to the beach").length,
      money: consoleParse("helmet $1,250").length,
      bullets: consoleParse("- dentist fri\n* call mom").map((x) => x.src),
      cap: consoleParse(Array.from({ length: 30 }, (_, i) => "item " + i).join(" / ")).length,
    };
  });
  check("a slash dump splits into 3 typed rows", JSON.stringify(r.dump) === '["todo","shop","todo"]', r.dump);
  check(
    "trailing day word sets the date (parseQuickAdd)",
    r.dentist.type === "todo" && r.dentist.text === "dentist" && r.dentist.due === r.fri,
    r.dentist,
  );
  check("tomorrow parses", r.mom.due === r.tomorrow && r.mom.text === "call mom", r.mom);
  check(
    "shopping verb + trailing price → Shopping",
    r.eggs.type === "shop" && r.eggs.text === "eggs" && r.eggs.price === 5,
    r.eggs,
  );
  check("trailing price alone → Shopping (helmet $250)", r.helmet.type === "shop" && r.helmet.price === 250, r.helmet);
  check(
    '"need X" → a Shopping need',
    r.need.type === "shop" && r.need.need === true && r.need.text === "batteries",
    r.need,
  );
  check(
    "get a haircut / pick up prescription stay to-dos (todoKind)",
    r.haircut.type === "todo" && r.rx.type === "todo",
    [r.haircut, r.rx],
  );
  check('"get eggs" is shopping', r.getEggs.type === "shop", r.getEggs);
  check('"pay rent $1,200" is a to-do, not Shopping', r.rent.type === "todo", r.rent);
  check("a question routes to Ask", r.question.type === "ask", r.question);
  check(
    "expenses are recognized as Budget (chip only)",
    r.expense.type === "expense" &&
      r.expense.text === "groceries" &&
      r.expense.amount === 54 &&
      r.spentOn.type === "expense" &&
      r.spentOn.text === "lunch" &&
      r.spentOn.amount === 12.5,
    [r.expense, r.spentOn],
  );
  check(
    "note: → an Anytime to-do",
    r.note.type === "todo" && r.note.text === "gift ideas for mom" && r.note.due === null,
    r.note,
  );
  check("splits on ; and new lines; a bare / inside words doesn't split", r.semi === 3 && r.slashWord === 1, r);
  check(
    "a short comma list splits (and drops the 'and')",
    JSON.stringify(r.commas) === '[["todo","eggs"],["todo","milk"],["todo","bread"]]',
    r.commas,
  );
  check('"buy" carries over a comma list', JSON.stringify(r.buyList) === '["shop","shop","shop"]', r.buyList);
  check("long comma phrases and $1,250 don't split", r.longCommas === 1 && r.money === 1, r);
  check("list bullets are stripped", JSON.stringify(r.bullets) === '["dentist fri","call mom"]', r.bullets);
  check("at most 20 pieces", r.cap === 20, r.cap);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Console: preview, type cycling, Add with one Undo, expense chip only", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=console",
    seed: { "data-updated-at": "111", "todo-content": [], "wants-content": [] },
  });
  const expenses0 = await page.evaluate(() => budget.expenses.length);
  const base = await page.evaluate(() => todoList.length + wantsList.length); // (seeded wardrobe needs migrate in)
  const wants0 = await page.evaluate(() => wantsList.length);
  await page.fill(
    "#console-input",
    "dentist fri / helmet $250 / need batteries / groceries $54 spent / what's due friday?",
  );
  await page.press("#console-input", "Enter");
  const pv = await page.evaluate(() => ({
    rows: [...document.querySelectorAll(".cn-row .cn-tag")].map((t) => t.textContent),
    add: document.getElementById("cn-add").textContent.trim(),
    box: document.getElementById("console-input").value,
    saved: todoList.length + wantsList.length,
    exp: [...document.querySelectorAll(".cn-exp")].map((b) => b.textContent),
  }));
  check(
    "Enter shows a preview, nothing saved yet",
    JSON.stringify(pv.rows) === '["To-do","Shopping","Shopping","Budget","Ask"]' && pv.saved === base && pv.box === "",
    pv,
  );
  check("Add counts only to-dos and Shopping items", pv.add === "Add 3", pv.add);
  check(
    "the expense is offered as a chip",
    pv.exp.length === 1 && /Log groceries \$54\.00 in Budget/.test(pv.exp[0]),
    pv.exp,
  );
  // tap a row to cycle its type: To-do → Shopping → Skip → To-do
  const tag = (i) => page.textContent(`.cn-row[data-index="${i}"] .cn-tag`);
  await page.tap('.cn-row[data-index="0"]');
  const t1 = await tag(0);
  await page.tap('.cn-row[data-index="0"]');
  const t2 = await tag(0);
  await page.tap('.cn-row[data-index="0"]');
  const t3 = await tag(0);
  check("tapping a row cycles To-do → Shopping → Skip → To-do", [t1, t2, t3].join() === "Shopping,Skip,To-do", [
    t1,
    t2,
    t3,
  ]);
  await page.tap('.cn-row[data-index="2"]');
  check(
    "a skipped row leaves the count",
    (await tag(2)) === "Skip" && (await page.textContent("#cn-add")).trim() === "Add 2",
  );
  // Edit puts the text back; send again
  await page.tap('[data-action="console-edit"]');
  check(
    "Edit puts the text back in the box",
    await page.evaluate(
      () => /^dentist fri \/ helmet/.test(document.getElementById("console-input").value) && !consolePreview,
    ),
  );
  await page.tap("#cn-send");
  await page.tap("#cn-add");
  const added = await page.evaluate(
    (wants0) => ({
      todos: todoList.map((t) => [t.text, t.due]),
      wants: wantsList.slice(wants0).map((w) => [w.name, w.price, wantKind(w), !!w.moto, !!w.wardrobeCat]),
      stored:
        JSON.parse(localStorage.getItem("todo-content")).length +
        JSON.parse(localStorage.getItem("wants-content")).length,
      feed: consoleFeed.map((e) => [e.kind, e.todos, e.shop, e.text]),
      toast: document.getElementById("toast").textContent,
      undo: !!document.querySelector("#toast .toast-action"),
      expenses: budget.expenses.length,
      fri: nextWeekdayIso(5),
      html: document.getElementById("cn-feed").textContent,
      box: document.getElementById("console-input").value,
      askMode: document.querySelector('.cn-seg[data-mode="ask"]').getAttribute("aria-pressed"),
    }),
    wants0,
  );
  check(
    "Add saves to-dos and Shopping items (need/want rules) via saveContent",
    added.todos.length === 1 &&
      added.todos[0][0] === "dentist" &&
      added.todos[0][1] === added.fri &&
      JSON.stringify(added.wants) === '[["helmet",250,"want",false,false],["batteries",null,"need",false,false]]' &&
      added.stored === base + 3,
    added,
  );
  check("the expense was not added", added.expenses === expenses0, added.expenses);
  check(
    "feed: the capture is logged; the question goes back in the box for Ask (never sent by itself)",
    added.feed.length === 1 &&
      added.feed[0][0] === "capture" &&
      added.feed[0][1] === 1 &&
      added.feed[0][2] === 2 &&
      added.box === "what's due friday?" &&
      added.askMode === "true",
    added,
  );
  check(
    "feed says what was added and links to the tabs",
    /Added 1 to-do and 2 Shopping items/.test(added.html) &&
      /To-Do →/.test(added.html) &&
      /Shopping →/.test(added.html),
    added.html,
  );
  check(
    "one Undo toast for everything",
    added.undo && /Added 1 to-do and 2 Shopping items/.test(added.toast),
    added.toast,
  );
  await page.tap("#toast .toast-action");
  const undone = await page.evaluate(() => ({
    n: todoList.length + wantsList.length,
    stored:
      JSON.parse(localStorage.getItem("todo-content")).length +
      JSON.parse(localStorage.getItem("wants-content")).length,
    entry: consoleFeed.find((e) => e.kind === "capture"),
    html: document.getElementById("cn-feed").textContent,
  }));
  check("Undo removes all of them", undone.n === base && undone.stored === base, undone);
  check("the feed marks the capture undone", undone.entry.undone === true && /Undone/.test(undone.html), undone);
  // feed link goes to the tab
  await page.fill("#console-input", "");
  await page.fill("#console-input", "buy eggs");
  await page.press("#console-input", "Enter");
  await page.tap("#cn-add");
  await page.tap('#cn-feed .cn-link[data-go="wants"]');
  check("a feed link opens Shopping", (await page.evaluate(() => currentTab)) === "wants");
  // expense chip opens the Budget sheet pre-filled; nothing saved until Add there
  await page.evaluate(() => activateTab("console"));
  await page.fill("#console-input", "groceries $54 spent");
  await page.press("#console-input", "Enter");
  check(
    "an expense alone can't be added from Console",
    await page.evaluate(() => document.getElementById("cn-add").disabled),
  );
  await page.tap(".cn-exp");
  const comp = await page.evaluate(() => ({
    open: document.getElementById("composer").classList.contains("open"),
    heading: document.getElementById("composer-heading").textContent,
    text: document.getElementById("composer-text").value,
    n: budget.expenses.length,
  }));
  check(
    "the expense chip opens Add to budget pre-filled",
    comp.open && comp.heading === "Add to budget" && comp.text === "groceries $54" && comp.n === expenses0,
    comp,
  );
  await page.evaluate(() => closeComposer());
  check(
    "forged row indexes do nothing",
    await page.evaluate(() => {
      consoleCycleRow(99);
      consoleExpense(99);
      return true;
    }),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Console: Ask without sync explains itself and makes no network calls; XSS; offline", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=console",
    seed: { "console-feed": [{ id: "old1", kind: "ask", at: Date.now() - 60000, text: "An old question" }] },
  });
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  const keysBefore = await page.evaluate(() => Object.keys(localStorage).sort());
  await page.fill("#console-input", "What's due before payday?");
  await page.press("#console-input", "Enter");
  await page.waitForTimeout(300);
  const a = await page.evaluate(() => ({
    feed: consoleFeed.map((e) => [e.kind, e.text]),
    html: document.getElementById("cn-feed").textContent,
    box: document.getElementById("console-input").value,
    toast: document.getElementById("toast").textContent,
    keys: Object.keys(localStorage).sort(),
  }));
  check(
    "without sync, Ask says it needs sync and keeps the question in the box",
    a.feed.length === 1 && a.box === "What's due before payday?" && /Ask needs sync/.test(a.toast),
    a,
  );
  check(
    "a question saved before Ask was switched on is labelled as not sent",
    a.html.includes("Not sent: saved here before Ask Jarvis was switched on"),
    a.html,
  );
  check("no new token or ask keys", a.keys.filter((k) => !keysBefore.includes(k)).length === 0, a.keys);
  check(
    "Ask makes no network calls",
    requests.every((u) => u.startsWith(APP.replace(/jazz2\.0\.html$/, ""))),
    requests,
  );
  await page.fill("#console-input", "");
  // XSS: everything typed is escaped in the box's chips, preview and feed
  const evil = `<img src=x onerror="window.__xss=1">"'&`;
  await page.fill("#console-input", evil + "?");
  await page.press("#console-input", "Enter");
  await page.tap('.cn-seg[data-mode="capture"]');
  await page.fill("#console-input", `${evil} $5 / ${evil} fri / ${evil} $9 spent`);
  await page.press("#console-input", "Enter");
  const x = await page.evaluate(() => ({
    xss: window.__xss,
    imgs: document.querySelectorAll("#panel-console img").length,
    preview: document.getElementById("cn-preview").textContent,
  }));
  check("typed HTML is shown as text, never run", !x.xss && x.imgs === 0 && x.preview.includes("<img src=x"), x);
  await page.tap("#cn-add");
  check(
    "added items and the feed stay escaped",
    await page.evaluate(
      () =>
        !window.__xss &&
        document.querySelectorAll("#panel-console img, #panel-home img.x, #panel-wants img[src='x']").length === 0 &&
        document.getElementById("cn-feed").textContent.includes("<img src=x"),
    ),
  );
  // offline: capture is local
  await ctx.setOffline(true);
  const n0 = await page.evaluate(() => todoList.length);
  await page.fill("#console-input", "call mom tomorrow / dentist fri");
  await page.press("#console-input", "Enter");
  await page.tap("#cn-add");
  check("Capture works offline", (await page.evaluate(() => todoList.length)) === n0 + 2);
  await ctx.setOffline(false);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Console: feed normalizer drops junk, caps 7 days / 50 entries, survives sync", async () => {
  const now = Date.now();
  const many = Array.from({ length: 60 }, (_, i) => ({
    id: "ok" + i,
    kind: "ask",
    at: now - i * 60000,
    text: "q" + i,
  }));
  const { ctx, page, errors } = await openApp({
    query: "?tab=console",
    seed: {
      "console-feed": [
        "x",
        null,
        [1],
        { id: "<bad>", kind: "ask", at: now + 5, text: "<b>bold</b>" },
        { id: "c1", kind: "capture", at: now + 4, text: "ok", todos: "2", shop: -1 },
        { id: "c2", kind: "capture", at: now + 3, text: "nothing", todos: 0, shop: 0 },
        { id: "old", kind: "ask", at: now - 8 * 864e5, text: "old" },
        { id: "weird", kind: "sql", at: now, text: "y" },
        { id: "nan", kind: "ask", at: "nope", text: "z" },
        { id: "blank", kind: "ask", at: now, text: "   " },
        { id: "future", kind: "ask", at: now + 5 * 864e5, text: "later" },
        { id: "ok0", kind: "ask", at: now + 2, text: "duplicate id" },
        ...many,
      ],
    },
  });
  const r = await page.evaluate(() => ({
    feed: consoleFeed,
    stored: JSON.parse(localStorage.getItem("console-feed")),
    html: document.getElementById("cn-feed").innerHTML,
  }));
  const ids = r.feed.map((e) => e.id);
  check("capped at 50 entries", r.feed.length === 50, r.feed.length);
  check(
    "junk, empty, old, future and unknown kinds are dropped",
    !r.feed.some((e) => ["c2", "old", "weird", "nan", "blank", "future"].includes(e.id) || e.text === "old"),
    ids.slice(0, 8),
  );
  check(
    "bad ids are replaced, duplicates made unique",
    ids.every((id) => /^[A-Za-z0-9_-]+$/.test(id)) && new Set(ids).size === ids.length,
    ids.slice(0, 8),
  );
  check(
    "counts are coerced",
    JSON.stringify(r.feed.find((e) => e.id === "c1")) ===
      JSON.stringify({
        id: "c1",
        at: r.feed.find((e) => e.id === "c1").at,
        kind: "capture",
        text: "ok",
        todos: 2,
        shop: 0,
      }),
    r.feed.find((e) => e.id === "c1"),
  );
  check(
    "newest first",
    r.feed.every((e, i) => i === 0 || e.at <= r.feed[i - 1].at),
  );
  check("the cleaned feed is written back", JSON.stringify(r.stored) === JSON.stringify(r.feed));
  check("stored HTML is escaped", r.html.includes("&lt;b&gt;bold&lt;/b&gt;") && !r.html.includes("<b>bold"), "");
  // a sync (applyRemote) re-checks it too, and doesn't touch it otherwise
  const after = await page.evaluate(() => {
    localStorage.setItem("console-feed", JSON.stringify([{ kind: "ask", at: Date.now(), text: "fresh" }, "junk"]));
    applyRemote({ updatedAt: Date.now(), data: { "todo-content": [] } });
    return consoleFeed.map((e) => e.text);
  });
  check("applyRemote runs the normalizer", JSON.stringify(after) === '["fresh"]', after);
  const days = await page.evaluate(() => {
    consoleFeed = normalizeConsoleFeed([
      { kind: "ask", at: Date.now(), text: "today" },
      { kind: "ask", at: Date.now() - 864e5, text: "yesterday" },
      { kind: "ask", at: Date.now() - 3 * 864e5, text: "earlier" },
    ]);
    renderConsole();
    return [...document.querySelectorAll("#cn-feed .jv-sub-label")].map((l) => l.textContent);
  });
  check(
    "feed is grouped Today, Yesterday, then earlier days",
    days.length === 3 && days[0] === "Today" && days[1] === "Yesterday",
    days,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

// ---------- Weekly Review (js/review.js) ----------
// A review whose Sunday is `end` days from today (0 = today), with week id `id`
function reviewFixture(id, end = 0, over = {}) {
  return {
    version: 1,
    id,
    weekStart: isoOffset(end - 6),
    weekEnd: isoOffset(end),
    generatedAt: new Date().toISOString(),
    trigger: "schedule",
    headline: "Routine held at 5/7; two to-dos slipped",
    stats: {
      todos: { done: 3, due: 4, dueDone: 2, missed: 2, carried: 1, starredDone: 1 },
      routine: { fullDays: 5, amOnly: 1, streak: 2 },
      workouts: { done: 3, planned: 4, missedDays: [isoOffset(end - 4)] },
      weight: { weighIns: 2, current: 192.5, change: -1.5, pct: 38, eta: "2027-01-28" },
      goals: [{ name: "Glow", doneThisWeek: null, done: 1, total: 2 }],
      bills: {
        paid: 2,
        autopaid: 1,
        paidTotal: 160,
        unpaidPastDue: ["Gym", "Rent"],
        dueNextWeek: 2,
        dueNextWeekTotal: 110,
      },
      spending: {
        total: 117.75,
        byCat: [{ name: "Groceries", spent: 90.5, limitWeek: 70.33, monthSpent: 20, limitMonth: 310 }],
      },
      shopping: { bought: null, boughtCount: null, needsOpen: 2, estOpen: 160 },
      nextWeek: {
        start: isoOffset(end + 1),
        end: isoOffset(end + 7),
        events: null,
        busiestDay: isoOffset(end + 6),
        todosDue: 2,
        billsDue: 2,
        workouts: 3,
        washDays: [isoOffset(end + 3)],
      },
      inbox: { days: 2, awaitingReply: 1, billMismatches: 1 },
    },
    wins: [{ text: "Routine done 5 of 7 days.", stat: "routine" }],
    slips: [{ text: "2 to-dos due this week are still open.", stat: "todos" }],
    focus: [{ text: "Pay Gym and Rent first thing Monday." }],
    suggestions: [
      { kind: "todo", text: "Pay Rent", due: isoOffset(end + 1) },
      { kind: "shopping", text: "Protein powder" },
    ],
    summaryBy: "jarvis",
    snapshot: { plan3Done: [], wantsBought: [] },
    notes: ["Goals and Shopping are tracked from this review on."],
    ...over,
  };
}
const reviewsFile = (...reviews) => ({ version: 1, reviews });

await section(
  "weekly review: sync pulls jazz2-reviews.json, keeps it on this device only, never pushes it",
  async () => {
    const now = Date.now();
    const file = reviewsFile(reviewFixture("2030-W02", 0), reviewFixture("2030-W01", -7));
    const gist = {
      id: "g0",
      files: {
        "jazz2-data.json": { truncated: false, content: JSON.stringify({ updatedAt: now - 1000, data: {} }) },
        "jazz2-reviews.json": { truncated: false, content: JSON.stringify(file) },
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
    const r = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("jarvis-reviews") || "null");
      return {
        ids: ((stored && stored.reviews) || []).map((x) => x.id),
        snapshot: !!stored && "snapshot" in stored.reviews[0],
        toast: document.getElementById("toast").textContent,
        inSyncKeys: SYNC_KEYS.includes("jarvis-reviews") || SYNC_KEYS.includes("jarvis-review-seen"),
        card: !!document.querySelector("#panel-console .rv-card"),
      };
    });
    check("reviews stored on this device, newest first", r.ids.join() === "2030-W02,2030-W01", r);
    check("stored already cleaned (no snapshot)", !r.snapshot, r);
    check("toast says the review is ready", r.toast === "Your week in review is ready", r.toast);
    check("reviews are not synced lists", !r.inSyncKeys);
    check("Console shows the card once it arrives", r.card);
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
    check("gist reviews untouched", gist.files["jazz2-reviews.json"].content === JSON.stringify(file));
    const after = await page.evaluate(async (f) => {
      document.getElementById("toast").textContent = "";
      const before = localStorage.getItem("jarvis-reviews");
      await ingestReviewFile({ content: JSON.stringify(f) }); // the same file again
      await ingestReviewFile({ truncated: true, raw_url: "https://evil.example/x" });
      await ingestReviewFile({ content: "not json" });
      await ingestReviewFile({ content: JSON.stringify({ version: 1, reviews: [] }) });
      await ingestReviewFile(undefined);
      return {
        same: localStorage.getItem("jarvis-reviews") === before,
        toast: document.getElementById("toast").textContent,
      };
    }, file);
    check("repeats, junk and foreign raw URLs change nothing", after.same && after.toast === "", after);
    check(
      "sync payload and backup leave the reviews out",
      !(await page.evaluate(() => JSON.stringify([collectLocal(), liveData()]).includes("Routine held"))),
    );
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
);

await section("weekly review: normalizer drops junk, caps sizes, clamps numbers, escapes text", async () => {
  const { ctx, page, errors } = await openApp();
  const r = await page.evaluate(
    (good) => {
      const big = "x".repeat(500);
      const evil = '<img src=x onerror="window.__pwn=1"><script>window.__pwn=1</script>';
      const hostile = {
        ...good,
        id: "2030-W05",
        headline: evil + big,
        stats: {
          ...good.stats,
          todos: { done: NaN, due: Infinity, dueDone: 99, missed: -5, carried: "7", starredDone: 1e9 },
          routine: { fullDays: 12, amOnly: null, streak: 3.6 },
          weight: { weighIns: 1, current: "190", change: NaN, pct: 400, eta: "soon" },
          goals: Array.from({ length: 9 }, (_, i) => ({ name: i ? evil : "", done: 1, total: 0 })),
          spending: { total: -50, byCat: Array.from({ length: 12 }, () => ({ name: big, spent: 1, limitWeek: "x" })) },
          shopping: { bought: [evil, 5, ...Array(20).fill("item")], boughtCount: -1.4, needsOpen: 1, estOpen: 1 },
          nextWeek: { ...good.stats.nextWeek, washDays: ["2030-02-30", "nope", good.stats.nextWeek.washDays[0]] },
          inbox: "junk",
        },
        wins: [
          { text: evil, stat: "toString" },
          { text: "", stat: "todos" },
          ...Array(5).fill({ text: "w", stat: "todos" }),
        ],
        slips: "junk",
        focus: [{ text: big }],
        suggestions: [
          { kind: "evil", text: "x" },
          { kind: "todo", text: evil + big, due: "2030-13-01" },
          { kind: "shopping", text: "eggs", due: "2030-01-01" },
          { kind: "todo", text: "a" },
          { kind: "todo", text: "b" },
        ],
        summaryBy: "other",
        notes: [evil, 3, ...Array(20).fill("n")],
      };
      const list = normalizeReviews({
        version: 1,
        reviews: [
          hostile,
          { ...good, id: "2030-W5" },
          { ...good, id: "2030-W06", version: 2 },
          { ...good, id: "2030-W07", weekEnd: "2030-02-31" },
          { ...good, id: "2030-W08", headline: "" },
          { ...good, id: "2030-W09", stats: null },
          "junk",
          null,
          { ...good, id: "2030-W05", headline: "duplicate" },
          ...Array.from({ length: 15 }, (_, i) => ({ ...good, id: `2029-W${String(i + 10).padStart(2, "0")}` })),
        ],
      });
      const h = list[0];
      localStorage.setItem("jarvis-reviews", JSON.stringify({ version: 1, reviews: [hostile] }));
      localStorage.removeItem("jarvis-review-seen");
      renderConsole();
      openReview("2030-W05");
      const html = document.getElementById("review-sheet").innerHTML + document.getElementById("cn-review").innerHTML;
      closeReview();
      return {
        count: list.length,
        first: list[0].id,
        headLen: h.headline.length,
        todos: h.stats.todos,
        routine: h.stats.routine,
        weight: h.stats.weight,
        goals: h.stats.goals.length,
        goalTotal: h.stats.goals[0].total,
        cats: h.stats.spending.byCat.length,
        catName: h.stats.spending.byCat[0].name.length,
        limitWeek: h.stats.spending.byCat[0].limitWeek,
        total: h.stats.spending.total,
        bought: h.stats.shopping.bought.length,
        boughtCount: h.stats.shopping.boughtCount,
        wash: h.stats.nextWeek.washDays.length,
        inbox: h.stats.inbox,
        wins: h.wins.length,
        winStat: h.wins[0].stat,
        slips: h.slips.length,
        focusLen: h.focus[0].text.length,
        chips: h.suggestions,
        summaryBy: h.summaryBy,
        notes: h.notes.length,
        pwn: !!window.__pwn,
        rawTags: /<img|<script/i.test(html),
        escaped: html.includes("&lt;img"),
        links: (html.match(/<a\s/g) || []).length,
      };
    },
    reviewFixture("2030-W04", 0),
  );
  check("bad version, id, dates, headline and stats are dropped; one per id; at most 12", r.count === 12, r.count);
  check("newest first", r.first === "2030-W05", r.first);
  check("headline capped at 100", r.headLen === 100, r.headLen);
  check(
    "counts: NaN/Infinity/strings/negatives become 0, done-of-due capped",
    r.todos.done === 0 && r.todos.due === 0 && r.todos.dueDone === 0 && r.todos.missed === 0 && r.todos.carried === 0,
    r.todos,
  );
  check("routine days capped at 7, streak rounded", r.routine.fullDays === 7 && r.routine.streak === 4, r.routine);
  check(
    "weight: strings and NaN become null, pct capped, bad eta null",
    r.weight.current === null && r.weight.change === null && r.weight.pct === 100 && r.weight.eta === null,
    r.weight,
  );
  check("goals capped at 6, unnamed dropped, total ≥ done", r.goals === 6 && r.goalTotal === 1, r);
  check("categories capped at 8 and names at 40", r.cats === 8 && r.catName === 40, r);
  check("bad limit is null, negative money is 0", r.limitWeek === null && r.total === 0, r);
  check("bought capped at 8, non-strings dropped, bad count clamped", r.bought === 8 && r.boughtCount === 0, r);
  check("impossible wash days dropped", r.wash === 1, r.wash);
  check("a non-object inbox is left out", r.inbox === null, r.inbox);
  check("wins capped at 3, empty dropped, inherited stat names unlinked", r.wins === 3 && r.winStat === null, r);
  check("a non-list slips is empty", r.slips === 0);
  check("focus text capped at 200", r.focusLen === 200);
  check(
    "chips: bad kinds dropped, text capped at 120, bad dates dropped, Shopping has no date, at most 3",
    r.chips.length === 3 &&
      r.chips[0].text.length === 120 &&
      r.chips[0].due === null &&
      r.chips[1].kind === "shopping" &&
      r.chips[1].due === null,
    r.chips,
  );
  check("unknown summaryBy reads as jarvis", r.summaryBy === "jarvis");
  check("notes capped at 10", r.notes === 10, r.notes);
  check("hostile text is escaped and never runs", !r.pwn && !r.rawTags && r.escaped, r);
  check("no links are made from review text", r.links === 0, r.links);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("weekly review: Console card while new or Sunday–Tuesday, one line after, quiet when none", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=console" });
  const state = (file, seen) =>
    page.evaluate(
      ({ file, seen }) => {
        if (file) localStorage.setItem("jarvis-reviews", JSON.stringify(file));
        else localStorage.removeItem("jarvis-reviews");
        if (seen) localStorage.setItem("jarvis-review-seen", seen);
        else localStorage.removeItem("jarvis-review-seen");
        renderConsole();
        const el = document.getElementById("cn-review");
        const row = el.querySelector(".rv-row");
        return {
          card: !!el.querySelector(".rv-card"),
          pill: !!el.querySelector(".jv-pill"),
          row: row ? row.textContent.replace(/\s+/g, " ").trim() : "",
          text: el.textContent.replace(/\s+/g, " ").trim(),
          visible: getComputedStyle(el).display !== "none",
          overflow: document.scrollingElement.scrollWidth > innerWidth,
        };
      },
      { file, seen },
    );
  const sunday = await state(reviewsFile(reviewFixture("2030-W02", 0)), null);
  check("on its Sunday the card shows with a New pill", sunday.card && sunday.pill, sunday);
  check(
    "card: kicker, headline, one line of numbers, Open review",
    /Week in review/i.test(sunday.text) &&
      sunday.text.includes("Routine held at 5/7") &&
      sunday.text.includes("2/4 to-dos · 5/7 routine · 3/4 workouts · $118 spent") &&
      sunday.text.includes("Open review"),
    sunday.text,
  );
  check("no sideways scroll at phone width", !sunday.overflow);
  const tue = await state(reviewsFile(reviewFixture("2030-W02", -2)), "2030-W02");
  check("still the card on Tuesday once seen, without the pill", tue.card && !tue.pill, tue);
  const wed = await state(reviewsFile(reviewFixture("2030-W02", -3)), "2030-W02");
  check(
    "after Tuesday: one line, Last week: numbers",
    !wed.card && wed.row.startsWith("Last week") && wed.row.includes("2/4 to-dos · 5/7 routine"),
    wed,
  );
  const wedNew = await state(reviewsFile(reviewFixture("2030-W02", -3)), "2030-W01");
  check("an unopened review keeps the card through the week", wedNew.card && wedNew.pill, wedNew);
  const old = await state(reviewsFile(reviewFixture("2030-W02", -10)), "2030-W02");
  check("an older review says which week", old.row.startsWith("Week of"), old.row);
  const none = await state(null, null);
  check("no review, no sync: nothing shows", !none.visible && none.text === "", none);
  const withSync = await page.evaluate(() => {
    localStorage.setItem("sync-token", "t");
    const html = consoleReviewHtml();
    localStorage.removeItem("sync-token");
    return html;
  });
  check(
    "no review yet with sync on: one quiet line",
    withSync.includes("first weekly review arrives Sunday"),
    withSync,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("weekly review: the sheet opens, marks seen, steps through weeks, holds and returns focus", async () => {
  const file = reviewsFile(
    reviewFixture("2030-W03", 0),
    reviewFixture("2030-W02", -7, { headline: "Second week" }),
    reviewFixture("2030-W01", -14, { headline: "First week", summaryBy: "fallback" }),
  );
  for (const phone of [true, false]) {
    const { ctx, page, errors } = await openApp({ phone, query: "?tab=console", seed: { "jarvis-reviews": file } });
    const tag = phone ? "phone" : "desktop";
    await page.focus("#panel-console .rv-open");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const sheet = document.getElementById("review-sheet");
      const body = document.getElementById("review-body");
      const box = body.getBoundingClientRect();
      return {
        open: sheet.classList.contains("open"),
        sheetInert: sheet.inert,
        mainInert: document.querySelector("main").inert,
        navInert: document.querySelector("nav.tabbar").inert,
        focus: document.activeElement.id,
        title: document.getElementById("rv-title").textContent,
        seen: localStorage.getItem("jarvis-review-seen"),
        pill: !!document.querySelector("#cn-review .jv-pill"),
        bars: [...body.querySelectorAll(".rv-bar .rv-bar-k")].map((x) => x.textContent),
        lines: [...body.querySelectorAll(".rv-line-k")].map((x) => x.textContent),
        heads: [...body.querySelectorAll(".rv-h")].map((x) => x.textContent),
        text: body.textContent.replace(/\s+/g, " "),
        pos: body.querySelector(".rv-pos").textContent,
        newerDisabled: body.querySelector('[data-dir="newer"]').disabled,
        overflow: body.scrollWidth > body.clientWidth,
        centered: box.bottom < innerHeight - 4,
        small: [...body.querySelectorAll("button")].filter((b) => {
          const q = b.getBoundingClientRect();
          return q.width && (q.height < 44 || q.width < 44);
        }).length,
        tiny: [...body.querySelectorAll("*")].filter(
          (e) => e.childElementCount === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 11,
        ).length,
      };
    });
    check(`${tag}: opens, the page behind goes inert`, r.open && !r.sheetInert && r.mainInert && r.navInert, r);
    check(`${tag}: focus moves to the headline`, r.focus === "rv-title" && r.title.startsWith("Routine held"), r);
    check(`${tag}: opening marks it seen and drops the pill`, r.seen === "2030-W03" && !r.pill, r);
    check(
      `${tag}: numbers as bars for to-dos, routine, workouts, spending`,
      r.bars.join() === "To-dos,Routine,Workouts,Spent",
      r.bars,
    );
    check(
      `${tag}: lines for weight, goals, bills, shopping`,
      ["Weight", "Glow", "Bills", "Shopping"].every((k) => r.lines.includes(k)),
      r.lines,
    );
    check(
      `${tag}: Wins, Slipped, focus and next week sections`,
      ["Wins", "Slipped", "Next week · focus"].every((h) => r.heads.includes(h)) &&
        r.heads.some((h) => h.startsWith("Next week ·") && h !== "Next week · focus"),
      r.heads,
    );
    check(
      `${tag}: nulls read not tracked yet / not connected`,
      r.text.includes("not tracked yet") && r.text.includes("Calendar: not connected"),
      r.text,
    );
    check(
      `${tag}: inbox and notes show`,
      r.text.includes("waiting on a reply") && r.text.includes("tracked from this review on"),
    );
    check(`${tag}: history position, nothing newer than the newest`, r.pos === "1 of 3" && r.newerDisabled, r);
    check(`${tag}: no sideways overflow`, !r.overflow);
    check(`${tag}: buttons are at least 44px`, r.small === 0, r.small);
    check(`${tag}: no text under 11px`, r.tiny === 0, r.tiny);
    if (!phone) check("desktop: a centered dialog", r.centered, r);
    await page.click('#review-body [data-dir="older"]');
    await page.click('#review-body [data-dir="older"]');
    const older = await page.evaluate(() => ({
      title: document.getElementById("rv-title").textContent,
      pos: document.querySelector("#review-body .rv-pos").textContent,
      olderDisabled: document.querySelector('#review-body [data-dir="older"]').disabled,
      meta: document.querySelector("#review-body .rv-meta").textContent,
      focus: document.activeElement.id,
      seen: localStorage.getItem("jarvis-review-seen"),
    }));
    check(
      `${tag}: ‹ goes back through past weeks`,
      older.title === "First week" && older.pos === "3 of 3" && older.olderDisabled,
      older,
    );
    check(`${tag}: a fallback review is labelled`, older.meta.includes("Assembled automatically"), older.meta);
    check(`${tag}: at the oldest, focus goes to the headline`, older.focus === "rv-title", older.focus);
    check(`${tag}: stepping back doesn't un-see the newest`, older.seen === "2030-W03", older.seen);
    await page.click('#review-body [data-dir="newer"]');
    check(`${tag}: › steps forward`, (await page.textContent("#rv-title")) === "Second week");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    const closed = await page.evaluate(() => ({
      open: document.getElementById("review-sheet").classList.contains("open"),
      inert: document.getElementById("review-sheet").inert,
      mainInert: document.querySelector("main").inert,
      focus: document.activeElement.getAttribute("data-action"),
    }));
    check(
      `${tag}: Esc closes it, focus returns to Open review`,
      !closed.open && closed.inert && !closed.mainInert && closed.focus === "review-open",
      closed,
    );
    const back = await page.evaluate(() => {
      openReview("2030-W02");
      document.getElementById("review-sheet").click();
      const a = document.getElementById("review-sheet").classList.contains("open");
      const bad = openReview("<x>") || openReview("2030-W99") || openReview(null);
      return { a, bad, open: document.getElementById("review-sheet").classList.contains("open") };
    });
    check(`${tag}: the backdrop closes it; unknown ids are inert`, !back.a && !back.bad && !back.open, back);
    check(`${tag}: no JS errors`, errors.length === 0, errors);
    await ctx.close();
  }
});

await section("weekly review: chips add only when tapped, with their date, and Undo takes them back", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=console",
    seed: { "jarvis-reviews": reviewsFile(reviewFixture("2030-W03", 0)), "todo-content": [], "wants-content": [] },
  });
  const counts = () =>
    page.evaluate(() => ({
      todos: todoList.filter((t) => t.text === "Pay Rent"),
      wants: wantsList.filter((w) => w.name === "Protein powder").length,
      stored: JSON.parse(localStorage.getItem("todo-content") || "[]").filter((t) => t.text === "Pay Rent").length,
    }));
  await page.click("#panel-console .rv-open");
  await page.waitForTimeout(250);
  const before = await counts();
  check("opening the review adds nothing", before.todos.length === 0 && before.wants === 0, before);
  await page.click('#review-body .rv-chip[data-index="0"]');
  await page.waitForTimeout(200);
  const added = await counts();
  const chip = await page.evaluate(() => {
    const c = document.querySelector('#review-body .rv-chip[data-index="0"]');
    return {
      cls: c.className,
      text: c.textContent,
      focus: document.activeElement.getAttribute("data-index"),
      toast: document.getElementById("toast").textContent,
      open: document.getElementById("review-sheet").classList.contains("open"),
      tomorrow: addDaysIso(1),
    };
  });
  check(
    "tapping the to-do chip adds it with its due date (saved)",
    added.todos.length === 1 && added.todos[0].due === chip.tomorrow && added.stored === 1,
    added,
  );
  check(
    "the chip shows as added and keeps focus",
    chip.cls.includes("added") && chip.text.includes("Added") && chip.focus === "0",
    chip,
  );
  check(
    "an Undo toast, and the sheet stays open",
    chip.toast.includes("Added to To-Do") && chip.toast.includes("Undo") && chip.open,
    chip,
  );
  // an added chip is aria-disabled (Playwright won't click it), so tap it directly
  await page.evaluate(() => document.querySelector('#review-body .rv-chip[data-index="0"]').click());
  check("tapping it again adds nothing", (await counts()).todos.length === 1);
  await page.evaluate(() => document.querySelector("#toast .toast-action").click());
  await page.waitForTimeout(200);
  const undone = await counts();
  const chipAfter = await page.evaluate(
    () => document.querySelector('#review-body .rv-chip[data-index="0"]').className,
  );
  check(
    "Undo removes the to-do and the chip can be tapped again",
    undone.todos.length === 0 && undone.stored === 0 && !chipAfter.includes("added"),
    { undone, chipAfter },
  );
  await page.click('#review-body .rv-chip[data-index="1"]');
  await page.waitForTimeout(200);
  check("the Shopping chip adds a Shopping item", (await counts()).wants === 1);
  const forged = await page.evaluate(() => {
    const n = todoList.length + wantsList.length;
    const b = document.createElement("button");
    b.setAttribute("data-action", "review-chip");
    b.setAttribute("data-index", "7");
    document.getElementById("review-body").appendChild(b);
    b.click();
    b.setAttribute("data-index", "x");
    b.click();
    b.remove();
    return todoList.length + wantsList.length === n;
  });
  check("forged chip indexes are inert", forged);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("weekly review: links go to the right tab and card", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=console",
    seed: {
      "jarvis-reviews": reviewsFile(reviewFixture("2030-W03", 0)),
      "plan3-content": [{ id: "p1", cat: "Glow", item: "Water", note: "", done: true }],
    },
  });
  const go = async (sel) => {
    await page.evaluate(() => {
      activateTab("console");
      openReview("2030-W03");
    });
    await page.click(sel);
    await page.waitForTimeout(200);
    return page.evaluate(() => ({
      tab: currentTab,
      open: document.getElementById("review-sheet").classList.contains("open"),
      mainInert: document.querySelector("main").inert,
    }));
  };
  const cases = [
    ['#review-body .rv-bar[data-stat="todos"]', "todo"],
    ['#review-body .rv-bar[data-stat="routine"]', "skin"],
    ['#review-body .rv-bar[data-stat="workouts"]', "jazz3"],
    ['#review-body .rv-bar[data-stat="spending"]', "budget"],
    ['#review-body .rv-line[data-stat="bills"]', "budget"],
    ['#review-body .rv-line[data-stat="shopping"]', "wants"],
    ['#review-body .rv-line[data-stat="weight"]', "jazz3"],
    ['#review-body .jv-sum-drill[data-stat="todos"]', "todo"],
    ["#review-body .rv-next", "todo"],
  ];
  for (const [sel, tab] of cases) {
    const r = await go(sel);
    check(`${sel.split(" ")[1]} → ${tab}, and the sheet closes`, r.tab === tab && !r.open && !r.mainInert, r);
  }
  await go('#review-body .rv-line[data-stat="goals"]');
  const goal = await page.evaluate(() => ({ tab: currentTab, open: openPinned.has("p3-glow") }));
  check("a goal opens its own Jazz 3.0 card", goal.tab === "jazz3" && goal.open, goal);
  const forged = await page.evaluate(() => {
    activateTab("console");
    openReview("2030-W03");
    reviewGo("__proto__");
    reviewGo("constructor");
    return { tab: currentTab, open: document.getElementById("review-sheet").classList.contains("open") };
  });
  check("unknown stat keys are inert", forged.tab === "console" && forged.open, forged);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("weekly review: ?tab=console&review= opens it, now or when sync brings it", async () => {
  const file = reviewsFile(reviewFixture("2030-W03", 0), reviewFixture("2030-W02", -7, { headline: "Second week" }));
  const a = await openApp({ query: "?tab=console&review=2030-W02", seed: { "jarvis-reviews": file } });
  const r = await a.page.evaluate(() => ({
    tab: currentTab,
    open: document.getElementById("review-sheet").classList.contains("open"),
    title: (document.getElementById("rv-title") || {}).textContent,
    url: location.search,
  }));
  check("the deep link opens Console and that review", r.tab === "console" && r.open && r.title === "Second week", r);
  check("the query is cleared", r.url === "", r.url);
  check("no JS errors", a.errors.length === 0, a.errors);
  await a.ctx.close();
  const b = await openApp({ query: "?tab=console&review=2030-W03" });
  const before = await b.page.evaluate(() => document.getElementById("review-sheet").classList.contains("open"));
  await b.page.evaluate(async (f) => ingestReviewFile({ content: JSON.stringify(f) }), file);
  const after = await b.page.evaluate(() => ({
    open: document.getElementById("review-sheet").classList.contains("open"),
    title: (document.getElementById("rv-title") || {}).textContent || "",
  }));
  check(
    "a review not synced yet opens once it arrives",
    !before && after.open && after.title.startsWith("Routine held"),
    after,
  );
  await b.ctx.close();
  const c = await openApp({ query: "?tab=console&review=%3Cscript%3E", seed: { "jarvis-reviews": file } });
  check(
    "a malformed review id opens nothing",
    !(await c.page.evaluate(() => document.getElementById("review-sheet").classList.contains("open"))) &&
      c.errors.length === 0,
    c.errors,
  );
  await c.ctx.close();
});

await section("weekly review: Home's Today in 60 seconds shows one line while it's unseen", async () => {
  const briefing = briefingFixture();
  const { ctx, page, errors } = await openApp({
    seed: { "jarvis-reviews": reviewsFile(reviewFixture("2030-W03", 0)), "jarvis-briefing": briefing },
  });
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("#panel-home .jv-hero .jv-summary > li")].map((li) =>
      li.textContent.replace(/\s+/g, " ").trim(),
    ),
  );
  check(
    "the line leads the briefing's rows, which are all still there",
    rows[0].includes("Your week in review is ready") && rows.length === briefing.summary.length + 1,
    rows,
  );
  await page.click('#panel-home [data-action="review-open"]');
  await page.waitForTimeout(250);
  const opened = await page.evaluate(() => ({
    open: document.getElementById("review-sheet").classList.contains("open"),
    row: !!document.querySelector('#panel-home [data-action="review-open"]'),
  }));
  check("tapping it opens the review, and the line goes", opened.open && !opened.row, opened);
  await page.keyboard.press("Escape");
  const empty = await page.evaluate(() => {
    localStorage.removeItem("jarvis-briefing");
    localStorage.removeItem("jarvis-review-seen");
    renderHome();
    return !!document.querySelector('#panel-home .jv-empty [data-action="review-open"]');
  });
  check("the line also shows before the first briefing", empty);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("home: a briefing row opens its tile with the detail in view, not behind the tab bar", async () => {
  const b = briefingFixture();
  b.summary = [{ text: "Rent is due Sunday and isn't on autopay.", source: "jazz" }, ...b.summary.slice(0, 2)];
  const { ctx, page, errors } = await openApp({ seed: { "jarvis-briefing": b } });
  await page.tap('.jv-hero [data-action="jv-drill"][data-go="money"]');
  await page.waitForTimeout(900); // smooth scroll
  const r = await page.evaluate(() => {
    const d = document.getElementById("jv-detail-money").getBoundingClientRect();
    const t = document.querySelector('.jv-tile[data-go="money"]').getBoundingClientRect();
    const bar = document.querySelector("nav.tabbar").getBoundingClientRect().top;
    const top = document.querySelector("main").getBoundingClientRect().top;
    return { tileTop: t.top, detailTop: d.top, bar, top };
  });
  check(
    "the tile is on screen and its detail starts above the tab bar",
    r.tileTop >= r.top && r.detailTop < r.bar - 40,
    r,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("briefing headline: a crammed two-part headline is split for display", async () => {
  const { ctx, page } = await openApp();
  const p = await page.evaluate(() => [
    briefingHeadParts("Pay rent ($612.50, not on autopay) by Sunday; Claude API credit is down to $2.10"),
    briefingHeadParts("Rain moves in by noon"),
  ]);
  check(
    "main point as the headline, the rest underneath",
    p[0].title === "Pay rent by Sunday" && p[0].sub === "$612.50, not on autopay · Claude API credit is down to $2.10",
    p[0],
  );
  check("a plain headline is left alone", p[1].title === "Rain moves in by noon" && p[1].sub === "", p[1]);
  await ctx.close();
});

// ---------- Ask Jarvis (js/ask.js) and voice input (js/voice.js) ----------
const ASK_KEY = "github_pat_" + "A1b2C3d4".repeat(6);
const DISPATCH_PATH = "/repos/Jazz-H/Jazz2.0/actions/workflows/jarvis-ask.yml/dispatches";
// A mocked GitHub: the gist (GET/PATCH) and the workflow dispatch, with a log of every request
function askGitHub({ files = {}, dispatch = 204, dispatchDelay = 0, expires = null } = {}) {
  const gist = {
    id: "g0",
    files: {
      "jazz2-data.json": { truncated: false, content: JSON.stringify({ updatedAt: Date.now(), data: {} }) },
      "jazz2-push.json": {
        truncated: false,
        content: JSON.stringify({ subs: [{ endpoint: "https://push.example/a" }] }),
      },
      ...Object.fromEntries(
        Object.entries(files).map(([n, c]) => [n, { truncated: false, content: JSON.stringify(c) }]),
      ),
    },
  };
  const log = [];
  const state = { dispatch, dispatchDelay, expires };
  const route = async (r) => {
    const req = r.request(),
      url = new URL(req.url());
    const entry = {
      method: req.method(),
      path: url.pathname,
      url: req.url(),
      body: req.postData() || "",
      auth: req.headers()["authorization"] || "",
      accept: req.headers()["accept"] || "",
    };
    log.push(entry);
    const json = (status, body, headers = {}) =>
      r.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(body) });
    if (url.pathname === "/gists/g0" && req.method() === "GET") return json(200, gist);
    if (url.pathname === "/gists/g0" && req.method() === "PATCH") {
      const f = JSON.parse(req.postData()).files;
      entry.files = Object.keys(f);
      Object.entries(f).forEach(([n, x]) => (gist.files[n] = { truncated: false, content: x.content }));
      return json(200, gist);
    }
    if (url.pathname === DISPATCH_PATH && req.method() === "POST") {
      if (state.dispatchDelay) await new Promise((res) => setTimeout(res, state.dispatchDelay));
      if (state.dispatch === "abort") return r.abort();
      const headers = state.expires
        ? {
            "github-authentication-token-expiration": state.expires,
            "access-control-expose-headers": "github-authentication-token-expiration",
          }
        : {};
      return r.fulfill({ status: state.dispatch, headers, body: "" });
    }
    return json(404, {});
  };
  const read = (n) => (gist.files[n] ? JSON.parse(gist.files[n].content) : null);
  const setFile = (n, c) => (gist.files[n] = { truncated: false, content: JSON.stringify(c) });
  return { gist, log, state, route, read, setFile };
}
// openApp plus an init script (a fake SpeechRecognition, or none) and the browser console log
async function openAsk({ seed = {}, query = "?tab=console", route, speech = "fake", phone = true } = {}) {
  const ctx = await browser.newContext(
    phone ? { ...devices["iPhone 13"] } : { viewport: { width: 1280, height: 800 } },
  );
  if (route) await ctx.route("https://api.github.com/**", route);
  await ctx.addInitScript((mode) => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    if (mode !== "fake") return;
    window.__recs = [];
    window.SpeechRecognition = class {
      constructor() {
        window.__recs.push(this);
        this.started = this.stopped = this.aborted = 0;
      }
      start() {
        this.started++;
      }
      stop() {
        this.stopped++;
        setTimeout(() => this.onend && this.onend(), 10);
      }
      abort() {
        this.aborted++;
        setTimeout(() => this.onend && this.onend(), 10);
      }
    };
    // the test's voice: say(text, final), fail(code), end()
    window.__rec = () => window.__recs[window.__recs.length - 1];
    window.__say = (...parts) => window.__rec().onresult({ results: parts.map((t) => [{ transcript: t }]) });
    window.__fail = (code) => {
      window.__rec().onerror({ error: code });
      window.__rec().onend();
    };
  }, speech);
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  }, seed);
  const page = await ctx.newPage();
  const errors = [],
    logs = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => logs.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(APP + query);
  await page.waitForTimeout(600);
  return { ctx, page, errors, logs };
}
const askSync = (extra = {}) => ({
  "sync-token": "tok",
  "sync-gist-id": "g0",
  "data-updated-at": String(Date.now()),
  ...extra,
});
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
function answerFixture(id, over = {}) {
  return {
    id,
    askedAt: isoAgo(120000),
    answeredAt: isoAgo(60000),
    status: "ok",
    text: "You have 2 bills before Friday's payday: Rent $650 and Gym $40.",
    bullets: ["Rent is due Thursday", "Gym is on autopay"],
    sources: ["jazz", "calendar"],
    chips: [
      { kind: "todo", text: "Pay Rent", due: isoOffset(1) },
      { kind: "shopping", text: "Printer paper" },
    ],
    by: "jarvis",
    ...over,
  };
}
const answersFile = (answers, usage = null) => ({ version: 1, answers, ...(usage ? { usage } : {}) });

await section(
  "ask: the Ask Jarvis key is device-only, checked for shape, never shown or sent to the gist",
  async () => {
    const gh = askGitHub();
    const { ctx, page, errors, logs } = await openAsk({ route: gh.route, seed: askSync() });
    await page.evaluate(() => openSyncModal());
    const dlg = await page.evaluate(() => ({
      field: !!document.getElementById("modal-askToken"),
      type: (document.getElementById("modal-askToken") || {}).type,
      text: document.getElementById("modal-body").textContent,
      link: [...document.querySelectorAll("#modal-body a")].map((a) => [a.textContent, a.href, a.target]),
      remove: !!document.querySelector('[data-action="ask-token-remove"]'),
    }));
    check(
      "the Sync dialog has an Ask Jarvis key field with a plain explanation",
      dlg.field &&
        dlg.type === "password" &&
        /Ask Jarvis key/.test(dlg.text) &&
        /Actions: read and write/.test(dlg.text),
      dlg,
    );
    check(
      "it links to SETUP section 8",
      dlg.link.some(([t, h, tg]) => /section 8/.test(t) && /docs\/jarvis\/SETUP\.md$/.test(h) && tg === "_blank"),
      dlg.link,
    );
    check("no Remove option before a key is saved", !dlg.remove);
    await page.fill("#modal-askToken", "ghp_classicTokenNotFineGrained123");
    await page.tap('#modal-backdrop [data-action="modal-save"]');
    const bad = await page.evaluate(() => ({
      stored: localStorage.getItem("ask-token"),
      toast: document.getElementById("toast").textContent,
      gist: localStorage.getItem("sync-gist-id"),
    }));
    check(
      "a key of the wrong shape is refused without calling GitHub",
      bad.stored === null && /starts with github_pat_/.test(bad.toast) && !gh.log.some((r) => r.path === DISPATCH_PATH),
      bad,
    );
    await page.evaluate(() => openSyncModal());
    await page.fill("#modal-askToken", ASK_KEY);
    await page.tap('#modal-backdrop [data-action="modal-save"]');
    const good = await page.evaluate(() => ({
      stored: localStorage.getItem("ask-token"),
      toast: document.getElementById("toast").textContent,
      gist: localStorage.getItem("sync-gist-id"),
      base: localStorage.getItem("sync-base") !== null,
    }));
    check(
      "a github_pat_ key is saved on this device",
      good.stored === ASK_KEY && /saved on this device/.test(good.toast),
      good,
    );
    check("saving only the Ask key doesn't reconnect sync", good.gist === "g0", good);
    await page.evaluate(() => openSyncModal());
    const shown = await page.evaluate(
      (k) => ({
        value: document.getElementById("modal-askToken").value,
        inPage: document.documentElement.outerHTML.includes(k),
        remove: !!document.querySelector('[data-action="ask-token-remove"]'),
        label: document.getElementById("ak-key").textContent,
      }),
      ASK_KEY,
    );
    check("the saved key is never put back on the page", shown.value === "" && !shown.inPage, shown);
    check("a saved key offers Remove", shown.remove && /Key saved here/.test(shown.label), shown);
    await page.evaluate(() => closeModal());
    const kept = await page.evaluate((k) => {
      const all = JSON.stringify([collectLocal(), liveData(), SYNC_KEYS]);
      return { synced: all.includes(k) || SYNC_KEYS.includes("ask-token") };
    }, ASK_KEY);
    check("the key is not a synced list and not in backups", !kept.synced, kept);
    // send a question: the key goes only in the dispatch's Authorization header
    await page.fill("#console-input", "What's due before payday?");
    await page.press("#console-input", "Enter");
    await page.waitForTimeout(500);
    const withKey = gh.log.filter((r) => JSON.stringify(r).includes(ASK_KEY));
    check(
      "only the dispatch carries the key, as a Bearer header",
      withKey.length === 1 &&
        withKey[0].path === DISPATCH_PATH &&
        withKey[0].auth === "Bearer " + ASK_KEY &&
        !withKey[0].body.includes(ASK_KEY),
      withKey.map((r) => r.path),
    );
    check(
      "gist calls use the sync token, never the Ask key",
      gh.log.filter((r) => r.path.startsWith("/gists")).every((r) => r.auth === "Bearer tok"),
    );
    check(
      "the key is in no gist file, log line or stored list",
      !JSON.stringify(gh.gist.files).includes(ASK_KEY) && !logs.some((l) => l.includes(ASK_KEY)),
      logs,
    );
    // Remove
    await page.evaluate(() => openSyncModal());
    await page.tap('[data-action="ask-token-remove"]');
    const removed = await page.evaluate(() => ({
      stored: localStorage.getItem("ask-token"),
      remove: !!document.querySelector('[data-action="ask-token-remove"]'),
      focus: document.activeElement && document.activeElement.id,
    }));
    check("Remove deletes the key from this device", removed.stored === null && !removed.remove, removed);
    check("focus stays in the dialog after Remove", removed.focus === "modal-askToken", removed);
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
);

await section(
  "ask: a question is written to jazz2-ask.json only, after a re-read, and only its id is dispatched",
  async () => {
    const now = Date.now();
    const pending = Array.from({ length: 22 }, (_, i) => ({
      id: `b-older-${String(i).padStart(2, "0")}`,
      kind: "ask",
      text: "older " + i,
      at: new Date(now - (30 - i) * 60000).toISOString(),
    }));
    const gh = askGitHub({
      files: {
        "jazz2-ask.json": {
          version: 1,
          items: [
            { id: "a-answered-01", kind: "ask", text: "already answered", at: isoAgo(3600e3) },
            { id: "c-other-device", kind: "ask", text: "from the laptop", at: isoAgo(1000), thread: "a-answered-01" },
            { id: "BAD ID", kind: "ask", text: "junk", at: isoAgo(1000) },
            ...pending,
          ],
        },
        "jazz2-answers.json": answersFile([answerFixture("a-answered-01", { status: "error" })]),
      },
    });
    const { ctx, page, errors } = await openAsk({ route: gh.route, seed: askSync({ "ask-token": ASK_KEY }) });
    const question = "Can I afford the helmet before payday?";
    const before = gh.log.length;
    await page.fill("#console-input", question);
    await page.press("#console-input", "Enter");
    await page.waitForTimeout(500);
    const ops = gh.log.slice(before);
    const patches = ops.filter((r) => r.method === "PATCH");
    check(
      "one PATCH, of jazz2-ask.json only",
      patches.length === 1 && patches[0].files.join() === "jazz2-ask.json",
      ops.map((r) => r.method + r.path),
    );
    const pIdx = ops.indexOf(patches[0]);
    check(
      "the gist is re-read right before the write",
      pIdx > 0 && ops[pIdx - 1].method === "GET" && ops[pIdx - 1].path === "/gists/g0",
      ops.map((r) => r.method),
    );
    const file = gh.read("jazz2-ask.json");
    const mine = file.items.find((i) => i.text === question);
    check(
      "the new item has the contract's shape",
      !!mine &&
        /^[a-z0-9-]{8,40}$/.test(mine.id) &&
        mine.kind === "ask" &&
        !isNaN(Date.parse(mine.at)) &&
        file.version === 1,
      mine,
    );
    check(
      "other pending questions are kept",
      file.items.some((i) => i.id === "c-other-device" && i.thread === "a-answered-01"),
      file.items.map((i) => i.id),
    );
    check(
      "junk is pruned, and at the 20 cap answered thread context goes before pending questions",
      !file.items.some((i) => i.id === "a-answered-01" || i.id === "BAD ID"),
    );
    check(
      "at most 20 items, oldest dropped first",
      file.items.length === 20 && !file.items.some((i) => i.id === "b-older-00"),
      file.items.length,
    );
    check(
      "other gist files are untouched",
      JSON.parse(gh.gist.files["jazz2-push.json"].content).subs[0].endpoint === "https://push.example/a" &&
        gh.read("jazz2-answers.json").answers.length === 1,
    );
    const disp = ops.filter((r) => r.path === DISPATCH_PATH);
    check(
      "the dispatch body is only {ref, inputs: {id}}",
      disp.length === 1 && disp[0].body === JSON.stringify({ ref: "main", inputs: { id: mine.id } }),
      disp.map((r) => r.body),
    );
    check(
      "the dispatch has the GitHub headers",
      disp[0].accept === "application/vnd.github+json" && disp[0].auth === "Bearer " + ASK_KEY,
      disp[0],
    );
    check(
      "the question text never leaves in a non-gist request",
      gh.log
        .filter((r) => !r.path.startsWith("/gists"))
        .every((r) => !r.url.includes("helmet") && !r.body.includes("helmet")),
    );
    const feed = await page.evaluate(() => ({
      text: document.getElementById("cn-feed").textContent,
      pulse: !!document.querySelector("#cn-feed .ak-thinking .ak-dots"),
      box: document.getElementById("console-input").value,
      stored: JSON.parse(localStorage.getItem("ask-questions")),
    }));
    check(
      "the feed shows the question and a 'Jarvis is thinking' row with animated dots",
      feed.text.includes(question) && feed.text.includes("Jarvis is thinking") && feed.pulse && feed.box === "",
      feed.text,
    );
    check(
      "the question is kept on this device, marked sent",
      feed.stored[0].state === "sent" && feed.stored[0].id === mine.id,
      feed.stored,
    );
    // cooldown: a second question right away is refused and stays in the box
    await page.fill("#console-input", "What's on my calendar this week?");
    await page.press("#console-input", "Enter");
    await page.waitForTimeout(300);
    const cool = await page.evaluate(() => ({
      toast: document.getElementById("toast").textContent,
      box: document.getElementById("console-input").value,
    }));
    check(
      "10-second cooldown between sends",
      /you can ask again in \d+s/.test(cool.toast) &&
        cool.box === "What's on my calendar this week?" &&
        gh.log.filter((r) => r.method === "PATCH" && r.files.includes("jazz2-ask.json")).length === 1,
      cool,
    );
    // one send at a time
    gh.state.dispatchDelay = 700;
    const two = await page.evaluate(() => {
      ASK_TIMING.cooldown = 0;
      return [askSend("first of two?"), askSend("second of two?")];
    });
    await page.waitForTimeout(1200);
    check(
      "a second send while one is in flight is refused (one dispatch)",
      two[0] === true && two[1] === false && gh.log.filter((r) => r.path === DISPATCH_PATH).length === 2,
      two,
    );
    // a 1,200-character question is cut to 1,000
    gh.state.dispatchDelay = 0;
    await page.evaluate(() => askSend("x".repeat(1200) + "?"));
    await page.waitForTimeout(500);
    check(
      "questions are cut to 1,000 characters",
      gh.read("jazz2-ask.json").items.some((i) => i.text.length === 1000 && /^x+$/.test(i.text)),
    );
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
);

await section("Sort with Jarvis: Capture's preview sends the dump as a sort; chips come back", async () => {
  const gh = askGitHub();
  const a = await openAsk({ route: gh.route, seed: { ...askSync(), "ask-token": ASK_KEY } });
  const dump = "sort the car registration before the 15th, out of coffee";
  await a.page.evaluate((t) => {
    ASK_TIMING.cooldown = 0;
    consolePreview = { src: t, rows: consoleParse(t) };
    renderConsole();
  }, dump);
  check("the preview offers Sort with Jarvis", !!(await a.page.$('#cn-preview [data-action="console-sort"]')));
  await a.page.click('#cn-preview [data-action="console-sort"]');
  await a.page.waitForTimeout(600);
  const sent = gh.read("jazz2-ask.json");
  const item = sent && sent.items[sent.items.length - 1];
  check(
    "the dump goes to the gist as a sort (no thread) and the workflow is started",
    item && item.kind === "sort" && item.text === dump && !item.thread && gh.log.some((r) => r.path === DISPATCH_PATH),
    item,
  );
  const r = await a.page.evaluate(() => ({
    preview: !!consolePreview,
    box: document.getElementById("console-input").value,
    feed: document.getElementById("cn-feed").textContent.replace(/\s+/g, " "),
  }));
  check("the preview closes and the conversation shows it as a Sort", !r.preview && r.box === "" && r.feed.includes("Sort " + dump), r);
  // the answer: 4 chips (more than a question's 3), no Follow up
  const id = item.id;
  const chips = [
    { kind: "todo", text: "Renew car registration", due: "2099-11-15" },
    { kind: "shopping", text: "Coffee" },
    { kind: "todo", text: "Look at a speaking club" },
    { kind: "todo", text: "<img src=x onerror=window.__pwned=1>" },
  ];
  await a.page.evaluate(
    ([id, at, chips]) => {
      writeQuietly(
        ANSWERS_KEY,
        normalizeAnswers({
          version: 1,
          answers: [
            { id, askedAt: at, answeredAt: new Date().toISOString(), status: "ok", text: "Sorted into 3 to-dos and 1 Shopping item.", bullets: [], sources: [], chips, by: "jarvis" },
          ],
          usage: null,
        }),
      );
      renderConsole();
    },
    [id, item.at, chips],
  );
  const ans = await a.page.evaluate((id) => {
    const e = document.querySelector(`[data-ask-entry="${id}"]`);
    return {
      chips: e.querySelectorAll(".rv-chip").length,
      follow: !!e.querySelector('[data-action="ask-follow"]'),
      pwned: !!window.__pwned,
    };
  }, id);
  check("a sort's answer shows all its chips, with no Follow up", ans.chips === 4 && !ans.follow && !ans.pwned, ans);
  const n0 = await a.page.evaluate(() => wantsList.length);
  await a.page.click(`[data-ask-entry="${id}"] .rv-chip[data-index="1"]`);
  check(
    "tapping a chip adds it (here to Shopping)",
    await a.page.evaluate((n) => wantsList.length === n + 1 && wantsList.some((w) => w.name === "Coffee"), n0),
  );
  check("no JS errors", a.errors.length === 0, a.errors);
  await a.ctx.close();
});

await section("ask: without a key it's queued; a refused key warns and queues; expiry warning; sync off", async () => {
  const gh = askGitHub();
  const a = await openAsk({ route: gh.route, seed: askSync() });
  const hint0 = await a.page.textContent("#cn-hint");
  check(
    "without a key the hint says questions wait for the next run",
    /next run/.test(hint0) && /Ask Jarvis key in Sync/.test(hint0),
    hint0,
  );
  await a.page.fill("#console-input", "What should I focus on tomorrow?");
  await a.page.press("#console-input", "Enter");
  await a.page.waitForTimeout(500);
  const q = await a.page.evaluate(() => ({
    feed: document.getElementById("cn-feed").textContent,
    state: JSON.parse(localStorage.getItem("ask-questions"))[0].state,
  }));
  check(
    "no key: written to the gist, not dispatched, shown as queued",
    gh.log.some((r) => r.method === "PATCH") &&
      !gh.log.some((r) => r.path === DISPATCH_PATH) &&
      /Queued — Jarvis will answer on the next run \((today|tomorrow) ~7am\)/.test(q.feed) &&
      q.state === "queued",
    q,
  );
  // a refused key: 401, 403 and 404 all warn
  for (const status of [401, 403, 404]) {
    gh.state.dispatch = status;
    await a.page.evaluate((k) => {
      localStorage.setItem("ask-token", k);
      localStorage.removeItem("ask-token-bad");
      ASK_TIMING.cooldown = 0;
      document.getElementById("toast").textContent = "";
    }, ASK_KEY);
    await a.page.evaluate((s) => askSend(`refused ${s}?`), status);
    await a.page.waitForTimeout(400);
    const r = await a.page.evaluate(() => ({
      toast: document.getElementById("toast").textContent,
      state: JSON.parse(localStorage.getItem("ask-questions"))[0].state,
      flag: localStorage.getItem("ask-token-bad"),
    }));
    check(
      `${status}: "key isn't working" and the question is queued`,
      r.toast === "Ask Jarvis key isn't working — check it in Sync" && r.state === "queued" && r.flag === "1",
      r,
    );
  }
  check("the hint keeps saying the key isn't working", /isn't working/.test(await a.page.textContent("#cn-hint")));
  // network failure: queued, no key warning
  gh.state.dispatch = "abort";
  await a.page.evaluate(() => {
    localStorage.removeItem("ask-token-bad");
    document.getElementById("toast").textContent = "";
    askSend("offline dispatch?");
  });
  await a.page.waitForTimeout(400);
  const net = await a.page.evaluate(() => ({
    toast: document.getElementById("toast").textContent,
    state: JSON.parse(localStorage.getItem("ask-questions"))[0].state,
  }));
  check("a failed dispatch falls back to queued", net.state === "queued" && !/isn't working/.test(net.toast), net);
  // the expiry header: within 14 days shows a gentle warning, a year away doesn't
  gh.state.dispatch = 204;
  const soon = new Date(Date.now() + 5 * 864e5).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  gh.state.expires = soon;
  await a.page.evaluate(() => askSend("expiring?"));
  await a.page.waitForTimeout(400);
  await a.page.evaluate(() => consoleSetMode("ask"));
  const warn = await a.page.evaluate(() => ({
    note: (document.querySelector("#cn-ask-note .ak-warn") || {}).textContent || "",
    exp: Number(localStorage.getItem("ask-token-expires")),
  }));
  check(
    "a key expiring within 14 days shows a warning in Console",
    /expires/.test(warn.note) && /Sync/.test(warn.note) && Math.abs(warn.exp - (Date.now() + 5 * 864e5)) < 864e5,
    warn,
  );
  gh.state.expires = "2027-10-01 09:00:00 -0500";
  await a.page.evaluate(() => askSend("far away?"));
  await a.page.waitForTimeout(400);
  await a.page.evaluate(() => consoleRefreshBox());
  check("a key with time left shows no warning", !(await a.page.$("#cn-ask-note .ak-warn")));
  check(
    "the expiry parser reads GitHub's formats and rejects junk",
    await a.page.evaluate(
      () =>
        askParseExpiry("2027-10-01 09:00:00 -0500") === Date.parse("2027-10-01T14:00:00Z") &&
        askParseExpiry("2027-10-01 09:00:00 UTC") === Date.parse("2027-10-01T09:00:00Z") &&
        askParseExpiry("soon") === null &&
        askParseExpiry(null) === null,
    ),
  );
  check("no JS errors", a.errors.length === 0, a.errors);
  await a.ctx.close();
  // sync off: Ask explains, nothing is sent, Capture still works
  const b = await openAsk({ seed: { "data-updated-at": "1", "todo-content": [] } });
  const reqs = [];
  b.page.on("request", (r) => reqs.push(r.url()));
  const off = await b.page.evaluate(() => ({
    hint: document.getElementById("cn-hint").textContent,
    note: document.getElementById("cn-ask-note").textContent,
    open: !!document.querySelector('#cn-ask-note [data-action="open-sync"]'),
  }));
  check("sync off: Ask says it needs sync, with a way to open Sync", /Ask needs sync/.test(off.hint) && off.open, off);
  await b.page.fill("#console-input", "What's due before payday?");
  await b.page.press("#console-input", "Enter");
  await b.page.waitForTimeout(200);
  const kept = await b.page.evaluate(() => ({
    box: document.getElementById("console-input").value,
    toast: document.getElementById("toast").textContent,
    asks: localStorage.getItem("ask-questions"),
  }));
  check(
    "sync off: the question stays in the box and nothing is stored or sent",
    kept.box === "What's due before payday?" &&
      /needs sync/.test(kept.toast) &&
      kept.asks === null &&
      reqs.every((u) => !u.includes("api.github.com")),
    kept,
  );
  await b.page.tap('.cn-seg[data-mode="capture"]');
  await b.page.fill("#console-input", "dentist fri / buy eggs $5");
  await b.page.press("#console-input", "Enter");
  await b.page.tap("#cn-add");
  check("Capture still works without sync", (await b.page.evaluate(() => todoList.length + wantsList.length)) >= 2);
  check("no JS errors (sync off)", b.errors.length === 0, b.errors);
  await b.ctx.close();
});

await section("ask: Console polls for the answer while visible, stops when hidden or after the window", async () => {
  const gh = askGitHub();
  const { ctx, page, errors } = await openAsk({ route: gh.route, seed: askSync({ "ask-token": ASK_KEY }) });
  await page.evaluate(() => {
    ASK_TIMING.pollEvery = 150;
    ASK_TIMING.pollFor = 60000;
    ASK_TIMING.cooldown = 0;
  });
  const gets = () => gh.log.filter((r) => r.method === "GET" && r.path === "/gists/g0").length;
  await page.evaluate(() => askSend("When will I hit my weight goal?"));
  await page.waitForTimeout(500);
  const id = JSON.parse(gh.gist.files["jazz2-ask.json"].content).items[0].id;
  const g1 = gets();
  await page.waitForTimeout(600);
  check("it polls the gist every few seconds while waiting", gets() >= g1 + 2, [g1, gets()]);
  // hidden: polling stops
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
    Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(200);
  const h1 = gets();
  await page.waitForTimeout(700);
  check("hidden: no polling", gets() === h1, [h1, gets()]);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
    Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // the answer lands in the gist; the poll brings it in
  gh.setFile("jazz2-answers.json", answersFile([answerFixture(id, { askedAt: new Date().toISOString() })]));
  await page.waitForTimeout(2000);
  const got = await page.evaluate(() => ({
    feed: document.getElementById("cn-feed").textContent,
    toast: document.getElementById("toast").textContent,
  }));
  check(
    "visible again: polling resumes and the answer appears",
    got.feed.includes("You have 2 bills before Friday") && !got.feed.includes("on it"),
    got.feed,
  );
  const a1 = gets();
  await page.waitForTimeout(600);
  check("polling stops once answered", gets() === a1, [a1, gets()]);
  // another tab: no polling
  await page.evaluate(() => askSend("Still waiting?"));
  await page.waitForTimeout(400);
  await page.evaluate(() => activateTab("todo"));
  await page.waitForTimeout(300);
  const t1 = gets();
  await page.waitForTimeout(600);
  check("off the Console tab: no polling", gets() === t1, [t1, gets()]);
  // past the window: stops and says so
  await page.evaluate(() => {
    ASK_TIMING.pollFor = 400;
    activateTab("console");
    askPollStart();
  });
  await page.waitForTimeout(1200);
  const w1 = gets();
  await page.waitForTimeout(500);
  const late = await page.textContent("#cn-feed");
  check("after the window: polling stops", gets() === w1, [w1, gets()]);
  check(
    "after the window: 'Still working — you'll get a notification'",
    late.includes("Still working — you'll get a notification"),
    late,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("ask: answers normalizer drops junk, caps sizes, escapes text, survives bad usage", async () => {
  const { ctx, page, errors } = await openAsk({ seed: { "data-updated-at": "1" } });
  const n = await page.evaluate(() => {
    const raw = {
      version: 1,
      answers: [
        "x",
        null,
        [1],
        { id: "<bad>", status: "ok", text: "bad id" },
        { id: "a-bad-status", status: "maybe", text: "nope" },
        {
          id: "a-big-answer",
          askedAt: "2030-01-01T10:00:00Z",
          answeredAt: "2030-01-01T10:01:00Z",
          status: "ok",
          text: "t".repeat(5000),
          bullets: Array.from({ length: 9 }, (_, i) => (i === 2 ? 42 : "b".repeat(400))),
          sources: ["jazz", "evil", "jazz", "news", "calendar", "inbox", "weather", "deliveries", "review"],
          chips: [
            { kind: "todo", text: "Pay rent", due: "2030-02-30" },
            { kind: "hack", text: "nope" },
            { kind: "shopping", text: "s".repeat(300), due: "2030-01-02" },
            { kind: "todo", text: "" },
            { kind: "todo", text: "third" },
            { kind: "todo", text: "fourth" },
            ...Array.from({ length: 12 }, (_, i) => ({ kind: "todo", text: "more " + i })),
          ],
          by: "who",
        },
        { id: "a-big-answer", status: "ok", text: "duplicate" },
        { id: "a-limit-hit", status: "over_limit", askedAt: "nonsense", answeredAt: 5 },
      ],
      usage: {
        day: "today",
        dayCount: NaN,
        dayCostUsd: Infinity,
        week: "2030-W01",
        weekCount: -4,
        month: "2030-01",
        monthCostUsd: "8",
      },
    };
    const out = normalizeAnswers(raw);
    return {
      ids: out.answers.map((a) => a.id),
      big: out.answers.find((a) => a.id === "a-big-answer"),
      limit: out.answers.find((a) => a.id === "a-limit-hit"),
      usage: out.usage,
      wrong: normalizeAnswers({ version: 2, answers: [{ id: "a-xxxxxxxx", status: "ok" }] }).answers.length,
      junk: normalizeAnswers("junk").answers.length,
      many: normalizeAnswers({
        version: 1,
        answers: Array.from({ length: 80 }, (_, i) => ({
          id: "a-many-" + String(i).padStart(3, "0"),
          status: "ok",
          text: "x",
          answeredAt: new Date(2030, 0, 1, 0, i).toISOString(),
        })),
      }).answers,
    };
  });
  check("junk, bad ids and bad statuses are dropped; one per id", n.ids.join() === "a-big-answer,a-limit-hit", n.ids);
  check(
    "text ≤1200, bullets ≤5 × ≤200 strings",
    n.big.text.length === 1200 && n.big.bullets.length === 5 && n.big.bullets.every((b) => b.length === 200),
    n.big.bullets.length,
  );
  check(
    "sources: known ones only, no repeats, ≤6",
    JSON.stringify(n.big.sources) === '["jazz","news","calendar","inbox","weather","deliveries"]',
    n.big.sources,
  );
  check(
    "chips: todo/shopping only, ≤12 (a sort's most), text ≤120, bad dates dropped",
    n.big.chips.length === 12 &&
      n.big.chips[3].text === "fourth" &&
      n.big.chips[0].due === null &&
      n.big.chips[1].text.length === 120 &&
      n.big.chips[1].due === null &&
      n.big.chips[2].text === "third",
    n.big.chips,
  );
  check("by is jarvis unless 'fallback'", n.big.by === "jarvis");
  check("bad dates become empty", n.limit.askedAt === "" && n.limit.answeredAt === "", n.limit);
  check(
    "usage: NaN / Infinity / negative / strings are cleaned",
    n.usage.day === null &&
      n.usage.dayCount === 0 &&
      n.usage.dayCostUsd === 0 &&
      n.usage.week === "2030-W01" &&
      n.usage.weekCount === 0 &&
      n.usage.monthCostUsd === 0,
    n.usage,
  );
  check("other versions and junk files give nothing", n.wrong === 0 && n.junk === 0);
  check("at most 50 answers, newest first", n.many.length === 50 && n.many[0].id === "a-many-079", n.many.length);
  // ingest: stored cleaned; foreign raw URLs and junk change nothing
  const ing = await page.evaluate(async () => {
    const evil = '<img src=x onerror="window.__xss=1">';
    localStorage.setItem(
      "ask-questions",
      JSON.stringify([
        { id: "a-xss-question", text: evil + "?", at: Date.now() - 60000, state: "sent", sentAt: Date.now() - 60000 },
      ]),
    );
    await ingestAnswersFile({
      content: JSON.stringify({
        version: 1,
        answers: [
          {
            id: "a-xss-question",
            status: "ok",
            text: evil,
            bullets: [evil],
            sources: ["jazz"],
            chips: [{ kind: "todo", text: evil }],
            askedAt: new Date().toISOString(),
            answeredAt: new Date().toISOString(),
          },
        ],
      }),
    });
    const before = localStorage.getItem("jarvis-answers");
    await ingestAnswersFile({ truncated: true, raw_url: "https://evil.example/x" });
    await ingestAnswersFile({ content: "not json" });
    await ingestAnswersFile({ content: JSON.stringify({ version: 9 }) });
    await ingestAnswersFile(undefined);
    activateTab("console");
    return {
      same: localStorage.getItem("jarvis-answers") === before,
      xss: window.__xss,
      imgs: document.querySelectorAll("#panel-console img").length,
      text: document.getElementById("cn-feed").textContent,
      synced:
        SYNC_KEYS.some((k) => /ask|answer/.test(k)) ||
        JSON.stringify([collectLocal(), liveData()]).includes("a-xss-question"),
    };
  });
  check("foreign raw URLs, junk and other versions change nothing", ing.same, ing);
  check("answer text is shown as text, never run", !ing.xss && ing.imgs === 0 && ing.text.includes("<img src=x"), ing);
  check("questions and answers are not synced lists or in backups", !ing.synced);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section(
  "ask: answers render honestly (ok / over limit / error / declined), chips add only on tap, Follow up threads",
  async () => {
    const now = Date.now();
    const qs = [
      {
        id: "a-q-ok-000001",
        text: "What's due before payday?",
        at: now - 50 * 60000,
        state: "sent",
        sentAt: now - 50 * 60000,
      },
      {
        id: "a-q-limit-001",
        text: "How did my week go?",
        at: now - 40 * 60000,
        state: "sent",
        sentAt: now - 40 * 60000,
      },
      { id: "a-q-error-001", text: "Plan my Saturday?", at: now - 30 * 60000, state: "queued" },
      { id: "a-q-decl-0001", text: "Write my essay?", at: now - 20 * 60000, state: "queued" },
    ];
    const ans = answersFile(
      [
        answerFixture("a-q-ok-000001", { askedAt: new Date(now - 50 * 60000).toISOString() }),
        answerFixture("a-q-limit-001", {
          status: "over_limit",
          text: "",
          bullets: [],
          sources: [],
          chips: [],
          askedAt: new Date(now - 40 * 60000).toISOString(),
        }),
        answerFixture("a-q-error-001", {
          status: "error",
          text: "",
          chips: [],
          askedAt: new Date(now - 30 * 60000).toISOString(),
        }),
        answerFixture("a-q-decl-0001", {
          status: "declined",
          text: "I can only answer from your Jazz data.",
          chips: [],
          askedAt: new Date(now - 20 * 60000).toISOString(),
        }),
        answerFixture("a-other-dev01", {
          text: "Answer to a laptop question",
          chips: [],
          askedAt: new Date(now - 10 * 60000).toISOString(),
        }),
      ],
      {
        day: isoOffset(0),
        dayCount: 3,
        dayCostUsd: 0.18,
        week: "2030-W01",
        weekCount: 9,
        month: isoOffset(0).slice(0, 7),
        monthCostUsd: 1.2,
      },
    );
    const gh = askGitHub({
      files: {
        "jazz2-answers.json": ans,
        // answered items still in the ask file: the root of the thread followed below, and an unrelated one
        "jazz2-ask.json": {
          version: 1,
          items: [
            {
              id: "a-q-ok-000001",
              kind: "ask",
              text: "What's due before payday?",
              at: new Date(now - 50 * 60000).toISOString(),
            },
            {
              id: "a-q-limit-001",
              kind: "ask",
              text: "How did my week go?",
              at: new Date(now - 30 * 3600e3).toISOString(),
            },
          ],
        },
      },
    });
    const { ctx, page, errors } = await openAsk({
      route: gh.route,
      seed: askSync({
        "ask-questions": qs,
        "jarvis-answers": ans,
        "todo-content": [],
        "wants-content": [],
        "ask-token": ASK_KEY,
      }),
    });
    const r = await page.evaluate(() => {
      const entry = (id) => document.querySelector(`#cn-feed [data-ask-entry="${id}"]`);
      const t = (id) => (entry(id) || {}).textContent || "";
      return {
        ok: t("a-q-ok-000001"),
        okSrc: [...entry("a-q-ok-000001").querySelectorAll(".ak-srcs .jv-src")].map((s) => s.textContent),
        bullets: entry("a-q-ok-000001").querySelectorAll(".ak-bullets li").length,
        chips: entry("a-q-ok-000001").querySelectorAll(".rv-chip").length,
        limit: t("a-q-limit-001"),
        limitCls: !!entry("a-q-limit-001").querySelector(".ak-flagged.ak-over_limit"),
        error: t("a-q-error-001"),
        again: !!entry("a-q-error-001").querySelector('[data-action="ask-again"]'),
        declined: t("a-q-decl-0001"),
        other: t("a-other-dev01"),
        usage: document.getElementById("cn-usage").textContent,
      };
    });
    check("an ok answer shows its text and bullets", r.ok.includes("You have 2 bills") && r.bullets === 2, r.ok);
    check("its sources are tags like the briefing's", JSON.stringify(r.okSrc) === '["Jazz","Calendar"]', r.okSrc);
    check("and its chips", r.chips === 2, r.chips);
    check(
      "over_limit is clearly an over-the-limit answer",
      r.limitCls && /Over the limit/.test(r.limit) && /over the daily question limit/.test(r.limit),
      r.limit,
    );
    check("error says so, with Ask again", /Jarvis couldn't answer/.test(r.error) && r.again, r.error);
    check(
      "declined says so, with Jarvis's reason",
      /Jarvis didn't answer this/.test(r.declined) && /only answer from your Jazz data/.test(r.declined),
      r.declined,
    );
    check(
      "an answer to another device's question still shows",
      /Asked on another device/.test(r.other) && /laptop question/.test(r.other),
      r.other,
    );
    check(
      "today's questions left and this month's spending come from usage",
      r.usage === "7 of 10 questions left today · $1.20 of $8 used this month",
      r.usage,
    );
    // chips: nothing until tapped; then one item with its date, and Undo
    const n0 = await page.evaluate(() => [todoList.length, wantsList.length]);
    await page.tap('#cn-feed .rv-chip[data-ask-id="a-q-ok-000001"][data-index="0"]');
    const added = await page.evaluate(() => ({
      todo: todoList.find((t) => t.text === "Pay Rent"),
      toast: document.getElementById("toast").textContent,
      undo: !!document.querySelector("#toast .toast-action"),
      chip: document.querySelector('#cn-feed .rv-chip[data-ask-id="a-q-ok-000001"][data-index="0"]').className,
      stored: JSON.parse(localStorage.getItem("todo-content")).length,
    }));
    check(
      "a chip adds its to-do only when tapped, with its date",
      n0[0] === 0 && !!added.todo && added.todo.due === isoOffset(1) && added.stored === 1,
      added,
    );
    check(
      "with an Undo toast, and the chip shows Added",
      added.undo && /Added to To-Do/.test(added.toast) && /added/.test(added.chip),
      added,
    );
    await page.tap("#toast .toast-action");
    check("Undo takes it back", (await page.evaluate(() => todoList.length)) === 0);
    await page.tap('#cn-feed .rv-chip[data-ask-id="a-q-ok-000001"][data-index="1"]');
    check(
      "a Shopping chip adds a Shopping item",
      await page.evaluate(
        (w0) => wantsList.length === w0 + 1 && wantsList.some((w) => w.name === "Printer paper"),
        n0[1],
      ),
    );
    check(
      "forged chip metadata does nothing",
      await page.evaluate(() => {
        const n = todoList.length + wantsList.length;
        askAddChip("a-q-ok-000001", 9);
        askAddChip("<x>", 0);
        askAddChip("a-q-limit-001", 0);
        return todoList.length + wantsList.length === n;
      }),
    );
    // Follow up: the next question carries the first question's id
    await page.tap('#cn-feed [data-ask-entry="a-q-ok-000001"] [data-action="ask-follow"]');
    const fu = await page.evaluate(() => ({
      note: document.getElementById("cn-ask-note").textContent,
      ask: document.querySelector('.cn-seg[data-mode="ask"]').getAttribute("aria-pressed"),
      focus: document.activeElement.id,
    }));
    check(
      "Follow up says what it follows, switches to Ask and focuses the box",
      /Following up on “What's due before payday\?”/.test(fu.note) && fu.ask === "true" && fu.focus === "console-input",
      fu,
    );
    await page.fill("#console-input", "And after payday?");
    await page.press("#console-input", "Enter");
    await page.waitForTimeout(500);
    const item = gh.read("jazz2-ask.json").items.find((i) => i.text === "And after payday?");
    check("the follow-up carries thread = the first question's id", !!item && item.thread === "a-q-ok-000001", item);
    const kept = gh.read("jazz2-ask.json").items.map((i) => i.id);
    check(
      "an answered question in a thread active in the last 24h stays in the ask file; unrelated answered ones go",
      kept.includes("a-q-ok-000001") && !kept.includes("a-q-limit-001"),
      kept,
    );
    check(
      "the follow-up note goes away after sending",
      !(await page.textContent("#cn-ask-note")).includes("Following up"),
    );
    // a follow-up of a follow-up keeps the first question's id
    await page.evaluate((id) => {
      const a = JSON.parse(localStorage.getItem("jarvis-answers"));
      a.answers.unshift({
        id,
        askedAt: new Date().toISOString(),
        answeredAt: new Date().toISOString(),
        status: "ok",
        text: "Then $300 free.",
        bullets: [],
        sources: [],
        chips: [],
        by: "jarvis",
      });
      localStorage.setItem("jarvis-answers", JSON.stringify(a));
      ASK_TIMING.cooldown = 0;
      renderConsole();
    }, item.id);
    await page.tap(`#cn-feed [data-ask-entry="${item.id}"] [data-action="ask-follow"]`);
    await page.fill("#console-input", "And next month?");
    await page.press("#console-input", "Enter");
    await page.waitForTimeout(500);
    const item2 = gh.read("jazz2-ask.json").items.find((i) => i.text === "And next month?");
    check("a follow-up's follow-up keeps the root id", !!item2 && item2.thread === "a-q-ok-000001", item2);
    // Cancel drops the thread
    await page.tap('#cn-feed [data-ask-entry="a-q-ok-000001"] [data-action="ask-follow"]');
    await page.tap('[data-action="ask-thread-cancel"]');
    check("Cancel drops the follow-up", (await page.evaluate(() => askThread)) === null);
    // Ask again puts the question back in the box
    await page.tap('#cn-feed [data-ask-entry="a-q-error-001"] [data-action="ask-again"]');
    check(
      "Ask again puts the question back in the box",
      (await page.evaluate(() => document.getElementById("console-input").value)) === "Plan my Saturday?",
    );
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
);

await section("ask: History shows the last 50; the feed keeps today and yesterday; Clear history", async () => {
  const now = Date.now();
  const qs = Array.from({ length: 60 }, (_, i) => ({
    id: "a-hist-" + String(i).padStart(3, "0"),
    text: "Question " + i,
    at: now - i * 8 * 3600e3, // every 8 hours, back 20 days
    state: "queued",
  }));
  const gh = askGitHub({
    files: {
      "jazz2-ask.json": {
        version: 1,
        items: [
          { id: "a-hist-000", kind: "ask", text: "Question 0", at: new Date(now).toISOString() },
          { id: "a-hist-010", kind: "ask", text: "Question 10", at: new Date(now - 80 * 3600e3).toISOString() },
        ],
      },
    },
  });
  const { ctx, page, errors } = await openAsk({ route: gh.route, seed: askSync({ "ask-questions": qs }) });
  const feed = await page.evaluate(() => {
    const ats = [...document.querySelectorAll("#cn-feed [data-ask-entry]")].map((e) =>
      e.getAttribute("data-ask-entry"),
    );
    return {
      n: ats.length,
      labels: [...document.querySelectorAll("#cn-feed .jv-sub-label")].map((l) => l.textContent),
    };
  });
  check(
    "the feed shows only today's and yesterday's questions",
    feed.n >= 3 && feed.n <= 6 && feed.labels.every((l) => l === "Today" || l === "Yesterday"),
    feed,
  );
  await page.tap('[data-action="ask-history"]');
  const h = await page.evaluate(() => ({
    open: document.getElementById("ask-sheet").classList.contains("open"),
    ids: [...document.querySelectorAll("#ask-body [data-ask-entry]")].map((e) => e.getAttribute("data-ask-entry")),
    focus: document.activeElement.id,
    inert: document.querySelector("main").inert,
    clear: !!document.querySelector('#ask-body [data-action="ask-clear"]'),
  }));
  check(
    "History opens as a sheet with focus inside and the page behind it inert",
    h.open && h.focus === "ask-title" && h.inert,
    h,
  );
  check(
    "History lists the last 50, newest first",
    h.ids.length === 50 && h.ids[0] === "a-hist-000" && h.ids[49] === "a-hist-049",
    [h.ids.length, h.ids[0], h.ids[49]],
  );
  await page.keyboard.press("Escape");
  const closed = await page.evaluate(() => ({
    open: document.getElementById("ask-sheet").classList.contains("open"),
    focus: document.activeElement.getAttribute("data-action"),
  }));
  check("Escape closes it and focus goes back to History", !closed.open && closed.focus === "ask-history", closed);
  await page.tap('[data-action="ask-history"]');
  const before = gh.log.length;
  await page.tap('#ask-body [data-action="ask-clear"]');
  const cleared = await page.evaluate(() => ({
    feed: document.querySelectorAll("#cn-feed [data-ask-entry]").length,
    hist: document.querySelectorAll("#ask-body [data-ask-entry]").length,
    stored: JSON.parse(localStorage.getItem("ask-questions")),
    clear: Number(localStorage.getItem("ask-clear-before")),
    toast: document.getElementById("toast").textContent,
  }));
  check(
    "Clear history hides everything on this device at once",
    cleared.feed === 0 && cleared.hist === 0 && cleared.stored.length === 0 && /cleared/.test(cleared.toast),
    cleared,
  );
  await page.waitForTimeout(500);
  const ops = gh.log.slice(before);
  const file = gh.read("jazz2-ask.json");
  check(
    "and sets clearBefore in jazz2-ask.json (re-read first, that file only)",
    ops.some((r) => r.method === "GET") &&
      ops.filter((r) => r.method === "PATCH").every((r) => r.files.join() === "jazz2-ask.json") &&
      Math.abs(Date.parse(file.clearBefore) - cleared.clear) < 1000 &&
      file.items.length === 0,
    file,
  );
  // a question asked on another device after the clear still shows; older ones don't come back
  await page.evaluate(async () => {
    await ingestAskFile({
      content: JSON.stringify({
        version: 1,
        items: [
          { id: "a-hist-001", kind: "ask", text: "Question 1", at: new Date(Date.now() - 3600e3).toISOString() },
          { id: "a-new-laptop", kind: "ask", text: "From the laptop", at: new Date(Date.now() + 1000).toISOString() },
        ],
        clearBefore: new Date(Number(localStorage.getItem("ask-clear-before"))).toISOString(),
      }),
    });
  });
  const after = await page.evaluate(() =>
    [...document.querySelectorAll("#cn-feed [data-ask-entry]")].map((e) => e.getAttribute("data-ask-entry")),
  );
  check("after a clear, only newer questions show", after.join() === "a-new-laptop", after);
  await page.evaluate(() => closeAskHistory());
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
  // a clear done on another device (newer clearBefore in the gist) clears this one too
  const b = await openAsk({ seed: { "ask-questions": qs.slice(0, 3) } });
  await b.page.evaluate(async () =>
    ingestAskFile({ content: JSON.stringify({ version: 1, items: [], clearBefore: new Date().toISOString() }) }),
  );
  check(
    "a Clear history from another device clears this one",
    (await b.page.evaluate(() => loadAskEntries().length)) === 0,
  );
  await b.ctx.close();
});

await section("ask: ?tab=console&ask=<id> opens Console at that answer, now or when it syncs", async () => {
  const now = Date.now();
  const qs = [
    { id: "a-link-today1", text: "Linked question?", at: now - 600000, state: "sent", sentAt: now - 600000 },
    { id: "a-link-older1", text: "Old linked question?", at: now - 4 * 864e5, state: "sent", sentAt: now - 4 * 864e5 },
  ];
  const ans = answersFile([
    answerFixture("a-link-today1", { askedAt: new Date(now - 600000).toISOString() }),
    answerFixture("a-link-older1", { askedAt: new Date(now - 4 * 864e5).toISOString(), text: "Old answer" }),
  ]);
  const a = await openAsk({
    query: "?tab=console&ask=a-link-today1",
    seed: { "ask-questions": qs, "jarvis-answers": ans },
  });
  const r = await a.page.evaluate(() => ({
    tab: currentTab,
    hit: !!document.querySelector('#cn-feed [data-ask-entry="a-link-today1"].ak-hit'),
    focus: document.activeElement.getAttribute("data-ask-entry"),
    url: location.search,
  }));
  check("the link opens Console at that answer", r.tab === "console" && r.hit && r.focus === "a-link-today1", r);
  check("the query is cleared", r.url === "", r.url);
  check("no JS errors", a.errors.length === 0, a.errors);
  await a.ctx.close();
  const b = await openAsk({
    query: "?tab=console&ask=a-link-older1",
    seed: { "ask-questions": qs, "jarvis-answers": ans },
  });
  check(
    "an older answer opens in History",
    await b.page.evaluate(
      () =>
        document.getElementById("ask-sheet").classList.contains("open") &&
        !!document.querySelector('#ask-body [data-ask-entry="a-link-older1"].ak-hit'),
    ),
  );
  await b.ctx.close();
  const c = await openAsk({ query: "?tab=console&ask=a-link-today1", seed: { "ask-questions": qs } });
  const early = await c.page.evaluate(
    () => !!document.querySelector('#cn-feed [data-ask-entry="a-link-today1"] .ak-ans'),
  );
  await c.page.evaluate(async (f) => ingestAnswersFile({ content: JSON.stringify(f) }), ans);
  const late = await c.page.evaluate(() => ({
    ans: !!document.querySelector('#cn-feed [data-ask-entry="a-link-today1"] .ak-ans'),
    focus: document.activeElement.getAttribute("data-ask-entry"),
  }));
  check(
    "an answer not synced yet is shown and focused once it arrives",
    !early && late.ans && late.focus === "a-link-today1",
    late,
  );
  await c.ctx.close();
  const d = await openAsk({ query: "?tab=console&ask=%3Cscript%3E" });
  check(
    "a malformed id does nothing",
    (await d.page.evaluate(() => askPendingLink)) === null && d.errors.length === 0,
    d.errors,
  );
  await d.ctx.close();
});

await section("ask: no suggested questions, and no hint line once Ask is ready", async () => {
  const { ctx, page, errors } = await openAsk({ seed: askSync({ "ask-token": ASK_KEY }) });
  const r = await page.evaluate(() => ({
    fn: typeof askSuggestions,
    chips: document.querySelectorAll("#cn-chips .cn-chip").length,
    chipsShown: getComputedStyle(document.getElementById("cn-chips")).display,
    hint: document.getElementById("cn-hint").textContent,
    hintShown: getComputedStyle(document.getElementById("cn-hint")).display,
  }));
  check(
    "no Ask chips, and the empty row takes no space",
    r.fn === "undefined" && r.chips === 0 && r.chipsShown === "none",
    r,
  );
  check("no 'Jarvis answers from…' hint", r.hint === "" && r.hintShown === "none", r);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section(
  "voice: mic hidden without the Speech API; in the box and quick add with it; 44px; no overflow",
  async () => {
    const none = await openAsk({ speech: "none", query: "?tab=console" });
    check(
      "no Speech API: no mic in Console or Home (keyboard dictation still works)",
      await none.page.evaluate(() => {
        activateTab("home");
        return !document.querySelector(".vc-mic") && !voiceSupported();
      }),
    );
    await none.ctx.close();
    for (const theme of ["dark", "light"]) {
      const { ctx, page, errors } = await openAsk({ seed: { "theme-pref": theme } });
      const r = await page.evaluate(() => {
        const box = document.querySelector(".cn-box");
        const kids = [...box.children].filter((c) => c.tagName !== "LABEL").map((c) => c.className.split(" ")[0]);
        const mic = document.getElementById("vc-mic-console").getBoundingClientRect();
        activateTab("home");
        const qmic = document.getElementById("vc-mic-quick");
        const qkids = [...document.querySelector(".jv-quick").children].map((c) => c.className.split(" ")[0]);
        return {
          kids,
          qkids,
          mic: [mic.width, mic.height],
          q: qmic ? [qmic.getBoundingClientRect().width, qmic.getBoundingClientRect().height] : null,
          pageW: document.scrollingElement.scrollWidth,
          w: innerWidth,
          label: qmic && qmic.getAttribute("aria-label"),
        };
      });
      check(
        `${theme}: the mic sits left of send in Console's box`,
        r.kids.join() === "cn-input,vc-mic,cn-send",
        r.kids,
      );
      check(
        `${theme}: and left of + in Home's quick add`,
        r.qkids.join() === "jv-quick-input,vc-mic,jv-quick-add",
        r.qkids,
      );
      check(
        `${theme}: 44px targets, labelled`,
        r.mic[0] >= 44 && r.mic[1] >= 44 && r.q[0] >= 44 && r.q[1] >= 44 && /Speak/.test(r.label),
        r,
      );
      check(`${theme}: no sideways scroll at 390px`, r.pageW <= r.w, r);
      check(`no JS errors (${theme})`, errors.length === 0, errors);
      await ctx.close();
    }
  },
);

await section("voice: what's said fills the box, a question flips to Ask, nothing is ever sent by itself", async () => {
  const gh = askGitHub();
  const { ctx, page, errors } = await openAsk({ route: gh.route, seed: askSync({ "ask-token": ASK_KEY }) });
  await page.tap('.cn-seg[data-mode="capture"]'); // locked to Capture with an empty box
  await page.tap("#vc-mic-console");
  const on = await page.evaluate(() => ({
    pressed: document.getElementById("vc-mic-console").getAttribute("aria-pressed"),
    cls: document.getElementById("vc-mic-console").className,
    label: document.getElementById("vc-mic-console").getAttribute("aria-label"),
    hint: document.getElementById("cn-hint").textContent,
    rec: { lang: __rec().lang, interim: __rec().interimResults, cont: __rec().continuous, started: __rec().started },
  }));
  await page.waitForTimeout(120);
  const live = await page.evaluate(() => (document.getElementById("live-status") || {}).textContent);
  check(
    "listening: mic pressed and pulsing, Stop listening label",
    on.pressed === "true" && /\bon\b/.test(on.cls) && on.label === "Stop listening",
    on,
  );
  check(
    "listening: hint says so and notes Google does the speech-to-text in Chrome",
    /^Listening…/.test(on.hint) && /Google/.test(on.hint),
    on.hint,
  );
  check("listening is announced", live === "Listening", live);
  check(
    "en-US, interim results, stops on silence",
    on.rec.lang === "en-US" && on.rec.interim === true && on.rec.cont === false && on.rec.started === 1,
    on.rec,
  );
  const patches0 = gh.log.filter((r) => r.method === "PATCH" && r.files.includes("jazz2-ask.json")).length;
  await page.evaluate(() => __say("what's due"));
  const interim = await page.evaluate(() => document.getElementById("console-input").value);
  await page.evaluate(() => __say("what's due ", "before payday"));
  await page.evaluate(() => __rec().onend());
  await page.waitForTimeout(150);
  const done = await page.evaluate(() => ({
    box: document.getElementById("console-input").value,
    ask: document.querySelector('.cn-seg[data-mode="ask"]').getAttribute("aria-pressed"),
    pressed: document.getElementById("vc-mic-console").getAttribute("aria-pressed"),
    focus: document.activeElement.id,
    feed: document.querySelectorAll("#cn-feed [data-ask-entry]").length,
  }));
  check("interim results stream into the box", interim === "what's due", interim);
  check("the transcript fills the box", done.box === "what's due before payday", done);
  check("a spoken question flips the guess to Ask", done.ask === "true", done);
  check(
    "when it ends the mic is off and the box is focused for review",
    done.pressed === "false" && done.focus === "console-input",
    done,
  );
  await page.waitForTimeout(300);
  check(
    "nothing is sent by voice",
    done.feed === 0 &&
      gh.log.filter((r) => r.method === "PATCH" && r.files.includes("jazz2-ask.json")).length === patches0 &&
      !gh.log.some((r) => r.path === DISPATCH_PATH),
  );
  // a second tap stops it
  await page.fill("#console-input", "");
  await page.tap("#vc-mic-console");
  await page.tap("#vc-mic-console");
  await page.waitForTimeout(100);
  check(
    "a second tap stops listening",
    await page.evaluate(
      () =>
        __rec().stopped === 1 &&
        !voiceListening() &&
        document.getElementById("vc-mic-console").getAttribute("aria-pressed") === "false",
    ),
  );
  // errors
  for (const [code, msg] of [
    ["not-allowed", "Microphone blocked: allow it in your browser settings"],
    ["no-speech", "Didn't hear anything. Tap the mic and try again"],
    ["network", "Voice needs an internet connection. You can still type"],
  ]) {
    await page.evaluate(() => (document.getElementById("toast").textContent = ""));
    await page.tap("#vc-mic-console");
    await page.evaluate((c) => __fail(c), code);
    const t = await page.evaluate(() => ({
      toast: document.getElementById("toast").textContent,
      pressed: document.getElementById("vc-mic-console").getAttribute("aria-pressed"),
    }));
    check(`${code}: "${msg}"`, t.toast === msg && t.pressed === "false", t);
  }
  // Capture is unaffected: a spoken list previews as usual
  await page.fill("#console-input", "");
  await page.tap("#vc-mic-console");
  await page.evaluate(() => {
    __say("dentist fri / buy eggs $5");
    __rec().onend();
  });
  await page.waitForTimeout(80);
  const cap = await page.evaluate(() =>
    document.querySelector('.cn-seg[data-mode="capture"]').getAttribute("aria-pressed"),
  );
  await page.press("#console-input", "Enter");
  const rows = await page.$$eval(".cn-row .cn-tag", (t) => t.map((x) => x.textContent));
  check("a spoken list is a Capture with the usual preview", cap === "true" && rows.join() === "To-do,Shopping", rows);
  // leaving the tab stops listening
  await page.tap('[data-action="console-edit"]');
  await page.tap("#vc-mic-console");
  await page.evaluate(() => activateTab("todo"));
  check("switching tabs stops the mic", await page.evaluate(() => !voiceListening() && __rec().aborted === 1));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("voice: Home's quick add fills from speech and adds only on +", async () => {
  const { ctx, page, errors } = await openAsk({
    query: "?tab=home",
    seed: { "data-updated-at": "1", "todo-content": [] },
  });
  await page.tap("#vc-mic-quick");
  const on = await page.evaluate(() => ({
    pressed: document.getElementById("vc-mic-quick").getAttribute("aria-pressed"),
    ph: document.getElementById("jv-quick").placeholder,
  }));
  check("listening shows on the quick add", on.pressed === "true" && on.ph === "Listening…", on);
  await page.evaluate(() => {
    __say("call mom tomorrow");
    __rec().onend();
  });
  await page.waitForTimeout(80);
  const filled = await page.evaluate(() => ({
    box: document.getElementById("jv-quick").value,
    kept: dashQuickText,
    n: todoList.length,
    ph: document.getElementById("jv-quick").placeholder,
  }));
  check(
    "the transcript fills the quick add and nothing is added yet",
    filled.box === "call mom tomorrow" &&
      filled.kept === "call mom tomorrow" &&
      filled.n === 0 &&
      filled.ph === "Add a to-do",
    filled,
  );
  await page.tap('[data-action="jv-quick-add"]');
  check(
    "+ adds it with its date",
    await page.evaluate(
      () => todoList.length === 1 && todoList[0].text === "call mom" && todoList[0].due === addDaysIso(1),
    ),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

// ---------- Calendar history on the Planner (js/calendar.js) ----------
const calFile = (events, over = {}) => ({
  version: 1,
  generatedAt: new Date().toISOString(),
  tz: "America/New_York",
  from: isoOffset(-90),
  to: isoOffset(60),
  events,
  ...over,
});
const calEv = (date, start, end, title, location = "") => ({
  date,
  start,
  end,
  allDay: start === null,
  title,
  location,
});

await section("calendar: sync pulls jazz2-calendar.json, keeps it on this device only, never pushes it", async () => {
  const now = Date.now();
  const file = calFile([
    calEv(isoOffset(0), "09:00", "10:00", "Standup", "Zoom"),
    calEv(isoOffset(0), null, null, "Mom's birthday"),
    calEv(isoOffset(-200), "09:00", "10:00", "Out of range"),
  ]);
  const gist = {
    id: "g0",
    files: {
      "jazz2-data.json": { truncated: false, content: JSON.stringify({ updatedAt: now - 1000, data: {} }) },
      "jazz2-calendar.json": { truncated: false, content: JSON.stringify(file) },
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
    seed: { "sync-token": "tok", "sync-gist-id": "g0", "data-updated-at": String(now) },
  });
  const external = [];
  page.on("request", (req) => {
    const host = new URL(req.url()).hostname;
    if (host !== "127.0.0.1") external.push(host);
  });
  // a truncated file is fetched from the gist's raw host only
  const rawFile = calFile([calEv(isoOffset(1), "08:00", "08:30", "From raw")]);
  let rawHits = 0;
  await ctx.route("https://gist.githubusercontent.com/**", (r) => {
    rawHits++;
    return r.fulfill({ status: 200, contentType: "text/plain", body: JSON.stringify(rawFile) });
  });
  await ctx.route("https://evil.example/**", (r) => r.fulfill({ status: 200, body: JSON.stringify(rawFile) }));
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("jarvis-calendar") || "null");
    return {
      titles: ((stored && stored.events) || []).map((e) => e.title),
      inSyncKeys: SYNC_KEYS.includes("jarvis-calendar"),
      planner: !!document.querySelector("#panel-home .home-events"),
    };
  });
  check("calendar stored on this device, cleaned and sorted", r.titles.join() === "Mom's birthday,Standup", r);
  check("calendar is not a synced list", !r.inSyncKeys);
  check("the Planner shows it once it arrives", r.planner);
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
  check("gist calendar untouched", gist.files["jazz2-calendar.json"].content === JSON.stringify(file));
  const after = await page.evaluate(async (f) => {
    const before = localStorage.getItem("jarvis-calendar");
    await ingestCalendarFile({ content: JSON.stringify(f) }); // the same file again
    await ingestCalendarFile({ truncated: true, raw_url: "https://evil.example/x" });
    await ingestCalendarFile({ truncated: true, raw_url: "javascript:alert(1)" });
    await ingestCalendarFile({ content: "not json" });
    await ingestCalendarFile({ content: JSON.stringify({ version: 2, from: "x", to: "y", events: [] }) });
    await ingestCalendarFile(undefined);
    return localStorage.getItem("jarvis-calendar") === before;
  }, file);
  check("repeats, junk and foreign raw URLs change nothing", after);
  check("nothing fetched from a foreign raw URL", !external.includes("evil.example"), external);
  const viaRaw = await page.evaluate(async () => {
    await ingestCalendarFile({ truncated: true, raw_url: "https://gist.githubusercontent.com/u/g0/raw/cal.json" });
    return JSON.parse(localStorage.getItem("jarvis-calendar")).events.map((e) => e.title);
  });
  check("a truncated file is read from gist.githubusercontent.com", rawHits === 1 && viaRaw.join() === "From raw", {
    rawHits,
    viaRaw,
  });
  check(
    "sync payload and backup leave the calendar out",
    !(await page.evaluate(() => JSON.stringify([collectLocal(), liveData()]).includes("From raw"))),
  );
  check(
    "no network beyond the gist",
    external.every((h) => h === "api.github.com" || h === "gist.githubusercontent.com"),
    external,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("calendar: normalizer drops junk, caps sizes and escapes text", async () => {
  const { ctx, page, errors } = await openApp();
  const r = await page.evaluate(
    ({ from, to, inRange, outRange }) => {
      const evil = '<img src=x onerror="window.__pwn=1"><script>window.__pwn=1</script>';
      const base = { version: 1, from, to };
      const bad = [
        null,
        "nope",
        { ...base, version: 2, events: [] },
        { ...base, from: "2030-02-30", events: [] },
        { ...base, from: to, to: from, events: [] },
        { version: 1, events: [] },
      ].map((x) => normalizeCalendar(x));
      const cal = normalizeCalendar({
        ...base,
        generatedAt: "not a date",
        events: [
          { date: inRange, start: "14:00", end: "15:00", allDay: false, title: "B later" },
          { date: inRange, start: "09:00", end: "09:30", allDay: false, title: "A first" },
          { date: inRange, start: null, end: null, allDay: true, title: "All day" },
          { date: inRange, start: "25:00", end: "26:00", allDay: false, title: "Bad time" }, // → all-day
          { date: inRange, start: "10:00", end: "9:5", allDay: "true", title: "Bad end" }, // end dropped
          { date: "2030-02-30", start: null, end: null, allDay: true, title: "Bad date" },
          { date: outRange, start: null, end: null, allDay: true, title: "Out of range" },
          { date: inRange, start: null, end: null, allDay: true, title: "   " },
          { date: inRange, start: null, end: null, allDay: true, title: 42 },
          {
            date: inRange,
            start: null,
            end: null,
            allDay: true,
            title: evil + "x".repeat(500),
            location: "y".repeat(500),
          },
          { date: inRange, start: null, end: null, allDay: true, title: "Line\nbreak\u0000here" },
          "junk",
          null,
          [],
        ],
      });
      const many = normalizeCalendar({
        ...base,
        events: Array.from({ length: 2400 }, (_, i) => ({
          date: inRange,
          start: null,
          end: null,
          allDay: true,
          title: "E" + i,
        })),
      });
      localStorage.setItem(
        "jarvis-calendar",
        JSON.stringify({
          ...base,
          events: [{ date: inRange, start: "09:00", end: null, allDay: false, title: evil, location: evil }],
        }),
      );
      selectHomeDate(inRange);
      const html = document.getElementById("panel-home").innerHTML;
      return {
        bad,
        titles: cal.events.map((e) => e.title.slice(0, 12)),
        gen: cal.generatedAt,
        evil: cal.events.find((e) => e.title.startsWith("<img")),
        badTime: cal.events.find((e) => e.title === "Bad time"),
        badEnd: cal.events.find((e) => e.title === "Bad end"),
        line: cal.events.find((e) => e.title.startsWith("Line")).title,
        many: many.events.length,
        injected:
          !!document.querySelector("#panel-home .home-events img, #panel-home .home-events script") || !!window.__pwn,
        escaped: html.includes("&lt;img"),
      };
    },
    { from: isoOffset(-5), to: isoOffset(5), inRange: isoOffset(1), outRange: isoOffset(9) },
  );
  check(
    "bad files are rejected whole",
    r.bad.every((x) => x === null),
    r.bad,
  );
  check(
    "junk events dropped; by date, all-day first, then start",
    r.titles.join("|") === "All day|Bad time|<img src=x o|Line break h|A first|Bad end|B later",
    r.titles,
  );
  check("a bad generatedAt is cleared", r.gen === "", r.gen);
  check("title capped at 80, location at 60", r.evil.title.length === 80 && r.evil.location.length === 60, r.evil);
  check("an invalid start makes it all-day", r.badTime.allDay && r.badTime.start === null && r.badTime.end === null);
  check(
    "an invalid end is dropped; allDay must be a real boolean",
    !r.badEnd.allDay && r.badEnd.start === "10:00" && r.badEnd.end === null,
    r.badEnd,
  );
  check("control characters become spaces", r.line === "Line break here", r.line);
  check("at most 1500 events", r.many === 1500, r.many);
  check("hostile text renders escaped", r.escaped && !r.injected, r);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("calendar: Planner day view, hero count, strip + month indicators, out-of-range days", async () => {
  const today = isoOffset(0),
    past = isoOffset(-3),
    other = isoInWeek(1); // another day in this week, with one event
  const inMonthEmpty = isoInMonth(2); // a day in this month with no events
  const file = calFile(
    [
      calEv(today, "23:59", null, "Late call", "Phone"),
      calEv(today, "00:00", "00:01", "Early check-in", ""),
      calEv(today, null, null, "Mom's birthday"),
      calEv(today, "12:00", "13:00", "Lunch with Sam", "Cafe"),
      calEv(past, "09:00", "09:30", "Standup", "Zoom"),
      calEv(other, null, null, "Trip"),
      calEv(isoOffset(9), "10:00", "11:00", "Beyond the range"),
    ],
    { from: isoOffset(-5), to: isoOffset(5) },
  );
  const { ctx, page, errors } = await openApp({ seed: { "jarvis-calendar": file, "todo-content": [] } });
  const day = () =>
    page.evaluate(() => {
      const box = document.querySelector("#panel-home .home-events");
      return {
        has: !!box,
        sec: [...document.querySelectorAll("#panel-home .home-sec")].map((s) => s.textContent.trim())[0] || "",
        chips: box ? [...box.querySelectorAll(".jv-cal-allday span")].map((s) => s.textContent) : [],
        rows: box
          ? [...box.querySelectorAll(".jv-cal-ev")].map((li) => ({
              title: li.querySelector(".jv-cal-what b").textContent,
              time: li.querySelector(".jv-cal-time b").textContent,
              loc: (li.querySelector(".jv-cal-what > span:not(.home-ev-sr)") || {}).textContent || "",
              past: li.classList.contains("past"),
              sr: li.textContent.replace(/\s+/g, " ").trim(),
            }))
          : [],
        sub: document.querySelector("#panel-home .home-hero .sub").textContent,
        actions: box ? box.querySelectorAll("[data-action], button, a").length : 0,
      };
    });
  const t = await day();
  const nowMin = await page.evaluate(() => new Date().getHours() * 60 + new Date().getMinutes());
  check("today shows a Calendar section first", t.has && t.sec === "Calendar", t);
  check("all-day events as chips", t.chips.join() === "Mom's birthday", t.chips);
  check(
    "timed events in start order with times and locations",
    t.rows.map((x) => `${x.time} ${x.title} ${x.loc}`).join("|") ===
      "12a Early check-in |12p Lunch with Sam Cafe|11:59p Late call Phone",
    t.rows,
  );
  check("today's finished events dim, upcoming ones don't", t.rows[0].past === nowMin >= 1 && !t.rows[2].past, t.rows);
  check("rows read well to a screen reader", t.rows[1].sr.startsWith("12p to 1p, Lunch with Sam, Cafe"), t.rows[1].sr);
  check("events are read-only", t.actions === 0, t.actions);
  check("hero adds the event count", t.sub.includes("· 4 events"), t.sub);
  const strip = await page.evaluate(
    ({ today, other, empty }) => {
      const cell = (iso) => document.querySelector(`#panel-home .home-week [data-date="${iso}"]`);
      return {
        todayEv: !!cell(today).querySelector(".marks .ev"),
        todayLabel: cell(today).getAttribute("aria-label"),
        otherEv: !!cell(other).querySelector(".marks .ev"),
        otherLabel: cell(other).getAttribute("aria-label"),
        evCount: document.querySelectorAll("#panel-home .home-week .marks .ev").length,
      };
    },
    { today, other },
  );
  check("strip marks today and labels it", strip.todayEv && strip.todayLabel.includes("4 events"), strip);
  check("strip marks another day with 1 event", strip.otherEv && strip.otherLabel.includes("1 event"), strip);
  // past day: rows not dimmed
  await page.evaluate((d) => selectHomeDate(d), past);
  const p = await day();
  check(
    "a past day lists its events, undimmed",
    p.rows.length === 1 && p.rows[0].title === "Standup" && !p.rows[0].past,
    p,
  );
  check("past day hero counts it", p.sub.endsWith("· 1 event"), p.sub);
  // month view
  await page.evaluate((d) => {
    selectHomeDate(d);
    setHomeCalOpen(true);
  }, today);
  const m = await page.evaluate(
    ({ today, empty }) => {
      const cell = (iso) => document.querySelector(`#panel-home .home-month [data-date="${iso}"]:not(.other)`);
      return {
        todayEv: !!cell(today).querySelector(".marks .ev"),
        label: cell(today).getAttribute("aria-label"),
        emptyEv: !!cell(empty).querySelector(".marks .ev"),
        emptyLabel: cell(empty).getAttribute("aria-label"),
      };
    },
    { today, empty: inMonthEmpty },
  );
  check("month view marks days with events", m.todayEv && m.label.includes("4 events"), m);
  check(
    "days without events get no mark",
    inMonthEmpty === other || (!m.emptyEv && !m.emptyLabel.includes("event")),
    m,
  );
  // outside the imported range: nothing at all
  await page.evaluate((d) => selectHomeDate(d), isoOffset(9));
  const o = await day();
  check("a day outside the range shows no events and no 'free'", !o.has && !o.sub.includes("event"), o);
  // not connected: no file, nothing changes
  await page.evaluate((d) => {
    localStorage.removeItem("jarvis-calendar");
    setHomeCalOpen(false);
    selectHomeDate(d);
  }, today);
  const n = await page.evaluate(() => ({
    box: !!document.querySelector("#panel-home .home-events"),
    marks: document.querySelectorAll("#panel-home .marks .ev").length,
    sub: document.querySelector("#panel-home .home-hero .sub").textContent,
    labels: [...document.querySelectorAll("#panel-home .home-day")].some((b) =>
      b.getAttribute("aria-label").includes("event"),
    ),
  }));
  check("with no file the Planner is unchanged", !n.box && n.marks === 0 && !n.sub.includes("event") && !n.labels, n);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("console: 'Hey Jarvis' wake word routes to Ask, to-do or list; the conversation folds", async () => {
  const { ctx, page, errors } = await openApp();
  const r = await page.evaluate(() =>
    [
      "hey Jarvis what's my next payday",
      "Hey Jarvis, to-do call mom tomorrow",
      "hey jarvis list eggs and milk",
      "OK Jarvis, add to my shopping list: helmet $250",
      "Jarvis remind me to pay rent sunday",
      "list: bread, butter",
      "listen to podcast",
    ].map((x) => [
      consoleGuess(x),
      consoleParse(x)
        .map((row) => `${row.type}:${row.src}`)
        .join("|"),
    ]),
  );
  check(
    "wake word + question → Ask; + to-do → to-do; + list → Shopping items",
    JSON.stringify(r) ===
      JSON.stringify([
        ["ask", "ask:hey Jarvis what's my next payday"],
        ["capture", "todo:call mom tomorrow"],
        ["capture", "shop:eggs|shop:milk"],
        ["capture", "shop:helmet $250"],
        ["capture", "todo:pay rent sunday"],
        ["capture", "shop:bread|shop:butter"],
        ["capture", "todo:listen to podcast"],
      ]),
    r,
  );
  // Home's quick add: "to-do" adds there; a list goes on to Console's preview
  const before = await page.evaluate(() => todoList.length);
  await page.fill("#jv-quick", "Hey Jarvis, to-do water plants friday");
  await page.press("#jv-quick", "Enter");
  const added = await page.evaluate(() => todoList.find((t) => t.text.toLowerCase().startsWith("water plants")));
  check(
    "quick add: wake word + to-do adds the to-do without the wake word",
    !!added && (await page.evaluate(() => todoList.length)) === before + 1,
    added,
  );
  await page.fill("#jv-quick", "hey jarvis list eggs and milk");
  await page.press("#jv-quick", "Enter");
  const handed = await page.evaluate(() => ({
    tab: document.body.dataset.tab,
    rows: [...document.querySelectorAll("#cn-preview .cn-row")].length,
  }));
  check(
    "quick add: wake word + list opens Console with the items to confirm",
    handed.tab === "console" && handed.rows === 2,
    handed,
  );
  // the conversation section sits above the review card and folds
  await page.evaluate(() => {
    consoleLog({ kind: "capture", text: "x", at: Date.now(), todos: 1, shop: 0 });
    renderConsole();
  });
  const order = await page.evaluate(() => {
    const f = document.getElementById("cn-feed"),
      rv = document.getElementById("cn-review");
    return !!(f.compareDocumentPosition(rv) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  check("the conversation comes before the week in review", order);
  const tog = '#cn-feed [data-action="console-feed-toggle"]';
  if (await page.$(tog)) {
    await page.click(tog);
    const closed = await page.evaluate(() => ({
      hidden: document.getElementById("cn-feed-body").hidden,
      exp: document.querySelector('[data-action="console-feed-toggle"]').getAttribute("aria-expanded"),
      kept: localStorage.getItem("console-feed-open"),
    }));
    check(
      "Hide folds it, says so, and remembers",
      closed.hidden && closed.exp === "false" && closed.kept === "0",
      closed,
    );
  } else check("the conversation has a Hide/Show toggle", false);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("inbox detail opens Gmail; Jazz 3.0 goal bars stay thin", async () => {
  const b = briefingFixture();
  b.cards.inbox = {
    status: "ok",
    agent: "Inbox",
    model: "m",
    updatedAt: new Date().toISOString(),
    data: {
      unread: 3,
      urgent: [{ from: 'Bank "of" <America>', summary: "Verify a card" }],
      needsReply: [{ from: "Sam Lee", summary: "Lunch?" }],
      bills: [],
    },
  };
  const { ctx, page, errors } = await openApp({ seed: { "jarvis-briefing": b } });
  check("the tile says how many are new", (await page.textContent('.jv-tile[data-go="inbox"]')).includes("3 new"));
  await page.tap('.jv-tile[data-go="inbox"]');
  const r = await page.evaluate(() =>
    [...document.querySelectorAll("#jv-detail-inbox a")].map((a) => ({
      href: a.getAttribute("href"),
      target: a.getAttribute("target"),
      h: a.getBoundingClientRect().height,
      html: a.innerHTML,
    })),
  );
  check(
    "each row searches Gmail for its sender (encoded), and there's an Open Gmail link",
    r.length === 3 &&
      r[0].href.startsWith("https://mail.google.com/mail/u/0/#search/") &&
      decodeURIComponent(r[1].href).includes('from:"Sam Lee"') &&
      r[2].href === "https://mail.google.com/mail/u/0/#inbox" &&
      r.every((a) => a.target === "_blank" && a.h >= 44) &&
      !r[0].html.includes("<America>"),
    r,
  );
  // goal bars: 8px tall, label above (not overlapping)
  await page.tap('.jv-tile[data-go="jazz3"]');
  const bars = await page.evaluate(() =>
    [...document.querySelectorAll("#jv-detail-jazz3 .jv-goal")].map((g) => {
      const bar = g.querySelector(".jv-goal-bar").getBoundingClientRect();
      const head = g.querySelector(".jv-goal-head").getBoundingClientRect();
      return { h: Math.round(bar.height), below: bar.top >= head.bottom - 1 };
    }),
  );
  check(
    "goal bars are 8px and sit under their labels",
    bars.length > 0 && bars.every((x) => x.h === 8 && x.below),
    bars,
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("tab bar: Home, To-Do, Console, Wallet, You (icons, labels, nothing hidden)", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=home" });
  const bar = await page.evaluate(() =>
    [...document.querySelectorAll("nav.tabbar button")].map((b) => ({
      tab: b.dataset.tab,
      label: b.textContent.trim(),
      svg: !!b.querySelector("svg"),
      hiddenSvg: b.querySelector("svg").getAttribute("aria-hidden") === "true" || !!b.querySelector(".orb-core"),
      upper: getComputedStyle(b).textTransform,
      mono:
        getComputedStyle(b).fontFamily ===
        getComputedStyle(document.querySelector('nav.tabbar [data-tab="home"]')).fontFamily,
      stroke: b.querySelector("svg").getAttribute("stroke-width"),
      h: b.getBoundingClientRect().height,
    })),
  );
  check(
    "bar order and labels",
    JSON.stringify(bar.map((b) => b.tab)) === '["home","todo","console","wallet","glow"]' &&
      JSON.stringify(bar.map((b) => b.label)) === '["Home","To-Do","Console","Wallet","Glow"]',
    bar,
  );
  check(
    "every tab has a line icon in the same 1.8 stroke, uppercase mono label, 44px+ tall",
    bar.every((b) => b.svg && b.stroke === "1.8" && b.upper === "uppercase" && b.mono && b.h >= 44),
    bar,
  );
  check(
    "Wallet is a card icon, You a person icon",
    await page.evaluate(
      () =>
        !!document.querySelector('nav.tabbar [data-tab="wallet"] svg rect') &&
        !!document.querySelector('nav.tabbar [data-tab="glow"] svg path') &&
        !!document.querySelector('nav.tabbar [data-tab="glow"] svg path'),
    ),
  );
  const hid = await page.evaluate(() => ({
    hidden: HIDDEN_TABS.length,
    // every panel is reachable from the bar (directly or through a group's switch)
    panels: [...document.querySelectorAll(".tabpanel")].map((p) => p.id.replace("panel-", "")),
    reach: SWIPE_ORDER,
  }));
  check(
    "no hidden tabs: every panel is in the bar or a group",
    hid.hidden === 0 && hid.panels.every((p) => hid.reach.includes(p)) && hid.reach.length === hid.panels.length,
    hid,
  );
  check("Home shows no group switch", !(await page.isVisible("#tab-switch")));
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section(
  "Wallet / Glow: the switch swaps views, the header names the group, the last view is remembered",
  async () => {
    const { ctx, page, errors } = await openApp({ query: "?tab=home" });
    const state = () =>
      page.evaluate(() => {
        const sw = document.getElementById("tab-switch");
        const segs = [...sw.querySelectorAll(".tab-seg")];
        const active = document.querySelector("nav.tabbar button.active");
        return {
          tab: currentTab,
          body: document.body.dataset.tab,
          headline: document.getElementById("headline").textContent,
          nav: active && active.dataset.tab,
          current: [...document.querySelectorAll('nav.tabbar [aria-current="page"]')].map((b) => b.dataset.tab).join(),
          panel: [...document.querySelectorAll(".tabpanel.active")].map((p) => p.id).join(),
          shown: !sw.hidden && sw.getBoundingClientRect().height > 0,
          role: sw.getAttribute("role"),
          label: sw.getAttribute("aria-label"),
          segs: segs.map((b) => b.textContent.trim()).join(),
          pressed: segs
            .filter((b) => b.getAttribute("aria-pressed") === "true")
            .map((b) => b.dataset.tab)
            .join(),
          on: segs
            .filter((b) => b.classList.contains("on"))
            .map((b) => b.dataset.tab)
            .join(),
          segH: Math.min(...segs.map((b) => b.getBoundingClientRect().height)),
          segW: segs.map((b) => Math.round(b.getBoundingClientRect().width)),
          swW: Math.round(sw.getBoundingClientRect().width),
          mainW: Math.round(document.querySelector("main").clientWidth),
          aboveSwitch:
            sw.getBoundingClientRect().bottom <= document.querySelector(".tabpanel.active").getBoundingClientRect().top,
        };
      });
    await page.tap('nav.tabbar button[data-tab="wallet"]');
    let s = await state();
    check(
      "Wallet opens on Budget the first time, with the header and tab lit",
      s.tab === "budget" &&
        s.body === "budget" &&
        s.headline === "Wallet" &&
        s.nav === "wallet" &&
        s.current === "wallet" &&
        s.panel === "panel-budget",
      s,
    );
    check(
      "Wallet's switch: Budget | Shopping, a labelled group, Budget pressed, above the panel",
      s.shown &&
        s.role === "group" &&
        s.label === "Wallet views" &&
        s.segs === "Budget,Shopping" &&
        s.pressed === "budget" &&
        s.on === "budget" &&
        s.aboveSwitch,
      s,
    );
    check(
      "the switch is full width with two equal 44px segments",
      s.segH >= 44 && s.segW[0] === s.segW[1] && s.swW >= s.mainW - 34,
      s,
    );
    await page.tap('#tab-switch .tab-seg[data-tab="wants"]');
    s = await state();
    check(
      "tapping Shopping swaps the panel and keeps Wallet lit",
      s.tab === "wants" &&
        s.body === "wants" &&
        s.headline === "Wallet" &&
        s.nav === "wallet" &&
        s.pressed === "wants" &&
        s.panel === "panel-wants",
      s,
    );
    check(
      "the choice is remembered on this device",
      (await page.evaluate(() => JSON.parse(localStorage.getItem("tab-group-last")).wallet)) === "wants",
    );
    await page.tap('nav.tabbar button[data-tab="glow"]');
    s = await state();
    check(
      "Glow opens on Beauty first: Beauty | Jazz 3.0, header Glow",
      s.tab === "skin" &&
        s.headline === "Glow" &&
        s.nav === "glow" &&
        s.segs === "Beauty,Jazz 3.0" &&
        s.pressed === "skin" &&
        s.label === "Glow views",
      s,
    );
    await page.tap('#tab-switch .tab-seg[data-tab="jazz3"]');
    s = await state();
    check(
      "tapping Jazz 3.0 swaps to Jazz 3.0 under You",
      s.tab === "jazz3" && s.nav === "glow" && s.pressed === "jazz3",
      s,
    );
    await page.tap('nav.tabbar button[data-tab="wallet"]');
    s = await state();
    check("Wallet comes back to Shopping (its last view)", s.tab === "wants" && s.pressed === "wants", s);
    await page.tap('nav.tabbar button[data-tab="wallet"]');
    check("tapping Wallet again stays on Shopping", (await state()).tab === "wants");
    await page.tap('nav.tabbar button[data-tab="home"]');
    check("leaving the group hides its switch", !(await state()).shown);
    await page.reload();
    await page.waitForTimeout(500);
    await page.tap('nav.tabbar button[data-tab="glow"]');
    s = await state();
    check("after a reload, You still opens Jazz 3.0", s.tab === "jazz3" && s.pressed === "jazz3", s);
    await page.tap('nav.tabbar button[data-tab="wallet"]');
    check("and Wallet still opens Shopping", (await state()).tab === "wants");
    // keyboard: the pressed state flips in place, so focus stays on the segment
    await page.focus('#tab-switch .tab-seg[data-tab="budget"]');
    await page.keyboard.press("Enter");
    const kb = await page.evaluate(() => ({
      tab: currentTab,
      focus: document.activeElement && document.activeElement.dataset.tab,
      pressed: document.activeElement && document.activeElement.getAttribute("aria-pressed"),
    }));
    check(
      "Enter on a segment switches and keeps focus on it",
      kb.tab === "budget" && kb.focus === "budget" && kb.pressed === "true",
      kb,
    );
    // forged or stale stored values fall back to the first view; forged switch targets do nothing
    await page.evaluate(() => {
      localStorage.setItem("tab-group-last", JSON.stringify({ wallet: "console", you: "<img>" }));
      activateTab("home");
    });
    await page.tap('nav.tabbar button[data-tab="wallet"]');
    check("a bad stored view falls back to Budget", (await state()).tab === "budget");
    await page.tap('nav.tabbar button[data-tab="glow"]');
    check("and to Beauty", (await state()).tab === "skin");
    await page.evaluate(() => {
      localStorage.setItem("tab-group-last", "not json");
      const b = document.createElement("button");
      b.dataset.action = "tab-sub";
      b.dataset.tab = "console";
      document.getElementById("tab-switch").appendChild(b);
      b.click();
      b.remove();
      activateTab("constructor");
      activateTab("__proto__");
    });
    s = await state();
    check("a forged switch target or tab name does nothing", s.tab === "skin" && s.nav === "glow", s);
    await page.tap('nav.tabbar button[data-tab="wallet"]');
    check("unreadable stored views fall back too", (await state()).tab === "budget");
    check("no JS errors", errors.length === 0, errors);
    await ctx.close();
  },
);

await section("Wallet / Glow: every entry point lands on the right view with the right tab lit", async () => {
  const cases = [
    ["?tab=budget", "budget", "wallet", "Wallet"],
    ["?tab=wants", "wants", "wallet", "Wallet"],
    ["?tab=style", "wants", "wallet", "Wallet"],
    ["?tab=skin", "skin", "glow", "Glow"],
    ["?tab=jazz3", "jazz3", "glow", "Glow"],
    ["?tab=fitness", "jazz3", "glow", "Glow"],
    ["?tab=wallet", "budget", "wallet", "Wallet"],
    ["?tab=you", "skin", "glow", "Glow"],
    ["?tab=console", "console", "console", "Console"],
    ["?tab=todo", "todo", "todo", "To-Do"],
    ["?tab=jarvis", "home", "home", "Home"],
  ];
  for (const [q, tab, nav, headline] of cases) {
    const { ctx, page, errors } = await openApp({ query: q });
    const r = await page.evaluate(() => ({
      tab: currentTab,
      nav: document.querySelector('nav.tabbar [aria-current="page"]').dataset.tab,
      headline: document.getElementById("headline").textContent,
      sw: !document.getElementById("tab-switch").hidden,
      pressed: document.querySelector('#tab-switch:not([hidden]) [aria-pressed="true"]')?.dataset.tab || "",
    }));
    const grouped = nav === "wallet" || nav === "glow";
    check(
      `${q} opens ${tab} under ${nav}`,
      r.tab === tab &&
        r.nav === nav &&
        r.headline === headline &&
        r.sw === grouped &&
        r.pressed === (grouped ? tab : ""),
      r,
    );
    check(`no JS errors (${q})`, errors.length === 0, errors);
    await ctx.close();
  }
  // a group link uses the remembered view
  const rem = await openApp({ query: "?tab=wallet", seed: { "tab-group-last": { wallet: "wants", you: "jazz3" } } });
  check("?tab=wallet opens the remembered Shopping", (await rem.page.evaluate(() => currentTab)) === "wants");
  await rem.ctx.close();

  const { ctx, page, errors } = await openApp({ query: "?tab=home" });
  const at = () =>
    page.evaluate(() =>
      [
        currentTab,
        document.querySelector('nav.tabbar [aria-current="page"]').dataset.tab,
        document.querySelector('#tab-switch:not([hidden]) [aria-pressed="true"]')?.dataset.tab || "",
      ].join(),
    );
  // Home tiles (dashGo) and Weekly Review links (which call dashGo) land inside the groups
  for (const [where, want] of [
    ["money", "budget,wallet,budget"],
    ["shop", "wants,wallet,wants"],
    ["skin", "skin,glow,skin"],
    ["jazz3", "jazz3,glow,jazz3"],
    ["todo", "todo,todo,"],
  ]) {
    await page.evaluate((w) => {
      activateTab("home");
      dashGo(w);
    }, where);
    check(`dashGo("${where}") lands on ${want}`, (await at()) === want, await at());
  }
  await page.evaluate(() => {
    activateTab("home");
    dashGo("jazz3", "weight-card");
  });
  check(
    'dashGo("jazz3", "weight-card") opens Glow → Jazz 3.0 at the Weight card',
    (await at()) === "jazz3,glow,jazz3" &&
      (await page.evaluate(() => !!document.querySelector("#panel-jazz3.active #weight-card"))),
  );
  // a Home tile tap (real UI)
  await page.evaluate(() => activateTab("home"));
  await page.tap('.jv-tile[data-go="money"]');
  await page.tap('#jv-detail-money [data-action="jv-go"][data-go="money"]');
  check("Home's Money detail opens Wallet → Budget", (await at()) === "budget,wallet,budget", await at());
  // the old Console "Jazz 3.0" shortcut still lands right if something calls it
  await page.evaluate(() => consoleGo("jazz3"));
  check("consoleGo(jazz3) lands on Glow → Jazz 3.0", (await at()) === "jazz3,glow,jazz3");
  await page.evaluate(() => consoleGo("wants"));
  check("consoleGo(wants) lands on Wallet → Shopping", (await at()) === "wants,wallet,wants");
  // resuming after a hard refresh keeps the sub-view and lights its group
  await page.evaluate(() => {
    activateTab("jazz3");
    sessionStorage.setItem("resume-view", JSON.stringify({ tab: "budget", scroll: 0 }));
    resumeView();
  });
  check("resuming a Budget view lights Wallet", (await at()) === "budget,wallet,budget");
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();

  // #import= links: a jazz3 import ends on Glow → Jazz 3.0, a skin import on Glow → Beauty
  const j3 = await openApp({
    query:
      "#import=" + Buffer.from(JSON.stringify({ app: "jazz3-fitness", start: 100, goal: 120 })).toString("base64url"),
  });
  await j3.page.waitForTimeout(300);
  check(
    "#import= jazz3 link lights Glow",
    (await j3.page.evaluate(() =>
      [currentTab, document.querySelector('nav.tabbar [aria-current="page"]').dataset.tab].join(),
    )) === "jazz3,glow",
  );
  await j3.ctx.close();
  // manifest shortcuts still point at views that open
  const manifest = JSON.parse(await readFile(path.join(ROOT, "manifest.json"), "utf8"));
  const tabs = manifest.shortcuts.map((s) => new URL(s.url, "http://x/").searchParams.get("tab"));
  const okTabs = await (async () => {
    const { ctx, page } = await openApp();
    const r = await page.evaluate((ts) => ts.every((t) => isTab(NAV_TAB(t))), tabs);
    await ctx.close();
    return r;
  })();
  check("every manifest shortcut opens a real view", tabs.length > 0 && okTabs, tabs);
});

await section("Wallet / Glow: swiping walks every view left to right; + button per view", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=home" });
  const swipe = (dx) =>
    page.evaluate((dx) => {
      dragJustEnded = 0;
      const el = document.querySelector(".tabpanel.active");
      const r = document.querySelector("main").getBoundingClientRect();
      const x = r.left + r.width / 2,
        y = r.top + 200;
      const t = (cx, cy) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
      el.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [t(x, y)], changedTouches: [t(x, y)] }));
      el.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [t(x + dx, y)] }));
      return currentTab;
    }, dx);
  await page.evaluate(() => activateTab("console"));
  const left = [];
  for (let i = 0; i < 5; i++) left.push(await swipe(-120));
  check(
    "swiping left from Console: Budget, Shopping, Beauty, Jazz 3.0, then it stops",
    left.join() === "budget,wants,skin,jazz3,jazz3",
    left,
  );
  check(
    "the bar follows the swipe (You lit on Jazz 3.0)",
    (await page.evaluate(() => document.querySelector('nav.tabbar [aria-current="page"]').dataset.tab)) === "glow",
  );
  const right = [];
  for (let i = 0; i < 7; i++) right.push(await swipe(120));
  check(
    "swiping right walks back to Home, then stops",
    right.join() === "skin,wants,budget,console,todo,home,home",
    right,
  );
  check(
    "a swipe into a group is remembered like a switch tap",
    (await page.evaluate(() => JSON.parse(localStorage.getItem("tab-group-last")).wallet)) === "budget",
  );

  // the + button keeps its per-view modes
  const fab = async (tab) => {
    await page.evaluate((t) => activateTab(t), tab);
    await page.waitForTimeout(50);
    return page.evaluate(() => ({
      shown: getComputedStyle(document.getElementById("fab")).display !== "none",
      label: document.getElementById("fab").getAttribute("aria-label"),
    }));
  };
  let f = await fab("budget");
  check("+ on Wallet → Budget adds spending or a bill", f.shown && f.label === "Add spending or a bill", f);
  await page.click("#fab");
  check("+ on Budget opens Add to budget", (await page.textContent("#composer-heading")) === "Add to budget");
  await page.evaluate(() => closeComposer());
  f = await fab("wants");
  check("+ on Wallet → Shopping adds to the shopping list", f.shown && f.label === "Add to shopping list", f);
  await page.click("#fab");
  check("+ on Shopping opens the shopping composer", await page.evaluate(() => composer && composer.mode === "shop"));
  await page.evaluate(() => closeComposer());
  check("no + on Glow → Beauty", !(await fab("skin")).shown);
  check("no + on Glow → Jazz 3.0", !(await fab("jazz3")).shown);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("Wallet / Glow: switch fits at 390px in both themes; desktop bar", async () => {
  for (const theme of ["dark", "light"]) {
    const { ctx, page, errors } = await openApp({ query: "?tab=home", seed: { "theme-pref": theme } });
    for (const tab of ["budget", "wants", "skin", "jazz3"]) {
      await page.evaluate((t) => activateTab(t), tab);
      await page.waitForTimeout(250); // the segments fade their colours over 0.15s
      const r = await page.evaluate(() => {
        const sw = document.getElementById("tab-switch");
        const on = sw.querySelector(".tab-seg.on"),
          off = sw.querySelector(".tab-seg:not(.on)");
        const cn = getComputedStyle(sw);
        return {
          theme: document.documentElement.dataset.theme,
          pageW: document.scrollingElement.scrollWidth,
          w: innerWidth,
          right: sw.getBoundingClientRect().right,
          onBg: getComputedStyle(on).backgroundColor,
          onFg: getComputedStyle(on).color,
          offFg: getComputedStyle(off).color,
          radius: cn.borderRadius,
          bg: cn.backgroundColor,
          accent: getComputedStyle(document.documentElement).getPropertyValue("--olive").trim(),
        };
      });
      check(
        `${theme} ${tab}: no sideways scroll at 390px, the switch inside the screen`,
        r.theme === theme && r.w === 390 && r.pageW <= 390 && r.right <= 390,
        r,
      );
      check(
        `${theme} ${tab}: pressed segment is lit, the other dim`,
        r.onBg !== "rgba(0, 0, 0, 0)" && r.onFg !== r.offFg && r.radius === "12px",
        r,
      );
    }
    check(`no JS errors (${theme})`, errors.length === 0, errors);
    await ctx.close();
  }
  // the switch looks the same as Console's Ask | Capture
  const { ctx, page } = await openApp({ query: "?tab=console" });
  const look = await page.evaluate(() => {
    const pick = (el) => {
      const c = getComputedStyle(el);
      return [c.display, c.padding, c.borderRadius, c.backgroundColor, c.borderTopColor].join("|");
    };
    const seg = (el) => {
      const c = getComputedStyle(el);
      return [c.minHeight, c.borderRadius, c.fontSize, c.fontWeight].join("|");
    };
    const cn = pick(document.querySelector("#panel-console .cn-switch")),
      cs = seg(document.querySelector("#panel-console .cn-seg"));
    activateTab("budget");
    return { cn, cs, tab: pick(document.getElementById("tab-switch")), ts: seg(document.querySelector(".tab-seg")) };
  });
  check("the group switch matches Console's switch", look.cn === look.tab && look.cs === look.ts, look);
  await ctx.close();
  const d = await openApp({ phone: false, query: "?tab=jazz3" });
  const desk = await d.page.evaluate(() => ({
    labels: [...document.querySelectorAll("nav.tabbar button")].map((b) => b.textContent.trim()).join(),
    current: document.querySelector('nav.tabbar [aria-current="page"]').dataset.tab,
    sw: document.getElementById("tab-switch").getBoundingClientRect().height,
  }));
  check(
    "desktop: the five tabs, You lit on Jazz 3.0, the switch shown",
    desk.labels === "Home,To-Do,Console,Wallet,Glow" && desk.current === "glow" && desk.sw >= 44,
    desk,
  );
  check("no JS errors (desktop)", d.errors.length === 0, d.errors);
  await d.ctx.close();
});

await section("budget top: safe to spend, next 14 days across a month end, spending, goal, folded month", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  // Pin "today" two days before this month ends (local noon), so a bill on the 1st of next month
  // is 3 days away: the case the month view hid. Date-only math, so it holds in any time zone.
  const now = new Date();
  const fixed = new Date(now.getFullYear(), now.getMonth() + 1, -2, 12);
  await page.clock.setFixedTime(fixed);
  await page.reload();
  await page.waitForTimeout(600);
  const setup = await page.evaluate(() => {
    const today = addDaysIso(0);
    const nextFirst = isoDate(new Date(noonOf(monthEndIso(today.slice(0, 7))).getTime() + 864e5));
    bills = [
      {
        id: "b-rent",
        name: "<img src=x onerror=window.__wbx=1>Rent",
        amount: 900,
        due: nextFirst,
        repeat: "monthly",
        group: "personal",
        day: 1,
      },
      {
        id: "b-old",
        name: "Old",
        amount: 40,
        due: addDaysIso(-2),
        repeat: "monthly",
        group: "personal",
        day: Number(addDaysIso(-2).slice(8)),
      },
      {
        id: "b-power",
        name: "Power",
        amount: 200,
        due: addDaysIso(1),
        repeat: "monthly",
        group: "joint",
        share: 50,
        day: Number(addDaysIso(1).slice(8)),
      },
      {
        id: "b-stream",
        name: "Stream",
        amount: 12,
        due: addDaysIso(5),
        repeat: "monthly",
        autopay: true,
        group: "personal",
        day: Number(addDaysIso(5).slice(8)),
      },
      {
        id: "b-far",
        name: "Far",
        amount: 70,
        due: addDaysIso(20),
        repeat: "monthly",
        group: "personal",
        day: Number(addDaysIso(20).slice(8)),
      },
    ];
    billPayments = [];
    budget.income = [{ id: "inc-a", name: "Paycheck", amount: 2000, start: addDaysIso(-3), repeat: "biweekly" }];
    budget.categories = [
      { id: "cat-g", name: "Groceries", limit: 100 },
      { id: "cat-d", name: "Dining", limit: 100 },
      { id: "cat-f", name: "Fun", limit: 50 },
      { id: "cat-x", name: "<b>x</b>Gifts", limit: 0 },
    ];
    budget.expenses = [
      { id: "e-g", name: "Market", amount: 50, cat: "cat-g", date: today },
      { id: "e-d", name: "Tacos", amount: 95, cat: "cat-d", date: today },
      { id: "e-f", name: "Show", amount: 60, cat: "cat-f", date: today },
      { id: "e-x", name: "Card", amount: 12, cat: "cat-x", date: today },
    ];
    budget.goals = [{ id: "goal-f", name: "Fund", target: 1000, saved: 250, created: today, log: [] }];
    budget.plans = {
      [`inc-a|${addDaysIso(11)}`]: { lines: [{ id: "line-f", name: "Save", amount: 100, goal: "goal-f" }] },
    };
    normalizeBudgetData();
    renderBudget();
    return { today, nextFirst };
  });
  check(
    "the pinned day sits 3 days before next month's 1st",
    setup.nextFirst.slice(0, 7) !== setup.today.slice(0, 7),
    setup,
  );

  // Safe to spend: the same numbers as Home's Money detail
  const hero = await page.evaluate(() => {
    const p = dashPayPeriod(addDaysIso(0));
    return {
      safe: document.querySelector("#panel-budget .wb-safe").textContent,
      keys: document.querySelector("#panel-budget .wb-keys").textContent,
      when: document.querySelector("#panel-budget .wb-hero-row > span").textContent,
      p,
      expect: moneyShort(Math.abs(p.left)),
    };
  });
  await page.evaluate(() => {
    activateTab("home");
    dashDrill("money");
  });
  const home = await page.evaluate(() => ({
    safe: document.querySelector("#jv-detail-money .jv-safe b").textContent,
    keys: document.querySelector("#jv-detail-money .jv-period-keys").textContent,
  }));
  await page.evaluate(() => activateTab("budget"));
  check(
    "Safe to spend matches Home's Money detail (number, paid, due, paycheck)",
    hero.safe === home.safe &&
      hero.safe === hero.expect &&
      ["Paid", "Due", "Paycheck"].every((k) => {
        const re = new RegExp(`${k} (\\$[\\d,.]+)`);
        return (hero.keys.match(re) || [])[1] === (home.keys.match(re) || [])[1];
      }),
    { hero, home },
  );
  check(
    "hero says until payday <day, date> · N days",
    /^until payday \w{3}, \w{3} \d+ · \d+ days?$/.test(hero.when),
    hero.when,
  );

  // Next 14 days: overdue first, crosses the month end, nothing past 14 days, your share for joint
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("#panel-budget .wb-upcoming .wb-bill")].map((r) => ({
      name: r.querySelector(".wb-bill-text b").textContent,
      meta: r.querySelector(".wb-bill-meta").textContent,
      amt: r.querySelector(".wb-bill-amt").textContent,
      over: r.classList.contains("over"),
      manual: !!r.querySelector(".wb-manual"),
      box: !!r.querySelector(".todo-check"),
    })),
  );
  const byName = (n) => rows.find((r) => r.name.endsWith(n)) || {};
  check("overdue unpaid bill comes first, in red", rows[0] && rows[0].name === "Old" && rows[0].over, rows);
  check(
    "a bill due next month within 14 days is listed (crosses the month end)",
    !!byName("Rent").name && /^\w{3}, \w{3} 1\b/.test(byName("Rent").meta),
    rows,
  );
  check("bills past 14 days are left out", !rows.some((r) => r.name === "Far"), rows);
  check(
    "joint bill shows your share",
    byName("Power").amt === "$100.00" && byName("Power").meta.includes("your 50%"),
    rows,
  );
  check(
    "not on autopay warns within 3 days; autopay bills say autopay",
    byName("Rent").manual &&
      byName("Power").manual &&
      byName("Old").manual &&
      !byName("Stream").manual &&
      byName("Stream").meta.includes("autopay"),
    rows,
  );
  check(
    "label totals what's still due",
    (await page.textContent("#panel-budget .wb-upcoming .jv-label-count")) === "$1,052",
    await page.textContent("#panel-budget .wb-upcoming .jv-label-count"),
  );
  check(
    "bill names are escaped",
    (await page.evaluate(() => window.__wbx === undefined && !document.querySelector('#panel-budget img[src="x"]'))) &&
      byName("Rent").name === "<img src=x onerror=window.__wbx=1>Rent",
    byName("Rent"),
  );

  // Tick pays (with Undo); the row stays, struck
  await page.click('#panel-budget .wb-upcoming .todo-check[aria-label="Mark paid: Power"]');
  const paid = await page.evaluate(() => ({
    pays: billPayments.map((p) => p.billId),
    struck: [...document.querySelectorAll("#panel-budget .wb-bill.checked .wb-bill-text b")].map((b) => b.textContent),
  }));
  check(
    "ticking a bill pays it and shows it struck",
    paid.pays.join() === "b-power" && paid.struck.includes("Power"),
    paid,
  );
  await page.click(".toast button");
  check(
    "Undo un-pays it",
    await page.evaluate(() => billPayments.length === 0 && bills.find((b) => b.id === "b-power").due === addDaysIso(1)),
  );

  // Tapping the row (not the box) opens the bill editor
  await page.click('#panel-budget .wb-bill:has(.todo-check[aria-label="Mark paid: Stream"]) .wb-bill-text');
  const ed = await page.evaluate(() => ({
    open: document.getElementById("modal-backdrop").classList.contains("open"),
    title: document.getElementById("modal-heading").textContent,
    name: (document.getElementById("modal-name") || {}).value,
  }));
  check("row opens the bill editor", ed.open && ed.title === "Edit bill" && ed.name === "Stream", ed);
  await page.evaluate(() => closeModal());

  // Spending bars: normal, amber at 90%+, red over; no-limit categories as chips
  const sp = await page.evaluate(() => ({
    label: document.querySelector("#panel-budget .wb-spending .jv-label").textContent,
    cats: [...document.querySelectorAll("#panel-budget .wb-cat")].map((c) => ({
      name: c.querySelector(".wb-cat-head b").textContent,
      cls: c.className.replace(/\s+/g, " ").trim(),
      w: c.querySelector(".wb-track span").style.width,
      amt: c.querySelector(".wb-cat-amt").textContent,
    })),
    chips: [...document.querySelectorAll("#panel-budget .wb-chip")].map((c) => c.textContent),
    injected: document.querySelectorAll("#panel-budget .wb-chip b").length !== 1,
  }));
  const cat = (n) => sp.cats.find((c) => c.name === n) || {};
  check(
    "spending label: spent of limit",
    /Spending · \w+/.test(sp.label) && sp.label.includes("$217 of $250"),
    sp.label,
  );
  check(
    "bars: normal under 90%, amber at 90%+, red over",
    cat("Groceries").cls === "wb-cat" &&
      cat("Groceries").w === "50%" &&
      cat("Dining").cls === "wb-cat near" &&
      cat("Fun").cls === "wb-cat over" &&
      cat("Fun").w === "100%" &&
      cat("Fun").amt === "$60 of $50 · over",
    sp.cats,
  );
  check(
    "categories without a limit are listed compactly, names escaped",
    sp.chips.length === 1 && sp.chips[0].trim() === "<b>x</b>Gifts $12" && !sp.injected,
    sp,
  );
  await page.click('#panel-budget .wb-cat-btn[data-cat-id="cat-g"]');
  check(
    "tapping a bar opens that category's expenses",
    (await page.textContent("#panel-budget .wb-spending .wb-cat-items")).includes("Market"),
  );

  // Goal ring: saved of target · per paycheck; tap opens the goal editor
  const goal = await page.evaluate(() => ({
    text: document.querySelector("#panel-budget .wb-goal-text").textContent,
    pct: document.querySelector("#panel-budget .wb-ring em").textContent,
  }));
  check(
    "goal shows saved of target and $ per paycheck",
    goal.text === "Fund$250 of $1,000 · $100 a paycheck" && goal.pct === "25%",
    goal,
  );
  await page.click("#panel-budget .wb-goal");
  check(
    "goal opens its editor",
    await page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open")),
  );
  await page.evaluate(() => closeModal());

  // The month in full: folded by default, opens, remembered on this device; ‹ › still step months
  const shut = await page.evaluate(() => ({
    open: document.getElementById("wb-month").open,
    seen: document.getElementById("bills-mine").checkVisibility(),
    row: document.querySelector("#wb-month > summary").textContent,
  }));
  check(
    "month view starts folded under '<Month> in full'",
    !shut.open && !shut.seen && /^\w+ in full · bills and paycheck plan/.test(shut.row.trim()),
    shut,
  );
  await page.click("#wb-month > summary");
  await page.waitForTimeout(100);
  check(
    "tapping it shows the month view and saves it open",
    await page.evaluate(
      () =>
        document.getElementById("bills-mine").checkVisibility() && localStorage.getItem("budget-month-open") === "1",
    ),
  );
  const before = await page.textContent(".budget-month span");
  await page.click('.budget-month .cal-nav[aria-label="Next month"]');
  const after = await page.evaluate(() => ({
    month: document.querySelector(".budget-month span").textContent,
    row: document.querySelector("#wb-month > summary b").textContent,
    open: document.getElementById("wb-month").open,
  }));
  check(
    "› steps to next month (still open, row names it)",
    after.month !== before && after.open && after.row === `${after.month} in full`,
    { before, after },
  );
  await page.click('.budget-month .cal-nav[aria-label="Previous month"]');
  check("‹ steps back", (await page.textContent(".budget-month span")) === before);
  await page.reload();
  await page.waitForTimeout(600);
  await page.evaluate(() => activateTab("budget"));
  check("open stays open after a reload", await page.evaluate(() => document.getElementById("wb-month").open));
  await page.click("#wb-month > summary");
  await page.waitForTimeout(100);
  check("closing it is remembered too", await page.evaluate(() => localStorage.getItem("budget-month-open") === "0"));

  // Phone fit: 44px targets, no sideways overflow at 390px
  const fit = await page.evaluate(() => {
    const p = document.getElementById("panel-budget");
    const small = [...p.querySelectorAll(".wb-top button, .wb-top [role=button], #wb-month > summary")]
      .filter((el) => el.offsetParent && !el.closest(".wb-cat-items") && el.getBoundingClientRect().height < 44)
      .map((el) => el.className);
    return { sw: p.scrollWidth, cw: p.clientWidth, w: innerWidth, small };
  });
  check("top fits a 390px phone with 44px targets", fit.w === 390 && fit.sw <= fit.cw && !fit.small.length, fit);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("budget top: no paycheck yet prompts to add one", async () => {
  const { ctx, page, errors } = await openApp({ query: "?tab=budget" });
  await page.evaluate(() => {
    budget.income = [];
    renderBudget();
  });
  const hero = await page.textContent("#panel-budget .wb-hero");
  check("hero asks for a paycheck", hero.includes("Add your paycheck"), hero);
  await page.click('#panel-budget .wb-hero [data-action="budget-add-income"]');
  check(
    "the prompt opens Add income",
    await page.evaluate(() => document.getElementById("modal-backdrop").classList.contains("open")),
  );
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("wallet: Next 14 days folds from its label and remembers", async () => {
  const { ctx, page, errors } = await openApp({
    query: "?tab=budget",
    seed: {
      "bills-content": [
        { id: "nf1", name: "Rent", amount: 900, due: isoOffset(2), repeat: "monthly", autopay: false, account: null },
      ],
    },
  });
  const st = () =>
    page.evaluate(() => {
      const d = document.getElementById("wb-next");
      return {
        open: !!(d && d.open),
        rows: d ? d.querySelectorAll(".wb-bills > *").length : -1,
        kept: localStorage.getItem("budget-next-open"),
      };
    });
  const a = await st();
  check("open by default, with the bills", a.open && a.rows >= 1, a);
  await page.click("#wb-next > summary");
  // the toggle event (which saves it) fires a moment after the tap
  await page.waitForFunction(() => localStorage.getItem("budget-next-open") === "0").catch(() => {});
  const b = await st();
  check("tapping the label folds it and remembers", !b.open && b.kept === "0", b);
  await page.evaluate(() => renderBudget());
  check("stays folded after a redraw", !(await st()).open);
  await page.focus("#wb-next > summary");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => localStorage.getItem("budget-next-open") === "1").catch(() => {});
  const c = await st();
  check("Enter on the label opens it again", c.open && c.kept === "1", c);
  check("no JS errors", errors.length === 0, errors);
  await ctx.close();
});

await section("console: the box grows with long text; a folded conversation still shows Jarvis thinking", async () => {
  const { ctx, page, errors } = await openApp();
  await page.evaluate(() => activateTab("console"));
  const h0 = await page.evaluate(() => document.getElementById("console-input").getBoundingClientRect().height);
  await page.fill(
    "#console-input",
    "hey Jarvis what is the very last letter of the alphabet and how many letters come before it in total",
  );
  const h1 = await page.evaluate(() => {
    const t = document.getElementById("console-input");
    return { h: t.getBoundingClientRect().height, fits: t.scrollHeight <= t.clientHeight + 1 };
  });
  check("long text wraps onto more lines and is all visible", h1.h > h0 + 10 && h1.fits, { h0, h1 });
  await page.keyboard.press("Enter").catch(() => {});
  // a pending question with the conversation folded
  await page.evaluate(() => {
    localStorage.setItem("console-feed-open", "0");
    window.askFeedEntries = () => [{ id: "a-pending-001", at: Date.now(), text: "q" }];
    window.loadAnswers = () => ({ answers: [] });
    renderConsole();
  });
  const fold = await page.evaluate(() => ({
    hidden: document.getElementById("cn-feed-body")?.hidden,
    waiting: !!document.querySelector("#cn-feed .cn-fold-wait .ak-dots"),
  }));
  check("folded with a question pending: the header shows Thinking", fold.waiting, fold);
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
