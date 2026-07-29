# Publish/open-shift week range off-by-one (UTC serialization of a local calendar-day token)

**Date:** 2026-07-27
**Branch:** `fix/publish-week-tz-offbyone`
**Status:** Approved

## Problem

Publishing a Mon–Sun week also publishes and broadcasts the **following Monday**.

Reported symptom: after publishing the week of Mon 2026-07-27, employees received
open-shift broadcasts for Mon 2026-08-03 and filed claims against them
(templates `Core - Week`, `Close-Lead-Week`), which surfaced in the manager's
Shift Trade Requests queue.

### Root cause

`src/pages/Scheduling.tsx:264` computes the week end as:

```ts
const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 }); // Sun 23:59:59.999 LOCAL
```

`src/hooks/useSchedulePublish.tsx:56` then serializes it for the RPC with:

```ts
const weekEndStr = weekEnd.toISOString().split('T')[0];
```

`toISOString()` reads **UTC** fields. In any timezone behind UTC, Sunday
23:59:59 local is already Monday in UTC, so the stored `week_end_date` lands one
day late:

| Host timezone | `week_start` | `week_end` |
|---|---|---|
| America/New_York | 2026-07-27 | **2026-08-03** ✗ |
| America/Chicago | 2026-07-27 | **2026-08-03** ✗ |
| America/Los_Angeles | 2026-07-27 | **2026-08-03** ✗ |
| UTC | 2026-07-27 | 2026-08-02 ✓ |
| Asia/Tokyo (mirror image) | **2026-07-26** ✗ | 2026-08-02 |

Note the Tokyo row: east of UTC the *start* slips backward to Sunday instead.
Both ends are wrong; only the direction differs.

### Why the grid views look correct

The scheduling grid serializes with local-field readers — `formatLocalDate` in
`src/lib/shiftInterval.ts`, via `getWeekDays`/`buildGridData` — and renders
Mon–Sun correctly. Only the code crossing the RPC boundary uses `toISOString()`.
The display layer and the data layer disagree, which is why the bug was
invisible in the UI that managers actually look at.

### Propagation chain

1. `publish_schedule` filters `start_time::date <= p_week_end` (inclusive), so
   the extra Monday's shifts get `is_published = true`.
2. `broadcast-open-shifts` reads `publication.week_end_date` and forwards it to
   `get_open_shifts`, so that Monday's open shifts are broadcast to staff.
3. Employees claim them; the claims appear in the manager's approval queue.

### Production impact (measured 2026-07-27)

- **44** `schedule_publications` rows across **9** restaurants have
  `week_end_date - week_start_date = 7` (8 inclusive days). Every publication row
  in the table is affected — there is no correct row.
- **26** distinct spilled Mondays; **9** were later legitimately published by
  their own week's publication, leaving **17** published only by the spill.
- Only **one** spilled Monday is still live: **2026-08-03** — 6 wrongly-published
  shifts at Rush Bowls Kallison Ranch, plus 2 pending claims at Wetzel's –
  Cold Stone – Alamo Ranch.

## Design principle

`weekStart` / `weekEnd` are **local-midnight calendar-day tokens**, not instants.
`useSharedWeek` builds them with `new Date(year, month - 1, day)`, and round-trips
them through the `?week=` URL param using local-field getters. A Date used this
way denotes *a day on a calendar*, not *a moment in time*.

That distinction dictates two different serializations:

| Target | Correct serialization |
|---|---|
| A `date` column (`week_start_date`) or a `p_week_*` RPC date param | `formatLocalDate(d)` — read **local** fields |
| A `timestamptz` column (`shifts.start_time`) | `d.toISOString()` — the **full** instant |

`toISOString().split('T')[0]` is neither. It reads UTC fields off a local token,
which corrupts the calendar day it represents.

Converting to the restaurant's timezone (`formatLocalDateInTz`) would be **wrong**
here and is explicitly rejected: the token already denotes a calendar day, so
re-anchoring it in another zone would shift it again. `formatLocalDateInTz` is
for bucketing genuine UTC instants (e.g. `shift.start_time`) by restaurant-local
day — a different problem.

## Approaches considered

**A — Use the existing `formatLocalDate()` at each call site.** *(chosen)*
Minimal diff; reuses `src/lib/shiftInterval.ts`, whose docstring already
documents this exact hazard and is already the convention in the grid path.

**B — Introduce a `formatWeekRange()` wrapper.** Puts the rationale in one named
place, but it is a thin wrapper over a helper that already carries that
docstring. Over-abstraction for 8 call sites.

**C — Clamp `p_week_end` to `p_week_start + 6` inside `publish_schedule`.**
Rejected as the primary fix: it does not touch the read path (`useOpenShifts`),
and silently storing something other than what the caller sent hides caller bugs
instead of fixing them.

## Changes

### `src/hooks/useSchedulePublish.tsx`

- `usePublishSchedule` — `formatLocalDate` for `p_week_start` / `p_week_end`.
- `useUnpublishSchedule` — same.
- `useWeekPublicationStatus` — **two** distinct fixes:
  - the `schedule_publications` lookup compares against `date` columns →
    `formatLocalDate`;
  - the `shifts.start_time` count compares against a `timestamptz` column → use
    the raw `weekStart.toISOString()` / `weekEnd.toISOString()` instants.

  Today this function splices date-only strings into hardcoded `T00:00:00Z` /
  `T23:59:59Z` literals. That is a **second, pre-existing bug**: for a US
  restaurant it drops the last ~5 hours of Sunday from the count. Fixing only
  the date-only serialization would leave it in place, so both are corrected
  together. Impact is low (the function only tests `count > 0`), but the range
  is wrong and sits on the same seam.

### `src/hooks/useOpenShifts.ts`

- `formatLocalDate` for both `get_open_shifts` date params.

### `src/hooks/useTemplateDeletionImpact.ts` *(added after design review)*

`toDateStr` (line 21-23) is the same `toISOString().split('T')[0]` anti-pattern,
feeding `p_week_start` / `p_week_end` of the same `get_open_shifts` RPC (lines
55-56). Its seed is `new Date()` — a genuine instant, not a calendar-day token —
but the intent is "today on the manager's calendar," so reading UTC fields makes
the 28-day open-spots window start a day early whenever a US manager loads the
page after ~7pm local. Replace `toDateStr` with `formatLocalDate`.

### `supabase/functions/notify-schedule-published/index.ts` *(added after design review — REQUIRED)*

**This fix is not optional: narrowing `weekEnd` without it introduces a new bug.**

Lines 105-106 select the "who is scheduled this week" set with:

```ts
.gte("start_time", `${weekStart}T00:00:00Z`)
.lte("start_time", `${weekEnd}T23:59:59Z`)
```

That splices a restaurant-local calendar date into a hardcoded **UTC** literal to
filter a `timestamptz` column — the same class of error as the primary bug. Today
it is *masked* by the primary bug: because `weekEnd` currently carries the
following Monday, the upper bound is a full day too generous and incidentally
covers Sunday-evening shifts (which are already Monday in UTC for US
restaurants).

Correcting `weekEnd` removes that accidental slack. Any employee whose only shift
that week starts Sunday evening after roughly 7pm local would fall outside the
bound and **silently stop receiving the "schedule published" notification**. The
set feeds `scheduledEmployeeIds` (line 114), which gates both push and email.

Fix: resolve the bounds as real instants in the restaurant's timezone using
`fromZonedTime` from `date-fns-tz` (already a dependency of the edge-function
runtime — see `_shared/availability-tz.ts`), matching the tz-aware
`AT TIME ZONE v_tz` convention the SQL layer already uses:

```ts
const startUtc = fromZonedTime(`${weekStart}T00:00:00`, tz).toISOString();
const endUtc   = fromZonedTime(`${weekEnd}T23:59:59.999`, tz).toISOString();
```

This requires adding `timezone` to the existing `restaurants` select (line 66,
currently `select("name")`). Per the 2026-07-02 lesson, the stored IANA value is
validated with a throwaway `Intl.DateTimeFormat` probe in try/catch and falls
back to the column default `America/Chicago` — an invalid IANA string throws
`RangeError` and would crash the whole notification send.

### `supabase/migrations/<ts>_schedule_publication_range_check.sql` *(added after design review)*

`schedule_publications` has no invariant on its stored range, which is how 44 bad
rows accumulated silently. Add:

a `BEFORE INSERT` trigger plus a `BEFORE UPDATE OF week_start_date,
week_end_date` trigger, both calling
`assert_schedule_publication_week_range()`, which raises `23514` when the span
is negative or exceeds 6 days. The update trigger additionally carries a `WHEN`
clause requiring the dates to actually change.

**Revised — this section originally specified a `NOT VALID CHECK` constraint,
and that was wrong.** Postgres re-evaluates a `CHECK` against the *full new row*
on every `UPDATE`, not just on `INSERT` or on updates that touch the checked
columns; `NOT VALID` only skips the one-time validation scan when the constraint
is created. Since all 44 historical rows hold an 8-day span, the constraint would
have rejected

```sql
UPDATE schedule_publications
SET open_shifts_broadcast_at = ..., open_shifts_broadcast_by = ...
WHERE id = ...
```

which is precisely what `broadcast-open-shifts` (`index.ts:273-280`) issues every
time a manager broadcasts open shifts for an already-published week. Because that
call site only logs `updateError` rather than throwing, the failure would have
been silent: push and email still go out, but `open_shifts_broadcast_at` never
gets stamped, so the button in `Scheduling.tsx:1009-1018` never flips to its
"already broadcast" state and managers are invited to re-broadcast and re-spam
staff. Reproduced against the local DB in a rolled-back transaction, and covered
now by test 5 of the pgTAP suite.

Scoping the update trigger to the two date columns keeps the historical rows
writable — the product decision not to backfill — while still rejecting any new
write that would produce a spilled span. The bound is `<= 6` rather than `= 6` so
a future partial-week publish stays legal; only the 8-day spill is forbidden, and
repairing a legacy row *to* a correct span stays allowed so a backfill remains
possible later without dropping the guard.

This raises loudly rather than clamping, which is the objection that ruled out
Approach C: silently coercing bad input hides caller bugs. The two are
complementary, not contradictory.

### Not changed

- **`publish_schedule` / `unpublish_schedule` / `get_open_shifts` bodies.** They
  consume a 6-day-inclusive `DATE` range correctly once handed one.
- **`broadcast-open-shifts`.** Verified: it reads `week_start_date` /
  `week_end_date` straight from the publication row (`index.ts:83,111-112`) and
  passes them to `get_open_shifts` unmodified. Unlike `notify-schedule-published`,
  it never re-derives a timestamp boundary.
- **Existing data.** Per product decision, the 44 stored rows are left as-is. No
  backfill, and no shift is unpublished. The one live spill (Mon 2026-08-03) is
  handled manually in the UI; the 2 pending claims are ordinary approve/reject
  business decisions.

## Testing

Design review flagged that the first draft's test plan was doubly ineffective —
it asserted against the wrong unit, in the one timezone where the bug is
invisible. Both are corrected below.

### Unit — `tests/unit/scheduleWeekRange.test.ts` (hook-level)

The tests must exercise **the hooks**, not `formatLocalDate`. `formatLocalDate`
is pre-existing and already correct; the bug lived in a raw
`toISOString().split('T')[0]` inlined in the hook bodies. A test asserting only
`formatLocalDate`'s output would still pass if someone reintroduced the inline
call tomorrow.

So: mock `supabase.rpc` / `supabase.from` and assert the exact `p_week_start` /
`p_week_end` string values that `usePublishSchedule`, `useUnpublishSchedule`,
`useOpenShifts`, `useWeekPublicationStatus`, and `useTemplateDeletionImpact`
actually send.

Fixtures use `new Date(year, month, day)` per the 2026-05-10 lesson — local
midnight on the requested calendar day in **any** process TZ. ISO-string
fixtures mask this bug class entirely.

Assertions:
- Publishing the week of `new Date(2026, 6, 27)` sends exactly
  `p_week_start: '2026-07-27'`, `p_week_end: '2026-08-02'`.
- The range spans exactly **6** days, never 7.
- An explicit guard that the serialized end is **not** `2026-08-03`.
- `useWeekPublicationStatus` sends full ISO instants (not date-only strings) for
  the `shifts.start_time` range.

### TZ matrix — the part that actually catches the bug

Run the suite under `TZ=America/New_York` (reproduces the reported forward
slip), `TZ=UTC` (CI's zone — where the bug is invisible), and `TZ=Asia/Tokyo`
(catches the mirror-image backward slip on `weekStart`). All three must pass.

An existing `test:tz` npm script covers only `schedule-solver-tz.test.ts` and is
**not wired into any CI workflow** (`.github/workflows/unit-tests.yml` runs
`npm run test:coverage` with no `TZ`). Extend `test:tz` to include this suite and
wire it into CI — otherwise the matrix exists only on developer machines and the
regression window reopens on the next refactor.

### E2E

Extend a scheduling spec to publish a week and assert the resulting
`schedule_publications` row satisfies `week_end_date - week_start_date = 6`.

**The spec must pin `test.use({ timezoneId: 'America/New_York' })`.** Playwright
sets no `timezoneId` today and CI runs UTC — the exact zone the table above shows
as blind to this bug. Without the pin, this assertion would pass identically
before the fix, after the fix, and after a future regression, providing zero
protection while appearing to be the headline test.

### pgTAP — `supabase/tests/`

Cover the new triggers: a 6-day range inserts cleanly, an 8-day range raises,
and — the case that drove the mechanism — a broadcast-columns-only `UPDATE` on a
legacy 8-day row still succeeds while an update that widens the span is rejected.
This locks in the invariant at the layer that will outlive any particular
frontend call site.

## Non-goals / decided trade-offs

Two pre-existing timezone issues surfaced during design review. Both are real,
neither is introduced or worsened by this change, and both are deliberately left
out of scope so the fix stays reviewable.

1. **The week boundary is browser-local, not restaurant-local.** `useSharedWeek`
   anchors the Mon–Sun token to the *viewer's* timezone. A manager working from a
   different zone than the restaurant gets a different week boundary than on-site
   staff. This is a distinct mismatch (viewer-tz vs restaurant-tz) from the one
   fixed here (UTC-field-read vs local-field-read). Recorded so a future reader
   does not mistake it for solved.

2. **`publish_schedule` / `unpublish_schedule` bucket shifts with
   `start_time::date`, which uses the database session timezone (UTC on
   Supabase), not the restaurant's.** Compare `get_open_shifts`, which correctly
   uses `(s.start_time AT TIME ZONE v_tz)::date`. A late-night shift can
   therefore land on the wrong side of the week boundary independent of the
   JS-layer bug. The first draft of this doc claimed the SQL was simply
   "correct"; that claim is **withdrawn** — it is correct for the specific
   off-by-one fixed here, and separately wrong for late-night shifts in non-UTC
   restaurants. Tracked as a follow-up, not fixed here.

## Prior art

The two-serialization rule is not novel — it is already the convention in the
codebase, which is what made the deviation diagnosable:

- `src/hooks/useShifts.tsx:63,66` and `src/hooks/useCopyWeekShifts.ts:41-42`
  correctly use full `toISOString()` for `timestamptz` comparisons.
- `src/lib/shiftInterval.ts:140` (`formatLocalDate`) and its use in
  `getWeekDays` / `buildGridData` correctly use local-field extraction for
  calendar days.

## Risks

- **Low for the hook changes.** They narrow an over-broad range to its intended
  bounds. No data mutation, no API contract change.
- **Moderate for `notify-schedule-published`,** which is the one place this
  change could regress behavior if done wrong — it decides who gets notified.
  Covered by the E2E and by explicit review of the Sunday-evening boundary case.
- **The guard cannot fail on existing rows,** because the update trigger only
  fires on statements that change `week_start_date` / `week_end_date`. The only
  way it can break a write is if that write is genuinely producing an 8+ day
  span, which is the bug. (An earlier revision of this design used a `NOT VALID
  CHECK` and claimed the same property; that claim was false for `UPDATE` — see
  the migration section above.)
- Managers who came to rely on the extra Monday appearing in the broadcast will
  see it stop. That is the reported bug, not a regression.
