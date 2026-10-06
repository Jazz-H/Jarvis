# Jazz 2.0 — Personal Dashboard PWA

An installable mobile web app that pulls the Jazz 2.0 series (originally separate Word
docs) into one place with five tabs: **Home, To-Do, Shopping, Wardrobe, Skin & Hair.**

Live at **https://jazz-h.github.io/Jazz2.0/** (GitHub Pages, deployed from `main`).

## Using the app

**Home** is a dashboard. It has:
- a To-Do summary of overdue and due-today items (up to 3), which you can tick off in place;
- today's skin routine progress ("AM 4/6 · PM 0/6"), the streak, and the next wash day;
- Wardrobe and Shopping stat tiles;
- **Up next**: the top two items to buy, by priority then price.

Tapping a card opens its tab.

**To-Do** is the full list.
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
- **Other actions.** Star an item to float it to the top of its group. Drag the grip to
  reorder, or to move an item into another date group.
- **Completed.** Finished items sit behind a "N completed" toggle with Restore, Duplicate,
  Delete, and Clear completed. They're archived after 7 days.

**Skin & Hair** is built around doing the routine, not just reading it. Cards, top to bottom:
- **Today:** a checklist of AM and PM steps with done/total counts, the wash-day badge, and
  an N-day streak (days with both AM and PM finished). Check-offs reset daily and sync
  across devices.
- **This week:** Mon–Sun rows showing only what differs from the base routine
  ("Exfoliate", "Wash day"). Tap a day for its full list.
- **Wash day:** pick a frequency (every week, 10 days, 2, 3, or 4 weeks) and tap any date
  on the month calendar to make it a wash day. The schedule repeats from that date, and
  wash days are highlighted. Each change shows an Undo.
- **Routine:** the one place to edit the AM, PM, and wash-day PM steps. A step can be
  limited to certain days with a Mon–Sun chip picker. New steps go before any
  "… — last step" entry, so SPF and lash serum stay last.
- **Key rules:** the routine's ground rules.

On wash days, the wash-day PM routine replaces the regular PM routine. The schedule is
stored on the routine as `wash: {anchor, everyDays}`. Routines saved before it was editable
fall back to the original cadence: every 2 weeks from Thu Jul 16 2026.

**Wardrobe** is the closet.
- **Wardrobe built:** progress, counting closet items against wardrobe items still to buy.
- **Shopping link:** "N wardrobe items to buy · Shopping list →" opens Wants filtered to
  Wardrobe.
- **In closet:** grouped by category, with "fit pending" badges.
- **Reference cards:** Fit rules and the Sizing grid.

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
- **Buying.** Mark bought moves the item to Purchased. A bought wardrobe item also appears in
  the closet; un-buying takes it back out.
- **Priority.** High-priority items get a badge and sort first.

**Adding things.** A floating **+** button on Home, To-Do, Shopping, and Wardrobe opens one
shared bottom sheet whose fields fit the tab:
- **To-do** (Home, To-Do): described under To-Do above.
- **Shopping → New item:** a trailing price in the text sets it ("helmet $250", tap the
  price pill to keep it as text), plus Need / Want, General / Moto / Wardrobe (with a
  Tops, Bottoms… row), High priority, and Details (notes, price, link). New items start in
  whatever the filter is showing, and the category sticks between adds for batches.
- **Wardrobe → Add to wardrobe:** In closet or To buy (which lands on Shopping), a category
  row, Fit pending, and Notes.

Every mode adds several in a row: Enter saves and clears, and the header counts the adds.
Skin & Hair has no + because adding routine steps is a rare edit there.

**Editing.** Each editable card has its own **Edit** chip. With it on, rows become tappable
to edit or delete, and "+ Add …" rows appear for rules, sizes, sub-items, and routine steps
(new to-dos, shopping items, and closet items come from the + button). Edit forms are a bottom sheet on phones and
a centered dialog on desktop. Esc closes them, Enter saves, and Delete always confirms first.

**Navigation.**
- **Tab bar:** at the bottom on phones. At ≥768px it moves under the header, with a centered
  column (760px, or 920px at ≥1440px).
- **Swiping:** swipe left or right to switch tabs, in tab-bar order (`TAB_ORDER`).
- **Hard refresh:** pull down from the top of a tab (or use the refresh button on
  desktop). It clears the service worker cache and reloads, but never touches your data.
- **Home-screen shortcuts:** long-press the installed icon for Add a to-do, Shopping,
  Wardrobe, and Today's routine. These come from `shortcuts` in `manifest.json`, handled
  by `applyLaunchParams()`.

## Project layout

| File | Purpose |
| --- | --- |
| `jazz2.0.html` | The whole app: HTML, CSS, and JS in one file. No build step, no framework. |
| `index.html` | Redirects the bare site URL to `jazz2.0.html`. |
| `manifest.json` | PWA manifest: name, icons, standalone display, home-screen shortcuts. |
| `sw.js` | Service worker. HTML is network-first so a normal reload picks up new deploys. Icons and the manifest are cache-first. Cross-origin and non-GET requests are never intercepted, so GitHub API calls can't be served stale. |
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

The suite (100 checks) drives the real app in headless Chromium against a tiny built-in
server. It covers:
- every tab on phone and desktop;
- the + sheet in all three modes (to-do dates and sub-items, shopping price/category/details,
  wardrobe closet vs. to-buy, batches, per-tab button);
- to-do date parsing, migration, and undo;
- drag between date groups;
- quiet 7-day archiving;
- routine equivalence with the legacy per-day data over 28 dates;
- check-offs and streaks;
- the wash-day calendar and frequency;
- need/want tags, the Moto category, and the Shopping rename;
- the wardrobe → wants migration and buy-to-closet flow;
- the totals rule;
- backup and restore;
- sync against a mocked Gist API;
- XSS hardening.

CI runs the suite on every PR.

**Ship.** Merge to `main` and GitHub Pages deploys it. When cached assets change, bump
`CACHE_NAME` in `sw.js` so installed copies refresh them. The HTML itself is network-first.

**Conventions worth keeping:**
- **Stored data is untrusted.** It can arrive from sync or a backup file. Render text with
  `escapeHtml`/`escapeAttr`, and links with `linkHtml()`, which only allows `http(s)`.
  `normalizeLoadedData()` gives a fresh id to any id that isn't a plain token, because ids
  are interpolated into inline `onclick` handlers.
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
| `routine-checks` | Daily check-offs by date: `{am: [ids], pm: [ids], amDone, pmDone}`, about 60 days kept |
| `skin-rules-content`, `style-rules-content`, `sizes-content` | Reference lists |
| `capsule-content` | Owned closet items (`state: "owned" \| "pending"` for fit pending) |
| `wants-content` | Shopping list: `{id, name, meta, price, link, estimated?, priority?, kind?: "need" \| "want", wardrobeCat?, moto?}` |
| `wants-state` | Bought flags, by want id |
| `data-updated-at` | Last real edit, used for sync |
| `sync-token`, `sync-gist-id` | Sync settings for this device (never synced) |

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
- **Conflicts:** the newest edit wins.

**Backup.** The same dialog has **Download backup** and **Restore…**.
- **Format:** one JSON file containing the full live value of every list.
- **Sync not required:** works whether or not sync is on.
- **Download:** uses the share sheet on mobile.
- **Restore:** asks for confirmation, then counts as an edit, so it syncs.

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
