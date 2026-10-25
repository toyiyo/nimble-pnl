# Time-off approval: handle the scheduled shifts

Date: 2026-10-25
Branch: `feature/pto-shift-conflict`
Status: STE-aligned draft, revised after the design review

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
  The row shows the Approve button only for a pending request
  (`src/components/timeoff/TimeOffRow.tsx:98`). A decided row has no
  Approve button.
- `handleApprove` calls the approve mutation at once
  (`src/components/TimeOffList.tsx:59`). A `PolicyWarningError` opens the
  "Shift protection findings" dialog. "Approve anyway" retries with
  `override: true` (`handleApproveAnyway`, `src/components/TimeOffList.tsx:68`).
- The approve mutation calls the `review_time_off_request` RPC
  (`src/hooks/useTimeOffRequests.tsx:115`). The hook does not show an
  error toast for a `PolicyWarningError`
  (`src/hooks/useTimeOffRequests.tsx:162`). On success it shows a
  "Time-off approved" toast.
- `review_time_off_request` rejects a request that is not pending with
  `Request is not pending`
  (`supabase/migrations/20260903034700_shift_protection_review_timeoff.sql:58-59`).
- The `get_timeoff_coverage_impact` RPC already returns the employee's
  shifts in the request dates
  (`supabase/migrations/20260903034600_shift_protection_read_rpcs.sql:143`).
  It filters on the restaurant, the same employee, status `scheduled` or
  `confirmed`, and the restaurant-local date of `start_time` between
  `start_date` and `end_date`
  (`supabase/migrations/20260903034600_shift_protection_read_rpcs.sql:217-221`).
- The front end reads that RPC through `useTimeoffCoverageImpact`
  (`src/hooks/useShiftProtection.ts:100`). Each row has `shift_id`,
  `shift_date`, `position`, `start_time`, and `end_time`
  (`src/hooks/useShiftProtection.ts:80`).
- The `create_shift_trade_for_employee` RPC lets a role with
  `edit:scheduling` post a trade for an employee
  (`supabase/migrations/20260821120000_trade_approval_area_grant.sql:164`,
  `:181`). It accepts a `p_reason` note (`:169`). It checks the owner and
  the status `scheduled` or `confirmed` (`:197-205`). A second open trade
  on the same shift raises `This shift already has an active trade`
  (`:258-259`).
- `useCreateShiftTradeForEmployee` wraps that RPC and shows one toast for
  each call (`src/hooks/useShiftTrades.ts:394`). The trade email helper
  `sendShiftTradeNotification` is not exported
  (`src/hooks/useShiftTrades.ts:87`).
- `useDeleteShift` deletes one shift with a `restaurant_id` filter and
  `.select('id')` (`src/hooks/useShifts.tsx:405`, `:440-451`). A delete
  that RLS filters returns `error:null` with zero rows. Its
  `skipLegacyNotify` option skips the "shift deleted" email
  (`src/hooks/useShifts.tsx:436`).

### Permission alignment

All four paths use the same capability, `edit:scheduling`:

- `review_time_off_request`
  (`supabase/migrations/20260903034700_shift_protection_review_timeoff.sql:43-46`).
- `get_timeoff_coverage_impact`
  (`supabase/migrations/20260903034600_shift_protection_read_rpcs.sql:158`).
- `create_shift_trade_for_employee`
  (`supabase/migrations/20260821120000_trade_approval_area_grant.sql:181`).
- The `shifts` DELETE policy
  (`supabase/migrations/20260730150000_rewrite_collaborator_policies.sql:147-152`).

Thus every role that can approve can also fetch, post, and delete. A later
change to one of these gates can split the roles. The hook then counts the
blocked shifts as `failed`, and the toast names the count.

## Design

No database change. The design reuses two existing RPCs.

### Flow

```text
Manager clicks Approve (pending row only)
  └─ submitting = true (state + ref guard)
  └─ fetch get_timeoff_coverage_impact(request.id)   (fetchQuery, staleTime 30000)
       ├─ 0 shifts   → approve as today, submitting = false
       ├─ fetch fails → approve as today, then show the toast
       │                "Could not check shifts. The request is approved
       │                without a shift action."
       └─ N shifts   → open TimeOffShiftsDialog
                         └─ manager selects "Post for trade" or "Delete"
                         └─ manager clicks "Approve and post N shifts"
                              1. approve (review_time_off_request)
                                   └─ PolicyWarningError → in one handler:
                                      shiftsTarget = null and
                                      policyTarget = {request, warnings,
                                      shiftAction}. submitting stays true.
                                      "Approve anyway" continues at step 2.
                                      Cancel → toast "Nothing changed."
                              2. apply the choice to all N shifts
                                 (Promise.allSettled)
                              3. one summary toast
                              4. submitting = false (in finally), close the
                                 dialog, invalidate the queries
```

The approval runs first. If the approval fails, no shift changes. If a
shift action fails after the approval, the request stays approved. The
summary toast then tells the manager how many shifts failed.

The approve mutation shows its own "Time-off approved" toast. Thus the
manager sees two toasts: the approval toast and the shift summary toast.
This is accepted (see "Decided trade-offs").

### Double-click and close guard

- `TimeOffList` keeps one `submitting` state and one `submittingRef`.
  `handleApprove` returns at once if `submittingRef.current` is true.
- `submitting` is true from the Approve click until the flow ends, also
  across the hand-off to the policy dialog.
- The row `isApproving` prop gets `approveRequest.isPending || submitting`.
  While the shift fetch runs, the row button shows a `Loader2` spinner
  (`aria-hidden`).
- In the dialog, `submitting` disables the confirm button, the radio
  group, the note input, and Cancel. `onOpenChange` ignores a close
  (Esc, overlay click) while `submitting` is true.
  Lesson: `memory/lessons.md:224` (lock the whole control group).

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
- `delete`: delete each shift with
  `.eq('id', id).eq('restaurant_id', restaurantId).eq('employee_id', employeeId).select('id')`.
  The `employee_id` filter stops a delete of a shift that moved to a
  different employee after the fetch. A result with zero rows counts as
  `skipped` (the shift is gone or it moved). Skip the "shift deleted"
  email. The employee already gets the "time off approved" email.
- Run the calls with `mutateAsync`-style awaits inside
  `Promise.allSettled`, so one failure does not stop the others
  (lesson: `memory/lessons.md:826-829`).
- Count `This shift already has an active trade` as `skipped`, not
  `failed`. The shift is already on the trade board.
- Show one summary toast, not one toast for each shift.
- Invalidate `['shifts', restaurantId]`, the shift-trade queries, and
  `['timeoff-coverage-impact']`.

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
- Layout for a small screen: `DialogContent` uses
  `max-h-[80vh] flex flex-col p-0 gap-0`. The header and the
  `DialogFooter` stay fixed. The body scrolls. The shift list is its own
  `max-h-48 overflow-y-auto` region.
- An amber notice with `role="status"`:
  "{Name} is scheduled for N shift(s) in these dates."
  Tokens: `bg-amber-500/10 border-amber-500/20`.
- A list of the shifts in `border-border/40 bg-muted/30`. The day label
  uses `shift_date` from the RPC (the restaurant-local date). The start
  and end times use the existing format
  (`src/components/TimeOffList.tsx:190`).
- A `RadioGroup` with two options. Each `RadioGroupItem` has a `Label`
  with `htmlFor`. A `text-[13px]` description sits under each option.
  Default: "Post for trade". Focus moves to the first radio on open.
- A "Trade note" `Input` with a `Label`
  (`text-[12px] uppercase tracking-wider`). It shows only for "Post for
  trade". Default value: `Approved PTO`. `maxLength={200}`. Enter in the
  input submits.
- If "Delete" is selected, the option description says that a delete
  also cancels any open trade on the shift.
- Footer: "Cancel" and a primary button. The button text follows the
  choice: "Approve and post N shift(s)" or "Approve and delete N
  shift(s)". For "Delete", the button uses the destructive style
  (`text-destructive` tokens only, no new color). While `submitting` is
  true, the button shows `Loader2` (`aria-hidden`) and "Approving…".
- The dialog shows the shifts as props. It does not fetch data.

### Changes to the policy dialog

- When `policyTarget.shiftAction` is set, the dialog shows one line under
  the findings, for example "After approval: post 3 shifts for trade."
- The "Approve anyway" text names the action, for example
  "Approve anyway and post 3 shifts".
- Cancel clears `policyTarget`, sets `submitting = false`, and shows the
  toast "Nothing changed."

### Changes to `TimeOffList`

- `handleApprove` fetches the shifts with `queryClient.fetchQuery` on the
  `['timeoff-coverage-impact', id]` key, with `staleTime: 30000`. The
  fetch uses the same query function as `useTimeoffCoverageImpact`.
  Export that query function so both use one copy.
- New state: `shiftsTarget: { request, shifts } | null`, `submitting`,
  and `submittingRef`.
- `policyTarget` gets an optional `shiftAction`. "Approve anyway" applies
  the stored shift action after the approval succeeds.
- The swap from `TimeOffShiftsDialog` to the policy `AlertDialog` sets
  both states in one handler, so React batches the update. A test checks
  that the page stays clickable after the swap (no `pointer-events: none`
  left on `body`).
- The flow applies only to pending rows. `DecidedHistory` shows no
  Approve button, so it needs no change.

## Tests

- Unit: `summarizeShiftResults` and `timeOffShiftToastText`.
- Unit: `useApplyTimeOffShiftAction` with a mocked Supabase client.
  Cases: all trades succeed; one trade already exists (skipped); one
  delete fails (failed); one delete returns zero rows (skipped); the
  delete filters on `employee_id`; an empty note becomes `Approved PTO`.
- Unit: `TimeOffList` approve flow. Cases: 0 shifts approves at once;
  the fetch fails, approves, and shows the "Could not check shifts" toast;
  N shifts opens the dialog; confirm calls approve and then the shift
  action; a second click during the flow does nothing; a
  `PolicyWarningError` keeps the shift choice for "Approve anyway"; Cancel
  in the policy dialog changes nothing; the page stays clickable after
  the dialog swap.
- Unit: `TimeOffShiftsDialog` toggles the note field and the button text,
  and ignores a close while `submitting` is true.
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
- **A delete cascades.** `shift_trades.offered_shift_id` has
  `ON DELETE CASCADE`
  (`supabase/migrations/20260104120000_create_shift_trades.sql:10`). A
  delete cancels any open or `pending_approval` trade on the shift with no
  email to the coworker. Time punches, open-shift claims, and schedule
  publish rows keep their data with `shift_id` set to null. The "Delete"
  option text warns the manager about the trade effect.
- **No "shift deleted" email** on delete. The employee gets the "time off
  approved" email.
- **Two toasts.** The approval toast and the shift summary toast both
  show. A `silent` flag on the approve mutation adds scope for small value.
- **A failed shift fetch does not block the approval.** The approval runs
  and a toast tells the manager that the app did not check the shifts.
- **Clock times use the browser timezone.** This matches the existing
  coverage list. The day label uses the restaurant-local `shift_date`.

## Out of scope

- A choice for each shift.
- A shift action for a decided request.
- An automatic check when an employee creates a request.
- A change to the policy rules in `review_time_off_request`.
