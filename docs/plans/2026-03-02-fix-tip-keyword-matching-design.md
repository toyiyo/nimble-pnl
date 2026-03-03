# Fix Tip Keyword Matching + Source Breakdown

**Date**: 2026-03-02
**Status**: Approved

## Problem

The dashboard monthly performance tables show incorrect tip totals compared to the POS Sales view and Tip Sharing page. Root cause: 7 locations use substring matching (`.includes('tip')` or SQL `LIKE '%tip%'`) on `account_name`, causing false positives. Account names like "Stipend Liability" or "Participation" get incorrectly classified as tips because they contain the substring "tip".

POS Sales view and Tip Sharing work correctly because they filter by explicit category or use stricter matching. The dashboard hooks and SQL RPCs use loose matching.

## Solution

### Part A: Consistent Tip Keyword Matching (Bug Fix)

Standardize all 7 locations to use word-boundary regex:
- **TypeScript**: `/(^|[^a-z])(?:tip|tips|gratuity)([^a-z]|$)/i` via `hasTipKeyword()`
- **SQL**: `~ '(^|[^a-z])(tip|tips|gratuity)([^a-z]|$)'` on `account_name`
- **Subtype matching**: Tighten from `.includes('tip')` to exact `=== 'tips'` (TS) / `= 'tips'` (SQL)

Locations (4 already changed by user, 3 new):

| # | File | Status |
|---|------|--------|
| 1 | `src/hooks/useMonthlyMetrics.tsx` | Done + tighten subtype |
| 2 | `src/hooks/useRevenueBreakdown.tsx` | Done |
| 3 | `src/hooks/utils/passThroughAdjustments.ts` | Done + tighten subtype |
| 4 | `get_monthly_sales_metrics()` SQL migration | Done + tighten subtype |
| 5 | `supabase/functions/_shared/monthlyMetrics.ts` | New fix |
| 6 | `supabase/functions/_shared/periodMetrics.ts` | New fix |
| 7 | `get_pos_tips_by_date()` SQL migration | New fix |

### Part B: Tip Source Breakdown (Transparency)

Expose tip source breakdown on dashboard surfaces so users understand where tip numbers come from.

**Monthly Breakdown Table** (expanded view):
- Currently shows "Tips Collected: $total"
- Add sub-rows: each `tip_category` (account name + amount), plus "POS Tip Adjustments: $Y" when adjustments exist

**P&L Intelligence Report** (tip card):
- Currently shows "Tips: $total"
- Add sub-text: "From categorized accounts: $X | From POS adjustments: $Y"

### Part C: Testing

- Extend `passThroughAdjustments.test.ts` with edge cases (e.g., "Tip - CREDIT", "Stipend", "Anticipation")
- Add tests for `hasTipKeyword` directly
- Add pgTAP tests for SQL regex in `get_monthly_sales_metrics()` and `get_pos_tips_by_date()`
