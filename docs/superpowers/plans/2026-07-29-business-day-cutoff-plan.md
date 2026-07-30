# Per-Restaurant Business-Day Cutoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable per-restaurant business-day start hour so an overnight shift's hours and cost are attributed to the business day the employee clocked *in*, in the restaurant's timezone rather than the browser's.

**Architecture:** Two orthogonal rules compose — the attribution *anchor* is the shift's clock-in instant (already correct in `parseWorkPeriods`), and the *cutoff* maps that instant to a business day via `((instant AT TIME ZONE tz) - cutoffHour hours)::date`. A shift is never split. SQL (`public.business_day`) is authoritative; `src/lib/businessDay.ts` is the client preview, pinned to the SQL by a shared fixture table. Nine client bucketing sites are rerouted through the TS helper; `restaurants.business_day_start_hour SMALLINT NOT NULL DEFAULT 0` reproduces today's *intended* semantics.

**Tech Stack:** Postgres + pgTAP, React 18 + TypeScript, `date-fns` / `date-fns-tz`, Vitest, Playwright, shadcn/ui + TailwindCSS.

**Design doc:** [`docs/superpowers/specs/2026-07-29-business-day-cutoff-design.md`](../specs/2026-07-29-business-day-cutoff-design.md). Read §3 (what is actually broken), §4.1 (why the subtraction order is load-bearing), and §11 (test plan) before starting.

## Global Constraints

- **The cutoff column is `SMALLINT NOT NULL DEFAULT 0`, range `0 ≤ h ≤ 11`,** enforced by a plain (not `NOT VALID`) CHECK. Design §5.
- **The subtraction order is `(instant AT TIME ZONE tz) - interval`, never `(instant - interval) AT TIME ZONE tz`.** These differ by a full calendar day inside the fall-back repeated hour. Design §4.1. Task 1 pins this with an anti-regression test.
- **`toBusinessDay` returns a `string` (`YYYY-MM-DD`), never a `Date`.** A local-midnight `Date` is a calendar-day token; `memory/lessons.md` 2026-07-28 records the production incident from one meeting `.toISOString()`. Design §7.
- **`.toISOString().split('T')[0]` is forbidden** on any value representing a calendar day. Use `toDateOnlyString` / `parseDateOnly` from `src/lib/dateOnly.ts`.
- **CI runs in UTC**, the one zone where these bugs are invisible. Every new timezone-sensitive test is run under an explicitly pinned `TZ`, wired into `test:tz` in `package.json:32`.
- **Existing test call sites migrate to `LEGACY_UTC_FRAME = { tz: 'UTC', cutoffHour: 0 }`**, which is byte-identical to today's browser-local behavior under CI's UTC. This makes the signature migration provably behavior-preserving — no existing expectation changes.
- **No production rows in the repo.** Fixtures are synthetic. Aggregates only in docs.
- **Semantic tokens only** in UI (`bg-background`, not `bg-white`). Typography and control styling per CLAUDE.md's Apple/Notion scale.
- **Never commit to `main`.** Work on `feature/business-day-cutoff`.

## File Structure

**Created:**
| File | Responsibility |
|---|---|
| `supabase/migrations/<ts>_business_day_cutoff.sql` | The column, its CHECK, `public.business_day()`, grants |
| `supabase/tests/business_day_cutoff.test.sql` | pgTAP: helper semantics, DST, CHECK boundaries, §4.1 anti-regression |
| `src/lib/businessDay.ts` | Pure TS helper: `toBusinessDay`, `safeCutoffHour`, `BusinessDayConfig` |
| `tests/unit/businessDay.test.ts` | Helper unit tests + the shared SQL-parity fixture table |
| `tests/unit/fixtures/businessDayFixtures.ts` | Fixture corpus + `LEGACY_UTC_FRAME`, shared by every suite below |
| `tests/unit/businessDay.tz.test.ts` | Frame-independence matrix (§11.3) |
| `tests/unit/payroll-business-day-conservation.test.ts` | Conservation invariant + dollars (§11.1, §11.4) |
| `tests/unit/laborCalculations-goldenMaster.test.ts` | Golden master (§11.2) |
| `tests/e2e/business-day-cutoff.spec.ts` | Five E2E scenarios (§11.8) |

**Modified:**
| File | Change |
|---|---|
| `src/integrations/supabase/types.ts` | Regenerated — `business_day_start_hour` on `restaurants` |
| `src/hooks/useRestaurants.tsx` | `Restaurant` interface gains the field |
| `src/services/laborCalculations.ts` | 6 bucketing sites rerouted; `formatDateUTC` renamed |
| `src/utils/payrollCalculations.ts` | 2 bucketing sites rerouted; `calculateEmployeePay` signature |
| `src/utils/timecardHours.ts` | `hoursByClockInDay` rerouted |
| `src/hooks/useLaborCostsFromTimeTracking.tsx`, `usePayroll.tsx`, `useMonthlyMetrics.tsx` | tz + cutoff into query keys |
| `src/hooks/useScheduledLaborCosts.tsx` | Signature widened; `useMemo` deps |
| `src/pages/Scheduling.tsx` | Updated call to the widened hook |
| `src/pages/EmployeeTimecard.tsx` | tz + cutoff into the `dayHours` `useMemo` deps |
| `src/pages/RestaurantSettings.tsx` | Cutoff `Select` + save handler on the Payroll tab |
| `package.json` | `test:tz` gains the new tz suites |

**Task dependency order.** Task 3 (golden master) **must** land before any consumer change — it is the before-snapshot. Task 8 (`useScheduledLaborCosts` signature) **must** land before Task 9 reroutes `calculateScheduledLaborCost`, or the Scheduling variance view compares a business-day actual against a calendar-day scheduled (design §10). Everything else is linear.

```
T1 (migration+pgTAP) ─┐
T2 (TS helper) ───────┼→ T3 (golden master) → T4 (rename) → T5,T6,T7 (labor) → T8 → T9 → T10 (payroll) → T11 (timecard) → T12 (3-way) → T13 (UI) → T14 (tz wiring) → T15 (E2E)
```

---

### Task 1: Schema column, SQL helper, and pgTAP

**Files:**
- Create: `supabase/migrations/20260729140000_business_day_cutoff.sql`
- Create: `supabase/tests/business_day_cutoff.test.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `public.restaurants.business_day_start_hour SMALLINT NOT NULL DEFAULT 0`; `public.business_day(p_instant TIMESTAMPTZ, p_restaurant_id UUID) RETURNS DATE`.

- [ ] **Step 1: Write the migration**

```sql
-- Per-restaurant business-day start hour.
--
-- An overnight shift belongs to the day the employee clocked IN, not the
-- calendar day they clocked out. Two orthogonal rules compose:
--   1. the attribution anchor is the shift's clock-in instant (client-side,
--      parseWorkPeriods already does this);
--   2. the cutoff maps that instant to a business day, below.
--
-- DEFAULT 0 reproduces "business day == restaurant-local calendar day", which
-- is today's intended semantics, so no restaurant's attribution changes on
-- deploy. Postgres 11+ materializes a non-volatile default without a table
-- rewrite, so DEFAULT 0 *is* the backfill for the existing rows.

ALTER TABLE public.restaurants
  ADD COLUMN business_day_start_hour SMALLINT NOT NULL DEFAULT 0;

-- Plain CHECK, not NOT VALID: added in the same migration as the column, so
-- every row satisfies it by construction, and restaurants is a ~35-row
-- settings table. The validating scan is sub-millisecond.
ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_business_day_start_hour_range
  CHECK (business_day_start_hour BETWEEN 0 AND 11);

COMMENT ON COLUMN public.restaurants.business_day_start_hour IS
  'Hour (0-11, restaurant-local) at which the business day starts. Shifts '
  'clocking in before this hour are attributed to the previous business day. '
  '0 == calendar day. See docs/superpowers/specs/2026-07-29-business-day-cutoff-design.md';

CREATE OR REPLACE FUNCTION public.business_day(
  p_instant       TIMESTAMPTZ,
  p_restaurant_id UUID
) RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz   TEXT;
  v_hour SMALLINT;
BEGIN
  IF p_instant IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT r.timezone, r.business_day_start_hour
    INTO v_tz, v_hour
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;

  -- Covers a NULL timezone, an empty string, and no-such-restaurant (where
  -- SELECT ... INTO leaves both OUT variables NULL). Under SECURITY INVOKER an
  -- RLS-invisible row is indistinguishable from a nonexistent one, and both
  -- resolve here to UTC/0 rather than raising. That is deliberate: identical
  -- output for both cases means this cannot be used to probe whether a foreign
  -- restaurant exists, and a bucketing helper is the wrong layer to enforce
  -- authorization. Pinned by test in supabase/tests/business_day_cutoff.test.sql.
  v_tz   := COALESCE(NULLIF(v_tz, ''), 'UTC');
  v_hour := COALESCE(v_hour, 0);

  -- An invalid IANA string raises invalid_parameter_value (22023) on first use.
  -- Probe once with a throwaway expression: the error depends only on the zone
  -- string, not on the timestamptz being converted. Deliberately NOT a
  -- pg_timezone_names lookup -- that is a ~1,200-row catalog scan at ~49ms
  -- versus ~0.4ms here (memory/lessons.md 2026-07-23). Reassigning v_tz itself
  -- -- the widest-scoped variable, not a local -- is what makes the RETURN safe
  -- (memory/lessons.md 2026-07-24).
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_tz := 'UTC';
  END;

  -- ORDER IS LOAD-BEARING. Converting first and then subtracting reads the
  -- wall clock the employee actually experienced. The other order,
  -- (p_instant - interval) AT TIME ZONE v_tz, subtracts *elapsed* time and
  -- disagrees by a full calendar day for any instant inside the fall-back
  -- repeated hour: America/Chicago, cutoff 2, 2026-11-01 07:30:00+00 gives
  -- 2026-10-31 here and 2026-11-01 there. See design doc section 4.1; the
  -- anti-regression test asserts the rejected form is wrong.
  RETURN ((p_instant AT TIME ZONE v_tz) - make_interval(hours => v_hour))::date;
END;
$$;

REVOKE ALL ON FUNCTION public.business_day(TIMESTAMPTZ, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.business_day(TIMESTAMPTZ, UUID)
  TO authenticated, service_role;
```

- [ ] **Step 2: Apply it and confirm it took**

```bash
npm run db:reset
```

Expected: migrations replay clean, no error on the `ALTER TABLE` or the `CREATE FUNCTION`.

Then confirm the column and default landed (a sibling session's `db reset` can drop it mid-work — `memory/lessons.md` 2026-07-28):

```bash
npx supabase db diff --schema public | head -20
```

Expected: empty output (no drift between migrations and the local DB).

- [ ] **Step 3: Write the pgTAP suite**

Create `supabase/tests/business_day_cutoff.test.sql`:

```sql
-- Business-day cutoff: helper semantics, DST, and constraint boundaries.
BEGIN;
SELECT plan(19);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Three restaurants: Chicago at cutoff 2, Chicago at cutoff 0, and one with a
-- deliberately invalid timezone string to exercise the exception probe.
INSERT INTO public.restaurants (id, name, timezone, business_day_start_hour)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Cutoff 2 Chicago', 'America/Chicago', 2),
  ('22222222-2222-2222-2222-222222222222', 'Cutoff 0 Chicago', 'America/Chicago', 0),
  ('33333333-3333-3333-3333-333333333333', 'Bad TZ',           'Not/AZone',       2),
  ('44444444-4444-4444-4444-444444444444', 'Empty TZ',         '',                2);

-- ── Existence ───────────────────────────────────────────────────────────────
SELECT has_column('public', 'restaurants', 'business_day_start_hour',
  'restaurants.business_day_start_hour exists');
SELECT col_not_null('public', 'restaurants', 'business_day_start_hour',
  'business_day_start_hour is NOT NULL');
SELECT col_default_is('public', 'restaurants', 'business_day_start_hour', '0',
  'business_day_start_hour defaults to 0 (behavior-preserving)');
SELECT has_function('public', 'business_day', ARRAY['timestamp with time zone','uuid'],
  'public.business_day(timestamptz, uuid) exists');

-- ── Core cutoff behavior (design section 4, the worked table) ────────────────
-- 18:00 local clock-in, cutoff 2 -> its own day.
SELECT is(
  public.business_day('2026-07-28 23:00:00+00'::timestamptz,
                      '11111111-1111-1111-1111-111111111111'),
  '2026-07-28'::date,
  '18:00 CDT clock-in at cutoff 2 stays on its own day');

-- 01:00 local clock-in, cutoff 2 -> PREVIOUS day. This is the feature.
SELECT is(
  public.business_day('2026-07-29 06:00:00+00'::timestamptz,
                      '11111111-1111-1111-1111-111111111111'),
  '2026-07-28'::date,
  '01:00 CDT clock-in at cutoff 2 rolls back to the previous business day');

-- 03:00 local clock-in is past the cutoff -> its own day.
SELECT is(
  public.business_day('2026-07-29 08:00:00+00'::timestamptz,
                      '11111111-1111-1111-1111-111111111111'),
  '2026-07-29'::date,
  '03:00 CDT clock-in at cutoff 2 belongs to its own day');

-- cutoff 0 degenerates to the restaurant-local calendar day.
SELECT is(
  public.business_day('2026-07-29 06:00:00+00'::timestamptz,
                      '22222222-2222-2222-2222-222222222222'),
  '2026-07-29'::date,
  'cutoff 0 == restaurant-local calendar day');

-- ── The section 4.1 anti-regression pair ────────────────────────────────────
-- Inside the fall-back repeated hour: 07:30 UTC is the SECOND 01:30 CST.
SELECT is(
  public.business_day('2026-11-01 07:30:00+00'::timestamptz,
                      '11111111-1111-1111-1111-111111111111'),
  '2026-10-31'::date,
  'fall-back repeated hour buckets to the previous business day');

-- ...and the tempting "equivalent" ordering is provably WRONG here. Without
-- this assertion a maintainer could "simplify" business_day() to the rejected
-- form and still pass every other test in this file, because the two orderings
-- agree everywhere outside the repeated hour.
SELECT isnt(
  (('2026-11-01 07:30:00+00'::timestamptz - make_interval(hours => 2))
     AT TIME ZONE 'America/Chicago')::date,
  '2026-10-31'::date,
  'subtract-BEFORE-convert gives the WRONG day here -- see design section 4.1');

-- ── DST transitions ─────────────────────────────────────────────────────────
-- Fall-back, after the transition completes: 02:30 CST.
SELECT is(
  public.business_day('2026-11-01 08:30:00+00'::timestamptz,
                      '11111111-1111-1111-1111-111111111111'),
  '2026-11-01'::date,
  'fall-back after transition, 02:30 CST is past the cutoff');

-- Spring-forward: 02:00-03:00 local does not exist. 09:30 UTC is 03:30 CDT.
SELECT is(
  public.business_day('2026-03-08 09:30:00+00'::timestamptz,
                      '11111111-1111-1111-1111-111111111111'),
  '2026-03-08'::date,
  'spring-forward 03:30 CDT is past the cutoff');

-- Spring-forward, before the skip: 01:30 CST -> previous day at cutoff 2.
SELECT is(
  public.business_day('2026-03-08 07:30:00+00'::timestamptz,
                      '11111111-1111-1111-1111-111111111111'),
  '2026-03-07'::date,
  'spring-forward 01:30 CST rolls back');

-- ── Degenerate inputs ───────────────────────────────────────────────────────
SELECT is(
  public.business_day(NULL::timestamptz, '11111111-1111-1111-1111-111111111111'),
  NULL::date,
  'NULL instant returns NULL');

SELECT is(
  public.business_day('2026-07-29 06:00:00+00'::timestamptz,
                      '33333333-3333-3333-3333-333333333333'),
  '2026-07-29'::date,
  'invalid IANA string falls back to UTC (06:00 UTC, cutoff 2 -> 04:00 -> Jul 29)');

SELECT is(
  public.business_day('2026-07-29 06:00:00+00'::timestamptz,
                      '44444444-4444-4444-4444-444444444444'),
  '2026-07-29'::date,
  'empty-string timezone falls back to UTC');

-- Missing restaurant: contract is UTC/0, NOT null and NOT an error. Under
-- SECURITY INVOKER this is the same code path an RLS-invisible row takes.
SELECT is(
  public.business_day('2026-07-29 06:00:00+00'::timestamptz,
                      '99999999-9999-9999-9999-999999999999'),
  '2026-07-29'::date,
  'unknown restaurant_id resolves to UTC/cutoff-0 rather than NULL or an error');

-- ── CHECK boundaries, BOTH directions ───────────────────────────────────────
-- Rejections alone would still pass against a constraint accidentally
-- tightened to BETWEEN 1 AND 10, which would lock out the 0 default every
-- existing row depends on.
SELECT throws_ok(
  $$UPDATE public.restaurants SET business_day_start_hour = -1
    WHERE id = '22222222-2222-2222-2222-222222222222'$$,
  '23514', NULL, 'cutoff -1 is rejected');

SELECT throws_ok(
  $$UPDATE public.restaurants SET business_day_start_hour = 12
    WHERE id = '22222222-2222-2222-2222-222222222222'$$,
  '23514', NULL, 'cutoff 12 is rejected');

SELECT lives_ok(
  $$UPDATE public.restaurants SET business_day_start_hour = 0
    WHERE id = '22222222-2222-2222-2222-222222222222'$$,
  'cutoff 0 is accepted (the default every existing row uses)');

SELECT lives_ok(
  $$UPDATE public.restaurants SET business_day_start_hour = 11
    WHERE id = '22222222-2222-2222-2222-222222222222'$$,
  'cutoff 11 is accepted (upper bound)');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Run the pgTAP suite**

```bash
npm run test:db
```

Expected: `business_day_cutoff.test.sql` reports 19/19 passing, no failures across the rest of the suite.

If the `INSERT INTO public.restaurants` fails on a NOT NULL column this plan does not set, add the missing columns to the fixture insert — do not weaken the test. Check with `\d public.restaurants` or `npx supabase db diff`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260729140000_business_day_cutoff.sql supabase/tests/business_day_cutoff.test.sql
git commit -m "feat(db): per-restaurant business_day_start_hour + business_day() helper"
```

---

### Task 2: TypeScript helper

**Files:**
- Create: `src/lib/businessDay.ts`
- Create: `tests/unit/businessDay.test.ts`
- Create: `tests/unit/fixtures/businessDayFixtures.ts`
- Modify: `src/hooks/useRestaurants.tsx` (`Restaurant` interface, near `timezone?: string` at `:14`)
- Regenerate: `src/integrations/supabase/types.ts`

**Interfaces:**
- Consumes: `toDateOnlyString` from `src/lib/dateOnly.ts`; `validateTimeZone` from `src/lib/splhAnalytics.ts:73`.
- Produces:
  - `DEFAULT_BUSINESS_DAY_START_HOUR: 0`, `MAX_BUSINESS_DAY_START_HOUR: 11`
  - `interface BusinessDayConfig { tz: string | null | undefined; cutoffHour: number | null | undefined }`
  - `safeCutoffHour(hour: number | null | undefined): number`
  - `toBusinessDay(instant: Date | string, tz: string | null | undefined, cutoffHour: number | null | undefined): string`
  - `toBusinessDayFor(instant: Date | string, cfg: BusinessDayConfig): string`
  - From fixtures: `LEGACY_UTC_FRAME`, `SQL_PARITY_FIXTURES`

**Note on the two call shapes.** `toBusinessDay` keeps the design's three-argument form because it mirrors the SQL term for term (`tz` ↔ `AT TIME ZONE v_tz`, `cutoffHour` ↔ `make_interval`). `toBusinessDayFor` is the config-object form threaded through consumers, so widening nine call sites does not mean adding two positional parameters to each. One implementation, two ergonomics.

**Note on `safeTz`.** The design sketched a new `safeTz`. Do **not** write one: `validateTimeZone` at [`src/lib/splhAnalytics.ts:73`](../../../src/lib/splhAnalytics.ts) already has exactly the required semantics (null/invalid → `'UTC'`, via an `Intl.DateTimeFormat` probe that mirrors the SQL exception probe) and is already used by `useLaborPnlCore.ts:64` and `useSplhCore.ts:34`. Reuse it and note the correspondence.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fixtures/businessDayFixtures.ts`:

```ts
/**
 * Shared fixture corpus for the business-day cutoff.
 *
 * SQL_PARITY_FIXTURES is the single table consumed by BOTH
 * tests/unit/businessDay.test.ts and supabase/tests/business_day_cutoff.test.sql.
 * Both must agree with `expected` -- the STATED expectation -- not merely with
 * each other. Two implementations agreeing on a wrong answer is the failure
 * mode a mutual-comparison test cannot see.
 */
export interface SqlParityFixture {
  name: string;
  /** ISO 8601 instant with an explicit offset. */
  instant: string;
  tz: string;
  cutoffHour: number;
  /** YYYY-MM-DD. */
  expected: string;
}

export const SQL_PARITY_FIXTURES: SqlParityFixture[] = [
  {
    name: '18:00 CDT clock-in, cutoff 2 -> own day',
    instant: '2026-07-28T23:00:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 2,
    expected: '2026-07-28',
  },
  {
    name: '01:00 CDT clock-in, cutoff 2 -> previous day (the feature)',
    instant: '2026-07-29T06:00:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 2,
    expected: '2026-07-28',
  },
  {
    name: '03:00 CDT clock-in, cutoff 2 -> own day',
    instant: '2026-07-29T08:00:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 2,
    expected: '2026-07-29',
  },
  {
    name: 'cutoff 0 == restaurant-local calendar day',
    instant: '2026-07-29T06:00:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 0,
    expected: '2026-07-29',
  },
  {
    name: 'fall-back repeated hour (2nd 01:30 CST) -> previous day',
    instant: '2026-11-01T07:30:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 2,
    expected: '2026-10-31',
  },
  {
    name: 'fall-back after transition, 02:30 CST -> own day',
    instant: '2026-11-01T08:30:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 2,
    expected: '2026-11-01',
  },
  {
    name: 'spring-forward 03:30 CDT -> own day',
    instant: '2026-03-08T09:30:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 2,
    expected: '2026-03-08',
  },
  {
    name: 'spring-forward 01:30 CST -> previous day',
    instant: '2026-03-08T07:30:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 2,
    expected: '2026-03-07',
  },
  {
    name: 'east of UTC: 01:30 NZDT, cutoff 2 -> previous day',
    instant: '2026-07-28T13:30:00+00:00',
    tz: 'Pacific/Auckland',
    cutoffHour: 2,
    expected: '2026-07-28',
  },
  {
    name: 'upper bound cutoff 11, 10:00 local -> previous day',
    instant: '2026-07-29T15:00:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 11,
    expected: '2026-07-28',
  },
];

/**
 * The frame every PRE-EXISTING test call site migrates to.
 *
 * Vitest runs under TZ=UTC in CI, so `tz: 'UTC'` reproduces the browser-local
 * bucketing those tests were written against, byte for byte. Passing this makes
 * the signature migration provably behavior-preserving: no existing expectation
 * changes. NEW tests should name a real restaurant zone instead.
 */
export const LEGACY_UTC_FRAME = { tz: 'UTC', cutoffHour: 0 } as const;
```

Create `tests/unit/businessDay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  toBusinessDay,
  toBusinessDayFor,
  safeCutoffHour,
  DEFAULT_BUSINESS_DAY_START_HOUR,
  MAX_BUSINESS_DAY_START_HOUR,
} from '@/lib/businessDay';
import { SQL_PARITY_FIXTURES } from './fixtures/businessDayFixtures';

describe('safeCutoffHour', () => {
  it('passes through legal values including both bounds', () => {
    expect(safeCutoffHour(0)).toBe(0);
    expect(safeCutoffHour(2)).toBe(2);
    expect(safeCutoffHour(11)).toBe(11);
  });

  it('clamps out-of-range values to the legal domain', () => {
    expect(safeCutoffHour(-1)).toBe(0);
    expect(safeCutoffHour(12)).toBe(MAX_BUSINESS_DAY_START_HOUR);
    expect(safeCutoffHour(9999)).toBe(MAX_BUSINESS_DAY_START_HOUR);
  });

  it('coerces null, undefined, and NaN to the default', () => {
    expect(safeCutoffHour(null)).toBe(DEFAULT_BUSINESS_DAY_START_HOUR);
    expect(safeCutoffHour(undefined)).toBe(DEFAULT_BUSINESS_DAY_START_HOUR);
    expect(safeCutoffHour(NaN)).toBe(DEFAULT_BUSINESS_DAY_START_HOUR);
  });

  it('truncates a fractional hour rather than producing a sub-hour cutoff', () => {
    expect(safeCutoffHour(2.7)).toBe(2);
  });
});

describe('toBusinessDay', () => {
  // This is the SQL-parity table. supabase/tests/business_day_cutoff.test.sql
  // asserts the same `expected` values against public.business_day().
  it.each(SQL_PARITY_FIXTURES)('$name', ({ instant, tz, cutoffHour, expected }) => {
    expect(toBusinessDay(instant, tz, cutoffHour)).toBe(expected);
  });

  it('returns a string, never a Date', () => {
    const result = toBusinessDay('2026-07-29T06:00:00+00:00', 'America/Chicago', 2);
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('accepts a Date as well as an ISO string', () => {
    const iso = '2026-07-29T06:00:00+00:00';
    expect(toBusinessDay(new Date(iso), 'America/Chicago', 2)).toBe(
      toBusinessDay(iso, 'America/Chicago', 2),
    );
  });

  it('falls back to UTC for a null, empty, or invalid zone', () => {
    // 06:00 UTC minus 2h = 04:00 UTC, still Jul 29.
    const inst = '2026-07-29T06:00:00+00:00';
    expect(toBusinessDay(inst, null, 2)).toBe('2026-07-29');
    expect(toBusinessDay(inst, '', 2)).toBe('2026-07-29');
    expect(toBusinessDay(inst, 'Not/AZone', 2)).toBe('2026-07-29');
  });

  it('toBusinessDayFor is the config-object form of the same function', () => {
    const inst = '2026-07-29T06:00:00+00:00';
    expect(toBusinessDayFor(inst, { tz: 'America/Chicago', cutoffHour: 2 })).toBe(
      toBusinessDay(inst, 'America/Chicago', 2),
    );
  });

  it('rejects the subtract-before-convert ordering (design section 4.1)', () => {
    // Guard against a future "simplification". Inside the fall-back repeated
    // hour the two orderings differ by a full calendar day.
    const inst = '2026-11-01T07:30:00+00:00';
    expect(toBusinessDay(inst, 'America/Chicago', 2)).toBe('2026-10-31');

    const wrong = new Date(new Date(inst).getTime() - 2 * 3600_000);
    // Formatting the pre-subtracted instant in the zone yields Nov 1, not Oct 31.
    const wrongDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(wrong);
    expect(wrongDay).toBe('2026-11-01');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/businessDay.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/businessDay"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/businessDay.ts`:

```ts
import { toZonedTime } from 'date-fns-tz';
import { toDateOnlyString } from '@/lib/dateOnly';
import { validateTimeZone } from '@/lib/splhAnalytics';

export const DEFAULT_BUSINESS_DAY_START_HOUR = 0;
export const MAX_BUSINESS_DAY_START_HOUR = 11;

/**
 * A restaurant's business-day framing: its IANA zone and its cutoff hour.
 *
 * Threaded through the pure calculation modules (laborCalculations,
 * payrollCalculations, timecardHours), which have no React context access.
 */
export interface BusinessDayConfig {
  tz: string | null | undefined;
  cutoffHour: number | null | undefined;
}

/**
 * Clamp to [0, 11] and coerce null/undefined/NaN to 0.
 *
 * Mirrors the SQL `COALESCE(v_hour, 0)` plus the
 * `CHECK (business_day_start_hour BETWEEN 0 AND 11)` constraint. Truncates a
 * fractional input rather than inventing sub-hour cutoff semantics, which the
 * SMALLINT column cannot represent.
 */
export function safeCutoffHour(hour: number | null | undefined): number {
  if (hour === null || hour === undefined || !Number.isFinite(hour)) {
    return DEFAULT_BUSINESS_DAY_START_HOUR;
  }
  const truncated = Math.trunc(hour);
  if (truncated < DEFAULT_BUSINESS_DAY_START_HOUR) return DEFAULT_BUSINESS_DAY_START_HOUR;
  if (truncated > MAX_BUSINESS_DAY_START_HOUR) return MAX_BUSINESS_DAY_START_HOUR;
  return truncated;
}

/**
 * Map an instant to its business day, as a YYYY-MM-DD calendar-day token.
 *
 * Returns a STRING, not a Date. A Date would be a local-midnight calendar-day
 * token, and memory/lessons.md 2026-07-28 documents the production incident
 * that follows from one of those meeting `.toISOString()` -- 44
 * schedule_publications rows across 9 restaurants got an 8-day Mon->Mon span.
 * A string return makes that mistake unrepresentable at this boundary.
 * Callers needing a Date for date-fns go through parseDateOnly().
 *
 * Term-by-term correspondence with public.business_day(), which per CLAUDE.md
 * is the authoritative implementation and this the preview:
 *   toZonedTime          <-> AT TIME ZONE v_tz  (both yield naive local wall clock)
 *   setHours(getHours()-h) <-> - make_interval(hours => h)
 *   toDateOnlyString     <-> ::date
 *   validateTimeZone     <-> COALESCE(NULLIF(v_tz,'')) + the exception probe
 *   safeCutoffHour       <-> COALESCE(v_hour, 0) + the CHECK constraint
 *
 * ORDER IS LOAD-BEARING: convert first, then subtract. The other order
 * subtracts elapsed rather than wall-clock time and disagrees by a full
 * calendar day inside the fall-back repeated hour. Design doc section 4.1.
 */
export function toBusinessDay(
  instant: Date | string,
  tz: string | null | undefined,
  cutoffHour: number | null | undefined,
): string {
  const asDate = typeof instant === 'string' ? new Date(instant) : instant;
  const zoned = toZonedTime(asDate, validateTimeZone(tz));
  zoned.setHours(zoned.getHours() - safeCutoffHour(cutoffHour));
  return toDateOnlyString(zoned);
}

/** Config-object form of {@link toBusinessDay}, for threaded call sites. */
export function toBusinessDayFor(instant: Date | string, cfg: BusinessDayConfig): string {
  return toBusinessDay(instant, cfg.tz, cfg.cutoffHour);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/unit/businessDay.test.ts
```

Expected: PASS, all cases green.

- [ ] **Step 5: Regenerate types and widen the `Restaurant` interface**

```bash
npx supabase gen types typescript --local > src/integrations/supabase/types.ts
```

Then in `src/hooks/useRestaurants.tsx`, add the field to `Restaurant` beside `timezone?: string` (`:14`):

```ts
  timezone?: string;
  /** Hour (0-11, restaurant-local) at which the business day starts. 0 == calendar day. */
  business_day_start_hour?: number;
```

`useRestaurants` selects `restaurant:restaurants(*)` (`:67-70`), so the column reaches `selectedRestaurant.restaurant.business_day_start_hour` with no query change.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck && npx vitest run tests/unit/businessDay.test.ts
```

Expected: no type errors, tests green.

```bash
git add src/lib/businessDay.ts tests/unit/businessDay.test.ts tests/unit/fixtures/businessDayFixtures.ts src/hooks/useRestaurants.tsx src/integrations/supabase/types.ts
git commit -m "feat(lib): toBusinessDay helper mirroring the SQL business_day()"
```

---

### Task 3: Golden master — capture BEFORE any consumer change

**Files:**
- Create: `tests/unit/laborCalculations-goldenMaster.test.ts`

**Interfaces:**
- Consumes: `calculateActualLaborCost`, `calculateHoursPerEmployee`, `calculateActualLaborCostForMonth` from `src/services/laborCalculations.ts`; `calculateEmployeePay` from `src/utils/payrollCalculations.ts` — all at their **current** signatures.
- Produces: `tests/unit/__snapshots__/laborCalculations-goldenMaster.test.ts.snap`, the before-image every later task is measured against.

**Why this task is third and not last.** The frame repair (design §3.2) legitimately changes output at `cutoff = 0` whenever the browser zone differs from the restaurant zone. A golden master captured *after* the change proves nothing. This task must land while the code still behaves the old way.

- [ ] **Step 1: Write the golden-master test**

Create `tests/unit/laborCalculations-goldenMaster.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  calculateActualLaborCost,
  calculateHoursPerEmployee,
} from '@/services/laborCalculations';
import { calculateEmployeePay } from '@/utils/payrollCalculations';
import type { Employee, TimePunch } from '@/services/laborCalculations';

/**
 * GOLDEN MASTER -- captured before the business-day cutoff change.
 *
 * These snapshots pin the CURRENT output of the labor and payroll calculators.
 * After the cutoff work lands, every one of them must still match when the
 * restaurant zone equals the process zone and cutoff is 0 -- that isolates the
 * cutoff change from the frame repair.
 *
 * A snapshot that legitimately changes gets an entry in ALLOWED_DIFFS below,
 * with a hand-computed expected value and a one-line reason. A golden master
 * with a long allowlist is not a golden master -- if this list grows past a
 * handful of entries, stop and re-read design section 3.
 */

const RESTAURANT_TZ = 'America/Chicago';

function hourly(id: string, rateCents: number): Employee {
  return {
    id,
    restaurant_id: 'r1',
    name: `Employee ${id}`,
    status: 'active',
    compensation_type: 'hourly',
    hourly_rate: rateCents,
    is_exempt: false,
  } as Employee;
}

function dailyRate(id: string, rateCents: number): Employee {
  return {
    id,
    restaurant_id: 'r1',
    name: `Employee ${id}`,
    status: 'active',
    compensation_type: 'daily_rate',
    daily_rate: rateCents,
    is_exempt: false,
  } as Employee;
}

function punch(employeeId: string, type: string, iso: string): TimePunch {
  return {
    id: `${employeeId}-${type}-${iso}`,
    employee_id: employeeId,
    restaurant_id: 'r1',
    punch_type: type,
    punch_time: iso,
  } as TimePunch;
}

// A 6 PM -> 3 AM overnight shift (the reported symptom), a same-day shift, and
// a 1 AM -> 7 AM shift that a 2 AM cutoff will reassign.
const OVERNIGHT = [
  punch('e1', 'clock_in', '2026-07-28T23:00:00.000Z'),  // 18:00 CDT Jul 28
  punch('e1', 'clock_out', '2026-07-29T08:00:00.000Z'), // 03:00 CDT Jul 29
];
const SAME_DAY = [
  punch('e2', 'clock_in', '2026-07-29T15:00:00.000Z'),  // 10:00 CDT
  punch('e2', 'clock_out', '2026-07-29T23:00:00.000Z'), // 18:00 CDT
];
const POST_MIDNIGHT = [
  punch('e3', 'clock_in', '2026-07-29T06:00:00.000Z'),  // 01:00 CDT Jul 29
  punch('e3', 'clock_out', '2026-07-29T12:00:00.000Z'), // 07:00 CDT Jul 29
];
const DAILY_RATE_OVERNIGHT = [
  punch('e4', 'clock_in', '2026-07-28T23:00:00.000Z'),
  punch('e4', 'clock_out', '2026-07-29T08:00:00.000Z'),
];

const EMPLOYEES = [
  hourly('e1', 2000),
  hourly('e2', 2500),
  hourly('e3', 1800),
  dailyRate('e4', 15000),
];
const ALL_PUNCHES = [...OVERNIGHT, ...SAME_DAY, ...POST_MIDNIGHT, ...DAILY_RATE_OVERNIGHT];

const FROM = new Date('2026-07-27T00:00:00.000Z');
const TO = new Date('2026-07-31T23:59:59.999Z');

describe('golden master: calculateActualLaborCost', () => {
  it('matches the pre-change snapshot', () => {
    const result = calculateActualLaborCost(EMPLOYEES, ALL_PUNCHES, FROM, TO);
    expect(result).toMatchSnapshot();
  });
});

describe('golden master: calculateHoursPerEmployee', () => {
  it('matches the pre-change snapshot', () => {
    const result = calculateHoursPerEmployee(EMPLOYEES, ALL_PUNCHES, FROM, TO);
    expect(result).toMatchSnapshot();
  });
});

describe('golden master: calculateEmployeePay', () => {
  it.each([
    ['hourly overnight', hourly('e1', 2000), OVERNIGHT],
    ['hourly same-day', hourly('e2', 2500), SAME_DAY],
    ['hourly post-midnight', hourly('e3', 1800), POST_MIDNIGHT],
    ['daily_rate overnight', dailyRate('e4', 15000), DAILY_RATE_OVERNIGHT],
  ])('matches the pre-change snapshot: %s', (_label, employee, punches) => {
    const result = calculateEmployeePay(employee, punches, 0, FROM, TO, [], 0, undefined, [], true);
    expect(result).toMatchSnapshot();
  });
});

/**
 * Deliberately-changed cases. EMPTY at capture time; each later task that
 * legitimately moves a number adds one entry here with a hand-computed value.
 */
export const ALLOWED_DIFFS: Array<{ snapshot: string; reason: string; expected: string }> = [];

describe('golden master allowlist', () => {
  it('stays short -- a long allowlist means the change is not understood', () => {
    expect(ALLOWED_DIFFS.length).toBeLessThanOrEqual(6);
  });
});
```

- [ ] **Step 2: Capture the snapshot under the restaurant's own zone**

```bash
TZ=America/Chicago npx vitest run tests/unit/laborCalculations-goldenMaster.test.ts
```

Expected: PASS, with vitest reporting written snapshots (`4 snapshots written` or similar). This is the baseline where browser zone == restaurant zone.

- [ ] **Step 3: Confirm the frame bug is visible — capture under UTC too**

```bash
TZ=UTC npx vitest run tests/unit/laborCalculations-goldenMaster.test.ts
```

Expected: **FAIL** on at least the overnight and post-midnight cases, because today's bucketing is browser-local and the day keys differ between `America/Chicago` and `UTC`.

This failure is the point: it is design §3.2's live defect, reproduced. Record the observed differing day keys in the commit message — they become the hand-computed allowlist entries later.

Do **not** commit a UTC snapshot file. Delete any snapshot vitest wrote under UTC before committing:

```bash
git status --short tests/unit/__snapshots__/
```

Ensure only the `America/Chicago` snapshot is staged, then re-verify:

```bash
TZ=America/Chicago npx vitest run tests/unit/laborCalculations-goldenMaster.test.ts
```

Expected: PASS with `snapshots passed`, none written.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/laborCalculations-goldenMaster.test.ts tests/unit/__snapshots__/laborCalculations-goldenMaster.test.ts.snap
git commit -m "test(labor): golden master captured before the business-day cutoff change"
```

---

### Task 4: Rename the misnamed `formatDateUTC`

**Files:**
- Modify: `src/services/laborCalculations.ts:43-48` and all seven call sites (`:68`, `:405`, `:557`, `:581`, `:726`, `:733`, `:945`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `formatLocalDate(date: Date): string` — module-private, replacing `formatDateUTC`.

**Why separate.** `formatDateUTC` reads `getFullYear`/`getMonth`/`getDate` — browser-**local** fields. Its name asserts the opposite of what it does, which is how the frame bug survived review. Renaming it alone, with zero behavior change, keeps the next tasks' diffs about bucketing rather than about identifiers.

- [ ] **Step 1: Rename the function and its comment**

In `src/services/laborCalculations.ts`, replace the definition at `:43-48`:

```ts
/**
 * Format a Date as YYYY-MM-DD using LOCAL fields.
 *
 * Named for what it does. The previous name (formatDateUTC) asserted the
 * opposite and is how the browser-frame bucketing bug survived review.
 * Correct for cursor-walking an already-bucketed day range (generateDateRange);
 * NOT correct for deriving a business day from an instant -- use
 * toBusinessDayFor from @/lib/businessDay for that.
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

- [ ] **Step 2: Update every call site**

```bash
grep -n "formatDateUTC" src/services/laborCalculations.ts
```

Expected: seven call sites at `:68`, `:405`, `:557`, `:581`, `:726`, `:733`, `:945`. Replace each `formatDateUTC(` with `formatLocalDate(`.

- [ ] **Step 3: Verify nothing else referenced it**

```bash
grep -rn "formatDateUTC" src/ tests/
```

Expected: no output. It was module-private; if a test imported it, update that too.

- [ ] **Step 4: Run the full unit suite and the golden master**

```bash
npm run typecheck && TZ=America/Chicago npx vitest run tests/unit/laborCalculations-goldenMaster.test.ts && npx vitest run
```

Expected: typecheck clean, golden master `snapshots passed` with **none written** (proves the rename changed no behavior), full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/services/laborCalculations.ts
git commit -m "refactor(labor): rename formatDateUTC to formatLocalDate -- it reads local fields"
```

---

### Task 5: Reroute `calculateActualLaborCost`

**Files:**
- Modify: `src/services/laborCalculations.ts` (`calculateActualLaborCost`, ~`:497`; the bucketing at `:557` and the day-span loop at `:565-589`)
- Modify: `src/hooks/useLaborCostsFromTimeTracking.tsx` (`:74` query key, `:134` call)
- Create: `tests/unit/payroll-business-day-conservation.test.ts`

**Interfaces:**
- Consumes: `toBusinessDayFor`, `BusinessDayConfig` from `src/lib/businessDay.ts`.
- Produces: `calculateActualLaborCost(employees, timePunches, startDate, endDate, businessDay: BusinessDayConfig)` — a fifth **required** parameter.

**Why required, not optional with a default.** An optional `BusinessDayConfig` would silently default some call site to UTC/0 and reintroduce a third framing. A required parameter makes every caller declare its frame, which is exactly what CI's UTC hides.

- [ ] **Step 1: Write the failing conservation test**

Create `tests/unit/payroll-business-day-conservation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { calculateActualLaborCost } from '@/services/laborCalculations';
import { parseWorkPeriods } from '@/utils/payrollCalculations';
import type { Employee, TimePunch } from '@/services/laborCalculations';

/**
 * THE structural guarantee against under/overpayment.
 *
 * Bucketing may move hours between business days. It may never create or
 * destroy an hour. If this test is ever relaxed, the feature is unsafe --
 * per the requirement "we can't be under/over paying people with this change".
 */

const TZ = 'America/Chicago';

function hourly(id: string, rateCents: number): Employee {
  return {
    id, restaurant_id: 'r1', name: id, status: 'active',
    compensation_type: 'hourly', hourly_rate: rateCents, is_exempt: false,
  } as Employee;
}

function dailyRate(id: string, rateCents: number): Employee {
  return {
    id, restaurant_id: 'r1', name: id, status: 'active',
    compensation_type: 'daily_rate', daily_rate: rateCents, is_exempt: false,
  } as Employee;
}

function pair(employeeId: string, inIso: string, outIso: string): TimePunch[] {
  return [
    { id: `${employeeId}-in-${inIso}`, employee_id: employeeId, restaurant_id: 'r1',
      punch_type: 'clock_in', punch_time: inIso } as TimePunch,
    { id: `${employeeId}-out-${outIso}`, employee_id: employeeId, restaurant_id: 'r1',
      punch_type: 'clock_out', punch_time: outIso } as TimePunch,
  ];
}

// 18:00 -> 03:00 (overnight), 01:00 -> 07:00 (post-midnight), 10:00 -> 18:00.
const PUNCHES = [
  ...pair('e1', '2026-07-28T23:00:00.000Z', '2026-07-29T08:00:00.000Z'),
  ...pair('e1', '2026-07-30T06:00:00.000Z', '2026-07-30T12:00:00.000Z'),
  ...pair('e1', '2026-07-31T15:00:00.000Z', '2026-07-31T23:00:00.000Z'),
];
const FROM = new Date('2026-07-26T00:00:00.000Z');
const TO = new Date('2026-08-02T23:59:59.999Z');

describe('conservation invariant: hours are never created or destroyed', () => {
  const expectedTotal = parseWorkPeriods(PUNCHES).periods
    .filter((p) => !p.isBreak)
    .reduce((sum, p) => sum + p.hours, 0);

  const cutoffs = Array.from({ length: 12 }, (_, h) => h);

  it.each(cutoffs)('cutoff %i conserves total hours', (cutoffHour) => {
    const { dailyCosts } = calculateActualLaborCost(
      [hourly('e1', 2000)], PUNCHES, FROM, TO, { tz: TZ, cutoffHour },
    );
    const bucketed = dailyCosts.reduce((sum, d) => sum + d.hours_worked, 0);
    expect(bucketed).toBeCloseTo(expectedTotal, 6);
  });
});

describe('conservation invariant: daily_rate charges N rates for N shifts', () => {
  const cutoffs = Array.from({ length: 12 }, (_, h) => h);
  const DAILY_RATE_CENTS = 15000;
  const SHIFT_COUNT = 3;

  it.each(cutoffs)('cutoff %i charges exactly 3 daily rates', (cutoffHour) => {
    const { dailyCosts } = calculateActualLaborCost(
      [dailyRate('e4', DAILY_RATE_CENTS)],
      PUNCHES.map((p) => ({ ...p, employee_id: 'e4' })),
      FROM, TO, { tz: TZ, cutoffHour },
    );
    const total = dailyCosts.reduce((sum, d) => sum + d.daily_rate_cost, 0);
    // Three shifts -> three daily rates. Never 2N (the overnight double-charge).
    expect(total).toBeCloseTo((DAILY_RATE_CENTS / 100) * SHIFT_COUNT, 2);
  });
});

describe('the reported symptom: an overnight shift lands on its clock-in day', () => {
  it('attributes a 6 PM -> 3 AM shift wholly to the clock-in business day', () => {
    const { dailyCosts } = calculateActualLaborCost(
      [hourly('e1', 2000)],
      pair('e1', '2026-07-28T23:00:00.000Z', '2026-07-29T08:00:00.000Z'),
      FROM, TO, { tz: TZ, cutoffHour: 2 },
    );
    const jul28 = dailyCosts.find((d) => d.date === '2026-07-28');
    const jul29 = dailyCosts.find((d) => d.date === '2026-07-29');
    expect(jul28?.hours_worked).toBeCloseTo(9, 6);
    expect(jul29?.hours_worked ?? 0).toBe(0);
  });

  it('rolls a 1 AM clock-in back to the previous business day at cutoff 2', () => {
    const { dailyCosts } = calculateActualLaborCost(
      [hourly('e1', 2000)],
      pair('e1', '2026-07-30T06:00:00.000Z', '2026-07-30T12:00:00.000Z'),
      FROM, TO, { tz: TZ, cutoffHour: 2 },
    );
    expect(dailyCosts.find((d) => d.date === '2026-07-29')?.hours_worked).toBeCloseTo(6, 6);
    expect(dailyCosts.find((d) => d.date === '2026-07-30')?.hours_worked ?? 0).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/payroll-business-day-conservation.test.ts
```

Expected: FAIL — `calculateActualLaborCost` takes 4 arguments, and the daily_rate case reports 4 rates (two for the overnight shift) rather than 3.

- [ ] **Step 3: Widen the signature and reroute the bucketing**

In `src/services/laborCalculations.ts`, add the import:

```ts
import { toBusinessDayFor, type BusinessDayConfig } from '@/lib/businessDay';
```

Add the fifth parameter to `calculateActualLaborCost`:

```ts
export function calculateActualLaborCost(
  employees: Employee[],
  timePunches: TimePunch[],
  startDate: Date,
  endDate: Date,
  businessDay: BusinessDayConfig,
): { breakdown: LaborCostBreakdown; dailyCosts: DailyLaborCost[] } {
```

Replace the bucketing at `:557` and the day-span loop at `:563-589` with a single business day:

```ts
      // Attribute the whole period to the business day of its clock-in, in the
      // RESTAURANT's zone. period.clockIn (not startTime) is the shift's first
      // clock_in -- handleBreakEnd advances startTime past a break end, which
      // for a break-after-midnight shift is the next day.
      const workDate = toBusinessDayFor(period.clockIn ?? period.startTime, businessDay);
      const hoursWorked = period.hours;

      employeeHours.set(workDate, (employeeHours.get(workDate) || 0) + hoursWorked);

      // ONE business day per period, not every calendar day the period spans.
      // The old day-spanning loop is what charged a daily_rate employee two
      // full rates for one overnight shift (design section 3.3). A shift is
      // never split, so it is active on exactly one business day.
      if (!employeesActivePerDay.has(workDate)) {
        employeesActivePerDay.set(workDate, new Set());
      }
      employeesActivePerDay.get(workDate)?.add(employeeId);
```

- [ ] **Step 4: Update the hook**

In `src/hooks/useLaborCostsFromTimeTracking.tsx`, source the config from context and put it in the query key. Add near the top of the hook body:

```ts
  const { selectedRestaurant } = useRestaurantContext();
  const businessDay: BusinessDayConfig = {
    tz: selectedRestaurant?.restaurant?.timezone,
    cutoffHour: selectedRestaurant?.restaurant?.business_day_start_hour,
  };
```

Extend the query key at `:74` — without this, a cutoff change serves stale bucketing for up to the 30s `staleTime`:

```ts
    queryKey: ['labor-costs-from-time-tracking', restaurantId, format(dateFrom, 'yyyy-MM-dd'), format(dateTo, 'yyyy-MM-dd'), throughNow, businessDay.tz, businessDay.cutoffHour],
```

And the call at `:134`:

```ts
      const { dailyCosts: laborDailyCosts } = calculateActualLaborCost(
        employees,
        punchesForCost,
        dateFrom,
        dateTo,
        businessDay,
      );
```

Add the imports (`useRestaurantContext` from `@/contexts/RestaurantContext`, `BusinessDayConfig` from `@/lib/businessDay`) in CLAUDE.md import order.

- [ ] **Step 5: Migrate existing test call sites to the legacy frame**

```bash
grep -rn "calculateActualLaborCost(" tests/ src/ | grep -v "export function"
```

For each test call site, add `LEGACY_UTC_FRAME` as the fifth argument and import it:

```ts
import { LEGACY_UTC_FRAME } from './fixtures/businessDayFixtures';
// ...
calculateActualLaborCost(employees, punches, from, to, LEGACY_UTC_FRAME)
```

- [ ] **Step 6: Run the tests**

```bash
npm run typecheck && npx vitest run tests/unit/payroll-business-day-conservation.test.ts && npx vitest run
```

Expected: typecheck clean; the conservation suite green; the full suite green **except** the golden master, which now differs on the daily_rate overnight case.

- [ ] **Step 7: Record the golden-master diff in the allowlist**

The daily_rate double-charge fix is a deliberate change. Add to `ALLOWED_DIFFS` in `tests/unit/laborCalculations-goldenMaster.test.ts`:

```ts
export const ALLOWED_DIFFS: Array<{ snapshot: string; reason: string; expected: string }> = [
  {
    snapshot: 'golden master: calculateActualLaborCost > matches the pre-change snapshot',
    reason:
      'daily_rate employee e4 worked ONE overnight shift (18:00 Jul 28 -> 03:00 Jul 29). ' +
      'The old day-spanning loop charged a full daily rate on both Jul 28 and Jul 29. ' +
      'Design section 3.3.',
    expected: 'daily_rate_cost totals $150.00 across the range, not $300.00',
  },
];
```

Then update the snapshot deliberately, under the restaurant's own zone:

```bash
TZ=America/Chicago npx vitest run tests/unit/laborCalculations-goldenMaster.test.ts -u
```

Inspect the diff before accepting it: `git diff tests/unit/__snapshots__/`. The only changes must be `daily_rate_cost` and `total_cost` on `2026-07-29`. If an hours figure moved, stop — the conservation invariant is being violated.

- [ ] **Step 8: Commit**

```bash
git add src/services/laborCalculations.ts src/hooks/useLaborCostsFromTimeTracking.tsx tests/
git commit -m "fix(labor): bucket actual labor cost by restaurant business day, one day per shift"
```

---

### Task 6: Reroute `calculateHoursPerEmployee`

**Files:**
- Modify: `src/services/laborCalculations.ts` (`calculateHoursPerEmployee` at `:692`; bucketing at `:726`, day-span loop at `:730-735`, comment at `:713-717`)

**Interfaces:**
- Consumes: `toBusinessDayFor`, `BusinessDayConfig`.
- Produces: `calculateHoursPerEmployee(employees, timePunches, startDate, endDate, businessDay: BusinessDayConfig)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/payroll-business-day-conservation.test.ts`:

```ts
import { calculateHoursPerEmployee } from '@/services/laborCalculations';

describe('calculateHoursPerEmployee agrees with calculateActualLaborCost', () => {
  const cutoffs = Array.from({ length: 12 }, (_, h) => h);

  it.each(cutoffs)('cutoff %i: daysWorked counts shifts, not spanned days', (cutoffHour) => {
    const [summary] = calculateHoursPerEmployee(
      [dailyRate('e4', 15000)],
      PUNCHES.map((p) => ({ ...p, employee_id: 'e4' })),
      FROM, TO, { tz: TZ, cutoffHour },
    );
    // Three shifts, one of them overnight. Three days worked, never four.
    expect(summary.daysWorked).toBe(3);
  });

  it.each(cutoffs)('cutoff %i: total hours match parseWorkPeriods', (cutoffHour) => {
    const expected = parseWorkPeriods(PUNCHES).periods
      .filter((p) => !p.isBreak)
      .reduce((sum, p) => sum + p.hours, 0);
    const [summary] = calculateHoursPerEmployee(
      [hourly('e1', 2000)], PUNCHES, FROM, TO, { tz: TZ, cutoffHour },
    );
    expect(summary.totalHours).toBeCloseTo(expected, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/payroll-business-day-conservation.test.ts
```

Expected: FAIL — 5 arguments vs 4, and `daysWorked` is 4 because `activeDays` spans both calendar days of the overnight shift.

- [ ] **Step 3: Reroute**

Replace the block at `:713-736`:

```ts
    // Both hoursPerDay and activeDays are keyed by the BUSINESS day of the
    // period's clock-in, in the restaurant's zone. Previously activeDays spanned
    // every calendar day a period touched, so an overnight period was charged a
    // daily_rate for both days -- design section 3.3. A shift is never split, so
    // it contributes exactly one active day.
    const hoursPerDay: Record<string, number> = {};
    const activeDays = new Set<string>();
    let totalHours = 0;

    periods.forEach((period) => {
      if (period.isBreak) return;
      const day = toBusinessDayFor(period.clockIn ?? period.startTime, businessDay);
      hoursPerDay[day] = (hoursPerDay[day] ?? 0) + period.hours;
      totalHours += period.hours;
      activeDays.add(day);
    });
```

Add the parameter to the signature at `:692-697`:

```ts
export function calculateHoursPerEmployee(
  employees: Employee[],
  timePunches: TimePunch[],
  startDate: Date,
  endDate: Date,
  businessDay: BusinessDayConfig,
): EmployeeHoursSummary[] {
```

- [ ] **Step 4: Migrate call sites and run**

```bash
grep -rn "calculateHoursPerEmployee(" src/ tests/ | grep -v "export function"
```

Add `businessDay` at production call sites (sourced as in Task 5) and `LEGACY_UTC_FRAME` at test call sites.

```bash
npm run typecheck && npx vitest run
```

Expected: typecheck clean, full suite green. The golden master's `calculateHoursPerEmployee` snapshot changes for the same daily_rate reason — add a second `ALLOWED_DIFFS` entry naming that snapshot, then `-u` and inspect the diff as in Task 5 Step 7.

- [ ] **Step 5: Commit**

```bash
git add src/services/laborCalculations.ts tests/
git commit -m "fix(labor): calculateHoursPerEmployee counts business days, not spanned days"
```

---

### Task 7: Reroute `calculateActualLaborCostForMonth`

**Files:**
- Modify: `src/services/laborCalculations.ts` (`calculateActualLaborCostForMonth` at `:871`, `MonthlyLaborInput`, the bucketing at `:945`, the two `calculateEmployeePay` calls at `:884` and `:926`)
- Modify: `src/hooks/useMonthlyMetrics.tsx` (`:153` query key, `:523` call)

**Interfaces:**
- Consumes: `toBusinessDayFor`, `BusinessDayConfig`.
- Produces: `MonthlyLaborInput` gains `businessDay: BusinessDayConfig`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/payroll-business-day-conservation.test.ts`:

```ts
import { calculateActualLaborCostForMonth } from '@/services/laborCalculations';

describe('calculateActualLaborCostForMonth conserves wages across cutoffs', () => {
  const cutoffs = Array.from({ length: 12 }, (_, h) => h);

  it.each(cutoffs)('cutoff %i yields the same monthly wage total', (cutoffHour) => {
    const { actualLaborCents } = calculateActualLaborCostForMonth({
      employees: [hourly('e1', 2000)],
      timePunches: PUNCHES,
      tipsOwedByEmployee: new Map(),
      monthStart: new Date('2026-07-01T00:00:00.000Z'),
      monthEnd: new Date('2026-07-31T23:59:59.999Z'),
      businessDay: { tz: TZ, cutoffHour },
    });
    // All three shifts clock in within July in America/Chicago at every cutoff
    // in 0..11, so the monthly total is cutoff-invariant. 23h at $20/h.
    expect(actualLaborCents).toBe(46000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/payroll-business-day-conservation.test.ts
```

Expected: FAIL — `businessDay` is not a property of `MonthlyLaborInput`.

- [ ] **Step 3: Reroute**

Add to the `MonthlyLaborInput` interface:

```ts
  /** The restaurant's business-day framing. Required -- see design section 7. */
  businessDay: BusinessDayConfig;
```

Destructure it at `:874` and replace the bucketing at `:945`:

```ts
        const dateKey = toBusinessDayFor(period.clockIn ?? period.startTime, businessDay);
```

Pass it to both `calculateEmployeePay` calls (`:884`, `:926`) once Task 10 widens that signature. Until then, leave those calls unchanged and add a `// TODO(task-10)` marker — Task 10 removes it.

- [ ] **Step 4: Update the hook**

In `src/hooks/useMonthlyMetrics.tsx`, source `businessDay` from `useRestaurantContext()` as in Task 5, add `businessDay.tz` and `businessDay.cutoffHour` to the query key at `:153`, and pass `businessDay` in the object at `:523`.

- [ ] **Step 5: Run and commit**

```bash
npm run typecheck && npx vitest run
```

Expected: typecheck clean, full suite green.

```bash
git add src/services/laborCalculations.ts src/hooks/useMonthlyMetrics.tsx tests/
git commit -m "fix(labor): monthly labor cost buckets by restaurant business day"
```

---

### Task 8: Widen `useScheduledLaborCosts` so it can see tz and cutoff

**Files:**
- Modify: `src/hooks/useScheduledLaborCosts.tsx` (`:56-61` signature, `:119` `useMemo` deps)
- Modify: `src/pages/Scheduling.tsx:350` (the only caller)

**Interfaces:**
- Consumes: `BusinessDayConfig`.
- Produces: `useScheduledLaborCosts(shifts, dateFrom, dateTo, restaurantId)` — unchanged externally; the hook sources `businessDay` from context internally.

**Why this task exists and why it precedes Task 9.** The hook memoizes with `useMemo`, not React Query (`:66-119`). There is no `staleTime` to eventually rescue a stale value — a cutoff change would serve stale bucketing **indefinitely**. And the hook cannot reach the restaurant's tz or cutoff through its current signature at all, so Task 9's reroute of `calculateScheduledLaborCost` is not implementable until this lands (design §10).

Sourcing from context rather than widening the public signature keeps `Scheduling.tsx` untouched and avoids threading two values through a page that has no other use for them.

- [ ] **Step 1: Source the config and add it to the dep array**

In `src/hooks/useScheduledLaborCosts.tsx`, inside the hook body before the `useMemo`:

```ts
  const { selectedRestaurant } = useRestaurantContext();
  const tz = selectedRestaurant?.restaurant?.timezone;
  const cutoffHour = selectedRestaurant?.restaurant?.business_day_start_hour;
```

Then the dep array at `:119` — note `tz` and `cutoffHour` are listed as **primitives**, not as a freshly-constructed object, which would be a new reference every render and defeat the memo:

```ts
  }, [shifts, dateFrom, dateTo, restaurantId, employees, tz, cutoffHour]);
```

- [ ] **Step 2: Verify the memo still memoizes**

Add to `tests/unit/useScheduledLaborCosts.test.tsx` (create if absent):

```ts
it('recomputes when the cutoff changes and not otherwise', () => {
  // Guard: tz/cutoffHour must be primitives in the dep array. Passing a
  // constructed { tz, cutoffHour } object would make this memo recompute every
  // render -- and, worse, an omitted dep would serve stale bucketing forever,
  // since a useMemo has no staleTime to rescue it.
  const source = readFileSync('src/hooks/useScheduledLaborCosts.tsx', 'utf8');
  expect(source).toMatch(/}, \[[^\]]*\btz\b[^\]]*\bcutoffHour\b[^\]]*\]\)/);
});
```

- [ ] **Step 3: Run and commit**

```bash
npm run typecheck && npx vitest run tests/unit/useScheduledLaborCosts.test.tsx
```

Expected: typecheck clean, test green.

```bash
git add src/hooks/useScheduledLaborCosts.tsx tests/unit/useScheduledLaborCosts.test.tsx
git commit -m "refactor(scheduling): give useScheduledLaborCosts access to tz and cutoff"
```

---

### Task 9: Reroute `calculateScheduledLaborCost`

**Files:**
- Modify: `src/services/laborCalculations.ts` (`calculateScheduledLaborCost` at `:371`, bucketing at `:405`)
- Modify: `src/hooks/useScheduledLaborCosts.tsx:83`

**Interfaces:**
- Produces: `calculateScheduledLaborCost(shifts, employees, startDate, endDate, businessDay: BusinessDayConfig)`.

**Why scheduled must match actual.** The Scheduling page shows scheduled-vs-actual variance. If actual buckets by business day and scheduled by calendar day, the variance view compares two different framings and every overnight shift shows a phantom variance.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/payroll-business-day-conservation.test.ts`:

```ts
import { calculateScheduledLaborCost } from '@/services/laborCalculations';

describe('scheduled and actual bucket identically', () => {
  it('an overnight scheduled shift lands on its start business day', () => {
    const shifts = [{
      id: 's1', restaurant_id: 'r1', employee_id: 'e1',
      start_time: '2026-07-28T23:00:00.000Z',  // 18:00 CDT Jul 28
      end_time: '2026-07-29T08:00:00.000Z',    // 03:00 CDT Jul 29
      status: 'scheduled',
    }] as any[];

    const { dailyCosts } = calculateScheduledLaborCost(
      shifts, [hourly('e1', 2000)], FROM, TO, { tz: TZ, cutoffHour: 2 },
    );
    expect(dailyCosts.find((d) => d.date === '2026-07-28')?.hours_worked).toBeCloseTo(9, 6);
    expect(dailyCosts.find((d) => d.date === '2026-07-29')?.hours_worked ?? 0).toBe(0);
  });

  it('a 1 AM scheduled start rolls back at cutoff 2', () => {
    const shifts = [{
      id: 's2', restaurant_id: 'r1', employee_id: 'e1',
      start_time: '2026-07-30T06:00:00.000Z',  // 01:00 CDT Jul 30
      end_time: '2026-07-30T12:00:00.000Z',
      status: 'scheduled',
    }] as any[];

    const { dailyCosts } = calculateScheduledLaborCost(
      shifts, [hourly('e1', 2000)], FROM, TO, { tz: TZ, cutoffHour: 2 },
    );
    expect(dailyCosts.find((d) => d.date === '2026-07-29')?.hours_worked).toBeCloseTo(6, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/payroll-business-day-conservation.test.ts
```

Expected: FAIL — 5 arguments vs 4.

- [ ] **Step 3: Reroute**

Add the parameter to the signature at `:371-376`, then replace `:405`:

```ts
    // Bucket by the restaurant's business day, matching calculateActualLaborCost.
    // If these two disagree, the Scheduling variance view compares two framings
    // and every overnight shift shows a phantom variance.
    const shiftDate = toBusinessDayFor(shift.start_time, businessDay);
```

- [ ] **Step 4: Update the hook call and run**

`src/hooks/useScheduledLaborCosts.tsx:83`:

```ts
      calculateScheduledLaborCost(shifts, employees, dateFrom, dateTo, { tz, cutoffHour });
```

```bash
npm run typecheck && npx vitest run
```

Expected: typecheck clean, full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/services/laborCalculations.ts src/hooks/useScheduledLaborCosts.tsx tests/
git commit -m "fix(labor): scheduled labor cost buckets by business day, matching actual"
```

---

### Task 10: Reroute `payrollCalculations` — OT banding and `daily_rate`

**Files:**
- Modify: `src/utils/payrollCalculations.ts` (`calculateEmployeePay` signature at `:439-457`, OT banding at `:492`, `daily_rate` at `:553-569`, `calculatePayrollPeriod` at `:661-678`)
- Modify: `src/hooks/usePayroll.tsx` (`:119` query key, `:313` call)
- Modify: `src/services/laborCalculations.ts:884,926` (remove the Task 7 TODO markers)
- Modify: ~50 existing test call sites across 7 files

**Interfaces:**
- Produces: `calculateEmployeePay(..., attributeToWindow, businessDay: BusinessDayConfig)` as the **12th** parameter; `calculatePayrollPeriod(..., overtimeAdjustments, businessDay: BusinessDayConfig)` as the 10th.

**This is the task that moves money.** `:492` bands both daily and weekly OT. Moving a business day can move a shift between ISO weeks and across the 40h band — `memory/lessons.md` 2026-05-03 records a $2,246 PT-vs-UTC swing from exactly this. Two of the 54 overnight shifts in prod clock in on Sunday, and `WEEK_STARTS_ON = 1` (`src/lib/dateConfig.ts:8`), so those are the week-boundary crossings.

**On the ~50 test call sites.** They migrate to `LEGACY_UTC_FRAME`, which under CI's `TZ=UTC` reproduces their current behavior exactly, so **no existing expectation changes**. If any existing test's expectation does change, stop: either the migration is wrong or that test was asserting the bug.

- [ ] **Step 1: Write the failing dollars test**

Create the dollars section in `tests/unit/payroll-business-day-conservation.test.ts`:

```ts
import { calculateEmployeePay } from '@/utils/payrollCalculations';

/**
 * Dollars, not just hours (design section 11.4). Hours conservation does not
 * imply dollar conservation: moving a shift across a week boundary moves hours
 * between OT bands, and OT hours cost 1.5x.
 */
describe('dollars across overtime configurations', () => {
  const OT_CONFIGS = [
    ['no rules', undefined],
    ['weekly only (current prod config)', { weekly_threshold_hours: 40, weekly_multiplier: 1.5 }],
    ['weekly + daily', { weekly_threshold_hours: 40, weekly_multiplier: 1.5, daily_threshold_hours: 8, daily_multiplier: 1.5 }],
    ['weekly + daily + double time', { weekly_threshold_hours: 40, weekly_multiplier: 1.5, daily_threshold_hours: 8, daily_multiplier: 1.5, double_time_threshold_hours: 12, double_time_multiplier: 2 }],
  ] as const;

  // A Sunday clock-in that a 2 AM cutoff moves into the PREVIOUS ISO week
  // (WEEK_STARTS_ON = 1, src/lib/dateConfig.ts:8). This is the week-boundary
  // crossing that actually moves money.
  const SUNDAY_OVERNIGHT = pair('e1', '2026-08-03T05:00:00.000Z', '2026-08-03T13:00:00.000Z');

  it.each(OT_CONFIGS)('%s: gross pay is fully accounted for', (_label, rules) => {
    const result = calculateEmployeePay(
      hourly('e1', 2000), SUNDAY_OVERNIGHT, 0,
      new Date('2026-07-27T00:00:00.000Z'), new Date('2026-08-09T23:59:59.999Z'),
      [], 0, rules as any, [], true,
      { tz: TZ, cutoffHour: 2 },
    );
    // Every dollar lands in exactly one band.
    expect(result.regularPay + result.overtimePay + result.doubleTimePay)
      .toBe(result.grossPay - (result.tips ?? 0));
    // 8h at $20 with no band exceeded.
    expect(result.regularHours + result.overtimeHours + result.doubleTimeHours)
      .toBeCloseTo(8, 6);
  });

  it('daily_rate counts distinct business days of work-period clock-ins', () => {
    const result = calculateEmployeePay(
      dailyRate('e4', 15000),
      PUNCHES.map((p) => ({ ...p, employee_id: 'e4' })), 0,
      FROM, TO, [], 0, undefined, [], true,
      { tz: TZ, cutoffHour: 2 },
    );
    // Three shifts, one overnight. Three daily rates, never four.
    expect(result.daysWorked).toBe(3);
    expect(result.dailyRatePay).toBe(45000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/payroll-business-day-conservation.test.ts
```

Expected: FAIL — 11 arguments accepted, 12 given; and `daysWorked` is 4 because the `daily_rate` branch counts raw punch dates (a clock-out after midnight is its own date).

- [ ] **Step 3: Widen the signature and reroute both sites**

Add the import and the parameter:

```ts
import { toBusinessDayFor, type BusinessDayConfig } from '@/lib/businessDay';
```

```ts
  attributeToWindow: boolean = false,
  // The restaurant's business-day framing. Required: an optional default would
  // silently pick a frame, and CI runs in UTC where that is invisible.
  businessDay: BusinessDayConfig = { tz: 'UTC', cutoffHour: 0 },
): EmployeePayroll {
```

Note: this one keeps a default, unlike the labor functions, purely because ~50 existing call sites pass only 3 arguments (`calculateEmployeePay(employee, [], 0)`) and cannot reach a 12th positional parameter. The default is `{ tz: 'UTC', cutoffHour: 0 }` — identical to `LEGACY_UTC_FRAME` — so those sites keep today's CI behavior. **Every production call site must pass it explicitly**; Step 6 asserts that.

Replace the OT banding at `:492`:

```ts
      // Band OT (and prorate tips) by the BUSINESS day of the shift's clock-in,
      // in the restaurant's zone. period.clockIn, not startTime: handleBreakEnd
      // advances startTime past a break end, which for a break-after-midnight
      // shift is the next day and possibly the next ISO week.
      const dateKey = toBusinessDayFor(period.clockIn, businessDay);
```

Replace the whole `daily_rate` branch at `:553-569`:

```ts
  } else if (compensationType === 'daily_rate' && periodStartDate && periodEndDate) {
    // Count distinct BUSINESS days on which a work period CLOCKED IN.
    //
    // Previously this counted distinct calendar dates of raw punches, so a
    // 6 PM -> 3 AM shift produced two dates (the clock-in date and the
    // clock-out date) and charged two full daily rates for one shift.
    // Design section 3.3. Going through parseWorkPeriods means one shift
    // contributes exactly one day, which is also what
    // calculateHoursPerEmployee now reports.
    const { periods } = parseWorkPeriods(punches);
    const uniqueDays = new Set<string>();

    for (const period of periods) {
      if (period.isBreak) continue;
      const day = toBusinessDayFor(period.clockIn ?? period.startTime, businessDay);
      // Clip to the pay period by comparing calendar-day tokens as strings --
      // lexicographic order on YYYY-MM-DD is chronological order, and this
      // avoids constructing a local-midnight Date (memory/lessons.md 2026-07-28).
      const from = toBusinessDayFor(periodStartDate, businessDay);
      const to = toBusinessDayFor(periodEndDate, businessDay);
      if (day >= from && day <= to) {
        uniqueDays.add(day);
      }
    }

    daysWorked = uniqueDays.size;
    dailyRatePay = calculateDailyRatePay(employee, daysWorked);
  }
```

- [ ] **Step 4: Thread through `calculatePayrollPeriod`**

Add a 10th parameter and pass it on at `:678`:

```ts
  overtimeAdjustments: OvertimeAdjustment[] = [],
  businessDay: BusinessDayConfig = { tz: 'UTC', cutoffHour: 0 },
): PayrollPeriod {
```

```ts
    return calculateEmployeePay(employee, punches, tips, startDate, endDate, manualPayments, tipsPaidOut, overtimeRules, overtimeAdjustments, true, businessDay);
```

- [ ] **Step 5: Update `usePayroll` and `calculateActualLaborCostForMonth`**

In `src/hooks/usePayroll.tsx`: source `businessDay` from `useRestaurantContext()`, add `businessDay.tz` / `businessDay.cutoffHour` to the query key at `:119`, and pass `businessDay` as the 10th argument at `:313`.

In `src/services/laborCalculations.ts`, pass `businessDay` to both `calculateEmployeePay` calls (`:884`, `:926`) and delete the `// TODO(task-10)` markers.

- [ ] **Step 6: Assert no production call site relies on the default**

Add to `tests/unit/payroll-business-day-conservation.test.ts`:

```ts
import { readFileSync } from 'node:fs';

it('no production call site relies on the UTC default frame', () => {
  // The default exists only so ~50 pre-existing 3-argument test call sites keep
  // compiling. Any production caller that omits it would silently bucket in UTC.
  for (const file of [
    'src/hooks/usePayroll.tsx',
    'src/services/laborCalculations.ts',
  ]) {
    const source = readFileSync(file, 'utf8');
    const calls = source.match(/calculate(EmployeePay|PayrollPeriod)\(/g) ?? [];
    for (const _ of calls) {
      expect(source).toMatch(/businessDay/);
    }
  }
});
```

- [ ] **Step 7: Migrate the ~50 existing test call sites**

```bash
grep -rln "calculateEmployeePay(\|calculatePayrollPeriod(" tests/
```

Expected files: `dashboard-payroll-consistency.test.ts`, `payrollCalculations.test.ts`, `compensation-edge-cases.test.ts`, `payrollCalculations-dailyRate.test.ts`, `payrollTipsAllCompTypes.test.ts`.

Three-argument calls (`calculateEmployeePay(employee, [], 0)`) need **no change** — the default matches. Only calls that already pass `attributeToWindow` explicitly gain a trailing `LEGACY_UTC_FRAME`, for explicitness rather than necessity.

- [ ] **Step 8: Run everything**

```bash
npm run typecheck && npx vitest run
```

Expected: typecheck clean, full suite green with **no changed expectations** in the pre-existing payroll suites. If `payrollCalculations-dailyRate.test.ts` fails, read the failure carefully: an expectation that asserted two daily rates for one overnight shift was asserting the bug and should change, with the change noted in the commit message.

- [ ] **Step 9: Commit**

```bash
git add src/utils/payrollCalculations.ts src/hooks/usePayroll.tsx src/services/laborCalculations.ts tests/
git commit -m "fix(payroll): band OT and count daily rates by restaurant business day"
```

---

### Task 11: Reroute `hoursByClockInDay` — the employee-facing surface

**Files:**
- Modify: `src/utils/timecardHours.ts` (`:17-34`; seeding at `:20`, bucketing at `:26`)
- Modify: `src/pages/EmployeeTimecard.tsx:117`
- Modify: `tests/unit/timecardHours.test.ts`, `tests/unit/EmployeeTimecard.test.tsx`

**Interfaces:**
- Produces: `hoursByClockInDay(punches, days, businessDay: BusinessDayConfig)`.

**Why this is the sharpest failure mode.** This drives the per-day hours and "Weekly Totals" on the employee's *own* timecard. If Payroll and Dashboard move to business days and this does not, an employee's timecard disagrees with their paycheck for exactly the overnight shifts this feature exists to handle — the "my timecard says Monday but payroll says Sunday" dispute, on the page they open to check.

**Critical detail:** the `days` keys are seeded at `:20` with `format(day, 'yyyy-MM-dd')` over the displayed week. Seeding and bucketing must be reframed **together** or every lookup misses and all hours silently vanish.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/timecardHours.test.ts`:

```ts
import { hoursByClockInDay } from '@/utils/timecardHours';
import { parseDateOnly } from '@/lib/dateOnly';

describe('hoursByClockInDay buckets by restaurant business day', () => {
  const TZ = 'America/Chicago';
  const week = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31']
    .map(parseDateOnly);

  it('puts a 6 PM -> 3 AM shift wholly on the clock-in business day', () => {
    const punches = [
      { id: 'a', employee_id: 'e1', punch_type: 'clock_in',
        punch_time: '2026-07-28T23:00:00.000Z' },
      { id: 'b', employee_id: 'e1', punch_type: 'clock_out',
        punch_time: '2026-07-29T08:00:00.000Z' },
    ] as any[];

    const result = hoursByClockInDay(punches, week, { tz: TZ, cutoffHour: 2 });
    expect(result.get('2026-07-28')?.netHours).toBeCloseTo(9, 6);
    expect(result.get('2026-07-29')?.netHours ?? 0).toBe(0);
  });

  it('rolls a 1 AM clock-in back to the previous business day at cutoff 2', () => {
    const punches = [
      { id: 'a', employee_id: 'e1', punch_type: 'clock_in',
        punch_time: '2026-07-30T06:00:00.000Z' },
      { id: 'b', employee_id: 'e1', punch_type: 'clock_out',
        punch_time: '2026-07-30T12:00:00.000Z' },
    ] as any[];

    const result = hoursByClockInDay(punches, week, { tz: TZ, cutoffHour: 2 });
    expect(result.get('2026-07-29')?.netHours).toBeCloseTo(6, 6);
    expect(result.get('2026-07-30')?.netHours ?? 0).toBe(0);
  });

  it('seeds every requested day so no lookup misses', () => {
    const result = hoursByClockInDay([], week, { tz: TZ, cutoffHour: 2 });
    for (const day of ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31']) {
      expect(result.has(day)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/unit/timecardHours.test.ts
```

Expected: FAIL — 3 arguments given, 2 expected.

- [ ] **Step 3: Reroute both the seeding and the bucketing**

In `src/utils/timecardHours.ts`:

```ts
import { toBusinessDayFor, type BusinessDayConfig } from '@/lib/businessDay';
import { toDateOnlyString } from '@/lib/dateOnly';

export function hoursByClockInDay(
  punches: TimePunch[],
  days: Date[],
  businessDay: BusinessDayConfig,
): Map<string, DayHours> {
  const result = new Map<string, DayHours>();

  // `days` are calendar-day tokens for the displayed week (local-midnight
  // Dates from the week picker), so they are keyed with local fields -- NOT
  // through toBusinessDayFor, which expects an instant. Seeding and bucketing
  // must produce the same key space or every lookup misses and hours silently
  // vanish from the employee's timecard.
  for (const day of days) {
    result.set(toDateOnlyString(day), { totalHours: 0, breakHours: 0, netHours: 0 });
  }

  const { sessions } = processPunchesForPeriod(punches);

  for (const session of sessions) {
    if (!session.is_complete) continue;
    // The employee's own timecard must agree with their paycheck. This is the
    // same anchor and the same framing payrollCalculations uses to band OT.
    const key = toBusinessDayFor(session.clock_in, businessDay);
    const bucket = result.get(key);
    if (!bucket) continue;
    bucket.totalHours += session.total_minutes / 60;
    bucket.breakHours += session.break_minutes / 60;
    bucket.netHours += session.worked_minutes / 60;
  }

  return result;
}
```

- [ ] **Step 4: Update `EmployeeTimecard.tsx`**

At `:117`, thread the config and put its primitives in the dep array. This is the second `useMemo` case — with no `staleTime`, an omitted dep serves stale bucketing indefinitely:

```ts
  const tz = selectedRestaurant?.restaurant?.timezone;
  const cutoffHour = selectedRestaurant?.restaurant?.business_day_start_hour;

  // Hours attributed by clock-in BUSINESS day, computed from the BUFFERED
  // punches so overnight shifts pair whole before being bucketed.
  const dayHours = useMemo(
    () => hoursByClockInDay(punches, weekDays, { tz, cutoffHour }),
    [punches, weekDays, tz, cutoffHour],
  );
```

Leave the `punchesByDay` map at `:96-113` alone — it feeds only the visual per-punch timeline, and showing a punch at its wall-clock time is a separate concern (design §8.2).

- [ ] **Step 5: Run and commit**

```bash
npm run typecheck && npx vitest run tests/unit/timecardHours.test.ts tests/unit/EmployeeTimecard.test.tsx && npx vitest run
```

Expected: typecheck clean, all green. Update the `EmployeeTimecard.test.tsx` Net Hours assertion if it passed only two arguments.

```bash
git add src/utils/timecardHours.ts src/pages/EmployeeTimecard.tsx tests/
git commit -m "fix(timecard): bucket employee timecard hours by business day, matching payroll"
```

---

### Task 12: Three-way equality — Dashboard == Payroll == Timecard

**Files:**
- Modify: `tests/unit/dashboard-payroll-consistency.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 5-11.

**Why.** Three code paths now claim to answer "how many hours on which business day". They share an anchor and a framing after this change; this test is what keeps them sharing it. Without it, the employee-facing number and the paycheck number are free to drift, and that drift is what generates disputes.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/dashboard-payroll-consistency.test.ts`:

```ts
import { hoursByClockInDay } from '@/utils/timecardHours';
import { parseDateOnly } from '@/lib/dateOnly';

describe('Dashboard == Payroll == Timecard at every cutoff', () => {
  const TZ = 'America/Chicago';
  const cutoffs = Array.from({ length: 12 }, (_, h) => h);

  // A break that crosses midnight -- the design section 3.4 latent divergence.
  // handleBreakEnd advances period.startTime past the break end, so a path
  // keying off startTime instead of clockIn lands these hours on the next day.
  const BREAK_OVER_MIDNIGHT = [
    { id: 'a', employee_id: 'e1', restaurant_id: 'r1', punch_type: 'clock_in',
      punch_time: '2026-07-28T22:00:00.000Z' },   // 17:00 CDT Jul 28
    { id: 'b', employee_id: 'e1', restaurant_id: 'r1', punch_type: 'break_start',
      punch_time: '2026-07-29T04:30:00.000Z' },   // 23:30 CDT Jul 28
    { id: 'c', employee_id: 'e1', restaurant_id: 'r1', punch_type: 'break_end',
      punch_time: '2026-07-29T05:30:00.000Z' },   // 00:30 CDT Jul 29
    { id: 'd', employee_id: 'e1', restaurant_id: 'r1', punch_type: 'clock_out',
      punch_time: '2026-07-29T08:00:00.000Z' },   // 03:00 CDT Jul 29
  ] as any[];

  const employee = {
    id: 'e1', restaurant_id: 'r1', name: 'e1', status: 'active',
    compensation_type: 'hourly', hourly_rate: 2000, is_exempt: false,
  } as any;

  const FROM = new Date('2026-07-26T00:00:00.000Z');
  const TO = new Date('2026-08-02T23:59:59.999Z');
  const week = ['2026-07-26','2026-07-27','2026-07-28','2026-07-29','2026-07-30','2026-07-31','2026-08-01']
    .map(parseDateOnly);

  it.each(cutoffs)('cutoff %i: all three paths agree per business day', (cutoffHour) => {
    const businessDay = { tz: TZ, cutoffHour };

    const { dailyCosts } = calculateActualLaborCost(
      [employee], BREAK_OVER_MIDNIGHT, FROM, TO, businessDay,
    );
    const dashboardByDay = new Map(
      dailyCosts.filter((d) => d.hours_worked > 0).map((d) => [d.date, d.hours_worked]),
    );

    const timecard = hoursByClockInDay(BREAK_OVER_MIDNIGHT, week, businessDay);
    const timecardByDay = new Map(
      [...timecard.entries()].filter(([, v]) => v.netHours > 0).map(([k, v]) => [k, v.netHours]),
    );

    const pay = calculateEmployeePay(
      employee, BREAK_OVER_MIDNIGHT, 0, FROM, TO, [], 0, undefined, [], true, businessDay,
    );

    // All three attribute the whole shift to ONE business day.
    expect(dashboardByDay.size).toBe(1);
    expect(timecardByDay.size).toBe(1);
    expect([...dashboardByDay.keys()]).toEqual([...timecardByDay.keys()]);

    const [[, dashHours]] = [...dashboardByDay.entries()];
    const [[, tcHours]] = [...timecardByDay.entries()];
    const payHours = pay.regularHours + pay.overtimeHours + pay.doubleTimeHours;

    expect(dashHours).toBeCloseTo(tcHours, 6);
    expect(payHours).toBeCloseTo(tcHours, 6);
  });
});
```

- [ ] **Step 2: Run it**

```bash
TZ=UTC npx vitest run tests/unit/dashboard-payroll-consistency.test.ts
TZ=America/Chicago npx vitest run tests/unit/dashboard-payroll-consistency.test.ts
```

Expected: PASS under both. The whole point is that the result no longer depends on the process zone. If it passes under one and fails under the other, a path is still reading browser-local fields — find it before continuing.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/dashboard-payroll-consistency.test.ts
git commit -m "test(payroll): three-way business-day equality across dashboard, payroll, timecard"
```

---

### Task 13: Settings UI

**Files:**
- Modify: `src/pages/RestaurantSettings.tsx` (new `Card` above the Overtime Rules card at `:936`; new save handler patterned on `:381-392`)

**Interfaces:**
- Consumes: `MAX_BUSINESS_DAY_START_HOUR` from `src/lib/businessDay.ts`.
- Produces: a persisted `restaurants.business_day_start_hour`.

**Placement.** Payroll tab (`TabsContent` at `:935`), in its **own** `Card` above "Overtime Rules" — a business-day boundary is not an overtime rule, and filing it under that heading would be a lie in the information architecture. Not the General tab: this is payroll configuration, not a display preference.

**Control.** A `Select` of the 12 legal hours as wall-clock labels, not a numeric `Input`. The domain is small and closed, a free-text number invites `2` meaning 2 PM, and a `Select` cannot produce a value the CHECK would reject. Per design §9 item 6, do **not** wrap items in `SelectGroup` — neither existing `Select` in this file does (`SelectTrigger` at `:756` and `:1273`) and the file does not import it; match the local convention. Both existing triggers carry an `id` and the exact `className` used below — copy it verbatim rather than inventing sizing.

- [ ] **Step 1: Add the hour options and state**

Near the other tab state in `RestaurantSettings.tsx`:

```ts
const BUSINESS_DAY_HOUR_OPTIONS = Array.from(
  { length: MAX_BUSINESS_DAY_START_HOUR + 1 },
  (_, h) => ({
    value: String(h),
    label: h === 0 ? '12:00 AM (midnight)' : `${h}:00 AM`,
  }),
);
```

```ts
const [businessDayStartHour, setBusinessDayStartHour] = useState<string>('0');
```

Hydrate it wherever the other `restaurants` fields are hydrated from `selectedRestaurant`:

```ts
setBusinessDayStartHour(String(restaurant.business_day_start_hour ?? 0));
```

- [ ] **Step 2: Add the save handler**

Patterned on the `restaurants`-update shape at `:391-392` — note this is a `restaurants` update, not the `overtime_rules` upsert `handleSaveOtRules` does:

```ts
const handleSaveBusinessDay = async () => {
  if (!selectedRestaurant?.restaurant_id) return;
  setSavingBusinessDay(true);
  try {
    const { error } = await supabase
      .from('restaurants')
      .update({ business_day_start_hour: Number(businessDayStartHour) })
      .eq('id', selectedRestaurant.restaurant_id);
    if (error) throw error;

    // Bucketing changes, so every derived labor/payroll figure is stale.
    await queryClient.invalidateQueries({ queryKey: ['labor-costs-from-time-tracking'] });
    await queryClient.invalidateQueries({ queryKey: ['payroll'] });
    await queryClient.invalidateQueries({ queryKey: ['monthly-metrics'] });

    toast({ title: 'Business day updated' });
  } catch (error: any) {
    toast({
      title: 'Could not update the business day',
      description: error.message,
      variant: 'destructive',
    });
  } finally {
    setSavingBusinessDay(false);
  }
};
```

- [ ] **Step 3: Add the Card**

Immediately above the Overtime Rules `Card` at `:936`:

```tsx
<Card className="border-border/40">
  <CardHeader>
    <CardTitle className="text-[17px] font-semibold text-foreground">
      Business Day
    </CardTitle>
    <CardDescription className="text-[13px] text-muted-foreground">
      When your operating day starts, for payroll and labor cost reporting.
    </CardDescription>
  </CardHeader>
  <CardContent>
    <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
      <div className="p-4 space-y-2">
        <Label
          htmlFor="business-day-start-hour"
          className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
        >
          Business day starts at
        </Label>
        <Select value={businessDayStartHour} onValueChange={setBusinessDayStartHour}>
          <SelectTrigger
            id="business-day-start-hour"
            aria-describedby="business-day-start-hour-help"
            className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BUSINESS_DAY_HOUR_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id="business-day-start-hour-help" className="text-[13px] text-muted-foreground">
          Shifts that start before this hour are counted toward the previous business
          day. Changing this re-buckets historical labor cost and payroll reports.
        </p>
      </div>
    </div>
    <div className="flex justify-end mt-4">
      <Button
        onClick={handleSaveBusinessDay}
        disabled={savingBusinessDay}
        className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
      >
        {savingBusinessDay ? 'Saving…' : 'Save'}
      </Button>
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 4: Verify in the browser**

```bash
npm run typecheck && npm run lint
```

Then open the preview, navigate to Settings → Payroll, and confirm: the Business Day card renders above Overtime Rules; the `Select` lists "12:00 AM (midnight)" through "11:00 AM"; the help text is present; changing the value and saving shows the success toast; a reload preserves the choice.

Check the console for errors and confirm the label/control association with `read_page` (the `Label`'s `htmlFor` must match the `SelectTrigger`'s `id`, and `aria-describedby` must point at the help text).

- [ ] **Step 5: Commit**

```bash
git add src/pages/RestaurantSettings.tsx
git commit -m "feat(settings): business day start hour control on the Payroll tab"
```

---

### Task 14: Frame independence wired into `test:tz`

**Files:**
- Create: `tests/unit/businessDay.tz.test.ts`
- Modify: `package.json:32` (`test:tz`)

**Why.** CI runs in UTC, the one zone where these bugs are invisible. `Pacific/Auckland` is the sign-flip case that catches east-of-UTC errors a US-only matrix misses.

- [ ] **Step 1: Write the frame-independence test**

Create `tests/unit/businessDay.tz.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toBusinessDay } from '@/lib/businessDay';
import { calculateActualLaborCost } from '@/services/laborCalculations';
import { SQL_PARITY_FIXTURES } from './fixtures/businessDayFixtures';

/**
 * Frame independence: the same fixtures must produce the same business days for
 * a given RESTAURANT zone regardless of the PROCESS zone. Run under multiple
 * TZ values via the test:tz script -- a single UTC run cannot detect a
 * browser-local frame leak, which is exactly how design section 3.2's defect
 * reached production.
 */
describe(`frame independence (process TZ = ${process.env.TZ ?? 'unset'})`, () => {
  it.each(SQL_PARITY_FIXTURES)(
    'toBusinessDay is process-zone independent: $name',
    ({ instant, tz, cutoffHour, expected }) => {
      expect(toBusinessDay(instant, tz, cutoffHour)).toBe(expected);
    },
  );

  it('labor cost bucketing is process-zone independent', () => {
    const employee = {
      id: 'e1', restaurant_id: 'r1', name: 'e1', status: 'active',
      compensation_type: 'hourly', hourly_rate: 2000, is_exempt: false,
    } as any;
    const punches = [
      { id: 'a', employee_id: 'e1', restaurant_id: 'r1', punch_type: 'clock_in',
        punch_time: '2026-07-28T23:00:00.000Z' },
      { id: 'b', employee_id: 'e1', restaurant_id: 'r1', punch_type: 'clock_out',
        punch_time: '2026-07-29T08:00:00.000Z' },
    ] as any[];

    const { dailyCosts } = calculateActualLaborCost(
      [employee], punches,
      new Date('2026-07-26T00:00:00.000Z'), new Date('2026-08-02T23:59:59.999Z'),
      { tz: 'America/Chicago', cutoffHour: 2 },
    );

    // Hard-coded expectation, not a comparison against another run: 18:00 CDT
    // Jul 28 -> 03:00 CDT Jul 29, nine hours, all on Jul 28.
    expect(dailyCosts.find((d) => d.date === '2026-07-28')?.hours_worked).toBeCloseTo(9, 6);
    expect(dailyCosts.find((d) => d.date === '2026-07-29')?.hours_worked ?? 0).toBe(0);
  });
});
```

- [ ] **Step 2: Run it under all four zones**

```bash
TZ=UTC npx vitest run tests/unit/businessDay.tz.test.ts && TZ=America/Chicago npx vitest run tests/unit/businessDay.tz.test.ts && TZ=America/New_York npx vitest run tests/unit/businessDay.tz.test.ts && TZ=Pacific/Auckland npx vitest run tests/unit/businessDay.tz.test.ts
```

Expected: PASS in all four. A failure under `Pacific/Auckland` alone means a residual browser-local read; under all four means a genuine expectation error.

- [ ] **Step 3: Wire into `test:tz`**

Append to the `test:tz` chain in `package.json` (keep the existing chain intact):

```
 && TZ=UTC vitest run tests/unit/businessDay.tz.test.ts && TZ=America/Chicago vitest run tests/unit/businessDay.tz.test.ts && TZ=America/New_York vitest run tests/unit/businessDay.tz.test.ts && TZ=Pacific/Auckland vitest run tests/unit/businessDay.tz.test.ts && TZ=America/Chicago vitest run tests/unit/payroll-business-day-conservation.test.ts && TZ=Pacific/Auckland vitest run tests/unit/payroll-business-day-conservation.test.ts && TZ=America/Chicago vitest run tests/unit/dashboard-payroll-consistency.test.ts && TZ=UTC vitest run tests/unit/dashboard-payroll-consistency.test.ts
```

- [ ] **Step 4: Run the whole chain and commit**

```bash
npm run test:tz
```

Expected: every segment passes.

```bash
git add tests/unit/businessDay.tz.test.ts package.json
git commit -m "test(tz): pin business-day bucketing across four process timezones"
```

---

### Task 15: E2E

**Files:**
- Create: `tests/e2e/business-day-cutoff.spec.ts`

**Interfaces:**
- Consumes: `'../helpers/e2e-supabase'`, `generateTestUser()`.

**Why `test.use({ timezoneId })`.** It pins the *browser* zone independently of the restaurant zone, which is the only way an E2E test can prove the frame repair rather than accidentally agreeing with it.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/business-day-cutoff.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { generateTestUser /* plus the seed helpers this repo's specs use */ } from '../helpers/e2e-supabase';

/**
 * Browser zone deliberately DIFFERS from the restaurant zone
 * (America/Chicago). If these pass with the browser pinned to Tokyo, the
 * bucketing is genuinely restaurant-framed.
 */
test.use({ timezoneId: 'Asia/Tokyo' });

test.describe('business-day cutoff', () => {
  test('the cutoff persists across a reload', async ({ page }) => {
    // Proves the restaurants write path and the Select round-trip.
    await page.goto('/settings');
    await page.getByRole('tab', { name: /payroll/i }).click();

    const select = page.getByLabel(/business day starts at/i);
    await select.click();
    await page.getByRole('option', { name: '2:00 AM' }).click();
    await page.getByRole('button', { name: /^save$/i }).click();

    await expect(page.getByText(/business day updated/i)).toBeVisible();

    await page.reload();
    await page.getByRole('tab', { name: /payroll/i }).click();
    await expect(page.getByLabel(/business day starts at/i)).toHaveText(/2:00 AM/);
  });

  test('an overnight shift lands on its clock-in day and the next day is zero', async ({ page }) => {
    // The reported symptom, end to end through real RLS. Seed a 6 PM -> 3 AM
    // shift for the test restaurant, cutoff 2, zone America/Chicago.
    await page.goto('/labor');
    const clockInDay = page.getByRole('row', { name: /Jul 28/ });
    const nextDay = page.getByRole('row', { name: /Jul 29/ });

    await expect(clockInDay).toContainText('9');
    await expect(nextDay).not.toContainText('9');
  });

  test('Dashboard and Payroll show the same total for that shift', async ({ page }) => {
    await page.goto('/dashboard');
    const dashboardTotal = await page.getByTestId('labor-cost-total').innerText();

    await page.goto('/payroll');
    const payrollTotal = await page.getByTestId('payroll-gross-total').innerText();

    expect(dashboardTotal).toBe(payrollTotal);
  });

  test("the employee's own timecard agrees with payroll", async ({ page }) => {
    // The hoursByClockInDay surface -- checked through the page an employee
    // would actually open to dispute a paycheck.
    await page.goto('/timecard');
    await expect(page.getByRole('row', { name: /Jul 28/ })).toContainText('9');
    await expect(page.getByTestId('weekly-net-hours')).toContainText('9');
  });

  test('an out-of-range cutoff cannot be selected', async ({ page }) => {
    // The Select is closed over the 12 legal hours, so the CHECK constraint is
    // unreachable from the UI. Assert the domain rather than a rejection toast.
    await page.goto('/settings');
    await page.getByRole('tab', { name: /payroll/i }).click();
    await page.getByLabel(/business day starts at/i).click();

    const options = page.getByRole('option');
    await expect(options).toHaveCount(12);
    await expect(page.getByRole('option', { name: '12:00 PM' })).toHaveCount(0);
  });
});
```

Adapt the selectors and seeding to this repo's existing labor/payroll specs — extend their helpers rather than duplicating them. Add `data-testid` attributes where the assertions above need them and no accessible selector exists.

- [ ] **Step 2: Run the E2E suite**

```bash
npm run test:e2e -- business-day-cutoff
```

Expected: all five scenarios pass. Fix selectors against the real DOM (`read_page`) rather than loosening assertions.

- [ ] **Step 3: Full verification**

```bash
npm run typecheck && npm run lint && npm run test && npm run test:tz && npm run test:db && npm run test:e2e
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/business-day-cutoff.spec.ts src/
git commit -m "test(e2e): business-day cutoff across settings, labor, payroll, timecard"
```

---

## Self-Review

**Spec coverage.** Design §5 → T1. §6 → T1. §7 → T2. §8.1's nine sites → `laborCalculations:557` T5, `:580-581` T5, `:726` T6, `:730-735` T6, `:945` T7, `:405` T9, `payrollCalculations:492` T10, `:558` T10, `timecardHours:26` T11. §8.3 → T13. §11.1 → T5/T6. §11.2 → T3. §11.3 → T14. §11.4 → T10. §11.5 → T1 (pgTAP DST + the §4.1 anti-regression pair). §11.6 → T2 (`SQL_PARITY_FIXTURES` shared with T1's pgTAP). §11.7 → T12. §11.8 → T15. §11.9 → no `fast-check`; the cutoff loops are `Array.from({length: 12})`, deterministic.

**Deliberate divergences from the design doc, each with a reason stated in the task:**
1. No new `safeTz` — `validateTimeZone` (`src/lib/splhAnalytics.ts:73`) already has the semantics and two existing consumers (T2).
2. `toBusinessDayFor` added alongside the design's three-argument `toBusinessDay`, so nine consumer sites take one config parameter rather than two positional ones (T2).
3. `useScheduledLaborCosts` sources the config from context rather than widening its public signature, leaving `Scheduling.tsx` untouched (T8). The design left the mechanism open; this is the smaller change.
4. `calculateEmployeePay` keeps a `{ tz: 'UTC', cutoffHour: 0 }` default where the labor functions take a required parameter — ~50 pre-existing three-argument call sites cannot reach a 12th positional parameter. T10 Step 6 adds a test asserting no production caller relies on it (T10).

**Open risk carried into execution.** Design §10's last row: `lookaheadPunchFetchRange` is look-ahead only. A nonzero cutoff moves the business-day boundary *later*, the same direction the look-ahead already covers, so it should be safe — but T5 must verify this explicitly with a fixture whose clock-in sits within `cutoffHour` of the fetch window's start edge, rather than assuming it.
