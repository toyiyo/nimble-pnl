# Publish-Week Timezone Off-By-One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a published Mon–Sun schedule week from also publishing and broadcasting the following Monday.

**Architecture:** `weekStart`/`weekEnd` are local-midnight calendar-day tokens. Serializing them with `toISOString().split('T')[0]` reads UTC fields off a local token, pushing the end date to the next Monday in any timezone behind UTC. Every call site is switched to the correct serializer for its target: `formatLocalDate()` for `date` columns and RPC date params, full `.toISOString()` for `timestamptz` comparisons. One edge function that re-derives its own boundary is fixed in the same pass, because the primary fix removes the slack currently masking its bug. A `NOT VALID` CHECK constraint stops the invariant from silently drifting again.

**Tech Stack:** React 18 + TypeScript, React Query, date-fns / date-fns-tz, Supabase (Postgres RPC + Deno edge functions), Vitest, Playwright, pgTAP.

## Global Constraints

- Serialization rule, applied everywhere: `date` column or `p_week_*` RPC date param → `formatLocalDate(d)` from `@/lib/shiftInterval`. `timestamptz` column comparison → `d.toISOString()` (full instant, **never** `.split('T')[0]`).
- Do **not** use `formatLocalDateInTz` for week-boundary tokens. The token already denotes a calendar day; re-anchoring it in another zone shifts it again. That helper is only for bucketing genuine UTC instants.
- Test fixtures use `new Date(year, month, day)` — local midnight on the requested calendar day in any process TZ. Never ISO-string fixtures; they mask this entire bug class.
- No data migration. The 44 existing 8-day `schedule_publications` rows stay as they are. No shift is unpublished.
- Do not modify the bodies of `publish_schedule`, `unpublish_schedule`, or `get_open_shifts`. A separate task (already dispatched) is making them timezone-aware; touching them here would conflict.
- Every commit message ends with `Co-Authored-By: Claude <noreply@anthropic.com>`.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/hooks/useOpenShifts.ts` | `get_open_shifts` week query | Modify |
| `src/hooks/useTemplateDeletionImpact.ts` | 28-day open-spots window | Modify |
| `src/hooks/useSchedulePublish.tsx` | publish / unpublish / status | Modify |
| `supabase/functions/notify-schedule-published/index.ts` | who-is-scheduled notification set | Modify |
| `supabase/migrations/20260727180000_schedule_publication_range_check.sql` | range invariant | Create |
| `supabase/tests/schedule_publication_range.test.sql` | pgTAP for the constraint | Create |
| `tests/unit/scheduleWeekRange.test.ts` | hook-level serialization assertions | Create |
| `tests/unit/useTemplateDeletionImpact.test.tsx` | extend with window assertion | Modify |
| `tests/e2e/schedule-publish-week-range.spec.ts` | cross-layer seam, TZ-pinned | Create |
| `package.json` / `.github/workflows/unit-tests.yml` | TZ matrix wiring | Modify |

---

### Task 1: Fix the two `get_open_shifts` date-param call sites

**Files:**
- Modify: `src/hooks/useOpenShifts.ts:11-12`
- Modify: `src/hooks/useTemplateDeletionImpact.ts:21-23`
- Test: `tests/unit/scheduleWeekRange.test.ts` (create)
- Test: `tests/unit/useTemplateDeletionImpact.test.tsx` (extend)

**Interfaces:**
- Consumes: `formatLocalDate(date: Date): string` from `@/lib/shiftInterval` (existing, returns `YYYY-MM-DD` from local fields).
- Produces: nothing new. Later tasks reuse the `makeWeek()` fixture helper defined here.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/scheduleWeekRange.test.ts`:

```ts
import React, { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { endOfWeek } from 'date-fns';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  functions: { invoke: vi.fn() },
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));

const mockToast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));

import { useOpenShifts } from '@/hooks/useOpenShifts';

/**
 * The week of Mon 2026-07-27. `new Date(y, m, d)` yields local midnight on that
 * calendar day in ANY process TZ, so these fixtures are TZ-portable — which is
 * the whole point: the bug is invisible under TZ=UTC.
 */
function makeWeek() {
  const weekStart = new Date(2026, 6, 27);
  const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
  return { weekStart, weekEnd };
}

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

describe('week range serialization', () => {
  beforeEach(() => {
    mockSupabase.from.mockReset();
    mockSupabase.rpc.mockReset();
    mockSupabase.functions.invoke.mockReset();
    mockToast.mockReset();
  });

  it('useOpenShifts sends a Mon..Sun range, not Mon..Mon', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });
    const { weekStart, weekEnd } = makeWeek();

    renderHook(() => useOpenShifts('r1', weekStart, weekEnd), { wrapper: createWrapper() });

    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalled());

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_open_shifts', {
      p_restaurant_id: 'r1',
      p_week_start: '2026-07-27',
      p_week_end: '2026-08-02',
    });

    // Explicit regression guard: the reported bug produced the following Monday.
    const { p_week_end } = mockSupabase.rpc.mock.calls[0][1];
    expect(p_week_end).not.toBe('2026-08-03');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run tests/unit/scheduleWeekRange.test.ts`
Expected: FAIL — received `p_week_end: '2026-08-03'`, expected `'2026-08-02'`.

Also run under UTC to prove the test is only meaningful off-UTC:
Run: `TZ=UTC npx vitest run tests/unit/scheduleWeekRange.test.ts`
Expected: PASS (bug invisible here — this is why the TZ matrix in Task 4 exists).

- [ ] **Step 3: Fix `useOpenShifts.ts`**

Add the import (import order: utils last, per CLAUDE.md):

```ts
import { formatLocalDate } from '@/lib/shiftInterval';
```

Replace lines 11-12:

```ts
      const startStr = formatLocalDate(weekStart);
      const endStr = formatLocalDate(weekEnd);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run tests/unit/scheduleWeekRange.test.ts`
Expected: PASS

- [ ] **Step 5: Fix `useTemplateDeletionImpact.ts`**

Delete the local `toDateStr` helper (lines 21-23) entirely and add the import:

```ts
import { formatLocalDate } from '@/lib/shiftInterval';
```

Update the two call sites (lines 55-56):

```ts
      p_week_start: formatLocalDate(today),
      p_week_end: formatLocalDate(windowEnd),
```

- [ ] **Step 6: Add the regression assertion to the existing test**

In `tests/unit/useTemplateDeletionImpact.test.tsx`, add this test inside the existing `describe('useTemplateDeletionImpact', ...)` block. It reuses the file's existing `makeQueryBuilder`, `mockFromByTable`, and `createWrapper` helpers:

```ts
  it('sends the open-spots window as local calendar days', async () => {
    mockFromByTable(
      makeQueryBuilder({ data: [], error: null }),
      makeQueryBuilder({ count: 0, error: null }),
    );
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null });

    renderHook(() => useTemplateDeletionImpact('r1', 't1'), { wrapper: createWrapper() });

    await waitFor(() => expect(mockSupabase.rpc).toHaveBeenCalled());

    const params = mockSupabase.rpc.mock.calls[0][1];
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const localToday = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    // Must be the manager's local calendar day, not the UTC day (which is
    // already tomorrow during US evening hours).
    expect(params.p_week_start).toBe(localToday);
  });
```

- [ ] **Step 7: Run both test files**

Run: `TZ=America/New_York npx vitest run tests/unit/scheduleWeekRange.test.ts tests/unit/useTemplateDeletionImpact.test.tsx`
Expected: PASS, all tests green.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useOpenShifts.ts src/hooks/useTemplateDeletionImpact.ts tests/unit/scheduleWeekRange.test.ts tests/unit/useTemplateDeletionImpact.test.tsx
git commit -m "fix(scheduling): serialize get_open_shifts week params as local calendar days

toISOString() reads UTC fields off a local-midnight token, pushing the
week end to the following Monday in any timezone behind UTC.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Fix publish and unpublish (the reported bug)

**Files:**
- Modify: `src/hooks/useSchedulePublish.tsx:55-56` (publish), `:117-118` (unpublish)
- Test: `tests/unit/scheduleWeekRange.test.ts` (extend)

**Interfaces:**
- Consumes: `formatLocalDate` (Task 1), `makeWeek()` / `createWrapper()` fixtures (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/scheduleWeekRange.test.ts`. Add to the existing imports at the top of the file:

```ts
import { act } from '@testing-library/react';
import { usePublishSchedule, useUnpublishSchedule } from '@/hooks/useSchedulePublish';
```

Then add inside the `describe` block:

```ts
  it('usePublishSchedule sends a Mon..Sun range, not Mon..Mon', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 'pub-1', error: null });
    mockSupabase.functions.invoke.mockResolvedValue({ data: {}, error: null });
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => usePublishSchedule(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('publish_schedule', {
      p_restaurant_id: 'r1',
      p_week_start: '2026-07-27',
      p_week_end: '2026-08-02',
      p_notes: null,
    });

    // The notification payload must carry the same corrected range — the edge
    // function re-derives its own shift boundary from it (see Task 5).
    expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
      'notify-schedule-published',
      expect.objectContaining({
        body: expect.objectContaining({ weekStart: '2026-07-27', weekEnd: '2026-08-02' }),
      }),
    );
  });

  it('useUnpublishSchedule sends a Mon..Sun range, not Mon..Mon', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: 3, error: null });
    const { weekStart, weekEnd } = makeWeek();

    const { result } = renderHook(() => useUnpublishSchedule(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ restaurantId: 'r1', weekStart, weekEnd });
    });

    expect(mockSupabase.rpc).toHaveBeenCalledWith('unpublish_schedule', {
      p_restaurant_id: 'r1',
      p_week_start: '2026-07-27',
      p_week_end: '2026-08-02',
      p_reason: null,
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run tests/unit/scheduleWeekRange.test.ts`
Expected: FAIL on both new tests — `p_week_end` is `'2026-08-03'`.

- [ ] **Step 3: Implement the fix**

In `src/hooks/useSchedulePublish.tsx`, add the import:

```ts
import { formatLocalDate } from '@/lib/shiftInterval';
```

Replace lines 55-56 in `usePublishSchedule`:

```ts
      const weekStartStr = formatLocalDate(weekStart);
      const weekEndStr = formatLocalDate(weekEnd);
```

Replace lines 117-118 in `useUnpublishSchedule` with the identical two lines.

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run tests/unit/scheduleWeekRange.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSchedulePublish.tsx tests/unit/scheduleWeekRange.test.ts
git commit -m "fix(scheduling): publish/unpublish a Mon-Sun week, not Mon-Mon

Publishing the week of Jul 27 also published and broadcast Mon Aug 3,
generating open-shift claims for a week that was never published.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Fix `useWeekPublicationStatus` (both serializations)

This function needs **both** rules at once, which is why it is its own task: it compares against `date` columns in one query and a `timestamptz` column in another.

**Files:**
- Modify: `src/hooks/useSchedulePublish.tsx:163-173` and `:185-188`
- Test: `tests/unit/scheduleWeekRange.test.ts` (extend)

**Interfaces:**
- Consumes: `formatLocalDate` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Add to the imports in `tests/unit/scheduleWeekRange.test.ts`:

```ts
import { useWeekPublicationStatus } from '@/hooks/useSchedulePublish';
```

Add this chainable-builder helper above the `describe` block:

```ts
/**
 * Postgrest-style chainable mock: every filter returns the same builder, and
 * the builder is thenable so `await query` resolves to `result`.
 */
function makeBuilder(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const builder: Record<string, unknown> = { calls: [] as Array<[string, unknown, unknown]> };
  for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'limit']) {
    builder[m] = vi.fn((...args: unknown[]) => {
      (builder.calls as Array<unknown[]>).push([m, ...args]);
      return builder;
    });
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return builder;
}
```

Then add the test:

```ts
  it('useWeekPublicationStatus uses instants for start_time and dates for date columns', async () => {
    const shiftsBuilder = makeBuilder({ count: 2, error: null });
    const pubsBuilder = makeBuilder({ data: null, error: null });
    mockSupabase.from.mockImplementation((table: string) =>
      table === 'shifts' ? shiftsBuilder : pubsBuilder,
    );

    const { weekStart, weekEnd } = makeWeek();
    renderHook(() => useWeekPublicationStatus('r1', weekStart, weekEnd), { wrapper: createWrapper() });

    await waitFor(() => expect(pubsBuilder.maybeSingle).toHaveBeenCalled());

    // timestamptz column -> full instants, so no local wall-clock hours are lost.
    expect(shiftsBuilder.gte).toHaveBeenCalledWith('start_time', weekStart.toISOString());
    expect(shiftsBuilder.lte).toHaveBeenCalledWith('start_time', weekEnd.toISOString());

    // date columns -> local calendar days.
    expect(pubsBuilder.eq).toHaveBeenCalledWith('week_start_date', '2026-07-27');
    expect(pubsBuilder.eq).toHaveBeenCalledWith('week_end_date', '2026-08-02');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=America/New_York npx vitest run tests/unit/scheduleWeekRange.test.ts -t 'useWeekPublicationStatus'`
Expected: FAIL — `gte` received `'2026-07-27T00:00:00Z'` (a spliced string), not the instant; `week_end_date` received `'2026-08-03'`.

- [ ] **Step 3: Implement the fix**

In `useWeekPublicationStatus`, replace lines 163-164:

```ts
      const weekStartStr = formatLocalDate(weekStart);
      const weekEndStr = formatLocalDate(weekEnd);
```

Then replace the `.gte`/`.lte` pair (lines 171-172) so the `timestamptz` comparison uses real instants instead of date strings spliced into hardcoded `Z` literals:

```ts
        .gte('start_time', weekStart.toISOString())
        .lte('start_time', weekEnd.toISOString())
```

Leave the `schedule_publications` lookup at lines 185-188 using `weekStartStr` / `weekEndStr` — those are `date` columns and are now correct.

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=America/New_York npx vitest run tests/unit/scheduleWeekRange.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSchedulePublish.tsx tests/unit/scheduleWeekRange.test.ts
git commit -m "fix(scheduling): correct both serializations in useWeekPublicationStatus

The published-shift count spliced date strings into hardcoded T00:00:00Z
/ T23:59:59Z literals to filter a timestamptz column, dropping the last
~5 hours of Sunday for any US restaurant. Compare against instants
instead, and keep local calendar days for the date-column lookup.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Wire the TZ matrix into CI

Without this, every test above runs only under UTC in CI — the one zone where the bug is invisible. This task is what makes Tasks 1–3 protective rather than decorative.

**Files:**
- Modify: `package.json:32`
- Modify: `.github/workflows/unit-tests.yml:36-37`

**Interfaces:**
- Consumes: `tests/unit/scheduleWeekRange.test.ts` (Task 1).
- Produces: `npm run test:tz` covering the new suite.

- [ ] **Step 1: Extend the `test:tz` script**

In `package.json`, replace line 32:

```json
    "test:tz": "TZ=America/Chicago vitest run tests/unit/schedule-solver-tz.test.ts && TZ=Pacific/Auckland vitest run tests/unit/schedule-solver-tz.test.ts && TZ=America/New_York vitest run tests/unit/scheduleWeekRange.test.ts && TZ=UTC vitest run tests/unit/scheduleWeekRange.test.ts && TZ=Asia/Tokyo vitest run tests/unit/scheduleWeekRange.test.ts",
```

`Asia/Tokyo` is not redundant with `Pacific/Auckland` here: it catches the mirror-image failure where `weekStart` slips *backward* to Sunday east of UTC.

- [ ] **Step 2: Verify the matrix passes**

Run: `npm run test:tz`
Expected: PASS in all five invocations.

- [ ] **Step 3: Add the CI step**

In `.github/workflows/unit-tests.yml`, insert immediately after the `Run unit tests with coverage` step (after line 37):

```yaml
      - name: Run timezone matrix tests
        run: npm run test:tz
```

- [ ] **Step 4: Verify the workflow file parses**

Run: `npx js-yaml .github/workflows/unit-tests.yml > /dev/null && echo "yaml ok"`
Expected: `yaml ok`

- [ ] **Step 5: Commit**

```bash
git add package.json .github/workflows/unit-tests.yml
git commit -m "test(ci): run the week-range suite under a timezone matrix

CI runs UTC, which is the one zone where this bug is invisible. Without
a forced non-UTC run these assertions would pass through a regression.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Fix `notify-schedule-published` before the narrowed range reaches it

**Order matters:** Tasks 2–3 remove the accidental slack that currently hides this bug. Do not ship without this task.

**Files:**
- Modify: `supabase/functions/notify-schedule-published/index.ts:1-8` (imports), `:65-70` (restaurant select), `:105-106` (shift range)

**Interfaces:**
- Consumes: `weekStart` / `weekEnd` payload strings (`YYYY-MM-DD`), now correctly Mon–Sun after Task 2.
- Produces: nothing new.

- [ ] **Step 1: Add the `date-fns-tz` import**

Add to the import block at the top of the file:

```ts
import { fromZonedTime } from "https://esm.sh/date-fns-tz@3.2.0";
```

- [ ] **Step 2: Fetch the restaurant timezone**

Replace the `select("name")` on line 67 with:

```ts
      .select("name, timezone")
```

- [ ] **Step 3: Resolve the bounds as instants in the restaurant's timezone**

Insert immediately before the shifts query (before line 100's comment):

```ts
    // The payload carries restaurant-local calendar days. Splicing them into
    // hardcoded `Z` literals would compare local dates against UTC instants and
    // drop Sunday-evening shifts (already Monday in UTC for US restaurants),
    // silently excluding those employees from the notification.
    //
    // An invalid/legacy IANA string makes date-fns-tz throw, so probe first and
    // fall back to the restaurants.timezone column default.
    let tz = restaurant.timezone || "America/Chicago";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      console.warn(`Invalid timezone "${tz}" for restaurant ${restaurantId}; falling back to America/Chicago`);
      tz = "America/Chicago";
    }

    const weekStartInstant = fromZonedTime(`${weekStart}T00:00:00`, tz).toISOString();
    const weekEndInstant = fromZonedTime(`${weekEnd}T23:59:59.999`, tz).toISOString();
```

- [ ] **Step 4: Use the instants in the query**

Replace lines 105-106:

```ts
      .gte("start_time", weekStartInstant)
      .lte("start_time", weekEndInstant)
```

- [ ] **Step 5: Verify the boundary arithmetic**

Run:

```bash
npx tsx -e "
const { fromZonedTime } = require('date-fns-tz');
const tz = 'America/New_York';
const end = fromZonedTime('2026-08-02T23:59:59.999', tz);
console.log('upper bound  :', end.toISOString());
const sundayNightShift = fromZonedTime('2026-08-02T21:00:00', tz);
console.log('9pm Sun shift:', sundayNightShift.toISOString());
console.log('included?    :', sundayNightShift <= end);
"
```

Expected output — the last line must be `included?    : true`. (Under the old `\${weekEnd}T23:59:59Z` bound the 9pm Sunday shift resolves to `2026-08-03T01:00:00Z`, which is greater than `2026-08-02T23:59:59Z` and would be excluded.)

- [ ] **Step 6: Typecheck the function**

Run: `npx deno check supabase/functions/notify-schedule-published/index.ts`
Expected: no errors. If `deno` is not installed, run `npm run build` instead and confirm it succeeds (edge functions are excluded from the Vite build, so this only proves nothing else broke — note that in the commit body if so).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/notify-schedule-published/index.ts
git commit -m "fix(notify): resolve schedule-published week bounds in restaurant tz

This function re-derives its own shift boundary from the payload rather
than reading the publication row, splicing local dates into hardcoded Z
literals. The old off-by-one masked it with a day of slack; correcting
the range would have silently stopped notifying employees whose only
shift starts Sunday evening.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Add the range invariant

**Files:**
- Create: `supabase/migrations/20260727180000_schedule_publication_range_check.sql` (must sort after the latest existing migration, `20260724180300`)
- Create: `supabase/tests/schedule_publication_range.test.sql`

**Interfaces:**
- Consumes: existing `schedule_publications` table.
- Produces: constraint `schedule_publications_week_range_valid`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260727180000_schedule_publication_range_check.sql`:

```sql
-- Guard the schedule_publications week range invariant.
--
-- Every row in production drifted to an 8-day span (Mon..Mon) because the
-- client serialized a local-midnight week-end token with toISOString(), which
-- reads UTC fields. The client is fixed; this constraint stops the invariant
-- from drifting silently again.
--
-- NOT VALID is deliberate: it enforces the rule on every new write while
-- leaving the 44 historical rows untouched, matching the decision not to
-- backfill. The bound is `<= 6` rather than `= 6` so a future partial-week
-- publish stays legal; only the spill is forbidden.

ALTER TABLE public.schedule_publications
  ADD CONSTRAINT schedule_publications_week_range_valid
  CHECK (
    week_end_date >= week_start_date
    AND week_end_date - week_start_date <= 6
  )
  NOT VALID;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db reset`
Expected: completes without error, all migrations applied.

- [ ] **Step 3: Write the pgTAP test**

Create `supabase/tests/schedule_publication_range.test.sql`:

```sql
-- pgTAP tests for the schedule_publications week-range invariant.
-- A correct Mon..Sun (6-day) span inserts; the Mon..Mon (7-day) spill raises.

BEGIN;

SELECT plan(3);

SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_publications DISABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name)
VALUES ('dddddddd-2222-0000-0000-000000000001', 'Week Range Test Restaurant')
ON CONFLICT (id) DO NOTHING;

-- Test 1: the constraint exists
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'schedule_publications_week_range_valid'
      AND conrelid = 'public.schedule_publications'::regclass
  ),
  'schedule_publications_week_range_valid constraint exists'
);

-- Test 2: a correct Mon..Sun span is accepted
SELECT lives_ok(
  $$
    INSERT INTO schedule_publications
      (restaurant_id, week_start_date, week_end_date, published_by)
    VALUES
      ('dddddddd-2222-0000-0000-000000000001', DATE '2026-07-27', DATE '2026-08-02', NULL)
  $$,
  'a 6-day Mon..Sun span is accepted'
);

-- Test 3: the Mon..Mon spill is rejected
SELECT throws_ok(
  $$
    INSERT INTO schedule_publications
      (restaurant_id, week_start_date, week_end_date, published_by)
    VALUES
      ('dddddddd-2222-0000-0000-000000000001', DATE '2026-07-27', DATE '2026-08-03', NULL)
  $$,
  '23514',
  NULL,
  'the 8-day Mon..Mon spill is rejected by the CHECK constraint'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4: Run the pgTAP test**

Run: `npm run test:db`
Expected: `schedule_publication_range.test.sql` reports 3/3 passing.

If Test 2 fails on a NOT NULL violation for a column not listed above, inspect the table first with `\d schedule_publications` and add the required column to both INSERTs — do not weaken the assertions.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260727180000_schedule_publication_range_check.sql supabase/tests/schedule_publication_range.test.sql
git commit -m "feat(db): reject 8-day schedule publication spans

NOT VALID so the 44 historical rows are untouched while new writes fail
loudly instead of drifting silently.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: E2E across the full seam, pinned off-UTC

**Files:**
- Create: `tests/e2e/schedule-publish-week-range.spec.ts`

**Interfaces:**
- Consumes: `signUpAndCreateRestaurant`, `exposeSupabaseHelpers`, `generateTestUser` from `../helpers/e2e-supabase`.
- Produces: nothing new.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/schedule-publish-week-range.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, exposeSupabaseHelpers, generateTestUser } from '../helpers/e2e-supabase';

/**
 * Pinning the timezone is what gives this spec its value. Playwright sets no
 * timezoneId and CI runs UTC — the one zone where this bug is invisible.
 * Unpinned, these assertions would pass before the fix, after the fix, and
 * straight through a future regression.
 */
test.use({ timezoneId: 'America/New_York' });

test.describe('Schedule publish week range', () => {
  test('publishing a week stores a Mon-Sun span, not Mon-Mon', async ({ page }) => {
    const testUser = generateTestUser('pubweek');
    await signUpAndCreateRestaurant(page, testUser);
    await exposeSupabaseHelpers(page);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    // Seed one shift so there is something to publish.
    await page.evaluate(async ({ restId }) => {
      const supabase = (window as any).__supabase;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('No authenticated user found');

      const { data: employee, error: empError } = await supabase
        .from('employees')
        .insert({
          restaurant_id: restId,
          user_id: user.id,
          name: 'Pat Publisher',
          position: 'Server',
          status: 'active',
          is_active: true,
          compensation_type: 'hourly',
          hourly_rate: 1500,
        })
        .select()
        .single();
      if (empError) throw new Error(`employees insert failed: ${empError.message}`);

      // Wednesday of the current local week, safely inside Mon..Sun.
      const now = new Date();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const wednesday = new Date(monday);
      wednesday.setDate(monday.getDate() + 2);
      wednesday.setHours(10, 0, 0, 0);
      const end = new Date(wednesday);
      end.setHours(16, 0, 0, 0);

      const { error: shiftError } = await supabase.from('shifts').insert({
        restaurant_id: restId,
        employee_id: employee.id,
        start_time: wednesday.toISOString(),
        end_time: end.toISOString(),
        position: 'Server',
      });
      if (shiftError) throw new Error(`shifts insert failed: ${shiftError.message}`);
    }, { restId: restaurantId });

    await page.goto('/scheduling');

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('button', { name: 'Publish Schedule' }).click();

    // Wait for the publication row to land.
    await expect
      .poll(
        async () =>
          await page.evaluate(async ({ restId }) => {
            const supabase = (window as any).__supabase;
            const { data } = await supabase
              .from('schedule_publications')
              .select('week_start_date, week_end_date')
              .eq('restaurant_id', restId)
              .order('published_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            return data;
          }, { restId: restaurantId }),
        { timeout: 15_000 },
      )
      .not.toBeNull();

    const publication = await page.evaluate(async ({ restId }) => {
      const supabase = (window as any).__supabase;
      const { data } = await supabase
        .from('schedule_publications')
        .select('week_start_date, week_end_date')
        .eq('restaurant_id', restId)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    }, { restId: restaurantId });

    const start = new Date(`${publication.week_start_date}T00:00:00`);
    const finish = new Date(`${publication.week_end_date}T00:00:00`);
    const spanDays = Math.round((finish.getTime() - start.getTime()) / 86_400_000);

    // The bug produced 7 (Mon..Mon, 8 inclusive days).
    expect(spanDays).toBe(6);
    expect(start.getDay()).toBe(1); // Monday
    expect(finish.getDay()).toBe(0); // Sunday
  });
});
```


- [ ] **Step 2: Run the spec**

Run: `npx playwright test --project=e2e tests/e2e/schedule-publish-week-range.spec.ts`
Expected: PASS. If the `Publish` button is not found, open the trace (`npx playwright show-trace`) and confirm the schedule page finished loading; do not weaken the selector to a CSS class.

- [ ] **Step 3: Confirm it would have caught the bug**

Run:

```bash
git stash && npx playwright test --project=e2e tests/e2e/schedule-publish-week-range.spec.ts; git stash pop
```

Expected: FAIL with `expected 6, received 7` while the fix is stashed. This is the proof the spec is load-bearing. If it PASSES with the fix stashed, the timezone pin is not taking effect — stop and investigate before continuing.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/schedule-publish-week-range.spec.ts
git commit -m "test(e2e): assert published week spans Mon-Sun across the full seam

Pins timezoneId=America/New_York; under CI's UTC this bug is invisible.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `usePublishSchedule` / `useUnpublishSchedule` date params | 2 |
| `useWeekPublicationStatus` — both serializations | 3 |
| `useOpenShifts` date params | 1 |
| `useTemplateDeletionImpact` (`toDateStr`) | 1 |
| `notify-schedule-published` restaurant-tz bounds | 5 |
| `NOT VALID` CHECK constraint | 6 |
| Hook-level unit tests (not `formatLocalDate`) | 1, 2, 3 |
| TZ matrix + CI wiring | 4 |
| E2E with pinned `timezoneId` | 7 |
| pgTAP for the constraint | 6 |
| No data migration / no backfill | All — no task writes to existing rows |
| `publish_schedule` body untouched (separate task) | All — no task edits that migration |

No gaps.

**Placeholder scan:** No TBDs. Every code step carries complete code. Two steps carry conditional recovery instructions (Task 6 Step 4, Task 7 Step 2) that name the diagnostic to run rather than saying "handle errors."

**Type consistency:** `formatLocalDate(date: Date): string` is used identically in Tasks 1–3. `makeWeek()` / `createWrapper()` are defined once in Task 1 Step 1 and reused by Tasks 2–3 within the same file. `makeBuilder` (Task 3) is distinct from the pre-existing `makeQueryBuilder` in `useTemplateDeletionImpact.test.tsx` — different files, no collision.

