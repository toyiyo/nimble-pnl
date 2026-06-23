# Time Punch Session Pairing Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop false "open session" warnings (and under-counted hours) caused by the time-punch processor collapsing different employees' punches and skipping sessions.

**Architecture:** Two surgical changes to the pure module `src/utils/timePunchProcessing.ts`: (1) scope noise/duplicate detection per `employee_id`; (2) stop the session loop from skipping the clock-in it stopped on. New vitest suite with multi-employee fixtures (the test class the original investigation lacked).

**Tech Stack:** TypeScript, Vitest, date-fns.

---

## File Structure

- Modify: `src/utils/timePunchProcessing.ts`
  - Extract current `normalizePunches` body into a private `normalizeEmployeePunches` (logic unchanged).
  - New `normalizePunches` buckets by `employee_id` and concatenates per-employee results.
  - `identifyWorkSessions`: change `i = j + 1` to `i = j`.
- Create: `tests/unit/timePunchProcessing.test.ts` — multi-employee regression coverage.

No other files change. `normalizePunches` keeps its exported signature, so existing callers (`processPunchesForPeriod`) are untouched.

---

### Task 1: Fix cross-employee noise collapse (Bug 1)

**Files:**
- Create: `tests/unit/timePunchProcessing.test.ts`
- Modify: `src/utils/timePunchProcessing.ts` (`normalizePunches`)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/timePunchProcessing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { processPunchesForPeriod } from '@/utils/timePunchProcessing';
import type { TimePunch } from '@/types/timeTracking';

const mk = (
  id: string,
  employee_id: string,
  punch_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end',
  punch_time: string,
): TimePunch =>
  ({
    id,
    restaurant_id: 'rest-1',
    employee_id,
    punch_type,
    punch_time,
    employee: { id: employee_id, name: employee_id, position: '' },
  }) as unknown as TimePunch;

const open = (s: { is_complete: boolean }) => !s.is_complete;

describe('normalizePunches — noise detection is per employee', () => {
  it('keeps both employees complete when they share identical in/out timestamps', () => {
    // Mirrors the production "Alexia vs Colin" case: imported punches with
    // identical round timestamps must not collapse across employees.
    const punches = [
      mk('a-in', 'empA', 'clock_in', '2026-06-22T15:00:00Z'),
      mk('b-in', 'empB', 'clock_in', '2026-06-22T15:00:00Z'),
      mk('a-out', 'empA', 'clock_out', '2026-06-22T19:00:00Z'),
      mk('b-out', 'empB', 'clock_out', '2026-06-22T19:00:00Z'),
    ];
    const { sessions } = processPunchesForPeriod(punches);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter(open)).toHaveLength(0);
  });

  it('does not orphan a clock-in into a false open session when another employee punches within 60s', () => {
    // empB clock_in is first in the 15:00 cluster (survives) and empB clock_out
    // is second in the 19:00 cluster — under the old global logic empB's
    // clock_out was dropped, orphaning empB into a false "open session".
    const punches = [
      mk('b-in', 'empB', 'clock_in', '2026-06-22T15:00:00Z'),
      mk('a-in', 'empA', 'clock_in', '2026-06-22T15:00:30Z'),
      mk('a-out', 'empA', 'clock_out', '2026-06-22T19:00:00Z'),
      mk('b-out', 'empB', 'clock_out', '2026-06-22T19:00:30Z'),
    ];
    const { sessions } = processPunchesForPeriod(punches);
    expect(sessions.filter(open)).toHaveLength(0);
    expect(sessions.filter((s) => s.is_complete)).toHaveLength(2);
  });

  it('three employees clocking in the same second keep all three sessions', () => {
    const punches = [
      mk('a-in', 'empA', 'clock_in', '2026-06-22T15:00:00Z'),
      mk('b-in', 'empB', 'clock_in', '2026-06-22T15:00:00Z'),
      mk('c-in', 'empC', 'clock_in', '2026-06-22T15:00:00Z'),
      mk('a-out', 'empA', 'clock_out', '2026-06-22T19:00:00Z'),
      mk('b-out', 'empB', 'clock_out', '2026-06-22T19:00:00Z'),
      mk('c-out', 'empC', 'clock_out', '2026-06-22T19:00:00Z'),
    ];
    const { sessions, totalNoisePunches } = processPunchesForPeriod(punches);
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((s) => s.is_complete)).toHaveLength(3);
    expect(totalNoisePunches).toBe(0);
  });

  it('still de-duplicates the SAME employee double-tapping within 60s', () => {
    const punches = [
      mk('in1', 'empA', 'clock_in', '2026-06-22T15:00:00Z'),
      mk('in2', 'empA', 'clock_in', '2026-06-22T15:00:10Z'), // duplicate
      mk('out', 'empA', 'clock_out', '2026-06-22T19:00:00Z'),
    ];
    const { sessions, totalNoisePunches } = processPunchesForPeriod(punches);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].is_complete).toBe(true);
    expect(totalNoisePunches).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests, verify the cross-employee ones FAIL**

Run: `npx vitest run tests/unit/timePunchProcessing.test.ts`
Expected: the first two tests FAIL (e.g. `expected length 2 to be ... 1`, false open session present); the dedup test passes.

- [ ] **Step 3: Scope noise detection per employee**

In `src/utils/timePunchProcessing.ts`, rename the existing exported `normalizePunches` function to a private `normalizeEmployeePunches` (keep the entire body identical — only change the name and drop `export`):

```ts
/**
 * Normalize a SINGLE employee's punch stream.
 * Removes noise (rapid duplicate punches) and prepares punches for session
 * identification. Must only ever receive one employee's punches — proximity
 * (the 60s window) is only meaningful within a single person's stream.
 */
function normalizeEmployeePunches(punches: TimePunch[]): ProcessedPunch[] {
  // ...existing body unchanged...
}
```

Then add the new exported `normalizePunches` immediately above it:

```ts
/**
 * Normalize a restaurant's punch stream.
 *
 * Noise/duplicate detection is scoped PER EMPLOYEE. Punches from different
 * employees that merely land within 60s of each other (common with
 * imported/backdated round timestamps, or any clock-in/out rush) must never be
 * collapsed into one another — doing so drops real punches and orphans
 * clock-ins into false "open sessions". Each employee's stream is normalized
 * independently, then concatenated.
 */
export function normalizePunches(punches: TimePunch[]): ProcessedPunch[] {
  const byEmployee = new Map<string, TimePunch[]>();
  for (const punch of punches) {
    const group = byEmployee.get(punch.employee_id);
    if (group) {
      group.push(punch);
    } else {
      byEmployee.set(punch.employee_id, [punch]);
    }
  }

  const normalized: ProcessedPunch[] = [];
  for (const group of byEmployee.values()) {
    normalized.push(...normalizeEmployeePunches(group));
  }
  return normalized;
}
```

- [ ] **Step 4: Run the tests, verify they PASS**

Run: `npx vitest run tests/unit/timePunchProcessing.test.ts`
Expected: all four tests in this suite PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/timePunchProcessing.ts tests/unit/timePunchProcessing.test.ts
git commit -m "fix(time-punch): scope noise detection per employee

normalizePunches collapsed any punches within 60s across ALL employees,
dropping ~46% of punches on real data and orphaning clock-ins into false
'open session' warnings (and under-counting hours). Bucket by employee_id
before de-duplicating.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Stop skipping the clock-in after a closed session (Bug 2)

**Files:**
- Modify: `tests/unit/timePunchProcessing.test.ts` (add a describe block)
- Modify: `src/utils/timePunchProcessing.ts` (`identifyWorkSessions`)

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/timePunchProcessing.test.ts`:

```ts
describe('identifyWorkSessions — does not skip the next clock-in', () => {
  it('keeps the real session after an orphan leading clock-in', () => {
    // zachary case: a stray midnight clock-in must not swallow the real
    // 10:02–14:03 session that follows it.
    const punches = [
      mk('orphan', 'empZ', 'clock_in', '2026-06-22T00:00:00Z'),
      mk('in', 'empZ', 'clock_in', '2026-06-22T10:02:00Z'),
      mk('out', 'empZ', 'clock_out', '2026-06-22T14:03:00Z'),
    ];
    const { sessions } = processPunchesForPeriod(punches);
    expect(sessions).toHaveLength(2);
    const complete = sessions.filter((s) => s.is_complete);
    expect(complete).toHaveLength(1);
    expect(complete[0].clock_in.toISOString()).toBe('2026-06-22T10:02:00.000Z');
    expect(complete[0].clock_out?.toISOString()).toBe('2026-06-22T14:03:00.000Z');
    // the orphan correctly remains a single open session
    expect(sessions.filter((s) => !s.is_complete)).toHaveLength(1);
  });

  it('keeps both back-to-back complete sessions for one employee', () => {
    const punches = [
      mk('in1', 'empA', 'clock_in', '2026-06-22T09:00:00Z'),
      mk('out1', 'empA', 'clock_out', '2026-06-22T12:00:00Z'),
      mk('in2', 'empA', 'clock_in', '2026-06-22T13:00:00Z'),
      mk('out2', 'empA', 'clock_out', '2026-06-22T17:00:00Z'),
    ];
    const { sessions } = processPunchesForPeriod(punches);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.is_complete)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests, verify they FAIL**

Run: `npx vitest run tests/unit/timePunchProcessing.test.ts`
Expected: both new tests FAIL — old code returns only 1 session for each (the following session is skipped).

- [ ] **Step 3: Fix the index advance**

In `src/utils/timePunchProcessing.ts`, inside `identifyWorkSessions`, change the post-session advance from `i = j + 1;` to `i = j;`:

```ts
        sessions.push(session);
        // Resume from j, NOT j + 1. When the inner scan stopped because it hit
        // the next clock_in, j points AT that clock_in; advancing past it would
        // drop the following session entirely. The inner loop always advances j
        // to at least i + 1 before breaking, so i = j still makes progress.
        i = j;
      } else {
        // Skip punches that don't start a session
        i++;
      }
```

- [ ] **Step 4: Run the tests, verify they PASS**

Run: `npx vitest run tests/unit/timePunchProcessing.test.ts`
Expected: all tests in the file PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/timePunchProcessing.ts tests/unit/timePunchProcessing.test.ts
git commit -m "fix(time-punch): stop skipping the clock-in after a closed session

identifyWorkSessions advanced with i = j + 1 after pushing a session, but j
already pointed at the next clock_in when the scan stopped on it — so that
session was dropped. Resume from j instead. Recovers back-to-back sessions and
the real session after an orphan leading clock-in.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Full local verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Lint the changed files**

Run: `npx eslint src/utils/timePunchProcessing.ts tests/unit/timePunchProcessing.test.ts`
Expected: no errors.

- [ ] **Step 3: Run the full unit suite**

Run: `npm run test`
Expected: all suites pass (new file green; existing `punchFunctionality`, `useTimePunches`, etc. unaffected).

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: No commit needed** (verification only). If any check fails, fix in `src/utils/timePunchProcessing.ts`, re-run, and amend the relevant task's commit.

---

## Self-Review

- **Spec coverage:** Bug 1 (per-employee noise) → Task 1. Bug 2 (`i = j`) → Task 2. Multi-employee regression fixtures → Tasks 1 & 2. Hours-undercount is fixed transitively (sessions feed `calculateDailyHours`); the recovered-session assertions cover it. Verification → Task 3.
- **Placeholder scan:** none — all code blocks are complete.
- **Type consistency:** `normalizePunches`/`normalizeEmployeePunches`/`identifyWorkSessions`/`processPunchesForPeriod` names and the `TimePunch`/`ProcessedPunch`/`WorkSession` types match `src/utils/timePunchProcessing.ts` and `src/types/timeTracking.ts`.
