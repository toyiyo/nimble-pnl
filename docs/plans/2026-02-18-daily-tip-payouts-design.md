# Daily Tip Payouts — Design

## Problem

Managers pay out credit card tips from the cash drawer daily, but payroll runs weekly/bi-weekly. The system tracks tip *allocation* but not tip *disbursement*, so payroll double-counts tips that were already paid as cash.

**Example:** Server earns $60 credit tips + $20 cash tips = $80 total. Manager pays $60 from cash drawer that night. Payroll later shows $80 owed — server effectively gets $140 instead of $80.

## Solution

Track daily tip payouts separately from tip allocations. Payroll deducts already-paid amounts so only the remaining balance appears on the paycheck.

## Data Model

New `tip_payouts` table:

```sql
tip_payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL REFERENCES restaurants(id),
  employee_id     UUID NOT NULL REFERENCES employees(id),
  payout_date     DATE NOT NULL,
  amount          INTEGER NOT NULL,                           -- cents
  tip_split_id    UUID REFERENCES tip_splits(id),             -- optional link
  notes           TEXT,
  paid_by         UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE(restaurant_id, employee_id, payout_date, tip_split_id)
);

-- RLS: restaurant_id isolation
-- Index on (restaurant_id, payout_date)
-- Index on (restaurant_id, employee_id, payout_date)
```

- Amounts in cents (consistent with all tip tables)
- `tip_split_id` is optional — supports payouts without a formal split
- Unique constraint prevents duplicate payouts per employee/date/split

## Tips Page UX — "Record Payout" Flow

**Location:** Existing Tips page, daily entry flow.

**Trigger:** After a tip split is approved, a "Record Payout" button appears on the day card in `TipPeriodTimeline`.

**Flow:**

1. Manager taps "Record Payout" on an approved day
2. Bottom sheet opens showing:
   - Date and total tip amount header
   - Employee list with allocated amounts
   - Editable "Cash Paid" input per employee (defaults to full allocation)
   - "Select All / Deselect All" toggle for bulk payout
3. Manager adjusts amounts if needed
4. "Confirm Payout" writes to `tip_payouts`
5. Day card shows "Paid" badge alongside "Approved" status

**Timeline indicators:**
- Draft (gray) → Approved (blue) → Approved + Paid Out (blue + green check)
- Partially paid shows "Partial" indicator

**Editing:** Manager can tap a paid-out day to view/void individual payout records.

## Payroll Integration

**New per-employee fields:**

```typescript
{
  tipsEarned: number;    // total allocated tips (cents)
  tipsPaidOut: number;   // sum of tip_payouts for the period (cents)
  tipsOwed: number;      // tipsEarned - tipsPaidOut
  totalPay: number;      // grossPay + tipsOwed (not tipsEarned)
}
```

**Payroll table columns:**

| Employee | ... | Tips Earned | Tips Paid | Tips Owed | Total Pay |
|----------|-----|-------------|-----------|-----------|-----------|
| Maria    | ... | $80.00      | $60.00    | $20.00    | $520.00   |

**Calculation change:** `totalPay = grossPay + tipsOwed` (only unpaid tips contribute to paycheck).

**CSV export** includes the three tip columns.

## Edge Cases

1. **Payout > allocation:** Warn but allow (cash tips may exceed the split amount)
2. **No approved split:** "Record Payout" only appears on approved/archived splits
3. **Voiding a payout:** Manager can delete individual records with audit trail
4. **Retroactive changes:** Warning if modifying payouts for an already-exported period
5. **Employee view:** `EmployeeTips` page shows payout status per day

## Files Affected

- New migration: `tip_payouts` table + RLS + indexes
- `src/hooks/usePayroll.tsx` — query `tip_payouts`, compute tipsOwed
- `src/utils/payrollCalculations.ts` — adjust totalPay formula
- `src/utils/tipAggregation.ts` — add payout aggregation
- `src/pages/Payroll.tsx` — three tip columns + updated summary cards
- `src/pages/Tips.tsx` — "Record Payout" button on approved days
- New component: `TipPayoutSheet.tsx` — payout recording bottom sheet
- `src/components/tips/TipPeriodTimeline.tsx` — paid status indicators
- `src/pages/EmployeeTips.tsx` — show payout status
- `src/utils/payrollCalculations.ts` — CSV export update
