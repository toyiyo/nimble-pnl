# Recent Tip Splits: mobile button row (design)

## Problem

At a 390x844 viewport, the "Recent Tip Splits" row on Tips → Daily Entry
puts the "View Details" button (`aria-label="View audit trail"`) outside
the viewport. A tap cannot reach it. The "Reopen" button is also cut off.

## Cause (current code)

- The split row is one flex row that does not wrap:
  `flex items-center justify-between` at
  `src/components/tips/RecentTipSplits.tsx:85`.
- The info block is `flex-1 space-y-1` with no `min-w-0`
  (`src/components/tips/RecentTipSplits.tsx:87`). It cannot shrink below
  its content width.
- The amount line is `flex items-center gap-3` with no wrap
  (`src/components/tips/RecentTipSplits.tsx:107`). The amount, the
  employee count, and the split method stay on one line.
- The button group is `flex gap-2` with no wrap
  (`src/components/tips/RecentTipSplits.tsx:121`).

The sum of these widths is more than 390px, so the buttons go past the
right edge.

## Approach

Stack the row on small screens. Keep the row layout at `sm:` (640px) and
wider.

- Row: `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`.
- Info block: add `min-w-0`.
- Badge line and amount line: add `flex-wrap` and a small `gap-y`.
- Button group: `flex flex-wrap gap-2 sm:shrink-0`.

At 640px and wider, the row uses the same flex direction, alignment, and
justification as before. The only desktop difference is a 12px minimum gap
between the info block and the buttons. The info block is `flex-1`, so the
gap does not show at 1280px.

Other approaches:

1. `flex-wrap` on the row only. This works, but the wrap point depends on
   the content width. The row can break at a different place for each split.
2. Hide button labels on mobile (icon only). This makes the targets smaller
   and changes the accessible name for no reason.

## Constraints

- Semantic color tokens only. The change adds no color classes.
- Keep the `aria-label` values `Reopen split for editing` and
  `View audit trail`.
- No data, RPC, or RLS change.

## Test

Add `tests/e2e/tip-splits-mobile.spec.ts`:

1. Sign up and create a restaurant.
2. Seed one approved `tip_splits` row for today through the owner session.
3. Set the viewport to 390x844 and open `/tips`.
4. Check that both buttons are inside the viewport.
5. Check `document.documentElement.scrollWidth <= window.innerWidth`.
6. Click "View audit trail" with a normal pointer click. Check that the
   "Tip Split Details" dialog opens.
