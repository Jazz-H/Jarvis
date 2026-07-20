# Jazz 2.0 — Personal Dashboard PWA

A single-file mobile web app consolidating the Jazz 2.0 series (previously separate
Word docs) into one tabbed, installable PWA: **Home, Skin/Hair, Style, Wants.**

## Files
- `index.html` — redirects to `jazz2.0.html`, so the bare repo root URL works instead
  of falling through to GitHub Pages' auto-rendered README
- `jazz2.0.html` — the entire app (HTML/CSS/JS, no build step, no framework)
- `manifest.json` — PWA manifest (name, icons, standalone display)
- `sw.js` — service worker, caches all 6 files for offline use
- `icon-192.png` / `icon-512.png` — generated app icons (true-black terminal-window
  card, gradient "J", raised white-gradient "2.0", blinking cursor block, cyan/magenta/
  lime gradient ring border)

## Status / how to deploy
Live at **https://jazz-h.github.io/Jazz2.0/** (GitHub Pages, deployed from `main` /
root). The manifest + service worker only register on a real http(s) origin, so this
didn't work from a local file or sandboxed preview — now that it's hosted, "Add to
Home Screen" on mobile should work from the URL above.

Home screen icon shortcuts (long-press the installed app icon): **Add a to-do**
(jumps to Home and focuses the quick-add field), **Today's routine** (Skin/Hair, which
then auto-scrolls to today), **Wardrobe** (Style), **Wants**. A true live-data Android
home screen widget isn't possible from a web app — that needs a native app wrapper,
out of scope for this project — so these shortcuts are the PWA equivalent. Implemented
via manifest.json's `shortcuts` array (each pointing at `jazz2.0.html?tab=...`) plus an
`applyLaunchParams()` function in the app that reads `?tab=`/`?action=` on load,
switches tabs accordingly, and strips the query string afterward via
`history.replaceState`.

## Design system
"Neon Nights" theme: true-black ground, bg `#08080b`, surface `#131316`, surface-2
`#1a1a1f`, line `#2c2c34`. Text: `#f4f4f8` primary, `#8d8d9c` dim. Accents: electric
cyan `#00e5ff` (AM / skincare), neon magenta `#ff2e9a` (PM), acid-lime `#c6ff3d`
(primary interactive accent — checkboxes, active tab, progress bar, edit-mode toggle),
danger `#ff3b5c`. Picked from five options mocked up side-by-side against the real
components before committing — see chat history if revisiting the palette. App icons:
a plain terminal-window card (rounded square, no border, three status dots) with a
"J2.0" wordmark in a monospace font — the "J" in a cyan→magenta gradient fill, "2.0"
smaller and raised like an exponent with its own white→soft-gray gradient for a bit of
depth, plus a solid cyan cursor block after it. The card sits at 17% margin from the
canvas edge (not the ~9% of earlier drafts) — Android's maskable-icon safe zone is
roughly the center 66%-diameter circle, and the tighter margin was getting its corners
cropped and looking "zoomed in" next to other home-screen icons once actually installed
on a phone. Went through several rounds (flat "J2" → glowing lime "J2.0" → gradient-
ring-bordered terminal card → this, border removed) — see chat history if revisiting.
- Bottom tab bar (app-style), swipe left/right between tabs supported
- Pull-to-refresh (swipe down from the top of a tab) triggers a hard refresh — clears
  the service worker's cache and unregisters it before reloading, so it can't serve
  stale cached assets (native browser pull-to-refresh is disabled via
  `overscroll-behavior-y:none` so this custom one doesn't fight with it)
- Service worker uses network-first for the HTML shell (`jazz2.0.html`/`index.html`)
  and cache-first for static assets (icons, manifest) — first ship of the service
  worker was cache-first for everything, which meant a stale cached copy of the app
  could keep serving itself indefinitely (including hiding fixes shipped after it,
  like pull-to-refresh itself not working until this was fixed); registration also
  passes `updateViaCache: "none"` so the browser always re-checks `sw.js` itself for
  changes instead of caching it for up to 24h
- Standardized chevron pattern for ALL collapsible sections (rules cards, day
  accordions, capsule need/owned cards) — same SVG path, same 180° rotate-on-open
  behavior
- Every collapsible section shows an "insight" (count/progress) in its header,
  except the Skin/Hair day accordions — the AM/PM step-count insight was removed
  per user preference

## Editing
Every list in the app — Skin/Hair rules and AM/PM steps, Style fit rules/sizing/capsule
items, Wants items — is fully editable in-app: add, edit, and delete, no code changes
needed. Tap the pencil icon top-right of the header to enter edit mode. While it's on:
- Rows with no existing tap action (rules, skin/hair steps, sizing) become tappable —
  tap anywhere on the row to edit or delete it.
- Rows that already have a primary tap action (capsule owned/needed toggle, wants
  mark-bought) get a small separate pencil button so editing doesn't collide with
  that action.
- "+ Add …" buttons appear at the bottom of every list (Skin/Hair's 7 weekdays are NOT
  addable/removable, since "today" and wash-day detection depend on the fixed Mon–Sun
  set matching real calendar weekdays).
- New AM steps are inserted before the last step if that step's label contains "last
  step" (so SPF/lash-serum ordering rules stay intact automatically).
- Edits use a bottom-sheet modal with Save/Delete; deleting always confirms first.
Edit mode itself persists across reloads (`edit-mode` in localStorage).

## Data / storage
Two layers, both plain `localStorage`, both survive a hard refresh (pull-to-refresh
only clears the service worker's cache, never localStorage):
- **Content** (the editable lists themselves): `skin-rules-content`, `skin-days-content`,
  `style-rules-content`, `sizes-content`, `capsule-content`, `wants-content`,
  `todo-content`. Each seeds from the built-in defaults on first run (`todo-content`
  seeds empty — no default to-dos), then persists whatever the user edits it to.
- **State** (checkbox/toggle state, keyed by item id): `style-state`, `wants-state`.
  (Originally used `window.storage`, an artifact-only API from Claude's in-browser
  preview environment; migrated to `localStorage` now that the app runs on its own
  hosted origin — this also resolved the intermittent "Storage set failed" errors,
  since saves no longer go through Anthropic's artifact storage bridge at all.)

Removing the Fitness tab left `fitness-days-content` and `fitness-state` as orphaned
keys in any browser that had already loaded the app — harmless (nothing reads them
anymore), not actively cleaned up.

## Tab-by-tab content
**Home:** The default landing tab.

*To-Do* — plain-text quick-add (type + Enter, no modal, mirrors the Wants quick-add
pattern and the gist of the Android Reminders "type a new line" flow), tap the circle
to check off. Items are grouped under day headers — "This week" (the default bucket
for anything quick-added, no day assigned) plus Monday–Sunday, only showing groups
that have items. Tap the pencil on any item to rename it and/or assign it to a day
(or back to "This week") via a small modal, which doubles as the delete flow. Within
each day-group, unchecked items stay on top and checked ones sink to the bottom with a
strikethrough. A header badge shows "N open" (or "All done") counting across all
groups, and a "Clear completed" button appears once anything anywhere is checked. No
default/seed items — it's empty until you add your own.

*Glance cards* — three tappable cards summarizing the other tabs and jumping straight
to them on tap: **Today** (today's AM/PM steps from Skin/Hair, listed by a short
display name — a middle ground between the vague step category ("Eye area") and the
full product name with its concentration ("Caffeine Solution 5% + EGCG"): "Cleanser,
Ascorbyl Glucoside, Niacinamide, Moisturizer, Hair mist, Sunscreen" — each list under a
small colored AM/PM tag — cyan for AM, magenta for PM, matching the accent colors used
for the actual AM/PM bands on the Skin/Hair tab — plus a wash-day badge on wash
Thursdays, or otherwise a highlighted "Next wash day: [date] — in N days" callout (a
magenta-tinted pill with a droplet icon, matching the PM accent color, so it stands out
from the rest of the card instead of reading as another dim detail line)),
**Wardrobe** (owned/total + progress bar, mirrors the Style tab, plus a "Still need: …"
teaser naming the *cheapest* still-needed item by price when any needed items have a
price set, otherwise just the first one — with its own inline "Mark owned" button and,
when that item has a link saved, a small link-shortcut button next to it, both usable
straight from Home), and **Wants** (pending count + total, the cheapest pending item as
a "Next:" teaser with its own inline "Mark bought" button and, when that item has a
link saved, a link-shortcut button — buyable/checkable straight from Home, no need to
open the Wants or Style tab). The glance cards re-render every time you land on Home,
so they never show stale numbers from something you changed on another tab.

**Skin/Hair:** Mon–Sun day-by-day accordion, gold AM band / navy PM band per day,
auto-detects and opens "today," badges it, and auto-scrolls the tab straight to
today's card on open — no hunting for it further down the week. Key rules card
(Vitamin C/Glycolic Acid
same-day-different-session rule, SPF always last AM step, lash serum always last PM
step). Hair mist (Daily Hair Spray, standardized from the old
Hair oil seal-and-oil / Lion Locs / rice water rotation) runs twice daily — once in
AM (before SPF, which stays the final AM step) and once in PM — every day of the week.
Wash day (Clarifying shampoo + Hair mask) runs biweekly on Thursday (moved from
Saturday), not every week — last wash was Thu Jul 16, 2026, next Thu Jul 30, badged
"Wash day" on the Thursdays it lands on; off-weeks get the regular AM/PM routine
instead (wash-day PM swaps in the shampoo + mask in place of the mist, since that
already covers hair care for the day). The anchor date and weekday are both plain
constants in the code (`WASH_DAY_ANCHOR`, and the day-of-week math around it) — still
requires a code change if either shifts again, same as before.

**Style:** Tab bar button still says "Style"; the in-tab header now reads "Wardrobe"
(renamed from "Style Capsule" — the tab bar already says Style, so the header just
names what's actually in the tab instead of repeating it). Fit rules card (front-tuck,
regular inseam, size-to-hips, no oversized/drop-shoulder, ankle dress pants = business
casual only w/ no-show socks + loafers never sneakers). Sizing reference grid (Tops
M, Outerwear M, Bottoms M, Denim M, Shoes 8, Ring 8 w/
footnote: Sample Band confirmed at 7). Wardrobe: "Still need" and "In closet" as separate
collapsible cards, both grouped by category (Tops/Bottoms/Shoes/Outerwear/Accessories),
tappable to move between them, persisted. Progress bar ("Wardrobe built") showing % of
items owned. Items support an optional price and link, same shape as Wants (edit-mode
modal, both shown on the item row when set — link as a "View product →" the same style
Wants uses; tapping it stops the tap from also toggling the item owned/needed). The
price mainly exists so Home's "Still need" teaser can surface the cheapest still-needed
item instead of whichever one happens to be first in the list. Only the brown/cognac
belt has a price by default (~$20 est.); everything else is unpriced/unlinked until you
add one. Totals now mirror Wants: each collapsible's header shows item count · $ total
(unpriced items count as $0), a total row sits at the bottom of each list ("Still need
total" / "Owned value"), and a "Wardrobe total" card sits below both, summing everything
with a price across the whole wardrobe.

**Wants:** A quick-add bar sits at the top of the tab, always available regardless of
edit mode — type a name and hit Enter (or tap the + button) to drop a new pending item
straight onto the list with no modal, no price/link required upfront; focus stays in
the field so you can add several in a row. (Edit mode's "+ Add want" still exists for
filling in price/link/notes upfront in one form.) Trailco pouch ($19.45), Sample Cooker
Duo 3qt ($49.45), Sample Rain Jacket
jacket gray size S ($130, Sample Store), Sample boot black size 8 ($119.45,
Sample Store), Sample Fitness Band ($399.45), brown leather belt square buckle
(~$20 est., unconfirmed, pending decision on whether to merge with the style capsule's
separate brown/cognac belt line item). Pending and Purchased are collapsible cards
(matching the pattern used elsewhere — Key Rules, Still Need/In Closet), each showing
item count and running total in the header even when collapsed; Pending starts open,
Purchased starts closed. A grand list total sits below both. Links now point to direct
product pages (Amazon,
Sample Store, Sample Store, Sample Cooker's own site) picked to match the noted spec
(color/size) as closely as possible from search results — retailer sites block
automated fetch/scrape verification (403s across the board, the same issue the
original build hit trying to capture a Sample Store cart-share link), so double-check size,
color, and current price at checkout before buying. The brown belt still has no link;
its price is a rough estimate pending the merge decision below.

## Known open items / suggested next steps
1. Search/filter for the capsule list (explicitly deferred, not built)
2. The brown belt merge question (Wants list vs. style capsule "still need") is now
   trivially self-serve — delete whichever entry is redundant in edit mode
3. Wash day's biweekly cadence/anchor date isn't exposed in edit mode (it's a computed
   rule, not a list item) — still requires a code change if the schedule shifts
4. To-dos have no due dates/times/notifications (unlike the Android Reminders app they
   were modeled after) — deliberately kept to plain text + checkbox; revisit if that
   turns out to be missed
5. Home's Today card short names (`STEP_SHORT_NAMES` — "Cleanser", "Ascorbyl
   Glucoside," etc.) are a code-side lookup keyed by step label, not editable in-app;
   a step label with no match in the table just falls back to showing the label
   itself, which still requires a code change to add new mappings

## Working style
Make judgment calls and show finished output; expect targeted corrections rather than full rewrites.
