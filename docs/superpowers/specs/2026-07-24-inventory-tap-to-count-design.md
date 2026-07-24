# Design: Manual "Tap-to-Count" Entry Path for Inventory

**Date:** 2026-07-24
**Branch:** `feature/inventory-tap-to-count`
**Author:** Claude (development-workflow)

## Problem

`QuickInventoryDialog` (the in-app numpad "calculadora de conteo") has exactly
**one** trigger today: a barcode scan that both (a) *captures* on the device and
(b) *exactly* matches a stored product `gtin`/`sku` via `findProductByGtin`. When
either gate fails, the calculator never appears.

Both gates fail silently on the reported device (Mobile Safari, 2026-07-20 survey
response *"Aquí no me esta saliendo la calculadora de conteo para los
inventarios"*):

- **Mode A — capture never happens.** `SmartBarcodeScanner.tsx:43` forces
  `isIOS || isSafari` down the `Html5Qrcode` fallback engine (no `BarcodeDetector`,
  no ML Kit). That engine is the least reliable camera path; on this device the
  barcode is never decoded, so `useScanSession.capture()` never runs.
- **Mode B — resolution misses.** Even on a successful decode, `findProductByGtin`
  (`useProducts.tsx:363`) matches only on **exact** `gtin` OR `sku` equality. A
  code that does not byte-for-byte equal a stored value returns `null`, routing the
  session to the full new-product form instead of the quick calculator.

Both are real and separately fixable, but this change deliberately **routes around
them** by adding a scan-independent way to open the calculator. Fixing scan capture
(Mode A) and resolution brittleness (Mode B) are tracked as follow-ups, out of
scope here.

## Goal

Add a **dedicated "Count" button** to each product card on the Inventory products
grid that opens `QuickInventoryDialog` directly for that product, independent of
scanning.

## Non-Goals (YAGNI)

- Fixing Mobile-Safari scan capture (Mode A).
- Fixing exact-match resolution brittleness (Mode B).
- Adding the count entry point to the low-stock cards (deferred; products grid only
  for v1, per product decision).
- Changing the existing card-tap behavior (tap still opens Edit).

## Design Decisions (confirmed with product owner)

| Decision | Choice |
|---|---|
| Entry point | Dedicated "Count" button on each card (card tap still = Edit) |
| Default mode | `add` (add to existing stock), matching the scan default; dialog still lets the user switch to reconcile |
| Scope | Products grid only |
| Placement | **A new full-width `CardFooter`** below the stock/pricing block — NOT the top-right 7×7 ghost-icon cluster (which is hard-capped `max-w-[120px]` below `sm` and would break on the reported iPhone/Safari device) |
| Button style | The CLAUDE.md **primary** treatment (`bg-foreground text-background hover:bg-foreground/90`), not a subtle tint — the feature exists to make the control *findable* |

## What Already Exists (reused, not rebuilt)

`src/pages/Inventory.tsx` already holds the entire quick-inventory flow:

- State: `quickInventoryProduct`, `showQuickInventoryDialog`, `scanMode` (`'add' | 'reconcile'`).
- A single rendered `QuickInventoryDialog` instance (line ~1970) — **no double-wrap**;
  the dialog renders its own Radix `Dialog`.
- `handleQuickInventorySave(quantity)` — writes via `updateProductStockWithAudit`,
  branches on `scanMode` (add → `current + qty`; reconcile → set total), refetches,
  toasts.
- `handleCloseQuickInventoryDialog(open)` — closes and clears `quickInventoryProduct`.

Today only `handleBarcodeScanned` (line ~493) sets `quickInventoryProduct` and opens
the dialog. **We are adding a trigger, not a flow.**

## Changes

### 1. `src/components/inventory/VirtualizedProductGrid.tsx`

- Add prop `onCountProduct: (product: Product) => void` to
  `VirtualizedProductGridProps`; thread through to the `ProductCard`
  (`onCount: () => void`).
- Render a **"Count" button** (lucide `Calculator` icon + visible "Count" label) in a
  **new `CardFooter`** (already exported from `src/components/ui/card.tsx`, currently
  unused by `ProductCard`) below the stock/pricing `CardContent` block. The button:
  - is **full-width** and uses the CLAUDE.md primary treatment:
    `w-full h-9 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium transition-colors`.
    It is the one obviously-findable control on the card — directly answering "I can't
    find the calculator." Semantic tokens only.
  - carries `aria-label={`Count ${product.name}`}` and `title="Count"` (parity with the
    other cluster buttons); the `Calculator` icon is `aria-hidden`.
  - **Placement removes the propagation hazard:** `CardFooter` is a **sibling** of
    `CardContent` (which owns `onClick={onEdit}`), so a footer click never bubbles to
    Edit — no `stopPropagation()` needed. We still keep a negative test asserting
    `onEditProduct` is not called, as a guard against future re-placement. (If, during
    implementation, the button ends up inside `CardContent` for any reason, it MUST
    call `e.stopPropagation()` — see the recipe `Link` at `VirtualizedProductGrid.tsx:268`.)
- Keyboard-accessible by default (it is a shadcn `Button`).
- **`ESTIMATED_ROW_HEIGHT`** (`VirtualizedProductGrid.tsx:51`, currently `320`): bump to
  account for the added footer so first-paint layout is closer before `measureElement`
  corrects it (reduces a one-time CLS blip). `measureElement` still handles the exact
  height dynamically.

### 2. `src/pages/Inventory.tsx`

- Add entry-source state: `const [quickEntrySource, setQuickEntrySource] = useState<'scan' | 'manual'>('scan')`.
- Existing scan path (`handleBarcodeScanned`): set `quickEntrySource` to `'scan'`
  when opening the dialog (preserves current behavior/wording).
- Wire the grid (line ~1708):
  ```tsx
  onCountProduct={(product) => {
    setScanMode('add');
    setQuickEntrySource('manual');
    setQuickInventoryProduct(product);
    setShowQuickInventoryDialog(true);
  }}
  ```
- `handleQuickInventorySave` currently hardcodes `"via quick scan"` wording and a
  `quick_scan_${Date.now()}` audit reference. Replace those two literals with values
  derived from a pure helper (below) keyed on `quickEntrySource`, so a manual count
  is not mislabeled in the inventory audit log.

### 3. `src/utils/quickInventoryAudit.ts` (new, pure)

```ts
export type QuickEntrySource = 'scan' | 'manual';
export type QuickEntryMode = 'add' | 'reconcile';

export function buildQuickInventoryAudit(
  source: QuickEntrySource,
  mode: QuickEntryMode,
  quantity: number,
): { reason: string; reference: string };
```

- `reference`: `` `${source === 'manual' ? 'manual_count' : 'quick_scan'}_${Date.now()}` ``
  — **Note:** `Date.now()` is called by the caller and passed in, OR the helper takes
  a `timestamp` argument so it stays pure and unit-testable. Final signature:
  `buildQuickInventoryAudit(source, mode, quantity, timestamp)`.
- `reason`: reproduces today's **exact** scan-path strings byte-for-byte (the current
  code interpolates the **raw, unformatted** `quantity` — no `.toFixed()` — see
  `Inventory.tsx:963,967`):
  - `scan` + `add` → `` `Adjustment - Added ${quantity} via quick scan` ``
  - `scan` + `reconcile` → `` `Inventory reconciliation - Set to ${quantity} via quick scan` ``
  - `manual` + `add` → `` `Adjustment - Added ${quantity} via manual count` ``
  - `manual` + `reconcile` → `` `Inventory reconciliation - Set to ${quantity} via manual count` ``
  The unit test pins the unformatted `quantity` explicitly so this refactor cannot
  silently change scan-path audit wording. (The success **toast** keeps its separate
  `.toFixed(2)` formatting in the page — unchanged, not part of the helper.)
- Extracting this isolates the only branching logic in the save handler into a
  testable pure function (the save handler itself lives in a large page component that
  is impractical to unit-test in isolation).

## Data Flow

```
ProductCard CardFooter "Count" button click  (sibling of CardContent → no edit bubble)
  → onCount()
  → VirtualizedProductGrid onCountProduct(product)
  → Inventory: setScanMode('add'), setQuickEntrySource('manual'),
               setQuickInventoryProduct(product), setShowQuickInventoryDialog(true)
  → existing <QuickInventoryDialog> opens (mode="add")
  → user enters count → onSave → handleQuickInventorySave(quantity)
  → buildQuickInventoryAudit('manual', scanMode, quantity, Date.now())
  → updateProductStockWithAudit(...) → refetch → toast
```

## Testing

| Test | Location | What |
|---|---|---|
| `buildQuickInventoryAudit` | `tests/unit/quickInventoryAudit.test.ts` | reason + reference wording for each `source × mode`; reference prefix `manual_count_` vs `quick_scan_`; quantity formatting |
| Grid Count button | `tests/unit/VirtualizedProductGrid.test.tsx` (or existing grid test) | renders one Count button per card with `aria-label="Count {name}"`; click calls `onCountProduct(product)`; click does **not** call `onEditProduct` (stopPropagation) |

SQL/pgTAP: none (no schema or RPC change — writes go through the existing
`updateProductStockWithAudit` path).

## Accessibility

- `Count` button: `aria-label` present, icon `aria-hidden`, keyboard-focusable
  (shadcn Button), visible label text.
- No change to existing three-state rendering (loading / error / empty) on the grid.

## Styling (CLAUDE.md Apple/Notion)

- Count button uses the CLAUDE.md **primary action** style verbatim:
  `h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium`
  (plus `w-full` for the footer). Semantic tokens only — no `bg-white`/`text-black`.
- `transition-colors` on hover; `CardFooter` inherits the card's existing padding idiom.

## Decided Trade-offs

- **Row memoization left as pre-existing debt (accepted).** `ProductCard` is not
  wrapped in `React.memo` today and its per-row callbacks are fresh closures created
  inside `VirtualizedProductGrid`'s `.map()` — a standing gap against CLAUDE.md's
  "Memoized Components" rule for virtualized rows. This PR adds `onCount` following the
  same existing pattern. **Rationale for not fixing it here:** because `ProductCard` is
  already un-memoized, it re-renders on every parent render regardless, so adding one
  more callback prop has *zero* incremental perf cost; bringing the component into full
  compliance means memoizing the component *and* stabilizing all six per-row closures
  (a broader refactor of code this feature doesn't otherwise touch), which conflicts with
  the tight scope of a targeted bugfix. Filed as follow-up #3 below. This is the
  reviewer-approved "accept as pre-existing debt, called out explicitly" path.

## Risks & Mitigations

- **Card-tap Edit vs Count-button conflict** → Count lives in `CardFooter`, a sibling of
  the `CardContent` that owns `onClick={onEdit}`, so a footer click never bubbles to Edit;
  covered by a grid test asserting `onEditProduct` is not called.
- **Audit-log provenance drift** → pure helper + unit test lock the wording per source.
- **Regression to the scan path** → scan path explicitly sets `quickEntrySource='scan'`,
  and the helper reproduces today's exact wording for `scan`.

## Follow-ups (out of scope, filed separately)

1. Mobile-Safari scan capture (Mode A) — evaluate `@zxing/browser` or native
   `BarcodeDetector` polyfill for the iOS/Safari fallback path.
2. Exact-match resolution brittleness (Mode B) — normalize GTIN check-digit /
   leading-zero variants, or fuzzy SKU match with confirmation.
3. `ProductCard` virtualization compliance — wrap in `React.memo` and stabilize all
   per-row callbacks (see Decided Trade-offs).
