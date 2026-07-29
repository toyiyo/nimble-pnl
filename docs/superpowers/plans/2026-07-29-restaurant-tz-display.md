# Restaurant Timezone Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the restaurant's timezone the default frame for every user-visible date and time, and fix the four sites where the viewer's browser timezone currently corrupts data or misattributes cost.

**Architecture:** A pure `src/lib/restaurantClock.ts` owns all instant↔timezone conversion. A `useRestaurantClock()` hook binds it to the selected restaurant. An ESLint rule bans the browser-local formatting calls in files that touch instant columns, with a shrinking allowlist that doubles as the migration tracker. The four defect sites are converted to the new helpers; `laborCalculations` and `payrollCalculations` must change in the same commit because they document a mutual consistency requirement.

**Tech Stack:** React 18.3 + TypeScript + Vite, date-fns 3.6 / date-fns-tz 3.2, Vitest 4, pgTAP, ESLint 9 flat config.

**Spec:** `docs/superpowers/specs/2026-07-28-restaurant-tz-display-design.md` at commit `e0d8c3f5`.
**Branch:** `fix/restaurant-tz-display` — **Worktree:** `.claude/worktrees/restaurant-tz-display`

## Global Constraints

- **Never throw in a production build.** `import.meta.env.DEV` and Vitest (`MODE === 'test'`) throw on wrong-shaped input; production logs and renders via the shape-inferred branch. This app has **no error boundary anywhere** (verified: 0 matches for `componentDidCatch|getDerivedStateFromError|ErrorBoundary` in `src`), so an uncaught render throw blanks the whole route.
- **`DEFAULT_TIMEZONE = 'America/Chicago'`** — matches the DB default from migration `20251001022351`. This is the single fallback; do not introduce another.
- **SQL is authoritative.** Where client bucketing mirrors `(instant AT TIME ZONE tz)::date`, SQL wins and the TS is the bug (CLAUDE.md).
- **Calendar day vs. instant.** A `date` column takes local-field serialization (`toDateOnlyString`); a `timestamptz` takes `toBusinessDay(value, tz)`. Never `toISOString().split('T')[0]`.
- **Do not touch** `employee_availability` (dual-convention hazard, `memory/lessons.md:1186`) or `src/hooks/useLaborCostsFromTimeTracking.tsx:112-113` (correct as-is).
- **Semantic tokens only** — no `bg-white`/`text-black`. Typography per CLAUDE.md scale.
- Run `TZ=UTC npm run test` before every push — it reproduces CI (`memory/lessons.md:273`).

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/restaurantClock.ts` (new) | Pure conversion + guards. No React, no context. |
| `src/hooks/useRestaurantClock.ts` (new) | Binds the pure module to the selected restaurant. |
| `src/components/RestaurantTzNotice.tsx` (new) | Offset-mismatch cue. |
| `tests/fixtures/businessDayFixtures.ts` (new) | Shared `(instant, tz, expectedDay)` table, consumed by Vitest and pgTAP. |
| `supabase/tests/business_day_parity.sql` (new) | pgTAP half of the parity check. |
| `src/pages/TimePunchesManager.tsx` | Defect 1 — punch-edit round-trip corruption. |
| `src/services/laborCalculations.ts` | Defect 2 — labor day bucketing. |
| `src/utils/payrollCalculations.ts` | Defect 3 — payroll day bucketing (same commit as defect 2). |
| `src/pages/EmployeeTimecard.tsx` | Defect 4 — timecard day bucketing. |
| `eslint.config.js` | Guardrail + allowlist. |

---

### Task 1: The pure clock module

**Files:**
- Create: `src/lib/restaurantClock.ts`
- Test: `tests/unit/restaurantClock.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  ```ts
  export const DEFAULT_TIMEZONE: 'America/Chicago'
  export function safeTz(tz: string | null | undefined): string
  export function tzOffsetMinutes(tz: string, at?: Date): number
  export function tzAbbrev(tz: string, at?: Date): string
  export function formatInstant(value: string | Date, tz: string, pattern: string): string
  export function toBusinessDay(value: string | Date, tz: string): string
  export function toWallClockInput(value: string | Date, tz: string): string
  export function parseWallClock(wallClock: string, tz: string): string
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/restaurantClock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TIMEZONE,
  formatInstant,
  parseWallClock,
  safeTz,
  toBusinessDay,
  toWallClockInput,
  tzAbbrev,
  tzOffsetMinutes,
} from '@/lib/restaurantClock';

const CHI = 'America/Chicago';

describe('safeTz', () => {
  it('returns a valid IANA zone unchanged', () => {
    expect(safeTz(CHI)).toBe(CHI);
  });

  it('falls back on null, empty, and invalid zones', () => {
    expect(safeTz(null)).toBe(DEFAULT_TIMEZONE);
    expect(safeTz(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(safeTz('')).toBe(DEFAULT_TIMEZONE);
    expect(safeTz('Not/AZone')).toBe(DEFAULT_TIMEZONE);
  });
});

describe('toBusinessDay', () => {
  it('buckets an instant by the restaurant day, not the host day', () => {
    // 2026-07-23T01:56:20Z is Jul 22 20:56 in Chicago.
    expect(toBusinessDay('2026-07-23T01:56:20Z', CHI)).toBe('2026-07-22');
  });

  it('handles a zone ahead of UTC', () => {
    expect(toBusinessDay('2026-07-22T13:00:00Z', 'Pacific/Auckland')).toBe('2026-07-23');
  });

  it('is DST-aware at the spring-forward boundary', () => {
    // 07:30Z on 2026-03-08 is 01:30 CST; 08:30Z is 03:30 CDT. Same day.
    expect(toBusinessDay('2026-03-08T07:30:00Z', CHI)).toBe('2026-03-08');
    expect(toBusinessDay('2026-03-08T08:30:00Z', CHI)).toBe('2026-03-08');
  });
});

describe('formatInstant', () => {
  it('renders in the restaurant zone', () => {
    expect(formatInstant('2026-07-23T01:56:20Z', CHI, 'yyyy-MM-dd HH:mm')).toBe('2026-07-22 20:56');
  });
});

describe('wall-clock round trip', () => {
  it('survives a load/save cycle unchanged', () => {
    const original = '2026-07-23T01:56:20.000Z';
    const shown = toWallClockInput(original, CHI);
    expect(shown).toBe('2026-07-22T20:56');
    // Seconds are not editable in a datetime-local field, so compare to the minute.
    expect(parseWallClock(shown, CHI)).toBe('2026-07-23T01:56:00.000Z');
  });
});

describe('shape guards', () => {
  it('formatInstant rejects a calendar day', () => {
    expect(() => formatInstant('2026-07-28', CHI, 'HH:mm')).toThrow(/calendar day/i);
  });

  it('toBusinessDay rejects a calendar day', () => {
    expect(() => toBusinessDay('2026-07-28', CHI)).toThrow(/calendar day/i);
  });

  it('parseWallClock rejects an instant', () => {
    expect(() => parseWallClock('2026-07-28T18:00:00Z', CHI)).toThrow(/wall clock/i);
  });
});

describe('offset and abbreviation', () => {
  it('reports the CDT offset in July', () => {
    expect(tzOffsetMinutes(CHI, new Date('2026-07-15T12:00:00Z'))).toBe(-300);
  });

  it('reports the CST offset in January', () => {
    expect(tzOffsetMinutes(CHI, new Date('2026-01-15T12:00:00Z'))).toBe(-360);
  });

  it('names the zone', () => {
    expect(tzAbbrev(CHI, new Date('2026-07-15T12:00:00Z'))).toBe('CDT');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .claude/worktrees/restaurant-tz-display && npx vitest run tests/unit/restaurantClock.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/restaurantClock"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/restaurantClock.ts`:

```ts
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/**
 * The restaurant timezone is the default frame for every user-visible date.
 *
 * A `Date` is either a *day on a calendar* or a *moment in time*, and the two
 * serialize differently. This module owns the moment-in-time half; the
 * calendar-day half lives in `src/lib/dateOnly.ts`. Each rejects the other's
 * input rather than silently producing a plausible wrong answer.
 */

/** Matches the `restaurants.timezone` DB default (migration 20251001022351). */
export const DEFAULT_TIMEZONE = 'America/Chicago';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WALL_CLOCK_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/**
 * Throw where a loud failure is useful (dev, Vitest), log where it would be an
 * outage (production). This app has NO error boundary, so an uncaught throw in
 * render blanks the entire route — strictly worse than the wrong date.
 */
function reject(fn: string, reason: string, value: unknown): void {
  const message = `restaurantClock.${fn}: ${reason} (received ${JSON.stringify(value)})`;
  const env = import.meta.env;
  if (env?.DEV || env?.MODE === 'test') {
    throw new TypeError(message);
  }
  console.error(`[restaurantClock] ${message}`);
}

/**
 * Validate an IANA zone, falling back to the restaurant default.
 *
 * Ported from `supabase/functions/_shared/timezone.ts:25`. An invalid or empty
 * string makes `Intl.DateTimeFormat` throw `RangeError` synchronously, which
 * once crashed an entire edge-function email send (memory/lessons.md:807).
 */
export function safeTz(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/** Coerce an instant, complaining if it looks like a calendar day. */
function asInstant(value: string | Date, fn: string): Date {
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) {
    reject(fn, 'received a calendar day where a moment in time was expected', value);
    // Production fallback: read it as the calendar day it plainly is.
    return new Date(`${value}T00:00:00Z`);
  }
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) {
    reject(fn, 'received an unparseable value', value);
    return new Date(0);
  }
  return d;
}

/** Minutes east of UTC for `tz` at `at`. America/Chicago in CDT is -300. */
export function tzOffsetMinutes(tz: string, at: Date = new Date()): number {
  const zone = safeTz(tz);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  }).formatToParts(at);
  const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  // "GMT-05:00", or bare "GMT" at exactly UTC.
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(raw);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** Short zone name for display, e.g. "CDT". */
export function tzAbbrev(tz: string, at: Date = new Date()): string {
  return formatInTimeZone(at, safeTz(tz), 'zzz');
}

/** Format a moment in time in the restaurant's zone. */
export function formatInstant(value: string | Date, tz: string, pattern: string): string {
  return formatInTimeZone(asInstant(value, 'formatInstant'), safeTz(tz), pattern);
}

/** The restaurant-local calendar day an instant belongs to. */
export function toBusinessDay(value: string | Date, tz: string): string {
  return formatInTimeZone(asInstant(value, 'toBusinessDay'), safeTz(tz), 'yyyy-MM-dd');
}

/** Render an instant for a `<input type="datetime-local">` in the restaurant's zone. */
export function toWallClockInput(value: string | Date, tz: string): string {
  return formatInTimeZone(asInstant(value, 'toWallClockInput'), safeTz(tz), "yyyy-MM-dd'T'HH:mm");
}

/**
 * Interpret a naive wall-clock string as restaurant-local and return the UTC
 * instant. The inverse of `toWallClockInput`.
 */
export function parseWallClock(wallClock: string, tz: string): string {
  if (!WALL_CLOCK_RE.test(wallClock)) {
    reject('parseWallClock', 'expected a naive wall clock (YYYY-MM-DDTHH:mm)', wallClock);
    const fallback = new Date(wallClock);
    return Number.isNaN(fallback.getTime()) ? new Date(0).toISOString() : fallback.toISOString();
  }
  return fromZonedTime(wallClock, safeTz(tz)).toISOString();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/restaurantClock.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Verify the guards throw under Vitest but not in a prod build**

```bash
npx vitest run tests/unit/restaurantClock.test.ts -t "shape guards"
```

Expected: PASS — confirms `MODE === 'test'` takes the throwing branch.

- [ ] **Step 6: Commit**

```bash
git add src/lib/restaurantClock.ts tests/unit/restaurantClock.test.ts
git commit -m "feat(clock): pure restaurant-timezone conversion module with shape guards"
```

---

### Task 2: SQL parity for `toBusinessDay`

CLAUDE.md makes SQL authoritative, and 46 migrations already bucket as `(instant AT TIME ZONE tz)::date`. Nothing currently pins the TS to it. `memory/lessons.md:1297` is the record of a client bucketing helper silently drifting.

**Files:**
- Create: `tests/fixtures/businessDayFixtures.ts`
- Create: `supabase/tests/business_day_parity.sql`
- Create: `tests/unit/businessDayParity.test.ts`

**Interfaces:**
- Consumes: `toBusinessDay` from Task 1.
- Produces: `BUSINESS_DAY_FIXTURES: ReadonlyArray<{ instant: string; tz: string; expectedDay: string }>`

- [ ] **Step 1: Write the shared fixture table**

Create `tests/fixtures/businessDayFixtures.ts`:

```ts
/**
 * Instants whose restaurant-local day is NOT the same as their UTC day, plus
 * DST boundaries. Consumed twice — by Vitest against `toBusinessDay` and by
 * pgTAP against `(instant AT TIME ZONE tz)::date` — so the client helper and
 * the authoritative SQL cannot drift apart unnoticed.
 *
 * Keep this in sync with `supabase/tests/business_day_parity.sql`;
 * `tests/unit/businessDayParity.test.ts` fails if they diverge.
 */
export const BUSINESS_DAY_FIXTURES = [
  // The real incident from memory/lessons.md:1403 — Jul 22 20:56 in Chicago.
  { instant: '2026-07-23T01:56:20Z', tz: 'America/Chicago', expectedDay: '2026-07-22' },
  // Zone behind UTC, late evening local.
  { instant: '2026-07-23T04:59:00Z', tz: 'America/Chicago', expectedDay: '2026-07-22' },
  // Same instant, one minute later, crosses local midnight.
  { instant: '2026-07-23T05:00:00Z', tz: 'America/Chicago', expectedDay: '2026-07-23' },
  // Zone ahead of UTC.
  { instant: '2026-07-22T13:00:00Z', tz: 'Pacific/Auckland', expectedDay: '2026-07-23' },
  // Spring forward: 01:30 CST and 03:30 CDT, same local day.
  { instant: '2026-03-08T07:30:00Z', tz: 'America/Chicago', expectedDay: '2026-03-08' },
  { instant: '2026-03-08T08:30:00Z', tz: 'America/Chicago', expectedDay: '2026-03-08' },
  // Fall back: the repeated 01:30 local hour.
  { instant: '2026-11-01T06:30:00Z', tz: 'America/Chicago', expectedDay: '2026-11-01' },
  { instant: '2026-11-01T07:30:00Z', tz: 'America/Chicago', expectedDay: '2026-11-01' },
  // Pre-06:00 local, the first place a wrong implementation diverges.
  { instant: '2026-07-22T10:00:00Z', tz: 'America/Chicago', expectedDay: '2026-07-22' },
  // A zone with a non-hour offset.
  { instant: '2026-07-22T18:45:00Z', tz: 'Asia/Kolkata', expectedDay: '2026-07-23' },
] as const;
```

- [ ] **Step 2: Write the pgTAP half**

Create `supabase/tests/business_day_parity.sql`:

```sql
-- Asserts Postgres agrees with src/lib/restaurantClock.ts::toBusinessDay.
-- Rows MUST match tests/fixtures/businessDayFixtures.ts exactly;
-- tests/unit/businessDayParity.test.ts enforces that.
BEGIN;
SELECT plan(10);

SELECT is(
  (v.instant::timestamptz AT TIME ZONE v.tz)::date::text,
  v.expected_day,
  format('%s in %s is %s', v.instant, v.tz, v.expected_day)
)
FROM (VALUES
  ('2026-07-23T01:56:20Z', 'America/Chicago',  '2026-07-22'),
  ('2026-07-23T04:59:00Z', 'America/Chicago',  '2026-07-22'),
  ('2026-07-23T05:00:00Z', 'America/Chicago',  '2026-07-23'),
  ('2026-07-22T13:00:00Z', 'Pacific/Auckland', '2026-07-23'),
  ('2026-03-08T07:30:00Z', 'America/Chicago',  '2026-03-08'),
  ('2026-03-08T08:30:00Z', 'America/Chicago',  '2026-03-08'),
  ('2026-11-01T06:30:00Z', 'America/Chicago',  '2026-11-01'),
  ('2026-11-01T07:30:00Z', 'America/Chicago',  '2026-11-01'),
  ('2026-07-22T10:00:00Z', 'America/Chicago',  '2026-07-22'),
  ('2026-07-22T18:45:00Z', 'Asia/Kolkata',     '2026-07-23')
) AS v(instant, tz, expected_day);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Write the drift guard + TS parity test**

Create `tests/unit/businessDayParity.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { toBusinessDay } from '@/lib/restaurantClock';
import { BUSINESS_DAY_FIXTURES } from '../fixtures/businessDayFixtures';

describe('toBusinessDay matches the fixture table', () => {
  it.each(BUSINESS_DAY_FIXTURES)('$instant in $tz is $expectedDay', ({ instant, tz, expectedDay }) => {
    expect(toBusinessDay(instant, tz)).toBe(expectedDay);
  });
});

describe('the pgTAP file has not drifted from the fixtures', () => {
  it('contains one VALUES row per fixture, in order', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../supabase/tests/business_day_parity.sql'),
      'utf8',
    );

    const rows = [...sql.matchAll(/\('([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)].map((m) => ({
      instant: m[1],
      tz: m[2],
      expectedDay: m[3],
    }));

    expect(rows).toEqual(BUSINESS_DAY_FIXTURES.map(({ instant, tz, expectedDay }) => ({
      instant,
      tz,
      expectedDay,
    })));
  });

  it('declares a plan matching the fixture count', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../supabase/tests/business_day_parity.sql'),
      'utf8',
    );
    expect(sql).toContain(`SELECT plan(${BUSINESS_DAY_FIXTURES.length});`);
  });
});
```

- [ ] **Step 4: Run the TS side**

```bash
npx vitest run tests/unit/businessDayParity.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Run the SQL side**

```bash
npm run test:db
```

Expected: `business_day_parity.sql` reports `ok 1..10`. If any row disagrees, **SQL is right and `toBusinessDay` is the bug** — fix the TS, not the fixture.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/businessDayFixtures.ts supabase/tests/business_day_parity.sql tests/unit/businessDayParity.test.ts
git commit -m "test(clock): pin toBusinessDay against Postgres AT TIME ZONE bucketing"
```

---

### Task 3: The `useRestaurantClock` hook

**Files:**
- Create: `src/hooks/useRestaurantClock.ts`
- Test: `tests/unit/useRestaurantClock.test.tsx`

**Interfaces:**
- Consumes: everything from Task 1; `useRestaurantContext`; `useTodayInTimezone` (`src/hooks/useTodayInTimezone.ts:17`).
- Produces:
  ```ts
  export interface RestaurantClock {
    tz: string;
    tzAbbrev: string;
    viewerTzDiffers: boolean;
    today: string;
    formatInstant: (value: string | Date, pattern: string) => string;
    toBusinessDay: (value: string | Date) => string;
    toWallClockInput: (value: string | Date) => string;
    parseWallClock: (wallClock: string) => string;
  }
  export function useRestaurantClock(): RestaurantClock
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useRestaurantClock.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { useRestaurantClock } from '@/hooks/useRestaurantClock';

const mockContext = vi.fn();
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => mockContext(),
}));

describe('useRestaurantClock', () => {
  beforeEach(() => {
    mockContext.mockReturnValue({
      selectedRestaurant: { restaurant: { timezone: 'America/Chicago' } },
    });
  });

  it('binds the restaurant timezone', () => {
    const { result } = renderHook(() => useRestaurantClock());
    expect(result.current.tz).toBe('America/Chicago');
    expect(result.current.toBusinessDay('2026-07-23T01:56:20Z')).toBe('2026-07-22');
  });

  it('falls back when the restaurant has no timezone', () => {
    mockContext.mockReturnValue({ selectedRestaurant: { restaurant: {} } });
    const { result } = renderHook(() => useRestaurantClock());
    expect(result.current.tz).toBe('America/Chicago');
  });

  it('falls back when no restaurant is selected', () => {
    mockContext.mockReturnValue({ selectedRestaurant: null });
    const { result } = renderHook(() => useRestaurantClock());
    expect(result.current.tz).toBe('America/Chicago');
  });

  it('keeps a stable object identity across re-renders', () => {
    const { result, rerender } = renderHook(() => useRestaurantClock());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('produces a new identity when the restaurant changes', () => {
    const { result, rerender } = renderHook(() => useRestaurantClock());
    const first = result.current;
    mockContext.mockReturnValue({
      selectedRestaurant: { restaurant: { timezone: 'Pacific/Auckland' } },
    });
    rerender();
    expect(result.current).not.toBe(first);
    expect(result.current.tz).toBe('Pacific/Auckland');
  });

  // The viewer's offset is forced rather than read from the host, so these
  // assert the same thing under all three zones in the test:tz matrix.
  it('flags no mismatch when the viewer shares the restaurant offset', () => {
    // Phoenix, deliberately: it does not observe DST, so its offset is UTC-7
    // year round. Asserting against Chicago here would pass in July and fail
    // in November when the offset moves to UTC-6.
    mockContext.mockReturnValue({
      selectedRestaurant: { restaurant: { timezone: 'America/Phoenix' } },
    });
    // getTimezoneOffset is minutes WEST of UTC, so UTC-7 is +420.
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(420);
    const { result } = renderHook(() => useRestaurantClock());
    expect(result.current.viewerTzDiffers).toBe(false);
    vi.restoreAllMocks();
  });

  it('flags a mismatch when the viewer is in another offset', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-720); // UTC+12
    const { result } = renderHook(() => useRestaurantClock());
    expect(result.current.viewerTzDiffers).toBe(true);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/useRestaurantClock.test.tsx
```

Expected: FAIL — `Failed to resolve import "@/hooks/useRestaurantClock"`.

- [ ] **Step 3: Write the implementation**

Create `src/hooks/useRestaurantClock.ts`:

```ts
import { useMemo } from 'react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useTodayInTimezone } from '@/hooks/useTodayInTimezone';
import {
  formatInstant as formatInstantIn,
  parseWallClock as parseWallClockIn,
  safeTz,
  toBusinessDay as toBusinessDayIn,
  toWallClockInput as toWallClockInputIn,
  tzAbbrev as tzAbbrevOf,
  tzOffsetMinutes,
} from '@/lib/restaurantClock';

export interface RestaurantClock {
  tz: string;
  tzAbbrev: string;
  viewerTzDiffers: boolean;
  today: string;
  formatInstant: (value: string | Date, pattern: string) => string;
  toBusinessDay: (value: string | Date) => string;
  toWallClockInput: (value: string | Date) => string;
  parseWallClock: (wallClock: string) => string;
}

/**
 * The selected restaurant's clock — the default frame for user-visible dates.
 *
 * Identity contract: the returned object is stable across re-renders and
 * changes at most once per day (when `today` rolls over) plus whenever the
 * selected restaurant changes. Consumers may safely list its functions in
 * `useEffect`/`useCallback` dependency arrays.
 */
export function useRestaurantClock(): RestaurantClock {
  const { selectedRestaurant } = useRestaurantContext();

  // Declared immediately after the context read. Threading a local into an
  // earlier hook while declaring it lower is a TDZ ReferenceError at render
  // that tsc does not catch (memory/lessons.md:1303-1304).
  const tz = safeTz(selectedRestaurant?.restaurant?.timezone);

  const today = useTodayInTimezone(tz);

  // `today` MUST be in the deps. Without it the closures capture the mount-day
  // value and a long-lived page stops rolling over at midnight — the exact
  // behaviour useTodayInTimezone exists to provide.
  return useMemo<RestaurantClock>(() => {
    const now = new Date();
    // Compare current UTC offsets, not IANA strings: America/Chicago and
    // US/Central name the same zone and must not trigger a cue.
    const viewerOffset = -now.getTimezoneOffset();
    const viewerTzDiffers = viewerOffset !== tzOffsetMinutes(tz, now);

    return {
      tz,
      tzAbbrev: tzAbbrevOf(tz, now),
      viewerTzDiffers,
      today,
      formatInstant: (value, pattern) => formatInstantIn(value, tz, pattern),
      toBusinessDay: (value) => toBusinessDayIn(value, tz),
      toWallClockInput: (value) => toWallClockInputIn(value, tz),
      parseWallClock: (wallClock) => parseWallClockIn(wallClock, tz),
    };
  }, [tz, today]);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/useRestaurantClock.test.tsx
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRestaurantClock.ts tests/unit/useRestaurantClock.test.tsx
git commit -m "feat(clock): useRestaurantClock hook with a documented identity contract"
```

---

### Task 4: Fix the punch-edit round-trip (data corruption)

Highest-severity item. `src/pages/TimePunchesManager.tsx:477` reads a punch into a `datetime-local` field in the **browser's** zone and `:492` re-interprets those digits in the browser's zone on save. A manager editing from another zone shifts the punch by the offset difference **even when they only change the notes field**.

**Files:**
- Modify: `src/pages/TimePunchesManager.tsx:474-497`
- Test: `tests/unit/TimePunchesManager.roundTrip.test.ts`

**Interfaces:**
- Consumes: `toWallClockInput`, `parseWallClock` from Task 1.

- [ ] **Step 1: Write the failing regression test**

Create `tests/unit/TimePunchesManager.roundTrip.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseWallClock, toWallClockInput } from '@/lib/restaurantClock';

/**
 * Regression for the punch-edit corruption: opening the edit dialog and saving
 * without touching the time must not move the instant. This fails against the
 * old browser-zone `format(new Date(...))` / `new Date(...).toISOString()` pair
 * whenever the viewer's zone differs from the restaurant's.
 */
describe('punch edit round trip', () => {
  const RESTAURANT_TZ = 'America/Chicago';

  const cases = [
    '2026-07-23T01:56:00.000Z', // Jul 22 20:56 Chicago
    '2026-07-22T10:00:00.000Z', // Jul 22 05:00 Chicago
    '2026-03-08T08:30:00.000Z', // spring forward, 03:30 CDT
    '2026-11-01T06:30:00.000Z', // fall back, 01:30 local
  ];

  it.each(cases)('preserves %s exactly', (stored) => {
    const shown = toWallClockInput(stored, RESTAURANT_TZ);
    const saved = parseWallClock(shown, RESTAURANT_TZ);
    expect(saved).toBe(stored);
  });

  it('shows the restaurant wall clock, not the viewer’s', () => {
    expect(toWallClockInput('2026-07-23T01:56:00.000Z', RESTAURANT_TZ)).toBe('2026-07-22T20:56');
  });
});
```

- [ ] **Step 2: Run it under a non-restaurant zone to prove it is meaningful**

```bash
TZ=Pacific/Auckland npx vitest run tests/unit/TimePunchesManager.roundTrip.test.ts
```

Expected: PASS — the helpers are already zone-independent. This test pins the property; the page change below is what actually adopts it.

- [ ] **Step 3: Apply the fix**

In `src/pages/TimePunchesManager.tsx`, add the hook import alongside the other hook imports:

```ts
import { useRestaurantClock } from '@/hooks/useRestaurantClock';
```

Inside the component, next to the other hook calls:

```ts
const clock = useRestaurantClock();
```

Replace `openEditDialog` (currently line 474-480):

```ts
  const openEditDialog = (punch: TimePunch) => {
    setEditingPunch(punch);
    setEditFormData({
      // Restaurant wall clock, NOT the browser's. Paired with parseWallClock
      // on save so an edit that touches only `notes` cannot move the instant.
      punch_time: clock.toWallClockInput(punch.punch_time),
      notes: punch.notes || '',
    });
  };
```

Replace the `punch_time` line in `handleEditSubmit` (currently line 492):

```ts
      punch_time: clock.parseWallClock(editFormData.punch_time),
```

- [ ] **Step 4: Label the field so the zone is visible**

Find the `datetime-local` input's `<Label>` in the edit dialog and append the zone:

```tsx
<Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
  Punch Time ({clock.tzAbbrev})
</Label>
```

- [ ] **Step 5: Verify**

```bash
npx vitest run tests/unit/TimePunchesManager.roundTrip.test.ts && npm run typecheck
```

Expected: PASS, then typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/pages/TimePunchesManager.tsx tests/unit/TimePunchesManager.roundTrip.test.ts
git commit -m "fix(punches): stop the edit dialog rewriting the instant in the viewer's timezone

Reading a punch into the datetime-local field with browser-zone format() and
writing it back with browser-zone new Date() shifted every punch by the offset
difference whenever a manager edited from outside the restaurant's zone --
including edits that only changed the notes field. Both sides now go through
the restaurant clock."
```

---

### Task 5: Fix labor + payroll day bucketing (one commit — they must agree)

`src/services/laborCalculations.ts:40-41` states its bucketing "must match Payroll's day-bucketing (payrollCalculations.ts)". Splitting these makes the Labor and Payroll screens disagree. `src/lib/laborPnlAnalytics.ts:168-174` already records this as a known limitation whose fix "belongs in `calculateActualLaborCost`, app-wide, with its own review" — this is that review.

**Files:**
- Modify: `src/services/laborCalculations.ts` (`formatDateUTC` at 43-48, call site 945, signatures at 497 and 871)
- Modify: `src/utils/payrollCalculations.ts` (signature at 439, call sites 492 and 558-559)
- Modify: `src/hooks/useLaborCostsFromTimeTracking.tsx:134`, `src/hooks/useMonthlyMetrics.tsx:523`, `src/hooks/usePayroll.tsx`
- Test: `tests/unit/laborPayrollBucketingParity.test.ts`

**Interfaces:**
- Consumes: `toBusinessDay` from Task 1.
- Produces (signature changes — `timezone` is **required**, so `tsc` enumerates every caller):
  ```ts
  calculateEmployeePay(..., timezone: string)
  calculateActualLaborCost(employees, timePunches, startDate, endDate, timezone: string)
  calculateActualLaborCostForMonth(input: MonthlyLaborInput & { timezone: string })
  ```

- [ ] **Step 1: Write the failing parity test**

Create `tests/unit/laborPayrollBucketingParity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { toBusinessDay } from '@/lib/restaurantClock';

/**
 * The two engines must bucket identically or the Labor and Payroll screens
 * disagree (see the contract comment at laborCalculations.ts:40-41).
 *
 * The concrete case is memory/lessons.md:1403: employee 0f5da8cc clocks in at
 * 2026-07-23T01:56:20Z, which is Jul 22 20:56 in Chicago. Bucketed host-local
 * on a UTC runner it lands on Jul 23 and $26.44 moves to the wrong day.
 */
describe('labor and payroll bucket a clock-in identically', () => {
  const TZ = 'America/Chicago';
  const CLOCK_IN = '2026-07-23T01:56:20Z';

  it('attributes the overnight clock-in to the clock-in day', () => {
    expect(toBusinessDay(CLOCK_IN, TZ)).toBe('2026-07-22');
  });

  it('is independent of the host timezone', () => {
    // Same assertion regardless of TZ= on the runner; the matrix in package.json
    // runs this file under Chicago, Auckland and UTC.
    expect(toBusinessDay(CLOCK_IN, TZ)).toBe('2026-07-22');
  });
});
```

- [ ] **Step 2: Run it**

```bash
TZ=UTC npx vitest run tests/unit/laborPayrollBucketingParity.test.ts
```

Expected: PASS (it pins the property `toBusinessDay` already has). The production changes below adopt it.

- [ ] **Step 3: Replace the misnamed helper in `laborCalculations.ts`**

Delete `formatDateUTC` (lines 37-48 including its doc comment) and add the import at the top of the file:

```ts
import { toBusinessDay } from '@/lib/restaurantClock';
```

- [ ] **Step 4: Thread `timezone` into `calculateActualLaborCost`**

Change the signature at line 497:

```ts
export function calculateActualLaborCost(
  employees: Employee[],
  timePunches: TimePunch[],
  startDate: Date,
  endDate: Date,
  timezone: string
): { breakdown: LaborCostBreakdown; dailyCosts: DailyLaborCost[] } {
```

Change the `calculateActualLaborCostForMonth` input interface (`MonthlyLaborInput`) to add:

```ts
  /** Restaurant IANA timezone. Day bucketing is restaurant-local, not host-local. */
  timezone: string;
```

and destructure it at line 874:

```ts
  const { employees, timePunches, tipsOwedByEmployee, monthStart, monthEnd, timezone } = input;
```

Replace the bucketing call at line 945:

```ts
        const dateKey = toBusinessDay(period.clockIn ?? period.startTime, timezone);
```

Then fix every other `formatDateUTC(` call the compiler flags, each becoming `toBusinessDay(<same arg>, timezone)`.

- [ ] **Step 5: Thread `timezone` into `payrollCalculations.ts`**

Add the imports:

```ts
import { parseDateOnly } from '@/lib/dateOnly';
import { toBusinessDay } from '@/lib/restaurantClock';
```

Add `timezone: string` as the final required parameter of `calculateEmployeePay` (line 439).

Replace line 492:

```ts
      const dateKey = toBusinessDay(period.clockIn, timezone);
```

Replace lines 558-559 — note the second bug here, `new Date('YYYY-MM-DD')` parses as **UTC midnight** (`src/lib/dateOnly.ts:5-12`):

```ts
      const dateKey = toBusinessDay(punch.punch_time, timezone);
      const punchDate = parseDateOnly(dateKey);
```

- [ ] **Step 6: Let the compiler find the callers**

```bash
npm run typecheck
```

Expected: errors at `src/hooks/useLaborCostsFromTimeTracking.tsx:134`, `src/hooks/useMonthlyMetrics.tsx:523`, `src/hooks/usePayroll.tsx`, and internal `calculateEmployeePay` calls in `laborCalculations.ts:884` and `:926`.

Fix each by passing the restaurant timezone. In hooks that already have `useRestaurantContext`, use `useRestaurantClock().tz`; inside `laborCalculations.ts` pass the `timezone` already threaded into scope.

- [ ] **Step 7: Update the affected fixtures before running the suite**

`memory/lessons.md:1297-1300` records that this exact change broke CI in three places because fixtures used naive datetime strings. `memory/lessons.md:1403-1405` records the follow-on: tests asserting a real restaurant's daily dollar total must pin `process.env.TZ`.

```bash
grep -rln "getTimezoneOffset" tests/ ; grep -rlnE "'20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'" tests/ | head -20
```

For each hit in a labor/payroll test: re-anchor naive strings to explicit UTC instants (`'2026-07-22T15:00:00Z'`), and where the expected value is intrinsically one restaurant's local-day total, pass `'America/Chicago'` as the new `timezone` argument rather than pinning `process.env.TZ`.

- [ ] **Step 8: Run the full suite under UTC — the CI-reproducing gate**

```bash
TZ=UTC npm run test
```

Expected: PASS. A failure here is the real CI failure arriving early.

- [ ] **Step 9: Run it under a zone ahead of UTC too**

```bash
TZ=Pacific/Auckland npm run test
```

Expected: PASS, identical results.

- [ ] **Step 10: Commit both files together**

```bash
git add src/services/laborCalculations.ts src/utils/payrollCalculations.ts src/hooks/useLaborCostsFromTimeTracking.tsx src/hooks/useMonthlyMetrics.tsx src/hooks/usePayroll.tsx tests/
git commit -m "fix(labor,payroll): bucket worked hours by the restaurant day, not the viewer's

formatDateUTC was misnamed -- it read local fields, so hours attributed to
whatever day it was in the viewer's browser. payrollCalculations had the same
defect plus a new Date('YYYY-MM-DD') UTC-midnight parse. Both engines document
a mutual consistency requirement, so they change together.

Resolves the KNOWN LIMITATION recorded at laborPnlAnalytics.ts:168-174."
```

---

### Task 6: Fix timecard day bucketing

`src/pages/EmployeeTimecard.tsx:106` groups punches with `format(punchDate, 'yyyy-MM-dd')` in the browser zone. Note line 100 (`format(day, 'yyyy-MM-dd')` over `weekDays`) is **correct** — those are calendar-day tokens, not instants. Only the punch line changes.

**Files:**
- Modify: `src/pages/EmployeeTimecard.tsx:97-113`

- [ ] **Step 1: Apply the fix**

Add the import:

```ts
import { useRestaurantClock } from '@/hooks/useRestaurantClock';
```

Add the hook call next to the component's other hooks:

```ts
  const clock = useRestaurantClock();
```

Replace the `punchesByDay` memo body (lines 97-113):

```ts
  const punchesByDay = useMemo(() => {
    const grouped = new Map<string, TimePunch[]>();
    weekDays.forEach((day) => {
      // weekDays are calendar-day tokens, so local fields are the correct
      // serialization here -- do NOT route these through the clock.
      const dayKey = format(day, 'yyyy-MM-dd');
      grouped.set(dayKey, []);
    });

    periodPunches.forEach((punch) => {
      // punch_time is an instant; bucket it by the restaurant's day.
      const dayKey = clock.toBusinessDay(punch.punch_time);
      if (grouped.has(dayKey)) {
        grouped.get(dayKey)!.push(punch);
      }
    });

    return grouped;
  }, [periodPunches, weekDays, clock]);
```

- [ ] **Step 2: Remove the now-unused `parseISO` import if nothing else uses it**

```bash
grep -n "parseISO" src/pages/EmployeeTimecard.tsx
```

If the only hit is the import line, delete `parseISO` from the `date-fns` import.

- [ ] **Step 3: Verify**

```bash
npm run typecheck && TZ=Pacific/Auckland npx vitest run tests/unit/ --silent
```

Expected: typecheck clean, tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/pages/EmployeeTimecard.tsx
git commit -m "fix(timecard): group punches by the restaurant day rather than the browser's"
```

---

### Task 7: Collapse the three timezone fallbacks

Three different fallbacks currently coexist. The third is the reported bug installed as a default.

**Files:**
- Modify: `src/pages/Scheduling.tsx:221` (`'UTC'`)
- Modify: `src/hooks/useDateFormat.tsx:9` (`'America/Chicago'`)
- Modify: `src/components/POSSalesImportReview.tsx:156` (browser zone)

- [ ] **Step 1: `Scheduling.tsx`**

```ts
import { safeTz } from '@/lib/restaurantClock';
```

```ts
  const restaurantTimezone = safeTz(selectedRestaurant?.restaurant?.timezone);
```

- [ ] **Step 2: `useDateFormat.tsx`**

```ts
import { safeTz } from '@/lib/restaurantClock';
```

```ts
  const timezone = safeTz(selectedRestaurant?.restaurant?.timezone);
```

- [ ] **Step 3: `POSSalesImportReview.tsx`**

```ts
import { safeTz } from '@/lib/restaurantClock';
```

```ts
    // Restaurant timezone, never the viewer's -- an importer in another zone
    // would otherwise stamp sales with their own calendar day.
    const timezone = safeTz(selectedRestaurant?.restaurant?.timezone);
```

- [ ] **Step 4: Confirm no browser-zone fallback survives**

```bash
grep -rn "resolvedOptions().timeZone" src/
```

Expected: no hits in `src/` outside test helpers. If a hit remains, it is a fallback that must be converted.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck && TZ=UTC npm run test
```

```bash
git add src/pages/Scheduling.tsx src/hooks/useDateFormat.tsx src/components/POSSalesImportReview.tsx
git commit -m "refactor(clock): collapse three timezone fallbacks onto safeTz"
```

---

### Task 8: The ESLint guardrail

`eslint.config.js` is **flat config** (`tseslint.config(...)` at line 7); there is no `.eslintrc*`. Flat config has **no `overrides` key** — writing one is a silent no-op that would leave the allowlist inert and break the build on every unmigrated file. Use two ordered config objects; later wins.

**Files:**
- Modify: `eslint.config.js`

- [ ] **Step 1: Establish the real allowlist**

Add the rule with an empty allowlist first and let ESLint enumerate the violations:

```bash
npx eslint src --format unix 2>/dev/null | grep "restaurant-clock" | cut -d: -f1 | sort -u > /tmp/tz-allowlist.txt && wc -l /tmp/tz-allowlist.txt
```

The spec's estimate ranges 35–51; **the output of this command is the authoritative number.**

- [ ] **Step 2: Add both config objects**

Append to the array inside `tseslint.config(...)` in `eslint.config.js`, after the existing main object:

```js
  // --- Restaurant-timezone guardrail -------------------------------------
  // A `Date` is either a day on a calendar or a moment in time. Browser-local
  // formatting silently renders instants in the VIEWER's zone, which is how
  // punches, labor cost and schedules end up on the wrong day for anyone
  // outside the restaurant's timezone. Use `useRestaurantClock()` (components)
  // or `src/lib/restaurantClock.ts` (pure code) instead.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/restaurantClock.ts",
      "src/lib/dateOnly.ts",
      "src/hooks/useRestaurantClock.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name='format'] > Literal.arguments[value=/yyyy-MM-dd/]",
          message:
            "restaurant-clock: format(instant, 'yyyy-MM-dd') buckets by the VIEWER's timezone. Use toBusinessDay() from useRestaurantClock(), or toDateOnlyString() if this is a calendar-day token.",
        },
        {
          selector:
            "MemberExpression[property.name=/^toLocale(Date|Time)?String$/]",
          message:
            "restaurant-clock: toLocale*String renders in the viewer's timezone. Use formatInstant() from useRestaurantClock().",
        },
        {
          selector:
            "CallExpression[callee.object.callee.property.name='toISOString'][callee.property.name='split']",
          message:
            "restaurant-clock: .toISOString().split('T')[0] is neither a calendar day nor a moment in time. Use toBusinessDay() or toDateOnlyString().",
        },
        {
          selector:
            "MemberExpression[object.callee.name='DateTimeFormat'][property.name='resolvedOptions']",
          message:
            "restaurant-clock: never default to the viewer's timezone. Use safeTz(restaurant.timezone).",
        },
      ],
    },
  },
  // Migration allowlist. Every path here is a file still rendering instants in
  // the viewer's timezone. Shrinking this list IS the migration; do not add to
  // it. Later config objects win in flat config, so this disables the rule for
  // exactly these files.
  {
    files: [
      // Populated from `npx eslint src` in Step 1 -- one path per line.
    ],
    rules: { "no-restricted-syntax": "off" },
  },
```

- [ ] **Step 3: Paste the allowlist**

Insert the paths from `/tmp/tz-allowlist.txt` into the `files` array of the second object, as repo-relative globs, sorted, one per line. Exclude the four files fixed in Tasks 4–7 — they must **not** be allowlisted.

- [ ] **Step 4: Verify the rule is live and the build is green**

```bash
npm run lint
```

Expected: exit 0. If a fixed file appears, the fix is incomplete — do not allowlist it.

- [ ] **Step 5: Verify the rule actually fires**

```bash
printf "import { format } from 'date-fns';\nexport const x = format(new Date(), 'yyyy-MM-dd');\n" > src/__tz_probe.ts && npx eslint src/__tz_probe.ts; rm src/__tz_probe.ts
```

Expected: one `restaurant-clock:` error. A clean result means the selector is wrong — fix it before committing.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.js
git commit -m "feat(lint): ban browser-local date formatting outside the restaurant clock

Flat config, two ordered objects -- the second re-declares the rule as off for
the migration allowlist. Shrinking that list is the remaining migration."
```

---

### Task 9: Expand the timezone test matrix

`package.json:32` currently runs 3 distinct files across 5 zone invocations (6 commands). That leaves the rest of the suite unprotected, and CI runs UTC — the one zone where these bugs are invisible.

**Files:**
- Modify: `package.json:32`

- [ ] **Step 1: Replace the script**

```json
    "test:tz": "TZ=America/Chicago vitest run && TZ=Pacific/Auckland vitest run && TZ=UTC vitest run",
```

Three zones: behind UTC (where most restaurants are), ahead of UTC (where the day flips the other way), and UTC (what CI runs).

- [ ] **Step 2: Run it**

```bash
npm run test:tz
```

Expected: three full-suite passes. Any failure is a real timezone-fragile test — fix it per `memory/lessons.md:1405`: re-anchor to explicit UTC instants when the assertion is tz-invariant, or pass an explicit `timezone` argument when it is intrinsically one restaurant's local-day total.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test(tz): run the full unit suite under Chicago, Auckland and UTC"
```

---

### Task 10: The timezone notice

Correctness alone does not resolve the reported confusion — a viewer in another zone still has no cue whose 6 PM they are reading.

**Files:**
- Create: `src/components/RestaurantTzNotice.tsx`
- Test: `tests/unit/RestaurantTzNotice.test.tsx`
- Modify: page headers **only if the audit in Step 4 passes**

- [ ] **Step 1: Write the failing test**

Create `tests/unit/RestaurantTzNotice.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { RestaurantTzNotice } from '@/components/RestaurantTzNotice';

const mockClock = vi.fn();
vi.mock('@/hooks/useRestaurantClock', () => ({
  useRestaurantClock: () => mockClock(),
}));

describe('RestaurantTzNotice', () => {
  beforeEach(() => {
    mockClock.mockReturnValue({
      tz: 'America/Chicago',
      tzAbbrev: 'CDT',
      viewerTzDiffers: true,
    });
  });

  it('renders nothing when the viewer shares the restaurant offset', () => {
    mockClock.mockReturnValue({ tz: 'America/Chicago', tzAbbrev: 'CDT', viewerTzDiffers: false });
    const { container } = render(<RestaurantTzNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the zone when the offsets differ', () => {
    render(<RestaurantTzNotice />);
    expect(screen.getByText(/times shown in restaurant time/i)).toBeInTheDocument();
    expect(screen.getByTitle('America/Chicago')).toHaveTextContent('CDT');
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run tests/unit/RestaurantTzNotice.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Create `src/components/RestaurantTzNotice.tsx`:

```tsx
import { useRestaurantClock } from '@/hooks/useRestaurantClock';

/**
 * A quiet cue that times on this surface are the restaurant's, shown only when
 * the viewer's current UTC offset differs. Offsets are compared rather than
 * IANA names so America/Chicago and US/Central do not trigger it.
 */
export function RestaurantTzNotice() {
  const { tz, tzAbbrev, viewerTzDiffers } = useRestaurantClock();

  if (!viewerTzDiffers) return null;

  return (
    <p className="text-[13px] text-muted-foreground">
      Times shown in restaurant time (
      <abbr title={tz} className="no-underline">
        {tzAbbrev}
      </abbr>
      )
    </p>
  );
}
```

- [ ] **Step 4: Audit before mounting — the placement gate**

A header-level notice asserts *every* time on that screen is restaurant-local. With sites still allowlisted, mounting it page-wide risks a header vouching for a neighbouring browser-zone number.

For `src/pages/Scheduling.tsx` and `src/pages/EmployeeTimecard.tsx`:

```bash
grep -c "^src/pages/Scheduling.tsx\|^src/pages/EmployeeTimecard.tsx" /tmp/tz-allowlist.txt
```

- **If neither page is in the allowlist:** mount `<RestaurantTzNotice />` in each page header, under the title.
- **If either page is allowlisted:** do **not** mount it on that page's header. Mount it on the specific migrated widget instead (the punch table on Timecard), and record the page in the commit message as pending its follow-up PR.

- [ ] **Step 5: Verify**

```bash
npx vitest run tests/unit/RestaurantTzNotice.test.tsx && npm run typecheck && npm run lint
```

Expected: PASS, clean, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/RestaurantTzNotice.tsx tests/unit/RestaurantTzNotice.test.tsx src/pages/
git commit -m "feat(clock): show a restaurant-timezone cue when the viewer's offset differs"
```

---

## Final verification

- [ ] **Full matrix**

```bash
npm run test:tz
```

- [ ] **Everything else**

```bash
npm run typecheck && npm run lint && npm run build && npm run test:db
```

- [ ] **Confirm the corruption path is actually fixed**

```bash
TZ=Pacific/Auckland npx vitest run tests/unit/TimePunchesManager.roundTrip.test.ts
TZ=America/New_York npx vitest run tests/unit/TimePunchesManager.roundTrip.test.ts
```

Expected: PASS under both — the property that failed before this branch.

- [ ] **Record the allowlist size in the PR body** as the migration baseline, so follow-up PRs can show it shrinking.
