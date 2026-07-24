# Scheduling conflict warnings are bucketed by UTC date, not restaurant-local date

**Date:** 2026-07-23
**Branch:** `fix/timeoff-conflict-local-date`
**Status:** Design — pending Phase 2.5 review

## The report

Assigning Rakiyah James to **Fri Jul 31** in the Shift Planner raised a
"Scheduling Warning" listing two conflicts, neither of which mentions Jul 31:

> Employee has approved time-off from 2026-08-01 to 2026-08-07
> Shift on **Thu, Jul 30** is outside availability (available 10:00 AM – 11:30 PM)

Two independent defects, both instances of the same class: **a calendar date
derived in the wrong timezone frame.**

## Root cause 1 — `check_timeoff_conflict` buckets by UTC date

`supabase/migrations/20251123100050_create_availability_tables.sql` matches the
shift against `time_off_requests` using the **UTC** calendar date of the shift's
instants:

```sql
(DATE(p_start_time AT TIME ZONE 'UTC') BETWEEN tor.start_date AND tor.end_date)
OR (DATE(p_end_time   AT TIME ZONE 'UTC') BETWEEN tor.start_date AND tor.end_date)
OR (tor.start_date BETWEEN DATE(p_start_time AT TIME ZONE 'UTC')
                       AND DATE(p_end_time AT TIME ZONE 'UTC'))
```

`time_off_requests.start_date` / `end_date` are plain `DATE` columns holding the
**restaurant-local** calendar days the employee requested off. Comparing them
against a UTC-derived date is a frame mismatch.

Rakiyah's shift is Jul 31, 7:00–11:59 PM `America/Chicago`, stored as
`2026-08-01 00:00Z → 2026-08-01 04:59Z`. In UTC it is an **August 1** shift, so
it matches her approved Aug 1–7 time off. Verified against production by calling
the RPC directly: `has_conflict: true`.

Every restaurant on the platform is affected. All 35 production restaurants sit
in negative-UTC-offset timezones (31 `America/Chicago`, one each `New_York`,
`Denver`, `Los_Angeles`, `Bahia_Banderas`), so **any evening shift** rolls
forward a day in UTC.

Two symptoms, and the second is the dangerous one:

| | Shift | Time off | UTC date | Result |
|---|---|---|---|---|
| **False positive** | Jul 31 7:00–11:59 PM | Aug 1–7 | Aug 1 | Warns on a day that is not off |
| **False negative** | Aug 10 7:00–11:59 PM | Aug 10 | Aug 11 | **Silently schedules over approved time off** |

The false negative was confirmed on production: an evening shift on an approved
day off returned `conflicts_found: 0`. A 90-day sweep of 3,148 production shifts
found **12 false positives and 0 false negatives so far** — zero only because no
late shift has yet happened to be booked on an approved day off. The miss is
latent, not absent.

## Root cause 2 — `extractDayLabel` re-converts an already-local date

`src/lib/conflictFormatUtils.ts:28-33`:

```ts
const date = new Date(dateMatch[0] + 'T00:00:00Z');
return date.toLocaleDateString('en-US', { …, timeZone: timezone });
```

The availability conflict here is **genuine** — the shift ends 23:59 and her
Friday window ends 23:30 — and the SQL correctly returns `Shift on 2026-07-31`.
The client then mangles the label: `2026-07-31` is parsed as UTC midnight and
rendered in `America/Chicago`, i.e. 7:00 PM the previous evening → **"Thu, Jul
30"**.

`tor.start_date`-style values are *calendar dates*; they have no timezone. Any
round trip through an instant is wrong by construction.

The sibling helper `extractDateAnchor` (lines 44-50) already does this correctly
via local-midnight `new Date(y, m-1, d)`, and `src/lib/dateOnly.ts` (landed in
PR #489) exists precisely for this. This is a one-line miss, not a missing
abstraction.

Impact: **every availability warning ever shown has displayed the wrong day**,
for every restaurant. Existing tests in `tests/unit/conflictFormatUtils.test.ts`
assert only the time range (`toContain('10:00 PM – 10:30 PM')`) and never the
day label, which is why nothing caught it.

## Root cause 3 — `checkTimeOffConflicts` uses browser-local midnight

`src/lib/shiftValidator.ts:43-68` builds `new Date(\`${start_date}T00:00:00\`)`
in the **viewer's browser** timezone, not the restaurant's.

**This code path is unreachable in production.** It runs only when
`options.timeOffRequests` is passed to `validateShift`, and a full-tree grep
shows no caller does:

- `src/lib/shiftMutationPipeline.ts:48` → passes `{ excludeShiftId }` only
- `src/components/scheduling/ShiftTimeline/TimelineShiftEditor.tsx:144` → passes `{ excludeShiftId }` only

Those are the only two `validateShift(` call sites. `timeOffRequests` appears
nowhere outside `shiftValidator.ts` itself and unrelated `useTimeOffRequests`
consumers. The option is exercised solely by its own unit tests.

## Decisions

### D1 — Derive the timezone from the employee's restaurant, not a new parameter

`check_timeoff_conflict(p_employee_id, p_start_time, p_end_time)` has no
`p_restaurant_id`. Adding one would change the signature, forcing a `DROP` +
recreate and a matching edit to `useConflictDetection.tsx`.

`employees` is already restaurant-scoped, so the timezone is derivable:

```sql
SELECT r.timezone INTO v_tz
FROM employees e JOIN restaurants r ON r.id = e.restaurant_id
WHERE e.id = p_employee_id;
```

Signature and return shape stay identical → plain `CREATE OR REPLACE`, no client
change. This mirrors the precedent set by
`20260712120000_availability_conflict_local_tz.sql`, whose header notes exactly
this ("Signature/return shape unchanged, so no DROP is required").

Timezone is validated against `pg_timezone_names` with a `UTC` fallback,
identical to `check_availability_conflict`, so a null/blank/garbage
`restaurants.timezone` degrades to today's behaviour rather than erroring.

### D2 — Replace the three-way OR with a symmetric interval overlap

Once both sides are in the same frame, the three ORs collapse to the standard
overlap predicate, which is equivalent and easier to verify:

```sql
tor.start_date <= v_end_date AND tor.end_date >= v_start_date
```

### D3 — A shift ending exactly at local midnight does not claim the next day

Mirroring `check_availability_conflict` lines 60-64: when the local end time is
exactly `00:00` and the shift has positive duration, the end date is pulled back
a day. Without this, a 6 PM–midnight shift would spuriously conflict with time
off starting the following morning — reintroducing the same class of
false positive one day later.

### D4 — Delete the dead client-side time-off check rather than fix it

Given root cause 3 is unreachable, there are two options:

1. **Make it timezone-aware** — add a `timezone` to `ValidateOptions` and bucket
   via `formatLocalDateInTz`. This invents configuration for a path nothing
   calls, and leaves a second source of time-off truth that a future caller
   could wire up in parallel with the RPC — producing the warning **twice** in
   the conflict dialog (once via `warnings`, once via `conflicts`).
2. **Delete it** — remove `checkTimeOffConflicts`, the `timeOffRequests` option,
   and the now-unused `TimeOffRequest` import.

**Chosen: delete.** The RPC is the authoritative check and D1 makes it correct;
a divergent client mirror is exactly the failure mode the 2026-07-12 lesson
warns about ("availability readers must mirror the GRID"). The ~8 unit tests
that cover this option are not lost — their scenarios are re-expressed as pgTAP
tests against the RPC, where the live logic actually is. That is a net coverage
gain, not a reduction.

This is a deliberate widening of item 3 from the approved scope (fix → remove).
Flagged here for review; if the reviewer prefers option 1 the fix is small and
self-contained either way.

## Changes

| File | Change |
|---|---|
| `supabase/migrations/2026072400000_timeoff_conflict_local_tz.sql` | **new** — `CREATE OR REPLACE check_timeoff_conflict` in restaurant-local frame; adds `SET search_path = public, pg_catalog` (the original has a mutable search_path) |
| `supabase/tests/timeoff_conflict_local_tz.sql` | **new** — pgTAP: Jul-31 false positive, Aug-10 false negative, midnight-boundary, multi-day span, missing/invalid timezone fallback |
| `src/lib/conflictFormatUtils.ts` | `extractDayLabel` → `formatDateOnly(dateStr, 'EEE, MMM d')`; drop the now-meaningless `timezone` argument on that path |
| `tests/unit/conflictFormatUtils.test.ts` | assert the **day label**, not just the time range — the assertion whose absence hid this |
| `src/lib/shiftValidator.ts` | remove `checkTimeOffConflicts`, `ValidateOptions.timeOffRequests`, `TimeOffRequest` import |
| `tests/unit/shiftValidator.test.ts` | remove the `TIME_OFF` block (~8 tests), superseded by pgTAP |

## Risks

- **Behaviour change on a live warning path.** Restaurants will see *fewer*
  time-off warnings (the 12 false positives disappear) and, eventually, *more*
  real ones. This is the intended correction, but it is user-visible.
- **`restaurants.timezone` is not guaranteed non-null.** Handled by the
  `pg_timezone_names` validation + `UTC` fallback (D1); with that fallback the
  worst case is exactly today's behaviour.
- **Timezone-sensitive unit tests.** Per the 2026-07-21 lesson, the full suite
  must be run once under `TZ=UTC` — that is what reproduces the CI-vs-dev
  divergence. `tests/unit/shiftValidator.test.ts` seeds naive date strings
  (`'2026-03-14'`, `'2026-03-15'`); those tests are being deleted, but the
  remaining overlap/clopen tests in that file must still be checked under
  `TZ=UTC`.
- **`scheduling-conflicts.spec.ts` is known-flaky in CI** (a *varying* set of
  failures is the flakiness signature, a stable set is a real regression).

## Out of scope

PostHog instrumentation on the conflict dialog (open / cancel / "Assign
Anyway"). The dialog currently emits nothing but `$autocapture` — 25 Mac
`/scheduling` sessions over two days carry no conflict events at all, so
warning frequency and override rate are unmeasurable, and we cannot confirm from
telemetry that these fixes reduced spurious warnings. Deferred to its own PR per
the user's instruction to bundle items 1–3 alone.
