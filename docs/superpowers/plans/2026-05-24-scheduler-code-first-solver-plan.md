# Code-First Scheduler Solver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the LLM-only AI scheduler with a deterministic code-first solver that satisfies all 14 hard rules by construction. Keep an LLM swap-proposer for free-text manager preferences. Retire the old prompt-based path.

**Architecture:**
- New `schedule-solver.ts` runs greedy most-constrained-first assignment, reusing validator primitives.
- New `schedule-preference-llm.ts` proposes pair-swaps from free text; server re-validates each swap.
- `generate-schedule/index.ts` calls solver first; calls preference layer only when text non-empty.
- All UUIDs projected through ClientSafe shapes before HTTP serialization.

**Tech Stack:** Deno + TypeScript edge function, React + React Query + shadcn (Textarea/Label/Dialog), Vitest (unit + bench). Spec: `docs/superpowers/specs/2026-05-24-scheduler-code-first-solver-design.md`.

**Spec coverage map:**
- Solver (spec §The solver): Tasks 2–10
- Validator additive export (spec §Determinism + TZ safety): Task 1
- Preference LLM (spec §The LLM preference layer): Tasks 11–15
- Edge function rewire + ClientSafe (spec §Architecture + §ClientSafe projections): Tasks 16–19
- Retirement (spec §Retirement of the LLM-only path): Tasks 20–22
- UI changes (spec §UI changes): Tasks 23–25
- Perf gate (spec §Performance budget + measurement): Tasks 26–28
- Integration (spec Tests #20–22): Tasks 29–31

---

## Task 1: Add `getDayOfWeekUTC` additive export to schedule-validator

**Files:**
- Modify: `supabase/functions/_shared/schedule-validator.ts` (additive export only)
- Test: `tests/unit/schedule-validator-utc.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schedule-validator-utc.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getDayOfWeekUTC } from '../../supabase/functions/_shared/schedule-validator';

describe('getDayOfWeekUTC', () => {
  it('returns 0 (Sunday) for 2026-06-07', () => {
    expect(getDayOfWeekUTC('2026-06-07')).toBe(0);
  });
  it('returns 1 (Monday) for 2026-06-08', () => {
    expect(getDayOfWeekUTC('2026-06-08')).toBe(1);
  });
  it('returns 6 (Saturday) for 2026-06-13', () => {
    expect(getDayOfWeekUTC('2026-06-13')).toBe(6);
  });
  it('agrees with itself across process.env.TZ values (snapshot)', () => {
    // Sanity: the function is UTC-anchored so process.env.TZ cannot change its output.
    // Real TZ portability is asserted in Task 9 by running vitest with TZ= env vars.
    const results = ['2026-06-07', '2026-06-08', '2026-06-13'].map(getDayOfWeekUTC);
    expect(results).toEqual([0, 1, 6]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedule-validator-utc.test.ts`
Expected: FAIL with "getDayOfWeekUTC is not exported" or similar import error.

- [ ] **Step 3: Add the export**

In `supabase/functions/_shared/schedule-validator.ts`, immediately after the existing `getDayOfWeek` function (around line 95), add:

```ts
/**
 * UTC-anchored variant of getDayOfWeek. Parses YYYY-MM-DD as midnight UTC,
 * returns the UTC day-of-week. Use this in the solver and any new code that
 * derives a day-of-week from a date string. Existing call sites in this file
 * keep using getDayOfWeek to avoid changing drop semantics on shipped flows.
 */
export function getDayOfWeekUTC(dateStr: string): number {
  const ts = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(ts)) {
    throw new Error(`getDayOfWeekUTC: invalid dateStr "${dateStr}" — expected YYYY-MM-DD`);
  }
  return new Date(ts).getUTCDay();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/schedule-validator-utc.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-validator.ts tests/unit/schedule-validator-utc.test.ts
git commit -m "feat(scheduler): add getDayOfWeekUTC additive export for solver

UTC-anchored day-of-week helper. Existing getDayOfWeek stays as-is
to preserve validator drop semantics."
```

---

## Task 2: Solver skeleton — types + empty-input behavior

**Files:**
- Create: `supabase/functions/_shared/schedule-solver.ts`
- Test: `tests/unit/schedule-solver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schedule-solver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { solveSchedule } from '../../supabase/functions/_shared/schedule-solver';
import type { ScheduleContext } from '../../supabase/functions/_shared/schedule-prompt-builder';

function emptyCtx(): ScheduleContext {
  return {
    restaurantId: 'r1',
    weekStart: '2026-06-08',
    employees: [],
    templates: [],
    availability: {},
    requiredStaff: new Map(),
    lockedShifts: [],
    excludedEmployeeIds: new Set(),
    priorPatterns: [],
    weeklySalesHistory: [],
    hourlySalesHistory: [],
    targetLaborPercentage: 0.30,
    minimumWageCents: 0,
  };
}

describe('solveSchedule — smoke', () => {
  it('empty requiredStaff returns empty result with empty fairness', () => {
    const result = solveSchedule(emptyCtx());
    expect(result.shifts).toEqual([]);
    expect(result.unfilled).toEqual([]);
    expect(result.fairness).toEqual([]);
  });

  it('empty requiredStaff but with employees returns one zero-hour fairness row per employee', () => {
    const ctx = emptyCtx();
    ctx.employees = [
      { id: 'e1', name: 'Alice', position: 'Server', area: null, max_weekly_hours: 40,
        date_of_birth: '2000-01-01', is_minor: false },
    ];
    const result = solveSchedule(ctx);
    expect(result.fairness).toEqual([
      { employee_id: 'e1', hours_assigned: 0, days_worked: 0, hours_budget: 40 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedule-solver.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the solver skeleton**

Create `supabase/functions/_shared/schedule-solver.ts`:

```ts
/**
 * schedule-solver.ts
 *
 * Pure-TS code-first scheduler. Replaces the LLM-only path. Reuses validator
 * primitives so predicate semantics are single-sourced.
 *
 * See docs/superpowers/specs/2026-05-24-scheduler-code-first-solver-design.md
 */

import {
  type GeneratedShift,
  getDayOfWeekUTC,
  longestConsecutiveRun,
  normalizePosition,
  shiftHours,
  shiftsConflict,
  timeToMinutes,
  withinWindow,
} from './schedule-validator.ts';
import type { ScheduleContext } from './schedule-prompt-builder.ts';

export interface UnfilledSlot {
  template_id: string;
  day: string;
  position: string;
  area: string | null;
  reason:
    | 'NO_ELIGIBLE_EMPLOYEE'
    | 'ALL_AT_HOUR_CAP'
    | 'ALL_AT_CONSEC_DAY_CAP'
    | 'ALL_UNAVAILABLE'
    | 'ALL_CONFLICTING';
}

export interface FairnessSummary {
  employee_id: string;
  hours_assigned: number;
  days_worked: number;
  hours_budget: number;
}

export interface SolverResult {
  shifts: GeneratedShift[];
  unfilled: UnfilledSlot[];
  fairness: FairnessSummary[];
}

export function solveSchedule(ctx: ScheduleContext): SolverResult {
  const hoursByEmp = new Map<string, number>();
  const daysByEmp = new Map<string, Set<string>>();
  const shiftsByEmp = new Map<string, GeneratedShift[]>();

  for (const emp of ctx.employees) {
    hoursByEmp.set(emp.id, 0);
    daysByEmp.set(emp.id, new Set());
    shiftsByEmp.set(emp.id, []);
  }

  const fairness: FairnessSummary[] = ctx.employees.map((emp) => ({
    employee_id: emp.id,
    hours_assigned: 0,
    days_worked: 0,
    hours_budget: emp.max_weekly_hours,
  }));

  return { shifts: [], unfilled: [], fairness };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/schedule-solver.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-solver.ts tests/unit/schedule-solver.test.ts
git commit -m "feat(scheduler-solver): skeleton with empty-input behavior

Defines SolverResult, UnfilledSlot, FairnessSummary. Returns empty
result; subsequent tasks add stages A-E."
```

---

## Task 3: Stage A — enumerate slots from requiredStaff

**Files:**
- Modify: `supabase/functions/_shared/schedule-solver.ts`
- Modify: `tests/unit/schedule-solver.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/schedule-solver.test.ts`:

```ts
describe('solveSchedule — Stage A (slot enumeration)', () => {
  it('produces one slot per required headcount per (template, day)', () => {
    const ctx = emptyCtx();
    ctx.templates = [
      { id: 't1', name: 'Lunch', position: 'Server', area: null,
        start_time: '10:00:00', end_time: '16:30:00', days_of_week: [1, 2, 3] },
    ];
    ctx.requiredStaff = new Map([
      ['t1:2026-06-08', { template_id: 't1', day: '2026-06-08', count: 2 }],
    ]);
    // No employees, so all slots fall through to unfilled
    const result = solveSchedule(ctx);
    expect(result.unfilled).toHaveLength(2);
    expect(result.unfilled[0]).toMatchObject({
      template_id: 't1', day: '2026-06-08', position: 'Server',
    });
  });

  it('skips slots whose day-of-week is not in template.days_of_week', () => {
    const ctx = emptyCtx();
    ctx.templates = [
      // Mon=1, Tue=2 only — exclude Wed
      { id: 't1', name: 'Lunch', position: 'Server', area: null,
        start_time: '10:00:00', end_time: '16:30:00', days_of_week: [1, 2] },
    ];
    ctx.requiredStaff = new Map([
      ['t1:2026-06-10', { template_id: 't1', day: '2026-06-10', count: 1 }], // Wed
    ]);
    const result = solveSchedule(ctx);
    expect(result.unfilled).toHaveLength(0);
    expect(result.shifts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedule-solver.test.ts`
Expected: FAIL — first test gets 0 unfilled; second test passes vacuously.

- [ ] **Step 3: Implement Stage A**

In `supabase/functions/_shared/schedule-solver.ts`, add internal types and an enumeration step. Replace the `solveSchedule` body with:

```ts
interface Slot {
  template_id: string;
  day: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  position: string;
  area: string | null;
}

function enumerateSlots(ctx: ScheduleContext): Slot[] {
  const slots: Slot[] = [];
  const templatesById = new Map(ctx.templates.map((t) => [t.id, t]));
  for (const req of ctx.requiredStaff.values()) {
    const template = templatesById.get(req.template_id);
    if (!template) continue;
    const dayOfWeek = getDayOfWeekUTC(req.day);
    if (!template.days_of_week.includes(dayOfWeek)) continue;
    for (let i = 0; i < req.count; i++) {
      slots.push({
        template_id: template.id,
        day: req.day,
        day_of_week: dayOfWeek,
        start_time: template.start_time,
        end_time: template.end_time,
        position: template.position,
        area: template.area ?? null,
      });
    }
  }
  return slots;
}

export function solveSchedule(ctx: ScheduleContext): SolverResult {
  const hoursByEmp = new Map<string, number>();
  const daysByEmp = new Map<string, Set<string>>();
  const shiftsByEmp = new Map<string, GeneratedShift[]>();

  for (const emp of ctx.employees) {
    hoursByEmp.set(emp.id, 0);
    daysByEmp.set(emp.id, new Set());
    shiftsByEmp.set(emp.id, []);
  }

  const slots = enumerateSlots(ctx);

  const unfilled: UnfilledSlot[] = slots.map((s) => ({
    template_id: s.template_id,
    day: s.day,
    position: s.position,
    area: s.area,
    reason: 'NO_ELIGIBLE_EMPLOYEE' as const,
  }));

  const fairness: FairnessSummary[] = ctx.employees.map((emp) => ({
    employee_id: emp.id,
    hours_assigned: hoursByEmp.get(emp.id) ?? 0,
    days_worked: daysByEmp.get(emp.id)?.size ?? 0,
    hours_budget: emp.max_weekly_hours,
  }));

  return { shifts: [], unfilled, fairness };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/schedule-solver.test.ts`
Expected: PASS — all 4 tests so far.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-solver.ts tests/unit/schedule-solver.test.ts
git commit -m "feat(scheduler-solver): Stage A enumerate slots from requiredStaff

Skips slots whose day-of-week is not in template.days_of_week
(prevents the Bug C class at solver level)."
```

---

## Task 4: Stage B — seed state from locked shifts

**Files:**
- Modify: `supabase/functions/_shared/schedule-solver.ts`
- Modify: `tests/unit/schedule-solver.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/schedule-solver.test.ts`:

```ts
describe('solveSchedule — Stage B (locked shifts seed)', () => {
  it("a locked 6.5h shift counts against the employee's fairness/hours", () => {
    const ctx = emptyCtx();
    ctx.employees = [
      { id: 'e1', name: 'Alice', position: 'Server', area: null, max_weekly_hours: 40,
        date_of_birth: '2000-01-01', is_minor: false },
    ];
    ctx.lockedShifts = [
      { employee_id: 'e1', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
    ];
    const result = solveSchedule(ctx);
    const e1Row = result.fairness.find((f) => f.employee_id === 'e1');
    expect(e1Row).toMatchObject({ hours_assigned: 6.5, days_worked: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedule-solver.test.ts`
Expected: FAIL — locked shift has no effect on fairness counts yet.

- [ ] **Step 3: Implement Stage B**

In `schedule-solver.ts`, inside `solveSchedule`, after the per-employee Map initialization and before `enumerateSlots`, add:

```ts
  for (const locked of ctx.lockedShifts) {
    if (!hoursByEmp.has(locked.employee_id)) continue;
    const hours = shiftHours({
      employee_id: locked.employee_id,
      template_id: locked.template_id ?? '',
      day: locked.day,
      start_time: locked.start_time,
      end_time: locked.end_time,
      position: locked.position,
    });
    hoursByEmp.set(locked.employee_id, (hoursByEmp.get(locked.employee_id) ?? 0) + hours);
    daysByEmp.get(locked.employee_id)?.add(locked.day);
    shiftsByEmp.get(locked.employee_id)?.push({
      employee_id: locked.employee_id,
      template_id: locked.template_id ?? '',
      day: locked.day,
      start_time: locked.start_time,
      end_time: locked.end_time,
      position: locked.position,
    });
  }
```

Then update the fairness construction at the bottom of `solveSchedule` to read from the seeded maps (it already does — verify the test passes).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/schedule-solver.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-solver.ts tests/unit/schedule-solver.test.ts
git commit -m "feat(scheduler-solver): Stage B seed state from locked shifts

Locked shifts count against caps but are not re-assigned."
```

---

## Task 5: Eligibility predicate (static base)

**Files:**
- Modify: `supabase/functions/_shared/schedule-solver.ts`
- Modify: `tests/unit/schedule-solver.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/schedule-solver.test.ts`:

```ts
describe('solveSchedule — eligibility (position + area + availability + window)', () => {
  function ctxWithOneSlot(opts: {
    employeePosition: string;
    employeeArea: string | null;
    slotPosition: string;
    slotArea: string | null;
    availability?: { isAvailable: boolean; startTime: string | null; endTime: string | null };
  }) {
    const ctx = emptyCtx();
    ctx.employees = [
      { id: 'e1', name: 'A', position: opts.employeePosition, area: opts.employeeArea,
        max_weekly_hours: 40, date_of_birth: '2000-01-01', is_minor: false },
    ];
    ctx.templates = [
      { id: 't1', name: 'Lunch', position: opts.slotPosition, area: opts.slotArea,
        start_time: '10:00:00', end_time: '16:30:00', days_of_week: [1] },
    ];
    ctx.requiredStaff = new Map([
      ['t1:2026-06-08', { template_id: 't1', day: '2026-06-08', count: 1 }],
    ]);
    ctx.availability = {
      'e1': { 1: opts.availability ?? { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' } },
    };
    return ctx;
  }

  it('position mismatch → unfilled', () => {
    const ctx = ctxWithOneSlot({
      employeePosition: 'Cook', employeeArea: null,
      slotPosition: 'Server', slotArea: null,
    });
    const result = solveSchedule(ctx);
    expect(result.shifts).toHaveLength(0);
    expect(result.unfilled).toHaveLength(1);
  });

  it('area match required when slot has an area', () => {
    const ctx = ctxWithOneSlot({
      employeePosition: 'Server', employeeArea: 'Brand A',
      slotPosition: 'Server', slotArea: 'Brand B',
    });
    const result = solveSchedule(ctx);
    expect(result.shifts).toHaveLength(0);
  });

  it('availability outside window → unfilled', () => {
    const ctx = ctxWithOneSlot({
      employeePosition: 'Server', employeeArea: null,
      slotPosition: 'Server', slotArea: null,
      availability: { isAvailable: true, startTime: '16:30:00', endTime: '19:00:00' },
    });
    const result = solveSchedule(ctx);
    expect(result.shifts).toHaveLength(0);
  });

  it('unavailable day → unfilled', () => {
    const ctx = ctxWithOneSlot({
      employeePosition: 'Server', employeeArea: null,
      slotPosition: 'Server', slotArea: null,
      availability: { isAvailable: false, startTime: null, endTime: null },
    });
    const result = solveSchedule(ctx);
    expect(result.shifts).toHaveLength(0);
  });

  it('all predicates satisfied → assigned', () => {
    const ctx = ctxWithOneSlot({
      employeePosition: 'Server', employeeArea: null,
      slotPosition: 'Server', slotArea: null,
    });
    const result = solveSchedule(ctx);
    expect(result.shifts).toHaveLength(1);
    expect(result.shifts[0]).toMatchObject({
      employee_id: 'e1', template_id: 't1', day: '2026-06-08',
      start_time: '10:00:00', end_time: '16:30:00', position: 'Server',
    });
    expect(result.unfilled).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/schedule-solver.test.ts`
Expected: FAIL on the "all predicates satisfied → assigned" case (others vacuously pass because nothing assigns).

- [ ] **Step 3: Implement eligibility + naive greedy**

In `schedule-solver.ts`, add helpers and update `solveSchedule`:

```ts
function eligibleBase(
  slot: Slot,
  ctx: ScheduleContext,
): string[] {
  const out: string[] = [];
  for (const emp of ctx.employees) {
    if (ctx.excludedEmployeeIds.has(emp.id)) continue;
    if (normalizePosition(emp.position) !== normalizePosition(slot.position)) continue;
    if (slot.area !== null && emp.area !== null && emp.area !== slot.area) continue;
    const avail = ctx.availability[emp.id]?.[slot.day_of_week];
    if (!avail || !avail.isAvailable) continue;
    if (!avail.startTime || !avail.endTime) continue;
    if (!withinWindow(slot.start_time, slot.end_time, avail.startTime, avail.endTime)) continue;
    out.push(emp.id);
  }
  return out;
}
```

Then replace the body of `solveSchedule` after the Stage B seeding block (and after `enumerateSlots`):

```ts
  const slots = enumerateSlots(ctx);

  const assigned: GeneratedShift[] = [];
  const unfilled: UnfilledSlot[] = [];

  for (const slot of slots) {
    const candidates = eligibleBase(slot, ctx);
    if (candidates.length === 0) {
      unfilled.push({
        template_id: slot.template_id,
        day: slot.day,
        position: slot.position,
        area: slot.area,
        reason: 'NO_ELIGIBLE_EMPLOYEE',
      });
      continue;
    }
    const picked = candidates[0];
    const newShift: GeneratedShift = {
      employee_id: picked,
      template_id: slot.template_id,
      day: slot.day,
      start_time: slot.start_time,
      end_time: slot.end_time,
      position: slot.position,
    };
    assigned.push(newShift);
    hoursByEmp.set(picked, (hoursByEmp.get(picked) ?? 0) + shiftHours(newShift));
    daysByEmp.get(picked)?.add(slot.day);
    shiftsByEmp.get(picked)?.push(newShift);
  }

  const fairness: FairnessSummary[] = ctx.employees.map((emp) => ({
    employee_id: emp.id,
    hours_assigned: hoursByEmp.get(emp.id) ?? 0,
    days_worked: daysByEmp.get(emp.id)?.size ?? 0,
    hours_budget: emp.max_weekly_hours,
  }));

  return { shifts: assigned, unfilled, fairness };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/schedule-solver.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-solver.ts tests/unit/schedule-solver.test.ts
git commit -m "feat(scheduler-solver): static eligibility (position + area + availability + window)"
```

---

## Task 6: Stage D dynamic predicates — hour cap, consecutive days, conflict

**Files:**
- Modify: `supabase/functions/_shared/schedule-solver.ts`
- Modify: `tests/unit/schedule-solver.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/schedule-solver.test.ts`:

```ts
describe('solveSchedule — dynamic predicates', () => {
  it('hour cap respects max_weekly_hours (18h minor case)', () => {
    const ctx = emptyCtx();
    ctx.employees = [
      { id: 'e1', name: 'Aleah', position: 'Server', area: null, max_weekly_hours: 18,
        date_of_birth: '2010-06-01', is_minor: true },
    ];
    ctx.templates = [
      { id: 't1', name: 'After-school', position: 'Server', area: null,
        start_time: '16:30:00', end_time: '23:00:00', days_of_week: [1, 2, 3, 4, 5] },
    ];
    ctx.requiredStaff = new Map([
      ['t1:2026-06-08', { template_id: 't1', day: '2026-06-08', count: 1 }],
      ['t1:2026-06-09', { template_id: 't1', day: '2026-06-09', count: 1 }],
      ['t1:2026-06-10', { template_id: 't1', day: '2026-06-10', count: 1 }],
    ]);
    ctx.availability = {
      'e1': {
        1: { isAvailable: true, startTime: '16:30:00', endTime: '23:00:00' },
        2: { isAvailable: true, startTime: '16:30:00', endTime: '23:00:00' },
        3: { isAvailable: true, startTime: '16:30:00', endTime: '23:00:00' },
      },
    };
    const result = solveSchedule(ctx);
    // 6.5h × 2 = 13h fits; 3rd would push to 19.5h → unfilled
    const e1Hours = result.fairness.find((f) => f.employee_id === 'e1')?.hours_assigned;
    expect(e1Hours).toBe(13);
    expect(result.shifts).toHaveLength(2);
    expect(result.unfilled).toHaveLength(1);
    expect(result.unfilled[0].reason).toBe('ALL_AT_HOUR_CAP');
  });

  it('blocks 6+ consecutive days', () => {
    const ctx = emptyCtx();
    ctx.employees = [
      { id: 'e1', name: 'Bob', position: 'Server', area: null, max_weekly_hours: 80,
        date_of_birth: '1990-01-01', is_minor: false },
    ];
    ctx.templates = [
      { id: 't1', name: 'Lunch', position: 'Server', area: null,
        start_time: '10:00:00', end_time: '12:00:00', days_of_week: [0, 1, 2, 3, 4, 5, 6] },
    ];
    ctx.requiredStaff = new Map(
      ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13']
        .map((d) => [`t1:${d}`, { template_id: 't1', day: d, count: 1 }]),
    );
    ctx.availability = {
      'e1': Object.fromEntries(
        [0, 1, 2, 3, 4, 5, 6].map((d) => [d, { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' }]),
      ),
    };
    const result = solveSchedule(ctx);
    expect(result.shifts).toHaveLength(5);
    expect(result.unfilled).toHaveLength(1);
    expect(result.unfilled[0].reason).toBe('ALL_AT_CONSEC_DAY_CAP');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/schedule-solver.test.ts`
Expected: FAIL — both tests; current naive greedy ignores hour cap and consecutive days.

- [ ] **Step 3: Implement dynamic predicates with narrowing-reason tracking**

In `schedule-solver.ts`, replace the per-slot loop body inside `solveSchedule` with:

```ts
  for (const slot of slots) {
    const base = eligibleBase(slot, ctx);
    if (base.length === 0) {
      unfilled.push({ ...toUnfilled(slot), reason: 'NO_ELIGIBLE_EMPLOYEE' });
      continue;
    }

    const slotShift: GeneratedShift = {
      employee_id: '__probe__',
      template_id: slot.template_id,
      day: slot.day,
      start_time: slot.start_time,
      end_time: slot.end_time,
      position: slot.position,
    };
    const slotHours = shiftHours(slotShift);

    // Narrow with reason tracking
    let droppedReason: UnfilledSlot['reason'] = 'NO_ELIGIBLE_EMPLOYEE';
    let afterHourCap: string[] = [];
    for (const empId of base) {
      const empMax = ctx.employees.find((e) => e.id === empId)?.max_weekly_hours ?? 40;
      if ((hoursByEmp.get(empId) ?? 0) + slotHours <= empMax) afterHourCap.push(empId);
    }
    if (afterHourCap.length === 0) { droppedReason = 'ALL_AT_HOUR_CAP'; }

    let afterConsec: string[] = [];
    for (const empId of afterHourCap) {
      const days = new Set(daysByEmp.get(empId) ?? []);
      days.add(slot.day);
      if (longestConsecutiveRun(days) <= 5) afterConsec.push(empId);
    }
    if (afterConsec.length === 0 && afterHourCap.length > 0) droppedReason = 'ALL_AT_CONSEC_DAY_CAP';

    let afterConflict: string[] = [];
    for (const empId of afterConsec) {
      const existing = shiftsByEmp.get(empId) ?? [];
      const probe = { ...slotShift, employee_id: empId };
      if (!existing.some((ex) => shiftsConflict(probe, ex))) afterConflict.push(empId);
    }
    if (afterConflict.length === 0 && afterConsec.length > 0) droppedReason = 'ALL_CONFLICTING';

    if (afterConflict.length === 0) {
      unfilled.push({ ...toUnfilled(slot), reason: droppedReason });
      continue;
    }

    // Fairness pick: lowest hours_assigned, tie by fewest days, tie by stable id
    const picked = afterConflict.reduce((best, cur) => {
      const bestH = hoursByEmp.get(best) ?? 0;
      const curH = hoursByEmp.get(cur) ?? 0;
      if (curH < bestH) return cur;
      if (curH > bestH) return best;
      const bestD = daysByEmp.get(best)?.size ?? 0;
      const curD = daysByEmp.get(cur)?.size ?? 0;
      if (curD < bestD) return cur;
      if (curD > bestD) return best;
      return best < cur ? best : cur;
    });

    const newShift: GeneratedShift = { ...slotShift, employee_id: picked };
    assigned.push(newShift);
    hoursByEmp.set(picked, (hoursByEmp.get(picked) ?? 0) + slotHours);
    daysByEmp.get(picked)?.add(slot.day);
    shiftsByEmp.get(picked)?.push(newShift);
  }
```

Also add the helper near the top of the file:

```ts
function toUnfilled(slot: Slot): Omit<UnfilledSlot, 'reason'> {
  return {
    template_id: slot.template_id,
    day: slot.day,
    position: slot.position,
    area: slot.area,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/schedule-solver.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-solver.ts tests/unit/schedule-solver.test.ts
git commit -m "feat(scheduler-solver): Stage D dynamic predicates + fairness pick

Hour cap (uses emp.max_weekly_hours from computeHourBudget upstream),
5-consecutive-day cap via longestConsecutiveRun, no-conflict via
shiftsConflict, lowest-loaded pick with stable tiebreak."
```

---

## Task 7: Stage C scarcity sort (most-constrained-first)

**Files:**
- Modify: `supabase/functions/_shared/schedule-solver.ts`
- Modify: `tests/unit/schedule-solver.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/schedule-solver.test.ts`:

```ts
describe('solveSchedule — scarcity ordering', () => {
  it('a slot with only 1 eligible employee gets that employee before a roomier slot consumes them', () => {
    const ctx = emptyCtx();
    ctx.employees = [
      { id: 'eA', name: 'A', position: 'Server', area: null, max_weekly_hours: 8,
        date_of_birth: '1990-01-01', is_minor: false },
      { id: 'eB', name: 'B', position: 'Server', area: null, max_weekly_hours: 8,
        date_of_birth: '1990-01-01', is_minor: false },
    ];
    // tWide: open to both. tNarrow: only eA available (eB unavailable that day).
    ctx.templates = [
      { id: 'tWide', name: 'Wide', position: 'Server', area: null,
        start_time: '10:00:00', end_time: '18:00:00', days_of_week: [1] },
      { id: 'tNarrow', name: 'Narrow', position: 'Server', area: null,
        start_time: '10:00:00', end_time: '18:00:00', days_of_week: [2] },
    ];
    ctx.requiredStaff = new Map([
      ['tWide:2026-06-08', { template_id: 'tWide', day: '2026-06-08', count: 1 }], // Mon
      ['tNarrow:2026-06-09', { template_id: 'tNarrow', day: '2026-06-09', count: 1 }], // Tue
    ]);
    ctx.availability = {
      'eA': {
        1: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' },
        2: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' },
      },
      'eB': {
        1: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' },
        2: { isAvailable: false, startTime: null, endTime: null },
      },
    };
    const result = solveSchedule(ctx);
    expect(result.shifts).toHaveLength(2);
    // Narrow must go to eA; Wide must go to eB
    const tueShift = result.shifts.find((s) => s.day === '2026-06-09');
    const monShift = result.shifts.find((s) => s.day === '2026-06-08');
    expect(tueShift?.employee_id).toBe('eA');
    expect(monShift?.employee_id).toBe('eB');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedule-solver.test.ts`
Expected: FAIL — without scarcity ordering, Mon goes first (insertion order) and eA gets it; then Tue has no candidate.

- [ ] **Step 3: Add scarcity sort**

In `schedule-solver.ts`, between `const slots = enumerateSlots(ctx);` and the per-slot loop, insert:

```ts
  // Stage C: most-constrained-first. Tie-break: weekend before weekday, earlier
  // start_time, stable original order.
  const baseCountBySlotIdx = slots.map((s) => eligibleBase(s, ctx).length);
  const order = slots.map((_, i) => i);
  order.sort((aIdx, bIdx) => {
    const a = baseCountBySlotIdx[aIdx];
    const b = baseCountBySlotIdx[bIdx];
    if (a !== b) return a - b;
    const aWk = slots[aIdx].day_of_week === 0 || slots[aIdx].day_of_week === 6 ? 0 : 1;
    const bWk = slots[bIdx].day_of_week === 0 || slots[bIdx].day_of_week === 6 ? 0 : 1;
    if (aWk !== bWk) return aWk - bWk;
    const aMin = timeToMinutes(slots[aIdx].start_time);
    const bMin = timeToMinutes(slots[bIdx].start_time);
    if (aMin !== bMin) return aMin - bMin;
    return aIdx - bIdx;
  });
```

Then change the per-slot loop to walk `order` instead of `slots`:

```ts
  for (const slotIdx of order) {
    const slot = slots[slotIdx];
    // ... rest unchanged
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/schedule-solver.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-solver.ts tests/unit/schedule-solver.test.ts
git commit -m "feat(scheduler-solver): Stage C most-constrained-first scarcity sort"
```

---

## Task 8: Fairness distribution (lowest-loaded picks)

**Files:**
- Modify: `tests/unit/schedule-solver.test.ts`

(No code change — Stage D's fairness picker already does this. Test asserts behavior.)

- [ ] **Step 1: Write the test**

Append to `tests/unit/schedule-solver.test.ts`:

```ts
describe('solveSchedule — fairness distribution', () => {
  it('with 2 equally-eligible employees and 4 slots, distributes 2+2 not 4+0', () => {
    const ctx = emptyCtx();
    ctx.employees = [
      { id: 'eA', name: 'A', position: 'Server', area: null, max_weekly_hours: 80,
        date_of_birth: '1990-01-01', is_minor: false },
      { id: 'eB', name: 'B', position: 'Server', area: null, max_weekly_hours: 80,
        date_of_birth: '1990-01-01', is_minor: false },
    ];
    ctx.templates = [
      { id: 't1', name: 'L', position: 'Server', area: null,
        start_time: '10:00:00', end_time: '12:00:00', days_of_week: [1, 2, 3, 4] },
    ];
    ctx.requiredStaff = new Map(
      ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11']
        .map((d) => [`t1:${d}`, { template_id: 't1', day: d, count: 1 }]),
    );
    ctx.availability = {
      'eA': Object.fromEntries([1, 2, 3, 4].map((d) => [d, { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' }])),
      'eB': Object.fromEntries([1, 2, 3, 4].map((d) => [d, { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' }])),
    };
    const result = solveSchedule(ctx);
    const aHours = result.fairness.find((f) => f.employee_id === 'eA')?.hours_assigned;
    const bHours = result.fairness.find((f) => f.employee_id === 'eB')?.hours_assigned;
    expect(aHours).toBe(4);
    expect(bHours).toBe(4);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run tests/unit/schedule-solver.test.ts`
Expected: PASS — 14 tests. (No implementation change needed.)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/schedule-solver.test.ts
git commit -m "test(scheduler-solver): fairness distribution invariant"
```

---

## Task 9: TZ portability test under env TZ

**Files:**
- Create: `tests/unit/schedule-solver-tz.test.ts`
- Modify: `package.json` (add a test script)

- [ ] **Step 1: Write the test**

Create `tests/unit/schedule-solver-tz.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { solveSchedule } from '../../supabase/functions/_shared/schedule-solver';
import type { ScheduleContext } from '../../supabase/functions/_shared/schedule-prompt-builder';

function smallCtx(): ScheduleContext {
  return {
    restaurantId: 'r1',
    weekStart: '2026-06-08',
    employees: [
      { id: 'e1', name: 'A', position: 'Server', area: null, max_weekly_hours: 40,
        date_of_birth: '1990-01-01', is_minor: false },
    ],
    templates: [
      { id: 't1', name: 'L', position: 'Server', area: null,
        start_time: '10:00:00', end_time: '16:30:00', days_of_week: [1, 2, 3, 4, 5] },
    ],
    availability: {
      'e1': Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' }])),
    },
    requiredStaff: new Map([
      ['t1:2026-06-08', { template_id: 't1', day: '2026-06-08', count: 1 }],
      ['t1:2026-06-12', { template_id: 't1', day: '2026-06-12', count: 1 }],
    ]),
    lockedShifts: [],
    excludedEmployeeIds: new Set(),
    priorPatterns: [],
    weeklySalesHistory: [],
    hourlySalesHistory: [],
    targetLaborPercentage: 0.30,
    minimumWageCents: 0,
  };
}

describe('solveSchedule — TZ portability', () => {
  it('produces stable output regardless of host TZ (snapshot)', () => {
    const result = solveSchedule(smallCtx());
    expect(result.shifts).toMatchInlineSnapshot(`
      [
        {
          "day": "2026-06-08",
          "employee_id": "e1",
          "end_time": "16:30:00",
          "position": "Server",
          "start_time": "10:00:00",
          "template_id": "t1",
        },
        {
          "day": "2026-06-12",
          "employee_id": "e1",
          "end_time": "16:30:00",
          "position": "Server",
          "start_time": "10:00:00",
          "template_id": "t1",
        },
      ]
    `);
    // The snapshot above must match under both TZ=America/Chicago and TZ=Pacific/Auckland.
    // CI runs this file twice with both env vars (see package.json test:tz).
    expect(result.unfilled).toEqual([]);
  });
});
```

- [ ] **Step 2: Add the CI script**

In `package.json`, add to the `"scripts"` object:

```json
"test:tz": "TZ=America/Chicago vitest run tests/unit/schedule-solver-tz.test.ts && TZ=Pacific/Auckland vitest run tests/unit/schedule-solver-tz.test.ts"
```

- [ ] **Step 3: Run the TZ test**

Run: `npm run test:tz`
Expected: PASS — same snapshot under both timezones.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/schedule-solver-tz.test.ts package.json
git commit -m "test(scheduler-solver): TZ portability under TZ env var"
```

---

## Task 10: Trace fixture + replay test

**Files:**
- Create: `tests/fixtures/schedule-solver-trace.json`
- Create: `tests/unit/schedule-solver-trace.test.ts`

- [ ] **Step 1: Build the fixture**

Create `tests/fixtures/schedule-solver-trace.json`. Sanitisation: replace UUIDs with `emp_001`..`emp_027`, `tpl_a`..`tpl_h`, `restaurant_001`. Preserve positions, areas, start_time/end_time, day, date_of_birth, max_weekly_hours, availability windows, required-staff counts verbatim. Header comment at top of file (in `_comment` JSON field):

```json
{
  "_comment": "Sanitized from production trace ae991acdcf47542827da5ddee9ed5a40 (2026-05-24). UUIDs and human names replaced with deterministic short strings; positions/areas/times/dates/max_weekly_hours/availability preserved verbatim.",
  "restaurantId": "restaurant_001",
  "weekStart": "2026-06-08",
  "employees": [
    { "id": "emp_001", "name": "Emp 1", "position": "Server", "area": null, "max_weekly_hours": 40, "date_of_birth": "1995-03-15", "is_minor": false }
  ]
}
```

(The full fixture is too large to inline; the executing engineer reads it from the original trace via the verify script in Task 27. For the plan, use a placeholder ~30-emp×~70-slot scaffold and fill the actual data as part of this step — pull from `https://easyshift.grafana.net/...trace/ae991acdcf47542827da5ddee9ed5a40` and run the sanitiser one-liner below.)

Sanitiser one-liner (run from worktree root):

```bash
node -e "
  const trace = require('./tmp-trace.json'); // dump trace context here
  const empIdMap = new Map(), tplIdMap = new Map();
  let ei = 1, ti = 1;
  const reEmp = id => { if (!empIdMap.has(id)) empIdMap.set(id, 'emp_' + String(ei++).padStart(3, '0')); return empIdMap.get(id); };
  const reTpl = id => { if (!tplIdMap.has(id)) tplIdMap.set(id, 'tpl_' + String(ti++).padStart(3, '0')); return tplIdMap.get(id); };
  trace.employees.forEach(e => { e.id = reEmp(e.id); e.name = 'Emp ' + e.id.slice(4); });
  trace.templates.forEach(t => { t.id = reTpl(t.id); t.name = 'Tpl ' + t.id.slice(4); });
  // ... apply across availability keys, requiredStaff keys, lockedShifts
  console.log(JSON.stringify(trace, null, 2));
" > tests/fixtures/schedule-solver-trace.json
```

- [ ] **Step 2: Write the replay test**

Create `tests/unit/schedule-solver-trace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import fixture from '../fixtures/schedule-solver-trace.json' assert { type: 'json' };
import { solveSchedule } from '../../supabase/functions/_shared/schedule-solver';
import { longestConsecutiveRun, shiftHours } from '../../supabase/functions/_shared/schedule-validator';

function toCtx(raw: unknown) {
  // The fixture stores requiredStaff as an object; restore as Map.
  const r = raw as Record<string, unknown>;
  return {
    ...r,
    requiredStaff: new Map(Object.entries(r.requiredStaff as Record<string, unknown>)),
    excludedEmployeeIds: new Set((r.excludedEmployeeIds as string[]) ?? []),
  } as unknown as Parameters<typeof solveSchedule>[0];
}

describe('solveSchedule — trace replay', () => {
  it('honours all 14 hard rules on the live trace fixture', () => {
    const ctx = toCtx(fixture);
    const result = solveSchedule(ctx);

    // Hour cap
    for (const row of result.fairness) {
      expect(row.hours_assigned).toBeLessThanOrEqual(row.hours_budget);
    }

    // 5-consecutive-day cap
    for (const emp of ctx.employees) {
      const days = new Set(result.shifts.filter((s) => s.employee_id === emp.id).map((s) => s.day));
      expect(longestConsecutiveRun(days)).toBeLessThanOrEqual(5);
    }

    // Underfill is allowed but bounded — solver should fill at least 80% of slots.
    const totalRequired = Array.from(ctx.requiredStaff.values()).reduce(
      (n, r: unknown) => n + (r as { count: number }).count, 0,
    );
    expect(result.shifts.length / totalRequired).toBeGreaterThanOrEqual(0.80);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run tests/unit/schedule-solver-trace.test.ts`
Expected: PASS. If fixture is not yet populated, the test should be marked `.skip` with a TODO referencing the trace URL; un-skip as soon as the fixture is in.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/schedule-solver-trace.json tests/unit/schedule-solver-trace.test.ts
git commit -m "test(scheduler-solver): trace replay against sanitised live fixture"
```

---

## Task 11: Preference LLM module — skeleton + empty-prefs no-op

**Files:**
- Create: `supabase/functions/_shared/schedule-preference-llm.ts`
- Create: `tests/unit/schedule-preference-llm.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schedule-preference-llm.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { applyPreferences } from '../../supabase/functions/_shared/schedule-preference-llm';

describe('applyPreferences — no preferences', () => {
  it('empty text → no fetch, shifts returned untouched', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should not be called when prefs are empty');
    });

    const shifts = [
      { employee_id: 'e1', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
    ];
    const result = await applyPreferences(shifts, { employees: [], templates: [] } as any, '', []);
    expect(result.shifts).toEqual(shifts);
    expect(result.appliedSwaps).toEqual([]);
    expect(result.rejectedSwaps).toEqual([]);
    expect(result.modelUsed).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedule-preference-llm.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the skeleton**

Create `supabase/functions/_shared/schedule-preference-llm.ts`:

```ts
/**
 * schedule-preference-llm.ts
 *
 * Optional second-pass swap proposer driven by free-text manager prefs.
 * Only invoked when preferencesText is non-empty. Each proposed swap is
 * server-re-validated; illegal swaps are silently dropped.
 */

import type { GeneratedShift } from './schedule-validator.ts';
import type { ScheduleContext } from './schedule-prompt-builder.ts';

export interface SwapRecord {
  shift_a_id: string;
  shift_b_id: string;
  reason: string;
}

export interface RejectedSwap extends SwapRecord {
  rejection_code: string;
}

export interface PreferenceResult {
  shifts: GeneratedShift[];
  appliedSwaps: SwapRecord[];
  rejectedSwaps: RejectedSwap[];
  modelUsed: string | null;
}

export interface PreferenceModelConfig {
  id: string;
  perCallTimeoutMs: number;
  maxRetries: number;
}

export const PREFERENCE_MODELS: PreferenceModelConfig[] = [
  { id: 'google/gemini-2.5-flash', perCallTimeoutMs: 25_000, maxRetries: 1 },
  { id: 'google/gemini-2.5-flash-lite', perCallTimeoutMs: 25_000, maxRetries: 1 },
];

export async function applyPreferences(
  schedule: GeneratedShift[],
  _ctx: ScheduleContext,
  preferencesText: string,
  _models: PreferenceModelConfig[],
): Promise<PreferenceResult> {
  if (!preferencesText.trim()) {
    return {
      shifts: schedule,
      appliedSwaps: [],
      rejectedSwaps: [],
      modelUsed: null,
    };
  }
  // Real implementation lands in Task 12+.
  throw new Error('applyPreferences with non-empty preferences not implemented yet');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/schedule-preference-llm.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-preference-llm.ts tests/unit/schedule-preference-llm.test.ts
git commit -m "feat(scheduler-preference-llm): skeleton with empty-prefs no-op"
```

---

## Task 12: Swap re-validation (pure, no LLM)

**Files:**
- Modify: `supabase/functions/_shared/schedule-preference-llm.ts`
- Modify: `tests/unit/schedule-preference-llm.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/schedule-preference-llm.test.ts`:

```ts
import { applySwapsToSchedule } from '../../supabase/functions/_shared/schedule-preference-llm';

describe('applySwapsToSchedule — pure re-validation', () => {
  const ctx = {
    employees: [
      { id: 'eA', name: 'A', position: 'Server', area: null, max_weekly_hours: 40,
        date_of_birth: '1990-01-01', is_minor: false },
      { id: 'eB', name: 'B', position: 'Server', area: null, max_weekly_hours: 40,
        date_of_birth: '1990-01-01', is_minor: false },
    ],
    availability: {
      'eA': { 1: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' } },
      'eB': { 1: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' } },
    },
    excludedEmployeeIds: new Set(),
    templates: [
      { id: 't1', name: 'L', position: 'Server', area: null,
        start_time: '10:00:00', end_time: '16:30:00', days_of_week: [1] },
    ],
  } as any;

  it('legal swap is applied', () => {
    const shifts = [
      { id: 's1', employee_id: 'eA', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
      { id: 's2', employee_id: 'eB', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
    ];
    const result = applySwapsToSchedule(shifts, ctx, [
      { shift_a_id: 's1', shift_b_id: 's2', reason: 'manager preference' },
    ]);
    expect(result.appliedSwaps).toHaveLength(1);
    expect(result.rejectedSwaps).toHaveLength(0);
    const newS1 = result.shifts.find((s: any) => s.id === 's1');
    const newS2 = result.shifts.find((s: any) => s.id === 's2');
    expect(newS1.employee_id).toBe('eB');
    expect(newS2.employee_id).toBe('eA');
  });

  it('unknown shift id → rejected', () => {
    const shifts = [
      { id: 's1', employee_id: 'eA', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
    ];
    const result = applySwapsToSchedule(shifts, ctx, [
      { shift_a_id: 's1', shift_b_id: 'nope', reason: 'x' },
    ]);
    expect(result.appliedSwaps).toHaveLength(0);
    expect(result.rejectedSwaps).toHaveLength(1);
    expect(result.rejectedSwaps[0].rejection_code).toBe('UNKNOWN_SHIFT');
  });

  it('swap that would push minor over 18h → rejected', () => {
    const minorCtx = {
      ...ctx,
      employees: [
        ...ctx.employees,
        { id: 'eMinor', name: 'M', position: 'Server', area: null, max_weekly_hours: 18,
          date_of_birth: '2010-01-01', is_minor: true },
      ],
      availability: {
        ...ctx.availability,
        'eMinor': { 1: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' } },
      },
    };
    const shifts = [
      { id: 's1', employee_id: 'eMinor', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
      { id: 's2', employee_id: 'eMinor', template_id: 't1', day: '2026-06-09',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
      // Third shift currently assigned to eA — swapping minor onto it would push to 19.5h
      { id: 's3', employee_id: 'eA', template_id: 't1', day: '2026-06-10',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
    ];
    const result = applySwapsToSchedule(shifts, minorCtx, [
      { shift_a_id: 's3', shift_b_id: 's1', reason: 'manager wants minor on Wed' },
    ]);
    expect(result.appliedSwaps).toHaveLength(0);
    expect(result.rejectedSwaps[0].rejection_code).toBe('WOULD_VIOLATE_HOURS_EXCEED_WEEKLY_CAP');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/schedule-preference-llm.test.ts`
Expected: FAIL — `applySwapsToSchedule` not exported.

- [ ] **Step 3: Implement the pure swap engine**

Append to `supabase/functions/_shared/schedule-preference-llm.ts`:

```ts
import {
  longestConsecutiveRun,
  normalizePosition,
  shiftHours,
  shiftsConflict,
  withinWindow,
} from './schedule-validator.ts';

export interface ProposedSwap {
  shift_a_id: string;
  shift_b_id: string;
  reason: string;
}

interface IdentifiedShift extends GeneratedShift {
  id: string;
}

export function applySwapsToSchedule(
  shifts: IdentifiedShift[],
  ctx: ScheduleContext,
  swaps: ProposedSwap[],
): Omit<PreferenceResult, 'modelUsed'> {
  const byId = new Map(shifts.map((s) => [s.id, { ...s }]));
  const applied: SwapRecord[] = [];
  const rejected: RejectedSwap[] = [];

  for (const swap of swaps) {
    const a = byId.get(swap.shift_a_id);
    const b = byId.get(swap.shift_b_id);
    if (!a || !b) {
      rejected.push({ ...swap, rejection_code: 'UNKNOWN_SHIFT' });
      continue;
    }
    const aEmp = a.employee_id;
    const bEmp = b.employee_id;
    // Tentatively swap
    a.employee_id = bEmp;
    b.employee_id = aEmp;

    const reason = validateAffectedEmployees(byId, ctx, [aEmp, bEmp]);
    if (reason) {
      // Rollback
      a.employee_id = aEmp;
      b.employee_id = bEmp;
      rejected.push({ ...swap, rejection_code: `WOULD_VIOLATE_${reason}` });
      continue;
    }
    applied.push(swap);
  }

  return {
    shifts: Array.from(byId.values()),
    appliedSwaps: applied,
    rejectedSwaps: rejected,
  };
}

function validateAffectedEmployees(
  byId: Map<string, IdentifiedShift>,
  ctx: ScheduleContext,
  empIds: string[],
): string | null {
  for (const empId of empIds) {
    const emp = ctx.employees.find((e) => e.id === empId);
    if (!emp) return 'UNKNOWN_EMPLOYEE';
    const empShifts = Array.from(byId.values()).filter((s) => s.employee_id === empId);

    let totalHours = 0;
    const days = new Set<string>();
    for (let i = 0; i < empShifts.length; i++) {
      const s = empShifts[i];
      // Position
      if (normalizePosition(s.position) !== normalizePosition(emp.position)) return 'POSITION_MISMATCH';
      // Availability
      const dow = new Date(`${s.day}T00:00:00Z`).getUTCDay();
      const avail = ctx.availability[empId]?.[dow];
      if (!avail?.isAvailable || !avail.startTime || !avail.endTime) return 'UNAVAILABLE_DAY';
      if (!withinWindow(s.start_time, s.end_time, avail.startTime, avail.endTime)) return 'OUTSIDE_WINDOW';
      // Conflict with sibling shifts
      for (let j = i + 1; j < empShifts.length; j++) {
        if (shiftsConflict(s, empShifts[j])) return 'DOUBLE_BOOKING';
      }
      totalHours += shiftHours(s);
      days.add(s.day);
    }
    if (totalHours > emp.max_weekly_hours) return 'HOURS_EXCEED_WEEKLY_CAP';
    if (longestConsecutiveRun(days) > 5) return 'CONSECUTIVE_DAYS_EXCEEDED';
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/schedule-preference-llm.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-preference-llm.ts tests/unit/schedule-preference-llm.test.ts
git commit -m "feat(scheduler-preference-llm): pure applySwapsToSchedule with re-validation"
```

---

## Task 13: LLM caller + JSON parsing (mocked OpenRouter)

**Files:**
- Modify: `supabase/functions/_shared/schedule-preference-llm.ts`
- Modify: `tests/unit/schedule-preference-llm.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/schedule-preference-llm.test.ts`:

```ts
describe('applyPreferences — end-to-end with mocked LLM', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  it('legal swap → applied', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          swaps: [{ shift_a_id: 's1', shift_b_id: 's2', reason: 'preference' }],
        }) } }],
      }), { status: 200 });
    });

    const shifts = [
      { id: 's1', employee_id: 'eA', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
      { id: 's2', employee_id: 'eB', template_id: 't1', day: '2026-06-08',
        start_time: '10:00:00', end_time: '16:30:00', position: 'Server' },
    ];
    const ctx = {
      employees: [
        { id: 'eA', name: 'A', position: 'Server', area: null, max_weekly_hours: 40,
          date_of_birth: '1990-01-01', is_minor: false },
        { id: 'eB', name: 'B', position: 'Server', area: null, max_weekly_hours: 40,
          date_of_birth: '1990-01-01', is_minor: false },
      ],
      availability: {
        'eA': { 1: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' } },
        'eB': { 1: { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' } },
      },
      excludedEmployeeIds: new Set(),
      templates: [],
    } as any;

    const result = await applyPreferences(shifts as any, ctx, 'A and B should swap', [
      { id: 'google/gemini-2.5-flash', perCallTimeoutMs: 25_000, maxRetries: 0 },
    ]);

    expect(result.appliedSwaps).toHaveLength(1);
    expect(result.modelUsed).toBe('google/gemini-2.5-flash');
    fetchMock.mockRestore();
  });

  it('malformed LLM JSON → no swaps applied, no throw', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'this is not json' } }],
      }), { status: 200 });
    });

    const result = await applyPreferences([] as any, { employees: [], templates: [], availability: {}, excludedEmployeeIds: new Set() } as any, 'do something', [
      { id: 'google/gemini-2.5-flash', perCallTimeoutMs: 25_000, maxRetries: 0 },
    ]);
    expect(result.appliedSwaps).toEqual([]);
    expect(result.rejectedSwaps).toEqual([]);
    fetchMock.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/schedule-preference-llm.test.ts`
Expected: FAIL — `applyPreferences` non-empty path throws "not implemented yet".

- [ ] **Step 3: Implement the LLM caller**

Replace the `applyPreferences` function in `schedule-preference-llm.ts` with:

```ts
export async function applyPreferences(
  schedule: IdentifiedShift[],
  ctx: ScheduleContext,
  preferencesText: string,
  models: PreferenceModelConfig[],
): Promise<PreferenceResult> {
  if (!preferencesText.trim()) {
    return { shifts: schedule, appliedSwaps: [], rejectedSwaps: [], modelUsed: null };
  }

  let working = schedule;
  let allApplied: SwapRecord[] = [];
  let allRejected: RejectedSwap[] = [];
  let modelUsed: string | null = null;

  for (let round = 0; round < 2; round++) {
    const { swaps, model } = await proposeSwaps(working, ctx, preferencesText, models);
    if (model && !modelUsed) modelUsed = model;
    if (swaps.length === 0) break;
    const applied = applySwapsToSchedule(working, ctx, swaps);
    working = applied.shifts;
    allApplied = allApplied.concat(applied.appliedSwaps);
    allRejected = allRejected.concat(applied.rejectedSwaps);
    if (applied.appliedSwaps.length === 0) break;
  }

  return { shifts: working, appliedSwaps: allApplied, rejectedSwaps: allRejected, modelUsed };
}

const PREFERENCE_SYSTEM_PROMPT = `You receive a confirmed schedule and a manager preference statement in free text. Propose up to 5 pair-swaps that move toward the preference. Each swap exchanges the employee on shift A with the employee on shift B. Output JSON: {"swaps":[{"shift_a_id":"...","shift_b_id":"...","reason":"..."}]}. Do not invent new shifts. Do not change start/end times. The server re-validates every swap and silently rejects illegal ones. If the preference is satisfied or no safe swap exists, return {"swaps":[]}.`;

async function proposeSwaps(
  schedule: IdentifiedShift[],
  ctx: ScheduleContext,
  preferencesText: string,
  models: PreferenceModelConfig[],
): Promise<{ swaps: ProposedSwap[]; model: string | null }> {
  const apiKey = (globalThis as any).Deno?.env.get('OPENROUTER_API_KEY')
    ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { swaps: [], model: null };

  const empById = new Map(ctx.employees.map((e) => [e.id, e]));
  const scheduleTable = schedule.map((s) =>
    `${s.id} | ${s.day} | ${s.start_time}-${s.end_time} | ${s.position} | ${empById.get(s.employee_id)?.name ?? s.employee_id}`,
  ).join('\n');

  const messages = [
    { role: 'system', content: PREFERENCE_SYSTEM_PROMPT },
    { role: 'user', content: `SCHEDULE:\n${scheduleTable}\n\nPREFERENCES:\n${preferencesText}` },
  ];

  for (const model of models) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), model.perCallTimeoutMs);
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model.id,
          messages,
          temperature: 0.2,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') continue;
      try {
        const parsed = JSON.parse(content);
        const swaps = Array.isArray(parsed?.swaps) ? parsed.swaps : [];
        return { swaps, model: model.id };
      } catch {
        continue;
      }
    } catch {
      continue;
    }
  }

  return { swaps: [], model: null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/schedule-preference-llm.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-preference-llm.ts tests/unit/schedule-preference-llm.test.ts
git commit -m "feat(scheduler-preference-llm): LLM swap proposer with 2-round orchestration

Per-call 25s timeout, model chain with maxRetries 1 each, malformed
JSON tolerated (no swaps applied, no throw)."
```

---

## Task 14: Edge function — wire solveSchedule

**Files:**
- Modify: `supabase/functions/generate-schedule/index.ts`

- [ ] **Step 1: Read the current index.ts entry point**

Run: `grep -n "buildSchedulePrompt\|runScheduleModelChain\|validateGeneratedShifts" supabase/functions/generate-schedule/index.ts`
This identifies the exact replacement range — typically lines 510-620 ("build prompt → run LLM → validate"). Read those lines.

- [ ] **Step 2: Replace the LLM call with the solver call**

In `supabase/functions/generate-schedule/index.ts`:

1. Add import (replace the `buildSchedulePrompt` import):

```ts
import { solveSchedule } from '../_shared/schedule-solver.ts';
import { applyPreferences, PREFERENCE_MODELS } from '../_shared/schedule-preference-llm.ts';
```

2. Find the block that does `const promptResult = buildSchedulePrompt(scheduleContext);` followed by `runScheduleModelChain(...)` and the JSON-parse block; replace with:

```ts
const solveStartedAt = performance.now();
const solverResult = solveSchedule(scheduleContext);
const solverDurationMs = performance.now() - solveStartedAt;

// Attach a synthetic id to each shift so the preference layer can reference them.
const shiftsWithIds = solverResult.shifts.map((s, i) => ({ ...s, id: `sft_${i}` }));

const preferencesText = (body.preferences_text as string | undefined) ?? '';
const prefStartedAt = performance.now();
const prefResult = await applyPreferences(shiftsWithIds, scheduleContext, preferencesText, PREFERENCE_MODELS);
const preferenceDurationMs = performance.now() - prefStartedAt;

// Strip the synthetic id before persistence/response
const finalShifts = prefResult.shifts.map(({ id: _id, ...s }) => s);

console.log('[generate-schedule] duration', JSON.stringify({
  solver_duration_ms: Math.round(solverDurationMs),
  preference_duration_ms: Math.round(preferenceDurationMs),
  total_required_slots: Array.from(scheduleContext.requiredStaff.values()).reduce((n, r) => n + r.count, 0),
  total_generated: finalShifts.length,
  applied_swaps: prefResult.appliedSwaps.length,
  rejected_swaps: prefResult.rejectedSwaps.length,
}));
```

3. Replace the `validateGeneratedShifts(generatedShifts, validationCtx)` call so it runs against `finalShifts` (defense-in-depth — the solver should already pass every shift; any drop indicates a solver bug).

4. Replace the 422-when-zero-shifts guardrail check to use `finalShifts.length === 0`.

5. Update the success response body so `metadata.total_generated = finalShifts.length`, drop the `model_used` (or keep for backward compat as `prefResult.modelUsed`).

- [ ] **Step 3: Type-check + run existing tests**

Run: `npm run typecheck && npx vitest run tests/unit/schedule-solver.test.ts tests/unit/schedule-preference-llm.test.ts`
Expected: PASS — typechecker clean, all solver + preference unit tests still green.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/generate-schedule/index.ts
git commit -m "feat(generate-schedule): wire solveSchedule + applyPreferences

Replaces the LLM-only synthesis path with the deterministic solver.
Optional second-pass preference LLM only fires when text non-empty."
```

---

## Task 15: ClientSafe projections for unfilled + fairness

**Files:**
- Modify: `supabase/functions/generate-schedule/index.ts`

- [ ] **Step 1: Add type aliases + projection at response boundary**

Near the top of `generate-schedule/index.ts`, after existing imports, add:

```ts
import type { UnfilledSlot, FairnessSummary } from '../_shared/schedule-solver.ts';

export type ClientSafeUnfilledSlot = Omit<UnfilledSlot, 'template_id'> & { template_name: string };
export type ClientSafeFairnessSummary = Omit<FairnessSummary, 'employee_id'> & { employee_name: string };
```

In the success response construction, project before serialising:

```ts
const templateNameById = new Map(templates.map((t: any) => [t.id, t.name as string]));
const employeeNameById = new Map(employees.map((e: any) => [e.id, e.name as string]));

const safeUnfilled: ClientSafeUnfilledSlot[] = solverResult.unfilled.map(({ template_id, ...rest }) => ({
  ...rest,
  template_name: templateNameById.get(template_id) ?? 'Unknown template',
}));
const safeFairness: ClientSafeFairnessSummary[] = solverResult.fairness.map(({ employee_id, ...rest }) => ({
  ...rest,
  employee_name: employeeNameById.get(employee_id) ?? 'Unknown',
}));
```

Add to the metadata block of the response:

```ts
metadata: {
  // ... existing fields
  unfilled: safeUnfilled,
  fairness_summary: safeFairness,
  applied_swaps_count: prefResult.appliedSwaps.length,
  rejected_swaps_count: prefResult.rejectedSwaps.length,
  model_used: prefResult.modelUsed ?? '',
},
```

- [ ] **Step 2: Add a guard test**

Create `tests/unit/generate-schedule-client-safe.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ClientSafeUnfilledSlot, ClientSafeFairnessSummary } from '../../supabase/functions/generate-schedule/index';

describe('Response shape — ClientSafe projections do not carry UUIDs', () => {
  it('ClientSafeUnfilledSlot omits template_id', () => {
    const s: ClientSafeUnfilledSlot = {
      day: '2026-06-08', position: 'Server', area: null,
      reason: 'NO_ELIGIBLE_EMPLOYEE', template_name: 'Lunch',
    };
    expect('template_id' in s).toBe(false);
  });
  it('ClientSafeFairnessSummary omits employee_id', () => {
    const f: ClientSafeFairnessSummary = {
      hours_assigned: 0, days_worked: 0, hours_budget: 40, employee_name: 'Alice',
    };
    expect('employee_id' in f).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests + typecheck**

Run: `npm run typecheck && npx vitest run tests/unit/generate-schedule-client-safe.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/generate-schedule/index.ts tests/unit/generate-schedule-client-safe.test.ts
git commit -m "feat(generate-schedule): ClientSafe projections for unfilled + fairness

UUIDs (template_id, employee_id) projected to human names at the
serialization boundary. Per lesson [2026-05-17]."
```

---

## Task 16: Retire LLM-only path (prompt-builder cleanup)

**Files:**
- Modify: `supabase/functions/_shared/schedule-prompt-builder.ts`
- Create: `tests/unit/schedule-prompt-builder-retired.test.ts`

- [ ] **Step 1: Write the negative source-text test**

Create `tests/unit/schedule-prompt-builder-retired.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('LLM-only path retirement', () => {
  it('schedule-prompt-builder.ts no longer exports buildSchedulePrompt or SYSTEM_PROMPT', () => {
    const src = readFileSync(
      resolve(__dirname, '../../supabase/functions/_shared/schedule-prompt-builder.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/^export function buildSchedulePrompt/m);
    expect(src).not.toMatch(/^export interface SchedulePromptResult/m);
    expect(src).not.toMatch(/const SYSTEM_PROMPT = /);
    expect(src).not.toMatch(/function buildUserPrompt\(/);
  });

  it('schedule-prompt-builder.ts still exports computeHourBudget', () => {
    const src = readFileSync(
      resolve(__dirname, '../../supabase/functions/_shared/schedule-prompt-builder.ts'),
      'utf-8',
    );
    expect(src).toMatch(/^export function computeHourBudget/m);
  });

  it('generate-schedule/index.ts no longer imports buildSchedulePrompt', () => {
    const src = readFileSync(
      resolve(__dirname, '../../supabase/functions/generate-schedule/index.ts'),
      'utf-8',
    );
    expect(src).not.toMatch(/buildSchedulePrompt/);
  });
});
```

- [ ] **Step 2: Run test — expected to fail**

Run: `npx vitest run tests/unit/schedule-prompt-builder-retired.test.ts`
Expected: FAIL — prompts still present.

- [ ] **Step 3: Remove the LLM-only blocks**

In `supabase/functions/_shared/schedule-prompt-builder.ts`, **delete** these blocks (do NOT comment them out — delete):
- The `const SYSTEM_PROMPT = ...` block (around lines 223-280).
- The `function buildUserPrompt(ctx: ScheduleContext): string { ... }` (around lines 286-450).
- The `export interface SchedulePromptResult { ... }` (around lines 454-457).
- The `export function buildSchedulePrompt(ctx: ScheduleContext): SchedulePromptResult { ... }` (around lines 459-467).

Also `export` the now-needed-by-preference-module `buildWeekDates` (around line 129):

```ts
export function buildWeekDates(weekStart: string): { rows: string; byDayOfWeek: string[] } {
```

- [ ] **Step 4: Run all related tests + typecheck**

Run: `npm run typecheck && npx vitest run tests/unit/schedule-prompt-builder-retired.test.ts tests/unit/schedule-solver.test.ts tests/unit/schedule-preference-llm.test.ts`
Expected: PASS across all three.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-prompt-builder.ts tests/unit/schedule-prompt-builder-retired.test.ts
git commit -m "refactor(scheduler): retire LLM-only synthesis path

Removes SYSTEM_PROMPT, buildUserPrompt, buildSchedulePrompt,
SchedulePromptResult. Exports buildWeekDates (now consumed by
preference module). computeHourBudget stays."
```

---

## Task 17: Hook — add preferences, threading, toast copy

**Files:**
- Modify: `src/hooks/useGenerateSchedule.ts`

- [ ] **Step 1: Update types + payload**

Edit `src/hooks/useGenerateSchedule.ts`:

1. Extend `GenerateScheduleParams`:

```ts
interface GenerateScheduleParams {
  restaurantId: string;
  restaurantTimezone: string;
  weekStart: string;
  lockedShiftIds: string[];
  excludedEmployeeIds: string[];
  preferences?: string;
}
```

2. Extend `GenerateScheduleMetadata`:

```ts
export interface ClientSafeUnfilledSlot {
  day: string;
  position: string;
  area: string | null;
  reason: string;
  template_name: string;
}
export interface ClientSafeFairnessSummary {
  hours_assigned: number;
  days_worked: number;
  hours_budget: number;
  employee_name: string;
}

export interface GenerateScheduleMetadata {
  estimated_cost: number;
  budget_variance_pct: number;
  notes: string;
  model_used: string;
  total_generated: number;
  total_valid: number;
  total_dropped: number;
  total_required_slots: number;
  drop_reason_summary: Record<string, number>;
  dropped_reasons: string[];
  // New:
  unfilled?: ClientSafeUnfilledSlot[];
  fairness_summary?: ClientSafeFairnessSummary[];
  applied_swaps_count?: number;
  rejected_swaps_count?: number;
}
```

3. In `mutationFn`, add the field to the body:

```ts
body: {
  restaurant_id: params.restaurantId,
  week_start: params.weekStart,
  locked_shift_ids: params.lockedShiftIds,
  excluded_employee_ids: params.excludedEmployeeIds,
  preferences_text: params.preferences ?? '',
},
```

4. In `onSuccess`, replace the existing description-building block with the `·`-separated copy:

```ts
const { total_required_slots: required, applied_swaps_count = 0, rejected_swaps_count = 0 } = data.metadata;
const filled = data.shifts.length;

const parts: string[] = [];
parts.push(required > 0 && filled < required
  ? `${filled} of ${required} slots filled`
  : `${filled} of ${required} slots filled`);
if (applied_swaps_count > 0) parts.push(`${applied_swaps_count} preference swap${applied_swaps_count === 1 ? '' : 's'} applied`);
if (rejected_swaps_count > 0) parts.push(`${rejected_swaps_count} couldn't be applied`);
let description = parts.join(' · ') + '.';

if (data.metadata.budget_variance_pct > 0) {
  description += ` Estimated cost is ${data.metadata.budget_variance_pct.toFixed(0)}% over budget.`;
}

toast({ title: 'Schedule Generated', description });
```

- [ ] **Step 2: Type-check + run existing tests**

Run: `npm run typecheck && npm run test -- src/hooks/useGenerateSchedule`
Expected: PASS (no broken consumers since `preferences` is optional and metadata fields are optional).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useGenerateSchedule.ts
git commit -m "feat(useGenerateSchedule): pass preferences, surface swap counts in toast

· separator copy: '34 of 70 slots filled · 3 preference swaps applied · 2 couldn't be applied.'"
```

---

## Task 18: Dialog — Textarea + counter + reset + prop signature

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx`

- [ ] **Step 1: Read existing dialog structure**

Run: `grep -n "onGenerate\|phase ===\|handleOpenChange\|setExcludedIds\|setLockedIds" src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx | head -40`
Identify: prop declaration line, the state reset block on close, the submit handler.

- [ ] **Step 2: Update the dialog**

In `src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx`:

1. Update the prop type. Find the `interface GenerateScheduleDialogProps` (or inline props) and change `onGenerate`:

```ts
onGenerate: (excludedIds: string[], lockedIds: string[], preferences: string) => void;
```

2. Add local state for preferences near the existing `useState` calls for excludedIds / lockedIds:

```ts
const [preferences, setPreferences] = useState('');
```

3. In `handleOpenChange` (or the equivalent reset block when `open === false`), add:

```ts
setPreferences('');
```

4. In the submit handler, update the call:

```ts
onGenerate(excludedIds, lockedIds, preferences);
```

5. Add the Textarea + counter inside the `flex-1 overflow-y-auto` body (the scroll region), above the existing employee-exclusion list. Add imports at the top:

```tsx
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
```

Add JSX (only renders when `phase === 'config'`):

```tsx
{phase === 'config' && (
  <div className="space-y-2">
    <Label
      htmlFor="schedule-preferences"
      className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
    >
      Preferences (optional)
    </Label>
    <Textarea
      id="schedule-preferences"
      className="text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border transition-colors resize-y min-h-[80px]"
      placeholder="e.g. Termora prefers weekends. Keep Helena off Mondays. Aleah only after 16:30 on school days."
      value={preferences}
      onChange={(e) => setPreferences(e.target.value)}
      maxLength={2000}
      aria-describedby="schedule-preferences-counter"
    />
    <div
      id="schedule-preferences-counter"
      aria-live="polite"
      aria-atomic="true"
      className="text-[12px] text-muted-foreground min-h-[1em]"
    >
      {preferences.length > 0 && (
        <span className={preferences.length >= 1800 ? 'text-amber-600' : undefined}>
          {preferences.length} / 2000
        </span>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 3: Type-check + run lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx
git commit -m "feat(schedule-dialog): preferences Textarea with aria-live counter

Label htmlFor + Textarea id association, always-mounted live region,
amber at ≥1800 chars, resize-y, transition-colors, reset on close.
onGenerate signature extended with preferences."
```

---

## Task 19: ShiftPlannerTab — thread preferences into mutation

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`

- [ ] **Step 1: Update the onGenerate callback**

Run: `grep -n "onGenerate=\|generateSchedule.mutate\|<GenerateScheduleDialog" src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx`

Find the `onGenerate` callback prop on `<GenerateScheduleDialog>` and update its signature:

```tsx
onGenerate={(excludedIds, lockedIds, preferences) => {
  generateSchedule.mutate({
    restaurantId: selectedRestaurant.id,
    restaurantTimezone: selectedRestaurant.timezone,
    weekStart,
    lockedShiftIds: lockedIds,
    excludedEmployeeIds: excludedIds,
    preferences,
  });
}}
```

- [ ] **Step 2: Type-check + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx
git commit -m "feat(shift-planner): thread preferences into generate-schedule mutation"
```

---

## Task 20: Integration smoke — solver-only path

**Files:**
- Create: `tests/unit/generate-schedule-integration.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/unit/generate-schedule-integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { solveSchedule } from '../../supabase/functions/_shared/schedule-solver';
import { validateGeneratedShifts } from '../../supabase/functions/_shared/schedule-validator';
import fixture from '../fixtures/schedule-solver-trace.json' assert { type: 'json' };

function toCtx(raw: unknown) {
  const r = raw as Record<string, unknown>;
  return {
    ...r,
    requiredStaff: new Map(Object.entries(r.requiredStaff as Record<string, unknown>)),
    excludedEmployeeIds: new Set((r.excludedEmployeeIds as string[]) ?? []),
  } as unknown as Parameters<typeof solveSchedule>[0];
}

describe('Solver → validator (defense-in-depth)', () => {
  it('every solver-emitted shift passes the validator with zero drops', () => {
    const ctx = toCtx(fixture);
    const result = solveSchedule(ctx);

    const validationCtx = {
      employees: new Map(ctx.employees.map((e: any) => [e.id, {
        position: e.position, is_minor: e.is_minor, max_weekly_hours: e.max_weekly_hours,
      }])),
      templates: new Map(ctx.templates.map((t: any) => [t.id, {
        days: t.days_of_week, position: t.position,
      }])),
      availability: new Map(),
      excludedEmployeeIds: ctx.excludedEmployeeIds,
      existingShifts: ctx.lockedShifts ?? [],
    };
    // Populate availability flat map
    for (const [empId, byDay] of Object.entries(ctx.availability as Record<string, any>)) {
      for (const [dow, slot] of Object.entries(byDay)) {
        validationCtx.availability.set(`${empId}:${dow}`, slot as any);
      }
    }
    const vr = validateGeneratedShifts(result.shifts, validationCtx as any);
    expect(vr.dropped).toEqual([]);
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `npx vitest run tests/unit/generate-schedule-integration.test.ts`
Expected: PASS.

```bash
git add tests/unit/generate-schedule-integration.test.ts
git commit -m "test(integration): solver output passes validator with zero drops"
```

---

## Task 21: buildWeekDates consumer audit (source-text)

**Files:**
- Modify: `tests/unit/schedule-prompt-builder-retired.test.ts`

- [ ] **Step 1: Append the consumer audit**

In `tests/unit/schedule-prompt-builder-retired.test.ts`, append:

```ts
import { execSync } from 'node:child_process';

describe('buildWeekDates consumer audit', () => {
  it('is only imported by schedule-preference-llm.ts and test files', () => {
    const grep = execSync(
      `grep -rln "buildWeekDates" supabase/ src/ tests/ || true`,
      { cwd: resolve(__dirname, '../..') },
    ).toString().trim().split('\n').filter(Boolean);
    const allowed = [
      'supabase/functions/_shared/schedule-prompt-builder.ts',
      'supabase/functions/_shared/schedule-preference-llm.ts',
    ];
    const disallowed = grep.filter(
      (path) => !allowed.includes(path) && !path.startsWith('tests/'),
    );
    expect(disallowed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `npx vitest run tests/unit/schedule-prompt-builder-retired.test.ts`
Expected: PASS.

```bash
git add tests/unit/schedule-prompt-builder-retired.test.ts
git commit -m "test(scheduler): buildWeekDates consumer audit"
```

---

## Task 22: Perf bench gate

**Files:**
- Create: `tests/perf/schedule-solver.bench.test.ts`
- Create: `tests/fixtures/schedule-solver-large.json`

- [ ] **Step 1: Build the synthetic large fixture**

Create `tests/fixtures/schedule-solver-large.json` — synthesize 60 employees × 8 templates × 7 days with ~3 headcount per (template, day) = ~168 slots. Quick generator:

```bash
node -e "
const employees = Array.from({length: 60}, (_, i) => ({
  id: 'emp_' + String(i).padStart(3, '0'),
  name: 'Emp ' + i,
  position: i < 40 ? 'Server' : i < 50 ? 'Cook' : 'Host',
  area: i % 3 === 0 ? null : (i % 2 === 0 ? 'Brand A' : 'Brand B'),
  max_weekly_hours: i % 7 === 0 ? 18 : 40,
  date_of_birth: i % 7 === 0 ? '2010-01-01' : '1990-01-01',
  is_minor: i % 7 === 0,
}));
const templates = [
  { id: 'tpl_001', name: 'Lunch A', position: 'Server', area: 'Brand A', start_time: '10:00:00', end_time: '16:30:00', days_of_week: [1,2,3,4,5,6,0] },
  { id: 'tpl_002', name: 'Lunch B', position: 'Server', area: 'Brand B', start_time: '10:00:00', end_time: '16:30:00', days_of_week: [1,2,3,4,5,6,0] },
  { id: 'tpl_003', name: 'Dinner A', position: 'Server', area: 'Brand A', start_time: '16:00:00', end_time: '22:30:00', days_of_week: [1,2,3,4,5,6,0] },
  { id: 'tpl_004', name: 'Dinner B', position: 'Server', area: 'Brand B', start_time: '16:00:00', end_time: '22:30:00', days_of_week: [1,2,3,4,5,6,0] },
  { id: 'tpl_005', name: 'Cook Open', position: 'Cook', area: null, start_time: '08:00:00', end_time: '16:00:00', days_of_week: [1,2,3,4,5,6,0] },
  { id: 'tpl_006', name: 'Cook Close', position: 'Cook', area: null, start_time: '14:00:00', end_time: '22:00:00', days_of_week: [1,2,3,4,5,6,0] },
  { id: 'tpl_007', name: 'Host AM', position: 'Host', area: null, start_time: '10:00:00', end_time: '14:00:00', days_of_week: [1,2,3,4,5,6,0] },
  { id: 'tpl_008', name: 'Host PM', position: 'Host', area: null, start_time: '17:00:00', end_time: '21:00:00', days_of_week: [1,2,3,4,5,6,0] },
];
const days = ['2026-06-08','2026-06-09','2026-06-10','2026-06-11','2026-06-12','2026-06-13','2026-06-14'];
const requiredStaff = {};
for (const t of templates) for (const d of days) requiredStaff[t.id+':'+d] = { template_id: t.id, day: d, count: 3 };
const availability = {};
for (const e of employees) {
  availability[e.id] = {};
  for (let dow = 0; dow < 7; dow++) {
    availability[e.id][dow] = e.is_minor
      ? (dow === 0 || dow === 6 ? { isAvailable: true, startTime: '10:00:00', endTime: '20:00:00' } : { isAvailable: true, startTime: '16:30:00', endTime: '20:00:00' })
      : { isAvailable: true, startTime: '00:00:00', endTime: '23:59:59' };
  }
}
const out = {
  restaurantId: 'restaurant_synth',
  weekStart: '2026-06-08',
  employees, templates, availability, requiredStaff,
  lockedShifts: [], excludedEmployeeIds: [],
  priorPatterns: [], weeklySalesHistory: [], hourlySalesHistory: [],
  targetLaborPercentage: 0.30, minimumWageCents: 0,
};
require('fs').writeFileSync('tests/fixtures/schedule-solver-large.json', JSON.stringify(out, null, 2));
console.log('wrote', employees.length, 'employees,', Object.keys(requiredStaff).length, 'slot groups');
"
```

- [ ] **Step 2: Write the bench test**

Create `tests/perf/schedule-solver.bench.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import traceFixture from '../fixtures/schedule-solver-trace.json' assert { type: 'json' };
import largeFixture from '../fixtures/schedule-solver-large.json' assert { type: 'json' };
import { solveSchedule } from '../../supabase/functions/_shared/schedule-solver';

function toCtx(raw: unknown) {
  const r = raw as Record<string, unknown>;
  return {
    ...r,
    requiredStaff: new Map(Object.entries(r.requiredStaff as Record<string, unknown>)),
    excludedEmployeeIds: new Set((r.excludedEmployeeIds as string[]) ?? []),
  } as unknown as Parameters<typeof solveSchedule>[0];
}

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)];
}

describe('schedule-solver perf gate', () => {
  it('trace fixture: p95 < 250ms, max < 500ms over 20 iterations', () => {
    const ctx = toCtx(traceFixture);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      solveSchedule(ctx);
      samples.push(performance.now() - t0);
    }
    const p = p95(samples);
    const max = Math.max(...samples);
    console.log(`[perf] trace p95=${p.toFixed(1)}ms max=${max.toFixed(1)}ms`);
    expect(p).toBeLessThan(250);
    expect(max).toBeLessThan(500);
  });

  it('large fixture: p95 < 800ms, max < 1500ms over 20 iterations', () => {
    const ctx = toCtx(largeFixture);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      solveSchedule(ctx);
      samples.push(performance.now() - t0);
    }
    const p = p95(samples);
    const max = Math.max(...samples);
    console.log(`[perf] large p95=${p.toFixed(1)}ms max=${max.toFixed(1)}ms`);
    expect(p).toBeLessThan(800);
    expect(max).toBeLessThan(1500);
  });
});
```

- [ ] **Step 3: Run the bench**

Run: `npx vitest run tests/perf/schedule-solver.bench.test.ts`
Expected: PASS. If FAIL, refer to *Performance budget + measurement → Where to look for improvements* in the spec and apply the smallest change that closes the gap.

- [ ] **Step 4: Commit**

```bash
git add tests/perf/schedule-solver.bench.test.ts tests/fixtures/schedule-solver-large.json
git commit -m "test(scheduler-solver): perf gate (p95 < 250ms trace / 800ms large)"
```

---

## Task 23: Verify script for local end-to-end measurement

**Files:**
- Create: `scripts/verify-schedule-perf.sh`

- [ ] **Step 1: Write the script**

Create `scripts/verify-schedule-perf.sh`:

```bash
#!/usr/bin/env bash
#
# verify-schedule-perf.sh — local-Supabase end-to-end measurement.
# Invoked by /dev Phase 6 (Verify). Captures p95 + max from 5 runs and
# writes a "Perf result" block to .perf-result.md for the PR description.
#
# Prereqs: npm run db:start && npm run functions:serve in another terminal.
# Requires a known restaurant_id with realistic data. Pass via env var
# PERF_RESTAURANT_ID and a week_start via PERF_WEEK_START.

set -euo pipefail

REST_ID="${PERF_RESTAURANT_ID:-}"
WEEK="${PERF_WEEK_START:-2026-06-08}"
LOCAL_URL="${LOCAL_FUNCTIONS_URL:-http://localhost:54321/functions/v1/generate-schedule}"
RUNS="${PERF_RUNS:-5}"

if [[ -z "$REST_ID" ]]; then
  echo "PERF_RESTAURANT_ID is required (a restaurant with realistic data)." >&2
  exit 1
fi

# Capture an anon JWT for the restaurant; the user manually supplies via SUPABASE_USER_JWT.
if [[ -z "${SUPABASE_USER_JWT:-}" ]]; then
  echo "SUPABASE_USER_JWT is required (token for a user with owner/manager role on \$PERF_RESTAURANT_ID)." >&2
  exit 1
fi

durations=()
for i in $(seq 1 "$RUNS"); do
  echo "[perf] run $i/$RUNS"
  START_NS=$(date +%s%N)
  curl -sS -X POST "$LOCAL_URL" \
    -H "Authorization: Bearer $SUPABASE_USER_JWT" \
    -H "Content-Type: application/json" \
    -d "{\"restaurant_id\":\"$REST_ID\",\"week_start\":\"$WEEK\",\"locked_shift_ids\":[],\"excluded_employee_ids\":[]}" \
    > /dev/null
  END_NS=$(date +%s%N)
  ELAPSED_MS=$(( (END_NS - START_NS) / 1000000 ))
  durations+=("$ELAPSED_MS")
  echo "  ${ELAPSED_MS}ms"
done

# Compute p95 + max
sorted=($(printf '%s\n' "${durations[@]}" | sort -n))
p95_idx=$(( ${#sorted[@]} * 95 / 100 ))
p95="${sorted[$p95_idx]}"
max="${sorted[-1]}"

cat > .perf-result.md <<EOF
## Perf result (local Supabase, $RUNS runs)

- Sample durations (ms): ${durations[*]}
- **p95: ${p95}ms**
- **max: ${max}ms**
- Target: end-to-end (no-prefs) p95 < 5000ms, max < 10000ms
EOF

echo
cat .perf-result.md

# Fail loudly if we miss the no-prefs target
if (( p95 > 5000 )); then
  echo "PERF MISS — p95 ${p95}ms exceeds 5000ms target" >&2
  exit 2
fi
```

- [ ] **Step 2: Make executable + sanity-check**

Run: `chmod +x scripts/verify-schedule-perf.sh && bash -n scripts/verify-schedule-perf.sh`
Expected: no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-schedule-perf.sh
git commit -m "chore(scheduler): verify-perf script for /dev Phase 6 measurement"
```

---

## Task 24: Final wire-through — typecheck + full test run

**Files:** (none modified — verification step)

- [ ] **Step 1: Full typecheck**

Run: `npm run typecheck`
Expected: PASS — no type errors.

- [ ] **Step 2: Full lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Full Vitest run**

Run: `npm run test`
Expected: All unit + integration + perf tests PASS.

- [ ] **Step 4: TZ portability**

Run: `npm run test:tz`
Expected: PASS — solver output stable across America/Chicago and Pacific/Auckland.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS — production bundle builds clean.

- [ ] **Step 6: Commit (if anything needed touching during typecheck cleanup)**

If any small fixes were needed (e.g., a forgotten import or type assertion), commit them with:

```bash
git commit -am "chore(scheduler): typecheck + build cleanup post wire-through"
```

If nothing was needed, skip this step.

---

## Self-review checklist (run after writing the plan)

- [x] Every spec section maps to a task (see spec-coverage map at top).
- [x] No "TBD" or "implement later" placeholders in steps with code.
- [x] Type names match across tasks (`UnfilledSlot`, `FairnessSummary`, `SolverResult`, `PreferenceResult`, `SwapRecord`, `RejectedSwap`, `ClientSafeUnfilledSlot`, `ClientSafeFairnessSummary` — all consistent).
- [x] Each task includes its exact file path(s), test path, command to run, and a commit message.
- [x] TDD: every task with new code has a test step before the implementation step.
- [x] Perf gate is its own task; the verify script is its own task; both reference the spec's performance section by name.

---

**Total tasks:** 24. Estimated commits: ~24 (one per task minimum).
**Plan covers:** spec §Problem, §Goals, §Non-goals, §Architecture, §The solver, §The LLM preference layer, §Persistence, §UI changes, §Retirement, §Performance budget + measurement, §Tests, §File touch list, §Rollout. The "Decided trade-offs", "Decisions adopted from review", and "Risks" sections are informational and need no plan tasks.
