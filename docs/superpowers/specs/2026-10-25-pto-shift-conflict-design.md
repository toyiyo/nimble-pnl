# Time-off approval: handle the scheduled shifts

Date: 2026-10-25
Branch: `feature/pto-shift-conflict`
Status: STE-aligned draft

## Problem

A manager approves a time-off request. The employee can still have shifts
in the time-off dates. Today, the approval does not look at these shifts.
The manager must find each shift by hand and delete it or post it for
trade.

## Goal

When the manager approves a request, the app checks for shifts in the
time-off dates. If shifts exist, the manager makes one choice for all of
them:

1. **Post for trade** (default). Each shift goes to the trade board with a
   note. The default note is `Approved PTO`. The manager can change it.
2. **Delete the shifts.** The shifts leave the schedule.

If no shifts exist, the approval works as today, with one click.

The user selected "one choice for all shifts". A choice for each shift is
out of scope.

## Current code (cited)

- The Approve button calls `onApprove(request)`
  (`src/components/timeoff/TimeOffRow.tsx:103`). The button is disabled
  while an approve or a reject runs (`src/components/timeoff/TimeOffRow.tsx:104`).
- `handleApprove` calls the approve mutation at once
  (`src/components/TimeOffList.tsx:59`). A `PolicyWarningError` opens the
  "Shift protection findings" dialog. "Approve anyway" retries with
  `override: true` (`src/components/TimeOffList.tsx:71`).
- The approve mutation calls the `review_time_off_request` RPC
  (`src/hooks/useTimeOffRequests.tsx:115`). The hook does not show an
  error toast for a `PolicyWarningError`
  (`src/hooks/useTimeOffRequests.tsx:162`).
- The `get_timeoff_coverage_impact` RPC already returns the employee's
  shifts in the request dates
  (`supabase/migrations/20260903034600_shift_protection_read_rpcs.sql:143`).
  It filters on the same employee, status `scheduled` or `confirmed`, and
  the restaurant-local date of `start_time` between `start_date` and
  `end_date` (`supabase/migrations/20260903034600_shift_protection_read_rpcs.sql:218-221`).
  It requires the `edit:scheduling` capability
  (`supabase/migrations/20260903034600_shift_protection_read_rpcs.sql:158`).
- The front end reads that RPC through `useTimeoffCoverageImpact`
  (`src/hooks/useShiftProtection.ts:100`). Each row has `shift_id`,
  `position`, `start_time`, and `end_time`
  (`src/hooks/useShiftProtection.ts:80`).
- The `create_shift_trade_for_employee` RPC lets a role with
  `edit:scheduling` post a trade for an employee
  (`supabase/migrations/20260821120000_trade_approval_area_grant.sql:164`,
  `:181`). It accepts a `p_reason` note (`:169`). It rejects a shift that
  is not `scheduled` or `confirmed` (`:204`). A second open trade on the
  same shift raises `This shift already has an active trade` (`:258-259`).
- `useCreateShiftTradeForEmployee` wraps that RPC and shows one toast for
  each call (`src/hooks/useShiftTrades.ts:361`). The trade email helper
  `sendShiftTradeNotification` is not exported
  (`src/hooks/useShiftTrades.ts:87`).
- `useDeleteShift` deletes one shift with a `restaurant_id` filter and
  shows one toast for each call (`src/hooks/useShifts.tsx:405`). Its
  `skipLegacyNotify` option skips the "shift deleted" email
  (`src/hooks/useShifts.tsx:436`).

## Design

No database change. The design reuses two existing RPCs.

### Flow

```text
Manager clicks Approve
  └─ fetch get_timeoff_coverage_impact(request.id)   (React Query fetchQuery)
       ├─ 0 shifts  → approve as today (no change)
       ├─ fetch fails → approve as today (no change), no shift action
       └─ N shifts  → open TimeOffShiftsDialog
                         └─ manager selects "Post for trade" or "Delete"
                         └─ manager clicks "Approve and post N shifts"
                              1. approve (review_time_off_request)
                                   └─ PolicyWarningError → close this dialog,
                                      open the existing policy dialog and keep
                                      the shift choice; "Approve anyway"
                                      continues at step 2
                              2. apply the choice to all N shifts
                                 (Promise.allSettled)
                              3. one summary toast
```

The approval runs first. If the approval fails, no shift changes. If a
shift action fails after the approval, the request stays approved. The
toast then tells the manager how many shifts failed.

### New hook: `useApplyTimeOffShiftAction`

File: `src/hooks/useTimeOffShiftAction.ts`.

```ts
type TimeOffShiftAction =
  | { kind: 'trade'; note: string }
  | { kind: 'delete' };

mutateAsync({
  restaurantId,
  employeeId,
  shiftIds,
  action,
}): Promise<{ done: number; skipped: number; failed: number }>
```

- `trade`: call `create_shift_trade_for_employee` for each shift, with
  `p_reason` set to the trimmed note. An empty note becomes
  `Approved PTO`. Send the `created` trade email for each new trade.
- `delete`: delete each shift with `.eq('id', id).eq('restaurant_id', restaurantId)`.
  Skip the "shift deleted" email. The employee already gets the
  "time off approved" email.
- Run the calls with `Promise.allSettled`, so one failure does not stop
  the others (lesson: `memory/lessons.md:820`).
- Count `This shift already has an active trade` as `skipped`, not
  `failed`. The shift is already on the trade board.
- Show one summary toast, not one toast for each shift.
- Invalidate `['shifts', restaurantId]` and the shift-trade queries.

The hook calls the RPC and the delete directly. It does not reuse
`useCreateShiftTradeForEmployee` or `useDeleteShift`, because both show
one toast for each shift. To send the trade email, export
`sendShiftTradeNotification` from `src/hooks/useShiftTrades.ts`.

A pure helper, `summarizeShiftResults(results)`, turns the settled
results into `{ done, skipped, failed }`. A second pure helper,
`timeOffShiftToastText(action, summary)`, makes the toast text. Unit
tests cover both.

### New component: `TimeOffShiftsDialog`

File: `src/components/timeoff/TimeOffShiftsDialog.tsx`.

- Uses the CLAUDE.md dialog structure: header with icon box,
  `DialogTitle` "Approve time off", and `DialogDescription` with the
  employee name, the dates, and the reason.
- An amber notice: "{Name} is scheduled for N shift(s) in these dates."
- A list of the shifts: day, position, start and end time. The time
  format matches the existing coverage list
  (`src/components/TimeOffList.tsx:190`).
- A `RadioGroup` with two options and a description under each.
  Default: "Post for trade".
- A "Trade note" `Input` with a `Label`. It shows only for "Post for
  trade". Default value: `Approved PTO`. Maximum 200 characters.
- Footer: "Cancel" and a primary button. The button text follows the
  choice: "Approve and post N shift(s)" or "Approve and delete N
  shift(s)". The button is disabled and shows "Approving…" while the
  approval or the shift action runs. This prevents a double click
  (lesson: `memory/lessons.md:218`).
- The dialog shows the shifts as props. It does not fetch data.

### Changes to `TimeOffList`

- `handleApprove` fetches the shifts with
  `queryClient.fetchQuery` on the `['timeoff-coverage-impact', id]` key.
  The fetch uses the same query function as `useTimeoffCoverageImpact`.
  Export that query function so both use one copy.
- New state: `shiftsTarget: { request, shifts } | null`.
- `policyTarget` gets an optional `shiftAction`. "Approve anyway" applies
  the stored shift action after the approval succeeds.
- The Approve button stays disabled while the shift fetch runs. The
  `isApproving` prop gets `approveRequest.isPending || checkingShifts`.
- The re-approve path in `DecidedHistory` uses the same `handleApprove`
  (`src/components/TimeOffList.tsx:138`), so it gets the same check.

## Tests

- Unit: `summarizeShiftResults` and `timeOffShiftToastText`.
- Unit: `useApplyTimeOffShiftAction` with a mocked Supabase client.
  Cases: all trades succeed, one trade already exists (skipped), one
  delete fails (failed), an empty note becomes `Approved PTO`.
- Unit: `TimeOffList` approve flow. Cases: 0 shifts approves at once;
  N shifts opens the dialog; confirm calls approve and then the shift
  action; a `PolicyWarningError` keeps the shift choice for "Approve
  anyway".
- Unit: `TimeOffShiftsDialog` toggles the note field and the button text.
- No SQL test. No SQL changes.

## Decided trade-offs

- **Not atomic.** The approval and the shift actions are separate calls.
  A single SQL function could do all of it in one transaction. That adds
  a migration and a pgTAP test. The user asked to keep this simple. The
  failure mode is safe: the request is approved, and the toast names the
  failed count.
- **One choice for all shifts.** The user selected this.
- **A posted shift stays assigned** to the employee until a coworker picks
  it up and a manager approves the trade. This is the current trade flow.
- **No "shift deleted" email** on delete. The employee gets the "time off
  approved" email.
- **A failed shift fetch does not block the approval.** The manager can
  still approve. The approval then does not offer a shift action.

## Out of scope

- A choice for each shift.
- An automatic check when an employee creates a request.
- A change to the policy rules in `review_time_off_request`.
