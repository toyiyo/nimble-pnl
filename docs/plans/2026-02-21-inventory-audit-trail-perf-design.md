# Inventory Audit Trail: Performance + Design Enhancement

**Date:** 2026-02-21
**Status:** Approved
**Scope:** Performance optimization, default filtering, Apple/Notion design polish, filter UX improvement

## Problem

The Inventory Audit Trail page has three issues:
1. **No default date filter** — fetches up to 500 transactions from all time on page load
2. **No virtualization** — renders all rows with plain `.map()`, causing DOM bloat
3. **Inconsistent styling** — uses gradients and patterns that don't match the Apple/Notion design system

## Constraints

- Functionality must remain identical from the user's perspective
- Follow established virtualization patterns (BankTransactionList, POSSales)
- TDD approach — tests written before implementation
- Keep the 500 transaction fetch limit

## Design

### 1. Default 7-Day Date Filter

- Initialize `startDate` to 7 days ago, `endDate` to today
- `clearFilters` resets to 7-day defaults (not empty strings)
- `activeFiltersCount` excludes the default date range
- Date preset buttons: "7d" (default), "14d", "30d", "MTD"
- Users can still manually set any custom date range

### 2. Virtualization

Following BankTransactionList pattern:

**New file:** `src/components/inventory/MemoizedAuditTransactionRow.tsx`
- `React.memo` with custom comparison
- No hooks — all data as props
- Receives `displayValues` from pre-computed map

**Pre-computed display values** (`useMemo` in parent):
- `formattedQuantity`, `formattedUnitCost`, `formattedTotalCost`
- `formattedDate`
- `isPositiveQuantity`, `isPositiveCost`
- `badgeColor`, `borderColor`
- `conversionBadges` (VOL/WEIGHT/FALLBACK parsed from reason)

**Virtual list config:**
- `estimateSize: () => 120`
- `overscan: 5`
- `measureElement` for dynamic heights
- Container: `h-[600px]` overflow-auto

### 3. Apple/Notion Design Polish

**Page header:** Clean typography, no gradient. `text-[17px] font-semibold` title, `text-[13px] text-muted-foreground` subtitle.

**Filter section:** Inline layout with:
- Search input: `bg-muted/30 border-border/40 rounded-lg`
- Type pills (horizontal buttons, not dropdown)
- Date range with presets + custom inputs
- Sort/export inline
- `text-[12px] uppercase tracking-wider` labels

**Summary stats:** Simplified cards with `rounded-xl border-border/40`. No hover scale, no gradients.

**Transaction rows:** `rounded-xl border border-border/40 bg-background` cards. Consistent typography scale. No alternating backgrounds, no emoji icons in sort dropdown.

### 4. Filter UX Improvements

**Type filter pills** (replace dropdown):
```
[All] [Purchases] [Usage] [Adjustments] [Waste] [Transfers]
```
Active: `bg-foreground text-background`. Inactive: `text-muted-foreground hover:text-foreground`.

**Date presets** alongside date inputs:
```
[7d] [14d] [30d] [MTD]  |  Start: [____]  End: [____]
```

### 5. Testing (TDD)

Unit tests in `tests/unit/`:
1. `inventoryAuditDefaults.test.ts` — default date calculation
2. `inventoryAuditDisplayValues.test.ts` — pre-computed display values map
3. `inventoryAuditFiltering.test.ts` — filter counting, clear behavior

## Files Modified

- `src/pages/InventoryAudit.tsx` — main page (refactored)
- `src/components/inventory/MemoizedAuditTransactionRow.tsx` — new memoized row
- `tests/unit/inventoryAuditDefaults.test.ts` — new
- `tests/unit/inventoryAuditDisplayValues.test.ts` — new
- `tests/unit/inventoryAuditFiltering.test.ts` — new

## Files Not Modified

- `src/hooks/useInventoryTransactions.tsx` — no changes needed (already supports date filtering)
- `src/services/inventoryTransactions.service.ts` — no changes needed
- Database migrations — no changes needed
