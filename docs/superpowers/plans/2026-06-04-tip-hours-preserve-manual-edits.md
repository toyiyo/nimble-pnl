# Preserve Manually-Entered Tip Hours — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `Tips.tsx` from silently wiping manually-entered tip hours when a background query refetches, and harden the flaky tip E2E specs.

**Architecture:** Extract a pure `mergeManualHours` helper that preserves user-typed hours (flagged `autoCalculated === false`) while refreshing the rest from punches. Use it inside `Tips.tsx` Effect 2 via a render-synced "latest ref" so the effect does not re-run per keystroke. Reset manual-edit tracking on user-initiated date changes so a new date derives hours fresh. Harden the E2E specs with a verify-commit `fillHours` helper, a positive-amount payout seed, and explicit load timeouts.

**Tech Stack:** React 18 + TypeScript, Vitest (unit), Playwright (E2E).

**Spec:** `docs/superpowers/specs/2026-06-04-tip-hours-preserve-manual-edits-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/utils/tipHours.ts` (new) | Pure `mergeManualHours` — merge punch-derived hours without clobbering manual edits |
| `tests/unit/tipHours.test.ts` (new) | Unit tests for `mergeManualHours` |
| `src/pages/Tips.tsx` (modify) | Use `mergeManualHours` in Effect 2 via latest-ref; reset manual flags on user date change |
| `tests/helpers/e2e-supabase.ts` (modify) | Add shared `fillHours(page, name, hours)` verify-commit helper |
| `tests/e2e/tip-payouts.spec.ts` (modify) | Use `fillHours`; positive-amount seed; load timeouts |
| `tests/e2e/tip-sharing.spec.ts` (modify) | Use `fillHours` |

---

## Task 1: `mergeManualHours` pure helper (TDD)

**Files:**
- Create: `src/utils/tipHours.ts`
- Test: `tests/unit/tipHours.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/tipHours.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeManualHours } from '@/utils/tipHours';

describe('mergeManualHours', () => {
  it('preserves a manually-edited entry (flag === false) over punch-derived', () => {
    const result = mergeManualHours(
      { a: '0.00', b: '0.00' }, // punchDerived
      { a: '8', b: '0.00' },    // prev
      { a: false },             // a was user-typed
    );
    expect(result.a).toBe('8');     // preserved
    expect(result.b).toBe('0.00');  // refreshed from punches
  });

  it('refreshes an auto-calculated entry (flag === true) from punch-derived', () => {
    const result = mergeManualHours(
      { a: '7.50' },
      { a: '8.00' },
      { a: true }, // a was auto-calculated, not manual
    );
    expect(result.a).toBe('7.50');
  });

  it('refreshes an entry whose flag is absent (undefined) from punch-derived', () => {
    const result = mergeManualHours(
      { a: '6.00', b: '6.00' },
      { a: '6.00', b: '99' },
      { a: false }, // b absent from the flag map entirely
    );
    expect(result.a).toBe('6.00'); // manual preserved
    expect(result.b).toBe('6.00'); // b has no flag → punch-derived wins
  });

  it('exact bug scenario: typed hours survive a punch-derived all-zero refresh', () => {
    const result = mergeManualHours(
      { a: '0.00', b: '0.00' }, // no punches → all zero
      { a: '8' },               // user typed a, b untouched
      { a: false },
    );
    expect(result).toEqual({ a: '8', b: '0.00' });
  });

  it('returns punch-derived unchanged when there are no manual edits', () => {
    const result = mergeManualHours(
      { a: '5.00', b: '5.00' },
      { a: '5.00', b: '5.00' },
      { a: true, b: true },
    );
    expect(result).toEqual({ a: '5.00', b: '5.00' });
  });

  it('handles empty maps', () => {
    expect(mergeManualHours({}, {}, {})).toEqual({});
  });

  it('keeps a manual entry even if it is absent from punch-derived', () => {
    const result = mergeManualHours({}, { a: '8' }, { a: false });
    expect(result.a).toBe('8');
  });

  it('does not mutate its inputs', () => {
    const punch = { a: '0.00' };
    const prev = { a: '8' };
    const flags = { a: false };
    mergeManualHours(punch, prev, flags);
    expect(punch).toEqual({ a: '0.00' });
    expect(prev).toEqual({ a: '8' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/tipHours.test.ts`
Expected: FAIL — `Failed to resolve import "@/utils/tipHours"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/tipHours.ts`:

```ts
/**
 * Tip hours state reconciliation.
 *
 * The Tips daily-entry screen derives per-employee hours from time punches, but
 * a manager can also type hours manually. A background query refetch must not
 * clobber those manual edits. An entry is "manual" when its autoCalculated flag
 * is explicitly `false` — set by the hours input's onChange in Tips.tsx.
 */

/**
 * Merge punch-derived hours into the current hours map, preserving any entry the
 * user has manually edited (autoCalculated[id] === false). Entries that are
 * auto-calculated (true) or untracked (undefined) take the punch-derived value.
 *
 * Pure: does not mutate its arguments.
 */
export function mergeManualHours(
  punchDerived: Record<string, string>,
  prev: Record<string, string>,
  autoCalculated: Record<string, boolean>,
): Record<string, string> {
  const merged: Record<string, string> = { ...punchDerived };
  for (const empId of Object.keys(prev)) {
    if (autoCalculated[empId] === false) {
      merged[empId] = prev[empId]; // user-typed — never overwrite
    }
  }
  return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/tipHours.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/tipHours.ts tests/unit/tipHours.test.ts
git commit -m "feat(tips): add mergeManualHours helper to preserve manual tip hours"
```

---

## Task 2: Use `mergeManualHours` in Tips.tsx Effect 2 (latest-ref)

**Files:**
- Modify: `src/pages/Tips.tsx` (import line 1, line 12; state decls ~225-227; Effect 2 line 321)

- [ ] **Step 1: Import `useRef` and `mergeManualHours`**

Change line 1 from:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
```
to:
```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

Add an import (after the tipPooling import on line 12):

```ts
import { mergeManualHours } from '@/utils/tipHours';
```

- [ ] **Step 2: Add the render-synced "latest ref"**

Immediately after the `autoCalculatedHours` state declaration (line 227):

```ts
  const [autoCalculatedHours, setAutoCalculatedHours] = useState<Record<string, boolean>>({}); // Track which hours are auto-calculated
  // Latest autoCalculatedHours, read inside Effect 2's setState updater WITHOUT adding
  // it as an effect dependency (which would re-run the effect on every keystroke).
  // Mutating a ref in the render body is the standard "latest ref" idiom and is
  // StrictMode-safe for read-only data.
  const autoCalculatedHoursRef = useRef(autoCalculatedHours);
  autoCalculatedHoursRef.current = autoCalculatedHours;
```

- [ ] **Step 3: Replace the unconditional overwrite in Effect 2**

Change line 321 from:

```ts
    setHoursByEmployee(hoursFromPunches);
```
to:
```ts
    // Refresh punch-derived hours but NEVER clobber a value the manager typed.
    // (Effect 1 uses a value-based bootstrap guard; this flag-based guard is the
    // full-refresh equivalent — intentionally different predicates.)
    setHoursByEmployee(prev =>
      mergeManualHours(hoursFromPunches, prev, autoCalculatedHoursRef.current),
    );
```

- [ ] **Step 4: Verify typecheck + lint + existing hours tests pass**

Run: `npx tsc --noEmit && npx eslint src/pages/Tips.tsx src/utils/tipHours.ts && npx vitest run tests/unit/tips-hours-auto-calculation.test.ts tests/unit/tipPooling.test.ts`
Expected: typecheck clean, lint clean, tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Tips.tsx
git commit -m "fix(tips): preserve manually-entered hours from background-refetch wipe

Effect 2 unconditionally overwrote hoursByEmployee with punch-derived values on
any dep change, wiping a manager's typed hours mid-entry and persisting an
imbalanced split. Merge via mergeManualHours, reading the latest manual-edit
flags through a render-synced ref so the effect does not re-run per keystroke."
```

---

## Task 3: Reset manual-edit tracking on user date change

**Files:**
- Modify: `src/pages/Tips.tsx` (handler ~163-166; date picker ~871)

**Why:** With Effect 2 no longer overwriting, switching `selectedDate` would carry the previous date's manual hours forward (punches are date-scoped — `Tips.tsx:105`). Reset manual tracking on the two **user** date paths; leave draft-resume (`Tips.tsx:408`) untouched so its saved hours survive.

- [ ] **Step 1: Add `handleSelectDate` and route `handleDayClick` through it**

Replace the `handleDayClick` handler (lines 163-166):

```ts
  const handleDayClick = (date: Date) => {
    setSelectedDate(date);
    setViewMode('daily');
  };
```
with:
```ts
  // A user-initiated date change starts the new date fresh: drop manual-edit
  // tracking so hours re-derive from the newly-selected date's punches.
  const handleSelectDate = (date: Date) => {
    setSelectedDate(date);
    setAutoCalculatedHours({});
    setHoursByEmployee({});
  };

  const handleDayClick = (date: Date) => {
    handleSelectDate(date);
    setViewMode('daily');
  };
```

- [ ] **Step 2: Route the daily-entry date picker through `handleSelectDate`**

Change line 871 from:

```tsx
            onDateSelected={setSelectedDate} 
```
to:
```tsx
            onDateSelected={handleSelectDate} 
```

- [ ] **Step 3: Verify typecheck + lint**

Run: `npx tsc --noEmit && npx eslint src/pages/Tips.tsx`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Tips.tsx
git commit -m "fix(tips): reset manual hours tracking on user date change

Prevents manually-entered hours from one date carrying over to another now that
Effect 2 preserves manual edits. Draft-resume path is intentionally excluded."
```

---

## Task 4: Shared `fillHours` E2E helper

**Files:**
- Modify: `tests/helpers/e2e-supabase.ts`

- [ ] **Step 1: Add a static `expect` import**

At the top of `tests/helpers/e2e-supabase.ts`, change:

```ts
import type { Page } from '@playwright/test';
```
to:
```ts
import { expect, type Page } from '@playwright/test';
```

- [ ] **Step 2: Export `fillHours`**

Add near `generateTestUser` (after the `exposeSupabaseHelpers` function, before `generateTestUser`):

```ts
/**
 * Fill an employee's hours spinbutton on the Tips daily-entry screen and assert
 * the value committed. Verifying the commit catches the (now-fixed) case where a
 * background re-render could drop a just-typed value, and fails at the point of
 * entry rather than three assertions later.
 */
export async function fillHours(page: Page, employeeName: string, hours: string) {
  const input = page.getByRole('spinbutton', { name: new RegExp(employeeName, 'i') });
  await input.fill(hours);
  await expect(input).toHaveValue(hours);
}
```

- [ ] **Step 3: Typecheck the test helper**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add tests/helpers/e2e-supabase.ts
git commit -m "test(e2e): add shared fillHours verify-commit helper"
```

---

## Task 5: Harden `tip-payouts.spec.ts`

**Files:**
- Modify: `tests/e2e/tip-payouts.spec.ts` (import line 2; `enterAndApproveTips` lines 58-60; seed ~205; name/amount assertions 126-129, 266-270)

- [ ] **Step 1: Import `fillHours`**

Change line 2 from:

```ts
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers } from '../helpers/e2e-supabase';
```
to:
```ts
import { signUpAndCreateRestaurant, generateTestUser, exposeSupabaseHelpers, fillHours } from '../helpers/e2e-supabase';
```

- [ ] **Step 2: Use `fillHours` in `enterAndApproveTips`**

Replace the loop (lines 58-60):

```ts
  for (const emp of employees) {
    await page.getByRole('spinbutton', { name: new RegExp(emp.name, 'i') }).fill(emp.hours);
  }
```
with:
```ts
  for (const emp of employees) {
    await fillHours(page, emp.name, emp.hours);
  }
```

- [ ] **Step 3: Seed a guaranteed-positive payout**

In the partial-payout test, replace the split-item pick (currently lines 204-206):

```ts
      // Get Anna's employee_id from split items (pick the first one)
      const annaItem = splits.tip_split_items[0];
      if (!annaItem) throw new Error('No split item found');
```
with:
```ts
      // Pick a split item with a positive allocation (tip_payouts.amount has a
      // CHECK (amount > 0); array order is not guaranteed).
      const annaItem = splits.tip_split_items.find((i: { amount: number }) => i.amount > 0);
      if (!annaItem) throw new Error('No positive split item found');
```

- [ ] **Step 4: Add explicit load timeouts to payout-sheet assertions**

In "Manager: Record tip payouts from timeline", change lines 126-129:

```ts
    await expect(page.getByText('Sarah Miller')).toBeVisible();
    await expect(page.getByText('Tom Wilson')).toBeVisible();
    // $200 split equally = $100 each
    await expect(page.getByText('Allocated: $100.00').first()).toBeVisible();
```
to:
```ts
    await expect(page.getByText('Sarah Miller')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Tom Wilson')).toBeVisible({ timeout: 15000 });
    // $200 split equally = $100 each
    await expect(page.getByText('Allocated: $100.00').first()).toBeVisible({ timeout: 15000 });
```

In "Manager: Payout sheet shows correct employee data", change lines 266-270:

```ts
    await expect(page.getByText('Dave Clark')).toBeVisible();
    await expect(page.getByText('Eve Adams')).toBeVisible();

    // Each gets $150 ($300 / 2 employees with equal hours)
    await expect(page.getByText('Allocated: $150.00').first()).toBeVisible();
```
to:
```ts
    await expect(page.getByText('Dave Clark')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Eve Adams')).toBeVisible({ timeout: 15000 });

    // Each gets $150 ($300 / 2 employees with equal hours)
    await expect(page.getByText('Allocated: $150.00').first()).toBeVisible({ timeout: 15000 });
```

- [ ] **Step 5: Verify the spec parses (typecheck + lint)**

Run: `npx tsc --noEmit && npx eslint tests/e2e/tip-payouts.spec.ts`
Expected: clean. (Full E2E run happens in Phase 8.)

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/tip-payouts.spec.ts
git commit -m "test(e2e): harden tip-payouts — verify-commit hours, positive seed, load timeouts"
```

---

## Task 6: Harden `tip-sharing.spec.ts`

**Files:**
- Modify: `tests/e2e/tip-sharing.spec.ts` (import lines 2-6; hours entry lines 87-89)

- [ ] **Step 1: Import `fillHours`**

Change the import (lines 2-6) to add `fillHours`:

```ts
import {
  signUpAndCreateRestaurant,
  generateTestUser,
  exposeSupabaseHelpers,
  fillHours,
} from '../helpers/e2e-supabase';
```

- [ ] **Step 2: Use `fillHours` for the three hours inputs**

Replace lines 87-89:

```ts
    await page.getByRole('spinbutton', { name: /ana server/i }).fill('6');
    await page.getByRole('spinbutton', { name: /ben bartender/i }).fill('4');
    await page.getByRole('spinbutton', { name: /cal runner/i }).fill('2');
```
with:
```ts
    await fillHours(page, 'ana server', '6');
    await fillHours(page, 'ben bartender', '4');
    await fillHours(page, 'cal runner', '2');
```

- [ ] **Step 3: Verify the spec parses (typecheck + lint)**

Run: `npx tsc --noEmit && npx eslint tests/e2e/tip-sharing.spec.ts`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/tip-sharing.spec.ts
git commit -m "test(e2e): harden tip-sharing — verify-commit hours entry"
```

---

## Self-Review

**Spec coverage:**
- Part A (prod fix: mergeManualHours + latest-ref) → Tasks 1, 2. ✓
- Part A companion (date-change reset) → Task 3. ✓
- Part B.1 (verify-commit fills) → Tasks 4, 5, 6. ✓
- Part B.2 (positive-amount seed) → Task 5 Step 3. ✓
- Part B.3 (load timeouts) → Task 5 Step 4. ✓
- Unit tests incl. undefined-flag case → Task 1 Step 1. ✓
- `fillHours` in shared helper → Task 4. ✓

**Placeholder scan:** none — every code step shows full code.

**Type consistency:** `mergeManualHours(punchDerived, prev, autoCalculated)` signature identical across Task 1 (def), Task 2 (call). `fillHours(page, name, hours)` identical across Tasks 4 (def), 5, 6 (calls).

**Verification note:** Phase 8 runs the full suite (`npm run test`, `npm run test:e2e`, `npm run typecheck`, `npm run lint`, `npm run build`). The Tips.tsx effect/date-change wiring is exercised by the three E2E specs against a live stack.
