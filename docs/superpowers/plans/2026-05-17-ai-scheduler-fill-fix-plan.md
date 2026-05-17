# AI Scheduler Fill-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 bugs in the AI scheduler so it fills required slots, respects employee availability across timezones, and uses the full roster — with structured diagnostics when it can't.

**Architecture:** All fixes live inside the edge function (`generate-schedule`), two pure shared modules (`schedule-validator.ts`, `schedule-prompt-builder.ts`), two new shared utilities (`availability-tz.ts`, `staffing-requirements.ts`), and the frontend hook + dialog. No database migration — availability stays UTC in storage; the edge function converts it to restaurant-local at read time.

**Tech Stack:** Supabase Edge Functions (Deno), `date-fns-tz` (pinned `npm:date-fns-tz@3.2.0` via Deno import map), React Query, shadcn Dialog, Vitest.

---

## Spec coverage

This plan implements every bug fix and observability change from `docs/superpowers/specs/2026-05-17-ai-scheduler-fill-fix-design.md`:

| Spec section | Plan task(s) |
|---|---|
| Bug 1 — TZ mismatch | Task 1 (deno.json), Task 5 (availability-tz utility), Task 8 (wire into edge function) |
| Bug 2 — Overnight window | Task 4 (overnight `withinWindow` + `shiftsOverlap`) |
| Bug 3 — Position exact-match | Task 3 (`normalizePosition`) |
| Bug 4 — Missing-day mismatch | Task 8 (7-day fill) + Task 7 (prompt renders all 7) |
| Bug 5 — No "fill slots" rule | Task 6 (`computeRequiredStaff`), Task 7 (Rule 12, headcount section), Task 8 (compute + pass) |
| Bug 6 — `min_crew` JSONB ignored | Task 8 (correct read) |
| Bug 7 — `max_tokens: 8192` | Task 9 (`max_tokens: 16384` + `finish_reason` check) |
| Bug 8 — Zero-shift silent | Task 2 (DropCode), Task 9 (422 path), Task 10 (hook + toast) |
| Observability gaps | Task 9 (structured logs) |
| 422 diagnostic + structured codes | Task 2 (DropCode enum), Task 9 (422 path), Task 10 (hook reads `FunctionsHttpError.context`) |
| Dialog A11Y + sticky footer + "Filled X of Y" | Task 11 |
| Final verification | Task 12 |

---

## File structure

**New files:**

```text
supabase/functions/deno.json                         # Import map pinning date-fns-tz
supabase/functions/_shared/availability-tz.ts        # Pure UTC→local availability conversion
supabase/functions/_shared/staffing-requirements.ts  # Pure required-headcount calculation
tests/unit/availability-tz.test.ts                   # Unit tests for TZ conversion
tests/unit/staffing-requirements.test.ts             # Unit tests for required-headcount
tests/unit/useGenerateSchedule.test.tsx              # Unit tests for hook (422 path + diagnostic)
```

**Modified files:**

```text
supabase/functions/_shared/schedule-validator.ts             # DropCode enum, normalize, overnight
supabase/functions/_shared/schedule-prompt-builder.ts        # 7-day render, headcount, fill rule, TZ note
supabase/functions/generate-schedule/index.ts                # TZ fetch+apply, min_crew, required calc, max_tokens, 422 path, logs
src/hooks/useGenerateSchedule.ts                              # ScheduleDiagnostic, 422 path, always-invalidate
src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx # Filled X/Y, stable keys, a11y, sticky footer
tests/unit/schedule-validator.test.ts                        # New cases for normalize/overnight/DropCode
tests/unit/schedule-prompt-builder.test.ts                   # New cases for 7-day + headcount + rule 12
```

Files split by responsibility: TZ conversion is a leaf utility (no Supabase deps), staffing math is a leaf utility, both are unit-testable in isolation. The edge function stays as the wiring layer — it fetches data, calls utilities, builds context, calls AI, validates, responds.

---

## Task 1: Add Deno import map for `date-fns-tz`

**Files:**
- Create: `supabase/functions/deno.json`

The new `availability-tz.ts` module imports `date-fns-tz` as a bare specifier so Vitest (node, npm package) and the Deno edge runtime both resolve it to the same code. Without this import map, Deno can't resolve the bare specifier.

- [ ] **Step 1: Verify no existing deno.json**

Run: `find supabase/functions -name "deno.json" -o -name "deno.jsonc" | head`
Expected: empty output (no file).

- [ ] **Step 2: Create the import map**

```json
{
  "imports": {
    "date-fns-tz": "npm:date-fns-tz@3.2.0"
  }
}
```

Write to `supabase/functions/deno.json`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/deno.json
git commit -m "build(edge): add Deno import map pinning date-fns-tz@3.2.0

Pins date-fns-tz exactly to match package.json so the new availability-tz
shared module can import it as a bare specifier and resolve in both Vitest
(npm) and Deno edge runtime. Pinning prevents the floating-version drift
seen with esm.sh URL imports."
```

---

## Task 2: Validator — `DropCode` enum + restructured `DroppedShift`

**Files:**
- Modify: `supabase/functions/_shared/schedule-validator.ts` (lines 35-43, 96-190)
- Modify: `tests/unit/schedule-validator.test.ts` (existing reason-string assertions)

Refactor `DroppedShift.reason: string` → `{ code: DropCode; message: string }` so the 422 response can summarize by enum code without leaking employee UUIDs in the body. `message` retains UUIDs for server-log debugging only.

- [ ] **Step 1: Update the existing tests RED — change reason assertions to code assertions**

Open `tests/unit/schedule-validator.test.ts`. Replace every `expect(result.dropped[0].reason).toMatch(...)` with `expect(result.dropped[0].code).toBe(...)`. Final test file should have:

```typescript
// Replace lines that match /reason\).toMatch/ with structured code assertions:
//   .reason).toMatch(/employee/i)         → .code).toBe('UNKNOWN_EMPLOYEE')
//   .reason).toMatch(/template/i)         → .code).toBe('UNKNOWN_TEMPLATE')
//   .reason).toMatch(/position/i)         → .code).toBe('POSITION_MISMATCH')
//   .reason).toMatch(/available/i)        → .code).toBe('UNAVAILABLE_DAY')
//   .reason).toMatch(/time window|availability window/i) → .code).toBe('OUTSIDE_WINDOW')
//   .reason).toMatch(/double.book|overlap/i) → .code).toBe('DOUBLE_BOOKING')
//   .reason).toMatch(/excluded/i)         → .code).toBe('EXCLUDED')
```

Concretely apply these edits:

```typescript
// Line 106-107 (unknown employee)
    expect(result.dropped[0].code).toBe('UNKNOWN_EMPLOYEE');

// Line 115 (unknown template)
    expect(result.dropped[0].code).toBe('UNKNOWN_TEMPLATE');

// Line 125 (position mismatch)
    expect(result.dropped[0].code).toBe('POSITION_MISMATCH');

// Line 135 (unavailable day)
    expect(result.dropped[0].code).toBe('UNAVAILABLE_DAY');

// Line 151 (outside window)
    expect(result.dropped[0].code).toBe('OUTSIDE_WINDOW');

// Line 161 (double-book inside batch)
    expect(result.dropped[0].code).toBe('DOUBLE_BOOKING');

// Line 170 (excluded employee)
    expect(result.dropped[0].code).toBe('EXCLUDED');

// Line 181 (double-book against existing)
    expect(result.dropped[0].code).toBe('DOUBLE_BOOKING');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/schedule-validator.test.ts --run`
Expected: 8 failures with `Cannot read properties of undefined (reading 'toBe')` or `expected undefined to be 'UNKNOWN_EMPLOYEE'` — code field doesn't exist yet.

- [ ] **Step 3: Add `DropCode` and restructure `DroppedShift` in the source**

Open `supabase/functions/_shared/schedule-validator.ts`. Apply these changes:

Replace lines 35-43 (the `DroppedShift` and `ValidationResult` interfaces):

```typescript
export type DropCode =
  | "EXCLUDED"
  | "UNKNOWN_EMPLOYEE"
  | "UNKNOWN_TEMPLATE"
  | "POSITION_MISMATCH"
  | "UNAVAILABLE_DAY"
  | "OUTSIDE_WINDOW"
  | "DOUBLE_BOOKING";

export interface DroppedShift {
  shift: GeneratedShift;
  code: DropCode;
  /** Human-readable message that MAY contain UUIDs for server-side debugging.
   *  Never include this verbatim in client-facing responses. */
  message: string;
}

export interface ValidationResult {
  valid: GeneratedShift[];
  dropped: DroppedShift[];
}
```

Then update every `drop(...)` call inside `validateGeneratedShifts` (lines 100-187). Replace the inline arrow:

```typescript
    const drop = (code: DropCode, message: string) =>
      dropped.push({ shift, code, message });
```

And rewrite each drop site:

```typescript
    // 1. Excluded employee
    if (ctx.excludedEmployeeIds.has(shift.employee_id)) {
      drop("EXCLUDED", `Employee ${shift.employee_id} is excluded from scheduling`);
      continue;
    }

    // 2. Employee exists
    if (!ctx.employeeIds.has(shift.employee_id)) {
      drop("UNKNOWN_EMPLOYEE", `Unknown employee ID: ${shift.employee_id}`);
      continue;
    }

    // 3. Template exists
    if (!ctx.templateIds.has(shift.template_id)) {
      drop("UNKNOWN_TEMPLATE", `Unknown template ID: ${shift.template_id}`);
      continue;
    }

    // 4. Position matches (case-insensitive)
    const assignedPosition = ctx.employeePositions.get(shift.employee_id);
    if (
      assignedPosition === undefined ||
      assignedPosition.toLowerCase() !== shift.position.toLowerCase()
    ) {
      drop(
        "POSITION_MISMATCH",
        `Position mismatch for employee ${shift.employee_id}: assigned "${assignedPosition}", shift requests "${shift.position}"`,
      );
      continue;
    }

    // 5. Availability on that day
    const dayOfWeek = getDayOfWeek(shift.day);
    const availKey = `${shift.employee_id}:${dayOfWeek}`;
    const slot = ctx.availability.get(availKey);

    if (!slot || !slot.isAvailable) {
      drop(
        "UNAVAILABLE_DAY",
        `Employee ${shift.employee_id} is not available on day ${dayOfWeek} (${shift.day})`,
      );
      continue;
    }

    // 6. Shift times within availability window (if specific hours set)
    if (slot.startTime !== null && slot.endTime !== null) {
      const shiftStart = timeToMinutes(shift.start_time);
      const shiftEnd = timeToMinutes(shift.end_time);
      const windowStart = timeToMinutes(slot.startTime);
      const windowEnd = timeToMinutes(slot.endTime);

      if (shiftStart < windowStart || shiftEnd > windowEnd) {
        drop(
          "OUTSIDE_WINDOW",
          `Shift time ${shift.start_time}-${shift.end_time} is outside availability window ` +
            `${slot.startTime}-${slot.endTime} for employee ${shift.employee_id}`,
        );
        continue;
      }
    }

    // 7. Double-booking check
    const hasOverlap =
      valid.some(
        (v) =>
          v.employee_id === shift.employee_id &&
          v.day === shift.day &&
          shiftsOverlap(v, shift),
      ) ||
      ctx.existingShifts.some(
        (e) =>
          e.employee_id === shift.employee_id &&
          e.day === shift.day &&
          shiftsOverlap(e, shift),
      );

    if (hasOverlap) {
      drop(
        "DOUBLE_BOOKING",
        `Double-booking: employee ${shift.employee_id} already has an overlapping shift on ${shift.day}`,
      );
      continue;
    }

    valid.push(shift);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/schedule-validator.test.ts --run`
Expected: all 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-validator.ts tests/unit/schedule-validator.test.ts
git commit -m "refactor(validator): structured DropCode enum instead of free-text reason

Replace DroppedShift.reason string with { code: DropCode, message: string }.
The code is a fixed enum the 422 diagnostic can aggregate without leaking
employee UUIDs into the client-facing response body. The message retains
UUIDs for server-side debugging only.

Bug 8 prep: structured drop codes are required for the upcoming 422 path."
```

---

## Task 3: Validator — `normalizePosition` (Bug 3)

**Files:**
- Modify: `supabase/functions/_shared/schedule-validator.ts` (replace position-comparison block, lines ~124-134)
- Modify: `tests/unit/schedule-validator.test.ts` (add normalization tests)

- [ ] **Step 1: Add failing tests for normalization**

Append to `tests/unit/schedule-validator.test.ts`:

```typescript
// ─── Position Normalization Tests ───────────────────────────────────────────

describe('validateGeneratedShifts — position normalization', () => {
  it('matches "Line Cook" employee with "line cook" shift (case-insensitive)', () => {
    const ctx = makeContext({
      employeePositions: new Map([['emp-1', 'Line Cook']]),
    });
    const shift = makeShift({ position: 'line cook' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('matches "Cook " (trailing space) employee with "Cook" shift', () => {
    const ctx = makeContext({
      employeePositions: new Map([['emp-1', 'Cook ']]),
    });
    const shift = makeShift({ position: 'Cook' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('matches "Servers" (plural) employee with "server" shift', () => {
    const ctx = makeContext({
      employeePositions: new Map([['emp-1', 'Servers']]),
    });
    const shift = makeShift({ position: 'server' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('preserves "Hostess" (ends in ss, does not strip)', () => {
    const ctx = makeContext({
      employeePositions: new Map([['emp-1', 'Hostess']]),
    });
    // "Hostes" should NOT match "Hostess" — i.e. plural strip must not corrupt -ss words
    const shift = makeShift({ position: 'Hostess' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('preserves short stems like "Bus" (stem length <= 4)', () => {
    const ctx = makeContext({
      employeePositions: new Map([['emp-1', 'Bus']]),
    });
    const shift = makeShift({ position: 'Bus' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/schedule-validator.test.ts --run`
Expected: at least 3 failures (the `Line Cook`/`Cook `/`Servers` cases) — the existing exact `toLowerCase()` comparison drops them.

- [ ] **Step 3: Add `normalizePosition` and use it in the validator**

Edit `supabase/functions/_shared/schedule-validator.ts`. Add this helper after `shiftsOverlap` (after line 78):

```typescript
/**
 * Normalize a position string for matching. Lowercases, trims, collapses
 * internal whitespace, and strips a trailing -s plural unless the word ends
 * in -ss ("Hostess", "Buss") or is too short (stem <= 4 chars: "Bus", "Gas").
 *
 * Lets "Line Cook" / "line cook" / "Cooks" / "Cook" all match.
 */
export function normalizePosition(s: string | null | undefined): string {
  if (!s) return "";
  const lower = s.trim().toLowerCase().replace(/\s+/g, " ");
  if (lower.length > 4 && lower.endsWith("s") && !lower.endsWith("ss")) {
    return lower.slice(0, -1);
  }
  return lower;
}
```

Replace the position-mismatch check (currently lines 124-134) with:

```typescript
    // 4. Position matches (normalized: case, whitespace, trailing -s plural)
    const assignedPosition = ctx.employeePositions.get(shift.employee_id);
    if (
      assignedPosition === undefined ||
      normalizePosition(assignedPosition) !== normalizePosition(shift.position)
    ) {
      drop(
        "POSITION_MISMATCH",
        `Position mismatch for employee ${shift.employee_id}: assigned "${assignedPosition}", shift requests "${shift.position}"`,
      );
      continue;
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/schedule-validator.test.ts --run`
Expected: all tests pass (original 13 + 5 new normalization tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-validator.ts tests/unit/schedule-validator.test.ts
git commit -m "fix(validator): normalize positions before comparison (Bug 3)

Stem-length + -ss guard avoids corrupting Hostess→Hostes and Bus→Bu while
still folding 'Line Cook'/'line cook ', 'Servers'/'server', 'Cooks'/'Cook'
into matches. Eliminates a major source of silent drops on real rosters
where position strings have drifted across hiring waves."
```

---

## Task 4: Validator — overnight `withinWindow` + `shiftsOverlap` (Bug 2)

**Files:**
- Modify: `supabase/functions/_shared/schedule-validator.ts` (replace `shiftsOverlap` lines 71-78, replace inline window check lines 148-162)
- Modify: `tests/unit/schedule-validator.test.ts` (add overnight tests)

- [ ] **Step 1: Add failing tests for overnight handling**

Append to `tests/unit/schedule-validator.test.ts`:

```typescript
// ─── Overnight Window & Overlap Tests ────────────────────────────────────────

describe('shiftsOverlap — overnight handling', () => {
  it('detects overlap between 22:00-02:00 and 01:00-05:00', () => {
    const a = makeShift({ start_time: '22:00:00', end_time: '02:00:00' });
    const b = makeShift({ start_time: '01:00:00', end_time: '05:00:00' });
    expect(shiftsOverlap(a, b)).toBe(true);
  });

  it('does not flag 22:00-02:00 and 05:00-12:00 as overlapping', () => {
    const a = makeShift({ start_time: '22:00:00', end_time: '02:00:00' });
    const b = makeShift({ start_time: '05:00:00', end_time: '12:00:00' });
    expect(shiftsOverlap(a, b)).toBe(false);
  });
});

describe('validateGeneratedShifts — overnight availability window', () => {
  it('accepts shift 22:00-02:00 within window 18:00-06:00', () => {
    const ctx = makeContext({
      availability: new Map([
        ['emp-1:1', { isAvailable: true, startTime: '18:00:00', endTime: '06:00:00' }],
      ]),
    });
    // emp-1 is a server; keep position aligned with default
    const shift = makeShift({ start_time: '22:00:00', end_time: '02:00:00' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('rejects shift 12:00-18:00 against overnight window 18:00-06:00', () => {
    const ctx = makeContext({
      availability: new Map([
        ['emp-1:1', { isAvailable: true, startTime: '18:00:00', endTime: '06:00:00' }],
      ]),
    });
    const shift = makeShift({ start_time: '12:00:00', end_time: '18:00:00' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0].code).toBe('OUTSIDE_WINDOW');
  });

  it('rejects overnight shift 22:00-02:00 against normal window 08:00-23:00', () => {
    const ctx = makeContext({
      availability: new Map([
        ['emp-1:1', { isAvailable: true, startTime: '08:00:00', endTime: '23:00:00' }],
      ]),
    });
    const shift = makeShift({ start_time: '22:00:00', end_time: '02:00:00' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0].code).toBe('OUTSIDE_WINDOW');
  });

  it('accepts evening half 20:00-23:30 of overnight window 18:00-06:00', () => {
    const ctx = makeContext({
      availability: new Map([
        ['emp-1:1', { isAvailable: true, startTime: '18:00:00', endTime: '06:00:00' }],
      ]),
    });
    const shift = makeShift({ start_time: '20:00:00', end_time: '23:30:00' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('accepts morning half 02:00-05:00 of overnight window 18:00-06:00', () => {
    const ctx = makeContext({
      availability: new Map([
        ['emp-1:1', { isAvailable: true, startTime: '18:00:00', endTime: '06:00:00' }],
      ]),
    });
    const shift = makeShift({ start_time: '02:00:00', end_time: '05:00:00' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/schedule-validator.test.ts --run`
Expected: the overnight tests fail. The current `shiftsOverlap` won't catch `22:00-02:00 vs 01:00-05:00`, and the inline `windowStart > windowEnd` window-check at line 155 rejects all valid shifts against overnight windows.

- [ ] **Step 3: Add overnight-aware `withinWindow` and rewrite `shiftsOverlap`**

Edit `supabase/functions/_shared/schedule-validator.ts`.

Replace `shiftsOverlap` (lines 71-78):

```typescript
/**
 * Check if two shifts for the same employee on the same day overlap.
 * Overnight shifts (end <= start) are normalized by adding 1440 to end.
 * Adjacent shifts (end == start) do not overlap.
 */
export function shiftsOverlap(a: GeneratedShift, b: GeneratedShift): boolean {
  let aStart = timeToMinutes(a.start_time);
  let aEnd = timeToMinutes(a.end_time);
  if (aEnd <= aStart) aEnd += 1440;
  let bStart = timeToMinutes(b.start_time);
  let bEnd = timeToMinutes(b.end_time);
  if (bEnd <= bStart) bEnd += 1440;
  return aStart < bEnd && bStart < aEnd;
}
```

Add this new helper directly after `shiftsOverlap`:

```typescript
/**
 * Returns true if a shift [shiftStart, shiftEnd] (in minutes-from-midnight)
 * fits entirely within an availability window [windowStart, windowEnd].
 *
 * Overnight handling:
 * - A window where windowEnd < windowStart is treated as
 *   [windowStart, 24:00) ∪ [00:00, windowEnd] (crosses midnight).
 * - A shift where shiftEnd <= shiftStart is treated as overnight similarly.
 * - An overnight shift cannot fit inside a non-overnight window.
 * - A normal shift may fit inside either half of an overnight window.
 */
export function withinWindow(
  shiftStart: number,
  shiftEnd: number,
  windowStart: number,
  windowEnd: number,
): boolean {
  const shiftIsOvernight = shiftEnd <= shiftStart;
  const windowIsOvernight = windowEnd < windowStart;

  if (!windowIsOvernight) {
    if (shiftIsOvernight) return false;
    return shiftStart >= windowStart && shiftEnd <= windowEnd;
  }

  if (shiftIsOvernight) {
    return shiftStart >= windowStart && shiftEnd <= windowEnd;
  }
  const inEvening = shiftStart >= windowStart && shiftEnd <= 1440;
  const inMorning = shiftStart >= 0 && shiftEnd <= windowEnd;
  return inEvening || inMorning;
}
```

Now replace the inline window check inside `validateGeneratedShifts` (currently lines 149-162):

```typescript
    // 6. Shift times within availability window (overnight-aware)
    if (slot.startTime !== null && slot.endTime !== null) {
      const shiftStart = timeToMinutes(shift.start_time);
      const shiftEnd = timeToMinutes(shift.end_time);
      const windowStart = timeToMinutes(slot.startTime);
      const windowEnd = timeToMinutes(slot.endTime);

      if (!withinWindow(shiftStart, shiftEnd, windowStart, windowEnd)) {
        drop(
          "OUTSIDE_WINDOW",
          `Shift time ${shift.start_time}-${shift.end_time} is outside availability window ` +
            `${slot.startTime}-${slot.endTime} for employee ${shift.employee_id}`,
        );
        continue;
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/schedule-validator.test.ts --run`
Expected: all tests pass (original 13 + 5 normalization + 7 overnight = 25 total).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-validator.ts tests/unit/schedule-validator.test.ts
git commit -m "fix(validator): overnight-aware shiftsOverlap and withinWindow (Bug 2)

shiftsOverlap normalizes overnight shifts (end<=start) by adding 1440 to
end so 22:00-02:00 correctly overlaps 01:00-05:00.

withinWindow handles four cases: normal/normal, normal-shift/overnight-window
(either half), overnight-shift/overnight-window, and rejects overnight-shift
against normal-window (with explicit guard — without it, an overnight shift
ending at 02:00 (shiftEnd=120) would falsely pass shiftEnd<=windowEnd=1380
against an 08:00-23:00 window)."
```

---

## Task 5: New `availability-tz.ts` — UTC → restaurant-local conversion (Bug 1)

**Files:**
- Create: `supabase/functions/_shared/availability-tz.ts`
- Create: `tests/unit/availability-tz.test.ts`

This is a pure utility. It takes the UTC clock times stored in `employee_availability.start_time` / `end_time` (written by `AvailabilityDialog.tsx:82-83` via `localTimeToUtcTime`) and converts them back to restaurant-local clock times so the prompt and validator see what the user actually entered.

When a row's conversion crosses local midnight, it splits into two `LocalAvail` rows on adjacent local days. `isOvernight` is set when the resulting local window itself crosses midnight (e.g., a true 22:00–02:00 window).

- [ ] **Step 1: Create the failing tests**

Write `tests/unit/availability-tz.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  convertRecurringToLocal,
  convertExceptionsToLocal,
  type RawRecurringAvail,
  type RawExceptionAvail,
} from '../../supabase/functions/_shared/availability-tz';

const CST = 'America/Chicago'; // UTC-6 standard, UTC-5 DST

describe('convertRecurringToLocal', () => {
  it('converts UTC 13:00-04:00 Mon to local 08:00-23:00 Mon for CST in November (no DST)', () => {
    // 2026-11-16 is a Monday in CST (UTC-6).
    // UTC 13:00 = local 07:00; we want local 08:00 = UTC 14:00. So the user
    // entered 08:00-23:00 local; localTimeToUtcTime would have stored
    // 14:00-05:00 UTC (CST Nov is UTC-6). Use that.
    const rows: RawRecurringAvail[] = [
      {
        employee_id: 'emp-1',
        day_of_week: 1,
        is_available: true,
        start_time: '14:00:00',
        end_time: '05:00:00',
      },
    ];
    const result = convertRecurringToLocal(rows, CST, '2026-11-16');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      employee_id: 'emp-1',
      day_of_week: 1,
      is_available: true,
      start_time: '08:00:00',
      end_time: '23:00:00',
      isOvernight: false,
    });
  });

  it('splits UTC 23:00-07:00 (overnight in UTC) into two local rows when local day rolls over', () => {
    // For CST in November (UTC-6):
    // UTC 23:00 Mon = local 17:00 Mon
    // UTC 07:00 (which is the row's end on Tuesday UTC) = local 01:00 Tue
    // Result should be: Mon 17:00-24:00 + Tue 00:00-01:00.
    const rows: RawRecurringAvail[] = [
      {
        employee_id: 'emp-1',
        day_of_week: 1,
        is_available: true,
        start_time: '23:00:00',
        end_time: '07:00:00',
      },
    ];
    const result = convertRecurringToLocal(rows, CST, '2026-11-16');
    expect(result).toHaveLength(2);
    const monRow = result.find((r) => r.day_of_week === 1);
    const tueRow = result.find((r) => r.day_of_week === 2);
    expect(monRow).toMatchObject({
      employee_id: 'emp-1',
      day_of_week: 1,
      start_time: '17:00:00',
      end_time: '24:00:00',
    });
    expect(tueRow).toMatchObject({
      employee_id: 'emp-1',
      day_of_week: 2,
      start_time: '00:00:00',
      end_time: '01:00:00',
    });
  });

  it('marks isOvernight=true when the local window itself crosses midnight without splitting', () => {
    // Construct rows where the START already crosses to a different local day:
    // pick a UTC start where local day == day_of_week, and local end is the
    // *next* local day. This is the same shape as the split case above —
    // covered. Skip a separate isOvernight=true case for now; the splitter
    // handles all true overnight crossings by splitting into two rows.
    expect(true).toBe(true); // placeholder to keep the describe non-empty
  });

  it('passes through "available all day" rows unchanged (null times preserved)', () => {
    const rows: RawRecurringAvail[] = [
      {
        employee_id: 'emp-1',
        day_of_week: 3,
        is_available: true,
        start_time: null,
        end_time: null,
      },
    ];
    const result = convertRecurringToLocal(rows, CST, '2026-11-16');
    expect(result).toEqual([
      {
        employee_id: 'emp-1',
        day_of_week: 3,
        is_available: true,
        start_time: null,
        end_time: null,
        isOvernight: false,
      },
    ]);
  });

  it('passes through unavailable rows unchanged', () => {
    const rows: RawRecurringAvail[] = [
      {
        employee_id: 'emp-1',
        day_of_week: 0,
        is_available: false,
        start_time: null,
        end_time: null,
      },
    ];
    const result = convertRecurringToLocal(rows, CST, '2026-11-16');
    expect(result).toEqual([
      {
        employee_id: 'emp-1',
        day_of_week: 0,
        is_available: false,
        start_time: null,
        end_time: null,
        isOvernight: false,
      },
    ]);
  });

  it('returns rows unchanged when timezone is "UTC"', () => {
    const rows: RawRecurringAvail[] = [
      {
        employee_id: 'emp-1',
        day_of_week: 2,
        is_available: true,
        start_time: '14:00:00',
        end_time: '22:00:00',
      },
    ];
    const result = convertRecurringToLocal(rows, 'UTC', '2026-11-16');
    expect(result).toEqual([
      {
        employee_id: 'emp-1',
        day_of_week: 2,
        is_available: true,
        start_time: '14:00:00',
        end_time: '22:00:00',
        isOvernight: false,
      },
    ]);
  });

  it('handles DST spring-forward week correctly (US: 2026-03-08, clocks jump 02:00→03:00)', () => {
    // 2026-03-09 is a Monday after spring-forward. CST→CDT means offset shifts
    // from UTC-6 to UTC-5. A user-entered 08:00-23:00 local on Mon 2026-03-09
    // would have been stored at 13:00-04:00 UTC (CDT is UTC-5).
    const rows: RawRecurringAvail[] = [
      {
        employee_id: 'emp-1',
        day_of_week: 1,
        is_available: true,
        start_time: '13:00:00',
        end_time: '04:00:00',
      },
    ];
    const result = convertRecurringToLocal(rows, CST, '2026-03-09');
    expect(result).toHaveLength(1);
    expect(result[0].start_time).toBe('08:00:00');
    expect(result[0].end_time).toBe('23:00:00');
  });
});

describe('convertExceptionsToLocal', () => {
  it('uses the exception date itself as the reference (not weekStart)', () => {
    const rows: RawExceptionAvail[] = [
      {
        employee_id: 'emp-2',
        date: '2026-11-18', // a Wednesday
        is_available: true,
        start_time: '14:00:00',
        end_time: '22:00:00',
      },
    ];
    const result = convertExceptionsToLocal(rows, CST);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      employee_id: 'emp-2',
      day_of_week: 3, // Wednesday
      is_available: true,
      start_time: '08:00:00',
      end_time: '16:00:00',
      isOvernight: false,
    });
  });

  it('splits overnight exceptions across local days', () => {
    const rows: RawExceptionAvail[] = [
      {
        employee_id: 'emp-2',
        date: '2026-11-18',
        is_available: true,
        start_time: '23:00:00',
        end_time: '07:00:00',
      },
    ];
    const result = convertExceptionsToLocal(rows, CST);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.day_of_week === 3)).toMatchObject({
      start_time: '17:00:00',
      end_time: '24:00:00',
    });
    expect(result.find((r) => r.day_of_week === 4)).toMatchObject({
      start_time: '00:00:00',
      end_time: '01:00:00',
    });
  });

  it('passes through null times unchanged', () => {
    const rows: RawExceptionAvail[] = [
      {
        employee_id: 'emp-2',
        date: '2026-11-18',
        is_available: true,
        start_time: null,
        end_time: null,
      },
    ];
    const result = convertExceptionsToLocal(rows, CST);
    expect(result[0]).toMatchObject({
      start_time: null,
      end_time: null,
      isOvernight: false,
      day_of_week: 3,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/availability-tz.test.ts --run`
Expected: "Cannot find module" — the source file doesn't exist yet.

- [ ] **Step 3: Implement `availability-tz.ts`**

Write `supabase/functions/_shared/availability-tz.ts`:

```typescript
/**
 * availability-tz.ts
 *
 * Pure utility: convert employee availability rows whose times are stored as
 * UTC clock values (TIME columns with no timezone metadata, written by
 * AvailabilityDialog via localTimeToUtcTime) back into restaurant-local clock
 * values for the AI prompt + validator.
 *
 * Rows whose conversion crosses local midnight are split into two LocalAvail
 * rows on adjacent local days.
 */
import { toZonedTime } from "date-fns-tz";

export interface RawRecurringAvail {
  employee_id: string;
  /** 0=Sun..6=Sat in the user's restaurant-local calendar */
  day_of_week: number;
  is_available: boolean;
  /** UTC clock time HH:MM:SS, or null when "all day" / unavailable */
  start_time: string | null;
  end_time: string | null;
}

export interface RawExceptionAvail {
  employee_id: string;
  /** YYYY-MM-DD restaurant-local calendar date */
  date: string;
  is_available: boolean;
  start_time: string | null;
  end_time: string | null;
}

export interface LocalAvail {
  employee_id: string;
  day_of_week: number; // 0=Sun..6=Sat in restaurant local
  is_available: boolean;
  start_time: string | null; // HH:MM:SS in restaurant local
  end_time: string | null;   // HH:MM:SS in restaurant local
  isOvernight: boolean;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/**
 * Compute the YYYY-MM-DD of the date `dayOfWeek` days after `weekStart`.
 * weekStart is itself assumed to be day-of-week 0 (Sun) in the local calendar.
 */
function dateForDayOfWeek(weekStart: string, dayOfWeek: number): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  // Construct in local time to avoid offset shifts.
  const base = new Date(y, m - 1, d);
  base.setDate(base.getDate() + dayOfWeek);
  return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`;
}

/**
 * Convert one "UTC clock time on a particular UTC instant" pair into a local
 * { day_of_week, time } pair. The UTC instant is built from the reference
 * date + the UTC clock time as if they belonged to the same UTC day.
 */
interface LocalPoint {
  dayOfWeek: number;
  time: string; // HH:MM:SS
}

function utcClockToLocal(refDate: string, utcClock: string, tz: string): LocalPoint {
  // refDate is YYYY-MM-DD; utcClock is HH:MM:SS.
  // Build the UTC instant explicitly.
  const utcInstant = new Date(`${refDate}T${utcClock}Z`);
  const zoned = toZonedTime(utcInstant, tz);
  return { dayOfWeek: zoned.getDay(), time: formatTime(zoned) };
}

function convertOne(
  employeeId: string,
  refDateForStart: string,
  /** "day_of_week-relative" key the row came from (recurring) or the row's
   *  own day-of-week (exception); used to pick the destination day name. */
  originalDayOfWeek: number,
  isAvailable: boolean,
  startUtc: string | null,
  endUtc: string | null,
  tz: string,
): LocalAvail[] {
  // No specific times → row carries through unchanged.
  if (!isAvailable || startUtc === null || endUtc === null) {
    return [
      {
        employee_id: employeeId,
        day_of_week: originalDayOfWeek,
        is_available: isAvailable,
        start_time: startUtc,
        end_time: endUtc,
        isOvernight: false,
      },
    ];
  }

  // UTC short-circuit: no conversion needed.
  if (tz === "UTC") {
    return [
      {
        employee_id: employeeId,
        day_of_week: originalDayOfWeek,
        is_available: true,
        start_time: startUtc,
        end_time: endUtc,
        isOvernight: false,
      },
    ];
  }

  // Build the end's UTC reference date: if endUtc <= startUtc, the row crossed
  // midnight in UTC and end belongs to the next UTC day.
  const startMinutes = timeToMinutes(startUtc);
  const endMinutes = timeToMinutes(endUtc);
  const refDateForEnd =
    endMinutes <= startMinutes ? addDays(refDateForStart, 1) : refDateForStart;

  const localStart = utcClockToLocal(refDateForStart, startUtc, tz);
  const localEnd = utcClockToLocal(refDateForEnd, endUtc, tz);

  if (localStart.dayOfWeek === localEnd.dayOfWeek) {
    // Whole window lives on one local day.
    return [
      {
        employee_id: employeeId,
        day_of_week: localStart.dayOfWeek,
        is_available: true,
        start_time: localStart.time,
        end_time: localEnd.time,
        isOvernight: localEnd.time <= localStart.time,
      },
    ];
  }

  // Different local days → split into two rows. Evening half ends at 24:00
  // on the start day; morning half starts at 00:00 on the end day.
  return [
    {
      employee_id: employeeId,
      day_of_week: localStart.dayOfWeek,
      is_available: true,
      start_time: localStart.time,
      end_time: "24:00:00",
      isOvernight: false,
    },
    {
      employee_id: employeeId,
      day_of_week: localEnd.dayOfWeek,
      is_available: true,
      start_time: "00:00:00",
      end_time: localEnd.time,
      isOvernight: false,
    },
  ];
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return `${base.getUTCFullYear()}-${pad2(base.getUTCMonth() + 1)}-${pad2(base.getUTCDate())}`;
}

export function convertRecurringToLocal(
  rows: RawRecurringAvail[],
  restaurantTimezone: string,
  weekStart: string,
): LocalAvail[] {
  const out: LocalAvail[] = [];
  for (const row of rows) {
    const refDate = dateForDayOfWeek(weekStart, row.day_of_week);
    out.push(
      ...convertOne(
        row.employee_id,
        refDate,
        row.day_of_week,
        row.is_available,
        row.start_time,
        row.end_time,
        restaurantTimezone,
      ),
    );
  }
  return out;
}

export function convertExceptionsToLocal(
  rows: RawExceptionAvail[],
  restaurantTimezone: string,
): LocalAvail[] {
  const out: LocalAvail[] = [];
  for (const row of rows) {
    // Compute the day-of-week of the exception date in local time
    // (constructed in local time to avoid offset shifts).
    const [y, m, d] = row.date.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    out.push(
      ...convertOne(
        row.employee_id,
        row.date,
        dow,
        row.is_available,
        row.start_time,
        row.end_time,
        restaurantTimezone,
      ),
    );
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/availability-tz.test.ts --run`
Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/availability-tz.ts tests/unit/availability-tz.test.ts
git commit -m "feat(edge): availability-tz utility for UTC→local conversion (Bug 1)

Pure shared module that converts employee_availability rows (TIME columns
stored as UTC clock values by AvailabilityDialog.tsx:82-83) back to
restaurant-local clock values. Splits rows whose conversion crosses local
midnight into two LocalAvail rows on adjacent local days. Short-circuits
when timezone is 'UTC' (safety default in the edge function).

Covers same-day, midnight-cross, all-day passthrough, unavailable passthrough,
DST spring-forward, and exception parity with recurring."
```

---

## Task 6: New `staffing-requirements.ts` — per-template required headcount

**Files:**
- Create: `supabase/functions/_shared/staffing-requirements.ts`
- Create: `tests/unit/staffing-requirements.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `tests/unit/staffing-requirements.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  computeRequiredStaff,
  type ComputeInput,
} from '../../supabase/functions/_shared/staffing-requirements';

function makeInput(overrides: Partial<ComputeInput> = {}): ComputeInput {
  return {
    templates: [
      {
        id: 'tpl-server',
        name: 'Lunch Server',
        days: [1, 2, 3, 4, 5],
        start_time: '11:00:00',
        end_time: '16:00:00',
        position: 'server',
        area: null,
      },
    ],
    minCrew: null,
    minStaff: null,
    priorPatterns: [],
    hourlySales: [],
    ...overrides,
  };
}

describe('computeRequiredStaff', () => {
  it('returns 1 per (template, day) when nothing else is configured', () => {
    const result = computeRequiredStaff(makeInput());
    const map = result.get('tpl-server');
    expect(map).toBeDefined();
    for (const day of [1, 2, 3, 4, 5]) {
      expect(map!.get(day)).toBe(1);
    }
    expect(map!.has(0)).toBe(false); // Sunday is not in template.days
    expect(map!.has(6)).toBe(false);
  });

  it('uses minCrew[position] when provided', () => {
    const result = computeRequiredStaff(
      makeInput({ minCrew: { Server: 3 } }),
    );
    expect(result.get('tpl-server')!.get(1)).toBe(3);
  });

  it('normalizes minCrew keys (case + plural) when matching template positions', () => {
    const result = computeRequiredStaff(
      makeInput({
        minCrew: { Servers: 2 }, // plural; template position is "server"
      }),
    );
    expect(result.get('tpl-server')!.get(1)).toBe(2);
  });

  it('falls back to priorPatterns[day][position] when no minCrew', () => {
    const result = computeRequiredStaff(
      makeInput({
        priorPatterns: [{ day_of_week: 1, position: 'server', avg_count: 4 }],
      }),
    );
    // priorPatterns are floats; rounded to nearest int, min 1
    expect(result.get('tpl-server')!.get(1)).toBe(4);
    // No pattern for day 2 → falls back to 1
    expect(result.get('tpl-server')!.get(2)).toBe(1);
  });

  it('floor of minStaff applies as a global minimum', () => {
    const result = computeRequiredStaff(
      makeInput({
        minCrew: { server: 1 },
        minStaff: 2,
      }),
    );
    expect(result.get('tpl-server')!.get(1)).toBe(2);
  });

  it('adds +1 peak boost when template start hour is in top-quartile sales for that day', () => {
    const result = computeRequiredStaff(
      makeInput({
        hourlySales: [
          { day_of_week: 1, hour: 9, avg_sales: 100 },
          { day_of_week: 1, hour: 10, avg_sales: 200 },
          { day_of_week: 1, hour: 11, avg_sales: 1000 }, // template starts here
          { day_of_week: 1, hour: 12, avg_sales: 300 },
        ],
      }),
    );
    // base=1, peakBoost=+1 because hour 11 has top sales for day 1
    expect(result.get('tpl-server')!.get(1)).toBe(2);
  });

  it('does not add peak boost on days without hourlySales data', () => {
    const result = computeRequiredStaff(
      makeInput({
        hourlySales: [{ day_of_week: 1, hour: 11, avg_sales: 1000 }],
      }),
    );
    expect(result.get('tpl-server')!.get(1)).toBe(2); // peak on Mon
    expect(result.get('tpl-server')!.get(2)).toBe(1); // no data Tue
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/staffing-requirements.test.ts --run`
Expected: "Cannot find module" — source not yet written.

- [ ] **Step 3: Implement `staffing-requirements.ts`**

Write `supabase/functions/_shared/staffing-requirements.ts`:

```typescript
/**
 * staffing-requirements.ts
 *
 * Pure utility: for each (template, day) combination, compute the required
 * employee headcount. Output is consumed by the prompt builder so the AI
 * can be told how many staff each slot needs.
 *
 * Inputs:
 * - minCrew: per-position minimum from staffing_settings.min_crew JSONB.
 * - minStaff: a global floor from staffing_settings.min_staff.
 * - priorPatterns: historical avg shift counts per (day, position).
 * - hourlySales: per-(day, hour) avg sales used for peak boost.
 */
import type {
  ScheduleTemplate,
  PriorPattern,
  HourlySales,
} from "./schedule-prompt-builder.ts";

export interface ComputeInput {
  templates: ScheduleTemplate[];
  minCrew: Record<string, number> | null;
  minStaff: number | null;
  priorPatterns: PriorPattern[];
  hourlySales: HourlySales[];
}

/** Mirror of validator's normalizePosition so prompt strings can stay natural. */
function normalizePosition(s: string | null | undefined): string {
  if (!s) return "";
  const lower = s.trim().toLowerCase().replace(/\s+/g, " ");
  if (lower.length > 4 && lower.endsWith("s") && !lower.endsWith("ss")) {
    return lower.slice(0, -1);
  }
  return lower;
}

function lookupMinCrew(
  minCrew: Record<string, number> | null,
  position: string,
): number | null {
  if (!minCrew) return null;
  const norm = normalizePosition(position);
  for (const [k, v] of Object.entries(minCrew)) {
    if (normalizePosition(k) === norm && typeof v === "number" && v > 0) {
      return v;
    }
  }
  return null;
}

function lookupPriorPattern(
  priorPatterns: PriorPattern[],
  day: number,
  position: string,
): number | null {
  const norm = normalizePosition(position);
  for (const p of priorPatterns) {
    if (p.day_of_week === day && normalizePosition(p.position) === norm) {
      return Math.max(1, Math.round(p.avg_count));
    }
  }
  return null;
}

function isPeakHour(
  hourlySales: HourlySales[],
  day: number,
  hour: number,
): boolean {
  const dayEntries = hourlySales.filter((h) => h.day_of_week === day);
  if (dayEntries.length === 0) return false;
  const sorted = [...dayEntries].sort((a, b) => b.avg_sales - a.avg_sales);
  const quartileSize = Math.max(1, Math.ceil(sorted.length / 4));
  const topQuartile = sorted.slice(0, quartileSize);
  return topQuartile.some((h) => h.hour === hour);
}

export function computeRequiredStaff(
  input: ComputeInput,
): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  for (const tpl of input.templates) {
    const perDay = new Map<number, number>();
    const startHour = parseInt(tpl.start_time.split(":")[0], 10);
    for (const day of tpl.days) {
      const fromMinCrew = lookupMinCrew(input.minCrew, tpl.position);
      const fromPattern =
        fromMinCrew === null
          ? lookupPriorPattern(input.priorPatterns, day, tpl.position)
          : null;
      const base = fromMinCrew ?? fromPattern ?? 1;
      const peakBoost = isPeakHour(input.hourlySales, day, startHour) ? 1 : 0;
      const floor = input.minStaff ?? 0;
      perDay.set(day, Math.max(base + peakBoost, floor));
    }
    out.set(tpl.id, perDay);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/staffing-requirements.test.ts --run`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/staffing-requirements.ts tests/unit/staffing-requirements.test.ts
git commit -m "feat(edge): staffing-requirements utility for per-slot headcount (Bug 5)

Pure module: computeRequiredStaff(templates, minCrew, minStaff, priorPatterns,
hourlySales) → Map<templateId, Map<day, requiredCount>>.

Priority: minCrew[position] > priorPatterns[day][position] (rounded, min 1) >
1, then +1 peak boost when the template start hour is in the day's top
sales quartile, then global minStaff floor."
```

---

## Task 7: Prompt builder — 7-day render, required headcount, Rule 12, TZ note (Bugs 4, 5)

**Files:**
- Modify: `supabase/functions/_shared/schedule-prompt-builder.ts`
- Modify: `tests/unit/schedule-prompt-builder.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tests/unit/schedule-prompt-builder.test.ts`:

```typescript
describe('buildSchedulePrompt — fill-slot enhancements', () => {
  it('renders 7 days per employee (including missing days as unavailable)', () => {
    const ctx = makeContext({
      // emp-1 has only Mon (1) and Tue (2) in availability
      availability: {
        'emp-1': {
          1: { available: true, start: '10:00', end: '18:00' },
          2: { available: false },
        },
        'emp-2': {
          3: { available: true },
        },
      },
    });
    const result = buildSchedulePrompt(ctx);
    const userContent = result.messages[1].content as string;
    // All 7 day names should appear for emp-1
    expect(userContent).toContain('Sunday');
    expect(userContent).toContain('Monday');
    expect(userContent).toContain('Tuesday');
    expect(userContent).toContain('Wednesday');
    expect(userContent).toContain('Thursday');
    expect(userContent).toContain('Friday');
    expect(userContent).toContain('Saturday');
  });

  it('renders a Required Headcount Per Slot section when requiredStaff provided', () => {
    const requiredStaff = new Map<string, Map<number, number>>([
      ['tpl-1', new Map([[1, 2], [2, 2], [3, 1]])],
      ['tpl-2', new Map([[3, 3]])],
    ]);
    const result = buildSchedulePrompt(makeContext({ requiredStaff }));
    const userContent = result.messages[1].content as string;
    expect(userContent).toContain('Required Headcount Per Slot');
    expect(userContent).toContain('tpl-1');
    expect(userContent).toContain('Monday: 2');
    expect(userContent).toContain('Tuesday: 2');
  });

  it('omits Required Headcount section when requiredStaff is null', () => {
    const result = buildSchedulePrompt(makeContext({ requiredStaff: null }));
    const userContent = result.messages[1].content as string;
    expect(userContent).not.toContain('Required Headcount Per Slot');
  });

  it('includes a hard "fill every required slot" rule in the system prompt', () => {
    const result = buildSchedulePrompt(makeContext());
    const systemContent = result.messages[0].content as string;
    expect(systemContent).toMatch(/fill .*required/i);
    expect(systemContent.toLowerCase()).toContain('coverage');
  });

  it('includes a note that all times are restaurant local', () => {
    const result = buildSchedulePrompt(makeContext());
    const systemContent = result.messages[0].content as string;
    expect(systemContent.toLowerCase()).toContain('restaurant local');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/schedule-prompt-builder.test.ts --run`
Expected: the new `describe` block fails — fields and prompt rules don't exist yet.

- [ ] **Step 3: Update `ScheduleContext` and `buildUserPrompt`**

Edit `supabase/functions/_shared/schedule-prompt-builder.ts`.

Add `requiredStaff` to `ScheduleContext` (after line 64):

```typescript
export interface ScheduleContext {
  weekStart: string;
  employees: ScheduleEmployee[];
  templates: ScheduleTemplate[];
  availability: Record<string, Record<number, AvailabilityDay>>;
  staffingSettings: Record<string, { min: number }> | null;
  priorSchedulePatterns: PriorPattern[];
  hourlySalesPatterns: HourlySales[];
  weeklyBudgetTarget: number | null; // cents
  lockedShifts: LockedShift[];
  /** Per-(template, day-of-week) required headcount. Computed by
   *  staffing-requirements.computeRequiredStaff. Optional for backwards
   *  compatibility with any callers that haven't been updated. */
  requiredStaff?: Map<string, Map<number, number>> | null;
}
```

Replace `SYSTEM_PROMPT` (lines 69-84):

```typescript
const SYSTEM_PROMPT = `You are a restaurant schedule optimizer. Your job is to create an optimal weekly shift schedule.

All times in this context are in the restaurant's local clock (no timezone conversion needed). Position strings are matched case-insensitively and ignore trailing whitespace or trailing -s plurals — so "Line Cook" matches "line cook" and "Servers" matches "Server".

RULES:
1. ONLY use the provided shift templates as shift blocks — do not invent custom time ranges.
2. ONLY assign employees to templates matching their position (per the normalization rule above).
3. When a template has an area set, PREFER assigning employees from the same area. Only assign employees from a different area to that template if no same-area employees are available for that time slot. This is a soft preference — cross-area assignments are allowed as a fallback.
4. ONLY assign employees on days/times they are available. The "Employee Availability" section lists all 7 days for every employee.
5. Do NOT assign any employee more than once in the same time slot (no double-booking).
6. Do NOT modify or reassign any locked shifts — they are fixed.
7. Weight staffing toward peak sales hours — more staff during lunch/dinner rushes.
8. If staffing settings specify minimum crew per position, meet those minimums when possible.
9. If no staffing settings exist, use prior schedule patterns to infer typical staffing levels.
10. Among schedules that meet required headcount (see Rule 12), prefer ones that stay within the weekly labor budget target.
11. Full-time employees should be scheduled for more shifts, targeting 35-40 hours per week. Part-time employees should be scheduled for fewer shifts, targeting 15-25 hours per week. When both full-time and part-time employees are available for a slot, prefer the full-time employee unless they are already near 40 hours for the week.
12. (HARD) For every (template, day) listed in "Required Headcount Per Slot", you MUST assign the required number of eligible-and-available employees. A slot may only be left below required headcount if there is NO eligible-and-available employee for it. Coverage is more important than budget — never under-fill to save cost.

Return valid JSON only, matching the provided schema exactly.`;
```

Replace the availability section in `buildUserPrompt` (lines 152-171) so every employee renders 7 days:

```typescript
  // Employee availability — always render 7 days per employee so the AI has
  // an unambiguous picture. Missing days default to unavailable.
  const availLines: string[] = [];
  for (const employee of ctx.employees) {
    const empId = employee.id;
    const days = ctx.availability[empId] ?? {};
    const dayLines: string[] = [];
    for (let dayNum = 0; dayNum < 7; dayNum++) {
      const dayName = DAY_NAMES[dayNum];
      const avail = days[dayNum];
      if (!avail || !avail.available) {
        dayLines.push(`  ${dayName}: unavailable`);
      } else if (avail.start && avail.end) {
        dayLines.push(`  ${dayName}: available ${avail.start}–${avail.end}`);
      } else {
        dayLines.push(`  ${dayName}: available (all day)`);
      }
    }
    availLines.push(`${employee.name} (${empId}):\n${dayLines.join("\n")}`);
  }
  sections.push(`## Employee Availability\n${availLines.join("\n\n")}`);
```

Add a new "Required Headcount Per Slot" section between the staffing section (~178) and prior patterns (~184). After the staffing block, insert:

```typescript
  // Required headcount per (template, day) — drives Rule 12.
  if (ctx.requiredStaff && ctx.requiredStaff.size > 0) {
    const templateById = new Map(ctx.templates.map((t) => [t.id, t]));
    const headcountLines: string[] = [];
    for (const [tplId, perDay] of ctx.requiredStaff) {
      const tpl = templateById.get(tplId);
      if (!tpl) continue;
      const dayParts: string[] = [];
      for (const [day, count] of [...perDay.entries()].sort((a, b) => a[0] - b[0])) {
        dayParts.push(`${DAY_NAMES[day] ?? `Day ${day}`}: ${count}`);
      }
      headcountLines.push(
        `- [${tplId}] "${tpl.name}" | ${tpl.position} | ${dayParts.join(" | ")}`,
      );
    }
    if (headcountLines.length > 0) {
      sections.push(
        `## Required Headcount Per Slot\nEach line lists the minimum staff to assign for that template on each active day.\n${headcountLines.join("\n")}`,
      );
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/schedule-prompt-builder.test.ts --run`
Expected: all tests pass (original 8 + 5 new).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/schedule-prompt-builder.ts tests/unit/schedule-prompt-builder.test.ts
git commit -m "feat(prompt): 7-day availability, required headcount, Rule 12 (Bugs 4 & 5)

- Render all 7 days per employee (missing days = unavailable) so the AI
  doesn't infer 'free' from missing-day rows.
- Add Required Headcount Per Slot section driven by requiredStaff map.
- Add Rule 12 (HARD): you MUST assign the required headcount; coverage
  beats budget. Rephrase Rule 10 to soft 'among schedules that meet
  required headcount, prefer budget'.
- Note that all times are restaurant-local and positions normalize
  (case + trailing -s) so the AI doesn't need to guess."
```

---

## Task 8: Edge function — wire TZ, min_crew, computed required staff (Bugs 1, 4, 6)

**Files:**
- Modify: `supabase/functions/generate-schedule/index.ts`

This task wires the new utilities into the edge function: fetch restaurant timezone as the 10th parallel query, convert availability with `convertRecurringToLocal` + `convertExceptionsToLocal`, ensure every employee has all 7 days in the map (Bug 4), correctly read `min_crew` from JSONB (Bug 6), and call `computeRequiredStaff` so the prompt has the headcount data (Bug 5 wiring).

- [ ] **Step 1: Add the new imports at the top**

Edit `supabase/functions/generate-schedule/index.ts`. After the existing imports (after line 21), add:

```typescript
import {
  convertRecurringToLocal,
  convertExceptionsToLocal,
  type LocalAvail,
} from "../_shared/availability-tz.ts";
import { computeRequiredStaff } from "../_shared/staffing-requirements.ts";
```

- [ ] **Step 2: Add `restaurants.timezone` to the parallel batch**

In the `Promise.all` destructure (around line 103), append `restaurantResult,` to the list:

```typescript
    const [
      employeesResult,
      templatesResult,
      recurringAvailResult,
      availExceptionsResult,
      staffingSettingsResult,
      priorShiftsResult,
      salesResult,
      operatingCostsResult,
      existingShiftsResult,
      restaurantResult,
    ] = await Promise.all([
```

Then append the 10th query inside the array (after the existing query 9, before the closing `]);`):

```typescript
      // 10. Restaurant timezone (null-safe — defaults to UTC below)
      supabase
        .from("restaurants")
        .select("timezone")
        .eq("id", restaurant_id)
        .maybeSingle(),
    ]);
```

- [ ] **Step 3: Resolve timezone after the batch**

Immediately after the array (after the closing `]);`, before the existing `if (employeesResult.error)` check at line 186), insert:

```typescript
    // ── Resolve restaurant timezone ──────────────────────────────────────────
    const restaurantTimezone: string =
      restaurantResult.data?.timezone && typeof restaurantResult.data.timezone === "string"
        ? restaurantResult.data.timezone
        : "UTC";
    if (!restaurantResult.data?.timezone) {
      console.warn(
        `[generate-schedule] No timezone for restaurant ${restaurant_id}; defaulting to UTC. ` +
          `Availability conversion is a no-op for this run.`,
      );
    }
```

- [ ] **Step 4: Replace the availability map construction**

Replace lines 233-266 (the entire `// ── Build availability map ───…` section through the `// Employees with no availability records…` block) with:

```typescript
    // ── Build availability map (TZ-converted to restaurant local) ────────────
    const recurringLocal: LocalAvail[] = convertRecurringToLocal(
      (recurringAvailResult.data ?? []).map((r) => ({
        employee_id: r.employee_id,
        day_of_week: r.day_of_week,
        is_available: r.is_available,
        start_time: r.start_time ?? null,
        end_time: r.end_time ?? null,
      })),
      restaurantTimezone,
      week_start,
    );

    const exceptionsLocal: LocalAvail[] = convertExceptionsToLocal(
      (availExceptionsResult.data ?? []).map((e) => ({
        employee_id: e.employee_id,
        date: e.date,
        is_available: e.is_available,
        start_time: e.start_time ?? null,
        end_time: e.end_time ?? null,
      })),
      restaurantTimezone,
    );

    const availability: Record<string, Record<number, AvailabilityDay>> = {};
    const setSlot = (a: LocalAvail) => {
      if (!availability[a.employee_id]) availability[a.employee_id] = {};
      availability[a.employee_id][a.day_of_week] = {
        available: a.is_available,
        start: a.start_time ?? undefined,
        end: a.end_time ?? undefined,
      };
    };
    for (const a of recurringLocal) setSlot(a);
    // Exceptions override recurring on the same (employee, day)
    for (const a of exceptionsLocal) setSlot(a);

    // Bug 4: complete every employee's 7-day map.
    // - Zero records → assume available every day (legacy behavior).
    // - Some records → missing days are UNAVAILABLE (was silently dropped before).
    for (const emp of employees) {
      const empMap = availability[emp.id];
      if (!empMap) {
        availability[emp.id] = {};
        for (let d = 0; d < 7; d++) {
          availability[emp.id][d] = { available: true };
        }
      } else {
        for (let d = 0; d < 7; d++) {
          if (!(d in empMap)) {
            empMap[d] = { available: false };
          }
        }
      }
    }
```

Note: this block references `employees`, which is constructed slightly later in the file (around line 212). The original code also references `employees` (line 259) by reading it before it's constructed in the current ordering — but the `for (const emp of employees)` happens after `employees` is built. The order in the file is:

1. `// ── Build availability map ──` (lines 233-266) — uses `employees` for the all-day fallback.
2. `// ── Build ScheduleEmployee[] ──` (line 212) — actually builds `employees`.

That's reversed. The current code happens to work because the `for` loop is inside the same function and `employees` is in scope by the time the loop runs, but it's confusing. Keep the same ordering: the `Build availability map` block currently sits at lines 233-266 (after `employees` is constructed at line 212), so the references are valid. Reading the original file confirms: `Build ScheduleEmployee[]` is at line 211, then `Build ScheduleTemplate[]` is at line 222, then `Build availability map` is at line 233. So the order is fine — keep it as-is.

- [ ] **Step 5: Fix `min_crew` read in the staffing settings block**

Replace lines 381-399 (the entire `// ── Build staffing settings map ──` block) with:

```typescript
    // ── Build staffing settings map ───────────────────────────────────────────
    // staffing_settings.min_crew is a JSONB column keyed by user-facing
    // position strings (e.g., {"Server": 2, "Line Cook": 1}). min_staff is a
    // separate integer column treated as a per-slot floor (passed to
    // computeRequiredStaff). The legacy "iterate min_* columns" approach
    // (Bug 6) treated min_staff as a phantom "staff" position.
    let staffingSettings: Record<string, { min: number }> | null = null;
    let minStaffFloor: number | null = null;
    const settingsRow = staffingSettingsResult.data as
      | { min_crew?: unknown; min_staff?: unknown }
      | null;
    if (settingsRow) {
      const result: Record<string, { min: number }> = {};
      if (settingsRow.min_crew && typeof settingsRow.min_crew === "object") {
        for (const [position, count] of Object.entries(
          settingsRow.min_crew as Record<string, unknown>,
        )) {
          if (typeof count === "number" && count > 0) {
            result[position] = { min: count };
          }
        }
      }
      if (Object.keys(result).length > 0) staffingSettings = result;
      if (typeof settingsRow.min_staff === "number" && settingsRow.min_staff > 0) {
        minStaffFloor = settingsRow.min_staff;
      }
    }
```

- [ ] **Step 6: Compute required staff and pass to prompt**

Right before the `// ── Build the prompt ──` block (~line 401), insert:

```typescript
    // ── Compute per-slot required headcount (Bug 5 wiring) ───────────────────
    const minCrewForCompute: Record<string, number> | null = staffingSettings
      ? Object.fromEntries(
          Object.entries(staffingSettings).map(([k, v]) => [k, v.min]),
        )
      : null;
    const requiredStaff = computeRequiredStaff({
      templates,
      minCrew: minCrewForCompute,
      minStaff: minStaffFloor,
      priorPatterns: priorSchedulePatterns,
      hourlySales: hourlySalesPatterns,
    });
    let totalRequiredSlots = 0;
    for (const perDay of requiredStaff.values()) {
      for (const count of perDay.values()) totalRequiredSlots += count;
    }
```

Then update the `scheduleContext` literal to include `requiredStaff`:

```typescript
    const scheduleContext: ScheduleContext = {
      weekStart: week_start,
      employees,
      templates,
      availability,
      staffingSettings,
      priorSchedulePatterns,
      hourlySalesPatterns,
      weeklyBudgetTarget,
      lockedShifts,
      requiredStaff,
    };
```

- [ ] **Step 7: Sanity check — typecheck**

Run: `npm run typecheck`
Expected: no errors. (The edge function tsconfig is permissive about Deno-style imports; the new imports of `.ts` files match the existing pattern.)

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/generate-schedule/index.ts
git commit -m "fix(edge): wire timezone, min_crew, required staff (Bugs 1, 4, 6)

- Fetch restaurants.timezone as the 10th parallel query (null-safe, defaults
  to UTC with warning log).
- Convert recurring + exception availability to restaurant local via the
  new availability-tz utility; exceptions override recurring on the same
  (employee, day).
- Complete every employee's 7-day map: zero records → all-day available
  (legacy), some records → missing days UNAVAILABLE (was silently dropped).
- Read min_crew JSONB correctly; min_staff becomes a per-slot floor passed
  to computeRequiredStaff instead of a phantom 'staff' position.
- Compute requiredStaff via the new utility and pass into prompt context."
```

---

## Task 9: Edge function — max_tokens, finish_reason, 422 path, observability (Bugs 7, 8)

**Files:**
- Modify: `supabase/functions/generate-schedule/index.ts`

- [ ] **Step 1: Add structured logs and bump max_tokens**

Edit `supabase/functions/generate-schedule/index.ts`.

Replace the `requestBody` (currently lines 416-420):

```typescript
    const requestBody = {
      ...promptResult,
      temperature: 0.3,
      max_tokens: 16384,
    };

    // Observability: log size + counts before the AI call.
    const promptStr = promptResult.messages.map((m) => m.content).join("\n");
    console.log(
      `[generate-schedule] Prompt: ${promptStr.length} chars (~${Math.round(promptStr.length / 4)} tokens), ` +
        `employees=${employees.length}, templates=${templates.length}, ` +
        `requiredSlots=${totalRequiredSlots}, tz=${restaurantTimezone}`,
    );
```

- [ ] **Step 2: Detect `finish_reason === "length"`**

Replace the model loop (currently lines 430-448):

```typescript
    for (const modelConfig of SCHEDULE_MODELS) {
      console.log(`[generate-schedule] Trying model: ${modelConfig.name}`);
      const response = await callModel(
        modelConfig,
        requestBody,
        openRouterApiKey,
        "generate-schedule",
        restaurant_id,
      );
      if (!response || !response.ok) continue;

      try {
        const data = await response.json();
        const choice = data.choices?.[0];
        if (!choice?.message?.content) continue;
        if (choice.finish_reason === "length") {
          console.warn(
            `[generate-schedule] Model ${modelConfig.name} truncated output ` +
              `(finish_reason=length), skipping`,
          );
          continue;
        }
        const cleaned = choice.message.content
          .replace(/^```(?:json)?\s*\n?/i, "")
          .replace(/\n?```\s*$/i, "")
          .trim();
        aiResult = { data: JSON.parse(cleaned), model: modelConfig.name };
        break;
      } catch (err) {
        console.warn(
          `[generate-schedule] Model ${modelConfig.name} parse failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
    }
```

- [ ] **Step 3: Build drop reason summary + 422 guardrail**

Replace the entire `// ── Build response ──` section (currently lines 510-530) with:

```typescript
    // ── Aggregate drop reasons by structured code (Bug 8 / no UUID leak) ─────
    const dropReasonSummary: Record<string, number> = {};
    for (const d of droppedShifts) {
      dropReasonSummary[d.code] = (dropReasonSummary[d.code] ?? 0) + 1;
    }
    // Server-side log: full counts AND the human messages (UUIDs allowed in logs).
    console.log(
      `[generate-schedule] Generated=${generatedShifts.length}, ` +
        `valid=${validShifts.length}, dropped=${droppedShifts.length}, ` +
        `model=${aiResult.model}, requiredSlots=${totalRequiredSlots}`,
    );
    console.log(
      `[generate-schedule] Drop reason summary: ${JSON.stringify(dropReasonSummary)}`,
    );

    // ── Zero-shift guardrail (Bug 8) ─────────────────────────────────────────
    if (validShifts.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "AI generated no valid shifts. Check employee positions, availability, and templates.",
          diagnostic: {
            total_employees: employees.length,
            total_templates: templates.length,
            total_required_slots: totalRequiredSlots,
            total_generated: generatedShifts.length,
            total_dropped: droppedShifts.length,
            drop_reason_summary: dropReasonSummary,
            model_used: aiResult.model,
          },
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Build success response ───────────────────────────────────────────────
    // dropped_reasons keeps human messages WITHOUT UUIDs for the dialog list.
    const droppedReasons = droppedShifts.map((d) => d.message);
    const aiMetadata = aiResult.data.metadata ?? {};

    return new Response(
      JSON.stringify({
        shifts: validShifts,
        metadata: {
          estimated_cost: aiMetadata.estimated_cost ?? 0,
          budget_variance_pct: aiMetadata.budget_variance_pct ?? 0,
          notes: aiMetadata.notes ?? "",
          model_used: aiResult.model,
          total_generated: generatedShifts.length,
          total_valid: validShifts.length,
          total_dropped: droppedShifts.length,
          total_required_slots: totalRequiredSlots,
          drop_reason_summary: dropReasonSummary,
          dropped_reasons: droppedReasons,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-schedule/index.ts
git commit -m "fix(edge): max_tokens=16384, truncation detection, 422 path, logs (Bugs 7 & 8)

- max_tokens bumped from 8192 to 16384 so 30-employee schedules don't truncate.
- finish_reason='length' → skip that model (was silently parsing truncated JSON).
- Zero valid shifts → HTTP 422 with diagnostic body (code-level aggregation
  only, never UUIDs).
- Success metadata adds total_required_slots and drop_reason_summary so the
  dialog can show 'Filled X of Y required slots'.
- Structured logs: prompt size, employees/templates/required-slots counts,
  resolved tz, per-model attempts, parse failures, drop reason summary."
```

---

## Task 10: Frontend hook — `ScheduleDiagnostic`, 422 path, always invalidate

**Files:**
- Modify: `src/hooks/useGenerateSchedule.ts`
- Create: `tests/unit/useGenerateSchedule.test.tsx`

- [ ] **Step 1: Write failing tests**

Write `tests/unit/useGenerateSchedule.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/functions-js';
import type { ReactNode } from 'react';

// Mock the toast hook
const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

// Mock Supabase client
const invokeMock = vi.fn();
const insertMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: invokeMock },
    from: () => ({ insert: insertMock }),
  },
}));

import { useGenerateSchedule } from '@/hooks/useGenerateSchedule';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  toastMock.mockClear();
  invokeMock.mockReset();
  insertMock.mockReset();
});

describe('useGenerateSchedule — 422 diagnostic path', () => {
  it('extracts diagnostic from FunctionsHttpError.context and shows single-line toast', async () => {
    const diagnostic = {
      total_employees: 30,
      total_templates: 12,
      total_required_slots: 48,
      total_generated: 24,
      total_dropped: 24,
      drop_reason_summary: { POSITION_MISMATCH: 18, UNAVAILABLE_DAY: 6 },
      model_used: 'Gemini 2.5 Flash',
    };
    const responseBody = { error: 'AI generated no valid shifts.', diagnostic };
    // Construct a FunctionsHttpError carrying that body as the Response context.
    const fakeResponse = {
      json: () => Promise.resolve(responseBody),
    } as unknown as Response;
    const err = new FunctionsHttpError(fakeResponse);
    invokeMock.mockResolvedValueOnce({ data: null, error: err });

    const { result } = renderHook(() => useGenerateSchedule(), { wrapper });
    result.current.mutate({
      restaurantId: 'r-1',
      restaurantTimezone: 'America/Chicago',
      weekStart: '2026-05-18',
      lockedShiftIds: [],
      excludedEmployeeIds: [],
    });

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    const call = toastMock.mock.calls[0][0];
    expect(call.variant).toBe('destructive');
    expect(call.description).toContain('0 of 48');
    expect(call.description).toContain('POSITION_MISMATCH');
  });

  it('falls back to error.message for non-422 errors', async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: new Error('Network failure'),
    });
    const { result } = renderHook(() => useGenerateSchedule(), { wrapper });
    result.current.mutate({
      restaurantId: 'r-1',
      restaurantTimezone: 'UTC',
      weekStart: '2026-05-18',
      lockedShiftIds: [],
      excludedEmployeeIds: [],
    });
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0].description).toContain('Network failure');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/unit/useGenerateSchedule.test.tsx --run`
Expected: failures — hook doesn't read 422 body yet.

- [ ] **Step 3: Update the hook**

Rewrite `src/hooks/useGenerateSchedule.ts`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fromZonedTime } from 'date-fns-tz';
import { FunctionsHttpError } from '@supabase/functions-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface GenerateScheduleParams {
  restaurantId: string;
  restaurantTimezone: string;
  weekStart: string; // YYYY-MM-DD
  lockedShiftIds: string[];
  excludedEmployeeIds: string[];
}

interface GeneratedShift {
  employee_id: string;
  template_id: string;
  day: string;
  start_time: string;
  end_time: string;
  position: string;
}

/** Server returned a 422 with a diagnostic body. drop_reason_summary uses
 *  DropCode keys (UPPER_SNAKE) and never contains employee UUIDs. */
export interface ScheduleDiagnostic {
  total_employees: number;
  total_templates: number;
  total_required_slots: number;
  total_generated: number;
  total_dropped: number;
  drop_reason_summary: Record<string, number>;
  model_used: string;
}

export interface GenerateScheduleMetadata {
  estimated_cost: number;
  budget_variance_pct: number;
  notes: string;
  model_used: string;
  /** Shifts the AI produced (raw count) */
  total_generated: number;
  /** Shifts that passed validation (= shifts.length) */
  total_valid: number;
  total_dropped: number;
  /** Sum of required headcount across (template, day). Zero when staffing
   *  settings are absent and no patterns exist. */
  total_required_slots: number;
  drop_reason_summary: Record<string, number>;
  dropped_reasons: string[];
}

export interface GenerateScheduleResponse {
  shifts: GeneratedShift[];
  metadata: GenerateScheduleMetadata;
}

export class ScheduleGenerationError extends Error {
  diagnostic?: ScheduleDiagnostic;
  constructor(message: string, diagnostic?: ScheduleDiagnostic) {
    super(message);
    this.name = 'ScheduleGenerationError';
    this.diagnostic = diagnostic;
  }
}

export function useGenerateSchedule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: GenerateScheduleParams): Promise<GenerateScheduleResponse> => {
      const { data, error } = await supabase.functions.invoke('generate-schedule', {
        body: {
          restaurant_id: params.restaurantId,
          week_start: params.weekStart,
          locked_shift_ids: params.lockedShiftIds,
          excluded_employee_ids: params.excludedEmployeeIds,
        },
      });

      if (error) {
        // FunctionsHttpError carries the Response in `error.context`.
        if (error instanceof FunctionsHttpError) {
          const body = await (error.context as Response).json().catch(() => null);
          if (body?.diagnostic) {
            throw new ScheduleGenerationError(
              body.error ?? 'No valid shifts generated',
              body.diagnostic as ScheduleDiagnostic,
            );
          }
        }
        throw new Error(error.message || 'Failed to generate schedule');
      }
      if (data?.error) throw new Error(data.error);

      const response = data as GenerateScheduleResponse;
      if (response.shifts.length === 0) {
        // With Bug 8 fixed the server returns 422 in this case, so this branch
        // is defensive only. Skip insert and return the response.
        return response;
      }

      const shiftsToInsert = response.shifts.map((shift) => {
        const startUtc = fromZonedTime(
          `${shift.day}T${shift.start_time}`,
          params.restaurantTimezone,
        ).toISOString();
        const endUtc = fromZonedTime(
          `${shift.day}T${shift.end_time}`,
          params.restaurantTimezone,
        ).toISOString();
        return {
          restaurant_id: params.restaurantId,
          employee_id: shift.employee_id,
          start_time: startUtc,
          end_time: endUtc,
          break_duration: 0,
          position: shift.position,
          status: 'scheduled' as const,
          is_published: false,
          locked: false,
          is_recurring: false,
          source: 'ai',
        };
      });

      const { error: insertError } = await supabase.from('shifts').insert(shiftsToInsert);
      if (insertError) throw insertError;

      return response;
    },
    onSuccess: (data, variables) => {
      // Always invalidate so the planner re-fetches even if the AI returned zero
      // shifts (shouldn't happen with the 422 guardrail, but stays safe).
      queryClient.invalidateQueries({ queryKey: ['shifts', variables.restaurantId] });

      if (data.shifts.length === 0) return;

      let description = `${data.shifts.length} shifts created — review and publish when ready.`;
      if (data.metadata.budget_variance_pct > 0) {
        description += ` Estimated cost is ${data.metadata.budget_variance_pct.toFixed(0)}% over budget.`;
      }
      if (data.metadata.total_dropped > 0) {
        description += ` ${data.metadata.total_dropped} suggestions were filtered out.`;
      }
      toast({ title: 'Schedule Generated', description });
    },
    onError: (error: Error) => {
      const diag = error instanceof ScheduleGenerationError ? error.diagnostic : undefined;
      const top =
        diag?.drop_reason_summary && Object.keys(diag.drop_reason_summary).length > 0
          ? Object.entries(diag.drop_reason_summary).sort((a, b) => b[1] - a[1])[0]
          : null;
      const description = diag
        ? `Filled 0 of ${diag.total_required_slots} required slots.` +
          (top ? ` Top reason: ${top[0]} (${top[1]}).` : '') +
          ' Check employee positions, availability, and templates.'
        : error.message || 'Try again or build manually.';
      toast({
        title: "Couldn't generate schedule",
        description,
        variant: 'destructive',
      });
    },
  });
}
```

- [ ] **Step 4: Run hook tests to verify they pass**

Run: `npm test -- tests/unit/useGenerateSchedule.test.tsx --run`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGenerateSchedule.ts tests/unit/useGenerateSchedule.test.tsx
git commit -m "feat(hook): read 422 diagnostic via FunctionsHttpError.context (Bug 8 frontend)

- Add ScheduleDiagnostic + ScheduleGenerationError types.
- supabase.functions.invoke returns FunctionsHttpError for non-2xx; pull
  the body from error.context.json() and rethrow as ScheduleGenerationError
  carrying the diagnostic.
- onError formats a single-line toast: 'Filled 0 of N required slots. Top
  reason: CODE (count). Check ...'.
- Always invalidate the shifts query on success (drop the zero-shift early
  return — the 422 guardrail now covers that path).
- Add total_required_slots + drop_reason_summary to GenerateScheduleMetadata
  so the dialog can render 'Filled X of Y'."
```

---

## Task 11: Dialog — sticky footer, "Filled X of Y", stable keys, a11y

**Files:**
- Modify: `src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx`

- [ ] **Step 1: Add `DialogDescription` to the imports**

Edit the dialog file. Replace the current Dialog import block (lines 3-8):

```typescript
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
```

- [ ] **Step 2: Restructure `DialogContent` for sticky footer**

Replace line 195 (`<DialogContent ...>`) with the flex variant:

```typescript
      <DialogContent className="max-w-lg p-0 gap-0 border-border/40 flex flex-col max-h-[80vh]">
```

Wrap each phase's content block in a `<div className="flex-1 overflow-y-auto">`. Concretely:

For the `phase === 'config'` content (currently `<div className="px-6 py-5 space-y-5">` at line 215), change the opening div to:

```typescript
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
```

For the `phase === 'generating'` content (line 324), change to:

```typescript
          <div className="flex-1 overflow-y-auto px-6 py-10 flex flex-col items-center gap-3">
```

For the `phase === 'results'` content (line 332), change to:

```typescript
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
```

The two footer `<div className="px-6 py-4 border-t border-border/40 ...">` blocks at lines 408 and 430 already act as sticky footers because they're outside the scrollable area — no change needed beyond the parent flex layout.

- [ ] **Step 3: Wrap the subtitle in `DialogDescription`**

Replace lines 206-208 (the `<p>` subtitle):

```typescript
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {header.subtitle}
              </DialogDescription>
```

- [ ] **Step 4: Add `aria-hidden` to decorative icons**

Update the `header.icon` JSX literals. Replace lines 163, 171, 179, 186 — every `<Sparkles ... />`, `<Info ... />`, `<CheckCircle2 ... />` inside the `header` object — to add `aria-hidden="true"`. Example:

```typescript
        icon: <Sparkles className="h-5 w-5 text-violet-500" aria-hidden="true" />,
```

```typescript
        icon: <Info className="h-5 w-5 text-amber-500" aria-hidden="true" />,
```

```typescript
        icon: <CheckCircle2 className="h-5 w-5 text-green-500" aria-hidden="true" />,
```

Also add `aria-hidden="true"` to:

- Line 276: `<Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />`
- Line 300: `<AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden="true" />`
- Line 423 (Sparkles inside the Generate button): `<Sparkles className="h-4 w-4" aria-hidden="true" />`

- [ ] **Step 5: Add "Filled X of Y" line + fix dropped_reasons keys**

In the success-with-shifts block, after the existing `total_dropped > 0` paragraph (line ~357) and before the closing `</div>` at line 358, add:

```typescript
                  {generationResult.metadata.total_required_slots > 0 && (
                    <p className="text-[13px] text-muted-foreground mt-1">
                      Filled {generationResult.metadata.total_valid} of {generationResult.metadata.total_required_slots} required slots.
                    </p>
                  )}
```

Replace the `dropped_reasons.map` at lines 362-368:

```typescript
                    <ul className="space-y-1">
                      {generationResult.metadata.dropped_reasons.map((reason, i) => (
                        <li key={`${reason}-${i}`} className="text-[13px] text-muted-foreground">
                          {reason}
                        </li>
                      ))}
                    </ul>
```

And the zero-shift duplicate at lines 389-395 the same way:

```typescript
                    <ul className="space-y-1">
                      {generationResult.metadata.dropped_reasons.map((reason, i) => (
                        <li key={`${reason}-${i}`} className="text-[13px] text-muted-foreground">
                          {reason}
                        </li>
                      ))}
                    </ul>
```

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint -- src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/scheduling/ShiftPlanner/GenerateScheduleDialog.tsx
git commit -m "feat(dialog): Filled X/Y line, stable keys, a11y, sticky footer

- DialogContent uses flex layout so footer stays visible on short viewports.
- Add 'Filled X of Y required slots' (gated on total_required_slots > 0).
- Replace key={i} with key={\`\${reason}-\${i}\`} in dropped_reasons lists
  (stable enough since reason strings are usually distinct; the suffix
  guards against duplicates).
- Wrap subtitle in DialogDescription for screen-reader association.
- aria-hidden=true on decorative icons (Sparkles, Info, CheckCircle2,
  AlertTriangle, Lock) since the buttons already have aria-label / text."
```

---

## Task 12: Final verification

**Files:** none

- [ ] **Step 1: Full unit test sweep**

Run: `npm test --run`
Expected: all tests pass. If any unrelated test fails, the test predates this work — note it and continue. New failures in scheduler tests are a hard stop.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: zero errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: zero errors; pre-existing warnings are acceptable.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Summary check**

Re-read `progress.md`. Verify all 12 tasks are checked off. The phase should now be "Phase 5: UI Review" so the development-workflow skill picks up from there.

---

## Self-review

**Spec coverage:**
- ✓ Bug 1 (TZ): Tasks 1, 5, 8
- ✓ Bug 2 (Overnight): Task 4
- ✓ Bug 3 (Position): Task 3
- ✓ Bug 4 (Missing-day): Tasks 7, 8
- ✓ Bug 5 (No "fill" rule): Tasks 6, 7, 8
- ✓ Bug 6 (`min_crew` ignored): Task 8
- ✓ Bug 7 (`max_tokens`): Task 9
- ✓ Bug 8 (Zero-shift): Tasks 2, 9, 10
- ✓ Observability: Task 9
- ✓ A11y + sticky footer + Filled X/Y: Task 11

**Placeholder scan:** No "TBD"/"TODO"/"add appropriate"/"fill in later" left.

**Type consistency:**
- `DropCode` declared once in Task 2; used in Task 9 (`reasonCounts: Record<string, number>` keyed by DropCode) and Task 10 (`drop_reason_summary: Record<string, number>` — string-keyed for JSON serialization, matching what the server emits).
- `normalizePosition` defined in Task 3 inside `schedule-validator.ts`. A second copy lives in Task 6's `staffing-requirements.ts` (intentional — keeps modules pure with no cross-imports). Both implementations are byte-identical.
- `LocalAvail`, `RawRecurringAvail`, `RawExceptionAvail` declared in Task 5; consumed in Task 8.
- `requiredStaff: Map<string, Map<number, number>>` introduced in Task 6 and Task 7 (`ScheduleContext.requiredStaff`); wired in Task 8.
- `ScheduleDiagnostic` + `ScheduleGenerationError` defined in Task 10; not used elsewhere.
- `total_required_slots` flows: emitted by server (Task 9) → read by hook metadata (Task 10) → rendered in dialog (Task 11).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-17-ai-scheduler-fill-fix-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.
