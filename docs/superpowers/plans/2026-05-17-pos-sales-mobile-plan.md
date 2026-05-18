# POS Sales Mobile Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/pos-sales` page and its reachable dialogs usable on mobile (< 640px) without changing any logic, hooks, state, or behavior — only Tailwind responsive classes and semantic-token swaps.

**Architecture:** Mobile-first responsive CSS using a single breakpoint (`sm:` = 640px). Hover-only action buttons become always-visible on mobile via `opacity-100 sm:opacity-0 sm:group-hover:opacity-100`. Direct color tokens in `SplitSaleView` (`bg-blue-*`, `border-l-blue-*`) get swapped for semantic tokens. A pre-existing virtualizer key bug (`key={virtualRow.index}`) is folded into this PR because we're modifying the same lines.

**Tech Stack:** React 18.3, TypeScript, TailwindCSS, shadcn/ui, Vitest, `@tanstack/react-virtual`.

**Spec:** `docs/superpowers/specs/2026-05-17-pos-sales-mobile-design.md`

---

## File Structure

**Files to modify:**
- `src/components/pos-sales/SaleCard.tsx` — hover-only action row, AI suggestion panel layout, padding, recipe name truncation, amount-column min-width, categorized-badge Edit link.
- `src/components/pos-sales/SplitSaleView.tsx` — drop direct `blue-*` color tokens, switch to semantic tokens + shadcn Badge variant.
- `src/components/POSSalesDashboard.tsx` — outer row flex direction, sync timestamp position.
- `src/components/bulk-edit/BulkActionBar.tsx` — bottom offset clears `MobileTabBar` on mobile, tighter padding.
- `src/pages/POSSales.tsx` — header actions row (aria-labels, label spans, `order-last` for primary CTA), AI Categorization card header, restaurant pill, filter row 1 (date inputs + Clear button aria-label), filter row 2 (sort cluster), virtualized list height + virtualizer key bug fix, grouped-view "Check impact" + `type="button"`.

**Files to create:**
- `tests/unit/SaleCard.mobile.test.tsx` — render SaleCard with mock sale, assert className tokens.
- `tests/unit/SplitSaleView.mobile.test.tsx` — render SplitSaleView, assert no `blue-*` tokens + semantic tokens present.
- `tests/unit/POSSalesDashboard.mobile.test.tsx` — render dashboard, assert flex-col/sm:flex-row.
- `tests/unit/BulkActionBar.mobile.test.tsx` — render bar, assert `bottom-20 sm:bottom-6`.
- `tests/unit/POSSalesMobile.source.test.ts` — **source-text** test on `src/pages/POSSales.tsx` because mocking 20+ page hooks is brittle; the source-text assertion is faster and still catches removal of the responsive tokens.

**Dialogs audited in Task 11 (POSSaleDialog, SplitPosSaleDialog, BulkCategorizePosSalesPanel, EnhancedCategoryRulesDialog):** only edited if they violate the four-point checklist in the spec; commit message records the audit outcome per dialog.

---

## Task 1: SaleCard — actions row, AI panel, padding, truncation, amount column, Edit link

**Files:**
- Create: `tests/unit/SaleCard.mobile.test.tsx`
- Modify: `src/components/pos-sales/SaleCard.tsx:92` (card padding), `:156` (recipe name truncation), `:179` (amount column min-width), `:193` (AI suggestion panel), `:256` (categorized-badge Edit link), `:303` (action row)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/SaleCard.mobile.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SaleCard, SaleCardProps } from '@/components/pos-sales/SaleCard';
import { UnifiedSaleItem } from '@/types/pos';

const noop = () => {};

const baseSale: UnifiedSaleItem = {
  id: 'sale-1',
  itemName: 'Test Burger',
  quantity: 1,
  totalPrice: 12.5,
  saleDate: '2026-05-17',
  saleTime: '12:34',
  posSystem: 'manual',
  externalOrderId: 'ord-1',
  is_categorized: false,
  is_split: false,
} as UnifiedSaleItem;

const baseProps: SaleCardProps = {
  sale: baseSale,
  recipe: null,
  isSelected: false,
  isSelectionMode: false,
  isEditingCategory: false,
  accounts: [],
  canEditManualSales: true,
  onCardClick: noop,
  onCheckboxChange: noop,
  onEdit: noop,
  onDelete: noop,
  onSimulateDeduction: noop,
  onMapPOSItem: noop,
  onSetEditingCategory: noop,
  onSplit: noop,
  onSuggestRule: noop,
  onCategorize: noop,
  onNavigateToRecipe: noop,
};

describe('SaleCard — mobile responsive classes', () => {
  it('action row is always visible on mobile, hover-only at sm+', () => {
    const { container } = render(<SaleCard {...baseProps} />);
    const html = container.innerHTML;
    expect(html).toContain('opacity-100');
    expect(html).toContain('sm:opacity-0');
    expect(html).toContain('sm:group-hover:opacity-100');
  });

  it('card padding uses px-3 on mobile and sm:px-4 at sm+', () => {
    const { container } = render(<SaleCard {...baseProps} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('px-3');
    expect(root.className).toContain('sm:px-4');
  });

  it('recipe name truncation widens at sm+', () => {
    const { container } = render(
      <SaleCard
        {...baseProps}
        recipe={{ id: 'r-1', name: 'Cheeseburger Recipe', hasIngredients: true }}
      />,
    );
    const html = container.innerHTML;
    expect(html).toContain('max-w-[120px]');
    expect(html).toContain('sm:max-w-[180px]');
  });

  it('right-side amount column has min-w-[72px]', () => {
    const { container } = render(<SaleCard {...baseProps} />);
    expect(container.innerHTML).toContain('min-w-[72px]');
  });

  it('AI suggestion panel switches from flex-col to sm:flex-row', () => {
    const saleWithSuggestion: UnifiedSaleItem = {
      ...baseSale,
      suggested_category_id: 'cat-1',
      chart_account: { id: 'acc-1', account_name: 'Food', account_code: '4000' } as any,
    } as UnifiedSaleItem;
    const { container } = render(<SaleCard {...baseProps} sale={saleWithSuggestion} />);
    const html = container.innerHTML;
    expect(html).toContain('flex-col');
    expect(html).toContain('sm:flex-row');
  });

  it('categorized badge Edit link is always visible on mobile', () => {
    const categorizedSale: UnifiedSaleItem = {
      ...baseSale,
      is_categorized: true,
      chart_account: { id: 'acc-1', account_name: 'Food', account_code: '4000' } as any,
    } as UnifiedSaleItem;
    const { container } = render(<SaleCard {...baseProps} sale={categorizedSale} />);
    const html = container.innerHTML;
    expect(html).toContain('opacity-100');
    expect(html).toContain('sm:opacity-0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/SaleCard.mobile.test.tsx`
Expected: FAIL — assertions for `opacity-100`, `sm:opacity-0`, `min-w-[72px]`, `sm:max-w-[180px]`, `sm:flex-row` not yet in source.

- [ ] **Step 3: Apply class changes**

In `src/components/pos-sales/SaleCard.tsx`:

Line 92 — card padding:
```typescript
// before
className={`group flex items-start gap-3 px-4 py-3 border-b border-border/40 transition-colors ${
// after
className={`group flex items-start gap-3 px-3 py-3 sm:px-4 border-b border-border/40 transition-colors ${
```

Line 156 — recipe name truncation:
```typescript
// before
<span className="truncate max-w-[120px]">{recipe.name}</span>
// after
<span className="truncate max-w-[120px] sm:max-w-[180px]">{recipe.name}</span>
```

Line 179 — amount column min-width:
```typescript
// before
<div className="text-right shrink-0">
// after
<div className="text-right shrink-0 min-w-[72px]">
```

Line 193 — AI suggestion panel (flex direction on mobile):
```typescript
// before
<div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
// after
<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
```

Line 256 — categorized-badge Edit link (hover→always-on-mobile):
```typescript
// before
className="text-[12px] text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
// after
className="text-[12px] text-muted-foreground hover:text-foreground transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
```

Line 303 — action row (hover→always-on-mobile + flex-wrap for narrow widths):
```typescript
// before
<div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
// after
<div className="flex items-center flex-wrap gap-x-3 gap-y-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/SaleCard.mobile.test.tsx`
Expected: PASS — all 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/SaleCard.mobile.test.tsx src/components/pos-sales/SaleCard.tsx
git commit -m "$(printf 'fix(pos-sales): mobile-visible action row + responsive SaleCard layout\n\n- Action buttons no longer hidden behind hover on touch (opacity-100 sm:opacity-0 sm:group-hover:opacity-100)\n- Categorized-badge Edit link same pattern\n- AI suggestion panel switches flex-col → sm:flex-row\n- Card padding tightens on mobile (px-3 sm:px-4)\n- Recipe name truncates harder on mobile (max-w-[120px] sm:max-w-[180px])\n- Amount column gets min-w-[72px] to prevent collision\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>')"
```

---

## Task 2: SplitSaleView — drop direct blue color tokens (CLAUDE.md violation)

**Files:**
- Create: `tests/unit/SplitSaleView.mobile.test.tsx`
- Modify: `src/components/pos-sales/SplitSaleView.tsx:23` (card border), `:24` (card padding), `:30` (Split Sale badge), `:79` (expanded children border)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/SplitSaleView.mobile.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SplitSaleView } from '@/components/pos-sales/SplitSaleView';
import { UnifiedSaleItem } from '@/types/pos';

const splitSale: UnifiedSaleItem = {
  id: 'parent-1',
  itemName: 'Combo Meal',
  quantity: 1,
  totalPrice: 25,
  saleDate: '2026-05-17',
  saleTime: '12:34',
  posSystem: 'toast',
  externalOrderId: 'ord-1',
  is_split: true,
  child_splits: [
    { id: 'child-1', itemName: 'Burger', totalPrice: 15 } as any,
    { id: 'child-2', itemName: 'Fries', totalPrice: 10 } as any,
  ],
} as UnifiedSaleItem;

describe('SplitSaleView — semantic tokens only (no direct blue colors)', () => {
  it('contains no direct blue color tokens', () => {
    const { container } = render(
      <SplitSaleView
        sale={splitSale}
        formatCurrency={(n) => `$${n.toFixed(2)}`}
      />,
    );
    const html = container.innerHTML;
    expect(html).not.toMatch(/\bbg-blue-/);
    expect(html).not.toMatch(/\btext-blue-/);
    expect(html).not.toMatch(/\bborder-blue-/);
    expect(html).not.toMatch(/\bborder-l-blue-/);
    expect(html).not.toMatch(/dark:bg-blue-/);
    expect(html).not.toMatch(/dark:text-blue-/);
    expect(html).not.toMatch(/dark:border-blue-/);
  });

  it('uses neutral semantic left border on the card', () => {
    const { container } = render(
      <SplitSaleView
        sale={splitSale}
        formatCurrency={(n) => `$${n.toFixed(2)}`}
      />,
    );
    expect(container.innerHTML).toContain('border-l-foreground/20');
  });

  it('uses semantic border on expanded children container', () => {
    const { container } = render(
      <SplitSaleView
        sale={splitSale}
        formatCurrency={(n) => `$${n.toFixed(2)}`}
      />,
    );
    // toggle expansion
    const toggle = container.querySelector('button');
    toggle?.click();
    // re-query after click
    expect(container.innerHTML).toContain('border-border/40');
  });

  it('card padding tightens on mobile (p-3 sm:p-4)', () => {
    const { container } = render(
      <SplitSaleView
        sale={splitSale}
        formatCurrency={(n) => `$${n.toFixed(2)}`}
      />,
    );
    expect(container.innerHTML).toContain('p-3');
    expect(container.innerHTML).toContain('sm:p-4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/SplitSaleView.mobile.test.tsx`
Expected: FAIL — current source has `border-l-blue-500`, `bg-blue-100`, etc.

- [ ] **Step 3: Apply class changes**

In `src/components/pos-sales/SplitSaleView.tsx`:

Line 23 — card border + responsive padding:
```typescript
// before
<Card className="w-full transition-all hover:shadow-md border-l-4 border-l-blue-500">
  <CardContent className="p-4 space-y-3">
// after
<Card className="w-full transition-all hover:shadow-md border-l-4 border-l-foreground/20">
  <CardContent className="p-3 sm:p-4 space-y-3">
```

Line 30 — Split Sale badge (drop className override, keep variant="secondary"):
```typescript
// before
<Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
  Split Sale
</Badge>
// after
<Badge variant="secondary">
  Split Sale
</Badge>
```

Line 79 — expanded children left border:
```typescript
// before
<div className="space-y-2 pl-4 border-l-2 border-blue-200 dark:border-blue-800">
// after
<div className="space-y-2 pl-4 border-l-2 border-border/40">
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/SplitSaleView.mobile.test.tsx`
Expected: PASS — all 4 cases green.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/SplitSaleView.mobile.test.tsx src/components/pos-sales/SplitSaleView.tsx
git commit -m "$(printf 'fix(pos-sales): SplitSaleView semantic tokens + mobile padding\n\nReplaces direct blue-* color tokens (CLAUDE.md violation) with neutral\nsemantic tokens: border-l-foreground/20 on parent, border-border/40 on\nexpanded children, plain Badge variant=secondary for the Split Sale\npill (no className override). Tightens card padding on mobile.\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>')"
```

---

## Task 3: POSSalesDashboard — flex-col outer row on mobile

**Files:**
- Create: `tests/unit/POSSalesDashboard.mobile.test.tsx`
- Modify: `src/components/POSSalesDashboard.tsx:98` (outer container)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/POSSalesDashboard.mobile.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { POSSalesDashboard } from '@/components/POSSalesDashboard';

const baseProps = {
  totalSales: 100,
  totalRevenue: 1000,
  discounts: 0,
  voids: 0,
  passThroughAmount: 0,
  collectedAtPOS: 1000,
  uniqueItems: 25,
  unmappedCount: 0,
  lastSyncTime: '2026-05-17T12:00:00Z',
  contextCueVisible: false,
  cuePinned: false,
  onToggleCuePin: () => {},
  contextDescription: '',
  highlightToken: 0,
  filtersActive: false,
  isLoading: false,
};

describe('POSSalesDashboard — mobile layout', () => {
  it('outer row stacks on mobile, switches to flex-row at sm+', () => {
    const { container } = render(<POSSalesDashboard {...baseProps} />);
    const html = container.innerHTML;
    expect(html).toContain('flex-col');
    expect(html).toContain('sm:flex-row');
    expect(html).toContain('sm:items-center');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/POSSalesDashboard.mobile.test.tsx`
Expected: FAIL — source has `flex items-center gap-1` only.

- [ ] **Step 3: Apply class change**

In `src/components/POSSalesDashboard.tsx`:

Line 98 — outer row container:
```typescript
// before
<div className="flex items-center gap-1">
// after
<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-1">
```

(`ml-auto` on line 145 already handles itself — at mobile widths there is no flex-row to apply `ml-auto` against, so the timestamp simply falls onto its own line in the column. No additional edit needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/POSSalesDashboard.mobile.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/POSSalesDashboard.mobile.test.tsx src/components/POSSalesDashboard.tsx
git commit -m "$(printf 'fix(pos-sales): dashboard outer row stacks on mobile\n\nSwitches the metrics+timestamp row from flex-row only to\nflex-col → sm:flex-row, so the Synced timestamp no longer overlaps\nthe metrics on narrow viewports.\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>')"
```

---

## Task 4: BulkActionBar — clear MobileTabBar on mobile

**Files:**
- Create: `tests/unit/BulkActionBar.mobile.test.tsx`
- Modify: `src/components/bulk-edit/BulkActionBar.tsx:40` (bottom offset), `:42` (padding), `:67` (vertical divider)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/BulkActionBar.mobile.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BulkActionBar } from '@/components/bulk-edit/BulkActionBar';

describe('BulkActionBar — mobile clearance', () => {
  it('sits above the MobileTabBar on mobile (bottom-20), reverts at sm+', () => {
    const { container } = render(
      <BulkActionBar
        selectedCount={3}
        onClose={() => {}}
        actions={[{ label: 'Delete', onClick: () => {} }]}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('bottom-20');
    expect(root.className).toContain('sm:bottom-6');
  });

  it('uses tighter padding on mobile, normal at sm+', () => {
    const { container } = render(
      <BulkActionBar
        selectedCount={3}
        onClose={() => {}}
        actions={[{ label: 'Delete', onClick: () => {} }]}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('px-4');
    expect(root.className).toContain('py-3');
    expect(root.className).toContain('sm:px-6');
    expect(root.className).toContain('sm:py-4');
  });

  it('hides the vertical divider on mobile', () => {
    const { container } = render(
      <BulkActionBar
        selectedCount={3}
        onClose={() => {}}
        actions={[{ label: 'Delete', onClick: () => {} }]}
      />,
    );
    const divider = container.querySelector('.bg-border.flex-shrink-0');
    expect(divider?.className).toContain('hidden');
    expect(divider?.className).toContain('sm:block');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/BulkActionBar.mobile.test.tsx`
Expected: FAIL — source has `bottom-6`, `px-6 py-4`, divider missing `hidden sm:block`.

- [ ] **Step 3: Apply class changes**

In `src/components/bulk-edit/BulkActionBar.tsx`:

Line 40 — bottom offset:
```typescript
// before
"fixed bottom-6 left-1/2 -translate-x-1/2 z-50",
// after
"fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50",
```

Line 42 — padding:
```typescript
// before
"px-6 py-4 flex items-center gap-4",
// after
"px-4 py-3 sm:px-6 sm:py-4 flex items-center gap-4",
```

Line 67 — vertical divider:
```typescript
// before
<div className="h-8 w-px bg-border flex-shrink-0" />
// after
<div className="h-8 w-px bg-border flex-shrink-0 hidden sm:block" />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/BulkActionBar.mobile.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/BulkActionBar.mobile.test.tsx src/components/bulk-edit/BulkActionBar.tsx
git commit -m "$(printf 'fix(pos-sales): BulkActionBar clears MobileTabBar on mobile\n\nbottom-6 → bottom-20 sm:bottom-6 so the floating action bar no\nlonger overlaps the staff bottom navigation. Tighter padding and a\nhidden divider on mobile to fit narrow viewports.\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>')"
```

---

## Task 5: POSSales page — header actions row (aria-labels, label spans, DOM-order fix)

**Files:**
- Modify: `src/pages/POSSales.tsx:794-845`

- [ ] **Step 1: Apply class + JSX changes**

In `src/pages/POSSales.tsx`, replace the header actions block (lines 794-845).

Important: the **DOM order** has to change so that "Add Sale" is the first child in the JSX. Combined with `order-last sm:order-none`, it renders last on desktop (where flex `order` has visual effect) and lands on its own visible line on mobile when the row wraps (where it stays first in DOM order, which is what gets rendered when wrapping).

Replace lines 794-845 with:

```typescript
          {/* Action buttons - Apple style */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                setActiveTab("manual");
                setEditingSale(null);
                setShowSaleDialog(true);
              }}
              size="sm"
              className="order-last sm:order-none h-8 px-3 text-[13px] font-medium bg-foreground text-background hover:bg-foreground/90 rounded-lg transition-colors shadow-sm"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Sale
            </Button>
            {hasAnyConnectedSystem() && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSyncSales}
                disabled={isSyncing}
                aria-label="Sync sales"
                className="h-8 px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg transition-colors"
              >
                <RefreshCw className={`h-3.5 w-3.5 sm:mr-1.5 ${isSyncing ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{isSyncing ? "Syncing" : "Sync"}</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowRulesDialog(true)}
              aria-label="Category rules"
              className="h-8 px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Rules</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("import")}
              aria-label="Import sales"
              className="h-8 px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg transition-colors"
            >
              <UploadIcon className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Import</span>
            </Button>
            <ExportDropdown
              onExportCSV={handleExportCSV}
              onExportPDF={handleExportPDF}
              isExporting={isExporting}
            />
            <div className="hidden sm:block w-px h-5 bg-border mx-1" />
          </div>
```

- [ ] **Step 2: Verify in browser**

Run: `npm run dev` then visit http://localhost:8080/pos-sales with DevTools mobile emulation at 375px wide.
Expected:
- Add Sale is visible and renders on its own line (because it wraps first due to `order-last sm:order-none` + DOM-first position).
- Sync/Rules/Import/Export show only icons.
- Each icon-only button has an `aria-label` (verify in DevTools: inspect the `<button>` element).

At ≥ 640px: layout is identical to before (Add Sale rightmost, secondary buttons show full labels).

- [ ] **Step 3: Commit**

```bash
git add src/pages/POSSales.tsx
git commit -m "$(printf 'fix(pos-sales): mobile-responsive header actions row\n\n- flex-wrap so the row no longer overflows on narrow viewports\n- icon-only Sync/Rules/Import/Clear on mobile with explicit aria-labels\n- Add Sale stays on its own visible line when wrap occurs\n  (DOM-first + order-last sm:order-none)\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>')"
```

---

## Task 6: POSSales page — AI Categorization card header + Restaurant pill

**Files:**
- Modify: `src/pages/POSSales.tsx:869-890` (card header), `:784-787` (restaurant pill)

- [ ] **Step 1: Apply class changes**

In `src/pages/POSSales.tsx`:

Restaurant pill (lines 784-787) — let inner row wrap on narrowest screens:
```typescript
// before
<span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-muted text-muted-foreground">
  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
  {selectedRestaurant.restaurant.name}
</span>
// after
<span className="inline-flex flex-wrap items-center gap-1.5 px-2 sm:px-2.5 py-1 text-xs font-medium rounded-full bg-muted text-muted-foreground">
  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
  {selectedRestaurant.restaurant.name}
</span>
```

AI Categorization card header (line 871) — wrap title above button on mobile:
```typescript
// before
<div className="flex items-center justify-between">
// after
<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
```

AI Categorize button (line 881-888) — two-span text swap so the button label fits on mobile:
```typescript
// before
<Button
  onClick={handleCategorizeClick}
  disabled={isCategorizingPending || uncategorizedSalesCount === 0}
  className="gap-2"
>
  <Sparkles className="h-4 w-4" />
  {isCategorizingPending ? "Categorizing..." : "AI Categorize Sales"}
</Button>
// after
<Button
  onClick={handleCategorizeClick}
  disabled={isCategorizingPending || uncategorizedSalesCount === 0}
  className="gap-2 w-full sm:w-auto"
>
  <Sparkles className="h-4 w-4" />
  {isCategorizingPending ? (
    "Categorizing..."
  ) : (
    <>
      <span className="hidden sm:inline">AI Categorize Sales</span>
      <span className="sm:hidden">AI Categorize</span>
    </>
  )}
</Button>
```

- [ ] **Step 2: Verify in browser**

Run: `npm run dev` then visit http://localhost:8080/pos-sales at 375px.
Expected:
- AI card title is stacked above the button.
- Button reads "AI Categorize" on mobile, "AI Categorize Sales" on desktop.
- Restaurant pill wraps cleanly inside the heading area.

- [ ] **Step 3: Commit**

```bash
git add src/pages/POSSales.tsx
git commit -m "$(printf 'fix(pos-sales): AI card header stacks on mobile; restaurant pill wraps\n\nAI Categorization card swaps flex-row → flex-col sm:flex-row so the\nlong-labelled button no longer collides with the title. Button label\nshortens to AI Categorize on mobile. Restaurant pill flex-wraps.\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>')"
```

---

## Task 7: POSSales page — filter row 1 (search + dates + Clear)

**Files:**
- Modify: `src/pages/POSSales.tsx:954-1010`

- [ ] **Step 1: Apply class changes**

In `src/pages/POSSales.tsx`:

Filter row 1 — switch to mobile-first flex-col, let date inputs flex, and add aria-label to the icon-only Clear button.

Line 954 (outer row direction — already uses `md:flex-row`, change to `sm:flex-row`):
```typescript
// before
<div className="flex flex-col md:flex-row gap-3">
// after
<div className="flex flex-col sm:flex-row gap-3">
```

Lines 970-986 (date inputs — let them flex on mobile, fix width at sm+):
```typescript
// before (start date)
className="h-9 w-[150px] text-[13px] bg-muted/40 border-0 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
// after (start date)
className="h-9 flex-1 sm:w-[150px] sm:flex-none text-[13px] bg-muted/40 border-0 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
```
(Same swap on the end-date input on line ~985.)

Also wrap the two date inputs container (line 968) with `flex-1 sm:flex-none` so the pair takes the row's full width on mobile but stays compact on desktop:
```typescript
// before
<div className="flex items-center gap-2">
// after
<div className="flex flex-1 sm:flex-none items-center gap-2">
```

Lines 991-1009 (Clear button — icon-only on mobile + aria-label):
```typescript
// before
<Button
  variant="ghost"
  size="sm"
  onClick={() => {
    setSearchTerm("");
    setStartDate("");
    setEndDate("");
    setRecipeFilter('all');
    setCategorizationFilter('all');
    setSortBy('date');
    setSortDirection('desc');
  }}
  className="h-9 px-3 text-[13px] text-muted-foreground hover:text-foreground"
>
  <X className="h-3.5 w-3.5 mr-1" />
  Clear
</Button>
// after
<Button
  variant="ghost"
  size="sm"
  onClick={() => {
    setSearchTerm("");
    setStartDate("");
    setEndDate("");
    setRecipeFilter('all');
    setCategorizationFilter('all');
    setSortBy('date');
    setSortDirection('desc');
  }}
  aria-label="Clear filters"
  className="h-9 px-3 text-[13px] text-muted-foreground hover:text-foreground"
>
  <X className="h-3.5 w-3.5 sm:mr-1" />
  <span className="hidden sm:inline">Clear</span>
</Button>
```

- [ ] **Step 2: Verify in browser**

At 375px wide:
- Search input is full-width.
- Date inputs each fill half the row (with the en-dash between them).
- Clear is icon-only with `aria-label="Clear filters"` (DevTools accessibility tab).

At ≥ 640px:
- Search input is `max-w-md`, dates are 150px each, Clear shows "Clear" text — same as before.

- [ ] **Step 3: Commit**

```bash
git add src/pages/POSSales.tsx
git commit -m "$(printf 'fix(pos-sales): filter row 1 stacks + responsive date inputs\n\nSwitches the outer row breakpoint from md: to sm: (matches the rest\nof the page) and lets the date pair fill the available row on mobile\nwhile staying 150px at sm+. Clear button becomes icon-only on mobile\nwith aria-label.\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>')"
```

---

## Task 8: POSSales page — filter row 2 (sort cluster, breakpoint cleanup)

**Files:**
- Modify: `src/pages/POSSales.tsx:1047`, `:1074`, `:1104`

- [ ] **Step 1: Apply class changes**

In `src/pages/POSSales.tsx`:

Line 1047 (divider — change md: to sm: for breakpoint consistency):
```typescript
// before
<div className="h-5 w-px bg-border/60 hidden md:block" />
// after
<div className="h-5 w-px bg-border/60 hidden sm:block" />
```

Line 1074 (divider — same change):
```typescript
// before
<div className="h-5 w-px bg-border/60 hidden md:block" />
// after
<div className="h-5 w-px bg-border/60 hidden sm:block" />
```

Line 1104 (sort cluster — full-width on mobile, ml-auto only at sm+):
```typescript
// before
<div className="flex items-center gap-2 ml-auto">
// after
<div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
```

(The outer `flex flex-wrap items-center gap-4` container on line 1013 already wraps; no `overflow-x-auto` wrappers exist in the source to remove — that audit point in the spec was preventive. Confirmed by re-reading the file.)

- [ ] **Step 2: Verify in browser**

At 375px:
- The three segmented control groups (Status / Recipe / View) wrap to new lines as needed.
- Dividers between them are hidden.
- The sort cluster lands on its own row, full-width.

At ≥ 640px:
- Dividers show.
- Sort cluster is right-aligned via `ml-auto`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/POSSales.tsx
git commit -m "$(printf 'fix(pos-sales): filter row 2 sort cluster + breakpoint unification\n\nSort cluster gets w-full on mobile + sm:w-auto sm:ml-auto so it no\nlonger collides with the segments when wrapping. Inter-group\ndividers switch from md: to sm: to match the unified breakpoint\npolicy.\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>')"
```

---

## Task 9: POSSales page — virtualized list height + virtualizer key fix

**Files:**
- Modify: `src/pages/POSSales.tsx:1197` (list height), `:1214` and `:1238` (virtualizer keys — pre-existing bug)

This task folds in a required correctness fix: the virtualizer keys currently use `key={virtualRow.index}`, but CLAUDE.md mandates `key={items[virtualRow.index].id}` for `@tanstack/react-virtual`. Index keys break React reconciliation when the underlying list reorders or filters.

- [ ] **Step 1: Apply class + key changes**

In `src/pages/POSSales.tsx`:

Line 1197 — virtualized list height (dvh progressive enhancement + min height floor):
```typescript
// before
<div
  ref={salesListRef}
  className="h-[600px] overflow-auto rounded-xl border border-border/40 bg-background"
>
// after
<div
  ref={salesListRef}
  className="h-[calc(100vh-180px)] [height:calc(100dvh-180px)] min-h-[400px] sm:h-[600px] overflow-auto rounded-xl border border-border/40 bg-background"
>
```

Line 1214 — split-view row key:
```typescript
// before
<div
  key={virtualRow.index}
  data-index={virtualRow.index}
// after
<div
  key={sale.id}
  data-index={virtualRow.index}
```

Line 1238 — sale-card row key:
```typescript
// before
<div
  key={virtualRow.index}
  data-index={virtualRow.index}
// after
<div
  key={sale.id}
  data-index={virtualRow.index}
```

- [ ] **Step 2: Verify in browser**

At 375px:
- List occupies the available viewport height (calc(100dvh-180px) with min-h-[400px] floor).
- Smooth virtualized scrolling.

At ≥ 640px:
- List is `h-[600px]` — unchanged from before.

Functional verification of key fix:
- Apply a search filter ("burger" → "fries"). Confirm list rows do not flash incorrect content (which would happen if React was reusing DOM nodes by index).

- [ ] **Step 3: Commit**

```bash
git add src/pages/POSSales.tsx
git commit -m "$(printf 'fix(pos-sales): responsive virtualized list height + virtualizer keys\n\n- List height adapts to viewport on mobile (calc(100dvh-180px)) with a\n  400px floor and progressive dvh enhancement\n- Fix pre-existing virtualizer key bug: key={virtualRow.index} →\n  key={sale.id} on both the split-view and sale-card rows\n  (CLAUDE.md mandates stable IDs for @tanstack/react-virtual)\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>')"
```

---

## Task 10: POSSales page — grouped-view "Check impact" + type="button"

**Files:**
- Modify: `src/pages/POSSales.tsx:1396-1401`

- [ ] **Step 1: Apply class + attribute changes**

In `src/pages/POSSales.tsx`, lines 1396-1401:

```typescript
// before
<button
  onClick={() => handleSimulateDeduction(item.item_name, item.total_quantity)}
  className="ml-auto text-[12px] text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
>
  Check impact
</button>
// after
<button
  type="button"
  onClick={() => handleSimulateDeduction(item.item_name, item.total_quantity)}
  className="ml-auto text-[12px] text-muted-foreground hover:text-foreground transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
>
  Check impact
</button>
```

- [ ] **Step 2: Verify in browser**

At 375px:
- Switch to "Grouped" view.
- Each card shows "Check impact" without needing hover.

- [ ] **Step 3: Commit**

```bash
git add src/pages/POSSales.tsx
git commit -m "$(printf 'fix(pos-sales): grouped-view Check impact reachable on touch\n\nopacity-0 group-hover:opacity-100 → opacity-100 sm:opacity-0\nsm:group-hover:opacity-100 so the action is reachable on mobile.\nAlso adds explicit type=button to guard against default-submit\nbehavior inside any future form context.\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>')"
```

---

## Task 11: POSSales source-text regression test

**Files:**
- Create: `tests/unit/POSSalesMobile.source.test.ts`

POSSales.tsx imports 30+ hooks and a dozen components — full-render tests would require mocking each one. Instead we use a source-text regression guard: if any of the responsive tokens get removed in a future edit, the test fails. This is the cheapest reliable guard.

- [ ] **Step 1: Write the test**

```typescript
// tests/unit/POSSalesMobile.source.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SOURCE = readFileSync(
  resolve(__dirname, '../../src/pages/POSSales.tsx'),
  'utf8',
);

describe('POSSales — mobile responsive tokens stay in source', () => {
  it('header actions container is flex-wrap', () => {
    expect(SOURCE).toContain('flex flex-wrap items-center gap-2');
  });

  it('Add Sale uses order-last sm:order-none for wrap behavior', () => {
    expect(SOURCE).toContain('order-last sm:order-none');
  });

  it('Sync/Rules/Import buttons have aria-label', () => {
    expect(SOURCE).toContain('aria-label="Sync sales"');
    expect(SOURCE).toContain('aria-label="Category rules"');
    expect(SOURCE).toContain('aria-label="Import sales"');
  });

  it('Clear filters button has aria-label', () => {
    expect(SOURCE).toContain('aria-label="Clear filters"');
  });

  it('AI Categorize button has two-span label swap', () => {
    expect(SOURCE).toContain('AI Categorize Sales');
    expect(SOURCE).toContain('>AI Categorize<');
  });

  it('date inputs flex on mobile, fixed width at sm+', () => {
    expect(SOURCE).toContain('flex-1 sm:w-[150px] sm:flex-none');
  });

  it('filter row 1 uses sm: breakpoint (not md:)', () => {
    expect(SOURCE).toContain('flex flex-col sm:flex-row gap-3');
  });

  it('filter row 2 dividers use sm: not md:', () => {
    expect(SOURCE).not.toMatch(/h-5 w-px bg-border\/60 hidden md:block/);
    expect(SOURCE).toContain('h-5 w-px bg-border/60 hidden sm:block');
  });

  it('sort cluster full-width on mobile', () => {
    expect(SOURCE).toContain('w-full sm:w-auto sm:ml-auto');
  });

  it('virtualized list height uses dvh progressive enhancement', () => {
    expect(SOURCE).toContain('h-[calc(100vh-180px)]');
    expect(SOURCE).toContain('[height:calc(100dvh-180px)]');
    expect(SOURCE).toContain('min-h-[400px]');
    expect(SOURCE).toContain('sm:h-[600px]');
  });

  it('virtualizer keys use sale.id (not index)', () => {
    expect(SOURCE).not.toMatch(/key=\{virtualRow\.index\}/);
    const saleIdKeyMatches = SOURCE.match(/key=\{sale\.id\}/g) || [];
    expect(saleIdKeyMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('grouped-view Check impact is mobile-visible and has type=button', () => {
    expect(SOURCE).toContain('opacity-100 sm:opacity-0 sm:group-hover:opacity-100');
    expect(SOURCE).toMatch(/type="button"[\s\S]*?onClick=\{\(\) => handleSimulateDeduction/);
  });

  it('AI Categorization card header stacks on mobile', () => {
    expect(SOURCE).toContain('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between');
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/unit/POSSalesMobile.source.test.ts`
Expected: PASS (all responsive tokens were added in Tasks 5-10).

If any assertion fails, find the corresponding spot in `src/pages/POSSales.tsx` and re-apply the change. Do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/POSSalesMobile.source.test.ts
git commit -m "$(printf 'test(pos-sales): source-text regression guard for mobile tokens\n\nGuards that every responsive token added in tasks 5-10 stays in\nsrc/pages/POSSales.tsx. Source-text rather than render-based because\nthe page imports 30+ hooks; mocking them all would dwarf the test\nitself and add zero value vs. grep.\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>')"
```

---

## Task 12: Dialog audit (POSSaleDialog, SplitPosSaleDialog, BulkCategorizePosSalesPanel, EnhancedCategoryRulesDialog)

**Files:**
- Read and audit each dialog file
- Modify only those that violate the spec's four-point checklist

**Checklist for each dialog (from spec):**
1. `DialogContent` uses sticky-footer pattern: `max-h-[85vh] overflow-hidden flex flex-col`
2. Two-column form rows: `grid-cols-1 sm:grid-cols-2` (not `grid grid-cols-2` alone)
3. Footer action rows: `flex justify-end gap-2 flex-wrap`
4. No `min-w-[NNN]` larger than 320px on inputs

- [ ] **Step 1: Audit POSSaleDialog**

Run: `grep -n "DialogContent\|grid grid-cols\|justify-end gap\|min-w-\[" src/components/POSSaleDialog.tsx`

For each finding, compare to the four-point checklist. If all four pass, no edits — note in commit message ("POSSaleDialog: passes audit, no changes"). If any fail, apply the corresponding fix:

- Missing sticky-footer classes → add them to the `DialogContent` className.
- `grid grid-cols-2` without responsive prefix → `grid grid-cols-1 sm:grid-cols-2`.
- Footer missing `flex-wrap` → add it.
- Input with `min-w-[400px]` or similar → drop to `min-w-[320px]` or remove.

- [ ] **Step 2: Audit SplitPosSaleDialog**

Run: `grep -n "DialogContent\|grid grid-cols\|justify-end gap\|min-w-\[" src/components/pos-sales/SplitPosSaleDialog.tsx`

Apply same audit + fixes.

- [ ] **Step 3: Audit BulkCategorizePosSalesPanel**

Run: `grep -n "DialogContent\|grid grid-cols\|justify-end gap\|min-w-\[" src/components/pos-sales/BulkCategorizePosSalesPanel.tsx`

Note: this may not be a dialog (panel). Audit the same four points anyway as they apply to any modal-ish surface.

- [ ] **Step 4: Audit EnhancedCategoryRulesDialog**

Run: `grep -n "DialogContent\|grid grid-cols\|justify-end gap\|min-w-\[" src/components/banking/EnhancedCategoryRulesDialog.tsx`

Apply same audit + fixes.

- [ ] **Step 5: Verify existing POSSaleDialog scroll test still passes**

Run: `npx vitest run tests/unit/POSSaleDialog.scroll.test.tsx`
Expected: PASS — must still contain `max-h-[85vh]`, `overflow-hidden`, `flex-col`. If we touched POSSaleDialog and broke this, revert that specific change.

- [ ] **Step 6: Commit**

If any files were modified:
```bash
git add src/components/POSSaleDialog.tsx src/components/pos-sales/SplitPosSaleDialog.tsx src/components/pos-sales/BulkCategorizePosSalesPanel.tsx src/components/banking/EnhancedCategoryRulesDialog.tsx
git commit -m "$(printf 'fix(pos-sales): dialog mobile audit fixes\n\nAudit POSSaleDialog, SplitPosSaleDialog, BulkCategorizePosSalesPanel,\nEnhancedCategoryRulesDialog against the four-point spec checklist:\nsticky-footer DialogContent, grid-cols-1 sm:grid-cols-2 for two-col\nforms, flex-wrap on footer action rows, no min-w >320px on inputs.\n\nDialogs that passed clean: <list which ones, if any>\nDialogs touched: <list with the fix>\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>')"
```

If all four passed clean:
```bash
git commit --allow-empty -m "$(printf 'audit(pos-sales): dialogs already meet mobile spec checklist\n\nAudited POSSaleDialog, SplitPosSaleDialog, BulkCategorizePosSalesPanel,\nEnhancedCategoryRulesDialog. All four pass the sticky-footer +\nresponsive grid + wrap-footer + no-overlarge-min-width checklist.\nNo code changes required.\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>')"
```

---

## Task 13: Final verification (full test + typecheck + lint + build)

**Files:** none — verification only.

- [ ] **Step 1: Run the full unit test suite**

Run: `npm run test`
Expected: all tests pass, including all 5 new mobile tests + the existing POSSaleDialog scroll test.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors. (We did not change types — but the JSX edits could surface a typo.)

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: 0 errors. New warnings only if pre-existing — note them but don't fix.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: succeeds without errors.

- [ ] **Step 5: Browser sanity check**

Run: `npm run dev`. Open http://localhost:8080/pos-sales in a real browser, then toggle DevTools mobile emulation at:
- 320px (iPhone SE minimum width)
- 375px (default iPhone)
- 414px (iPhone Plus)
- 640px (sm: breakpoint)
- 768px (md: breakpoint)
- 1024px (desktop)

For each width, walk through:
1. Header buttons render and don't overflow.
2. Filter rows render and don't overflow.
3. Sale cards' action buttons are visible without hover (on mobile).
4. Tap each per-card action: Categorize, Split, Check impact, Edit, Delete — they all respond.
5. Switch to Grouped view: "Check impact" is visible and tappable.
6. Open Bulk select mode: BulkActionBar sits above the MobileTabBar.
7. Open POSSaleDialog — footer pinned, body scrolls inside.

If any breaks: note the issue + return to the relevant earlier task to fix.

- [ ] **Step 6: No commit — push and open PR (handled by /dev workflow Phase 9)**

This task ends the implementation plan. Phase 9 of the dev workflow takes over to push, open the PR, and walk the CI loop.

---

## Self-review checklist (verified by author)

- [x] **Spec coverage:** Each of the 10 spec findings + the breakpoint policy + the virtualizer key bug + the dialog audit have a task. All Testing-section files map to a created test or the source-text guard.
- [x] **Placeholder scan:** No "TBD", "TODO", "similar to", "add appropriate" — every step shows the actual code or command.
- [x] **Type consistency:** Test mocks use `UnifiedSaleItem` cast for optional fields; no new types introduced.
- [x] **Breakpoint policy:** Every responsive class added uses `sm:` only. The only remaining `md:` reference in the page (heading text size `text-[2.5rem]`) is pre-existing typography and out of scope.
