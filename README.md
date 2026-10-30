# Jarvis — Personal Dashboard PWA

An installable mobile web app that pulls the Jazz 2.0 series (originally separate Word
docs) into one place, now named **Jarvis**, with five tabs: **Home, To-Do, Jazz 3.0, Shopping,
Beauty** (Budget opens from Home). Jarvis, an AI chief of staff that runs in GitHub
Actions, writes a morning briefing that leads Home (see *Jarvis* below and `docs/jarvis/`).
Clothes to buy live on the Shopping list under the Wardrobe category. (The old closet view
was removed; its data is still loaded, synced and backed up, just not shown.)

Live at **https://jazz-h.github.io/Jazz2.0/** (GitHub Pages, deployed from `main`).

## Using the app

**Home** is the main tab. It's a dashboard fed by the whole app, with the day Planner below
it. Each fact appears once, and each tile drills down: tile → its detail → its tab.
- **Status:** Jarvis's state (Online / Standing by / Local mode), when it last briefed you,
  and a greeting ("Good morning, Jazz."). The date is in the header.
- **Quick add:** one line under the greeting. Type "call mom tomorrow" (or "…friday", "…today")
  and press Enter or +: it's added with that date, the same parsing as the + sheet, and the box
  stays ready for the next one. Sync waits while you're typing there.
- **Tomorrow (from 5 PM):** tomorrow at a glance above the briefing: its forecast, to-dos,
  bills, wash day and workouts. **Plan tomorrow** opens tomorrow in the Planner. Under it,
  **Next 14 days** calls out (in pink) upcoming birthdays, car maintenance, appointments and
  trips from your to-do types, plus a gift idea from Shopping (an item with "gift" in it) when
  a birthday is coming.
- **Today in 60 seconds:** Jarvis's headline and 3–5 ranked items, each tagged with where it
  came from (Jarvis, Jazz, Weather, News). Weather and News lines drill into those details.
  If the Jarvis model didn't finish, the items are assembled automatically and say so; an
  older day's briefing is dimmed and labeled "From <date>". Problems from the run are listed
  under "notes".
- **Wash-day swap:** on a wash day with 50%+ rain or 70%+ humidity, when tomorrow looks drier,
  Jarvis suggests moving wash day to tomorrow. **Move it** moves just this one; **Keep today**
  hides the suggestion for today (this device).
- **Notifications:** a card offers **Turn on** for phone notifications (needs sync on; see
  SETUP section 7). **Not now** hides it on this device for 2 weeks.
- **Your day:** a timeline of today in time order: calendar events (all-day first; past ones
  dimmed; overlapping ones flagged), when rain is likely, Amazon deliveries arriving, the to-dos
  left, bills due today and wash day. Each row drills in: events open the **Calendar** detail
  (today and tomorrow as an agenda), deliveries open **Deliveries** (arriving today with
  **Mark bought** when it's on your Shopping list, then each package's Ordered → Shipped → Out →
  Delivered progress), to-dos go to the Planner, rain to Weather. Until the calendar is connected
  the timeline offers **Connect your calendar** with the setup steps.
- **Outfit:** today's outfit from your saved wardrobe (owned items only): top, bottom, shoes, and
  a layer when it's rainy or under 60°F. Weekdays lean business casual; rain favors boots and a
  jacket. It's plain rules, no AI. **Swap** shows another good option. Hidden until you've saved
  at least a top and a bottom.
- **Systems:** six tiles (Weather, Inbox, Money, Beauty, Jazz 3.0, Shopping), each with
  a headline number, a line of detail and a progress bar. Tap a tile to open its detail right
  under it (one at a time; tap again to close). **Customize** lets you reorder (↑ ↓) or hide
  tiles; the layout is saved on this device.
  - **Inbox:** the tile shows unread mail and what needs you; the detail lists urgent mail,
    people waiting on a reply, and bills found in email, each checked against Budget (a
    mismatch shows the Budget amount and opens Budget).
  - **Weather:** the forecast summary, what to wear, a wash-day note and humidity, then an
    hour-by-hour list (every 3 hours: temperature, conditions, rain). Skin weather sits in
    the detail: the UV peak and its hours with SPF advice, and air quality (both from
    Open-Meteo). Names its agent and time.
  - **Money:** a warning for bills due within 3 days that aren't on autopay, bills due in the
    next 7 days (tick to pay, tap to edit), then the current pay period (payday to payday):
    **Safe to spend** until payday (with the countdown) and a bar of paid vs. due; tap it for
    Budget. The tile names a not-autopay bill when one is due soon.
  - **Beauty:** AM and PM checklists side by side, each headed by its count and a bar
    per step (tap a header for Beauty), plus the streak. The tile adds "UV 7 · SPF" on
    high-UV days.
  - **Jazz 3.0:** a bar for the weight goal and each goal section. Tap one to open that card
    on the Jazz 3.0 tab. Then **one goal item for today** (an unfinished Jazz 3.0 item, the
    same all day; **Done** ticks it, **Another** picks a different one), today's workouts, and
    **Last 7 days**: a row of squares each for routine (AM + PM), workouts and weigh-ins.
  - **Shopping:** a line from Jarvis's briefing when it mentions one of your needs, then the
    top needs (tick when bought, tap to edit), and how many wants and the estimated total.
  - Each detail ends in a link to its tab.
- **News:** 5–8 ranked stories (AI, tech, cars, trending; from Google News), each with its
  topic, a linked headline, the source and a short summary. Names its agent and time.
- **Offline:** everything except Weather and News is built on this device from your own lists,
  so it works offline and with Jarvis not set up.
- **App icon badge:** the installed app's icon shows how many things still need you today:
  open to-dos due today or overdue, plus unpaid bills due today or earlier (where the system
  supports badges, e.g. iOS 16.4+ home-screen apps).
- **New briefing notice:** when sync brings in a new briefing, a "Jarvis: <headline>" toast
  appears, the Home tab gets a dot if you're elsewhere, and the briefing shows **New** until
  seen. `?tab=jarvis` (or `?tab=home`) opens it.
- **Not set up:** the briefing panel says so and points to `docs/jarvis/SETUP.md`.
- **Loading:** while the scripts load, Home shows a shimmering skeleton of its layout (a gentle
  pulse with Reduce Motion on); the dashboard fades in once when it replaces it.

**The Planner** (below the dashboard on Home) is a day planner.
- **Calendar strip:** a Sunday-first week with dots for what's due and a droplet on wash
  days. Swipe it sideways (or ‹ ›) for other weeks; swipe down (or tap the grab bar) for the
  full month. Any date can be picked; **Today** jumps back.
- **Grouped by type:** the day's list puts to-dos with no type first, then each type that
  has any to-dos under its own label (Chores, Errand…; a to-do named after a type, like
  "Chores", leads that group), then Bills.
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
  row (hold briefly on a phone; click and drag with a mouse) to reorder or move it into
  another date group; sub-items work the same way. On Home, dragging a to-do into another section moves it
  there: the day's list sets that date, Anytime clears it.
- **Completed.** Finished items sit behind a "N completed" toggle with Restore, Duplicate,
  Delete, and Clear completed. They're archived after 7 days.

**Beauty** is built around doing the routine, not just reading it. Cards, top to bottom:
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

**Jazz 3.0** is its own tab (third in the bar), made of sections; more are coming. Its bar button stands out with a raised blue orb, and the tab opens on a gradient banner with a chip per section (Weight %, Glow 3/7…). Tapping a chip opens that section and jumps to it.
**Budget** is hidden from the bar for now (its data, bills on Home, and links to
`?tab=budget` all still work). Old `?tab=fitness` links open Jazz 3.0.

**Fitness** (the first Jazz 3.0 section) tracks weight toward a goal; the workouts themselves live in To-Do.
- **Weight:** the latest weigh-in, the goal and how far to go, a bar from your starting
  weight to the goal, the change since you started, your pace over the last 8 weeks
  ("+0.6 lb/week lately"; with fewer than 3 weigh-ins in that window it uses your whole
  history, "on average") with a finish date at that pace, the change since your first
  weigh-in and the average per month, a small trend chart, and a **By month** list (each
  month's low–high and how much it moved) once weigh-ins span two months. **+ Log
  weight** (one weigh-in a day; logging the same day again updates it); tap a weigh-in to
  fix or delete it; tap the goal to set start and goal weights.
- **Weigh-in day:** a weekly **Weigh in** reminder (Mondays unless changed; "Change" in the
  Weight card, or turn it off) shows on Home under Fitness and in that day's To-Do group
  with your last weight. Ticking it opens Log weight for that date, and it ticks itself once
  the day has a weigh-in. If a week goes by without one, it also shows today.

**Goal sections** (Glow, Leadership…) follow Fitness on the Jazz 3.0 tab: each is a card
with a checklist of items and a short note ("Hand cream — nightly"), a "2/7
done" count, tap to edit / move / delete, press and drag to reorder, **+ Add item**, and
**+ New section** for another goal area. Stored as `plan3-content`; the first list ships as
the starting items.

**Workouts** are a weekly plan that fills your to-dos by itself:
- **In To-Do:** each planned workout shows in its day's group for the coming week (tickable
  today, a preview on later days); tap one to edit it. A **Workouts** card under Recurring
  holds the plan: days, optional time, how often (every 1–4 weeks, counted from its start
  date; a plan starts the week of that date) and type. Tap to edit, press and drag to
  reorder, **+ Add workout**, and "Last 4 weeks: N of M done".
- **On Home:** each day's workouts show under their type (Fitness, Pets…), count in the ring
  and calendar dots, and can be ticked there too.
- **Links:** `#import=` with `{"app":"jazz3-fitness", start, goal, weights:[{date,lbs}],
  plan:[{name, days, every, anchor, time, kind}]}` adds what isn't there yet; with
  `{"app":"jazz3-cleanup", removeTodos:[names], addTodos:[{text, repeat, kind}]}` it removes open
  to-dos with those names and adds the given ones (a repeat starts today; skipped if already there)
  ; with `{"app":"jazz3-routine", steps:[{band:"am"|"pm"|"washPm", label, product, note, days, before}],
  updateSteps:[{band, product, days, note}], doneItems:[names], planNotes:[{item, note}]}` it adds
  Beauty routine steps (before the step named by `before`; skipped if that product is already
  in the band; wash-day steps only when there's a wash-day list), changes the days/note of the step
  with that product, ticks those Jazz 3.0 plan items and rewrites their notes
  (after a confirm, with Undo). Personal numbers never go in the repo; they travel only in
  the link's fragment.

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
Beauty has no + because adding routine steps is a rare edit there.

**Reordering.** Press and drag works everywhere a list's order is yours: to-dos and
sub-items (To-Do and Home), routine steps and key rules (Beauty), and each paycheck's
plan lines, goals and spending categories (Budget). There are no grip handles. Bills
(by due date) and Shopping (priority, need, price) sort themselves.

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
- **Pull to sync:** pull down from the top of a tab to sync (which also brings in a new Jarvis
  briefing) and redraw. Without sync it just redraws.
- **Hard refresh:** pull all the way down ("Release to reload the app"), or use the refresh
  button on desktop. It clears Jazz's service worker caches, unregisters Jazz's worker, and
  reloads back onto the same tab and scroll position. Other apps' caches and workers on the
  origin, and your data, are left alone.
- **Home-screen shortcuts:** long-press the installed icon for Add a to-do, Shopping,
  Budget, and Today's routine. These come from `shortcuts` in `manifest.json`, handled
  by `applyLaunchParams()`.

## Project layout

| File | Purpose |
| --- | --- |
| `jazz2.0.html` | The app markup (header, six tab panels, toast, modal, tab bar). It loads `css/app.css` and the `js/*.js` scripts. No build step, no framework. |
| `css/app.css` | All app styles, loaded by a blocking `<link>` in `<head>`. Precached by the service worker. |
| `js/*.js` | The app code, split by feature into ordered **classic scripts** (see *How the app is organized*). Every file is precached by the service worker. |
| `fonts/` | Self-hosted Inter, Rajdhani and Share Tech Mono (SIL OFL; see `fonts/README.md`), precached for offline use. |
| `index.html` | Redirects the bare site URL to `jazz2.0.html`. |
| `manifest.json` | PWA manifest: name, icons, standalone display, home-screen shortcuts. |
| `sw.js` | Service worker. HTML is network-first so a normal reload picks up new deploys, with the cached page as the offline fallback (query strings ignored, so `?tab=` shortcuts work offline). Icons and the manifest are served from cache and refreshed in the background. Install never caches an error response and removes a partial cache if installation fails. Activation only removes older Jazz-owned caches; unrelated origin caches are preserved. Cross-origin and non-GET requests are never intercepted, so GitHub API calls can't be served stale. |
| `icon.svg`, `jarvis-icon-192.png`, `jarvis-icon-512.png` | App icon source and its rendered PNGs (`npm run icons`). See *Design system*. |
| `badge.svg`, `jarvis-badge-96.png` | Notification badge (Android's status-bar icon): white on transparent (`npm run icons`). |
| `tests/regression.mjs` | Regression suite (see *Development*). |
| `scripts/check.mjs` | Dependency-free quality check (`npm run check`). |
| `package.json` | Holds the `check`/`test` scripts and the test dependency (Playwright). The app itself needs no install. |
| `.github/workflows/test.yml` | Runs the suite (and the `agents/` tests) on every PR and every push to `main`. |
| `agents/` | Jarvis backend: TypeScript on the Claude Agent SDK with its own `package.json`. Never shipped to the app. See *Jarvis*. |
| `.github/workflows/jarvis.yml` | Runs Jarvis every morning (and on "Run workflow"). |
| `docs/jarvis/` | `PLAN.md` (phases and design), `SETUP.md` (secrets), `PROMPTS.md` (per-phase prompts). |
| `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md` | Rules for AI coding assistants. |

### How the app is organized
1. **CSS (`css/app.css`):** `:root` theme tokens, base components, to-do and routine styles, hover styles
   (mouse only), then the desktop media queries.
2. **Markup (`jazz2.0.html`):** header (title, date, Sync & backup button, desktop refresh button), six
   empty `tabpanel` sections, the toast, the modal, and the tab bar, followed by the `<script src>` tags.
3. **Scripts (`js/`).** Plain classic scripts, loaded in this order. They share one global scope, so
   **order matters** (a file may use earlier files' top-level `const`/`let` while loading; functions are
   only called later, at runtime). `jazz2.0.html` is the source of truth for the order, and `sw.js`
   `ASSETS` must list every file.

   | File | Contents |
   | --- | --- |
   | `theme.js` | Light/dark theme. Loads in `<head>`, before the stylesheet paints |
   | `constants.js` | Shared constants and inline SVG icons |
   | `core.js` | Storage helpers (one JSON blob per key), toasts, escaping, shared UI state |
   | `defaults.js` | Default data that seeds localStorage on first run |
   | `modal.js` | Modal engine used by every add/edit form |
   | `todo-dates.js` | To-do dates, quick-add parsing, recurring to-dos |
   | `holidays.js` | US holidays by rule |
   | `home.js` | Home calendar strip, day agenda, `renderHome` |
   | `jarvis.js` | Jarvis briefing: normalizing, the new-briefing notice, `ingestBriefingFile` (called by sync), and the briefing, Weather detail and News card |
   | `dashboard.js` | Home's dashboard: status, tiles and their drill-down details for Weather, Money, Beauty, Jazz 3.0 and Shopping (`dashboardHtml`, `dashDrill`, `dashGo`) |
   | `composer.js` | The floating + button's add sheet |
   | `todo.js` | To-do actions, sub-items, kinds, edit sheet, archive, To-Do tab renderer |
   | `skin.js` | Beauty routine, wash-day schedule, rules |
   | `shopping.js` | Shopping tab and wardrobe items |
   | `budget-bills.js`, `budget-income.js`, `budget-goals.js`, `budget-import.js`, `budget-view.js` | Budget: bills and logos; income and paycheck plans; goals; cards and spreadsheet import; pay-period view, month calendar, `renderBudget`, data normalizing |
   | `fitness.js`, `jazz3.js` | Jazz 3.0: workouts/weigh-ins; plan sections |
   | `shell.js` | Tab switching and the delegated `SHELL_CLICK` / `SHELL_KEYDOWN` / `SHELL_INPUT` / `SHELL_CHANGE` tables |
   | `gestures.js`, `drag-reorder.js` | Swipe between tabs and pull-to-refresh; press-to-drag and sortable lists |
   | `sync.js`, `backup.js` | Gist sync; backup download/restore |
   | `data-load.js`, `import-link.js` | Loading, sanitizing and migrating stored data; `#import=` link and launch parameters |
   | `pwa.js` | Hard refresh, view resume, service-worker registration |
   | `boot.js` | Startup sequence (`init`). **Must load last.** |

   **Why not ES modules?** The code shares mutable top-level state (`todoList`, `bills`, `budget`,
   ...) that is reassigned across features, and the regression suite reads and calls those globals
   from `page.evaluate`. Modules would need getters/setters for every shared variable and a rewrite
   of most of the tests, for no runtime benefit on a static site, so the split stays classic scripts.
   The check script concatenates all scripts in page order to catch cross-file redeclarations.

## Jarvis

Jarvis is the AI layer, built in phases (`docs/jarvis/PLAN.md`). Phases 1 and 2 are in: a daily
briefing with Weather and News, plus Calendar, Inbox and Deliveries once Google is connected.
Setup: `docs/jarvis/SETUP.md`.

- **Where it runs:** `.github/workflows/jarvis.yml`, about 6:45am Eastern daily (two UTC cron
  lines, one for EDT and one for EST; only the one in the 6:30–9:00am window delivers, once a
  day), or on demand with "Run workflow".
- **How it works:** `agents/jarvis.ts` reads `jazz2-data.json` from the sync gist for today's
  to-dos, bills due in 3 days, wash days, Shopping needs, Jazz 3.0 goal sections and weight-goal
  progress. It then runs the sub-agents in parallel:
  - **Weather:** `claude-haiku-5-5`, with data from Open-Meteo.
  - **News:** `claude-sonnet-5-5`, with data from Google News RSS.
  - **Calendar:** `claude-haiku-5-5`, from the calendar's secret iCal address (read-only).
  - **Inbox:** `claude-sonnet-5-5`, from Gmail (read-only; headers and snippets only).
  - **Deliveries:** `claude-haiku-5-5`, from Amazon order and shipping emails in Gmail.

  The three Google ones run only when their secrets are set (`npm run google-auth` does the
  one-time Gmail sign-in).

  Code does all fetching, parsing and math, and each model only judges, ranks and summarizes.
  Every sub-agent's output is checked with zod and retried once if invalid. **Jarvis**
  (`claude-opus-5-5`) gets only that checked output plus the app data and writes the summary.
  The orchestrator then writes `jazz2-briefing.json` to the gist.
- **Phone notifications:** after the briefing is written, the orchestrator sends Web Push
  (`agents/tools/push.ts`, `web-push`) to every phone that turned them on (addresses in
  `jazz2-push.json` in the gist; the app writes only that file for this). Up to 3 messages: the
  headline, a bill not on autopay due by tomorrow, and a package arriving today. Signed with the
  `VAPID_PRIVATE_KEY` secret (the public key is in `js/push.js` and `agents/config.ts`). Phones
  that revoked access are removed; a push failure never fails the run.
- **Safety:**
  - Every agent runs with no tools, no MCP servers, no repo settings or `CLAUDE.md`, and no
    secrets except the Anthropic key.
  - Headlines and app text go to models as clearly marked untrusted data.
  - News links come from code, never from a model.
  - Only the orchestrator holds the gist token, and it writes only the briefing file (and
    prunes revoked phones from the push file).
- **Limits:** each run is capped by `MAX_RUN_COST_USD` (default $0.50). Optional sub-agents are
  skipped if they won't fit. A failed sub-agent shows as an error card and the rest still ships.
- **Trace:** each run uploads timings, outcomes and token costs per agent (no inputs) as a
  workflow artifact.
- **Settings:** location, time, feeds and models live in `agents/config.ts`.

## Development

**Run locally.** Serve the folder over HTTP, for example with `python3 -m http.server`, and
open `/jazz2.0.html`. The service worker only registers on `https:` or `localhost`.

**Check.** `npm run check` needs no install. It syntax-checks `sw.js`, `scripts/`, `tests/` and every app script (each `js/*.js` file, plus all of them concatenated in page order to catch cross-file redeclarations), and confirms every local path in the service worker's `ASSETS` list exists, every loaded script is precached, and no `js/*.js` file is orphaned. It also fails on `<script type="module">` and if the app contains any inline `on*` event-handler attribute: use `data-action` (plus the `SHELL_CLICK` / `SHELL_KEYDOWN` / `SHELL_CHANGE` tables) instead.

**Test.** Run:

```sh
npm install
npx playwright install chromium   # or set CHROMIUM_PATH to an existing Chromium
npm test
```

The suite drives the real app in headless Chromium against a tiny built-in
server. It covers:
- every tab on phone and desktop;
- the external stylesheet loads and the app stays styled offline after a service-worker controlled reload;
- service-worker activation and hard refresh preserve unrelated origin caches;
- the regression server confines requested files to the repository root;
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
  XSS hardening;
- the Jarvis briefing: empty state, escaped rendering, safe links only, agent/error cards,
  stale and junk briefings, pulling it from the gist, the in-app notice, and never pushing it.

The Jarvis backend has its own tests (`cd agents && npm ci && npm test`, plus `npm run typecheck`).
They cover every tool and schema, the agent runner, both sub-agents and the orchestrator
(including a failing sub-agent), with every external API mocked.

CI runs both on every PR.

**Ship.** Merge to `main` and GitHub Pages deploys it. When cached assets change, bump
`CACHE_NAME` in `sw.js` so installed copies refresh them. The HTML itself is network-first.

**Conventions worth keeping:**
- **Stored data is untrusted.** It can arrive from sync or a backup file. Render text with
  `escapeHtml`/`escapeAttr`, and links with `linkHtml()`, which only allows `http(s)`.
  `normalizeLoadedData()` gives a fresh id to any id that isn't a plain token, because ids
  are used as `data-*` metadata for delegated `data-action` handlers (which also re-check them against live data). `sanitizeCoreData()` and
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
| `skin-rules-content` | Beauty key rules |
| `style-rules-content`, `sizes-content`, `capsule-content` | From the removed closet view (fit rules, sizes, owned clothes). Kept, synced and backed up so nothing is lost; not shown |
| `wants-content` | Shopping list: `{id, name, meta, price, link, estimated?, priority?, kind?: "need" \| "want", wardrobeCat?, moto?}` |
| `wants-state` | Bought flags, by want id |
| `bills-content` | Bills: `{id, name, amount, due, repeat, autopay, link, group: "personal" \| "joint", account, share?, varies?, done?}` (`done` = a paid one-time bill) |
| `bill-payments` | Payments: `{id, billId, name, amount, due, date}` (`due` = the due date it covered) |
| `budget-content` | `{categories, expenses, accounts: [names], income: [{id, name, amount, start, repeat}], plans: {"incomeId\|date": {amount?, lines: [{id, name, amount, goal?, done?}]}}, goals: [{id, name, target, saved, date, created, log: [{id, date, amount, note}]}]}`; categories are `{id, name, limit}`, expenses `{id, name, amount, cat, date}` |
| `fitness-content` | `{start, goal, weights: [{id, date, lbs}], plan: [{id, name, days: [0–6], every, anchor, time, kind}], checks: {"date\|planId": true}}` (checks older than ~400 days are dropped) |
| `plan3-content` | Jazz 3.0 goal sections: `[{id, cat, item, note, done?}]` (sections are the distinct `cat`s, in order) |
| `data-updated-at` | Last real edit, used for sync |
| `style-state` | Legacy wardrobe toggles, kept for the wardrobe → wants migration |
| `sync-token`, `sync-gist-id`, `sync-base` | Sync settings for this device, and each list as of the last sync (never synced) |
| `jarvis-briefing`, `jarvis-briefing-seen` | The latest Jarvis briefing as pulled from the gist's `jazz2-briefing.json`, and the id of the last one shown. Read-only, this device only: not in `SYNC_KEYS`, never pushed, not in backups |

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

**Theme.** "Reactor", a Jarvis HUD look: a near-black ground with a faint grid, electric cyan
for the accent, amber for warnings and overdue items, soft blue for AM and pink for PM.
- **Light and dark:** the header's theme button cycles **System → Light → Dark**. System
  follows the phone or computer, including when it switches. The choice is stored on this
  device only (`theme-pref`); it isn't synced or backed up. `js/theme.js` sets
  `<html data-theme="light|dark">` and the browser's `theme-color` before the first paint.
- **Tokens:** every color comes from the `:root` tokens in `css/app.css`, and
  `:root[data-theme="light"]` redefines the same ones, so new UI only needs the tokens to
  work in both themes. The names are historical:
  - `--gold`: AM;
  - `--navy`: PM;
  - `--olive`: the primary accent;
  - `--link`: links.

  Newer tokens:
  - `--warn`;
  - `--track`: empty parts of rings and bars;
  - `--trace`: section lines;
  - `--grid`, `--glow` and `--shade`;
  - `--hue-l` / `--hue-bg-l`: the lightness for per-kind hue colors, darker in light mode
    so they stay readable;
  - `--font-body`, `--font-display` and `--font-mono`.
- **Type:** Inter for reading text, Rajdhani for headings and big numbers, and Share Tech Mono
  for small uppercase HUD labels (card titles, section labels, the tab bar). All three are
  self-hosted in `fonts/`. Body text stays Inter at 14–16px so daily reading is easy.
- **Contrast:** text and dim text meet WCAG AA (4.5:1) on their backgrounds in both themes.

**Icons.**
- **Design:** the Jarvis "reactor": a glowing cyan core with a Rajdhani "J", a segmented ring
  (10 of 12 lit), a broken inner ring and a dotted outer ring, on the near-black theme ground
  with faint circuit traces at the edges.
- **Safe zone:** full-bleed for maskable use; the rings and the "J" sit inside the central 80%
  circle, so Android's round crop only trims the circuit traces.
- **Source:** `icon.svg`. `npm run icons` renders `jarvis-icon-192.png` and `jarvis-icon-512.png` from it in
  Chromium (Playwright), with the self-hosted Rajdhani embedded. Bump `CACHE_NAME` in `sw.js`
  after changing them.
- **Notification badge:** `badge.svg` → `jarvis-badge-96.png`, the small icon in Android's
  status bar. Android uses only its shape, so it's the segmented ring and "J" in white on
  transparent (the full app icon there shows as a blank square).

**Touch.** Rows and controls use ~44px touch targets. Text inputs are 16px on touch
devices so iOS doesn't zoom.

## Known limitations and ideas
- **Notifications come only from Jarvis's morning run.** The app can't wake itself up, so
  phone notifications are sent by the GitHub Action (headline, bills, deliveries). There are no
  per-to-do reminders; an idea is "Add to calendar" on dated to-dos (an `.ics` file with an
  alarm). On iPhone, notifications need the app on the Home Screen (iOS 16.4+).
- **Home's short step names** (`STEP_SHORT_NAMES`) are a code lookup. Unmapped labels fall
  back to the full label.
- **Sync push replaces the gist file.** A device on an outdated app version can drop keys
  it doesn't know about until it updates.

## Working style
Make judgment calls and show finished output; expect targeted corrections rather than full rewrites.
