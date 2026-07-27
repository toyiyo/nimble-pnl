# Manual "Tap-to-Count" Entry Path for Inventory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated "Count" button to each product card on the Inventory products grid that opens the existing `QuickInventoryDialog` directly, independent of barcode scanning.

**Architecture:** Introduce a pure audit-string helper (`buildQuickInventoryAudit`) so the save handler stops hardcoding scan-only wording; add an `onCountProduct` callback prop to `VirtualizedProductGrid` that renders a full-width "Count" button in a new `CardFooter`; wire that callback in `Inventory.tsx` to the already-existing quick-inventory dialog flow, tagging the entry source so the audit log stays accurate.

**Tech Stack:** React 18.3 + TypeScript, Vite, Vitest + React Testing Library, TailwindCSS, shadcn/ui, lucide-react.

## Global Constraints

- Semantic tokens only — never `bg-white`/`text-black`. Count button uses the CLAUDE.md primary treatment verbatim: `h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium` (plus `w-full` in the footer). `transition-colors` on hover.
- Every interactive control needs an `aria-label` when it has no text (the Count button has visible text AND an `aria-label` for the per-product name; its icon is `aria-hidden`).
- Audit `reason` strings must reproduce today's scan-path wording **byte-for-byte**, interpolating the **raw, unformatted** `quantity` (no `.toFixed()`):
  - `scan` + `add` → `Adjustment - Added ${quantity} via quick scan`
  - `scan` + `reconcile` → `Inventory reconciliation - Set to ${quantity} via quick scan`
  - `manual` + `add` → `Adjustment - Added ${quantity} via manual count`
  - `manual` + `reconcile` → `Inventory reconciliation - Set to ${quantity} via manual count`
- Audit `reference` = `${source === 'manual' ? 'manual_count' : 'quick_scan'}_${timestamp}`.
- Multi-tenancy unchanged: all writes continue through the existing `updateProductStockWithAudit` path (no new DB/RPC/RLS surface).
- No manual caching; no new React Query keys. This change adds a UI trigger, not a data flow.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit.

---

### Task 1: Pure audit-string helper `buildQuickInventoryAudit`

**Files:**
- Create: `src/utils/quickInventoryAudit.ts`
- Test: `tests/unit/quickInventoryAudit.test.ts`

**Interfaces:**
- Consumes: nothing (leaf util).
- Produces:
  ```ts
  export type QuickEntrySource = 'scan' | 'manual';
  export type QuickEntryMode = 'add' | 'reconcile';
  export function buildQuickInventoryAudit(
    source: QuickEntrySource,
    mode: QuickEntryMode,
    quantity: number,
    timestamp: number,
  ): { reason: string; reference: string };
  ```
  Task 3 (`Inventory.tsx`) calls this with `(quickEntrySource, scanMode, quantity, Date.now())`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/quickInventoryAudit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildQuickInventoryAudit } from '@/utils/quickInventoryAudit';

describe('buildQuickInventoryAudit', () => {
  it('preserves the exact scan + add wording (raw quantity, no rounding)', () => {
    const { reason } = buildQuickInventoryAudit('scan', 'add', 3.5, 1000);
    expect(reason).toBe('Adjustment - Added 3.5 via quick scan');
  });

  it('preserves the exact scan + reconcile wording', () => {
    const { reason } = buildQuickInventoryAudit('scan', 'reconcile', 12, 1000);
    expect(reason).toBe('Inventory reconciliation - Set to 12 via quick scan');
  });

  it('labels manual + add as "via manual count"', () => {
    const { reason } = buildQuickInventoryAudit('manual', 'add', 3.5, 1000);
    expect(reason).toBe('Adjustment - Added 3.5 via manual count');
  });

  it('labels manual + reconcile as "via manual count"', () => {
    const { reason } = buildQuickInventoryAudit('manual', 'reconcile', 12, 1000);
    expect(reason).toBe('Inventory reconciliation - Set to 12 via manual count');
  });

  it('prefixes the scan reference with quick_scan_ and includes the timestamp', () => {
    const { reference } = buildQuickInventoryAudit('scan', 'add', 1, 1737700000000);
    expect(reference).toBe('quick_scan_1737700000000');
  });

  it('prefixes the manual reference with manual_count_ and includes the timestamp', () => {
    const { reference } = buildQuickInventoryAudit('manual', 'add', 1, 1737700000000);
    expect(reference).toBe('manual_count_1737700000000');
  });

  it('does not round or reformat the quantity', () => {
    const { reason } = buildQuickInventoryAudit('manual', 'add', 0.333333, 1000);
    expect(reason).toBe('Adjustment - Added 0.333333 via manual count');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/quickInventoryAudit.test.ts`
Expected: FAIL — cannot resolve `@/utils/quickInventoryAudit` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/utils/quickInventoryAudit.ts`:

```ts
export type QuickEntrySource = 'scan' | 'manual';
export type QuickEntryMode = 'add' | 'reconcile';

/**
 * Builds the audit `reason` and `reference` strings for a quick-inventory write.
 *
 * The scan-path strings are reproduced byte-for-byte from the pre-existing
 * inline literals in Inventory.tsx (raw, unformatted `quantity`), so extracting
 * this helper cannot silently change historical scan audit wording. The manual
 * variants say "via manual count" so the audit log distinguishes provenance.
 */
export function buildQuickInventoryAudit(
  source: QuickEntrySource,
  mode: QuickEntryMode,
  quantity: number,
  timestamp: number,
): { reason: string; reference: string } {
  const via = source === 'manual' ? 'via manual count' : 'via quick scan';
  const reason =
    mode === 'add'
      ? `Adjustment - Added ${quantity} ${via}`
      : `Inventory reconciliation - Set to ${quantity} ${via}`;
  const referencePrefix = source === 'manual' ? 'manual_count' : 'quick_scan';
  const reference = `${referencePrefix}_${timestamp}`;
  return { reason, reference };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/unit/quickInventoryAudit.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/quickInventoryAudit.ts tests/unit/quickInventoryAudit.test.ts
git commit -m "feat(inventory): add pure audit-string helper for quick-inventory writes"
```

---

### Task 2: "Count" button on `VirtualizedProductGrid` product cards

**Files:**
- Modify: `src/components/inventory/VirtualizedProductGrid.tsx`
- Test: `tests/unit/VirtualizedProductGrid.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 (pure UI).
- Produces: a new required prop on `VirtualizedProductGridProps`:
  ```ts
  onCountProduct: (product: Product) => void;
  ```
  Task 3 (`Inventory.tsx`) supplies this prop.

**Context before editing:**
- `CardFooter` is already exported from `src/components/ui/card.tsx` but is currently unused by `ProductCard`. Render the button inside a new `CardFooter` — a **sibling** of the `CardContent` that owns `onClick={onEdit}` — so a footer click never bubbles to Edit. No `stopPropagation()` is needed at this placement. (If the button ever moves inside `CardContent`, it MUST call `e.stopPropagation()` — see the recipe `Link` at `VirtualizedProductGrid.tsx:268`.)
- `ESTIMATED_ROW_HEIGHT` is at `VirtualizedProductGrid.tsx:51` (currently `320`). Bump it to `380` to account for the added footer so first paint is closer before `measureElement` corrects the real height.
- `Calculator` comes from `lucide-react`. Add it to the existing lucide import.

- [ ] **Step 1: Write the failing test**

First confirm how the existing grid test (if any) renders the grid, so the new test reuses its harness/mock props:

Run: `ls tests/unit | grep -i VirtualizedProductGrid`

- If a test file exists, ADD the `describe('Count button', ...)` block below to it and reuse its existing render helper / mock product factory (adjust the import and prop names to match). Do NOT duplicate an entire second harness.
- If no test file exists, create `tests/unit/VirtualizedProductGrid.test.tsx` with the full block below.

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { VirtualizedProductGrid } from '@/components/inventory/VirtualizedProductGrid';

// Minimal product matching the fields ProductCard reads. If the existing test
// file already has a factory, use that instead of this literal.
const product = {
  id: 'p1',
  name: 'Tomatoes',
  current_stock: 5,
  uom_purchase: 'kg',
  // add any other non-optional fields the component dereferences:
} as any;

function renderGrid(overrides: Record<string, any> = {}) {
  const props = {
    products: [product],
    onEditProduct: vi.fn(),
    onCountProduct: vi.fn(),
    onWasteProduct: vi.fn(),
    onTransferProduct: vi.fn(),
    onDeleteProduct: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter>
      <VirtualizedProductGrid {...(props as any)} />
    </MemoryRouter>,
  );
  return props;
}

describe('Count button', () => {
  it('renders one Count button per card with a per-product aria-label', () => {
    renderGrid();
    expect(
      screen.getByRole('button', { name: 'Count Tomatoes' }),
    ).toBeInTheDocument();
  });

  it('calls onCountProduct with the product when clicked', async () => {
    const props = renderGrid();
    await userEvent.click(
      screen.getByRole('button', { name: 'Count Tomatoes' }),
    );
    expect(props.onCountProduct).toHaveBeenCalledWith(product);
  });

  it('does not trigger the card-tap Edit handler when Count is clicked', async () => {
    const props = renderGrid();
    await userEvent.click(
      screen.getByRole('button', { name: 'Count Tomatoes' }),
    );
    expect(props.onEditProduct).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/VirtualizedProductGrid.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Count Tomatoes"` (button not rendered yet). If it instead fails on a missing required field in the mock `product`, add that field to the literal and re-run until the failure is the missing button.

- [ ] **Step 3: Add the prop to the grid's props interface**

In `src/components/inventory/VirtualizedProductGrid.tsx`, add to `VirtualizedProductGridProps` (next to `onEditProduct`):

```tsx
  onCountProduct: (product: Product) => void;
```

Destructure `onCountProduct` in the `VirtualizedProductGrid` component signature alongside the other `on*Product` props, and pass it into each rendered `ProductCard` in the `.map()` as:

```tsx
onCount={() => onCountProduct(product)}
```

- [ ] **Step 4: Add `onCount` to `ProductCard` and render the button**

Add `onCount: () => void;` to `ProductCard`'s props type and destructure it. Add `Calculator` to the `lucide-react` import. After the closing `</CardContent>`, add a new footer as a sibling:

```tsx
<CardFooter className="pt-0">
  <Button
    onClick={onCount}
    aria-label={`Count ${product.name}`}
    title="Count"
    className="w-full h-9 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium transition-colors"
  >
    <Calculator className="h-4 w-4 mr-2" aria-hidden="true" />
    Count
  </Button>
</CardFooter>
```

Ensure `CardFooter` is imported from `@/components/ui/card` (add it to the existing card import if not already present) and `Button` from `@/components/ui/button` (already imported).

- [ ] **Step 5: Bump the estimated row height**

At `VirtualizedProductGrid.tsx:51`, change:

```tsx
const ESTIMATED_ROW_HEIGHT = 320;
```
to:
```tsx
const ESTIMATED_ROW_HEIGHT = 380;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test -- tests/unit/VirtualizedProductGrid.test.tsx`
Expected: PASS (3 Count-button tests, plus any pre-existing tests in the file still green).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`onCountProduct` is now required on `VirtualizedProductGridProps`; the only caller is `Inventory.tsx`, wired in Task 3 — if typecheck flags that call site now, that is expected and resolved in Task 3. If you are running tasks strictly in order, run typecheck again at the end of Task 3.)

- [ ] **Step 8: Commit**

```bash
git add src/components/inventory/VirtualizedProductGrid.tsx tests/unit/VirtualizedProductGrid.test.tsx
git commit -m "feat(inventory): add Count button to product cards in VirtualizedProductGrid"
```

---

### Task 3: Wire the Count trigger and audit source in `Inventory.tsx`

**Files:**
- Modify: `src/pages/Inventory.tsx`

**Interfaces:**
- Consumes: `buildQuickInventoryAudit` (Task 1) and the `onCountProduct` prop (Task 2).
- Produces: nothing downstream (page is a leaf consumer).

**Context before editing (verify line numbers with grep — they drift):**
- State block near line ~85: `quickInventoryProduct`, `showQuickInventoryDialog`, `scanMode`.
- `handleBarcodeScanned` near line ~493 opens the dialog for the scan path.
- `handleQuickInventorySave(quantity)` near line ~948 currently builds the reason/reference inline (the `via quick scan` literals at ~963/967 and `quick_scan_${Date.now()}`).
- The `<VirtualizedProductGrid ... />` render near line ~1708.

Run this first to re-anchor:

```bash
grep -n "quickEntrySource\|via quick scan\|quick_scan_\|scanMode\|VirtualizedProductGrid\|handleQuickInventorySave" src/pages/Inventory.tsx
```

- [ ] **Step 1: Add the entry-source state**

Import the helper and its type near the other `@/utils` imports:

```tsx
import { buildQuickInventoryAudit, type QuickEntrySource } from '@/utils/quickInventoryAudit';
```

Next to the `scanMode` state declaration, add:

```tsx
const [quickEntrySource, setQuickEntrySource] = useState<QuickEntrySource>('scan');
```

- [ ] **Step 2: Tag the scan path as `'scan'`**

In `handleBarcodeScanned` (the existing scan trigger), immediately before it sets `setShowQuickInventoryDialog(true)`, add:

```tsx
setQuickEntrySource('scan');
```

(Preserves current behavior — scan writes stay labeled "via quick scan".)

- [ ] **Step 3: Wire `onCountProduct` on the grid**

On the `<VirtualizedProductGrid ... />` element, add the prop:

```tsx
onCountProduct={(product) => {
  setScanMode('add');
  setQuickEntrySource('manual');
  setQuickInventoryProduct(product);
  setShowQuickInventoryDialog(true);
}}
```

- [ ] **Step 4: Replace the inline audit literals in `handleQuickInventorySave`**

In `handleQuickInventorySave`, replace the inline `reason` (the `scanMode === 'add' ? 'Adjustment - Added ... via quick scan' : 'Inventory reconciliation - Set to ... via quick scan'` expression) and the `quick_scan_${Date.now()}` reference with a single call:

```tsx
const { reason, reference } = buildQuickInventoryAudit(
  quickEntrySource,
  scanMode,
  quantity,
  Date.now(),
);
```

Then pass `reason` and `reference` into the existing `updateProductStockWithAudit(...)` call in place of the removed inline strings. Leave the success **toast** untouched — it keeps its own `.toFixed(2)` formatting and is not part of the helper.

- [ ] **Step 5: Typecheck and run the full unit suite**

Run: `npm run typecheck`
Expected: no errors (the `onCountProduct` requirement from Task 2 is now satisfied).

Run: `npm run test -- tests/unit/quickInventoryAudit.test.ts tests/unit/VirtualizedProductGrid.test.tsx`
Expected: PASS.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: no new errors in `Inventory.tsx`, `VirtualizedProductGrid.tsx`, or `quickInventoryAudit.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Inventory.tsx
git commit -m "feat(inventory): open quick-count dialog from card Count button and label manual audits"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task |
|---|---|
| §1 grid: `onCountProduct` prop, Count button in new `CardFooter`, primary style, `aria-label`, `Calculator` icon `aria-hidden`, bump `ESTIMATED_ROW_HEIGHT` | Task 2 |
| §2 Inventory: `quickEntrySource` state, scan path sets `'scan'`, grid `onCountProduct` sets `add`+`manual`, replace inline literals via helper | Task 3 |
| §3 pure `buildQuickInventoryAudit` with `timestamp` param, exact reason strings, reference prefixes | Task 1 |
| Testing table: `quickInventoryAudit.test.ts` (wording per source×mode, reference prefix, quantity formatting) | Task 1 |
| Testing table: grid Count button (renders, click calls `onCountProduct`, does NOT call `onEditProduct`) | Task 2 |
| Accessibility (aria-label, aria-hidden icon, keyboard-focusable shadcn Button) | Task 2 |
| Styling (primary treatment verbatim, semantic tokens, transition-colors) | Task 2 + Global Constraints |
| SQL/pgTAP: none | N/A — no DB surface, stated in Global Constraints |
| Follow-ups (Mode A, Mode B, ProductCard memoization) | Out of scope by design; not implemented here |

No gaps.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows complete code. The only conditional instruction (Step 1 of Task 2: extend existing test file vs. create new) is a real branch with both paths fully specified.

**3. Type consistency:** `buildQuickInventoryAudit(source, mode, quantity, timestamp)` is defined in Task 1 and called with exactly that arity/order in Task 3. `QuickEntrySource` is exported by Task 1 and imported in Task 3. `onCountProduct: (product: Product) => void` is declared in Task 2 and supplied with a matching `(product) => {...}` in Task 3. `onCount: () => void` on `ProductCard` is fed by `onCount={() => onCountProduct(product)}`. Consistent throughout.
