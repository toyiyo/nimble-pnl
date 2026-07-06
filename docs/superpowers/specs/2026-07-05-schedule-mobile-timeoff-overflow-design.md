# Schedule grid mobile squeeze — sr-only time-off spans leak document overflow

**Date:** 2026-07-05
**Status:** Approved (autonomous /dev run; user directive: "fix the view on phones for the scheduling screen")
**Branch:** `fix/schedule-mobile-timeoff-overflow`

## Problem

On phones, the entire `/scheduling` page renders "squeezed to the left" with dead
space on the right, on all mobile sizes. The mobile browser zooms out to fit a
phantom page width (~951px on a 375px viewport) instead of laying out at the
device width.

## Root cause (verified live against production data)

Diagnosis was performed by rendering the production app at 375px inside a
same-origin iframe on app.easyshifthq.com with the affected restaurant's real
data, then bisecting the DOM:

- `documentElement.scrollWidth` = **951px** at a 370px viewport; `body.scrollWidth` = 370.
- The window itself scrolls horizontally into blank space (`window.scrollTo(600,0)` → `scrollX` 581).
- Bisection isolated the leak to schedule-grid rows whose employee has
  **approved multi-day time off** (e.g. "Off Mon–Sun" → 951px, "Off Fri–Sun" → 918px).
- The leaking elements are the `<span className="sr-only">Approved time off</span>`
  markers rendered in each off-day cell
  ([Scheduling.tsx:1740](../../../src/pages/Scheduling.tsx)). Introduced by the
  roster-context-layer feature (#542, commit `8b20c382`).

Mechanism: Tailwind's `sr-only` uses `position: absolute`. An absolutely
positioned element is clipped by an `overflow` ancestor **only if that ancestor
is also its containing block** (i.e. positioned). The schedule table lives in a
`div.overflow-x-auto` scroller, but neither the scroller, the table, nor the
day `<td>` (rendered by `DroppableDayCell`) is positioned. The sr-only spans
therefore resolve their containing block above the scroller, take their static
position inside the ~1066px-wide table (up to ~950px for a Sunday cell), and
escape the scroll container into the document's scrollable overflow. The
sticky employee-name cell (`position: sticky` = positioned) contains its own
sr-only span, which is why only day cells leak.

`body { overflow-x: hidden }` masks this on desktop, but the html-level
scrollable overflow remains, and mobile browsers size the layout/visual
viewport to it → zoomed-out, left-squeezed page.

Why it never reproduced on a fresh local seed: the leak requires **approved
time-off requests overlapping the displayed week** — data-dependent, not
code-path-dependent. The deployed CSS (`index-zB3F8nXa.css`) is byte-identical
to a local `main` build, ruling out a deploy diff.

## Approaches considered

**A. Add `relative` to the day-cell `<td>` in `DroppableDayCell` (chosen).**
The cell becomes the containing block for every absolutely positioned
descendant (both current sr-only spans — desktop and mobile branches render
inside this td — and any future in-cell overlay). One-class change at the
single component that renders all day cells. Verified live on the production
page: setting `position: relative` on the day tds drops
`documentElement.scrollWidth` from 951 → 370.

**B. Add `relative` to the `div.overflow-x-auto` scroller.**
Also contains the spans (and would clip any abspos descendant of the table).
Works, but positions the spans relative to the scroller rather than the cell
they describe, and doesn't give cells a positioning context that future cell
overlays (bands, badges) will want. Kept as a defensive extra, not the primary
fix — adopted alongside A because it protects the whole table (including any
future abspos content outside a day cell) at zero cost.

**C. Replace the sr-only spans with `aria-label`/`aria-description` on the cell.**
Avoids abspos entirely, but changes accessibility semantics reviewed and
approved in #542 (sr-only text order relative to cell content), and aria-label
on non-interactive `<div>`s is unreliable across screen readers. Rejected.

## Design

1. `src/components/scheduling/DroppableDayCell.tsx`: add `relative` to the
   `<td>` class list.
2. `src/pages/Scheduling.tsx`: add `relative` to the schedule grid's
   `div.overflow-x-auto` wrapper (defense in depth for the whole table).
3. No visual change: no abspos descendant currently depends on a containing
   block further up than its own component. `ShiftCard` establishes its own
   `relative` root for its hover actions and selection checkbox; the mobile
   avatar span is `relative` for its badge dots; the dnd-kit drop highlight is
   a `ring` (box-shadow, not abspos). The day `<td>` gains `relative` with no
   `z-index`, so it does not create a stacking context and cannot interfere
   with the sticky name column's `z-10`. Radix Tooltip/Popover content portals
   to `document.body` (no `container=` override in this file), so it is
   unaffected by the new positioning contexts.
4. The fix is width-independent: it addresses containment, not layout sizing,
   so verifying at one mobile width proves the behavior at every width
   (320–767px inclusive).

## Testing

Per design review, tests pin the **structural containment invariant**, not
class-string presence (a class-grep would pass even if `relative` moved to a
sibling or the sr-only span moved outside the td). Precedent:
`tests/unit/shiftTimelineTab.mobileLayout.test.tsx` walks the rendered DOM to
assert ancestor/descendant relationships without booting the full page.

- **Unit (regression pin):** render `DroppableDayCell` inside a minimal
  `DndContext`/`table` harness with a `span.sr-only` child (mirroring the
  production markup), then walk from the sr-only span up to its nearest
  ancestor whose class list contains a positioning class (`relative`,
  `sticky`, etc.) and assert that ancestor is the `<td>` itself — i.e. the
  cell is the containing block that keeps abspos descendants inside the
  scroller. (jsdom has no layout engine; class-token analysis on the
  ancestor chain is the closest structural proxy.)
- **Unit:** parse `Scheduling.tsx` source for the single `className="..."`
  token containing `overflow-x-auto` (the schedule-grid scroller) and assert
  `relative` appears among its whitespace-split class tokens — same element,
  not a loose file-wide regex (page-level rendering is prohibitively
  hook-heavy per memory/lessons.md).
- **Manual/visual:** local seed with a multi-day approved time-off request at
  375px viewport — `documentElement.scrollWidth` must equal 375 and the page
  must not scroll horizontally.

## Decided trade-offs

- We deliberately do NOT change `sr-only` usage or a11y semantics (approach C
  rejected).
- We do not add `overflow-x: hidden` to `html` — that would mask future leaks
  of this class instead of preventing them, and the page-level
  `overflow-x-hidden` wrappers already in App.tsx stay as-is.
- Audit of other `sr-only`-inside-table sites is out of scope for this fix;
  noted for retrospective.
