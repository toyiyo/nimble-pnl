# Monthly Performance — Single Source of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate drift between the Monthly Performance summary cards, the Revenue Breakdown panel, the Payroll page, and Bank Transactions. Every number on the dashboard is derived from one shared formula. Summary == breakdown by construction.

**Architecture:** PR #484 already shipped `calculateMonthlyPerformance` in `supabase/functions/_shared/monthlyPerformance.ts` — the reducer is correct. The bugs are in the **inputs**: pass-through RPC leaks `void` adjustments into POS Collected; revenue RPC includes a mis-typed discount row; `calculateActualLaborCost` has no `tipsOwed` and clamps OT to calendar-month edges. This plan tightens the RPCs, gives `calculateActualLaborCost` an OT-D wrapper that honors ISO weeks plus tips, and rewires `useMonthlyMetrics` to source revenue from the same RPCs as the breakdown panel and to delegate COGS to `useUnifiedCOGS`.

**Tech Stack:** PostgreSQL (SECURITY DEFINER RPCs, pgTAP), TypeScript, React Query, Vitest, date-fns ISO weeks, integer-cent arithmetic.

**Spec:** `docs/superpowers/specs/2026-05-01-monthly-performance-source-of-truth-design.md`

**Worktree:** `.claude/worktrees/labor-parity-tips` on `fix/monthly-perf-source-of-truth`.

**Validation fixture (Russo's Pizzeria April 2026, restaurant_id `adbd9392-928a-4a46-80d7-f7e453aa1956`):**
- `gross_revenue` = $75,917.82
- `discounts` = $1,477.40 → `net_revenue` = $74,440.42
- `sales_tax` = $5,974.88; `tips` = $10,381.78; `other_liabilities` = $0
- `total_collected_at_pos` = $92,274.48
- `void` (currently leaks into otherLiabilities) = -$3,286.25 → after Migration A, drops out of POS Collected on the breakdown panel
- $5 alcohol-sales row with `item_type='discount', adjustment_type=NULL` → after Migration B, drops out of grossRevenue

---

## File Map

**Database migrations**
- Create `supabase/migrations/20260501130000_filter_pass_through_totals_to_known_types.sql` — limit `get_pass_through_totals` to known adjustment types.
- Create `supabase/migrations/20260501130100_filter_revenue_by_account_to_sales.sql` — add `item_type='sale'` filter to `get_revenue_by_account`.

**pgTAP tests**
- Create `supabase/tests/get_pass_through_totals.sql` — synthetic dataset includes a void row; assert post-fix excludes it.
- Create `supabase/tests/get_revenue_by_account.sql` — synthetic dataset includes a mis-typed discount; assert post-fix excludes it.

**Service layer**
- Modify `src/services/laborCalculations.ts` — add `calculateActualLaborCostForMonth(employees, timePunches, tipsOwedByEmployee, monthStart, monthEnd)` that buckets punches into ISO weeks, calls `calculateEmployeePay` per week, distributes the week's pay across days, and clips by month.
- Test `tests/unit/laborCalculations.calculateActualLaborCostForMonth.test.ts` — OT-D edge cases.

**Hook layer**
- Modify `src/hooks/useMonthlyMetrics.tsx`:
  - Replace `get_monthly_sales_metrics` revenue path with the same RPCs that `useRevenueBreakdown` uses (`get_revenue_by_account` + `get_pass_through_totals`), so summary == breakdown.
  - Fetch `tip_split_items` (joined to `tip_splits`) for the period and pass `tipsOwedByEmployee` into the new labor function.
  - Replace the calendar-month-clamp loop with `calculateActualLaborCostForMonth`.
  - Replace inline COGS branches with a call into `useUnifiedCOGS`.
- Test `tests/unit/useMonthlyMetrics.test.ts` — revenue/POS parity, tipsOwed integration, OT-D smoke (full integration covered by acceptance fixture).

**Acceptance fixture**
- Create `tests/unit/monthlyPerformance.acceptance.test.ts` — Russo's April 2026 fixture: feed snapshotted RPC responses + tip_splits + time_punches into the canonical pipeline, assert each cent.

---

## Task 1: Migration A — Filter `get_pass_through_totals` to known adjustment types

**Files:**
- Create: `supabase/migrations/20260501130000_filter_pass_through_totals_to_known_types.sql`
- Test: `supabase/tests/get_pass_through_totals.sql`

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/get_pass_through_totals.sql`:

```sql
BEGIN;
SELECT plan(4);

-- Set up isolated restaurant + minimal sales rows
INSERT INTO restaurants (id, name, owner_id, created_at, updated_at)
VALUES ('11111111-1111-1111-1111-111111111111',
        'pgtap pass-through restaurant',
        '00000000-0000-0000-0000-000000000000',
        now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO unified_sales (
  id, restaurant_id, sale_date, item_type, total_price,
  adjustment_type, pos_system, external_order_id, created_at
) VALUES
  -- known types (should be returned)
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '2026-04-15', 'adjustment',  100.00, 'tax',             'test', 'o1', now()),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '2026-04-15', 'adjustment',   50.00, 'tip',             'test', 'o1', now()),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '2026-04-15', 'adjustment',   25.00, 'service_charge',  'test', 'o1', now()),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '2026-04-15', 'adjustment',  -10.00, 'discount',        'test', 'o1', now()),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '2026-04-15', 'adjustment',    5.00, 'fee',             'test', 'o1', now()),
  -- unknown types (should be excluded after fix)
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '2026-04-15', 'adjustment', -200.00, 'void',            'test', 'o1', now()),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '2026-04-15', 'adjustment',  -75.00, 'refund',          'test', 'o1', now());

-- 1. void must NOT appear in result
SELECT is(
  (SELECT COUNT(*) FROM get_pass_through_totals('11111111-1111-1111-1111-111111111111'::uuid, '2026-04-01'::date, '2026-04-30'::date) WHERE adjustment_type = 'void'),
  0::bigint,
  'void rows are excluded'
);

-- 2. refund must NOT appear in result
SELECT is(
  (SELECT COUNT(*) FROM get_pass_through_totals('11111111-1111-1111-1111-111111111111'::uuid, '2026-04-01'::date, '2026-04-30'::date) WHERE adjustment_type = 'refund'),
  0::bigint,
  'refund rows are excluded'
);

-- 3. tax sum is correct
SELECT is(
  (SELECT total_amount FROM get_pass_through_totals('11111111-1111-1111-1111-111111111111'::uuid, '2026-04-01'::date, '2026-04-30'::date) WHERE adjustment_type = 'tax'),
  100.00::numeric,
  'tax total is 100.00'
);

-- 4. exactly 5 known types are returned
SELECT is(
  (SELECT COUNT(*) FROM get_pass_through_totals('11111111-1111-1111-1111-111111111111'::uuid, '2026-04-01'::date, '2026-04-30'::date)),
  5::bigint,
  'returns exactly 5 known adjustment types'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run db:reset && npm run test:db -- supabase/tests/get_pass_through_totals.sql`

Expected: FAIL on assertion 1 (`void rows are excluded`) — current implementation returns void/refund.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260501130000_filter_pass_through_totals_to_known_types.sql`:

```sql
-- Tighten get_pass_through_totals to known adjustment types so callers
-- never see 'void' or other unanticipated types leaking into POS Collected
-- via the "unknown bucket" branch in useRevenueBreakdown.
CREATE OR REPLACE FUNCTION public.get_pass_through_totals(
  p_restaurant_id uuid,
  p_date_from date,
  p_date_to date
)
RETURNS TABLE(
  adjustment_type text,
  total_amount numeric,
  transaction_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    us.adjustment_type::TEXT,
    COALESCE(SUM(us.total_price), 0)::DECIMAL AS total_amount,
    COUNT(*)::BIGINT AS transaction_count
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_date_from
    AND us.sale_date <= p_date_to
    AND us.adjustment_type IN ('tax', 'tip', 'service_charge', 'discount', 'fee')
  GROUP BY us.adjustment_type;
END;
$function$;
```

- [ ] **Step 4: Re-run the test to verify it passes**

Run: `npm run db:reset && npm run test:db -- supabase/tests/get_pass_through_totals.sql`

Expected: PASS — 4/4 assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260501130000_filter_pass_through_totals_to_known_types.sql supabase/tests/get_pass_through_totals.sql
git commit -m "fix(monthly-perf): filter get_pass_through_totals to known adjustment types"
```

---

## Task 2: Migration B — Filter `get_revenue_by_account` to `item_type='sale'`

**Files:**
- Create: `supabase/migrations/20260501130100_filter_revenue_by_account_to_sales.sql`
- Test: `supabase/tests/get_revenue_by_account.sql`

- [ ] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/get_revenue_by_account.sql`:

```sql
BEGIN;
SELECT plan(3);

-- Reuse a chart of accounts row that already exists in seed data, or insert one
INSERT INTO restaurants (id, name, owner_id, created_at, updated_at)
VALUES ('22222222-2222-2222-2222-222222222222',
        'pgtap revenue restaurant',
        '00000000-0000-0000-0000-000000000000',
        now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, is_active, created_at, updated_at)
VALUES ('33333333-3333-3333-3333-333333333333',
        '22222222-2222-2222-2222-222222222222',
        '4100', 'Alcohol Sales', 'revenue', 'alcohol_sales', true, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO unified_sales (
  id, restaurant_id, sale_date, item_type, total_price,
  adjustment_type, is_categorized, category_id,
  pos_system, external_order_id, created_at
) VALUES
  -- legitimate sale row (should be returned)
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', '2026-04-15',
   'sale', 100.00, NULL, true, '33333333-3333-3333-3333-333333333333',
   'test', 'o1', now()),
  -- mis-typed discount row carrying a category (should be excluded after fix)
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', '2026-04-15',
   'discount', 5.00, NULL, true, '33333333-3333-3333-3333-333333333333',
   'test', 'o1', now());

-- 1. only sale rows count
SELECT is(
  (SELECT total_amount
     FROM get_revenue_by_account('22222222-2222-2222-2222-222222222222'::uuid, '2026-04-01'::date, '2026-04-30'::date)
    WHERE account_id = '33333333-3333-3333-3333-333333333333'),
  100.00::numeric,
  'alcohol_sales total excludes the mis-typed discount row'
);

-- 2. transaction count is 1, not 2
SELECT is(
  (SELECT transaction_count
     FROM get_revenue_by_account('22222222-2222-2222-2222-222222222222'::uuid, '2026-04-01'::date, '2026-04-30'::date)
    WHERE account_id = '33333333-3333-3333-3333-333333333333'),
  1::bigint,
  'alcohol_sales transaction_count excludes the mis-typed discount row'
);

-- 3. uncategorized branch likewise filters non-sale rows
INSERT INTO unified_sales (
  id, restaurant_id, sale_date, item_type, total_price,
  adjustment_type, is_categorized, category_id,
  pos_system, external_order_id, created_at
) VALUES
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', '2026-04-15',
   'discount', 9.99, NULL, false, NULL, 'test', 'o2', now());

SELECT is(
  (SELECT COALESCE(SUM(total_amount), 0)
     FROM get_revenue_by_account('22222222-2222-2222-2222-222222222222'::uuid, '2026-04-01'::date, '2026-04-30'::date)
    WHERE NOT is_categorized),
  0::numeric,
  'uncategorized branch excludes non-sale rows'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:db -- supabase/tests/get_revenue_by_account.sql`

Expected: FAIL — current RPC returns 105.00 for alcohol_sales (sale + mis-typed discount).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260501130100_filter_revenue_by_account_to_sales.sql`:

```sql
-- Restrict get_revenue_by_account to true sale rows. A small number of rows in
-- production carry item_type IN ('discount','adjustment') with a categorized
-- account_id, which inflates per-account revenue by their total_price.
-- The matching adjustment branch (get_pass_through_totals) is the canonical
-- home for those rows.
CREATE OR REPLACE FUNCTION public.get_revenue_by_account(
  p_restaurant_id uuid,
  p_date_from date,
  p_date_to date
)
RETURNS TABLE(
  account_id uuid,
  account_code text,
  account_name text,
  account_type text,
  account_subtype text,
  total_amount numeric,
  transaction_count bigint,
  is_categorized boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  -- Categorized branch
  SELECT
    coa.id AS account_id,
    coa.account_code::TEXT,
    coa.account_name::TEXT,
    coa.account_type::TEXT,
    coa.account_subtype::TEXT,
    COALESCE(SUM(us.total_price), 0)::DECIMAL AS total_amount,
    COUNT(*)::BIGINT AS transaction_count,
    TRUE AS is_categorized
  FROM unified_sales us
  JOIN chart_of_accounts coa ON coa.id = us.category_id
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_date_from
    AND us.sale_date <= p_date_to
    AND us.adjustment_type IS NULL
    AND us.is_categorized = TRUE
    AND us.category_id IS NOT NULL
    AND us.item_type = 'sale'
  GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_type, coa.account_subtype

  UNION ALL

  -- Uncategorized branch
  SELECT
    NULL::uuid AS account_id,
    NULL::TEXT AS account_code,
    'Uncategorized'::TEXT AS account_name,
    'revenue'::TEXT AS account_type,
    NULL::TEXT AS account_subtype,
    COALESCE(SUM(us.total_price), 0)::DECIMAL AS total_amount,
    COUNT(*)::BIGINT AS transaction_count,
    FALSE AS is_categorized
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.sale_date >= p_date_from
    AND us.sale_date <= p_date_to
    AND us.adjustment_type IS NULL
    AND us.is_categorized = FALSE
    AND us.item_type = 'sale';
END;
$function$;
```

> **Note:** if the existing function shape on disk differs (e.g. a single branch instead of UNION ALL), **read** `supabase/migrations/` for the most recent `get_revenue_by_account` definition first and patch by adding `AND us.item_type = 'sale'` to each branch's WHERE clause without rewriting unrelated logic.

- [ ] **Step 4: Re-run the test to verify it passes**

Run: `npm run db:reset && npm run test:db -- supabase/tests/get_revenue_by_account.sql`

Expected: PASS — 3/3 assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260501130100_filter_revenue_by_account_to_sales.sql supabase/tests/get_revenue_by_account.sql
git commit -m "fix(monthly-perf): filter get_revenue_by_account to item_type='sale'"
```

---

## Task 3: Add `calculateActualLaborCostForMonth` with `tipsOwed`

**Goal:** A wrapper around `calculateEmployeePay` that buckets time punches by ISO week (so OT bands are computed on full weeks the same way Payroll does), distributes per-week pay across the days actually worked, clips to the month, and adds `tipsOwed` per employee per `tip_splits.split_date` calendar month.

**Files:**
- Modify: `src/services/laborCalculations.ts`
- Test: Create `tests/unit/laborCalculations.calculateActualLaborCostForMonth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/laborCalculations.calculateActualLaborCostForMonth.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { calculateActualLaborCostForMonth } from '@/services/laborCalculations';
import type { Employee } from '@/types/employee';
import type { TimePunch } from '@/types/timeTracking';

const employee: Employee = {
  id: 'e1',
  restaurant_id: 'r1',
  name: 'Test Employee',
  compensation_type: 'hourly',
  hourly_rate: 2000, // $20.00/hr in cents
  is_exempt: false,
  is_active: true,
} as Employee;

function punch(employeeId: string, time: string, type: 'clock_in' | 'clock_out'): TimePunch {
  return {
    id: `${employeeId}-${time}-${type}`,
    employee_id: employeeId,
    restaurant_id: 'r1',
    punch_type: type,
    punch_time: new Date(time).toISOString(),
  } as TimePunch;
}

describe('calculateActualLaborCostForMonth', () => {
  it('adds tipsOwed to actualLaborCents per employee', () => {
    const monthStart = new Date('2026-04-01T00:00:00');
    const monthEnd = new Date('2026-04-30T23:59:59');

    const punches: TimePunch[] = [
      punch('e1', '2026-04-15T09:00:00', 'clock_in'),
      punch('e1', '2026-04-15T17:00:00', 'clock_out'),
    ]; // 8 hours @ $20 = $160

    const tipsOwedByEmployee = new Map<string, number>([
      ['e1', 5000], // $50.00 in cents
    ]);

    const result = calculateActualLaborCostForMonth({
      employees: [employee],
      timePunches: punches,
      tipsOwedByEmployee,
      monthStart,
      monthEnd,
    });

    expect(result.tipsOwedCents).toBe(5000);
    expect(result.wagesCents).toBe(16000); // 8h * $20
    expect(result.actualLaborCents).toBe(21000); // wages + tips
  });

  it('applies OT to a full ISO week even when the week straddles month boundary (Apr 27 – May 3)', () => {
    // ISO week: Mon Apr 27 – Sun May 3, 2026
    // Punch 6h/day Mon-Fri (30h) and 12h Sat May 2 → 42h week → 2h weekly OT
    const punches: TimePunch[] = [
      punch('e1', '2026-04-27T09:00:00', 'clock_in'),
      punch('e1', '2026-04-27T15:00:00', 'clock_out'),
      punch('e1', '2026-04-28T09:00:00', 'clock_in'),
      punch('e1', '2026-04-28T15:00:00', 'clock_out'),
      punch('e1', '2026-04-29T09:00:00', 'clock_in'),
      punch('e1', '2026-04-29T15:00:00', 'clock_out'),
      punch('e1', '2026-04-30T09:00:00', 'clock_in'),
      punch('e1', '2026-04-30T15:00:00', 'clock_out'),
      punch('e1', '2026-05-01T09:00:00', 'clock_in'),
      punch('e1', '2026-05-01T15:00:00', 'clock_out'),
      punch('e1', '2026-05-02T09:00:00', 'clock_in'),
      punch('e1', '2026-05-02T21:00:00', 'clock_out'), // 12h
    ];

    // April-only call should attribute Apr 27-30 (24h) of the week
    const aprilResult = calculateActualLaborCostForMonth({
      employees: [employee],
      timePunches: punches,
      tipsOwedByEmployee: new Map(),
      monthStart: new Date('2026-04-01T00:00:00'),
      monthEnd: new Date('2026-04-30T23:59:59'),
    });

    // Total week pay: 40h reg ($800) + 2h OT ($60) = $860 = 86,000c
    // April share: 24h / 42h * 86,000 = 49,142.86c → distributed by per-day hours
    // We accept rounding within ±1 cent per day; assert total in [49,140, 49,145]
    expect(aprilResult.wagesCents).toBeGreaterThanOrEqual(49_140);
    expect(aprilResult.wagesCents).toBeLessThanOrEqual(49_145);

    // May-only call should attribute May 1-3 (18h)
    const mayResult = calculateActualLaborCostForMonth({
      employees: [employee],
      timePunches: punches,
      tipsOwedByEmployee: new Map(),
      monthStart: new Date('2026-05-01T00:00:00'),
      monthEnd: new Date('2026-05-31T23:59:59'),
    });

    expect(mayResult.wagesCents).toBeGreaterThanOrEqual(36_855);
    expect(mayResult.wagesCents).toBeLessThanOrEqual(36_860);

    // April + May should sum to (or differ by ≤2c from) the full $860
    expect(aprilResult.wagesCents + mayResult.wagesCents).toBeGreaterThanOrEqual(85_998);
    expect(aprilResult.wagesCents + mayResult.wagesCents).toBeLessThanOrEqual(86_002);
  });

  it('handles salaried employees by prorating across days in the month with no OT', () => {
    const salaried: Employee = {
      ...employee,
      id: 'e2',
      compensation_type: 'salary',
      annual_salary: 5_200_000, // $52,000/yr in cents
    } as Employee;

    const result = calculateActualLaborCostForMonth({
      employees: [salaried],
      timePunches: [],
      tipsOwedByEmployee: new Map(),
      monthStart: new Date('2026-04-01T00:00:00'),
      monthEnd: new Date('2026-04-30T23:59:59'),
    });

    // April has 30 days. Annual / 12 = $4,333.33/mo. Allow ±$1.
    expect(result.wagesCents).toBeGreaterThanOrEqual(433_000);
    expect(result.wagesCents).toBeLessThanOrEqual(434_000);
  });

  it('returns zeros for an empty month', () => {
    const result = calculateActualLaborCostForMonth({
      employees: [employee],
      timePunches: [],
      tipsOwedByEmployee: new Map(),
      monthStart: new Date('2026-04-01T00:00:00'),
      monthEnd: new Date('2026-04-30T23:59:59'),
    });
    expect(result.wagesCents).toBe(0);
    expect(result.tipsOwedCents).toBe(0);
    expect(result.actualLaborCents).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/laborCalculations.calculateActualLaborCostForMonth.test.ts`

Expected: FAIL — `calculateActualLaborCostForMonth` is not exported.

- [ ] **Step 3: Write the implementation**

Edit `src/services/laborCalculations.ts`. Add this function near the bottom (after `calculateActualLaborCost`):

```typescript
import { calculateEmployeePay, WEEK_STARTS_ON } from '@/utils/payrollCalculations';
import { startOfWeek, endOfWeek, eachDayOfInterval, format } from 'date-fns';

export interface MonthlyLaborInput {
  employees: Employee[];
  timePunches: TimePunch[];
  /** Per-employee tipsOwed (integer cents) for the calendar month. */
  tipsOwedByEmployee: Map<string, number>;
  monthStart: Date;
  monthEnd: Date;
}

export interface MonthlyLaborResult {
  /** Wages portion (regular + OT + double-time + salary + contractor + daily-rate), integer cents. */
  wagesCents: number;
  /** Tips that the restaurant owes to employees in this month, integer cents. */
  tipsOwedCents: number;
  /** wages + tipsOwed, integer cents. */
  actualLaborCents: number;
}

/**
 * Compute actual labor cost for a calendar month using ISO-week OT banding.
 *
 * Algorithm (OT-D Hybrid):
 *   1. Bucket punches by ISO week (startOfWeek using WEEK_STARTS_ON).
 *   2. For each (employee, ISO week), call calculateEmployeePay over the FULL
 *      week — this yields the same OT semantics the Payroll page uses.
 *   3. Distribute the week's pay across the days the employee actually worked
 *      in proportion to per-day hours. Last day takes the rounding remainder
 *      so the daily sum equals the weekly total to the cent.
 *   4. Sum only the days that fall inside [monthStart, monthEnd].
 *   5. Add tipsOwedByEmployee on top.
 *
 * For salaried/contractor/daily_rate employees the function calls
 * calculateEmployeePay over the calendar-month window directly (no OT to band).
 */
export function calculateActualLaborCostForMonth(
  input: MonthlyLaborInput
): MonthlyLaborResult {
  const { employees, timePunches, tipsOwedByEmployee, monthStart, monthEnd } = input;

  let wagesCents = 0;

  for (const employee of employees) {
    const employeePunches = timePunches.filter((p) => p.employee_id === employee.id);
    const compType = employee.compensation_type ?? 'hourly';

    if (compType !== 'hourly') {
      // No OT to band — call calculateEmployeePay over the calendar-month window.
      const pay = calculateEmployeePay(
        employee,
        employeePunches,
        0,
        monthStart,
        monthEnd
      );
      wagesCents +=
        pay.regularPay + pay.overtimePay + pay.doubleTimePay +
        (pay.salaryPay ?? 0) + (pay.contractorPay ?? 0) + (pay.dailyRatePay ?? 0);
      continue;
    }

    // Hourly: bucket punches by ISO week.
    const punchesByWeek = new Map<string, TimePunch[]>();
    for (const p of employeePunches) {
      const punchDate = new Date(p.punch_time);
      const weekStart = startOfWeek(punchDate, { weekStartsOn: WEEK_STARTS_ON });
      const weekKey = format(weekStart, 'yyyy-MM-dd');
      const arr = punchesByWeek.get(weekKey) ?? [];
      arr.push(p);
      punchesByWeek.set(weekKey, arr);
    }

    for (const [weekKey, weekPunches] of punchesByWeek) {
      const weekStart = new Date(weekKey + 'T12:00:00');
      const weekEnd = endOfWeek(weekStart, { weekStartsOn: WEEK_STARTS_ON });

      const pay = calculateEmployeePay(
        employee,
        weekPunches,
        0,
        weekStart,
        weekEnd
      );
      const weekTotalCents = pay.regularPay + pay.overtimePay + pay.doubleTimePay;
      if (weekTotalCents <= 0) continue;

      // Compute per-day hours for the week (work days only).
      const hoursByDate = new Map<string, number>();
      for (const p of weekPunches) {
        const dateKey = format(new Date(p.punch_time), 'yyyy-MM-dd');
        hoursByDate.set(dateKey, hoursByDate.get(dateKey) ?? 0);
      }
      // We need actual hours, not just presence. Recompute from periods.
      // Reuse parseWorkPeriods to stay consistent with the rest of this file.
      const { periods } = parseWorkPeriods(weekPunches);
      const realHoursByDate = new Map<string, number>();
      for (const period of periods) {
        if (period.isBreak) continue;
        const dateKey = formatDateUTC(new Date(period.startTime));
        realHoursByDate.set(
          dateKey,
          (realHoursByDate.get(dateKey) ?? 0) + period.hours
        );
      }

      const totalHours = Array.from(realHoursByDate.values()).reduce((a, b) => a + b, 0);
      if (totalHours <= 0) continue;

      // Distribute pay across days proportional to hours; last day takes the remainder.
      const dateKeys = Array.from(realHoursByDate.keys()).sort();
      let distributed = 0;
      for (let i = 0; i < dateKeys.length; i++) {
        const dateKey = dateKeys[i];
        const hours = realHoursByDate.get(dateKey)!;
        const isLast = i === dateKeys.length - 1;
        const dayCents = isLast
          ? weekTotalCents - distributed
          : Math.round((weekTotalCents * hours) / totalHours);
        distributed += dayCents;

        // Only count this day if it falls within the calendar-month window.
        const dayDate = new Date(dateKey + 'T12:00:00');
        if (dayDate >= monthStart && dayDate <= monthEnd) {
          wagesCents += dayCents;
        }
      }
    }
  }

  // tipsOwed: sum across employees, attributed to whatever calendar month
  // the tip_splits.split_date falls into. The caller filtered to this month.
  let tipsOwedCents = 0;
  tipsOwedByEmployee.forEach((cents) => {
    tipsOwedCents += cents;
  });

  return {
    wagesCents,
    tipsOwedCents,
    actualLaborCents: wagesCents + tipsOwedCents,
  };
}
```

> **Note:** `calculateEmployeePay` returns pay fields in cents per the existing implementation in `src/utils/payrollCalculations.ts:400-510`. If `salaryPay`, `contractorPay`, `dailyRatePay` are not optional in the actual return type, drop the `?? 0` fallbacks. Read the type from `payrollCalculations.ts` before writing this file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- tests/unit/laborCalculations.calculateActualLaborCostForMonth.test.ts`

Expected: PASS — 4/4 tests.

- [ ] **Step 5: Run lint and typecheck**

Run: `npm run lint && npm run typecheck`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/services/laborCalculations.ts tests/unit/laborCalculations.calculateActualLaborCostForMonth.test.ts
git commit -m "feat(labor): add calculateActualLaborCostForMonth with ISO-week OT banding and tipsOwed"
```

---

## Task 4: Wire `calculateActualLaborCostForMonth` into `useMonthlyMetrics`

**Files:**
- Modify: `src/hooks/useMonthlyMetrics.tsx` (the per-month loop around line 593)

- [ ] **Step 1: Add tip_splits fetch**

Locate the existing data fetch block in `src/hooks/useMonthlyMetrics.tsx` (where `manualPaymentsData`, `typedPunches`, `typedEmployees` are loaded — search for `manualPaymentsData`). Add a sibling query for tip_split_items joined to tip_splits:

```typescript
// Tip splits within the query window (joined parent for restaurant_id + split_date)
const { data: tipSplitItems } = await supabase
  .from('tip_split_items')
  .select('amount, employee_id, tip_splits!inner(restaurant_id, split_date)')
  .eq('tip_splits.restaurant_id', restaurantId)
  .gte('tip_splits.split_date', fromStr)
  .lte('tip_splits.split_date', toStr);

type TipSplitRow = {
  amount: number;
  employee_id: string;
  tip_splits: { restaurant_id: string; split_date: string };
};
const typedTipSplits = (tipSplitItems ?? []) as TipSplitRow[];
```

- [ ] **Step 2: Replace the per-month labor loop**

Replace `useMonthlyMetrics.tsx:593-617` (and the immediately following labor-aggregation lines that currently sum `monthLaborCosts` and `monthPerJobPayments`) with:

```typescript
const monthsInRange = eachMonthOfInterval({ start: dateFrom, end: dateTo });

for (const rawMonthStart of monthsInRange) {
  const monthStart = startOfMonth(rawMonthStart);
  const monthEndFull = endOfMonth(monthStart);
  const monthKey = format(monthStart, 'yyyy-MM');

  // Clamp to the overall query window (first/last month can be partial).
  const clampedStart = monthStart < dateFrom ? dateFrom : monthStart;
  const clampedEnd = monthEndFull > dateTo ? dateTo : monthEndFull;
  if (clampedStart > clampedEnd) continue;

  // Build per-employee tipsOwed for *this* month from typedTipSplits.
  const tipsOwedByEmployee = new Map<string, number>();
  for (const row of typedTipSplits) {
    const splitDate = new Date(row.tip_splits.split_date + 'T12:00:00');
    if (splitDate < clampedStart || splitDate > clampedEnd) continue;
    tipsOwedByEmployee.set(
      row.employee_id,
      (tipsOwedByEmployee.get(row.employee_id) ?? 0) + (row.amount ?? 0)
    );
  }

  // OT-D labor for this month (ISO-week banding + tipsOwed).
  const { actualLaborCents } = calculateActualLaborCostForMonth({
    employees: typedEmployees as any,
    timePunches: typedPunches,
    tipsOwedByEmployee,
    monthStart: clampedStart,
    monthEnd: clampedEnd,
  });

  // Per-job manual payments for this month window.
  let monthPerJobCents = 0;
  (manualPaymentsData ?? []).forEach(
    (payment: { date: string; allocated_cost: number }) => {
      const paymentDate = new Date(payment.date);
      if (paymentDate >= clampedStart && paymentDate <= clampedEnd) {
        monthPerJobCents += payment.allocated_cost; // already in cents
      }
    }
  );

  const month = ensureMonth(monthKey);
  // pending_labor_cost (legacy name): everything time-punch-derived not yet
  // posted to the bank ledger. Keep cents internal; existing downstream code
  // reads this as cents and divides at display time.
  month.pending_labor_cost += actualLaborCents + monthPerJobCents;
}
```

Update the import at the top:

```typescript
import { calculateActualLaborCostForMonth } from '@/services/laborCalculations';
```

- [ ] **Step 3: Run the unit test suite for the hook**

Run: `npm run test -- src/hooks/useMonthlyMetrics`

Expected: any existing tests still pass; new behavior covered by the acceptance fixture in Task 8.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMonthlyMetrics.tsx
git commit -m "fix(monthly-perf): use ISO-week OT banding + tipsOwed in monthly labor"
```

---

## Task 5: Source revenue/POS from breakdown RPCs in `useMonthlyMetrics`

**Goal:** Replace the `get_monthly_sales_metrics` path with the same RPC pair (`get_revenue_by_account` + `get_pass_through_totals`) that `useRevenueBreakdown` consumes. After this, summary == breakdown by construction.

**Files:**
- Modify: `src/hooks/useMonthlyMetrics.tsx`
- Test: Create `tests/unit/useMonthlyMetrics.revenueParity.test.ts`

- [ ] **Step 1: Write the failing parity test**

Create `tests/unit/useMonthlyMetrics.revenueParity.test.ts`. This test imports a small helper (`fetchMonthRevenueTotals`) that we'll extract in step 3, feeds it mock RPC responses, and asserts the totals match the `useRevenueBreakdown` shape.

```typescript
import { describe, it, expect, vi } from 'vitest';
import { fetchMonthRevenueTotals } from '@/hooks/useMonthlyMetrics';

describe('fetchMonthRevenueTotals', () => {
  it('returns gross = categorized + uncategorized, net = gross − discounts, POS = gross + tax + tips + otherLiabilities', async () => {
    const supabaseMock = {
      rpc: vi.fn((name: string) => {
        if (name === 'get_revenue_by_account') {
          return Promise.resolve({
            data: [
              { account_id: 'a1', account_code: '4000', account_name: 'Food',    account_type: 'revenue', account_subtype: 'food_sales',     total_amount: 5000, transaction_count: 10, is_categorized: true },
              { account_id: null, account_code: null, account_name: 'Uncategorized', account_type: 'revenue', account_subtype: null,             total_amount: 1000, transaction_count: 3,  is_categorized: false },
            ],
            error: null,
          });
        }
        if (name === 'get_pass_through_totals') {
          return Promise.resolve({
            data: [
              { adjustment_type: 'tax',            total_amount: 300,  transaction_count: 5 },
              { adjustment_type: 'tip',            total_amount: 200,  transaction_count: 5 },
              { adjustment_type: 'service_charge', total_amount: 50,   transaction_count: 1 },
              { adjustment_type: 'discount',       total_amount: -100, transaction_count: 2 },
              { adjustment_type: 'fee',            total_amount: 25,   transaction_count: 1 },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      }),
    };

    const result = await fetchMonthRevenueTotals(
      supabaseMock as any,
      'r1',
      '2026-04-01',
      '2026-04-30'
    );

    expect(result.grossRevenueCents).toBe(600_000); // (5000 + 1000) dollars * 100
    expect(result.discountsCents).toBe(10_000);     // |−100| dollars * 100
    expect(result.netRevenueCents).toBe(590_000);   // gross − discounts
    expect(result.salesTaxCents).toBe(30_000);
    expect(result.tipsCents).toBe(20_000);
    // service_charge + fee → otherLiabilities
    expect(result.otherLiabilitiesCents).toBe(7_500);
    expect(result.posCollectedCents).toBe(657_500); // gross + tax + tips + otherL
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- tests/unit/useMonthlyMetrics.revenueParity.test.ts`

Expected: FAIL — `fetchMonthRevenueTotals` is not exported.

- [ ] **Step 3: Extract and export `fetchMonthRevenueTotals`**

Add this helper to `src/hooks/useMonthlyMetrics.tsx` near the top (after imports, before the hook):

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

const PASS_THROUGH_OTHER_LIABILITY_TYPES = new Set(['service_charge', 'fee']);

export interface MonthRevenueTotals {
  grossRevenueCents: number;
  discountsCents: number;
  netRevenueCents: number;
  salesTaxCents: number;
  tipsCents: number;
  otherLiabilitiesCents: number;
  posCollectedCents: number;
}

const toC = (n: number): number =>
  Number.isFinite(n) ? Math.sign(n) * Math.round(Math.abs(n) * 100) : 0;

/**
 * Pull revenue + pass-through totals for the period from the same RPCs that
 * useRevenueBreakdown uses, so the summary cards equal the breakdown panel
 * by construction.
 *
 * Inputs are dollars (numeric). All math is in integer cents.
 */
export async function fetchMonthRevenueTotals(
  client: SupabaseClient,
  restaurantId: string,
  fromStr: string,
  toStr: string
): Promise<MonthRevenueTotals> {
  const [{ data: revRows, error: revErr }, { data: passRows, error: passErr }] = await Promise.all([
    client.rpc('get_revenue_by_account', {
      p_restaurant_id: restaurantId,
      p_date_from: fromStr,
      p_date_to: toStr,
    }),
    client.rpc('get_pass_through_totals', {
      p_restaurant_id: restaurantId,
      p_date_from: fromStr,
      p_date_to: toStr,
    }),
  ]);

  if (revErr) throw revErr;
  if (passErr) throw passErr;

  let categorizedCents = 0;
  let uncategorizedCents = 0;
  for (const r of revRows ?? []) {
    if (r.is_categorized) categorizedCents += toC(Number(r.total_amount ?? 0));
    else uncategorizedCents += toC(Number(r.total_amount ?? 0));
  }
  const grossRevenueCents = categorizedCents + uncategorizedCents;

  let salesTaxCents = 0;
  let tipsCents = 0;
  let otherLiabilitiesCents = 0;
  let discountsCents = 0;
  for (const p of passRows ?? []) {
    const amt = toC(Number(p.total_amount ?? 0));
    if (p.adjustment_type === 'tax') salesTaxCents += amt;
    else if (p.adjustment_type === 'tip') tipsCents += amt;
    else if (p.adjustment_type === 'discount') discountsCents += Math.abs(amt);
    else if (PASS_THROUGH_OTHER_LIABILITY_TYPES.has(p.adjustment_type)) {
      otherLiabilitiesCents += amt;
    }
    // unknown types: ignored; Migration A guarantees there are none.
  }

  const netRevenueCents = grossRevenueCents - discountsCents;
  const posCollectedCents =
    grossRevenueCents + salesTaxCents + tipsCents + otherLiabilitiesCents;

  return {
    grossRevenueCents,
    discountsCents,
    netRevenueCents,
    salesTaxCents,
    tipsCents,
    otherLiabilitiesCents,
    posCollectedCents,
  };
}
```

- [ ] **Step 4: Replace the `get_monthly_sales_metrics` block in the hook**

Inside the hook, find the `get_monthly_sales_metrics` RPC call (around line 89-95) and the loop that fills `monthlyMap` from `rpcMetrics`. Replace it with a per-month call to `fetchMonthRevenueTotals` keyed on the month's `[clampedStart, clampedEnd]`. Concretely:

```typescript
// Group months in range and call the breakdown RPCs once per month.
const monthsInRange = eachMonthOfInterval({ start: dateFrom, end: dateTo });
for (const rawMonthStart of monthsInRange) {
  const monthStart = startOfMonth(rawMonthStart);
  const monthEndFull = endOfMonth(monthStart);
  const clampedStart = monthStart < dateFrom ? dateFrom : monthStart;
  const clampedEnd = monthEndFull > dateTo ? dateTo : monthEndFull;
  if (clampedStart > clampedEnd) continue;

  const monthKey = format(monthStart, 'yyyy-MM');
  const totals = await fetchMonthRevenueTotals(
    supabase,
    restaurantId,
    format(clampedStart, 'yyyy-MM-dd'),
    format(clampedEnd, 'yyyy-MM-dd')
  );

  const month = ensureMonth(monthKey);
  month.gross_revenue          = totals.grossRevenueCents;
  month.discounts              = totals.discountsCents;
  month.net_revenue            = totals.netRevenueCents;
  month.sales_tax              = totals.salesTaxCents;
  month.tips                   = totals.tipsCents;
  month.other_liabilities      = totals.otherLiabilitiesCents;
  month.total_collected_at_pos = totals.posCollectedCents;
}
```

> **Note:** the existing `monthlyMap` value type stores fields in cents (per the `// in cents` comment at line 100). Keep the same convention. The labor and per-month loops from Task 4 share this same iteration shape — fold them together so we only call `eachMonthOfInterval` once.

Remove the now-unused branches:
- The `get_monthly_sales_metrics` RPC call and `rpcMetrics` handling.
- Any `normalizeAdjustmentsWithPassThrough` / `splitPassThroughSales` invocation that was building gross/net from the deprecated RPC.

Keep `classifyAdjustmentIntoMonth`/`AdjustmentInput` exports if any consumer outside this file imports them (search before deleting).

- [ ] **Step 5: Run the failing test**

Run: `npm run test -- tests/unit/useMonthlyMetrics.revenueParity.test.ts`

Expected: PASS.

- [ ] **Step 6: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useMonthlyMetrics.tsx tests/unit/useMonthlyMetrics.revenueParity.test.ts
git commit -m "fix(monthly-perf): source revenue/POS from breakdown RPCs (summary == breakdown)"
```

---

## Task 6: Replace inline COGS in `useMonthlyMetrics` with `useUnifiedCOGS`

**Files:**
- Modify: `src/hooks/useMonthlyMetrics.tsx`

- [ ] **Step 1: Read `useUnifiedCOGS` to confirm the per-month shape it returns**

Run: `grep -n "export" src/hooks/useUnifiedCOGS.tsx`

Confirm the hook returns either a per-month map or a function that yields per-month cents for `[restaurantId, dateFrom, dateTo]`. If it only returns a single aggregate, factor out the underlying pure helpers (`useFoodCosts`, `useCOGSFromFinancials`) into a single shared utility we can call per month — but **only** if needed; do not refactor `useUnifiedCOGS` itself in this PR.

- [ ] **Step 2: Wire `useUnifiedCOGS` into `useMonthlyMetrics`**

At the top of the hook function:

```typescript
const cogs = useUnifiedCOGS(restaurantId, dateFrom, dateTo);
```

Then inside the `monthsInRange` loop, look up `cogs` for the month's window. If the existing API doesn't yield per-month, call the underlying inventory and financial COGS hooks per month (read the existing file first to choose the smaller change). Either way, the inline `inventoryCOGSByMonth` and `financialCOGSByMonth` reduction logic in lines ~333-381 and ~571-587 disappears.

> **Note:** if `useUnifiedCOGS` is itself a hook that internally fires React Query, it can't be called inside the `queryFn` of `useMonthlyMetrics`. In that case keep the inline COGS computation but extract the branches into `src/services/cogsCalculations.ts` as a pure function and have **both** hooks call the pure function. The acceptance fixture (Task 8) is what actually pins the math, so the only requirement here is "inline duplication is gone."

- [ ] **Step 3: Run the existing test suite to confirm no regression**

Run: `npm run test -- src/hooks`

Expected: existing tests pass.

- [ ] **Step 4: Run typecheck and lint**

Run: `npm run typecheck && npm run lint`

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useMonthlyMetrics.tsx src/services/cogsCalculations.ts
git commit -m "refactor(monthly-perf): replace inline COGS with shared cogsCalculations helper"
```

---

## Task 7: Drop `void` from `useRevenueBreakdown` "unknown bucket"

**Background:** `useRevenueBreakdown.tsx:147-149` silently sums any unknown adjustment_type into `adjustmentOtherC`, which then leaks into POS Collected on the breakdown panel. After Migration A the RPC stops returning `void`, but this client-side fallback should also be tightened to **only** known liability types so that future RPC changes don't reintroduce the bug.

**Files:**
- Modify: `src/hooks/useRevenueBreakdown.tsx`
- Test: `tests/unit/useRevenueBreakdown.test.tsx` (extend if it exists; otherwise create `tests/unit/useRevenueBreakdown.passThrough.test.ts`)

- [ ] **Step 1: Read the current implementation**

Run: `grep -n "adjustmentOtherC\|knownTypes\|void" src/hooks/useRevenueBreakdown.tsx`

- [ ] **Step 2: Write a regression test**

Create `tests/unit/useRevenueBreakdown.passThrough.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { reduceRevenueBreakdownPassThrough } from '@/hooks/useRevenueBreakdown';

describe('reduceRevenueBreakdownPassThrough', () => {
  it('ignores unknown adjustment types instead of bucketing them as otherLiabilities', () => {
    const result = reduceRevenueBreakdownPassThrough([
      { adjustment_type: 'tax',            total_amount: 100, transaction_count: 1 },
      { adjustment_type: 'tip',            total_amount: 50,  transaction_count: 1 },
      { adjustment_type: 'service_charge', total_amount: 25,  transaction_count: 1 },
      { adjustment_type: 'fee',            total_amount: 10,  transaction_count: 1 },
      { adjustment_type: 'discount',       total_amount: -5,  transaction_count: 1 },
      { adjustment_type: 'void',           total_amount: -200, transaction_count: 1 }, // must be ignored
      { adjustment_type: 'mystery',        total_amount: 999,  transaction_count: 1 }, // must be ignored
    ]);
    expect(result.taxCents).toBe(10_000);
    expect(result.tipsCents).toBe(5_000);
    expect(result.discountsCents).toBe(500);
    expect(result.otherLiabilitiesCents).toBe(3_500); // 25 + 10
  });
});
```

- [ ] **Step 3: Refactor the inner reducer in `useRevenueBreakdown` to be pure-and-exported**

Pull the existing pass-through fold (around lines 130-160) out into an exported pure function `reduceRevenueBreakdownPassThrough` that returns `{ taxCents, tipsCents, discountsCents, otherLiabilitiesCents }`. Walk only known adjustment types — match the constant set from `fetchMonthRevenueTotals` so both code paths stay in lock-step.

- [ ] **Step 4: Run the test**

Run: `npm run test -- tests/unit/useRevenueBreakdown.passThrough.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRevenueBreakdown.tsx tests/unit/useRevenueBreakdown.passThrough.test.ts
git commit -m "fix(revenue-breakdown): drop unknown adjustment types from POS Collected"
```

---

## Task 8: Acceptance fixture — Russo's April 2026

**Files:**
- Create: `tests/unit/monthlyPerformance.acceptance.test.ts`
- Create: `tests/fixtures/russos-2026-04/` directory with snapshotted RPC responses

**Goal:** Lock the canonical pipeline against real production data.

- [ ] **Step 1: Capture production RPC responses as fixtures**

Run these queries in Supabase Studio for project `ncdujvdgqtaunuyigflp`, restaurant `adbd9392-928a-4a46-80d7-f7e453aa1956`, period `2026-04-01..2026-04-30`, and save the JSON output:

- `get_revenue_by_account` → `tests/fixtures/russos-2026-04/revenue_by_account.json`
- `get_pass_through_totals` → `tests/fixtures/russos-2026-04/pass_through_totals.json` (post-Migration-A so void/refund are absent)
- `tip_split_items` joined to `tip_splits` for April → `tests/fixtures/russos-2026-04/tip_splits.json` (expected: empty array)
- `time_punches` for the month → `tests/fixtures/russos-2026-04/time_punches.json`
- `employees` snapshot → `tests/fixtures/russos-2026-04/employees.json`
- `bank_transactions` filtered to April + chart_of_accounts subtype lookup → `tests/fixtures/russos-2026-04/expenses.json`

> **Note:** if any captured fixture would expose PII (employee names, addresses), pass it through a redactor that keeps only fields actually consumed by the pipeline (`id`, `compensation_type`, `hourly_rate`, etc.).

- [ ] **Step 2: Write the failing acceptance test**

Create `tests/unit/monthlyPerformance.acceptance.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { fetchMonthRevenueTotals } from '@/hooks/useMonthlyMetrics';
import { calculateActualLaborCostForMonth } from '@/services/laborCalculations';
import revenueByAccount from '../fixtures/russos-2026-04/revenue_by_account.json';
import passThroughTotals from '../fixtures/russos-2026-04/pass_through_totals.json';
import tipSplits from '../fixtures/russos-2026-04/tip_splits.json';
import timePunches from '../fixtures/russos-2026-04/time_punches.json';
import employees from '../fixtures/russos-2026-04/employees.json';

describe('Monthly Performance acceptance — Russo`s April 2026', () => {
  it('produces the canonical numbers per spec', async () => {
    const supabaseMock = {
      rpc: vi.fn((name: string) => {
        if (name === 'get_revenue_by_account') {
          return Promise.resolve({ data: revenueByAccount, error: null });
        }
        if (name === 'get_pass_through_totals') {
          return Promise.resolve({ data: passThroughTotals, error: null });
        }
        return Promise.resolve({ data: [], error: null });
      }),
    };

    const totals = await fetchMonthRevenueTotals(
      supabaseMock as any,
      'adbd9392-928a-4a46-80d7-f7e453aa1956',
      '2026-04-01',
      '2026-04-30'
    );

    expect(totals.grossRevenueCents).toBe(7_591_782); // $75,917.82
    expect(totals.discountsCents).toBe(147_740);      // $1,477.40
    expect(totals.netRevenueCents).toBe(7_444_042);   // $74,440.42
    expect(totals.salesTaxCents).toBe(597_488);
    expect(totals.tipsCents).toBe(1_038_178);
    expect(totals.otherLiabilitiesCents).toBe(0);
    expect(totals.posCollectedCents).toBe(9_227_448); // $92,274.48

    const tipsOwedByEmployee = new Map<string, number>();
    for (const row of tipSplits as any[]) {
      tipsOwedByEmployee.set(
        row.employee_id,
        (tipsOwedByEmployee.get(row.employee_id) ?? 0) + row.amount
      );
    }

    const labor = calculateActualLaborCostForMonth({
      employees: employees as any,
      timePunches: timePunches as any,
      tipsOwedByEmployee,
      monthStart: new Date('2026-04-01T00:00:00'),
      monthEnd: new Date('2026-04-30T23:59:59'),
    });

    // Tip splits in April for Russo's are empty per diagnostics.
    expect(labor.tipsOwedCents).toBe(0);
    // Wage value is whatever the canonical OT-D pipeline yields — pin it
    // to the cent once the pipeline runs against the fixture once. Update
    // this expectation in the same commit that captures the fixture.
    expect(labor.wagesCents).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run the failing test**

Run: `npm run test -- tests/unit/monthlyPerformance.acceptance.test.ts`

Expected: FAIL on `wagesCents` because it's not pinned yet — the run will print the actual value.

- [ ] **Step 4: Pin `wagesCents`**

Replace `expect(labor.wagesCents).toBeGreaterThan(0)` with the exact value from the failing run. Document in a comment one line above it: `// Pinned 2026-05-01 from canonical OT-D pipeline against Russo's April fixture.`

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- tests/unit/monthlyPerformance.acceptance.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/monthlyPerformance.acceptance.test.ts tests/fixtures/russos-2026-04/
git commit -m "test(monthly-perf): acceptance fixture for Russo's April 2026"
```

---

## Final verification (pre-PR)

- [ ] `npm run lint && npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run db:reset && npm run test:db`
- [ ] `npm run build`
- [ ] Run dev server (`npm run dev:full`) and visit the dashboard for a connected restaurant. Confirm:
  - Top "Collected at POS" matches the breakdown's "Collected at POS" to the cent.
  - Gross Revenue card matches the breakdown's Gross Revenue.
  - "Actual Net Profit" displays correctly per PR #484.
- [ ] CodeRabbit local review on the diff.
- [ ] Push branch, open PR, fill description with Russo's before/after numbers.

## Risks acknowledged in the spec (revisit at PR review)

- **Behavioral change for restaurants we haven't tested.** Mitigation: production smoke against the top-10 restaurants by April revenue.
- **OT-D may shift labor backward in time** for any month that ended with an open ISO week. Documented in the test file; mention in PR description.
- **`void` adjustments disappear from breakdown.** This is the fix, but if any restaurant relied on the (incorrect) negative POS Collected number for void tracking, surface it in the changelog.
