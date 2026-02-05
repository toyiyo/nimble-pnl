# Bank Transactions Performance Optimization

**Date:** 2026-02-05
**Status:** Approved
**Goal:** Fast initial load + smooth performance for 1,300+ transactions (scaling to 5,000+)

## Problem Statement

The `/banking` and `/transactions` pages suffer from performance degradation as transaction count grows. With ~1,300 transactions currently (projecting to 5,000+ annually), users experience slow initial load, janky scrolling, slow tab switching, and laggy interactions.

### Root Causes Identified

| Issue | Location | Impact |
|-------|----------|--------|
| No virtualization | `BankTransactionList.tsx` | All 1,300+ rows render to DOM |
| Per-row hook calls | `BankTransactionRow.tsx:48` | `useBankTransactionActions` runs 1,300+ times |
| Per-row memoization | `BankTransactionRow.tsx:55-60` | `useMemo` for account lookup runs per row |
| Dialogs in every row | `BankTransactionRow.tsx:270-283` | `TransactionDialogs` mounts for each row |
| Large query payload | `useBankTransactions.tsx:94-114` | Fetches `*` plus 4 joins including unused fields |

### Target Metrics

| Metric | Current (estimated) | Target |
|--------|---------------------|--------|
| DOM nodes per 1,000 txns | ~8,000+ | ~500 (visible only) |
| Initial render time | 500ms+ | <100ms |
| Scroll frame rate | Janky | Smooth 60fps |
| Tab switch time | Noticeable lag | <50ms |

## Solution Overview

Four-phase optimization following the proven POS Sales pattern:

1. **Query optimization** — Reduce payload size
2. **Virtualization** — Only render visible rows
3. **Component optimization** — Memoize rows, hoist hooks
4. **Deferred loading** — Progressive rendering

## Phase 1: Query Optimization

### Changes to `src/hooks/useBankTransactions.tsx`

**1.1 Explicit column selection instead of `*`**

Replace wildcard with explicit fields, excluding `raw_data` (large JSON blob):

```typescript
const buildBaseQuery = (restaurantId: string) =>
  supabase
    .from('bank_transactions')
    .select(`
      id,
      restaurant_id,
      connected_bank_id,
      transaction_date,
      amount,
      description,
      merchant_name,
      normalized_payee,
      category_id,
      suggested_category_id,
      status,
      is_categorized,
      is_reconciled,
      is_split,
      is_transfer,
      excluded_reason,
      ai_confidence,
      ai_reasoning,
      supplier_id,
      connected_bank:connected_banks(
        id,
        institution_name
      ),
      chart_account:chart_of_accounts!category_id(
        id,
        account_name
      )
    `, { count: 'exact' })
    .eq('restaurant_id', restaurantId);
```

**Removed:**
- `raw_data` — Large JSON blob, only needed for debugging
- `bank_account_balances` nested join — Fetch separately when needed
- `supplier` join — Only ~5% of transactions have suppliers, fetch on-demand
- `expense_invoice_upload` join — Rarely used, fetch on-demand

**1.2 Increase page size**

```typescript
export const BANK_TRANSACTIONS_PAGE_SIZE = 500; // was 200
```

### Expected Impact

- Payload: ~60-70% reduction
- Fewer round trips with larger page size

## Phase 2: Virtualization

Using `@tanstack/react-virtual` with dynamic height measurement (proven pattern from POS Sales).

### New dependency

```bash
npm install @tanstack/react-virtual
```

### Changes to `src/components/banking/BankTransactionList.tsx`

```typescript
import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

export function BankTransactionList({ transactions, ... }: BankTransactionListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: transactions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56, // Initial estimate; measureElement corrects it
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="h-[600px] overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const transaction = transactions[virtualRow.index];
          return (
            <div
              key={virtualRow.index}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="pb-2"
            >
              <MemoizedTransactionRow transaction={transaction} {...otherProps} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**Key implementation details:**
- Uses `div` wrappers instead of `<table>` — virtualization doesn't work with HTML tables
- `measureElement` ref callback measures actual row height after render
- `data-index` attribute required for measureElement to work
- `pb-2` class provides consistent spacing between rows

### Expected Impact

- DOM nodes: ~8,000 → ~500 (visible + overscan)
- Smooth 60fps scrolling regardless of total transaction count

## Phase 3: Component Optimization

### 3.1 Extract memoized row component

**New file: `src/components/banking/MemoizedTransactionRow.tsx`**

```typescript
import { memo } from 'react';
import { BankTransaction } from '@/hooks/useBankTransactions';
import { ChartAccount } from '@/hooks/useChartOfAccounts';

interface MemoizedTransactionRowProps {
  transaction: BankTransaction;
  status: 'for_review' | 'categorized' | 'excluded';
  accounts: ChartAccount[];
  isSelectionMode: boolean;
  isSelected: boolean;
  onSelectionToggle: (id: string, event: React.MouseEvent) => void;
  onCategorize: (id: string, categoryId: string) => void;
  onDelete: (id: string) => void;
  onReconcile: (id: string) => void;
  onUnreconcile: (id: string) => void;
  formatDate: (date: string) => string;
}

export const MemoizedTransactionRow = memo(function MemoizedTransactionRow({
  transaction,
  status,
  accounts,
  isSelectionMode,
  isSelected,
  onSelectionToggle,
  onCategorize,
  onDelete,
  onReconcile,
  onUnreconcile,
  formatDate,
}: MemoizedTransactionRowProps) {
  // Row rendering logic here (moved from BankTransactionRow)
  // NO hooks inside - all actions passed as callbacks
}, (prevProps, nextProps) => {
  // Custom comparison for optimal memoization
  return (
    prevProps.transaction.id === nextProps.transaction.id &&
    prevProps.transaction.is_categorized === nextProps.transaction.is_categorized &&
    prevProps.transaction.category_id === nextProps.transaction.category_id &&
    prevProps.transaction.is_reconciled === nextProps.transaction.is_reconciled &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isSelectionMode === nextProps.isSelectionMode
  );
});
```

### 3.2 Hoist mutations to parent

Move `useCategorizeTransaction`, `useDeleteTransaction`, etc. to `BankTransactionList` and pass stable callbacks down.

### 3.3 Single dialog instance

Render one dialog at list level instead of per-row:

```typescript
// In BankTransactionList
const [activeTransaction, setActiveTransaction] = useState<BankTransaction | null>(null);
const [dialogType, setDialogType] = useState<'detail' | 'split' | 'delete' | null>(null);

// Single dialog instance for the entire list
{activeTransaction && dialogType === 'detail' && (
  <TransactionDetailDialog
    transaction={activeTransaction}
    onClose={() => setDialogType(null)}
  />
)}
```

### Expected Impact

- Per-row render: ~2ms → ~0.3ms
- No hook calls during scroll
- Single dialog instance instead of 1,300+

## Phase 4: Deferred Loading

### 4.1 Skeleton loading state

**New file: `src/components/banking/TransactionListSkeleton.tsx`**

```typescript
export function TransactionListSkeleton() {
  return (
    <div className="space-y-2 p-4">
      {[...Array(8)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 border rounded-lg">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-48 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      ))}
    </div>
  );
}
```

### 4.2 Defer secondary data

Fetch full transaction details only when dialog opens:

```typescript
const { data: fullTransaction } = useQuery({
  queryKey: ['bank-transaction-full', activeTransaction?.id],
  queryFn: () => fetchFullTransactionDetails(activeTransaction!.id),
  enabled: !!activeTransaction && dialogType === 'detail',
});
```

### Expected Impact

- Time to first meaningful paint: ~500ms → ~150ms
- User sees skeleton immediately
- Secondary data loads progressively

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/banking/MemoizedTransactionRow.tsx` | Memoized row component without hooks |
| `src/components/banking/TransactionListSkeleton.tsx` | Skeleton loading state |

## Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useBankTransactions.tsx` | Explicit column select, increase PAGE_SIZE to 500 |
| `src/components/banking/BankTransactionList.tsx` | Add virtualization, hoist mutations, single dialog instance |
| `src/components/banking/BankTransactionRow.tsx` | Remove hooks, accept callbacks as props (or deprecate) |
| `src/pages/Banking.tsx` | Pass stable callbacks to list component |
| `src/pages/Transactions.tsx` | Pass stable callbacks to list component |

## Implementation Order

1. **Phase 1** (Query optimization) — Quick win, no UI changes, low risk
2. **Phase 2** (Virtualization) — Biggest impact, requires row component changes
3. **Phase 3** (Component optimization) — Refinement after virtualization works
4. **Phase 4** (Deferred loading) — Polish for perceived performance

## Testing Plan

- [ ] Verify payload size reduction in Network tab
- [ ] Test with 1,300+ transactions — scrolling should stay smooth
- [ ] Test tab switching between For Review / Categorized / Excluded
- [ ] Verify all row interactions work (categorize, delete, split, reconcile)
- [ ] Test bulk selection with virtualized list
- [ ] Test on mobile (card view should remain unchanged)
- [ ] Measure Total Blocking Time in Lighthouse

## Rollback Plan

Changes can be reverted independently:
- Virtualization can be removed by reverting to `.map()` rendering
- Query changes are isolated to `useBankTransactions.tsx`
- MemoizedTransactionRow can be swapped back to original component
