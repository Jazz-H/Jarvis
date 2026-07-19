# Jazz 2.0 — Personal Dashboard PWA

A single-file mobile web app consolidating the Jazz 2.0 series (previously separate
Word docs) into one tabbed, installable PWA: **Home, Skin/Hair, Style, Wants.**

## Files
- `index.html` — redirects to `jazz2.0.html`, so the bare repo root URL works instead
  of falling through to GitHub Pages' auto-rendered README
- `jazz2.0.html` — the entire app (HTML/CSS/JS, no build step, no framework)
- `manifest.json` — PWA manifest (name, icons, standalone display)
- `sw.js` — service worker, caches all 6 files for offline use
- `icon-192.png` / `icon-512.png` — generated app icons (true-black bg, lime "J2" monogram)

## Status / how to deploy
Live at **https://jazz-h.github.io/Jazz2.0/** (GitHub Pages, deployed from `main` /
root). The manifest + service worker only register on a real http(s) origin, so this
didn't work from a local file or sandboxed preview — now that it's hosted, "Add to
Home Screen" on mobile should work from the URL above.

## Design system
"Neon Nights" theme: true-black ground, bg `#08080b`, surface `#131316`, surface-2
`#1a1a1f`, line `#2c2c34`. Text: `#f4f4f8` primary, `#8d8d9c` dim. Accents: electric
cyan `#00e5ff` (AM / skincare), neon magenta `#ff2e9a` (PM), acid-lime `#c6ff3d`
(primary interactive accent — checkboxes, active tab, progress bar, edit-mode toggle),
danger `#ff3b5c`. App icons match (true-black tile, lime "J2" monogram). Picked from
five options mocked up side-by-side against the real components before committing —
see chat history if revisiting the palette.
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
**Home:** The default landing tab. A to-do list up top — plain-text quick-add (type +
Enter, no modal, mirrors the Wants quick-add pattern and the gist of the Android
Reminders "type a new line" flow), tap the circle to check off, unchecked items stay
on top and checked ones sink to the bottom with a strikethrough, a "Clear completed"
button appears once anything's checked. No default/seed items — it's empty until you
add your own. Below that, three tappable glance cards summarizing the other tabs and
jumping straight to them: **Today** (today's AM/PM step names from Skin/Hair, wash-day
badge when relevant), **Capsule** (owned/total + progress bar, mirrors Style), and
**Wants** (pending count + total, plus the cheapest pending item as a "Next:" teaser).
The glance cards re-render every time you land on Home, so they never show stale
numbers from something you changed on another tab.

**Skin/Hair:** Mon–Sun day-by-day accordion, gold AM band / navy PM band per day,
auto-detects and opens "today," badges it. Key rules card (Vitamin C/Glycolic Acid
same-day-different-session rule, SPF always last AM step, lash serum always last PM
step). Hair mist (Daily Hair Spray, standardized from the old
Hair oil seal-and-oil / Lion Locs / rice water rotation) runs twice daily — once in
AM (before SPF, which stays the final AM step) and once in PM — every day of the week.
Wash day (Clarifying shampoo + Hair mask) runs biweekly on Saturday, not every
week — last wash was the week of Jul 16, 2026, badged "Wash day" on the Saturdays it
lands on; off-weeks get the regular AM/PM routine instead (wash-day PM swaps in the
shampoo + mask in place of the mist, since that already covers hair care for the day).

**Style:** Fit rules card (front-tuck, regular inseam, size-to-hips, no oversized/
drop-shoulder, ankle dress pants = business casual only w/ no-show socks + loafers
never sneakers). Sizing reference grid (Tops M, Outerwear M, Bottoms M,
Denim M, Shoes 8, Ring 8). Capsule
wardrobe: "Still need" and "In closet" as separate collapsible cards, both grouped by
category (Tops/Bottoms/Shoes/Outerwear/Accessories), tappable to move between them,
persisted. Progress bar showing % of capsule owned.

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

## Working style
Make judgment calls and show finished output; expect targeted corrections rather than full rewrites.
