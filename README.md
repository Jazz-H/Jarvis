# Jazz 2.0 — Personal Dashboard PWA

An installable mobile web app that pulls the Jazz 2.0 series (originally separate Word
docs) into one place with five tabs: **Home, To-Do, Budget, Shopping, Skin & Hair.**
Clothes to buy live on the Shopping list under the Wardrobe category. (The old closet view
was removed; its data is still loaded, synced and backed up, just not shown.)

Live at **https://jazz-h.github.io/Jazz2.0/** (GitHub Pages, deployed from `main`).

## Using the app

**Home** is a day planner.
- **Calendar strip:** a Sunday-first week with dots for what's due and a droplet on wash
  days. Swipe it sideways (or ‹ ›) for other weeks; swipe down (or tap the grab bar) for the
  full month. Any date can be picked; **Today** jumps back.
- **Day hero:** the date, a done/total progress ring, and what's left.
- **US holidays:** worked out by rule for every year: the 11 federal holidays (plus the
  weekday they're observed on; "banks closed") and common observances (Valentine's,
  St. Patrick's, Easter, Mother's/Father's Day, Election Day, Halloween, Christmas Eve,
  New Year's Eve). Holiday dates are colored on the calendar and named on the day;
  Budget's calendar notes the bank holidays.
- **Day list:** Overdue, the day's open to-dos (starred first; finished ones leave Home but
  still count in the ring, and live on in To-Do's Completed),
  bills due ("Pay Rent · $1,450"), the Wash hair item on wash days, future repeats of
  recurring to-dos and bills, and an Anytime peek on today. Everything can be ticked in place.

**To-Do** is the full list.
- **Editing:** one compact sheet of chips. **When:** Anytime, Today, Tomorrow, or a date;
  **+ Multi-day** adds a last day so it spans several days (shown on each, "Day 2 of 3",
  not overdue until the last). **Repeat:** Never, Daily, Weekdays, Weekly, 2 weeks, Monthly,
  Yearly, or **Custom** (an "every N weeks | months" stepper). A line underneath reads the choice
  back; sub-items fold away behind **+ Add sub-items**.
- **Types:** each to-do shows a small colored icon for its type, guessed from its words
  (health, appointment, fitness, birthday, social, travel, car, pet, work, call, errand,
  chores; a time like "@ 9am" reads as an appointment). Edit's **Type** row shows the
  guess (**Auto**), lets you pick another, or **None**.
- **Adding.** Tap the floating **+** button (on Home and To-Do; see *Adding things* below).
  The **New to-do** form opens with the keyboard up:
  - **Text box:** a trailing day word sets the date ("dentist fri"), lighting up its pill;
    tap that pill to keep the words as plain text instead.
  - **Pills:** Today, Tomorrow, This weekend, Pick date (native date picker), Star, and
    Sub-items (one per line).
  - **Many in a row:** Enter (or Add to-do) saves and clears the form; the header counts
    "2 added · last for Friday". Close it with ×, a tap outside, a swipe down, or Esc.
  - The "Add a to-do" home-screen shortcut opens the form directly. To-dos are capped at
    200 characters.
- **Groups.** Overdue (red), Today, Anytime (no date), Tomorrow, the next five weekdays, and
  Later.
- **Completing.** Only the left checkbox completes an item, and a 5-second Undo follows.
  Tapping the text opens the edit form: title, a date picker, and "add sub-items, one per
  line".
- **Other actions.** Star an item to float it to the top of its group. Press and drag a
  row (hold briefly on a phone; click and drag with a mouse), or drag its grip, to reorder or
  move it into another date group. On Home, dragging a to-do into another section moves it
  there: the day's list sets that date, Anytime clears it.
- **Completed.** Finished items sit behind a "N completed" toggle with Restore, Duplicate,
  Delete, and Clear completed. They're archived after 7 days.

**Skin & Hair** is built around doing the routine, not just reading it. Cards, top to bottom:
- **Today:** a checklist of AM and PM steps with done/total counts, the wash-day badge, and
  an N-day streak (days with both AM and PM finished). Check-offs reset daily and sync
  across devices.
- **This week:** Sun–Sat rows showing only what differs from the base routine
  ("Exfoliate", "Wash day"). Tap a day for its full list.
- **Wash day:** pick a frequency (every week, 10 days, 2, 3, or 4 weeks) and tap any date
  on the month calendar to make it a wash day. The schedule repeats from that date, and
  wash days are highlighted. Each change shows an Undo.
- **Routine:** the one place to edit the AM, PM, and wash-day PM steps. A step can be
  limited to certain days with a Sun–Sat chip picker. New steps go before any
  "… — last step" entry, so SPF and lash serum stay last.
- **Key rules:** the routine's ground rules. The card is hidden while the list is empty.

On wash days, the wash-day PM routine replaces the regular PM routine. The schedule is
stored on the routine as `wash: {anchor, everyDays}`. Routines saved before it was editable
fall back to the original cadence: every 2 weeks from Thu Jul 16 2026.

**Shopping** (the `wants` tab in code; renamed from "Wants") is the single shopping list:
clothes, moto gear, and everything else.
- **Need or want.** Every item carries a **Need** or **Want** tag. Unless set in its form,
  wardrobe items count as needs and everything else as wants. Needs sort ahead of wants,
  after high-priority items.
- **Adding.** The **+** button opens the New item sheet (see *Adding things*).
- **Filtering.** All / Needs / Wants / Wardrobe / Moto chips narrow the list. They sit
  in one row that scrolls sideways (no scrollbar; on phones it runs to the screen edges
  with a fade on the right), and the selected chip stays in view. Quick-adding under
  a filter keeps the new item in it.
- **Categories.** Each item's form has a Category select: General, **Moto** (motorcycle
  gear, `moto: true`, shown with a "Moto" tag), or a wardrobe category (`wardrobeCat`,
  shown as "Wardrobe · Tops"). They're mutually exclusive.
- **Buying.** Mark bought moves the item to Purchased; tap Purchased to undo.
- **Later.** Tap **Later** under an item (or the Later chip when adding, or the box in Edit)
  to move it off To buy into a folded **Later** card, left out of the counts and totals;
  **Back to list** brings it back.
- **Priority.** High-priority items get a badge and sort first.

**Budget** is laid out like the budget sheet, one calendar month at a time (‹ › to step months).
- **Top:** four tiles: **Income** (this month's checks; ~ when some are expected),
  **Bills & spending** (the paycheck plans' lines, less what goes to goals; without plans,
  bills plus spending), **Left over**, and the first goal (saved, of target, %). Without a
  paycheck: Bills left, Spent, an Add-your-paycheck tile, and the goal or Left to spend.
- **My Bills / Joint Bills:** tables like the sheet: Due · Expense (logo, name, and the
  card/bank under it) · Amount · Paid. Paid rows stay, struck through; overdue due days are
  red; each table ends in a Total. Tap a bill to edit it (or a paid one to fix the payment).
- **Paycheck Plan:** every check this month, its lines (tickable, optionally pointed at a
  goal) and **Remaining**. Tap the check to set its amount; with pay that varies, its box
  marks it Received. "+ Bills due Oct 15–28 · $X" adds that check's bills as a line.
- **Month at a Glance:** Income, Bills & spending, To <goal>, Left over.
- **Calendar** (folded at the bottom): starts as the selected day's week (swipe down or tap
  the bar for the month): a dot per bill due (red overdue, grey paid) and a $ on paydays.
  Tap a day to see and tick off its bills or open its paycheck.
- **Copy plans:** when a month's paydays are empty, one tap copies last month's lines,
  moving month names along ("1/2 of Oct Bills" → "1/2 of Nov Bills").
- **Bills:** amount, due date, repeat, Monthly or Joint, the card/bank that pays it,
  a pay link, **your share %** for joint bills, and **amount varies** (ticking it paid asks
  what it came to). Ticking logs a payment and moves the bill to its next due date; tap a
  paid bill to fix the amount or un-pay it. Bills also show on Home.
- **Bill logos:** each bill shows its company's logo: from a **Company website** set on the
  bill, else its pay link's site, else a guess from well-known names (Spotify, AT&T, Duke…);
  otherwise a colored first letter. With a pay link, tapping the logo opens it. Logos come
  from DuckDuckGo's icon service, which sees only the company's domain.
- **Autopay:** an Autopay bill pays itself: when its due date arrives, the payment is logged
  (dated that day, shown as "Autopaid") and the bill moves to its next due date. Switching
  Autopay on for a bill that's already due pays it. Un-paying an autopaid bill holds that
  date so it isn't re-paid. Payment ids come from bill + date, so devices never double it.
- **Goals:** long-term savings goals with a target, optional date ($/month needed, On pace /
  Behind), + Add money, and History. A milestone bar marks 25/50/75/100%, with the next
  milestone and a finish date at the last 3 months' pace. Plan lines pointed at a goal count once their payday
  arrives. The card appears once there's a goal.
- **Spending** by category appears once something's logged (or from Manage).
- **Manage** (a quiet "⚙ Manage budget" link at the bottom opens it as a sheet): paychecks, add income, Goals and Spending until used,
  Cards & banks, **Import bills from a sheet** (paste rows: card/bank, "6th", expense,
  "$120.00" or "-"), **Import paychecks** (date + amount rows set each payday's amount), and
  **Import paycheck plans** (blocks starting with a "Paycheck" row).
- **Pay that varies:** an income marked "Pay varies by check" shows unreceived checks as
  `~expected`; tick a check's box (Received) with its real amount, and later checks are estimated
  from the last 3 received.
- **Import link:** `jazz2.0.html#import=<base64url JSON>` adds bills, paychecks with plans,
  and goals after a confirm, skipping anything already there (a paycheck already there can be switched to "varies" and have its paydays' amounts set). The data stays in the URL
  fragment, so personal numbers never land in this repo.
- Payments and expenses older than about 13 months are pruned automatically.

**Adding things.** A floating **+** button on Home, To-Do, Shopping, and Budget opens one
shared bottom sheet whose fields fit the tab:
- **To-do** (Home, To-Do): described under To-Do above.
- **Shopping → New item:** a trailing price in the text sets it ("helmet $250", tap the
  price pill to keep it as text), plus Need / Want, General / Moto / Wardrobe (with a
  Tops, Bottoms… row), High priority, and Details (notes, price, link). New items start in
  whatever the filter is showing, and the category sticks between adds for batches.
- **Budget → Add to budget:** Expense or Bill. A trailing amount in the text sets it
  ("groceries $54") or use the Amount box. Expenses take a date (Today, Yesterday, Pick date)
  and a category; bills take a due date, a repeat, Autopay, and a pay link.

Every mode adds several in a row: Enter saves and clears, and the header counts the adds.
Skin & Hair has no + because adding routine steps is a rare edit there.

**Editing.** Like Android apps: tap an item to edit it (to-dos, bills, routine steps, rules,
Shopping items, plan lines…), tap its checkbox to tick it off. There are no Edit modes;
"+ Add …" rows sit at the bottom of each card (routine steps, rules, categories), and
spending categories have an Edit link inside when opened (new to-dos, shopping items, and
budget entries come from the + button). Edit forms are a bottom sheet on phones and
a centered dialog on desktop. Esc closes them and Enter saves. **Delete** happens right away
with a 5-second **Undo** (it restores a snapshot of every list, so linked data comes back too);
only turning sync off still asks first.

**Navigation.**
- **Tab bar:** at the bottom on phones. At ≥768px it moves under the header, with a centered
  column (760px, or 920px at ≥1440px).
- **Swiping:** swipe left or right to switch tabs, in tab-bar order (`TAB_ORDER`).
- **Hard refresh:** pull down from the top of a tab (or use the refresh button on
  desktop). It clears the service worker cache and reloads back onto the same tab and scroll
  position, and never touches your data.
- **Home-screen shortcuts:** long-press the installed icon for Add a to-do, Shopping,
  Budget, and Today's routine. These come from `shortcuts` in `manifest.json`, handled
  by `applyLaunchParams()`.

## Project layout

| File | Purpose |
| --- | --- |
| `jazz2.0.html` | The whole app: HTML, CSS, and JS in one file. No build step, no framework. |
| `index.html` | Redirects the bare site URL to `jazz2.0.html`. |
| `manifest.json` | PWA manifest: name, icons, standalone display, home-screen shortcuts. |
| `sw.js` | Service worker. HTML is network-first so a normal reload picks up new deploys, with the cached page as the offline fallback (query strings ignored, so `?tab=` shortcuts work offline). Icons and the manifest are served from cache and refreshed in the background. Install never caches an error response. Cross-origin and non-GET requests are never intercepted, so GitHub API calls can't be served stale. |
| `icon-192.png`, `icon-512.png` | App icons. See *Design system*. |
| `tests/regression.mjs` | Regression suite (see *Development*). |
| `package.json` | Only holds the test dependency (Playwright). The app itself needs no install. |
| `.github/workflows/test.yml` | Runs the suite on every PR and every push to `main`. |

### How `jazz2.0.html` is organized
1. **CSS:** `:root` theme tokens, base components, to-do and routine styles, hover styles
   (mouse only), then the desktop media queries.
2. **Markup:** header (title, date, Sync & backup button, desktop refresh button), five
   empty `tabpanel` sections, the toast, the modal, and the tab bar.
3. **Script**, roughly top to bottom:
   - constants and icons;
   - storage and escaping helpers;
   - the default data;
   - the modal engine;
   - one `render*` function per tab (`renderHome` updates both Home and To-Do);
   - feature logic (to-do dates, routine, wardrobe/wants, sync, backup);
   - init.

## Development

**Run locally.** Serve the folder over HTTP, for example with `python3 -m http.server`, and
open `/jazz2.0.html`. The service worker only registers on `https:` or `localhost`.

**Test.** Run:

```sh
npm install
npx playwright install chromium   # or set CHROMIUM_PATH to an existing Chromium
npm test
```

The suite (384 checks) drives the real app in headless Chromium against a tiny built-in
server. It covers:
- every tab on phone and desktop;
- the + sheet in every mode (to-do dates, repeats and sub-items; shopping price/category/
  details; budget expenses, bills and goals; batches; per-tab button);
- to-do date parsing, migration, undo, recurring to-dos, and drag between date groups;
- Home's calendar strip, day agenda, and the Wash hair row;
- quiet 7-day archiving;
- routine equivalence with the legacy per-day data over 28 dates, check-offs, streaks,
  collapsible bands, and the wash-day calendar;
- Shopping (need/want, Moto, filters) and the old wardrobe → shopping migration;
- Budget: pay periods, bills (pay/undo, variable amounts, shares, card totals, import),
  paycheck plans (import, copy forward), goals, spending;
- month-end date math, midnight rollover, and malformed-data robustness;
- backup and restore, sync against a mocked Gist API (including the per-list merge), and
  XSS hardening.

CI runs the suite on every PR.

**Ship.** Merge to `main` and GitHub Pages deploys it. When cached assets change, bump
`CACHE_NAME` in `sw.js` so installed copies refresh them. The HTML itself is network-first.

**Conventions worth keeping:**
- **Stored data is untrusted.** It can arrive from sync or a backup file. Render text with
  `escapeHtml`/`escapeAttr`, and links with `linkHtml()`, which only allows `http(s)`.
  `normalizeLoadedData()` gives a fresh id to any id that isn't a plain token, because ids
  are interpolated into inline `onclick` handlers. `sanitizeCoreData()` and
  `normalizeBudgetData()` coerce every list to a safe shape on load, so one malformed record
  can't stop the app from starting.
- **User actions vs. housekeeping.**
  - User actions save with `saveContent()`, which bumps the sync timestamp.
  - Housekeeping (migrations, auto-archive) saves with `writeQuietly()`, which doesn't.
  - Why: housekeeping that bumps the timestamp makes a stale device look newest, so its
    sync overwrites real edits from the other device.
- **Migrations are deterministic.** They derive ids from content, so every device converts
  old data identically. They also run on synced and restored data, via `applyRemote()`.
- **Collapsible cards** use `collapsibleCard()`; the icons are `BOX_CHECK_SVG`,
  `CHEVRON_DOWN`, and `glanceArrow()`.

## Data and storage

Everything lives in `localStorage` on the device:

| Key | Contents |
| --- | --- |
| `todo-content` | To-dos: `{id, text, done, due: "YYYY-MM-DD" \| null, starred, subitems, completedAt}` |
| `todo-archive-content` | Completed to-dos older than 7 days (newest 200) |
| `skin-routine-content` | `{am, pm, washPm, wash?: {anchor, everyDays}}`; steps are `{id, label, product, note?, days?}`, where `days` uses weekday numbers and 0 = Sun |
| `routine-checks` | Daily check-offs by date: `{am: [ids], pm: [ids], amDone, pmDone}`, about a year kept |
| `skin-rules-content` | Skin & Hair key rules |
| `style-rules-content`, `sizes-content`, `capsule-content` | From the removed closet view (fit rules, sizes, owned clothes). Kept, synced and backed up so nothing is lost; not shown |
| `wants-content` | Shopping list: `{id, name, meta, price, link, estimated?, priority?, kind?: "need" \| "want", wardrobeCat?, moto?}` |
| `wants-state` | Bought flags, by want id |
| `bills-content` | Bills: `{id, name, amount, due, repeat, autopay, link, group: "personal" \| "joint", account, share?, varies?, done?}` (`done` = a paid one-time bill) |
| `bill-payments` | Payments: `{id, billId, name, amount, due, date}` (`due` = the due date it covered) |
| `budget-content` | `{categories, expenses, accounts: [names], income: [{id, name, amount, start, repeat}], plans: {"incomeId\|date": {amount?, lines: [{id, name, amount, goal?, done?}]}}, goals: [{id, name, target, saved, date, created, log: [{id, date, amount, note}]}]}`; categories are `{id, name, limit}`, expenses `{id, name, amount, cat, date}` |
| `data-updated-at` | Last real edit, used for sync |
| `style-state` | Legacy wardrobe toggles, kept for the wardrobe → wants migration |
| `sync-token`, `sync-gist-id`, `sync-base` | Sync settings for this device, and each list as of the last sync (never synced) |

Lists still on their built-in defaults have no key until first edited.

**Legacy formats, converted automatically on load and on synced or restored data:**
- **To-dos:** a weekday name in `day` → a real `due` date.
- **Skin routine:** seven per-day copies (`skin-days-content`) → one routine, via
  `routineFromDays()`.
- **Wardrobe:** "needed" capsule items plus `style-state` toggles → Wants items with
  `wardrobeCat`, via `migrateWardrobeNeeds()`.
- **Escaped text:** HTML entities (`&amp;`) in stored text → plain text.

**Sync (opt-in).** Tap the cloud button, paste a **classic** GitHub token with only the
`gist` scope, and do this on each device. Fine-grained tokens can't use the Gist API.
- **Storage:** all lists live as one JSON file in a private gist.
- **Timing:** the app pushes about 1.5s after each edit, and pulls on load and whenever
  it returns to the foreground.
- **Conflicts:** merged per list. Each device remembers every list as of its last sync
  (`sync-base`). Lists this device changed are sent up; lists only the other device changed
  are taken from the gist; if both changed the same list, the device syncing now wins for
  that list only. The gist is re-read right before every write, and sync waits while an
  edit form is open. A device's very first sync falls back to "newest copy wins".

**Backup.** The same dialog has **Download backup** and **Restore…**.
- **Format:** one JSON file containing the full live value of every list.
- **Sync not required:** works whether or not sync is on.
- **Download:** uses the share sheet on mobile.
- **Restore:** asks for confirmation, replaces everything (lists the backup doesn't have go
  back to their defaults), then counts as an edit, so it syncs.

## Design system

**Theme.** "Graphite": a neutral charcoal ground with a soft-white primary accent, pastel
blue for AM, and pastel pink for PM. Every color comes from the `:root` tokens, so a theme
change only touches that block, plus `theme-color` in the HTML and `manifest.json`. The
token names are historical:
- `--gold`: AM;
- `--navy`: PM;
- `--olive`: the primary accent;
- `--link`: links.

**Icons.**
- **Design:** a charcoal terminal-window card with a blue→pink "J", a raised "2.0", and a
  white cursor block.
- **Safe zone:** the card sits 17% in from the edge to stay inside Android's maskable-icon
  safe zone.
- **Source:** generated with Pillow at 2048px, then downsampled.

**Touch.** Rows and controls use ~44px touch targets. Text inputs are 16px on touch
devices so iOS doesn't zoom.

## Known limitations and ideas
- **No notifications.** A static web page can't wake itself up to alert you, and iOS
  blocks this even for installed PWAs. The planned workaround is "Add to calendar" on
  dated to-dos (an `.ics` file with an alarm).
- **Home's short step names** (`STEP_SHORT_NAMES`) are a code lookup. Unmapped labels fall
  back to the full label.
- **Sync push replaces the gist file.** A device on an outdated app version can drop keys
  it doesn't know about until it updates.

## Working style
Make judgment calls and show finished output; expect targeted corrections rather than full rewrites.
