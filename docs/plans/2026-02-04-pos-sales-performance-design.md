# POS Sales Performance Optimization

**Date:** 2026-02-04
**Status:** Approved
**Goal:** Fast initial load + smooth performance as data grows

## Problem Statement

The POS Sales screen (`/pos-sales`) suffers from performance issues:

1. **Slow initial load** — 1.3MB payload from `unified_sales`, 15+ parallel API calls
2. **Degrades with data** — No virtualization means DOM grows linearly with sales count
3. **Janky interactions** — 342ms Total Blocking Time, complex per-card rendering

### Evidence from Chrome DevTools Trace

| Metric | Current | Target |
|--------|---------|--------|
| `unified_sales` payload | 1.3MB | ~200KB |
| DOM nodes at load | 14,039 | ~800 |
| Total Blocking Time | 342ms | <100ms |
| Time to interactive | ~800ms | ~400ms |

## Solution Overview

Four-phase optimization targeting both initial load and sustained performance:

1. **Lean queries** — Reduce payload size
2. **Virtualization** — Only render visible items
3. **Component optimization** — Reduce per-card render cost
4. **Deferred loading** — Prioritize critical data path

## Phase 1: Query Optimization

### Changes to `src/hooks/useUnifiedSales.tsx`

**1.1 Remove `raw_data` from default select**

Current query fetches all columns including `raw_data` (large JSON blob used only for debugging).

```typescript
// Before
.select(`
  *,
  suggested_chart_account:chart_of_accounts!suggested_category_id (...)
`)

// After
.select(`
  id,
  restaurant_id,
  pos_system,
  external_order_id,
  external_item_id,
  item_name,
  quantity,
  unit_price,
  total_price,
  sale_date,
  sale_time,
  pos_category,
  synced_at,
  created_at,
  category_id,
  suggested_category_id,
  ai_confidence,
  ai_reasoning,
  item_type,
  adjustment_type,
  is_categorized,
  is_split,
  parent_sale_id,
  suggested_chart_account:chart_of_accounts!suggested_category_id (
    id, account_code, account_name, account_type
  ),
  approved_chart_account:chart_of_accounts!category_id (
    id, account_code, account_name, account_type
  )
`)
```

**1.2 Increase page size**

With virtualization, larger pages are safe and reduce pagination overhead.

```typescript
// Before
const PAGE_SIZE = 200;

// After
const PAGE_SIZE = 500;
```

**1.3 Deduplicate queries**

Audit shows `unified_sales` fires twice on mount. Ensure query keys are stable and components don't trigger redundant fetches.

### Expected Impact

- Payload: 1.3MB → ~200-300KB (75%+ reduction)
- Fewer round trips with larger page size

## Phase 2: Virtual List Implementation

### New dependency

```bash
npm install @tanstack/react-virtual
```

### Changes to `src/pages/POSSales.tsx`

**2.1 Add virtualization wrapper**

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

// Inside component
const parentRef = useRef<HTMLDivElement>(null);

const virtualizer = useVirtualizer({
  count: dateFilteredSales.length,
  getScrollElement: () => parentRef.current,
  estimateSize: (index) => {
    const sale = dateFilteredSales[index];
    // Split sales are taller
    return sale.is_split && sale.child_splits?.length ? 200 : 120;
  },
  overscan: 5, // Render 5 extra items above/below viewport
});

// In JSX
<div
  ref={parentRef}
  className="h-[600px] overflow-auto"
>
  <div
    style={{
      height: `${virtualizer.getTotalSize()}px`,
      width: '100%',
      position: 'relative',
    }}
  >
    {virtualizer.getVirtualItems().map((virtualRow) => {
      const sale = dateFilteredSales[virtualRow.index];
      return (
        <div
          key={sale.id}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualRow.start}px)`,
          }}
        >
          <SaleCard sale={sale} {...cardProps} />
        </div>
      );
    })}
  </div>
</div>
```

**2.2 Extract SaleCard component**

Move lines 1076-1374 (the sale card rendering) to a new memoized component.

### New file: `src/components/pos-sales/SaleCard.tsx`

```typescript
import React, { memo } from 'react';
import { UnifiedSaleItem } from '@/types/pos';

interface SaleCardProps {
  sale: UnifiedSaleItem;
  recipe?: { id: string; name: string; hasIngredients: boolean; profitMargin?: number } | null;
  isSelected: boolean;
  isSelectionMode: boolean;
  onSelect: (id: string, event: React.MouseEvent) => void;
  onCheckboxChange: (id: string) => void;
  onEdit: (sale: UnifiedSaleItem) => void;
  onDelete: (id: string) => void;
  onSimulateDeduction: (name: string, qty: number) => void;
  onMapPOSItem: (name: string) => void;
  onCategorize: (id: string) => void;
  onSplit: (sale: UnifiedSaleItem) => void;
  onSuggestRule: (sale: UnifiedSaleItem) => void;
  onApproveCategory: (sale: UnifiedSaleItem) => void;
  canEditManualSales: boolean;
}

export const SaleCard = memo(function SaleCard({
  sale,
  recipe,
  isSelected,
  isSelectionMode,
  // ... handlers
}: SaleCardProps) {
  // Card rendering logic moved here
  // (existing JSX from POSSales.tsx lines 1076-1374)
}, (prevProps, nextProps) => {
  // Custom comparison for performance
  return (
    prevProps.sale.id === nextProps.sale.id &&
    prevProps.sale.is_categorized === nextProps.sale.is_categorized &&
    prevProps.sale.category_id === nextProps.sale.category_id &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isSelectionMode === nextProps.isSelectionMode &&
    prevProps.recipe?.id === nextProps.recipe?.id
  );
});
```

### Expected Impact

- DOM nodes: 14,000 → ~800 (visible items + overscan)
- Smooth 60fps scrolling regardless of total sales count
- Memory usage stays constant

## Phase 3: Component Optimizations

### 3.1 Pre-compute recipe map in parent

```typescript
// In POSSales.tsx
const saleRecipeMap = useMemo(() => {
  const map = new Map<string, typeof recipeByItemName extends Map<string, infer V> ? V : never>();
  for (const sale of dateFilteredSales) {
    const recipe = getRecipeForItem(sale.itemName, recipeByItemName);
    if (recipe) {
      map.set(sale.id visually, recipe);
    }
  }
  return map;
}, [dateFilteredSales, recipeByItemName]);
```

### 3.2 Stabilize callback references

```typescript
// Create stable callbacks that take ID as parameter
const handleSelectStable = useCallback((id: string, event: React.MouseEvent) => {
  handleSelectionToggle(id, event);
}, [handleSelectionToggle]);

const handleCheckboxStable = useCallback((id: string) => {
  handleCheckboxChange(id);
}, []);

// Pass to SaleCard - reference won't change between renders
<SaleCard
  onSelect={handleSelectStable}
  onCheckboxChange={handleCheckboxStable}
/>
```

### 3.3 Lazy load SearchableAccountSelector

Only mount when user clicks "Categorize":

```typescript
// In SaleCard
{editingCategoryForSale === sale.id && (
  <Suspense fallback={<Skeleton className="h-10 w-full" />}>
    <SearchableAccountSelector ... />
  </Suspense>
)}
```

### Expected Impact

- Per-card render: ~2ms → ~0.3ms
- Total list render stays under 16ms (60fps threshold)

## Phase 4: Deferred Loading

### 4.1 Prioritize sales query

Sales data loads first (already the case, just ensure no blockers).

### 4.2 Defer secondary queries

```typescript
// In useRecipes or where it's called
const { recipes } = useRecipes(restaurantId, {
  // Don't block initial render
  enabled: !!restaurantId,
  // Lower priority - load after sales
  staleTime: 120000, // 2 minutes - less aggressive
});
```

### 4.3 Skeleton dashboard

```typescript
// In POSSalesDashboard.tsx
if (isLoading) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <Skeleton className="h-4 w-20 mb-2" />
            <Skeleton className="h-8 w-24" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

### 4.4 Progressive badge loading

Show placeholder while recipe data loads:

```typescript
// In SaleCard
{recipe === undefined ? (
  <Badge variant="outline" className="animate-pulse">
    <Skeleton className="h-3 w-16" />
  </Badge>
) : recipe ? (
  <Badge>...</Badge>
) : (
  <Badge variant="destructive">No Recipe</Badge>
)}
```

### Expected Impact

- Time to first meaningful paint: ~800ms → ~400ms
- User sees scrollable list immediately
- Secondary data populates progressively

## Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useUnifiedSales.tsx` | Explicit column select, increase PAGE_SIZE |
| `src/pages/POSSales.tsx` | Add virtualization, extract card, stabilize callbacks |
| `src/components/pos-sales/SaleCard.tsx` | **New file** - memoized sale card component |
| `src/components/pos-sales/SplitSaleCard.tsx` | **New file** - memoized split sale variant |
| `src/components/POSSalesDashboard.tsx` | Add skeleton loading state |

## Implementation Order

1. **Phase 1** (Query optimization) — Quick win, no UI changes
2. **Phase 2** (Virtualization) — Biggest impact, requires SaleCard extraction
3. **Phase 3** (Component optimization) — Refinement after virtualization works
4. **Phase 4** (Deferred loading) — Polish for perceived performance

## Testing Plan

- [ ] Verify payload size reduction in Network tab
- [ ] Test with 1000+ sales records - scrolling should stay smooth
- [ ] Measure Total Blocking Time in Lighthouse
- [ ] Test on low-end device / throttled CPU
- [ ] Verify all sale card interactions still work (edit, delete, categorize, split)
- [ ] Test bulk selection with virtualized list

## Rollback Plan

If issues arise, changes can be reverted independently:
- Virtualization can be removed by reverting to `.map()` rendering
- Query changes are isolated to `useUnifiedSales.tsx`
- SaleCard component can be inlined back if needed
