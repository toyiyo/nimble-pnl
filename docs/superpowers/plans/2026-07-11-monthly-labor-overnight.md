# Monthly Labor Cost — Overnight Attribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** `calculateActualLaborCostForMonth` must count overnight shifts (crossing an ISO-week or month boundary) on their clock-in day/week, instead of dropping them.

**Architecture:** Bucket punches by the shift's clock-in week (defensively sorted); distribute/clip pay by the period's clock-in day; look-ahead-buffer the `useMonthlyMetrics` fetch. Noon-anchor + OT banding unchanged. Design: `docs/superpowers/specs/2026-07-11-monthly-labor-overnight-design.md`.

**Scope:** `src/services/laborCalculations.ts` (calc), `src/hooks/useMonthlyMetrics.tsx` (fetch), + tests. No DB/RLS/schema change.

---

## Task 1: Clock-in-week bucketing + clock-in-day distribution

**Files:**
- Modify: `src/services/laborCalculations.ts` (`calculateActualLaborCostForMonth`, ~L898-931)
- Test: `tests/unit/laborCalculations.calculateActualLaborCostForMonth.test.ts`

- [ ] **Step 1: Write failing tests**

Add to the existing describe block (reuse the file's `punch`/`baseEmployee` helpers; `baseEmployee` is hourly $20/hr):
```ts
it('CRITICAL: counts a Sun->Mon overnight shift that crosses an ISO-week boundary within a month', () => {
  // 2026-07-05 is Sunday (ISO week Mon Jun29–Sun Jul5); 2026-07-06 is Monday (next week).
  // Shift: Sun 20:00 -> Mon 02:00 = 6h, entirely in July. Must count 6h*$20 = 12,000c.
  const punches = [
    punch('e1', '2026-07-05T20:00:00', 'clock_in'),
    punch('e1', '2026-07-06T02:00:00', 'clock_out'),
  ];
  const result = calculateActualLaborCostForMonth({
    employees: [baseEmployee], timePunches: punches, tipsOwedByEmployee: new Map(),
    monthStart: new Date('2026-07-01T00:00:00'), monthEnd: new Date('2026-07-31T23:59:59'),
  });
  expect(result.wagesCents).toBe(12_000); // was 0 before the fix (shift split across week buckets)
});

it('CRITICAL: attributes the overnight shift to its clock-in day (not split)', () => {
  // Same shift; clock-in is Jul 5. A July-only month counts it; a June month must NOT.
  const punches = [
    punch('e1', '2026-07-05T20:00:00', 'clock_in'),
    punch('e1', '2026-07-06T02:00:00', 'clock_out'),
  ];
  const june = calculateActualLaborCostForMonth({
    employees: [baseEmployee], timePunches: punches, tipsOwedByEmployee: new Map(),
    monthStart: new Date('2026-06-01T00:00:00'), monthEnd: new Date('2026-06-30T23:59:59'),
  });
  expect(june.wagesCents).toBe(0); // clock-in day (Jul 5) is outside June
});

it('is order-independent (handles out-of-order punch input)', () => {
  const punches = [
    punch('e1', '2026-07-06T02:00:00', 'clock_out'), // out of order
    punch('e1', '2026-07-05T20:00:00', 'clock_in'),
  ];
  const result = calculateActualLaborCostForMonth({
    employees: [baseEmployee], timePunches: punches, tipsOwedByEmployee: new Map(),
    monthStart: new Date('2026-07-01T00:00:00'), monthEnd: new Date('2026-07-31T23:59:59'),
  });
  expect(result.wagesCents).toBe(12_000);
});
```

- [ ] **Step 2: Run — expect the first two RED** (`0` instead of `12000`; the June one may already pass).

Run: `npx vitest run tests/unit/laborCalculations.calculateActualLaborCostForMonth.test.ts -t "overnight"`

- [ ] **Step 3: Implement clock-in-week bucketing**

In `src/services/laborCalculations.ts`, replace the per-punch bucketing (~L898-906):
```ts
    const punchesByWeek = new Map<string, TimePunch[]>();
    for (const p of employeePunches) {
      const punchDate = new Date(p.punch_time);
      const weekStart = startOfWeek(punchDate, { weekStartsOn: WEEK_STARTS_ON });
      const weekKey = formatDate(weekStart, 'yyyy-MM-dd');
      const arr = punchesByWeek.get(weekKey) ?? [];
      arr.push(p);
      punchesByWeek.set(weekKey, arr);
    }
```
with:
```ts
    // Bucket punches by the SHIFT's clock-in week (not each punch's own week) so
    // an overnight shift clocking out in the next ISO week stays whole in its
    // clock-in week instead of being split into two lone-punch buckets (dropped).
    // Defensively sorted: the clock-in-week state machine requires chronological
    // order and must not rely on the caller's .order('punch_time').
    const weekKeyFor = (t: Date) =>
      formatDate(startOfWeek(t, { weekStartsOn: WEEK_STARTS_ON }), 'yyyy-MM-dd');
    const sortedPunches = [...employeePunches].sort(
      (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
    );
    const punchesByWeek = new Map<string, TimePunch[]>();
    let currentWeekKey: string | null = null;
    for (const p of sortedPunches) {
      if (p.punch_type === 'clock_in') {
        currentWeekKey = weekKeyFor(new Date(p.punch_time)); // open shift → clock-in week
      }
      const weekKey = currentWeekKey ?? weekKeyFor(new Date(p.punch_time)); // orphan → own week
      const arr = punchesByWeek.get(weekKey) ?? [];
      arr.push(p);
      punchesByWeek.set(weekKey, arr);
      if (p.punch_type === 'clock_out') currentWeekKey = null; // shift closed
    }
```

- [ ] **Step 4: Distribute/clip by clock-in day**

In the same function, the per-day hours accumulation (~L929) currently:
```ts
        const dateKey = formatDateUTC(period.startTime);
```
change to:
```ts
        // Attribute by the shift's clock-in day (not the segment start), so a
        // break-after-midnight segment's hours land on the clock-in day for both
        // the proportional split and the [monthStart, monthEnd] clip.
        const dateKey = formatDateUTC(period.clockIn ?? period.startTime);
```

- [ ] **Step 5: Add the KNOWN GAP comment**

In `src/utils/payrollCalculations.ts`, at the hourly OT-banding date-key line (`const dateKey = format(new Date(period.startTime), 'yyyy-MM-dd');` inside `calculateEmployeePay`), add above it:
```ts
      // KNOWN GAP: OT weekly banding keys off period.startTime, not clockIn, so a
      // break-after-midnight shift crossing a week boundary bands its pre/post-
      // midnight hours into two ISO weeks. Pre-existing, shared with the monthly
      // labor calc. See docs/superpowers/specs/2026-07-11-monthly-labor-overnight-design.md
```

- [ ] **Step 6: Run — expect GREEN**

Run: `npx vitest run tests/unit/laborCalculations.calculateActualLaborCostForMonth.test.ts` — new + existing (incl. the "OT straddles month boundary" 49144/36856 case) all pass.

- [ ] **Step 7: Commit**
```bash
git add src/services/laborCalculations.ts src/utils/payrollCalculations.ts tests/unit/laborCalculations.calculateActualLaborCostForMonth.test.ts
git commit -m "fix(labor): attribute overnight shifts to clock-in week/day in monthly labor cost"
```

---

## Task 2: Look-ahead buffer the `useMonthlyMetrics` fetch

**Files:**
- Modify: `src/hooks/useMonthlyMetrics.tsx` (~L365-369)
- Test: `tests/unit/useMonthlyMetrics.fetchRange.test.ts` (new, mirror `useLaborCostsFromTimeTracking.fetchRange.test.ts`)

- [ ] **Step 1: Widen the fetch (look-ahead only)**

Add import: `import { lookaheadPunchFetchRange } from '@/utils/punchWindow';`
Replace:
```ts
        .from('time_punches')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('punch_time', dateFrom.toISOString())
        .lte('punch_time', dateTo.toISOString())
```
with:
```ts
        // Look-ahead buffer so an overnight shift clocking out just after the
        // range end (e.g. 1st of next month) is fetched whole; the per-month
        // clock-in-day clip drops shifts that belong outside the window.
        .from('time_punches')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('punch_time', dateFrom.toISOString())
        .lte('punch_time', lookaheadPunchFetchRange(dateFrom, dateTo).fetchEnd.toISOString())
```

- [ ] **Step 2: Write the fetch-range test**

Create `tests/unit/useMonthlyMetrics.fetchRange.test.ts` modeled on `tests/unit/useLaborCostsFromTimeTracking.fetchRange.test.ts` (chainable supabase mock; stub `useEmployees` if needed). Assert the `time_punches` query used `.gte('punch_time', dateFrom.toISOString())` and `.lte('punch_time', <dateTo + 18h>.toISOString())` — start unchanged, end +18h. (Inspect `useMonthlyMetrics`'s other required mocks/props from its signature and stub minimally so the query runs.)

- [ ] **Step 3: Run — GREEN**

Run: `npx vitest run tests/unit/useMonthlyMetrics.fetchRange.test.ts`

- [ ] **Step 4: Commit**
```bash
git add src/hooks/useMonthlyMetrics.tsx tests/unit/useMonthlyMetrics.fetchRange.test.ts
git commit -m "fix(dashboard): look-ahead buffer monthly labor fetch for month-end overnight shifts"
```

---

## Final verification (Phase 8)
- `npm run test` (full unit suite green, incl. new cases + unchanged straddle case).
- Run the labor suite under `TZ=America/Chicago` and UTC (DST-portability).
- `npm run typecheck`, `npm run lint` (changed files), `npm run build`.

## Spec coverage
Design §1 (clock-in-week bucketing) → Task 1 S3. §2 (clock-in-day distribution) → Task 1 S4. §3 (look-ahead fetch) → Task 2. Review: defensive sort + out-of-order test → Task 1 S3/S1; weekKeyFor helper → Task 1 S3; KNOWN GAP comment → Task 1 S5.
