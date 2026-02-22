# Inventory Audit Trail Performance + Design Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add default 7-day date filter, virtualize the transaction list, and apply Apple/Notion design system to the Inventory Audit Trail page — preserving all existing functionality.

**Architecture:** Extract pure utility functions for date defaults, display value computation, and filter logic into a testable module. Create a memoized row component following the BankTransactionList pattern. Refactor InventoryAudit.tsx to use virtualization and Apple/Notion styling.

**Tech Stack:** React, TypeScript, @tanstack/react-virtual, date-fns, Vitest

---

### Task 1: Extract Utility Functions + Write Failing Tests for Date Defaults

**Files:**
- Create: `src/lib/inventoryAuditUtils.ts`
- Create: `tests/unit/inventoryAuditDefaults.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/inventoryAuditDefaults.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDefaultStartDate, getDefaultEndDate, isDefaultDateRange } from '@/lib/inventoryAuditUtils';

describe('inventoryAuditDefaults', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getDefaultStartDate', () => {
    it('returns date 7 days ago in yyyy-MM-dd format', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
      expect(getDefaultStartDate()).toBe('2026-02-14');
      vi.useRealTimers();
    });

    it('handles month boundary correctly', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
      expect(getDefaultStartDate()).toBe('2026-02-24');
      vi.useRealTimers();
    });
  });

  describe('getDefaultEndDate', () => {
    it('returns today in yyyy-MM-dd format', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
      expect(getDefaultEndDate()).toBe('2026-02-21');
      vi.useRealTimers();
    });
  });

  describe('isDefaultDateRange', () => {
    it('returns true when dates match 7-day default', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
      expect(isDefaultDateRange('2026-02-14', '2026-02-21')).toBe(true);
      vi.useRealTimers();
    });

    it('returns false when dates differ from default', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
      expect(isDefaultDateRange('2026-02-01', '2026-02-21')).toBe(false);
      vi.useRealTimers();
    });

    it('returns false when dates are empty', () => {
      expect(isDefaultDateRange('', '')).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/inventoryAuditDefaults.test.ts`
Expected: FAIL — module `@/lib/inventoryAuditUtils` does not exist

**Step 3: Write minimal implementation**

Create `src/lib/inventoryAuditUtils.ts`:

```typescript
import { format, subDays, startOfMonth } from 'date-fns';

/**
 * Returns the default start date (7 days ago) in yyyy-MM-dd format.
 */
export function getDefaultStartDate(): string {
  return format(subDays(new Date(), 7), 'yyyy-MM-dd');
}

/**
 * Returns the default end date (today) in yyyy-MM-dd format.
 */
export function getDefaultEndDate(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Returns the start of the current month in yyyy-MM-dd format.
 */
export function getMonthToDateStart(): string {
  return format(startOfMonth(new Date()), 'yyyy-MM-dd');
}

/**
 * Checks whether the given date range matches the default 7-day range.
 */
export function isDefaultDateRange(startDate: string, endDate: string): boolean {
  if (!startDate || !endDate) return false;
  return startDate === getDefaultStartDate() && endDate === getDefaultEndDate();
}

/**
 * Date preset options for the filter UI.
 */
export type DatePreset = '7d' | '14d' | '30d' | 'mtd';

export function getDatePresetRange(preset: DatePreset): { startDate: string; endDate: string } {
  const endDate = format(new Date(), 'yyyy-MM-dd');
  switch (preset) {
    case '7d':
      return { startDate: format(subDays(new Date(), 7), 'yyyy-MM-dd'), endDate };
    case '14d':
      return { startDate: format(subDays(new Date(), 14), 'yyyy-MM-dd'), endDate };
    case '30d':
      return { startDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'), endDate };
    case 'mtd':
      return { startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'), endDate };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/inventoryAuditDefaults.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add src/lib/inventoryAuditUtils.ts tests/unit/inventoryAuditDefaults.test.ts
git commit -m "feat: add inventory audit date default utilities with tests"
```

---

### Task 2: Write Failing Tests + Implementation for Display Value Computation

**Files:**
- Modify: `src/lib/inventoryAuditUtils.ts`
- Create: `tests/unit/inventoryAuditDisplayValues.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/inventoryAuditDisplayValues.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeAuditDisplayValues, type AuditDisplayValues } from '@/lib/inventoryAuditUtils';

const makeTransaction = (overrides: Record<string, any> = {}) => ({
  id: 'txn-1',
  product_name: 'Tomatoes',
  quantity: 10,
  unit_cost: 2.5,
  total_cost: 25,
  transaction_type: 'purchase',
  reason: null as string | null,
  reference_id: null as string | null,
  created_at: '2026-02-21T10:30:00Z',
  transaction_date: null as string | null,
  performed_by: 'user-1',
  ...overrides,
});

describe('computeAuditDisplayValues', () => {
  const timezone = 'America/New_York';

  it('formats positive quantity with + prefix', () => {
    const result = computeAuditDisplayValues(makeTransaction({ quantity: 10 }), timezone);
    expect(result.formattedQuantity).toBe('+10.00');
    expect(result.isPositiveQuantity).toBe(true);
  });

  it('formats negative quantity without + prefix', () => {
    const result = computeAuditDisplayValues(makeTransaction({ quantity: -5.5 }), timezone);
    expect(result.formattedQuantity).toBe('-5.50');
    expect(result.isPositiveQuantity).toBe(false);
  });

  it('formats unit cost as currency', () => {
    const result = computeAuditDisplayValues(makeTransaction({ unit_cost: 2.5 }), timezone);
    expect(result.formattedUnitCost).toBe('$2.50');
  });

  it('formats null unit cost as $0.00', () => {
    const result = computeAuditDisplayValues(makeTransaction({ unit_cost: null }), timezone);
    expect(result.formattedUnitCost).toBe('$0.00');
  });

  it('formats total cost as absolute value', () => {
    const result = computeAuditDisplayValues(makeTransaction({ total_cost: -25 }), timezone);
    expect(result.formattedTotalCost).toBe('$25.00');
    expect(result.isPositiveCost).toBe(false);
  });

  it('returns correct badge color for purchase type', () => {
    const result = computeAuditDisplayValues(makeTransaction({ transaction_type: 'purchase' }), timezone);
    expect(result.badgeColor).toContain('emerald');
  });

  it('returns correct badge color for usage type', () => {
    const result = computeAuditDisplayValues(makeTransaction({ transaction_type: 'usage' }), timezone);
    expect(result.badgeColor).toContain('rose');
  });

  it('returns correct badge color for adjustment type', () => {
    const result = computeAuditDisplayValues(makeTransaction({ transaction_type: 'adjustment' }), timezone);
    expect(result.badgeColor).toContain('blue');
  });

  it('returns correct badge color for waste type', () => {
    const result = computeAuditDisplayValues(makeTransaction({ transaction_type: 'waste' }), timezone);
    expect(result.badgeColor).toContain('amber');
  });

  it('detects VOL conversion badge from reason', () => {
    const result = computeAuditDisplayValues(
      makeTransaction({ reason: 'Deducted 2 units ✓ VOL converted' }),
      timezone
    );
    expect(result.conversionBadges).toContain('volume');
  });

  it('detects WEIGHT conversion badge from reason', () => {
    const result = computeAuditDisplayValues(
      makeTransaction({ reason: 'Deducted 1 unit ✓ WEIGHT converted' }),
      timezone
    );
    expect(result.conversionBadges).toContain('weight');
  });

  it('detects FALLBACK badge from reason', () => {
    const result = computeAuditDisplayValues(
      makeTransaction({ reason: '⚠️ FALLBACK 1:1 ratio used' }),
      timezone
    );
    expect(result.conversionBadges).toContain('fallback');
  });

  it('returns empty conversion badges when reason is null', () => {
    const result = computeAuditDisplayValues(makeTransaction({ reason: null }), timezone);
    expect(result.conversionBadges).toEqual([]);
  });

  it('uses transaction_date when available for formatting', () => {
    const result = computeAuditDisplayValues(
      makeTransaction({ transaction_date: '2026-02-20', created_at: '2026-02-21T10:00:00Z' }),
      timezone
    );
    // transaction_date is a date-only string, formatted without time
    expect(result.formattedDate).toContain('Feb');
    expect(result.formattedDate).toContain('20');
    expect(result.formattedDate).not.toContain(':'); // no time component
  });

  it('uses created_at with time when transaction_date is null', () => {
    const result = computeAuditDisplayValues(
      makeTransaction({ transaction_date: null, created_at: '2026-02-21T10:30:00Z' }),
      timezone
    );
    expect(result.formattedDate).toContain('Feb');
    expect(result.formattedDate).toContain('21');
    expect(result.formattedDate).toContain(':'); // includes time
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/inventoryAuditDisplayValues.test.ts`
Expected: FAIL — `computeAuditDisplayValues` is not exported

**Step 3: Add implementation to `src/lib/inventoryAuditUtils.ts`**

Append to the existing file:

```typescript
import { formatDateInTimezone } from '@/lib/timezone';

// --- Display Value Types & Computation ---

export interface AuditDisplayValues {
  formattedQuantity: string;
  formattedUnitCost: string;
  formattedTotalCost: string;
  formattedDate: string;
  isPositiveQuantity: boolean;
  isPositiveCost: boolean;
  badgeColor: string;
  borderColor: string;
  conversionBadges: ('volume' | 'weight' | 'fallback')[];
}

interface AuditTransaction {
  quantity: number;
  unit_cost: number | null;
  total_cost: number | null;
  transaction_type: string;
  reason: string | null;
  created_at: string;
  transaction_date: string | null;
}

const BADGE_COLORS: Record<string, string> = {
  purchase: 'bg-emerald-100 text-emerald-700',
  usage: 'bg-rose-100 text-rose-700',
  adjustment: 'bg-blue-100 text-blue-700',
  waste: 'bg-amber-100 text-amber-700',
};

const BORDER_COLORS: Record<string, string> = {
  purchase: 'border-l-emerald-500',
  usage: 'border-l-rose-500',
  adjustment: 'border-l-blue-500',
  waste: 'border-l-amber-500',
};

export function computeAuditDisplayValues(
  transaction: AuditTransaction,
  timezone: string
): AuditDisplayValues {
  const qty = transaction.quantity;
  const unitCost = transaction.unit_cost || 0;
  const totalCost = transaction.total_cost || 0;

  // Parse conversion badges from reason text
  const conversionBadges: ('volume' | 'weight' | 'fallback')[] = [];
  if (transaction.reason) {
    if (transaction.reason.includes('✓ VOL')) conversionBadges.push('volume');
    if (transaction.reason.includes('✓ WEIGHT')) conversionBadges.push('weight');
    if (transaction.reason.includes('⚠️ FALLBACK')) conversionBadges.push('fallback');
  }

  // Format date: use transaction_date (date-only, no time) or created_at (with time)
  const dateSource = transaction.transaction_date || transaction.created_at;
  const dateFormat = transaction.transaction_date ? 'MMM dd, yyyy' : 'MMM dd, yyyy HH:mm';
  const formattedDate = formatDateInTimezone(dateSource, timezone, dateFormat);

  return {
    formattedQuantity: `${qty > 0 ? '+' : ''}${Number(qty).toFixed(2)}`,
    formattedUnitCost: `$${unitCost.toFixed(2)}`,
    formattedTotalCost: `$${Math.abs(totalCost).toFixed(2)}`,
    formattedDate,
    isPositiveQuantity: qty > 0,
    isPositiveCost: totalCost >= 0,
    badgeColor: BADGE_COLORS[transaction.transaction_type] || 'bg-gray-100 text-gray-700',
    borderColor: BORDER_COLORS[transaction.transaction_type] || 'border-l-gray-500',
    conversionBadges,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/inventoryAuditDisplayValues.test.ts`
Expected: PASS (all 14 tests)

**Step 5: Commit**

```bash
git add src/lib/inventoryAuditUtils.ts tests/unit/inventoryAuditDisplayValues.test.ts
git commit -m "feat: add audit display value computation with tests"
```

---

### Task 3: Write Failing Tests + Implementation for Filter Counting Logic

**Files:**
- Modify: `src/lib/inventoryAuditUtils.ts`
- Create: `tests/unit/inventoryAuditFiltering.test.ts`

**Step 1: Write the failing test**

Create `tests/unit/inventoryAuditFiltering.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { countActiveFilters, getDatePresetRange, type DatePreset } from '@/lib/inventoryAuditUtils';

describe('countActiveFilters', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 when all filters are at defaults', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    expect(countActiveFilters({
      typeFilter: 'all',
      searchTerm: '',
      startDate: '2026-02-14',
      endDate: '2026-02-21',
    })).toBe(0);
    vi.useRealTimers();
  });

  it('counts type filter when not "all"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    expect(countActiveFilters({
      typeFilter: 'purchase',
      searchTerm: '',
      startDate: '2026-02-14',
      endDate: '2026-02-21',
    })).toBe(1);
    vi.useRealTimers();
  });

  it('counts search term when non-empty', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    expect(countActiveFilters({
      typeFilter: 'all',
      searchTerm: 'tomato',
      startDate: '2026-02-14',
      endDate: '2026-02-21',
    })).toBe(1);
    vi.useRealTimers();
  });

  it('counts non-default date range as 1 filter', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    expect(countActiveFilters({
      typeFilter: 'all',
      searchTerm: '',
      startDate: '2026-02-01',
      endDate: '2026-02-21',
    })).toBe(1);
    vi.useRealTimers();
  });

  it('counts multiple active filters', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    expect(countActiveFilters({
      typeFilter: 'waste',
      searchTerm: 'milk',
      startDate: '2026-01-01',
      endDate: '2026-02-21',
    })).toBe(3);
    vi.useRealTimers();
  });
});

describe('getDatePresetRange', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 7-day range for "7d"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    const range = getDatePresetRange('7d');
    expect(range.startDate).toBe('2026-02-14');
    expect(range.endDate).toBe('2026-02-21');
    vi.useRealTimers();
  });

  it('returns 14-day range for "14d"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    const range = getDatePresetRange('14d');
    expect(range.startDate).toBe('2026-02-07');
    expect(range.endDate).toBe('2026-02-21');
    vi.useRealTimers();
  });

  it('returns 30-day range for "30d"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    const range = getDatePresetRange('30d');
    expect(range.startDate).toBe('2026-01-22');
    expect(range.endDate).toBe('2026-02-21');
    vi.useRealTimers();
  });

  it('returns month-to-date range for "mtd"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    const range = getDatePresetRange('mtd');
    expect(range.startDate).toBe('2026-02-01');
    expect(range.endDate).toBe('2026-02-21');
    vi.useRealTimers();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/inventoryAuditFiltering.test.ts`
Expected: FAIL — `countActiveFilters` is not exported

**Step 3: Add implementation to `src/lib/inventoryAuditUtils.ts`**

Append:

```typescript
// --- Filter Counting ---

interface FilterState {
  typeFilter: string;
  searchTerm: string;
  startDate: string;
  endDate: string;
}

/**
 * Counts the number of active filters that differ from defaults.
 * The default 7-day date range does NOT count as an active filter.
 */
export function countActiveFilters(filters: FilterState): number {
  let count = 0;
  if (filters.typeFilter !== 'all') count++;
  if (filters.searchTerm.trim() !== '') count++;
  if (!isDefaultDateRange(filters.startDate, filters.endDate)) count++;
  return count;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/inventoryAuditFiltering.test.ts`
Expected: PASS (all 9 tests)

**Step 5: Commit**

```bash
git add src/lib/inventoryAuditUtils.ts tests/unit/inventoryAuditFiltering.test.ts
git commit -m "feat: add active filter counting with tests"
```

---

### Task 4: Create the MemoizedAuditTransactionRow Component

**Files:**
- Create: `src/components/inventory/MemoizedAuditTransactionRow.tsx`

**Step 1: Create the memoized row component**

Create `src/components/inventory/MemoizedAuditTransactionRow.tsx`:

```typescript
import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { TrendingDown, TrendingUp, Package, AlertTriangle } from 'lucide-react';
import type { AuditDisplayValues } from '@/lib/inventoryAuditUtils';

export interface AuditTransactionRowData {
  id: string;
  product_name: string;
  quantity: number;
  transaction_type: string;
  reason: string | null;
  reference_id: string | null;
}

export interface MemoizedAuditTransactionRowProps {
  transaction: AuditTransactionRowData;
  displayValues: AuditDisplayValues;
}

const getTransactionIcon = (type: string) => {
  switch (type) {
    case 'purchase': return <TrendingUp className="h-3.5 w-3.5" />;
    case 'usage': return <TrendingDown className="h-3.5 w-3.5" />;
    case 'adjustment': return <Package className="h-3.5 w-3.5" />;
    case 'waste': return <AlertTriangle className="h-3.5 w-3.5" />;
    default: return <Package className="h-3.5 w-3.5" />;
  }
};

export const MemoizedAuditTransactionRow = memo(function MemoizedAuditTransactionRow({
  transaction,
  displayValues,
}: MemoizedAuditTransactionRowProps) {
  const {
    formattedQuantity,
    formattedUnitCost,
    formattedTotalCost,
    formattedDate,
    isPositiveQuantity,
    isPositiveCost,
    badgeColor,
    borderColor,
    conversionBadges,
  } = displayValues;

  return (
    <div
      className={`border-l-4 ${borderColor} p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors`}
      role="listitem"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex-1 space-y-2.5">
          {/* Badge + Product Name */}
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge
              variant="secondary"
              className={`${badgeColor} flex items-center gap-1 px-2 py-0.5 text-[12px]`}
            >
              {getTransactionIcon(transaction.transaction_type)}
              <span className="font-medium capitalize">{transaction.transaction_type}</span>
            </Badge>
            <h3 className="text-[14px] font-medium text-foreground leading-tight">{transaction.product_name}</h3>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-0.5">
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Quantity
              </div>
              <div className={`text-[15px] font-semibold leading-none ${isPositiveQuantity ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formattedQuantity}
              </div>
            </div>

            <div className="space-y-0.5">
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Unit Cost
              </div>
              <div className="text-[15px] font-semibold leading-none text-foreground">
                {formattedUnitCost}
              </div>
            </div>

            <div className="space-y-0.5">
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Total Cost
              </div>
              <div className={`text-[15px] font-semibold leading-none ${isPositiveCost ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formattedTotalCost}
              </div>
            </div>

            <div className="space-y-0.5">
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Date
              </div>
              <div className="text-[13px] font-medium text-foreground leading-tight">
                {formattedDate}
              </div>
            </div>
          </div>

          {/* Reason */}
          {transaction.reason && (
            <div className="pt-1 space-y-1">
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Reason</div>
              <div className="flex flex-wrap items-start gap-2">
                <div className="text-[13px] text-muted-foreground leading-relaxed flex-1 min-w-0">{transaction.reason}</div>
                {conversionBadges.includes('fallback') && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 flex items-center gap-1 shrink-0 text-[11px]">
                    <AlertTriangle className="h-3 w-3" />
                    1:1 Fallback
                  </Badge>
                )}
                {conversionBadges.includes('volume') && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 shrink-0 text-[11px]">
                    Volume
                  </Badge>
                )}
                {conversionBadges.includes('weight') && (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 shrink-0 text-[11px]">
                    Weight
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Reference ID */}
          {transaction.reference_id && (
            <div className="pt-1 space-y-1">
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Reference ID</div>
              <div className="text-[13px] font-mono bg-muted/30 rounded-lg px-2 py-1 break-all max-w-full border border-border/40">
                {transaction.reference_id}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.transaction.id === nextProps.transaction.id &&
    prevProps.displayValues === nextProps.displayValues
  );
});
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -i "MemoizedAuditTransactionRow" || echo "No type errors in new file"`

**Step 3: Commit**

```bash
git add src/components/inventory/MemoizedAuditTransactionRow.tsx
git commit -m "feat: add MemoizedAuditTransactionRow component"
```

---

### Task 5: Refactor InventoryAudit.tsx — Default Dates + Virtualization + Design

This is the main refactoring task. Replace the entire `src/pages/InventoryAudit.tsx` with the updated version.

**Files:**
- Modify: `src/pages/InventoryAudit.tsx`

**Context for the implementing agent:**
- The current file is 651 lines. Read it first.
- Reference files to check: `src/components/banking/BankTransactionList.tsx` (virtualization pattern), `src/components/inventory/MemoizedAuditTransactionRow.tsx` (the new row component from Task 4), `src/lib/inventoryAuditUtils.ts` (utilities from Tasks 1-3).

**Step 1: Rewrite `src/pages/InventoryAudit.tsx`**

Key changes (preserve ALL existing functionality):

1. **Imports**: Add `useRef`, `useCallback` from React. Add `useVirtualizer` from `@tanstack/react-virtual`. Add `subDays` from `date-fns`. Import utilities from `@/lib/inventoryAuditUtils`. Import `MemoizedAuditTransactionRow` from new component. Remove `MetricIcon`, `ClipboardList` (unused), `Select/SelectContent/SelectItem/SelectTrigger/SelectValue` (type filter becomes pills, but keep for sort dropdown).

2. **State initialization**: Change:
   ```typescript
   // OLD:
   const [startDate, setStartDate] = useState('');
   const [endDate, setEndDate] = useState('');

   // NEW:
   const [startDate, setStartDate] = useState(getDefaultStartDate);
   const [endDate, setEndDate] = useState(getDefaultEndDate);
   ```

3. **Active filter count**: Change from inline to use `countActiveFilters()`:
   ```typescript
   const activeFiltersCount = countActiveFilters({ typeFilter, searchTerm, startDate, endDate });
   ```

4. **Clear filters**: Reset to defaults:
   ```typescript
   const clearFilters = () => {
     setSearchTerm('');
     setTypeFilter('all');
     setStartDate(getDefaultStartDate());
     setEndDate(getDefaultEndDate());
     setSortBy('date');
     setSortDirection('desc');
   };
   ```

5. **Active date preset detection**: Add `useMemo` to detect which preset is active:
   ```typescript
   const activeDatePreset = useMemo((): DatePreset | null => {
     for (const preset of ['7d', '14d', '30d', 'mtd'] as DatePreset[]) {
       const range = getDatePresetRange(preset);
       if (range.startDate === startDate && range.endDate === endDate) return preset;
     }
     return null;
   }, [startDate, endDate]);
   ```

6. **Pre-computed display values map**: Add `useMemo`:
   ```typescript
   const displayValuesMap = useMemo(() => {
     const map = new Map<string, AuditDisplayValues>();
     const tz = selectedRestaurant?.restaurant.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
     for (const txn of filteredTransactions) {
       map.set(txn.id, computeAuditDisplayValues(txn, tz));
     }
     return map;
   }, [filteredTransactions, selectedRestaurant?.restaurant.timezone]);
   ```

7. **Virtualizer setup**:
   ```typescript
   const listRef = useRef<HTMLDivElement>(null);
   const virtualizer = useVirtualizer({
     count: filteredTransactions.length,
     getScrollElement: () => listRef.current,
     estimateSize: () => 120,
     overscan: 5,
   });
   ```

8. **Page header**: Replace gradient Card with clean Apple/Notion typography:
   ```tsx
   <div className="mb-6">
     <h1 className="text-[17px] font-semibold text-foreground">Inventory Audit Trail</h1>
     <p className="text-[13px] text-muted-foreground mt-0.5">
       Track all inventory changes including automatic deductions from POS sales, manual adjustments, and purchases.
     </p>
   </div>
   ```

9. **Filter section**: Replace Card-wrapped grid with clean inline filter bar. Type filter becomes horizontal pill buttons. Date range gets preset buttons. Sort keeps the Select dropdown but removes emoji prefixes. Export stays inline.

   **Type filter pills:**
   ```tsx
   <div className="space-y-1.5">
     <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Type</label>
     <div className="flex flex-wrap gap-1.5">
       {TRANSACTION_TYPES.map(type => (
         <button
           key={type.value}
           onClick={() => setTypeFilter(type.value)}
           className={`h-7 px-3 rounded-lg text-[12px] font-medium transition-colors ${
             typeFilter === type.value
               ? 'bg-foreground text-background'
               : 'text-muted-foreground hover:text-foreground bg-muted/30 border border-border/40'
           }`}
           aria-pressed={typeFilter === type.value}
           aria-label={`Filter by ${type.label}`}
         >
           {type.label}
         </button>
       ))}
     </div>
   </div>
   ```

   **Date presets:**
   ```tsx
   <div className="space-y-1.5">
     <label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Date Range</label>
     <div className="flex items-center gap-2">
       <div className="flex gap-1">
         {(['7d', '14d', '30d', 'mtd'] as DatePreset[]).map(preset => (
           <button
             key={preset}
             onClick={() => { const r = getDatePresetRange(preset); setStartDate(r.startDate); setEndDate(r.endDate); }}
             className={`h-7 px-2.5 rounded-lg text-[12px] font-medium transition-colors ${
               activeDatePreset === preset
                 ? 'bg-foreground text-background'
                 : 'text-muted-foreground hover:text-foreground bg-muted/30 border border-border/40'
             }`}
             aria-label={`Show ${preset === 'mtd' ? 'month to date' : preset}`}
           >
             {preset.toUpperCase()}
           </button>
         ))}
       </div>
       <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
         className="h-8 w-[130px] text-[13px] bg-muted/30 border-border/40 rounded-lg" aria-label="Start date" />
       <span className="text-[13px] text-muted-foreground">to</span>
       <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
         className="h-8 w-[130px] text-[13px] bg-muted/30 border-border/40 rounded-lg" aria-label="End date" />
     </div>
   </div>
   ```

10. **Summary stats**: Simplify cards — remove `hover:shadow-lg hover:scale-[1.02]` and gradient backgrounds. Use `rounded-xl border border-border/40 bg-background` with clean typography.

11. **Transaction list**: Replace `.map()` with virtualized list:
    ```tsx
    <div
      ref={listRef}
      className="h-[600px] overflow-auto"
      role="list"
      aria-label="Inventory transactions"
    >
      <div className="sr-only" role="status" aria-live="polite">
        Showing {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''}
      </div>
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const transaction = filteredTransactions[virtualRow.index];
          if (!transaction) return null;
          const dv = displayValuesMap.get(transaction.id);
          if (!dv) return null;

          return (
            <div
              key={transaction.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="px-4 py-1.5"
            >
              <MemoizedAuditTransactionRow
                transaction={transaction}
                displayValues={dv}
              />
            </div>
          );
        })}
      </div>
    </div>
    ```

12. **Remove** the three standalone helper functions (`getTransactionIcon`, `getTransactionColor`, `getTransactionBorderColor`) — they are now in `inventoryAuditUtils.ts` and the row component.

**Step 2: Verify the build**

Run: `npx tsc --noEmit --pretty`
Expected: No new type errors

**Step 3: Run all existing tests to ensure nothing broke**

Run: `npx vitest run tests/unit/inventoryAudit`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/pages/InventoryAudit.tsx
git commit -m "feat: refactor InventoryAudit with virtualization, default filter, Apple/Notion design"
```

---

### Task 6: Run Full Test Suite + Build Verification

**Files:** None (verification only)

**Step 1: Run all unit tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 2: Run production build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 3: Run lint**

Run: `npm run lint 2>&1 | tail -5`
Expected: No new lint errors from our changes

**Step 4: Commit any fixes if needed**

If any test or build issues surface, fix them and commit.

---

### Task 7: Final Review + Cleanup

**Step 1: Review all changes**

Run: `git log --oneline HEAD~6..HEAD` to see all commits in this branch.

Run: `git diff main..HEAD --stat` to see file change summary.

**Step 2: Verify functionality preservation**

Checklist (manual or by reading code):
- [ ] Default date range is 7 days
- [ ] Date presets work (7d, 14d, 30d, MTD)
- [ ] Type filter pills match old dropdown behavior
- [ ] Search still filters by product name, reason, reference ID
- [ ] Sort still works (date, product, quantity, cost, type + direction)
- [ ] Export CSV still works
- [ ] Export PDF still works
- [ ] Summary stats still show and are clickable to filter
- [ ] Clear filters resets to 7-day defaults
- [ ] Empty state still shows when no transactions found
- [ ] Loading skeleton still displays
- [ ] Error state still displays
- [ ] List is now virtualized (h-[600px] container)
- [ ] Apple/Notion design tokens used throughout

**Step 3: Final commit if needed**

If any cleanup is needed, commit with `chore: cleanup inventory audit trail refactor`.
