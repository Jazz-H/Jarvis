# Jazz 2.0 — Personal Dashboard PWA

A single-file mobile web app consolidating the Jazz 2.0 series (previously separate
Word docs) into one tabbed, installable PWA: **Skin/Hair, Style, Fitness, Wants.**

## Files
- `index.html` — redirects to `jazz2.0.html`, so the bare repo root URL works instead
  of falling through to GitHub Pages' auto-rendered README
- `jazz2.0.html` — the entire app (HTML/CSS/JS, no build step, no framework)
- `manifest.json` — PWA manifest (name, icons, standalone display)
- `sw.js` — service worker, caches all 6 files for offline use
- `icon-192.png` / `icon-512.png` — generated app icons (dark charcoal bg, olive "J2" monogram)

## Status / how to deploy
Live at **https://jazz-h.github.io/Jazz2.0/** (GitHub Pages, deployed from `main` /
root). The manifest + service worker only register on a real http(s) origin, so this
didn't work from a local file or sandboxed preview — now that it's hosted, "Add to
Home Screen" on mobile should work from the URL above.

## Design system
- Dark charcoal theme: bg `#18191b`, surface `#232427`, surface-2 `#2b2c30`, line `#37383c`
- Text: `#ededee` primary, `#95979d` dim
- Accents: gold `#c8a24a` (AM / skincare), navy `#3a4a6b` (PM), olive `#7c8a63` (primary
  interactive accent — checkboxes, active tab, progress bar), danger `#a4573f`
- Bottom tab bar (app-style), swipe left/right between tabs supported
- Pull-to-refresh (swipe down from the top of a tab) triggers a hard refresh — clears
  the service worker's cache and unregisters it before reloading, so it can't serve
  stale cached assets (native browser pull-to-refresh is disabled via
  `overscroll-behavior-y:none` so this custom one doesn't fight with it)
- Standardized chevron pattern for ALL collapsible sections (rules cards, day
  accordions, capsule need/owned cards, fitness day cards) — same SVG path, same
  180° rotate-on-open behavior
- Every collapsible section shows an "insight" (count/progress) in its header,
  except the Skin/Hair day accordions — the AM/PM step-count insight was removed
  per user preference

## Data / storage
Uses plain `localStorage`, one JSON blob per tab: `style-state`, `fitness-state`,
`wants-state`. (Originally used `window.storage`, an artifact-only API from Claude's
in-browser preview environment; migrated to `localStorage` now that the app runs on
its own hosted origin — this also resolved the intermittent "Storage set failed"
errors, since saves no longer go through Anthropic's artifact storage bridge at all.)

## Tab-by-tab content
**Skin/Hair:** Mon–Sun day-by-day accordion, gold AM band / navy PM band per day,
auto-detects and opens "today," badges it. Key rules card (Vitamin C/Glycolic Acid
same-day-different-session rule, SPF always last AM step, lash serum always last PM
step). Hair mist is standardized to Daily Hair Spray every day it
appears (replaced the old Hair oil seal-and-oil and Lion Locs rotation). Wash day
(Clarifying shampoo + Hair mask) runs biweekly on Saturday, not every week — last
wash was the week of Jul 16, 2026, badged "Wash day" on the Saturdays it lands on;
off-weeks get a regular PM routine instead.

**Style:** Fit rules card (front-tuck, regular inseam, size-to-hips, no oversized/
drop-shoulder, ankle dress pants = business casual only w/ no-show socks + loafers
never sneakers). Sizing reference grid (Tops M, Outerwear M, Bottoms M,
Denim M, Shoes 8, Ring 8). Capsule
wardrobe: "Still need" and "In closet" as separate collapsible cards, both grouped by
category (Tops/Bottoms/Shoes/Outerwear/Accessories), tappable to move between them,
persisted. Progress bar showing % of capsule owned.

**Fitness:** 3-day split (Sunday Crunch/machines/pull, weekday busy-gym/free-weights/
push, Friday home/dumbbells). Per-exercise checkboxes that persist until manually
reset — NOT auto-reset weekly (explicit user preference). "Reset week" button clears
all three days at once, now with a confirm() prompt since it's destructive/no-undo.

**Wants:** Trailco pouch ($19.45), Sample Cooker ($49.45), Sample Rain Jacket
jacket gray size S ($130, Sample Store), Sample boot black size 8 ($119.45,
Sample Store), Sample Fitness Band ($399.45), brown leather belt square buckle
(~$20 est., unconfirmed, pending decision on whether to merge with the style capsule's
separate brown/cognac belt line item). Pending/Purchased sections each show a running
total, plus a grand list total. Links now point to direct product pages (Amazon,
Sample Store, Sample Store, Sample Cooker's own site) picked to match the noted spec
(color/size) as closely as possible from search results — retailer sites block
automated fetch/scrape verification (403s across the board, the same issue the
original build hit trying to capture a Sample Store cart-share link), so double-check size,
color, and current price at checkout before buying. The brown belt still has no link;
its price is a rough estimate pending the merge decision below.

## Known open items / suggested next steps
1. Search/filter for the capsule list (explicitly deferred, not built)
2. Consider a 5th "Home/overview" tab (today's skin/hair + today's fitness at a glance)
3. Confirm whether the Crest Whitestrips course (should've finished ~mid-July) needs
   any remaining reference in the Skin/Hair routine, or is fully done
4. Resolve the brown belt merge question (wants list vs. style capsule) — once
   resolved, add its product link too

## Working style
Make judgment calls and show finished output; expect targeted corrections rather than full rewrites.
