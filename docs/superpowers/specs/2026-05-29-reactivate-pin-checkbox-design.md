# Design: Remove cosmetic "Enable kiosk PIN" checkbox from Reactivate dialog

- **Date:** 2026-05-29
- **Branch:** `fix/reactivate-pin-checkbox`
- **Status:** Approved
- **Type:** Bug fix (UI contract / dead affordance)

## Problem

`useReactivateEmployee` declares a `confirmPin?: boolean` field on
`ReactivateEmployeeParams` ([useEmployees.tsx:223](../../../src/hooks/useEmployees.tsx)),
and `ReactivateEmployeeDialog` passes it via
`reactivateMutation.mutate({ employeeId, hourlyRate, confirmPin })`. But the
`mutationFn` only destructures `{ employeeId, hourlyRate }` — `confirmPin` is
silently dropped. It is never sent to the `reactivate_employee` RPC nor to the
fallback direct update. The "Enable kiosk PIN" checkbox is therefore purely
cosmetic.

## Root cause: there is no "active employee, disabled PIN" state

PIN usability in this system is derived **entirely** from `employees.is_active`:

- A kiosk PIN lives in `employee_pins` (hashed). There is **no** per-PIN
  enabled/disabled column (verified across all migrations; the only
  PIN-related column on `employees` is the unrelated `notify_pin_reset`
  notification toggle).
- `verify_employee_pin` (server RPC,
  `20251209000001_add_inactive_employee_auth_blocking.sql`) and
  `verifyPinForRestaurant` (client, `useKioskPins.tsx`) both accept a PIN
  **iff the owning employee `is_active = true`**.
- `reactivate_employee`
  (`20251209000000_add_employee_activation_tracking.sql`) takes only
  `p_employee_id`, `p_reactivated_by`, `p_new_hourly_rate`, and sets
  `is_active = true`. That flip **automatically re-enables any existing PIN**.

Consequences for the checkbox:

- **Checked** (default) — "let them use their existing PIN" = exactly what
  reactivation already does. Redundant but accurate.
- **Unchecked** — implies "reactivate but block the old PIN". This is **never
  implemented**; the PIN still works. Misleading, with a security flavor (a
  manager who unchecks it believes a former employee's PIN is now dead when it
  is not).

The only way to actually stop an old PIN from working is to **delete or reset
it**, which already has a dedicated, RLS-correct home: `useKioskPins`
(`useDeleteEmployeePin` / `useResetEmployeePin`), surfaced in Kiosk Mode.

## Decision

**Remove the checkbox and the dropped parameter** (the user-selected option).

Because the data model has no "PIN disabled while active" state, any toggle
that *appears* to control PIN access is inherently misleading. Making it
"work" would mean quietly turning it into a destructive PIN delete — a second,
hidden path to an action that already has a proper home. Removing the dead
affordance is the smallest, safest, honest fix.

### Rejected alternatives

- **Make it functional (delete PIN on uncheck).** Keeps a confusingly labeled
  control whose real effect is destruction; duplicates the existing Kiosk Mode
  delete/reset flow. Rejected.
- **Push a `p_keep_pin` flag into the `reactivate_employee` RPC.** Most
  invasive (migration + signature change + fallback), mixes PIN lifecycle into
  the reactivation function, and still has destructive semantics. Rejected.

## Changes

No migration, no DB change, no edge-function change.

### 1. `src/hooks/useEmployees.tsx`
Remove `confirmPin?: boolean` from `ReactivateEmployeeParams`. The `mutationFn`
already ignores it, so the public contract becomes honest:
`{ employeeId, hourlyRate? }`.

### 2. `src/components/ReactivateEmployeeDialog.tsx`
- Remove the `confirmPin` state and its three resets (`useEffect`,
  `onSuccess`, `handleCancel`).
- Remove the `confirmPin` key from the `.mutate(...)` call.
- Remove the entire "PIN Confirmation" checkbox block.
- Keep the `Checkbox` import (still used by the "Update hourly rate" option).
- Preserve the *useful* signal the checkbox carried by lightly clarifying the
  existing top info alert, e.g. the employee will be able to "log in, punch
  in/out (including with their existing kiosk PIN), and be scheduled for
  shifts." This is an accurate static statement, not a toggle.

### 3. `tests/unit/employeeActivation.test.ts`
Remove `confirmPin: true` from the two `useReactivateEmployee` tests (they
would otherwise fail typecheck once the field is gone).

## Data flow (after fix)

Dialog collects `employeeId` and an optional new `hourlyRate` →
`reactivateMutation.mutate({ employeeId, hourlyRate })` → `reactivate_employee`
RPC (or fallback update) sets `is_active = true` → any existing kiosk PIN works
again automatically. No PIN-specific code path remains in the reactivation
flow.

## Error handling

Unchanged. The existing `onError` toast in `useReactivateEmployee` covers RPC
and fallback failures.

## Testing

- **Updated** `tests/unit/employeeActivation.test.ts`: the two reactivate tests
  drop `confirmPin`.
- **New** `tests/unit/ReactivateEmployeeDialog.test.tsx`:
  1. The dialog renders **no** "Enable kiosk PIN" control (regression guard
     against the misleading checkbox returning).
  2. Clicking "Reactivate Employee" calls the mutation with **exactly**
     `{ employeeId, hourlyRate }` and **no** `confirmPin` key.

TDD: the dialog test is written first (RED — the checkbox currently renders and
`confirmPin` is currently passed), then the code is removed (GREEN).

## Decided trade-offs / out of scope

- We do **not** add any capability to disable a PIN while keeping the employee
  active — that state does not exist in the model, and PIN removal/reset
  already lives in Kiosk Mode.
- No change to `reactivate_employee`, `employee_pins`, or any SQL — so the
  Supabase design reviewer is not applicable to this change.
