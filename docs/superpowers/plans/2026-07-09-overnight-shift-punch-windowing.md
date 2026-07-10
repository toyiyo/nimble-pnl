# Overnight-Shift Punch Windowing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop overnight shifts (clock-in one day, clock-out after midnight) from being split by per-day/per-period punch fetch windows, which causes dropped payroll hours and false "open session" / "no matching clock-in" warnings.

**Architecture:** The pairing engines are already overnight-aware; the bug is unbuffered fetches. Fetch a symmetric ±18h buffer, pair across the full set, then attribute each shift to its clock-in day and drop shifts whose clock-in is outside the target window. A new `src/utils/punchWindow.ts` centralizes the buffer + attribution filters; each fetch site is a small, consistent change.

**Tech Stack:** React 18 + TypeScript, React Query, Supabase JS client, date-fns, Vitest. Design doc: `docs/superpowers/specs/2026-07-09-overnight-shift-punch-windowing-design.md`.

**Data-lineage rule (applies throughout):** *Buffered* punches feed **pairing only**; *window-filtered* data feeds **every display and every total**. A period/session is "in window" iff its clock-in ∈ `[start, end]` inclusive.

---

## Task 1: `punchWindow.ts` shared util

**Files:**
- Create: `src/utils/punchWindow.ts`
- Modify: `src/utils/payrollCalculations.ts` (export `MAX_SHIFT_GAP_HOURS`)
- Test: `tests/unit/punchWindow.test.ts`

- [ ] **Step 1: Export the existing gap constant**

In `src/utils/payrollCalculations.ts`, change line 21 from:
```ts
const MAX_SHIFT_GAP_HOURS = 18;
```
to:
```ts
export const MAX_SHIFT_GAP_HOURS = 18;
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/punchWindow.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  OVERNIGHT_BUFFER_HOURS,
  bufferPunchFetchRange,
  isWithinWindow,
  periodsInWindow,
  incompleteShiftsInWindow,
  sessionsWithClockInInWindow,
} from '@/utils/punchWindow';
import { MAX_SHIFT_GAP_HOURS } from '@/utils/payrollCalculations';

const start = new Date('2026-07-06T00:00:00Z'); // Mon
const end = new Date('2026-07-12T23:59:59.999Z'); // Sun

describe('punchWindow', () => {
  it('buffer constant never drifts below the pairing gap cap', () => {
    expect(OVERNIGHT_BUFFER_HOURS).toBeGreaterThanOrEqual(MAX_SHIFT_GAP_HOURS);
  });

  it('bufferPunchFetchRange widens by ±18h in epoch ms', () => {
    const { fetchStart, fetchEnd } = bufferPunchFetchRange(start, end);
    expect(start.getTime() - fetchStart.getTime()).toBe(18 * 3600 * 1000);
    expect(fetchEnd.getTime() - end.getTime()).toBe(18 * 3600 * 1000);
  });

  it('isWithinWindow is inclusive on both boundaries', () => {
    expect(isWithinWindow(start, start, end)).toBe(true);
    expect(isWithinWindow(end, start, end)).toBe(true);
    expect(isWithinWindow(new Date(start.getTime() - 1), start, end)).toBe(false);
    expect(isWithinWindow(new Date(end.getTime() + 1), start, end)).toBe(false);
  });

  it('periodsInWindow keeps by startTime, drops out-of-window', () => {
    const periods = [
      { startTime: new Date('2026-07-05T20:00:00Z') }, // before start → drop
      { startTime: new Date('2026-07-07T09:00:00Z') }, // in → keep
      { startTime: new Date('2026-07-13T01:00:00Z') }, // after end → drop
    ];
    expect(periodsInWindow(periods, start, end)).toHaveLength(1);
  });

  it('incompleteShiftsInWindow keeps by punchTime', () => {
    const shifts = [
      { punchTime: new Date('2026-07-05T23:00:00Z') }, // drop
      { punchTime: new Date('2026-07-08T02:00:00Z') }, // keep
    ];
    expect(incompleteShiftsInWindow(shifts, start, end)).toHaveLength(1);
  });

  it('sessionsWithClockInInWindow keeps by clock_in', () => {
    const sessions = [
      { clock_in: new Date('2026-07-07T18:00:00Z') }, // keep
      { clock_in: new Date('2026-07-13T00:30:00Z') }, // drop (next period)
    ];
    expect(sessionsWithClockInInWindow(sessions, start, end)).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/punchWindow.test.ts`
Expected: FAIL — cannot resolve `@/utils/punchWindow`.

- [ ] **Step 4: Write the implementation**

Create `src/utils/punchWindow.ts`:
```ts
/**
 * Overnight-shift fetch windowing helpers.
 *
 * Punch fetches must be widened by this buffer so a shift whose clock_in and
 * clock_out straddle the [start, end] boundary is fetched whole; the pairing
 * engine then pairs it and callers attribute it to its clock-in day, dropping
 * shifts whose clock-in falls outside [start, end].
 *
 * OVERNIGHT_BUFFER_HOURS MUST stay >= MAX_SHIFT_GAP_HOURS (payrollCalculations)
 * — the buffer has to be at least as wide as the largest gap the pairing engine
 * will pair, or a boundary-crossing shift's far punch is never fetched. The
 * drift guard test in punchWindow.test.ts enforces this.
 */
export const OVERNIGHT_BUFFER_HOURS = 18;

/** Expand [start, end] by the overnight buffer on both ends for the DB fetch. */
export function bufferPunchFetchRange(
  start: Date,
  end: Date,
  hours: number = OVERNIGHT_BUFFER_HOURS,
): { fetchStart: Date; fetchEnd: Date } {
  const ms = hours * 60 * 60 * 1000;
  return {
    fetchStart: new Date(start.getTime() - ms),
    fetchEnd: new Date(end.getTime() + ms),
  };
}

/** Inclusive on both boundaries, matching Supabase .gte/.lte semantics. */
export function isWithinWindow(time: Date | string, start: Date, end: Date): boolean {
  const t = time instanceof Date ? time.getTime() : new Date(time).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/** Keep work periods whose clock-in (startTime) is in [start, end]. */
export function periodsInWindow<T extends { startTime: Date }>(periods: T[], start: Date, end: Date): T[] {
  return periods.filter((p) => isWithinWindow(p.startTime, start, end));
}

/** Keep incomplete shifts whose anchor punch (punchTime) is in [start, end]. */
export function incompleteShiftsInWindow<T extends { punchTime: Date }>(shifts: T[], start: Date, end: Date): T[] {
  return shifts.filter((s) => isWithinWindow(s.punchTime, start, end));
}

/** Keep work sessions whose clock_in is in [start, end]. */
export function sessionsWithClockInInWindow<T extends { clock_in: Date }>(sessions: T[], start: Date, end: Date): T[] {
  return sessions.filter((s) => isWithinWindow(s.clock_in, start, end));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/punchWindow.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/utils/punchWindow.ts src/utils/payrollCalculations.ts tests/unit/punchWindow.test.ts
git commit -m "feat(time-punch): add punchWindow buffer + attribution helpers"
```

---

## Task 2: Window-filter periods in `calculateEmployeePay`

**Files:**
- Modify: `src/utils/payrollCalculations.ts:429-486` (hourly branch)
- Test: `tests/unit/payrollCalculations.test.ts`

Background: `calculateEmployeePay` has **three** production callers — `calculatePayrollPeriod` (payroll, fetches buffered punches, wants attribution), and TWO callers inside `src/services/laborCalculations.ts` (`calculateActualLaborCostForMonth`): a salary/contractor call (:884, non-hourly — unaffected) and an **hourly per-ISO-week** call (:913) that pre-buckets punches by unbuffered `startOfWeek` and passes **noon-anchored** week bounds (`weekKey + 'T12:00:00'`) as a deliberate DST workaround (see lessons.md PR #485). A window filter that keys off `periodStartDate`/`periodEndDate` being present would wrongly drop that caller's 09:00 clock-ins (09:00 < the noon anchor).

Therefore the filter is **explicit opt-in** via a new `attributeToWindow` flag (default `false`). Only `calculatePayrollPeriod` passes `true`. The noon-anchored monthly caller stays untouched. (Its own latent overnight bug — bucketing by unbuffered `startOfWeek` splits a Sun→Mon shift across weeks — is real but DST-sensitive and out of scope; tracked as a separate follow-up.)

The hourly branch calls `parseWorkPeriods(punches)` at :430 then loops `parsed.periods` at :433. We insert the flag-guarded window filter between them so buffered-but-out-of-window shifts don't count and don't warn.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/payrollCalculations.test.ts` (a `TimePunch`-shaped factory already exists in this file; reuse it — otherwise build objects with `{ id, employee_id, restaurant_id, punch_type, punch_time }`):
```ts
import { periodsInWindow } from '@/utils/punchWindow'; // ensure import resolves

describe('calculateEmployeePay overnight window attribution', () => {
  const employee = {
    id: 'e1', name: 'Night Owl', position: 'Cook', area: null,
    compensation_type: 'hourly', hourly_rate: 1500, is_active: true,
  } as any;

  // Payroll week Mon 2026-07-06 .. Sun 2026-07-12 (WEEK_STARTS_ON = Mon)
  const weekStart = new Date('2026-07-06T00:00:00');
  const weekEnd = new Date('2026-07-12T23:59:59.999');

  const punch = (type: string, iso: string) => ({
    id: `${type}-${iso}`, employee_id: 'e1', restaurant_id: 'r1',
    punch_type: type, punch_time: iso,
  }) as any;

  it('counts a Sun->Mon overnight shift once, attributed to the Sunday week', () => {
    // Buffered fetch for the Sun-ending week would include Mon 02:00 clock_out.
    const punches = [
      punch('clock_in', '2026-07-12T20:00:00'),  // Sun 8pm (in window)
      punch('clock_out', '2026-07-13T02:00:00'),  // Mon 2am (lookahead)
    ];
    const pay = calculateEmployeePay(employee, punches, 0, weekStart, weekEnd);
    expect(pay.regularHours + pay.overtimeHours).toBeCloseTo(6, 5);
    expect(pay.incompleteShifts ?? []).toHaveLength(0);
  });

  it('does NOT double-count the same shift in the following week, no false orphan', () => {
    const nextStart = new Date('2026-07-13T00:00:00'); // Mon
    const nextEnd = new Date('2026-07-19T23:59:59.999');
    // Buffered fetch for the next week includes the Sun 20:00 clock_in (lookback).
    const punches = [
      punch('clock_in', '2026-07-12T20:00:00'),  // before nextStart → drop
      punch('clock_out', '2026-07-13T02:00:00'),  // in next window, but clock-in owns it
    ];
    const pay = calculateEmployeePay(employee, punches, 0, nextStart, nextEnd);
    expect(pay.regularHours + pay.overtimeHours).toBeCloseTo(0, 5);
    // The paired clock-in suppresses the "no matching clock-in" warning:
    expect(pay.incompleteShifts ?? []).toHaveLength(0);
  });

  it('still flags a genuine missing clock-out when the clock-in is in-window', () => {
    const punches = [punch('clock_in', '2026-07-08T09:00:00')]; // Wed, never clocked out
    const pay = calculateEmployeePay(employee, punches, 0, weekStart, weekEnd);
    expect(pay.incompleteShifts?.some((s) => s.type === 'missing_clock_out')).toBe(true);
  });

  it('OT/tip base rate ignores a buffered out-of-window neighbour shift', () => {
    // 42h in-window (Mon-Sat 7h each) → 40 reg + 2 OT; plus an out-of-window
    // Sunday-of-PRIOR-week shift present in the buffered input must not shift OT.
    const inWindow = [
      ['2026-07-06', '2026-07-07'], ['2026-07-07', '2026-07-08'],
      ['2026-07-08', '2026-07-09'], ['2026-07-09', '2026-07-10'],
      ['2026-07-10', '2026-07-11'], ['2026-07-11', '2026-07-12'],
    ].flatMap(([d]) => [
      punch('clock_in', `${d}T08:00:00`), punch('clock_out', `${d}T15:00:00`),
    ]);
    const neighbour = [
      punch('clock_in', '2026-07-05T08:00:00'), // Sun of prior week → drop
      punch('clock_out', '2026-07-05T15:00:00'),
    ];
    const pay = calculateEmployeePay(employee, [...neighbour, ...inWindow], 0, weekStart, weekEnd);
    expect(pay.regularHours).toBeCloseTo(40, 5);
    expect(pay.overtimeHours).toBeCloseTo(2, 5);
  });
});
```

The 4 overnight tests committed in Task 2.1 call `calculateEmployeePay(employee, punches, 0, weekStart, weekEnd)` — they must opt into the new flag. Update them in this step.

- [ ] **Step 2: Update the 4 overnight tests to opt into `attributeToWindow`**

In `tests/unit/payrollCalculations.test.ts`, in the `describe('calculateEmployeePay overnight window attribution')` block, change each of the 4 `calculateEmployeePay(...)` calls to pass the intermediate defaults and the flag as the final arg. E.g.:
```ts
// before:
const pay = calculateEmployeePay(employee, punches, 0, weekStart, weekEnd);
// after:
const pay = calculateEmployeePay(employee, punches, 0, weekStart, weekEnd, [], 0, undefined, [], true);
```
Apply the same `, [], 0, undefined, [], true` tail to all 4 calls (the two `weekStart/weekEnd` calls, the `nextStart/nextEnd` call, and the OT/tip-neighbour call at the end of the block).

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/unit/payrollCalculations.test.ts -t "overnight window attribution"`
Expected: FAIL — 2/4 fail (double-count + OT/tip-neighbour) because the flag param and filter don't exist yet (TS may error on the extra arg — that is also an acceptable RED).

- [ ] **Step 4: Implement the opt-in filter**

In `src/utils/payrollCalculations.ts`, add the import near the top (after the existing imports):
```ts
import { periodsInWindow, incompleteShiftsInWindow } from '@/utils/punchWindow';
```
Add the `attributeToWindow` parameter to the signature (after `overtimeAdjustments`):
```ts
export function calculateEmployeePay(
  employee: Employee,
  punches: TimePunch[],
  tips: number, // In cents
  periodStartDate?: Date,
  periodEndDate?: Date,
  manualPayments: ManualPayment[] = [],
  tipsPaidOut: number = 0,
  overtimeRules?: OTRules,
  overtimeAdjustments: OvertimeAdjustment[] = [],
  // When true, attribute each shift to its clock-in day and drop periods/
  // incomplete shifts whose anchor punch falls outside [periodStartDate,
  // periodEndDate]. ONLY the payroll path (calculatePayrollPeriod) opts in —
  // it fetches a ±18h buffer so boundary-crossing shifts pair whole first.
  // calculateActualLaborCostForMonth intentionally leaves this false: it
  // pre-buckets by ISO week and passes NOON-anchored bounds that this filter
  // would misinterpret.
  attributeToWindow: boolean = false,
): EmployeePayroll {
```
In the hourly branch, replace:
```ts
  if (compensationType === 'hourly') {
    const parsed = parseWorkPeriods(punches);
    const hoursByDate = new Map<string, number>();
```
with:
```ts
  if (compensationType === 'hourly') {
    const parsed = parseWorkPeriods(punches);
    if (attributeToWindow && periodStartDate && periodEndDate) {
      parsed.periods = periodsInWindow(parsed.periods, periodStartDate, periodEndDate);
      parsed.incompleteShifts = incompleteShiftsInWindow(parsed.incompleteShifts, periodStartDate, periodEndDate);
    }
    const hoursByDate = new Map<string, number>();
```

- [ ] **Step 5: Opt the payroll path in**

In the same file, update `calculatePayrollPeriod`'s call (line ~629) to pass `true` as the final argument:
```ts
    return calculateEmployeePay(employee, punches, tips, startDate, endDate, manualPayments, tipsPaidOut, overtimeRules, overtimeAdjustments, true);
```
Do NOT modify the two `calculateEmployeePay` calls in `src/services/laborCalculations.ts` — they intentionally keep the default `false`.

- [ ] **Step 6: Run the FULL suite to verify no regression**

Run: `npx vitest run tests/unit/payrollCalculations.test.ts tests/unit/laborCalculations.calculateActualLaborCostForMonth.test.ts`
Expected: PASS — all payroll tests (existing + 4 new overnight) green, AND the month-boundary OT test stays green (proves the noon-anchored caller is unaffected). Then `npx vitest run` for the whole suite before committing.

- [ ] **Step 7: Commit**

```bash
git add src/utils/payrollCalculations.ts tests/unit/payrollCalculations.test.ts
git commit -m "fix(payroll): opt-in window filter attributes overnight shifts to clock-in day"
```

---

## Task 3: Buffer the payroll punch fetch (`usePayroll`)

**Files:**
- Modify: `src/hooks/usePayroll.tsx:140-146`

- [ ] **Step 1: Add the import**

In `src/hooks/usePayroll.tsx`, after the existing imports add:
```ts
import { bufferPunchFetchRange } from '@/utils/punchWindow';
```

- [ ] **Step 2: Widen the fetch range**

Replace:
```ts
      // Fetch all time punches for the period
      const { data: punches, error: punchesError } = await supabase
        .from('time_punches')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('punch_time', startDate.toISOString())
        .lte('punch_time', endDate.toISOString())
        .order('punch_time', { ascending: true });
```
with:
```ts
      // Fetch time punches for the period, widened by ±18h so overnight shifts
      // that straddle the period boundary are paired whole. calculateEmployeePay
      // then filters periods back to [startDate, endDate] by clock-in day.
      const { fetchStart, fetchEnd } = bufferPunchFetchRange(startDate, endDate);
      const { data: punches, error: punchesError } = await supabase
        .from('time_punches')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('punch_time', fetchStart.toISOString())
        .lte('punch_time', fetchEnd.toISOString())
        .order('punch_time', { ascending: true });
```
Note: the React Query key stays keyed on the logical `startDate`/`endDate` (line 135) — do NOT change it.

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/unit/payrollCalculations.test.ts && npx tsc --noEmit -p tsconfig.app.json 2>&1 | head`
Expected: tests PASS, no new type errors. (Correctness proven by Task 2 tests; this step wires the buffered input in.)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePayroll.tsx
git commit -m "fix(payroll): fetch ±18h buffer so overnight shifts pair across period edges"
```

---

## Task 4: `hoursByClockInDay` + Employee Timecard rewire

**Files:**
- Create: `src/utils/timecardHours.ts`
- Test: `tests/unit/timecardHours.test.ts`
- Modify: `src/pages/EmployeeTimecard.tsx`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/timecardHours.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hoursByClockInDay } from '@/utils/timecardHours';

const punch = (type: string, iso: string) => ({
  id: `${type}-${iso}`, employee_id: 'e1', restaurant_id: 'r1',
  punch_type: type, punch_time: iso,
}) as any;

describe('hoursByClockInDay', () => {
  it('attributes an overnight shift entirely to the clock-in local day', () => {
    // Thu 23:00 -> Fri 07:00 (8h). Buffered punches may include neighbours.
    const days = [new Date(2026, 6, 9), new Date(2026, 6, 10)]; // Thu, Fri (local)
    const punches = [
      punch('clock_in', new Date(2026, 6, 9, 23, 0).toISOString()),
      punch('clock_out', new Date(2026, 6, 10, 7, 0).toISOString()),
    ];
    const map = hoursByClockInDay(punches, days);
    expect(map.get('2026-07-09')!.netHours).toBeCloseTo(8, 5);
    expect(map.get('2026-07-10')!.netHours).toBeCloseTo(0, 5);
  });

  it('subtracts breaks from the same clock-in day', () => {
    const days = [new Date(2026, 6, 9)];
    const punches = [
      punch('clock_in', new Date(2026, 6, 9, 9, 0).toISOString()),
      punch('break_start', new Date(2026, 6, 9, 12, 0).toISOString()),
      punch('break_end', new Date(2026, 6, 9, 12, 30).toISOString()),
      punch('clock_out', new Date(2026, 6, 9, 17, 0).toISOString()),
    ];
    const d = hoursByClockInDay(punches, days).get('2026-07-09')!;
    expect(d.totalHours).toBeCloseTo(8, 5);
    expect(d.breakHours).toBeCloseTo(0.5, 5);
    expect(d.netHours).toBeCloseTo(7.5, 5);
  });

  it('ignores shifts whose clock-in day is outside the displayed range', () => {
    const days = [new Date(2026, 6, 10)];
    const punches = [
      punch('clock_in', new Date(2026, 6, 9, 9, 0).toISOString()),
      punch('clock_out', new Date(2026, 6, 9, 17, 0).toISOString()),
    ];
    expect(hoursByClockInDay(punches, days).get('2026-07-10')!.netHours).toBeCloseTo(0, 5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/timecardHours.test.ts`
Expected: FAIL — cannot resolve `@/utils/timecardHours`.

- [ ] **Step 3: Implement the pure function**

Create `src/utils/timecardHours.ts`:
```ts
import { format } from 'date-fns';
import { TimePunch } from '@/types/timeTracking';
import { processPunchesForPeriod } from '@/utils/timePunchProcessing';

export interface DayHours {
  totalHours: number;
  breakHours: number;
  netHours: number;
}

/**
 * Pair `punches` into work sessions and bucket each COMPLETE session's hours
 * into its clock-in LOCAL calendar day. Only days present in `days` are kept.
 * Pass BUFFERED punches (±18h) so overnight shifts pair whole; attribution by
 * clock-in day keeps each shift on a single calendar day.
 */
export function hoursByClockInDay(punches: TimePunch[], days: Date[]): Map<string, DayHours> {
  const result = new Map<string, DayHours>();
  for (const day of days) {
    result.set(format(day, 'yyyy-MM-dd'), { totalHours: 0, breakHours: 0, netHours: 0 });
  }

  const { sessions } = processPunchesForPeriod(punches);
  for (const session of sessions) {
    if (!session.is_complete) continue; // open shift contributes no hours yet
    const key = format(new Date(session.clock_in), 'yyyy-MM-dd');
    const bucket = result.get(key);
    if (!bucket) continue; // clock-in day outside the displayed range
    bucket.totalHours += session.total_minutes / 60;
    bucket.breakHours += session.break_minutes / 60;
    bucket.netHours += session.worked_minutes / 60;
  }
  return result;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/timecardHours.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Rewire EmployeeTimecard to buffered fetch + `hoursByClockInDay`**

In `src/pages/EmployeeTimecard.tsx`:

(a) Add imports:
```ts
import { bufferPunchFetchRange } from '@/utils/punchWindow';
import { hoursByClockInDay } from '@/utils/timecardHours';
```

(b) Replace the punch fetch (lines 117-121) to pass a buffered start AND end:
```ts
  const { fetchStart, fetchEnd } = bufferPunchFetchRange(startDate, endDate);
  const { punches, loading: punchesLoading } = useTimePunches(
    restaurantId,
    currentEmployee?.id,
    fetchStart,
    fetchEnd
  );
```

(c) Add a memoized day-hours map (buffered punches → attributed), placed after `punchesByDay`:
```ts
  const dayHours = useMemo(() => hoursByClockInDay(punches, weekDays), [punches, weekDays]);
```

(d) Replace the `weeklyTotals` reducer (currently iterates `punchesByDay` and calls `calculateDayHours`) so it sums `dayHours`:
```ts
  const weeklyTotals = useMemo(() => {
    let totalHours = 0;
    let breakHours = 0;
    let netHours = 0;
    dayHours.forEach((d) => {
      totalHours += d.totalHours;
      breakHours += d.breakHours;
      netHours += d.netHours;
    });
    const regularHours = Math.min(netHours, 40);
    const overtimeHours = Math.max(netHours - 40, 0);
    return { totalHours, breakHours, netHours, regularHours, overtimeHours };
  }, [dayHours]);
```

(e) Find the per-day render that calls `calculateDayHours(dayPunches)` (the day cards, below the summary) and replace each call with a lookup:
```ts
  const dayStats = dayHours.get(dayKey) ?? { totalHours: 0, breakHours: 0, netHours: 0 };
```
Keep `punchesByDay` and the visual per-punch list unchanged (they still render `periodPunches`).

(f) Delete the now-unused `calculateDayHours` function (lines 34-76) once no references remain.

- [ ] **Step 6: Verify build + tests**

Run: `npx vitest run tests/unit/timecardHours.test.ts && npx tsc --noEmit -p tsconfig.app.json 2>&1 | head`
Expected: tests PASS, no unused-symbol / type errors (confirms `calculateDayHours` fully removed).

- [ ] **Step 7: Commit**

```bash
git add src/utils/timecardHours.ts tests/unit/timecardHours.test.ts src/pages/EmployeeTimecard.tsx
git commit -m "fix(timecard): pair overnight shifts across days, attribute hours to clock-in day"
```

---

## Task 5: `TimePunchesManager` buffered fetch + window/buffer split

**Files:**
- Modify: `src/pages/TimePunchesManager.tsx`
- Test: `tests/unit/timePunchProcessing.test.ts` (open-session completeness assertion)

- [ ] **Step 1: Write the failing test (open-session completeness)**

Add to `tests/unit/timePunchProcessing.test.ts`:
```ts
import { processPunchesForPeriod } from '@/utils/timePunchProcessing';
import { sessionsWithClockInInWindow } from '@/utils/punchWindow';

const p = (type: string, iso: string, emp = 'e1') => ({
  id: `${type}-${iso}`, employee_id: emp, restaurant_id: 'r1',
  punch_type: type, punch_time: iso, employee: { name: 'A' },
}) as any;

describe('open-session windowing (buffered pairing)', () => {
  it('a clock-out just after the day end makes the session complete, not open', () => {
    const dayStart = new Date('2026-07-04T00:00:00');
    const dayEnd = new Date('2026-07-04T23:59:59.999');
    // Buffered fetch would include the Jul-5 00:06 clock-out.
    const punches = [
      p('clock_in', '2026-07-04T21:14:00'),
      p('clock_out', '2026-07-05T00:06:00'),
    ];
    const { sessions } = processPunchesForPeriod(punches);
    const windowSessions = sessionsWithClockInInWindow(sessions, dayStart, dayEnd);
    expect(windowSessions).toHaveLength(1);
    expect(windowSessions[0].is_complete).toBe(true);
    const open = windowSessions.filter((s) => !s.is_complete);
    expect(open).toHaveLength(0);
    // And the hours count toward the day total:
    expect(windowSessions[0].worked_minutes / 60).toBeCloseTo(2.87, 1);
  });
});
```

- [ ] **Step 2: Run to verify pass-or-fail baseline**

Run: `npx vitest run tests/unit/timePunchProcessing.test.ts -t "open-session windowing"`
Expected: PASS already (this asserts the helper contract the page relies on; it guards against regressions when the page wiring lands). If the import path fails, that is the expected RED until Task 1 is merged (it is).

- [ ] **Step 3: Buffer the fetch + derive window sets**

In `src/pages/TimePunchesManager.tsx`:

(a) Add imports:
```ts
import { bufferPunchFetchRange, isWithinWindow, sessionsWithClockInInWindow } from '@/utils/punchWindow';
```

(b) At the `useTimePunches` call (around :295-300) pass a buffered range built from `dateRange`:
```ts
  const { fetchStart, fetchEnd } = useMemo(
    () => bufferPunchFetchRange(dateRange.start, dateRange.end),
    [dateRange.start, dateRange.end],
  );
  const { punches, loading } = useTimePunches(
    restaurantId,
    undefined,
    fetchStart,
    fetchEnd,
  );
```
(Match the existing argument list for `useTimePunches` — keep whatever employee arg the current call passes; only the date args become buffered.)

(c) `filteredPunches` stays the buffered, search-filtered set feeding pairing (unchanged). Immediately after it, add the window subset:
```ts
  // Punches actually inside the viewed window — for tables, export, editor, photos.
  const windowPunches = useMemo(
    () => filteredPunches.filter((punch) => isWithinWindow(punch.punch_time, dateRange.start, dateRange.end)),
    [filteredPunches, dateRange.start, dateRange.end],
  );
```

(d) Window-filter the sessions for all viewModes and derive window processed-punches:
```ts
  const windowSessions = useMemo(
    () => sessionsWithClockInInWindow(processedData.sessions, dateRange.start, dateRange.end),
    [processedData.sessions, dateRange.start, dateRange.end],
  );
  const windowProcessedPunches = useMemo(
    () => processedData.processedPunches.filter((pp) => isWithinWindow(pp.punch_time, dateRange.start, dateRange.end)),
    [processedData.processedPunches, dateRange.start, dateRange.end],
  );
```

(e) Rewire consumers:
- `incompleteSessions` (:322) → `windowSessions.filter((s) => !s.is_complete)`.
- `todaySessions` (:325-330) → for `day` viewMode return `sessionsWithClockInInWindow(windowSessions, startOfDay(currentDate), endOfDay(currentDate))`; otherwise return `windowSessions`. (Uses the helper for consistent inclusive semantics; removes the `isSameDay` variant.)
- `totalWeekHours` (:564) — already `todaySessions.reduce(...)`, so it now reflects window sessions; no change needed beyond (e) above.
- Punch List table, `handleExportCSV` (`filteredPunches` at :560 count + rows), and `ManualTimelineEditor existingPunches` (:705) → change their source from `filteredPunches` to `windowPunches`.
- Photo-thumbnail effect (:333, `punches.filter(...)` with dep `[punches]`) → change to `windowPunches.filter(...)` with dep `[windowPunches]`.
- `PunchStreamView` (:747) → pass `windowProcessedPunches` instead of `processedData.processedPunches`.

- [ ] **Step 4: Verify build + tests**

Run: `npx vitest run tests/unit/timePunchProcessing.test.ts && npx tsc --noEmit -p tsconfig.app.json 2>&1 | head`
Expected: tests PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/TimePunchesManager.tsx tests/unit/timePunchProcessing.test.ts
git commit -m "fix(time-clock): stop false open sessions from per-day fetch windowing"
```

---

## Task 6: Buffer the Dashboard labor-cost fetch

**Files:**
- Modify: `src/hooks/useLaborCostsFromTimeTracking.tsx:84-90`

- [ ] **Step 1: Add import + widen fetch**

Add:
```ts
import { bufferPunchFetchRange } from '@/utils/punchWindow';
```
Replace:
```ts
      const { data: punches, error: punchesError } = await supabase
        .from('time_punches')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('punch_time', dateFrom.toISOString())
        .lte('punch_time', dateTo.toISOString())
        .order('punch_time', { ascending: true });
```
with:
```ts
      // ±18h buffer so overnight shifts pair whole; calculateActualLaborCost
      // attributes hours by clock-in day and drops out-of-window periods.
      const { fetchStart, fetchEnd } = bufferPunchFetchRange(dateFrom, dateTo);
      const { data: punches, error: punchesError } = await supabase
        .from('time_punches')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('punch_time', fetchStart.toISOString())
        .lte('punch_time', fetchEnd.toISOString())
        .order('punch_time', { ascending: true });
```
Query key (line 77) stays on `dateFrom`/`dateTo` — do not change.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | head`
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useLaborCostsFromTimeTracking.tsx
git commit -m "fix(dashboard): fetch ±18h buffer for overnight-safe labor costs"
```

---

## Task 7: Buffer the two AI edge-tool fetches

**Files:**
- Modify: `supabase/functions/_shared/laborCalculations.ts` (add constant)
- Modify: `supabase/functions/ai-execute-tool/index.ts` (~L231, ~L2242)

- [ ] **Step 1: Add the Deno-side constant**

At the top of `supabase/functions/_shared/laborCalculations.ts`, add:
```ts
/**
 * Hours past endDate to widen a time_punches fetch so a shift whose clock_out
 * lands just after the window end still pairs. calculateActualLaborCost /
 * calculateHoursPerEmployee already drop periods whose clock-in is outside
 * [startDate, endDate], so this look-ahead never double-counts.
 * MUST stay in parity with src/utils/punchWindow.ts OVERNIGHT_BUFFER_HOURS.
 */
export const LABOR_FETCH_LOOKAHEAD_HOURS = 18;
```

- [ ] **Step 2: Widen the P&L labor fetch (~L231)**

In `supabase/functions/ai-execute-tool/index.ts`, at the handler importing `calculateActualLaborCost` (~L227), import the constant alongside it:
```ts
  const { calculateActualLaborCost, LABOR_FETCH_LOOKAHEAD_HOURS } = await import('../_shared/laborCalculations.ts');
```
Replace that fetch's upper bound:
```ts
    .gte('punch_time', startDate.toISOString())
    .lte('punch_time', endDate.toISOString())
```
with:
```ts
    .gte('punch_time', startDate.toISOString())
    .lte('punch_time', new Date(endDate.getTime() + LABOR_FETCH_LOOKAHEAD_HOURS * 3600 * 1000).toISOString())
```

- [ ] **Step 3: Widen the payroll-summary fetch (~L2242)**

In `executeGetPayrollSummary`, update its import (~L2236):
```ts
  const { calculateActualLaborCost, LABOR_FETCH_LOOKAHEAD_HOURS } = await import('../_shared/laborCalculations.ts');
```
and the `time_punches` query inside the `Promise.all` from:
```ts
      .gte('punch_time', startDate.toISOString())
      .lte('punch_time', endDate.toISOString())
```
to:
```ts
      .gte('punch_time', startDate.toISOString())
      .lte('punch_time', new Date(endDate.getTime() + LABOR_FETCH_LOOKAHEAD_HOURS * 3600 * 1000).toISOString())
```

- [ ] **Step 4: Verify (Deno type check if available, else lint)**

Run: `npx tsc --noEmit -p tsconfig.app.json 2>&1 | head` (edge fn is Deno; front-end tsc won't cover it — rely on `deno check` in CI). Confirm the two edits compile logically (constant imported where used).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/laborCalculations.ts supabase/functions/ai-execute-tool/index.ts
git commit -m "fix(ai-tools): look-ahead buffer for overnight-safe labor + payroll summary"
```

---

## Final verification (Phase 8 handles this, listed for completeness)

- `npm run test` — all unit tests green (existing 58 + new punchWindow/timecard/payroll/open-session cases).
- Run the timecard/attribution suite under `TZ=America/Chicago` as well as UTC.
- `npm run typecheck`, `npm run lint`, `npm run build` — clean.

## Spec coverage check

- Design §"punchWindow.ts" → Task 1. §2 Payroll → Tasks 2, 3. §3 Open Sessions → Task 5. §4 Timecard → Task 4. §5 Dashboard → Task 6. §6 AI edge tools → Task 7. Testing §1-4 → distributed across tasks. Timezone discipline → Task 4 DST-portable test + local-day bucketing. All design sections have an owning task.
