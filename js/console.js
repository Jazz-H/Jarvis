// console.js - Console (the tab-bar orb): one box to Ask Jarvis or Capture to-dos and Shopping items,
// a preview before anything is saved, and this week's feed of what you did here (this device only).
// Classic script: shares one global scope with the other js/*.js files (load order is in jazz2.0.html).

// ---------- CONSOLE ----------
// Capture is local: the text is split and sorted on this device with the same rules as the + sheet
// (a trailing day word is the date, a trailing price makes it a Shopping item), shown as a preview,
// and only saved when you tap Add. Ask has no backend yet: a question is kept in the feed, honestly
// labelled, and nothing is sent anywhere.
const CONSOLE_FEED_KEY = "console-feed"; // this device only: not in SYNC_KEYS, never pushed, not in backups
const CONSOLE_MOVED_KEY = "console-moved-seen"; // the one-time "Jazz 3.0 moved" notice was shown (this device)
const CONSOLE_FEED_DAYS = 7;
const CONSOLE_FEED_MAX = 50;
const CONSOLE_TEXT_MAX = 1000;
const CONSOLE_PIECES_MAX = 20;
const CONSOLE_ASK_STATUS = "Ask Jarvis isn't switched on yet — this question is saved here";
const CONSOLE_MOVED_MSG = "Jazz 3.0 moved: open it from Home's Jazz 3.0 tile or the bottom of Console";
const CONSOLE_MODES = {
  ask: {
    label: "Ask",
    placeholder: "Ask Jarvis…",
    send: "Send question",
    hint: "Ask isn't switched on yet. Questions are saved here for now.",
    chips: [
      "What's due before payday?",
      "How did workouts go?",
      "What can I skip today?",
      "Plan my Saturday",
      "Am I on track for my weight goal?",
    ],
  },
  capture: {
    label: "Capture",
    placeholder: "Add to-dos, items, notes…",
    send: "Preview items",
    hint: "Separate items with / or ;. You'll see a preview first.",
    chips: ["dentist fri", "buy eggs $5", "call mom tomorrow", "helmet $250", "note: gift ideas for mom"],
  },
};
const CONSOLE_TYPES = {
  todo: "To-do",
  shop: "Shopping",
  ask: "Ask",
  expense: "Budget",
  skip: "Skip",
};
const CONSOLE_SEND_ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
let consoleFeed = [];
let consoleMode = null; // null: guessed from the text; "ask" | "capture" once the switch is tapped (until the box is cleared)
let consolePreview = null; // {src, rows: [{src, orig, type, note?}]} while a capture waits for Add

// ---- reading what was typed ----
// Questions: a leading/trailing "?" or a question word first. "do" only counts as "do I/we/you…",
// so "do laundry sat" stays a to-do.
const CONSOLE_QUESTION =
  /^(?:what(?:['’]?s)?|how(?:['’]s)?|when|why|where|who|which|can|could|should|would|will|is|are|am|did|does|do (?:i|we|you)|have (?:i|we)|has)\b/i;
const CONSOLE_SHOP_VERB = /^(?:buy|get|grab|order|purchase|pick ?up|shop for|need to buy|reorder|restock)\s+/i;
const CONSOLE_NEED = /^(?:(?:we|i)\s+)?(?:need|out of|running low on|low on)\s+(?!to\b)/i;
const CONSOLE_TODO_VERB = /^(?:pay|call|text|email|book|schedule|cancel|renew|return|fix|clean|wash|send|remind)\b/i;
const CONSOLE_NOTE = /^(?:note|notes|idea|ideas)\s*[:–-]\s*/i;
const CONSOLE_EXPENSE = /\b(?:spent|spend|paid|expense)\b/i;
const CONSOLE_AMOUNT = /\$\s?(\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?)/;
function consoleLooksLikeQuestion(s) {
  const t = String(s || "").trim();
  return /^\?|\?$/.test(t) || CONSOLE_QUESTION.test(t);
}
function consoleCleanPiece(s) {
  return String(s || "")
    .replace(/^\s*(?:[-*•·]|\d+[.)]|\[\s?\])\s+/, "")
    .trim();
}
// "eggs, milk, and bread": commas only split a short list (every piece 1–4 words) that isn't a question.
// A comma inside a number ("$1,200") never splits.
function consoleCommaSplit(s) {
  if (consoleLooksLikeQuestion(s)) return null;
  const bits = s
    .split(/\s*,\s*(?!\d{3}(?!\d))/)
    .map((x, i, all) => (i === all.length - 1 ? x.replace(/^and\s+/i, "") : x).trim());
  if (bits.length < 2 || bits.some((b) => !b || b.split(/\s+/).length > 4)) return null;
  return bits;
}
// Pieces: new lines, " / " or ";" (and a short comma list when there's nothing else). `list` marks a
// comma list, where a leading "buy" carries over to the rest ("buy eggs, milk, bread").
function consoleSplit(text) {
  const parts = String(text || "")
    .split(/\s*\n\s*|\s+\/\s+|\s*;\s*/)
    .map(consoleCleanPiece)
    .filter(Boolean);
  if (parts.length === 1) {
    const c = consoleCommaSplit(parts[0]);
    if (c) return { pieces: c.slice(0, CONSOLE_PIECES_MAX), list: true };
  }
  return { pieces: parts.slice(0, CONSOLE_PIECES_MAX), list: false };
}
// The mode the text suggests: several pieces are a capture (question pieces still go to Ask in the preview)
function consoleGuess(text) {
  const t = String(text || "").trim();
  if (!t) return "ask";
  if (consoleSplit(t).pieces.length > 1) return "capture";
  return consoleLooksLikeQuestion(t) ? "ask" : "capture";
}
function consoleCurrentMode(text) {
  return consoleMode || consoleGuess(text);
}
// One piece's fields for each type it can be switched to
function consoleTodoOf(row) {
  const src = row.src.slice(0, TODO_MAX_LEN);
  const note = src.match(CONSOLE_NOTE);
  if (row.note && note) return { text: src.slice(note[0].length).trim(), due: null };
  return parseQuickAdd(src.replace(/^\?\s*/, ""));
}
function consoleShopOf(row) {
  const src = row.src.slice(0, TODO_MAX_LEN);
  const verb = src.match(CONSOLE_SHOP_VERB),
    need = src.match(CONSOLE_NEED);
  const rest = (verb ? src.slice(verb[0].length) : need ? src.slice(need[0].length) : src).trim() || src;
  const p = parsePrice(rest);
  return { text: p.text, price: p.price, need: !!need };
}
function consoleExpenseOf(row) {
  const src = row.src.slice(0, TODO_MAX_LEN);
  const m = src.match(CONSOLE_AMOUNT);
  const name = src
    .replace(CONSOLE_AMOUNT, " ")
    .replace(CONSOLE_EXPENSE, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:on|for|at)\s+/i, "")
    .replace(/\s+(?:on|for|at)$/i, "");
  return { text: name || "Expense", amount: m ? Number(m[1].replace(/,/g, "")) : null };
}
// Sorts one piece. forceShop: it's in a comma list that started with a shopping verb.
function consoleClassify(src, forceShop) {
  if (consoleLooksLikeQuestion(src)) return { src, orig: "ask", type: "ask" };
  if (CONSOLE_NOTE.test(src) && src.replace(CONSOLE_NOTE, "").trim())
    return { src, orig: "todo", type: "todo", note: true };
  if (CONSOLE_AMOUNT.test(src) && CONSOLE_EXPENSE.test(src)) return { src, orig: "expense", type: "expense" };
  if (!CONSOLE_TODO_VERB.test(src)) {
    const verb = CONSOLE_SHOP_VERB.test(src),
      need = CONSOLE_NEED.test(src);
    const shop = consoleShopOf({ src });
    const dated = !!parseQuickAdd(src).due;
    if ((verb || need || forceShop) && !dated) {
      // "get a haircut" or "pick up a prescription" is an appointment, not shopping
      const k = detectKind(shop.text);
      if (!k || k === "errand" || need || forceShop) return { src, orig: "shop", type: "shop" };
    } else if (!dated && parsePrice(src).price != null) return { src, orig: "shop", type: "shop" };
  }
  return { src, orig: "todo", type: "todo" };
}
function consoleParse(text) {
  const { pieces, list } = consoleSplit(String(text || "").slice(0, CONSOLE_TEXT_MAX));
  const first = list && pieces.length ? consoleClassify(pieces[0], false) : null;
  const carry = !!(first && first.type === "shop" && CONSOLE_SHOP_VERB.test(pieces[0]));
  return pieces.map((p, i) => (i === 0 && first ? first : consoleClassify(p, carry)));
}
// Tapping a preview row steps through the types that make sense for it
function consoleRowTypes(row) {
  return [...new Set([row.orig === "ask" || row.orig === "expense" ? row.orig : "todo", "todo", "shop", "skip"])];
}

// ---- the feed (this device only) ----
function normalizeConsoleFeed(raw, now = Date.now()) {
  const min = now - CONSOLE_FEED_DAYS * 864e5;
  const count = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? Math.min(n, 99) : 0;
  };
  const seen = new Set();
  return (Array.isArray(raw) ? raw : [])
    .filter((e) => e && typeof e === "object" && !Array.isArray(e))
    .map((e) => {
      const kind = e.kind === "ask" || e.kind === "capture" ? e.kind : null;
      const at = Number(e.at);
      if (!kind || !isFinite(at) || at < min || at > now + 864e5) return null;
      const text = String(e.text == null ? "" : e.text)
        .trim()
        .slice(0, CONSOLE_TEXT_MAX);
      if (!text) return null;
      let id = typeof e.id === "string" && SAFE_ID.test(e.id) ? e.id : genId("cn");
      if (seen.has(id)) id = genId("cn");
      seen.add(id);
      const out = { id, at, kind, text };
      if (kind === "capture") {
        out.todos = count(e.todos);
        out.shop = count(e.shop);
        if (!out.todos && !out.shop) return null;
        if (e.undone === true) out.undone = true;
      }
      return out;
    })
    .filter(Boolean)
    .sort((a, b) => b.at - a.at)
    .slice(0, CONSOLE_FEED_MAX);
}
// Runs from loadAllContent(), so a load, a sync (applyRemote) and a restore all re-check it
function loadConsoleFeed() {
  const raw = loadContent(CONSOLE_FEED_KEY, []);
  consoleFeed = normalizeConsoleFeed(raw);
  if (JSON.stringify(raw) !== JSON.stringify(consoleFeed)) writeQuietly(CONSOLE_FEED_KEY, consoleFeed);
}
function consoleLog(entry) {
  consoleFeed = normalizeConsoleFeed([{ id: genId("cn"), at: Date.now(), ...entry }, ...consoleFeed]);
  writeQuietly(CONSOLE_FEED_KEY, consoleFeed); // device-only, so it never counts as a synced edit
  return consoleFeed[0];
}
function consoleAddedText(todos, shop) {
  const parts = [];
  if (todos) parts.push(`${todos} to-do${todos === 1 ? "" : "s"}`);
  if (shop) parts.push(`${shop} Shopping item${shop === 1 ? "" : "s"}`);
  return `Added ${parts.join(" and ")}`;
}

// ---- rendering ----
// consoleReviewHtml() (the Weekly Review card in this slot) lives in review.js
function consoleShellHtml() {
  return `<div class="cn">
    <div class="cn-switch" role="group" aria-label="Mode">
      <button type="button" class="cn-seg" data-action="console-mode" data-mode="ask" aria-pressed="false">Ask</button>
      <button type="button" class="cn-seg" data-action="console-mode" data-mode="capture" aria-pressed="false">Capture</button>
    </div>
    <div class="cn-box">
      <label class="cn-sr" for="console-input" id="console-input-label">Ask Jarvis</label>
      <input id="console-input" class="cn-input" type="text" autocomplete="off" autocapitalize="sentences" enterkeyhint="send"
        maxlength="${CONSOLE_TEXT_MAX}" aria-describedby="cn-hint" data-keydown-action="console-key" data-input-action="console-input" />
      <button type="button" class="cn-send" id="cn-send" data-action="console-send" aria-label="Send question">${CONSOLE_SEND_ICON}</button>
    </div>
    <div class="cn-chips" id="cn-chips" role="group" aria-label="Suggestions"></div>
    <p class="cn-hint" id="cn-hint"></p>
    <div id="cn-preview"></div>
    <div class="cn-review" id="cn-review"></div>
    <div id="cn-feed"></div>
    <button type="button" class="cn-j3" data-action="console-go" data-go="jazz3"><span><b>Jazz 3.0 →</b><small>Weight and goal sections</small></span></button>
  </div>`;
}
let consoleChipsMode = null; // which mode's chips are drawn, so typing doesn't redraw them
function consoleRefreshBox() {
  const input = document.getElementById("console-input");
  if (!input) return;
  const text = input.value;
  const mode = consoleCurrentMode(text),
    cfg = CONSOLE_MODES[mode];
  document.querySelectorAll("#panel-console .cn-seg").forEach((b) => {
    const on = b.getAttribute("data-mode") === mode;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  input.placeholder = cfg.placeholder;
  document.getElementById("console-input-label").textContent =
    mode === "ask" ? "Ask Jarvis" : "Capture to-dos, Shopping items and notes";
  document.getElementById("cn-send").setAttribute("aria-label", cfg.send);
  document.getElementById("cn-hint").textContent =
    text.trim() && !consoleMode ? "Switched by what you typed. Tap to change." : cfg.hint;
  if (consoleChipsMode !== mode) {
    consoleChipsMode = mode;
    const chips = document.getElementById("cn-chips");
    chips.innerHTML = cfg.chips
      .map(
        (c, i) =>
          `<button type="button" class="cn-chip" data-action="console-chip" data-mode="${mode}" data-index="${i}">${escapeHtml(c)}</button>`,
      )
      .join("");
    chips.scrollLeft = 0;
  }
}
function consoleRowMeta(row) {
  if (row.type === "todo") {
    const f = consoleTodoOf(row),
      k = detectKind(f.text);
    return [f.due ? dueLabel(f.due) : "Anytime", row.note ? "Note" : "", k ? TODO_KINDS[k].label : ""];
  }
  if (row.type === "shop") {
    const f = consoleShopOf(row);
    return [f.need ? "Need" : "Want", f.price != null ? `$${fmtMoney(f.price)}` : ""];
  }
  if (row.type === "expense") {
    const f = consoleExpenseOf(row);
    return [f.amount != null ? `$${fmtMoney(f.amount)}` : "", "Not added: check it in Budget"];
  }
  if (row.type === "ask") return ["Saved as a question here"];
  return ["Won't be added"];
}
function consoleRowTitle(row) {
  if (row.type === "todo") return consoleTodoOf(row).text;
  if (row.type === "shop") return consoleShopOf(row).text;
  if (row.type === "expense") return consoleExpenseOf(row).text;
  return row.src;
}
function consoleCounts(rows) {
  const n = (t) => rows.filter((r) => r.type === t).length;
  return { todo: n("todo"), shop: n("shop"), ask: n("ask") };
}
function consolePreviewHtml() {
  const p = consolePreview;
  if (!p) return "";
  const rows = p.rows
    .map((r, i) => {
      const meta = consoleRowMeta(r).filter(Boolean).join(" · ");
      const next = consoleRowTypes(r)[(consoleRowTypes(r).indexOf(r.type) + 1) % consoleRowTypes(r).length];
      return `<li><button type="button" class="cn-row cn-t-${r.type}" data-action="console-row" data-index="${i}"
        aria-label="${escapeAttr(`${CONSOLE_TYPES[r.type]}: ${consoleRowTitle(r)}. Tap to make it ${CONSOLE_TYPES[next]}`)}">
        <span class="cn-tag">${CONSOLE_TYPES[r.type]}</span>
        <span class="cn-row-body"><b>${escapeHtml(consoleRowTitle(r))}</b><span>${escapeHtml(meta)}</span></span>
      </button></li>`;
    })
    .join("");
  // Budget expenses are only offered: the chip opens the Budget sheet pre-filled, to check before saving
  const expenses = p.rows
    .map((r, i) => (r.type === "expense" ? [r, i] : null))
    .filter(Boolean)
    .map(([r, i]) => {
      const f = consoleExpenseOf(r);
      return `<button type="button" class="filter-chip cn-exp" data-action="console-expense" data-index="${i}">Log ${escapeHtml(f.text)}${f.amount != null ? ` $${escapeHtml(fmtMoney(f.amount))}` : ""} in Budget</button>`;
    })
    .join("");
  const c = consoleCounts(p.rows),
    n = c.todo + c.shop;
  const add = n ? `Add ${n}` : c.ask ? `Save ${c.ask === 1 ? "question" : `${c.ask} questions`}` : "Nothing to add";
  return `<section class="cn-preview" aria-labelledby="cn-preview-title">
    <div class="cn-preview-head"><h2 class="jv-kicker" id="cn-preview-title" tabindex="-1">Preview · ${p.rows.length} item${p.rows.length === 1 ? "" : "s"}</h2><span>Tap one to change it</span></div>
    <ul class="cn-rows">${rows}</ul>
    ${expenses ? `<div class="cn-exps">${expenses}</div>` : ""}
    <div class="cn-actions">
      <button type="button" class="modal-btn primary cn-add" id="cn-add" data-action="console-add"${n || c.ask ? "" : " disabled"}>${add}</button>
      <button type="button" class="modal-btn cn-edit" data-action="console-edit">Edit</button>
    </div>
    <p class="cn-note">Sorted on this device · nothing is sent</p>
  </section>`;
}
function consoleDayLabel(iso) {
  const n = daysFromToday(iso);
  if (n === 0) return "Today";
  if (n === -1) return "Yesterday";
  return noonOf(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function consoleEntryHtml(e) {
  const when = new Date(e.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  let reply;
  if (e.kind === "ask") {
    reply = `<span class="cn-status"><span class="cn-dot" aria-hidden="true"></span>${escapeHtml(CONSOLE_ASK_STATUS)}</span>`;
  } else {
    const links = e.undone
      ? ""
      : [e.todos ? ["todo", "To-Do"] : null, e.shop ? ["wants", "Shopping"] : null]
          .filter(Boolean)
          .map(
            ([go, label]) =>
              `<button type="button" class="cn-link" data-action="console-go" data-go="${go}">${label} →</button>`,
          )
          .join("");
    reply = `<span class="${e.undone ? "cn-undone" : ""}">${escapeHtml(consoleAddedText(e.todos, e.shop))}${e.undone ? " · Undone" : ""}</span>${links ? `<span class="cn-links">${links}</span>` : ""}`;
  }
  return `<li class="cn-entry">
    <span class="cn-who">You</span><p class="cn-said">${escapeHtml(e.text)} <time class="cn-time">${escapeHtml(when)}</time></p>
    <span class="cn-who cn-j">J</span><div class="cn-reply">${reply}</div>
  </li>`;
}
function consoleFeedHtml() {
  if (!consoleFeed.length)
    return `<div class="jv-label"><span>Today</span><i></i></div><p class="cn-empty">Nothing here yet this week. Ask a question or capture a few to-dos above.</p>`;
  const days = [];
  consoleFeed.forEach((e) => {
    const iso = isoDate(new Date(e.at));
    const last = days[days.length - 1];
    if (last && last.iso === iso) last.list.push(e);
    else days.push({ iso, list: [e] });
  });
  return days
    .map(
      (d) =>
        `<div class="jv-label"><span>${escapeHtml(consoleDayLabel(d.iso))}</span><i></i></div><ul class="cn-feed">${d.list.map(consoleEntryHtml).join("")}</ul>`,
    )
    .join("");
}
function renderConsole() {
  const el = document.getElementById("panel-console");
  if (!el) return;
  if (!document.getElementById("console-input")) {
    el.innerHTML = consoleShellHtml(); // drawn once, so typing never loses the box or its focus
    consoleChipsMode = null;
  }
  consoleRefreshBox();
  document.getElementById("cn-preview").innerHTML = consolePreviewHtml();
  document.getElementById("cn-review").innerHTML = consoleReviewHtml();
  document.getElementById("cn-feed").innerHTML = consoleFeedHtml();
}

// ---- actions (wired in shell.js's SHELL_* tables) ----
function consoleInput() {
  return document.getElementById("console-input");
}
function consoleTextChanged() {
  const input = consoleInput();
  if (input && !input.value.trim()) consoleMode = null; // clearing the box unlocks the switch
  consoleRefreshBox();
}
function consoleSetMode(mode) {
  if (!CONSOLE_MODES[mode]) return;
  consoleMode = mode;
  consoleRefreshBox();
}
function consoleUseChip(mode, i) {
  const chip = CONSOLE_MODES[mode] && CONSOLE_MODES[mode].chips[i];
  const input = consoleInput();
  if (!chip || !input) return;
  input.value = chip;
  consoleMode = null; // the chip's own text picks the mode
  consoleRefreshBox();
  input.focus();
}
function consoleSubmit() {
  const input = consoleInput();
  if (!input) return;
  const text = input.value.trim().slice(0, CONSOLE_TEXT_MAX);
  if (!text) {
    input.focus();
    return;
  }
  const mode = consoleCurrentMode(text);
  input.value = "";
  consoleMode = null;
  if (mode === "ask") {
    consoleLog({ kind: "ask", text });
    renderConsole();
    showToast("Saved here");
    input.focus();
    return;
  }
  const rows = consoleParse(text);
  if (!rows.length) return;
  consolePreview = { src: text, rows };
  renderConsole();
  const add = document.getElementById("cn-add");
  if (add && !add.disabled) add.focus({ preventScroll: true });
}
function consoleCycleRow(i) {
  const row = consolePreview && consolePreview.rows[i];
  if (!row) return;
  const types = consoleRowTypes(row);
  row.type = types[(types.indexOf(row.type) + 1) % types.length];
  renderConsole();
}
function consoleEdit() {
  if (!consolePreview) return;
  const input = consoleInput();
  input.value = consolePreview.src;
  consolePreview = null;
  renderConsole();
  input.focus();
}
function consoleExpense(i) {
  const row = consolePreview && consolePreview.rows[i];
  if (!row || row.type !== "expense") return;
  const f = consoleExpenseOf(row);
  openComposer("money");
  document.getElementById("composer-text").value = f.amount != null ? `${f.text} $${f.amount}` : f.text;
  composerTextChanged();
}
function consoleAdd() {
  const p = consolePreview;
  if (!p) return;
  const todos = p.rows.filter((r) => r.type === "todo"),
    shops = p.rows.filter((r) => r.type === "shop"),
    asks = p.rows.filter((r) => r.type === "ask");
  if (!todos.length && !shops.length && !asks.length) return;
  const before = dataSnapshot();
  // each new to-do goes to the top of its group (like the + sheet); adding in reverse keeps the typed order
  todos
    .slice()
    .reverse()
    .forEach((r) => {
      const f = consoleTodoOf(r);
      const t = {
        id: genId("todo"),
        text: f.text,
        done: false,
        due: f.due,
        starred: false,
        subitems: [],
        completedAt: null,
      };
      const at = todoList.findIndex((x) => !x.done && todoGroup(x) === todoGroup(t));
      if (at >= 0) todoList.splice(at, 0, t);
      else todoList.push(t);
    });
  shops.forEach((r) => {
    const f = consoleShopOf(r);
    const w = { id: genId("want"), name: f.text, meta: "", price: f.price, link: null };
    if (f.need) w.kind = "need"; // otherwise wantKind()'s usual rule (General items are wants)
    setWantCategory(w, "General");
    wantsList.push(w);
  });
  if (todos.length) saveContent("todo-content", todoList, { toast: false });
  if (shops.length) saveContent("wants-content", wantsList, { toast: false });
  const after = dataSnapshot();
  asks
    .slice()
    .reverse()
    .forEach((r) => consoleLog({ kind: "ask", text: r.src }));
  const entry =
    todos.length || shops.length
      ? consoleLog({ kind: "capture", text: p.src, todos: todos.length, shop: shops.length })
      : null;
  consolePreview = null;
  if (todos.length || shops.length) {
    renderHome();
    renderWants();
  }
  renderConsole(); // focus isn't moved back to the box: on a phone the keyboard would cover the Undo
  if (!entry) {
    showToast("Saved here");
    return;
  }
  // one Undo for everything this Add saved
  showUndoToast(consoleAddedText(entry.todos, entry.shop), () => {
    undoTo(before, after);
    const e = consoleFeed.find((x) => x.id === entry.id);
    if (e) {
      e.undone = true;
      writeQuietly(CONSOLE_FEED_KEY, consoleFeed);
    }
    renderConsole();
  });
}
function consoleGo(where) {
  if (where === "todo" || where === "wants" || where === "jazz3") activateTab(where);
}
// The orb used to open Jazz 3.0: say where it went, once per device, the first time the orb is used
function consoleOrbUsed() {
  try {
    if (localStorage.getItem(CONSOLE_MOVED_KEY) || undoPending) return;
    localStorage.setItem(CONSOLE_MOVED_KEY, "1");
  } catch (e) {
    return;
  }
  showToast(CONSOLE_MOVED_MSG);
  clearTimeout(toastTimer); // a longer read than "Saved"
  toastTimer = setTimeout(() => document.getElementById("toast").classList.remove("show"), 6000);
}
