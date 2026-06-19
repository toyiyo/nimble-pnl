# Design: Remove self-service breaks from the employee Time Clock

**Date:** 2026-06-18
**Branch:** `fix/employee-clock-remove-break`
**Author:** Jose M Delgado (via /dev)

## Problem

The employee Time Clock (`src/pages/EmployeeClock.tsx`, route `/employee/clock`)
offers self-service **"Start Break"** and **"End Break"** buttons. This does not
match restaurant operational reality:

- Short breaks (< 15 min) are **not** clock-outs — staff stay on the clock.
- Longer breaks / lunch are handled as a real **clock-out then clock-in**, not a
  "break" punch.

So a self-service "break" concept on this screen is confusing and unused.

### Reinforcing finding: the break UI is already partly dead/broken

`get_employee_punch_status` (both
`supabase/migrations/20251114100100_create_time_tracking_tables.sql` and
`supabase/migrations/20251115165031_*.sql`) computes:

```sql
is_clocked_in = (last_punch_type IN ('clock_in', 'break_end'))
on_break      = (last_punch_type = 'break_start')
```

These are **mutually exclusive**: when `on_break` is true (last punch is
`break_start`), `is_clocked_in` is false. But `EmployeeClock.tsx` nests both the
"On Break" badge and the "End Break" button **inside** the `isClockedIn === true`
branch. Therefore:

- The instant an employee taps **Start Break**, a `break_start` punch is written,
  `is_clocked_in` flips to **false**, and the UI shows the **"Clocked Out"** badge
  and a **"Clock In"** button — as if they had clocked out.
- The "On Break" badge and "End Break" button are **unreachable** in practice
  (they require `is_clocked_in && on_break`, which the RPC never returns together).

Removing the break UI deletes code paths that never execute correctly.

## Goal

Make the employee Time Clock a clean **Clock In / Clock Out** screen. Remove every
self-service break affordance (buttons + status badge). Leave the underlying
break **data** system fully intact, because break punches still legitimately
arrive from other sources and payroll depends on them.

## Scope

### In scope (one file + one test)

`src/pages/EmployeeClock.tsx`:

1. **Action buttons → exactly one per state.**
   - Not clocked in → single **Clock In** button.
   - Clocked in → single **Clock Out** button.
   - Delete the `onBreak` button branch (Start Break / End Break).
   - Because there is now always exactly one action, collapse the
     `grid grid-cols-1 md:grid-cols-2 gap-4` wrapper into a single full-width
     button (avoids an awkward half-width button on desktop).

2. **Status badge → two states.**
   - **Clocked In** (default/green) / **Clocked Out** (outline).
   - Delete the "On Break" (Coffee) badge branch and the now-unused `onBreak`
     local variable.

3. **Type / dead-code cleanup.**
   - Narrow `pendingPunchType` state and `handleInitiatePunch`'s parameter from
     `'clock_in' | 'clock_out' | 'break_start' | 'break_end'` →
     `'clock_in' | 'clock_out'`.
   - Simplify the camera-dialog confirm-button label to
     `pendingPunchType === 'clock_out' ? 'Confirm & Clock Out' : 'Confirm & Clock In'`.
   - The geofence flow (clock-in only) and the photo/skip flow are unchanged.

### Explicitly NOT in scope (kept as-is)

- **"Today's Activity" history list**, including the `break_start` (Coffee) and
  `break_end` (PlayCircle) row icons — break punches can still exist from other
  sources, so the read-only history must still render them. (`Coffee` and
  `PlayCircle` icon imports remain in use: Coffee in history, PlayCircle in
  history + the "Clocked In" badge.)
- **Break punch types** (`break_start` / `break_end`) in TS types, the SQL
  `CHECK` constraint, and edge functions.
- **Payroll / labor math** that excludes break periods
  (`src/utils/payrollCalculations.ts`, `supabase/functions/_shared/laborCalculations.ts`,
  `src/utils/timePunchProcessing.ts`).
- **External break sources**: Sling sync, CSV/file import (`TimePunchUploadSheet`).
- **Manager punch entry** in `src/pages/TimePunchesManager.tsx` (a manager can
  still add a `break_start` / `break_end` punch manually).

## Resulting button / badge matrix

| Punch state (`status`) | `is_clocked_in` | `on_break` | Badge (new) | Button (new) |
|---|---|---|---|---|
| last = `clock_in` / `break_end` | true | false | Clocked In | Clock Out |
| last = `clock_out` / none | false | false | Clocked Out | Clock In |
| last = `break_start` (external) | false | true | **Clocked Out** | **Clock In** |

The third row is the only behavioral "edge case": an externally-sourced
`break_start` makes the employee read as Clocked Out and offers Clock In. This is
identical to today's behavior and is acceptable — a manager reconciles unmatched
break punches. Accepted trade-off per product direction.

## Testing

New `tests/unit/EmployeeClock.test.tsx`, mirroring the hook-mocking pattern in
`tests/unit/EmployeePin.test.tsx` (mock `useRestaurantContext`,
`useCurrentEmployee` / `useEmployeePunchStatus` / `useCreateTimePunch` /
`useTimePunches` from `@/hooks/useTimePunches`, `useGeofenceCheck`, `use-toast`).

Assertions across three mocked `status` states (clocked-out, clocked-in,
`on_break: true`):

1. **No** element with text "Start Break" renders in any state.
2. **No** element with text "End Break" renders in any state.
3. **No** "On Break" badge renders, even when `status.on_break === true`.
4. Clocked-out state shows a **Clock In** button; clocked-in state shows a
   **Clock Out** button.

This gives real behavioral coverage on the changed component (important for the
SonarCloud new-code coverage gate) and pins the requirement against regression.

## Accessibility / styling

- Buttons keep their existing accessible text labels (Clock In / Clock Out) and
  the large `h-24 text-xl` touch-target sizing.
- No direct color tokens are introduced; the removed "On Break" badge used
  `yellow-*` utilities, so the net change reduces non-semantic color usage.

## Risks

- **Low.** Single-file UI change; no data, schema, RLS, or edge-function change.
- The only consumer impact is visual (fewer buttons). Payroll, imports, and
  manager tooling are untouched and continue to process break punches.

## Out-of-scope follow-ups (not done here)

- Whether to eventually drop `break_*` punch types entirely or stop Sling from
  syncing breaks is a larger product/data decision and is intentionally deferred.
