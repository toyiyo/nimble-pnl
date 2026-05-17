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

## Breakpoint policy

**One breakpoint for all mobile/desktop layout switches: `sm:` (640px).**
Reviewer caught: the SaleCard action-row originally used `md:` while
the rest of the page used `sm:`, which would have left a dead zone
between 641–767px where action buttons were visible on cards but
filter and header rows were still squeezed. All hover→always-on-mobile
patterns and all `flex-col → sm:flex-row` switches use `sm:`.

The single intentional exception is the inner segmented-control wrap
behavior (handled in the filter section) — those don't switch on a
breakpoint at all; they just flow inside `flex-wrap`.

## Changes by file

### `src/pages/POSSales.tsx`

| Region | Change |
|---|---|
| Header actions row | Outer flex gets `flex-wrap`. Vertical divider `hidden sm:block`. Secondary button labels (Sync / Rules / Import) hide on `<sm` via `<span className="hidden sm:inline">` so the icon remains. Each affected button gets an explicit `aria-label` (Sync: "Sync sales"; Rules: "Category rules"; Import: "Import sales"). "AI Categorize Sales" gets two spans: `<span className="hidden sm:inline">AI Categorize Sales</span><span className="sm:hidden">AI Categorize</span>`. **DOM order fix:** put the primary "Add Sale" button **first** in the JSX (with `order-last sm:order-none` so on desktop it still renders rightmost via flex `order`), so when the row wraps on narrow viewports the primary CTA stays on its own visible line. |
| Restaurant pill in heading | Pill uses `flex-wrap` on the inner row so it can drop to a new line on the narrowest screens; padding `px-2 sm:px-2.5`. |
| AI Categorization card header | `flex items-center justify-between` → `flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`. |
| Filters row 1 (search + dates) | Date inputs `w-[150px]` → `flex-1 sm:w-[150px] sm:flex-none`. "Clear" button gets `hidden sm:inline` on its label AND `aria-label="Clear filters"` so the icon-only mobile state remains accessible. |
| Filters row 2 (segments + sort) | Sort cluster: `ml-auto` → `w-full sm:w-auto sm:ml-auto`. **Drop the per-segment `overflow-x-auto` wrapper** (reviewer flagged it would create stacked horizontal scroll surfaces). The outer container already uses `flex flex-wrap items-center gap-4` — segmented-control groups wrap to new lines naturally. The Status segments (4 chips with counts) can wrap their own internal `inline-flex` to a new line via `flex-wrap` on that wrapper only if needed; no overflow scroll. |
| Virtualized list height | `h-[600px]` → `h-[calc(100vh-180px)] [height:calc(100dvh-180px)] min-h-[400px] sm:h-[600px]`. The arbitrary `[height:...]` form lets dvh layer over vh as a progressive enhancement; browsers that don't understand `dvh` ignore the later rule and fall back to `vh`, while `min-h-[400px]` floors the list height. Acceptable degradation on iOS 14 and earlier (the unsupported case shows up as "list slightly too tall under the URL bar," not "list collapses"). |
| Virtualizer keys (pre-existing bug — required fix per reviewer) | Lines 1214 and 1238 use `key={virtualRow.index}` for both the split-view row and the sale-card row. CLAUDE.md explicitly mandates `key={items[virtualRow.index].id}`. Change both to `key={sale.id}`. This is a required correctness fix in the same code we're modifying. |
| Grouped-view tile "Check impact" button | `opacity-0 group-hover:opacity-100` → `opacity-100 sm:opacity-0 sm:group-hover:opacity-100`. Add `type="button"` (button currently has no type attribute; reviewer caught the default-submit risk). |

### `src/components/pos-sales/SaleCard.tsx`

| Region | Change |
|---|---|
| Bottom action row (line 303) | `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100` → `opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100`. Add `flex-wrap gap-x-3 gap-y-1.5`. |
| Categorized badge "Edit" link (line 256) | Same hover→always-on-mobile pattern with `sm:` prefix (per unified breakpoint policy). |
| AI suggestion panel (line 192) | `flex items-center justify-between` → `flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between`. |
| Card padding | `px-4 py-3` → `px-3 py-3 sm:px-4`. |
| Recipe name truncation | `max-w-[120px]` → `max-w-[120px] sm:max-w-[180px]`. |
| Right-side amount column | Add `min-w-[72px]` to prevent collision with item name on narrow widths. |

### `src/components/pos-sales/SplitSaleView.tsx`

Reviewer caught: shadcn `Badge variant="secondary"` already provides
muted background + foreground colour. Overriding it with `bg-primary/10
text-primary` (or any other coloured override) defeats the variant
system and reintroduces the same anti-pattern. The fix is to **drop the
className override entirely** and let the variant render. Same logic
for the borders — use neutral semantic tokens consistent with the
Apple/Notion palette (`border-border/40`), not `primary` accents that
imply selection or "this is the chosen item."

| Region | Change |
|---|---|
| Card border colour | `border-l-4 border-l-blue-500` → `border-l-4 border-l-foreground/20`. Neutral semantic token; preserves the visual "this is a parent split row" affordance without colour coding. |
| "Split Sale" badge | Drop `className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"` entirely. The `<Badge variant="secondary">` already renders muted background + foreground correctly. |
| Expanded children left border | `border-blue-200 dark:border-blue-800` → `border-border/40`. |
| Card padding | `p-4` → `p-3 sm:p-4`. |

### `src/components/POSSalesDashboard.tsx`

| Region | Change |
|---|---|
| Outer row container | `flex items-center gap-1` → `flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-1`. |
| Sync timestamp | `ml-auto` only applies at `sm:` and up; on mobile it sits on its own line. |
| Metrics scroll-row | No scroll-snap. Reviewer flagged: snap-mandatory on inline metric rows feels jerky on touch and conflicts with the page-level scroll. The existing `overflow-x-auto` is the only horizontal-scroll concession; metrics flow naturally. |

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

**Important:** assert each class as a **separate `.toContain` call**.
Concatenated strings like `.toContain('opacity-100 md:opacity-0')`
are fragile because Tailwind's class ordering is not guaranteed to
match the source. Use `.toContain('opacity-100')` and
`.toContain('sm:opacity-0')` as two distinct assertions.

- `tests/unit/POSSalesMobile.test.tsx` — page-level. Header actions
  container `.toContain('flex-wrap')`. Date input
  `.toContain('flex-1')` and `.toContain('sm:w-[150px]')`. List
  container `.toContain('min-h-[400px]')` and
  `.toContain('sm:h-[600px]')`.
- `tests/unit/SaleCard.mobile.test.tsx` — actions row
  `.toContain('opacity-100')` and `.toContain('sm:opacity-0')` and
  `.toContain('sm:group-hover:opacity-100')`. AI suggestion panel
  `.toContain('flex-col')` and `.toContain('sm:flex-row')`.
- `tests/unit/SplitSaleView.mobile.test.tsx` — assert NO occurrences of
  `bg-blue-`, `border-l-blue-`, `text-blue-`, `border-blue-`,
  `dark:bg-blue-`, `dark:text-blue-`, `dark:border-blue-` in the
  rendered markup (semantic-token regression test). Assert the parent
  card container `.toContain('border-l-foreground/20')`.
- `tests/unit/POSSalesDashboard.mobile.test.tsx` — outer container
  `.toContain('flex-col')` and `.toContain('sm:flex-row')`.
- `tests/unit/BulkActionBar.mobile.test.tsx` — container
  `.toContain('bottom-20')` and `.toContain('sm:bottom-6')`.

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
- **Visual regressions on desktop:** Every responsive change is `sm:`
  prefixed; desktop output is unchanged. Verify locally at ≥1024px
  before pushing.
