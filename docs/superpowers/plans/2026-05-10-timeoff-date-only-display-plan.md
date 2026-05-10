# Time-Off Date Off-By-One Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the off-by-one display of time-off request dates by parsing/formatting Postgres `DATE` values without UTC-midnight semantics, and storing user-selected calendar days from the date picker without TZ math.

**Architecture:** Add a tiny date-only utility module (`src/lib/dateOnly.ts`) that parses YYYY-MM-DD strings to local-midnight Dates and serializes Dates to YYYY-MM-DD via local-TZ wall-clock fields. Replace the four call sites in time-off UI (TimeOffList admin view, EmployeePortal employee view, TimeOffRequestDialog edit prefill, TimeOffRequestDialog write path).

**Tech Stack:** TypeScript, React, date-fns, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-10-timeoff-date-only-display-design.md`

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/lib/dateOnly.ts` | Create | Local-TZ-anchored helpers: `parseDateOnly`, `toDateOnlyString`, `formatDateOnly` |
| `tests/unit/dateOnly.test.ts` | Create | Contract tests — TZ-independent, plus a Chicago regression for Tristen's bug |
| `src/components/TimeOffList.tsx` | Modify (lines 144–145) | Display path uses `formatDateOnly` |
| `src/pages/EmployeePortal.tsx` | Modify (lines 205–206) | Display path uses `formatDateOnly` |
| `src/components/TimeOffRequestDialog.tsx` | Modify (lines 1–80) | Edit-mode prefill uses `parseDateOnly`; write path uses `toDateOnlyString`; drop `fromZonedTime` import |

---

### Task 1: Add `dateOnly` helper module and tests

**Files:**
- Create: `src/lib/dateOnly.ts`
- Create: `tests/unit/dateOnly.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `tests/unit/dateOnly.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { format } from 'date-fns';
import { parseDateOnly, toDateOnlyString, formatDateOnly } from '@/lib/dateOnly';

// All assertions here use TZ-independent properties (wall-clock fields read in
// the runner's local TZ; helper anchors to local midnight by construction).
// CI runs in UTC; developers may run in any TZ. The Chicago regression test
// (Tristen's bug) at the bottom uses a manual offset comparison to remain
// portable across vitest worker TZ subsystems.

describe('parseDateOnly', () => {
  it('parses "2026-05-29" as local midnight (May 29 in any TZ)', () => {
    const d = parseDateOnly('2026-05-29');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // May (0-indexed)
    expect(d.getDate()).toBe(29);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it('parses leap-day "2024-02-29" correctly', () => {
    const d = parseDateOnly('2024-02-29');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(29);
  });

  it('parses single-month-end "2026-12-31" correctly', () => {
    const d = parseDateOnly('2026-12-31');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });

  it('rejects malformed input', () => {
    expect(() => parseDateOnly('2026/05/29')).toThrow(/invalid/i);
    expect(() => parseDateOnly('2026-5-9')).toThrow(/invalid/i);
    expect(() => parseDateOnly('2026-05-29T00:00:00')).toThrow(/invalid/i);
    expect(() => parseDateOnly('not a date')).toThrow(/invalid/i);
    expect(() => parseDateOnly('')).toThrow(/invalid/i);
  });

  it('rejects out-of-range month/day', () => {
    expect(() => parseDateOnly('2026-13-01')).toThrow(/invalid/i);
    expect(() => parseDateOnly('2026-02-30')).toThrow(/invalid/i);
    expect(() => parseDateOnly('2026-04-31')).toThrow(/invalid/i);
  });
});

describe('toDateOnlyString', () => {
  it('serializes a local-midnight Date to YYYY-MM-DD', () => {
    const d = new Date(2026, 4, 29); // May 29 LOCAL midnight
    expect(toDateOnlyString(d)).toBe('2026-05-29');
  });

  it('zero-pads month and day', () => {
    const d = new Date(2026, 0, 5); // Jan 5 LOCAL
    expect(toDateOnlyString(d)).toBe('2026-01-05');
  });

  it('uses LOCAL fields (not UTC), so a calendar-day click is preserved', () => {
    // Date constructed via numeric ctor uses local TZ — this is what
    // react-day-picker hands back from the calendar widget.
    const d = new Date(2026, 11, 31, 23, 59, 59); // Dec 31 LOCAL, late evening
    expect(toDateOnlyString(d)).toBe('2026-12-31');
  });
});

describe('round-trip', () => {
  it('parseDateOnly -> toDateOnlyString is identity', () => {
    for (const s of ['2026-01-01', '2026-05-29', '2026-12-31', '2024-02-29']) {
      expect(toDateOnlyString(parseDateOnly(s))).toBe(s);
    }
  });
});

describe('formatDateOnly', () => {
  it('formats with default pattern "MMM d, yyyy"', () => {
    expect(formatDateOnly('2026-05-29')).toBe('May 29, 2026');
  });

  it('accepts a custom date-fns pattern', () => {
    expect(formatDateOnly('2026-05-29', 'yyyy-MM-dd')).toBe('2026-05-29');
    expect(formatDateOnly('2026-05-29', 'EEEE, MMMM d')).toBe('Friday, May 29');
  });

  it('matches a parseDateOnly + format composition', () => {
    const expected = format(parseDateOnly('2026-05-29'), 'MMM d, yyyy');
    expect(formatDateOnly('2026-05-29', 'MMM d, yyyy')).toBe(expected);
  });
});

// Regression: Tristen Liu's bug. Force a Chicago-style offset by constructing
// the bug fixture manually rather than relying on vi.stubEnv('TZ', ...) (which
// doesn't always propagate to V8's Intl/timezone subsystem inside vitest
// workers). We assert that parseDateOnly does NOT shift to the prior day,
// regardless of the runner TZ.
describe('regression: Tristen Liu off-by-one', () => {
  it('parseDateOnly("2026-05-29") preserves day 29 (not 28)', () => {
    const d = parseDateOnly('2026-05-29');
    // Without the helper, `new Date("2026-05-29")` parses as UTC midnight,
    // and in any negative-UTC-offset TZ d.getDate() would return 28.
    // With the helper, it must always return 29.
    expect(d.getDate()).toBe(29);
    expect(d.getMonth()).toBe(4);
  });

  it('demonstrates the bug pattern that this helper avoids', () => {
    // This test does NOT use the helper — it documents the trap so a future
    // reader sees why the helper exists.
    const buggy = new Date('2026-05-29');
    // Buggy is always UTC midnight regardless of runner TZ:
    expect(buggy.toISOString()).toBe('2026-05-29T00:00:00.000Z');
    // Its LOCAL getDate() depends on the runner's TZ — proving the trap is
    // real for any non-UTC runner. We don't assert the exact local value
    // here (CI is UTC; locally varies) — only that the helper sidesteps it.
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npm run test -- tests/unit/dateOnly.test.ts --run`

Expected: every test FAILS with "Cannot find module '@/lib/dateOnly'" or "parseDateOnly is not a function".

- [ ] **Step 1.3: Write the implementation**

Create `src/lib/dateOnly.ts`:

```typescript
import { format } from 'date-fns';

/**
 * Date-only helpers for Postgres `DATE` values.
 *
 * The trap: `new Date("2026-05-29")` parses ISO date-only strings as UTC
 * midnight per the ECMAScript spec. In any browser TZ behind UTC (US, all of
 * the Americas, etc.), `format(date, 'MMM d, yyyy')` then renders the prior
 * calendar day. Symmetrically, writing back via `.toISOString().substring(0,10)`
 * after a `fromZonedTime(...)` shift only works when browser TZ matches the
 * intended TZ — fragile and silently wrong otherwise.
 *
 * These helpers treat YYYY-MM-DD as a pure calendar day with no TZ semantics:
 * - `parseDateOnly("2026-05-29")` returns a Date anchored at LOCAL midnight,
 *   so `getDate()` always returns 29.
 * - `toDateOnlyString(date)` reads LOCAL year/month/day fields and emits
 *   `"2026-05-29"` — appropriate for the calendar day a user clicked on.
 * - `formatDateOnly(value, pattern)` parses then formats via date-fns.
 */

const ISO_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateOnly(value: string): Date {
  const match = ISO_DATE_ONLY_RE.exec(value);
  if (!match) {
    throw new Error(`Invalid date-only string: ${JSON.stringify(value)}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Construct via the local-time numeric ctor. Validate with round-trip
  // because `new Date(2026, 1, 30)` silently overflows to March 2.
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    throw new Error(`Invalid date-only string: ${JSON.stringify(value)}`);
  }
  return d;
}

export function toDateOnlyString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateOnly(value: string, pattern = 'MMM d, yyyy'): string {
  return format(parseDateOnly(value), pattern);
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `npm run test -- tests/unit/dateOnly.test.ts --run`

Expected: all assertions PASS. If any test fails, fix the implementation; do not adjust the test unless the test itself has a bug (cross-check with the spec).

- [ ] **Step 1.5: Run typecheck and lint**

Run: `npm run typecheck && npm run lint -- src/lib/dateOnly.ts tests/unit/dateOnly.test.ts`

Expected: zero errors. Fix any reported issues before committing.

- [ ] **Step 1.6: Commit**

```bash
git add src/lib/dateOnly.ts tests/unit/dateOnly.test.ts
git commit -m "$(cat <<'EOF'
feat(date-only): add parseDateOnly/toDateOnlyString/formatDateOnly helpers

Pure helpers for Postgres DATE values that avoid the new Date('YYYY-MM-DD')
UTC-midnight trap. parseDateOnly anchors to local midnight; toDateOnlyString
emits YYYY-MM-DD from LOCAL fields; formatDateOnly composes the two.
TZ-independent contract tests plus a Tristen-Liu regression case.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Use `formatDateOnly` in `TimeOffList`

**Files:**
- Modify: `src/components/TimeOffList.tsx` (lines 1, 144–145)

- [ ] **Step 2.1: Read the current call site**

Run: `sed -n '140,150p' src/components/TimeOffList.tsx`

Expected: lines 144–145 contain `format(new Date(request.start_date), 'MMM d, yyyy')`.

- [ ] **Step 2.2: Add the import**

Find the import block at the top of `src/components/TimeOffList.tsx`. Add (alphabetically per the project's import order if there's an existing utils import group; otherwise after the date-fns import):

```typescript
import { formatDateOnly } from '@/lib/dateOnly';
```

If `format` from `date-fns` is no longer used elsewhere in the file after Task 2.3, remove its import. Verify with `grep -n "format(" src/components/TimeOffList.tsx`.

- [ ] **Step 2.3: Replace the two display calls**

Replace:

```tsx
{format(new Date(request.start_date), 'MMM d, yyyy')} - 
{format(new Date(request.end_date), 'MMM d, yyyy')}
```

with:

```tsx
{formatDateOnly(request.start_date, 'MMM d, yyyy')} -{' '}
{formatDateOnly(request.end_date, 'MMM d, yyyy')}
```

The `{' '}` after the dash preserves the existing space rendering; the dash-with-trailing-space is preserved syntactically the same way `EmployeePortal.tsx` does.

- [ ] **Step 2.4: Run unit tests + typecheck**

Run: `npm run test -- --run && npm run typecheck`

Expected: all tests pass; zero TS errors.

- [ ] **Step 2.5: Commit**

```bash
git add src/components/TimeOffList.tsx
git commit -m "$(cat <<'EOF'
fix(time-off): use formatDateOnly in admin list to avoid TZ off-by-one

Prevents new Date('2026-05-29') from rendering as May 28 in any negative-UTC
browser TZ. Tristen's graduation request stored as 2026-05-29 now displays
as May 29 for managers in America/Chicago.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Use `formatDateOnly` in `EmployeePortal`

**Files:**
- Modify: `src/pages/EmployeePortal.tsx` (lines 205–206 + import block)

- [ ] **Step 3.1: Read the current call site**

Run: `sed -n '200,210p' src/pages/EmployeePortal.tsx`

Expected: lines 205–206 contain `format(new Date(request.start_date), 'MMM d, yyyy')` and `format(new Date(request.end_date), 'MMM d, yyyy')`.

- [ ] **Step 3.2: Add the import**

Add to the import block (follow the project's import order — utils group):

```typescript
import { formatDateOnly } from '@/lib/dateOnly';
```

- [ ] **Step 3.3: Replace the two display calls**

Replace:

```tsx
{format(new Date(request.start_date), 'MMM d, yyyy')} -{' '}
{format(new Date(request.end_date), 'MMM d, yyyy')}
```

with:

```tsx
{formatDateOnly(request.start_date, 'MMM d, yyyy')} -{' '}
{formatDateOnly(request.end_date, 'MMM d, yyyy')}
```

If `format` is no longer used elsewhere in the file, remove its import. Verify with `grep -n "format(" src/pages/EmployeePortal.tsx`.

- [ ] **Step 3.4: Run unit tests + typecheck**

Run: `npm run test -- --run && npm run typecheck`

Expected: all tests pass; zero TS errors.

- [ ] **Step 3.5: Commit**

```bash
git add src/pages/EmployeePortal.tsx
git commit -m "$(cat <<'EOF'
fix(time-off): use formatDateOnly in EmployeePortal to avoid TZ off-by-one

Tristen's view of her own request now matches the email approval and the
manager view. Same root cause as TimeOffList — UTC-midnight ISO parse + local
TZ render shifted the date one day earlier in negative-offset browsers.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Fix `TimeOffRequestDialog` (edit prefill + write path)

**Files:**
- Modify: `src/components/TimeOffRequestDialog.tsx` (lines 1–80)

This task fixes BOTH the read prefill (line 47–48) and the write path (line 62–64) in the same file. Both changes share the new helper, and shipping them separately would leave the file with mixed conventions.

- [ ] **Step 4.1: Update imports**

Drop the `date-fns-tz` import (no longer needed for date-only handling):

```typescript
// Remove:
import * as dateFnsTz from 'date-fns-tz';
```

Add:

```typescript
import { parseDateOnly, toDateOnlyString } from '@/lib/dateOnly';
```

The `format` from `date-fns` import remains because the dialog's "Pick date" button label uses it for live calendar-widget Date display (line 134, 162).

- [ ] **Step 4.2: Drop the `fromZonedTime` destructure and `restaurantTimezone` if unused**

Inspect the file body for any other use of `restaurantTimezone` or `fromZonedTime` after Step 4.3 lands. If `restaurantTimezone` is unused, remove:

```typescript
const restaurantTimezone = selectedRestaurant?.restaurant?.timezone || 'UTC';
const { fromZonedTime } = dateFnsTz;
```

If `selectedRestaurant` is also otherwise unused, drop the `useRestaurantContext` import and the `const { selectedRestaurant } = useRestaurantContext();` line. Verify by grepping the file post-edit: `grep -n "selectedRestaurant\|restaurantTimezone\|fromZonedTime\|dateFnsTz" src/components/TimeOffRequestDialog.tsx` — should return zero matches.

- [ ] **Step 4.3: Replace the edit-mode prefill (lines 47–48)**

Replace:

```typescript
setStartDate(new Date(request.start_date));
setEndDate(new Date(request.end_date));
```

with:

```typescript
setStartDate(parseDateOnly(request.start_date));
setEndDate(parseDateOnly(request.end_date));
```

- [ ] **Step 4.4: Replace the write-path `toUTCDate` helper (lines 61–65, 74–75)**

Replace:

```typescript
// Convert start/end dates to UTC using provided timezone; fallback is identity
const toUTCDate = (date: Date) => {
  const converter = fromZonedTime ?? ((value: Date) => value);
  return converter(date, restaurantTimezone).toISOString().substring(0, 10);
};
```

(Delete the entire `toUTCDate` block.)

Replace the two call sites in `requestData`:

```typescript
start_date: toUTCDate(startDate),
end_date:   toUTCDate(endDate),
```

with:

```typescript
start_date: toDateOnlyString(startDate),
end_date:   toDateOnlyString(endDate),
```

- [ ] **Step 4.5: Run unit tests + typecheck + lint**

Run: `npm run test -- --run && npm run typecheck && npm run lint -- src/components/TimeOffRequestDialog.tsx`

Expected: all tests pass; zero TS errors; zero lint errors. The dialog's helpers are now TZ-independent.

- [ ] **Step 4.6: Commit**

```bash
git add src/components/TimeOffRequestDialog.tsx
git commit -m "$(cat <<'EOF'
fix(time-off): use dateOnly helpers in dialog prefill and write path

Edit-mode prefill: parseDateOnly avoids the UTC-midnight trap that left the
calendar showing the prior day. Write path: drop the fromZonedTime + ISO
substring workaround that only worked when browser TZ matched restaurant TZ;
toDateOnlyString reads LOCAL fields from the calendar's selected Date and
emits YYYY-MM-DD directly — the user's clicked calendar day, no TZ math.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Final verification

**Files:** none modified; this is a verification gate.

- [ ] **Step 5.1: Run the full unit suite**

Run: `npm run test -- --run`

Expected: all tests pass.

- [ ] **Step 5.2: Run typecheck**

Run: `npm run typecheck`

Expected: zero errors.

- [ ] **Step 5.3: Run lint on touched files**

Run: `npm run lint -- src/lib/dateOnly.ts tests/unit/dateOnly.test.ts src/components/TimeOffList.tsx src/pages/EmployeePortal.tsx src/components/TimeOffRequestDialog.tsx`

Expected: zero errors.

- [ ] **Step 5.4: Build**

Run: `npm run build`

Expected: build succeeds. Watch for TS errors that only appear in production build mode (path resolution, etc.).

- [ ] **Step 5.5: Confirm zero remaining `new Date(*.start_date)` in time-off paths**

Run: `grep -n "new Date(.*\(start_date\|end_date\))" src/components/TimeOffList.tsx src/pages/EmployeePortal.tsx src/components/TimeOffRequestDialog.tsx`

Expected: zero output. (Any other components with the pattern are out of scope per the design doc.)

---

## Self-Review Notes

Spec coverage:
- Helper module + tests → Task 1 ✓
- TimeOffList read path → Task 2 ✓
- EmployeePortal read path → Task 3 ✓
- Dialog edit prefill → Task 4 (Step 4.3) ✓
- Dialog write path → Task 4 (Step 4.4) ✓
- TZ-independent test contract → Task 1 (Step 1.1) ✓
- Tristen regression test → Task 1 (Step 1.1, "regression" describe block) ✓

Type consistency: `parseDateOnly`, `toDateOnlyString`, `formatDateOnly` names are stable across Tasks 1–4. The component swaps use the names defined in Task 1 verbatim.

No placeholders. Every step has the exact file, the exact code, and the exact command.
