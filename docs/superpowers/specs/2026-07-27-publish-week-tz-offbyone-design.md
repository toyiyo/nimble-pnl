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

### Not changed

- **SQL / migrations.** `publish_schedule`, `unpublish_schedule`, and
  `get_open_shifts` are correct once handed a correct range.
- **Edge functions.** `broadcast-open-shifts` and `notify-schedule-published`
  read `week_start_date` / `week_end_date` straight from the publication row.
- **Existing data.** Per product decision, the 44 stored rows are left as-is. No
  backfill migration, and no shift is unpublished. The one live spill
  (Mon 2026-08-03) is handled manually in the UI; the 2 pending claims are
  ordinary approve/reject business decisions.

## Testing

### Unit — `tests/unit/scheduleWeekRange.test.ts`

TZ-portable by construction. Per the 2026-05-10 lesson, fixtures use
`new Date(year, month, day)` (local midnight on the requested calendar day in
**any** process TZ) rather than ISO-string fixtures, which mask this bug class
entirely.

Assertions:
- `formatLocalDate(weekStart)` → `2026-07-27` and `formatLocalDate(weekEnd)` →
  `2026-08-02` for `weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 })`.
- The range spans exactly **6** days, never 7.
- A regression guard asserting the serialized end is **not** the following
  Monday.

The suite is additionally run under `TZ=America/New_York` (reproduces the
reported forward slip), `TZ=UTC` (CI's zone, where the bug is invisible), and
`TZ=Asia/Tokyo` (catches the mirror-image backward slip on `weekStart`). All
three must pass.

### E2E

Extend a scheduling spec to publish a week and assert the resulting
`schedule_publications` row satisfies `week_end_date - week_start_date = 6`.
This is the assertion that would have caught the bug in production, and it
covers the cross-layer seam (UI → hook → RPC → row) that unit tests cannot.

### Verification of the mirror-image case

Before/after runs under a UTC+ zone confirm `weekStart` no longer slips backward
to Sunday — the failure mode a US-only test matrix would miss.

## Risks

- **Low.** The change narrows an over-broad range to its intended bounds. No
  schema change, no data mutation, no API contract change.
- Managers who had come to rely on the extra Monday appearing in the broadcast
  will see it stop. That is the reported bug, not a regression.
