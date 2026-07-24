# Design: Shift-date DST anchor for recurring availability conflicts

**Date:** 2026-07-24
**Area:** Scheduling — availability conflict warnings
**File:** `src/lib/conflictFormatUtils.ts`

## Problem

`formatConflictLine` converts the stored UTC `available_start` / `available_end`
TIME values to a local display window. To pick the right DST offset it needs a
date anchor. Today it uses the shift's own date (`extractDateAnchor(message)`)
**only** for `conflict_type === 'exception'`; for `conflict_type === 'recurring'`
it falls back to `referenceDate`, which production callers omit — so it defaults
to *today*.

**Symptom:** a recurring availability conflict for a shift whose date is in a
different DST period than today displays the available window off by one hour.

Example — today is CDT (summer), a recurring conflict for `Shift on 2026-01-15`
(CST) in `America/Chicago` with stored `available_start='04:00:00'`:

- Intended window: 10:00 PM CST (`04:00 UTC − 6`).
- Rendered with *today's* CDT anchor: `04:00 UTC − 5` = **11:00 PM** (wrong).
- Rendered with the shift-date CST anchor: **10:00 PM** (correct).

Pre-existing, introduced by PR #549 ("correct DST anchor in availability
conflict warning"), which restricted the shift-date anchor to `exception`.

## Verification of PR #549's exception-only restriction

#549 restricted the shift-date anchor to exceptions because the two writers
anchor differently:

- Exception writer `AvailabilityExceptionDialog.tsx` calls
  `localTimeToUtcTime(..., date)` — anchored to the exception's own date.
- Recurring writer `AvailabilityDialog.tsx` calls `localTimeToUtcTime(..., tz)`
  with no date — anchored to *today*.

#549 reasoned the recurring reader should mirror its editor and use *today*.
That reasoning is sound for the availability **editor** round-trip, but **not**
for a dated conflict warning, for two reasons:

1. **The SQL comparison frame is the shift date.** In
   `check_availability_conflict` (migration `20260712120000`), recurring
   windows are compared against the shift using `v_current_date` (the shift's
   local date) as the conversion anchor — identical to the exception path. The
   returned `available_start`/`available_end` are the raw stored TIMEs, so the
   client must re-convert them with the shift-date anchor to display the window
   the SQL **actually evaluated**. Using *today* can render a window that
   contradicts the very conflict being reported when today and the shift date
   straddle a DST boundary.
2. **Every other dated recurring reader already anchors to the date**, not
   today: `TeamAvailabilityGrid.tsx`, `EmployeePortal.tsx`,
   `effectiveAvailability.ts`, `DeleteAvailabilityDialog.tsx`. Only the
   single-row editor uses *today*, and it is not a dated context.

Conclusion: #549's exception-only restriction was an **incomplete** fix. The
recurring case should use the same shift-date anchor. Both recurring and
exception "outside availability" messages embed the shift date the same way
(`'Shift on ' || v_current_date`), so `extractDateAnchor` supplies the anchor
for both.

## Change

In `formatConflictLine`, replace the exception-only ternary with unconditional
extraction. Time-off conflicts already return earlier, so this only affects
recurring/exception window rendering:

```ts
const anchor = extractDateAnchor(conflict.message) ?? referenceDate;
```

## Risk / blast radius

Low. `extractDateAnchor` returns `null` for the two windowless recurring
messages ("Employee is not available on this day of the week", "No availability
set…") — they carry no `available_start`/`available_end` and never reach this
code. When today and the shift date share a DST period, the shift-date anchor
equals today's, so output is byte-identical. The change only differs in the
cross-DST case — exactly the bug. No existing test changes behavior.

## Testing

Add to `tests/unit/conflictFormatUtils.test.ts`, mirroring the existing
`formatConflictLine – exception conflict uses exception-date anchor` block:

- Recurring conflict for a **January** shift (`04:00:00` UTC = 10 PM CST) with a
  **summer** `referenceDate` → must render `10:00 PM` (shift-date CST anchor),
  not `11:00 PM` (today's CDT anchor).
- Symmetric **June** shift (`03:00:00` UTC = 10 PM CDT) with a **winter**
  `referenceDate` → must render `10:00 PM`, not `9:00 PM`.

## Out of scope

- No change to the SQL, the writers, or the TIME-column schema.
- The inherent lossiness of the TIME column across DST boundaries
  (documented in `availabilityTimeUtils.ts`) is unchanged; this only aligns the
  conflict warning's display with the SQL's comparison frame.
