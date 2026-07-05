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
3. No visual change: neither element has absolutely positioned children that
   were relying on a higher containing block for on-screen placement — the
   sr-only spans are invisible (1×1, clipped) and everything else in the cells
   is static/flow content. The Radix Tooltip/Popover content portals to
   `document.body`, so it is unaffected by the new positioning contexts.

## Testing

- **Unit (regression pin):** render `DroppableDayCell` inside a minimal
  `DndContext`/`table` harness and assert the `<td>` carries the `relative`
  class, with a comment explaining the containment invariant it pins (jsdom
  has no layout engine, so asserting the class is the pragmatic proxy for
  "absolutely positioned sr-only descendants cannot escape the scroller").
- **Unit:** source-text assertion that the schedule grid scroller in
  `Scheduling.tsx` pairs `overflow-x-auto` with `relative` (same style as the
  PR #504 breakpoint-policy tests; page-level rendering is prohibitively
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
