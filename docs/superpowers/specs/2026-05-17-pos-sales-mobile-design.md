# POS Sales Screen — Mobile Audit & Fixes

**Date:** 2026-05-17
**Branch:** `fix/pos-sales-mobile`
**Scope:** UI only — no logic, hooks, state, or behavior changes.
**Surfaces:** `/pos-sales` page + reachable dialogs (POS Sale, Split, Bulk Categorize, Category Rules).

## Problem

The POS sales screen (`src/pages/POSSales.tsx`) renders poorly on mobile
viewports (< 768px). Several issues are functional, not cosmetic — most
critically, every per-card action button is hidden behind `opacity-0
group-hover:opacity-100`, which makes them **unreachable on touch
devices**.

## Audit findings (mobile, < 768px)

### Critical (blocks task completion on touch)
1. **`SaleCard.tsx`** — Action buttons (Categorize / Split / Check
   impact / Create rule / Edit / Delete) are hover-only. Same for the
   categorized-badge "Edit" link.
2. **Grouped-view tiles** in `POSSales.tsx` — "Check impact" hover-only.

### Major (overflow / poor layout)
3. **Header action bar** (POSSales.tsx ~794-845) — 5 buttons in a
   non-wrapping `flex` row overflow on narrow viewports.
4. **AI Categorization card header** (~869-890) — title + long-labelled
   button on one non-responsive row collide.
5. **Filter row 1 — search + dates** (~952-1010) — date inputs locked at
   `w-[150px]` × 2 + en-dash don't fit small viewports.
6. **Filter row 2 — segmented controls + sort** (~1012-1126) — segments
   crowd each other; "sort" cluster lands awkwardly when wrapping.
7. **`POSSalesDashboard.tsx`** — "Synced …" timestamp uses `ml-auto`
   inside a row whose siblings have `overflow-x-auto`; it ends up
   overlapping the metrics on mobile.
8. **`BulkActionBar.tsx`** — `fixed bottom-6` overlaps the staff
   `MobileTabBar` (bottom nav) on mobile.
9. **`POSSales.tsx` virtualized list** — `h-[600px]` creates a nested
   scroll surface inside the page; on phones the list is too tall and
   crowds the page-level scroll.

### CLAUDE.md violations (direct color tokens)
10. **`SplitSaleView.tsx`** — `border-l-blue-500`, `bg-blue-100
    text-blue-800 dark:bg-blue-900 dark:text-blue-200`, `border-blue-200
    dark:border-blue-800`. CLAUDE.md says use semantic tokens.

## Approach

**Tailwind responsive classes only.** Every fix is mobile-first
responsive CSS plus semantic-token swaps in JSX. No `useIsMobile()`
import, no hooks, no state, no behavior changes.

Why not the BankTransactionList pattern (separate mobile card
component)? The `SaleCard` is already card-shaped; the issues are
purely class-level. A structural rewrite would expand blast radius
beyond what the task asks for.

## Changes by file

### `src/pages/POSSales.tsx`

| Region | Change |
|---|---|
| Header actions row | Outer flex gets `flex-wrap`. Vertical divider `hidden sm:block`. Secondary button labels (Sync / Rules / Import) hide on `<sm` via `<span className="hidden sm:inline">` so the icon remains; `aria-label` already present where needed. "AI Categorize Sales" label gets a shorter "AI Categorize" on `<sm`. |
| Restaurant pill in heading | Pill uses `flex-wrap` on the inner row so it can drop to a new line on the narrowest screens; padding `px-2 sm:px-2.5`. |
| AI Categorization card header | `flex items-center justify-between` → `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`. |
| Filters row 1 (search + dates) | Date inputs `w-[150px]` → `flex-1 sm:w-[150px] sm:flex-none`. "Clear" button gets `hidden sm:inline` on its label so it's icon-only on mobile. |
| Filters row 2 (segments + sort) | Sort cluster: `ml-auto` → `w-full sm:w-auto sm:ml-auto`. Each segmented-control inner div wraps in an `overflow-x-auto -mx-1 px-1` wrapper to prevent overflow. |
| Virtualized list height | `h-[600px]` → `h-[calc(100dvh-180px)] min-h-[400px] sm:h-[600px]`. |
| Grouped-view tile "Check impact" button | `opacity-0 group-hover:opacity-100` → `opacity-100 sm:opacity-0 sm:group-hover:opacity-100`. |

### `src/components/pos-sales/SaleCard.tsx`

| Region | Change |
|---|---|
| Bottom action row (line 303) | `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100` → `opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100`. Add `flex-wrap gap-x-3 gap-y-1.5`. |
| Categorized badge "Edit" link (line 256) | Same hover→always-on-mobile pattern. |
| AI suggestion panel (line 192) | `flex items-center justify-between` → `flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`. |
| Card padding | `px-4 py-3` → `px-3 py-3 sm:px-4`. |
| Recipe name truncation | `max-w-[120px]` → `max-w-[120px] sm:max-w-[180px]`. |
| Right-side amount column | Add `min-w-[72px]` to prevent collision with item name on narrow widths. |

### `src/components/pos-sales/SplitSaleView.tsx`

| Region | Change |
|---|---|
| Card border colour | `border-l-blue-500` → `border-l-primary`. |
| "Split Sale" badge | `bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200` → `bg-primary/10 text-primary`. |
| Expanded children left border | `border-blue-200 dark:border-blue-800` → `border-primary/30`. |
| Card padding | `p-4` → `p-3 sm:p-4`. |

### `src/components/POSSalesDashboard.tsx`

| Region | Change |
|---|---|
| Outer row container | `flex items-center gap-1` → `flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-1`. |
| Sync timestamp | `ml-auto` only applies at `sm:` and up; on mobile it sits on its own line. |
| Metrics scroll-row | Add `snap-x snap-mandatory` and `[&>div]:snap-start` so horizontal scroll feels native. |

### `src/components/bulk-edit/BulkActionBar.tsx`

| Region | Change |
|---|---|
| Bottom offset | `bottom-6` → `bottom-20 sm:bottom-6` (clears `MobileTabBar`). |
| Padding | `px-6 py-4` → `px-4 py-3 sm:px-6 sm:py-4`. |
| Vertical divider between count + actions | `hidden sm:block`. |

### Dialogs (POSSaleDialog, SplitPosSaleDialog, BulkCategorizePosSalesPanel, EnhancedCategoryRulesDialog)

For each, audit live in Phase 4 and apply only the mobile-blocking
changes:
- Verify `DialogContent` uses the sticky-footer pattern
  (`max-h-[85vh] overflow-hidden flex flex-col`) per the existing
  `POSSaleDialog.scroll.test.tsx` contract.
- Two-column form rows (`grid grid-cols-2`) → `grid-cols-1 sm:grid-cols-2`.
- Footer action rows: `flex justify-end gap-2` → add `flex-wrap`.
- No `min-w-[NNN]` larger than 320px on inputs.

If a dialog already passes all four checks, no edits required —
documented in commit message.

## Testing

Pattern mirrors the existing `tests/unit/POSSaleDialog.scroll.test.tsx`:
assert that the rendered component's `className` contains the
responsive token strings.

- `tests/unit/POSSalesMobile.test.tsx` — page-level: header actions
  wrap, date input has `flex-1 sm:w-[150px]`, list container has
  `min-h-[400px] sm:h-[600px]`.
- `tests/unit/SaleCard.mobile.test.tsx` — actions row contains
  `opacity-100 md:opacity-0`; AI suggestion panel contains
  `flex-col sm:flex-row`.
- `tests/unit/SplitSaleView.mobile.test.tsx` — assert NO occurrences of
  `bg-blue-`, `border-l-blue-`, `text-blue-`, `border-blue-`,
  `dark:bg-blue-`, `dark:text-blue-`, `dark:border-blue-` in the
  rendered markup (semantic-token regression test).
- `tests/unit/POSSalesDashboard.mobile.test.tsx` — outer container has
  `flex-col sm:flex-row`.
- `tests/unit/BulkActionBar.mobile.test.tsx` — container has
  `bottom-20 sm:bottom-6`.

No E2E changes. Existing `tests/e2e/bulk-edit-pos-sales.spec.ts` covers
behavior.

## Non-goals

- No logic, hook, or state changes.
- No new components.
- No `useIsMobile()` introduced.
- No restructuring of virtualizer code.
- No dialog redesign — only mobile-blocking fixes per file.
- No changes to the import / file-upload flow (it already works on
  mobile per a recent design pass).

## Risks

- **Tailwind dvh support:** `100dvh` requires a modern browser. The
  fallback `min-h-[400px]` ensures the list is never collapsed.
- **`POSSaleDialog.scroll.test.tsx` regression:** Any class string we
  edit on dialogs must keep `max-h-[85vh]`, `overflow-hidden`,
  `flex-col`. Run the existing test before/after.
- **Visual regressions on desktop:** Most changes are `sm:` and `md:`
  prefixed; desktop output is unchanged. Verify locally at ≥1024px
  before pushing.
