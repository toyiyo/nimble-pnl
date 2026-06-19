# Design: Fix employee `status` / `is_active` desync (check constraint 23514)

- **Date:** 2026-06-19
- **Branch:** `fix/employee-status-active-sync`
- **Scope:** Client-side code fix only. No DB migration. No production data changes.

## Problem

Managers cannot deactivate (or otherwise change the status of) an employee from
the UI. Saving a status change to `inactive`/`terminated` fails with:

```
new row for relation "employees" violates check constraint "employees_status_active_sync"
(Postgres 23514)
```

Real-world trigger: a duplicated employee (`alexavaldez.1105@gmail.com`) could
not be deactivated. Reproduced by the user "without a scheduled [shift]", which
confirms the failure is unrelated to shifts/FKs — it is purely the
`status` ↔ `is_active` pairing.

## Root cause

The DB constraint `employees_status_active_sync`
(`supabase/migrations/20251209000000_add_employee_activation_tracking.sql`)
requires `is_active` to mirror `status`:

- `status = 'active'` ⇒ `is_active = true`
- `status IN ('inactive','terminated')` ⇒ `is_active = false`

Any other combination violates the constraint. Three client write-sites set the
two fields independently and can desync them:

1. **`src/components/EmployeeDialog.tsx` `proceedWithSubmit` (~line 479)** —
   `is_active: employee?.is_active ?? true` keeps the employee's *existing*
   `is_active` and ignores the `status` dropdown the user just changed. Feeds
   all three save paths (create, update, comp-change). **This is the path the
   user hit.**
2. **`src/hooks/useEmployees.tsx` `useDeactivateEmployee` fallback (~line 190)** —
   sets `is_active: false` without setting `status` (runs when the RPC errors).
3. **`src/hooks/useEmployees.tsx` `useReactivateEmployee` fallback (~line 247)** —
   sets `is_active: true` without setting `status` (mirror-image latent bug).

Confirmed via production Postgres logs (two `23514` errors during the user's
attempts) and the constraint definition. The dedicated `deactivate_employee` /
`reactivate_employee` RPCs set both fields atomically and are **not** the source
of the desync — the failure is in the client write-sites above.

## Approach (approved): centralize the invariant

`is_active` is fully derivable from `status` (`is_active === (status === 'active')`).
Make that mapping the **single source of truth** on the client and apply it at
every write-site. The duplication being removed is the per-site, hand-coded
(and wrong) re-derivation of `is_active`.

- No DB migration.
- No UX change — the edit dialog keeps its status dropdown; `'terminated'` is
  preserved.
- No new side-effects.
- The dedicated **Deactivate**/**Reactivate** dialogs remain the full-offboarding
  path (termination date, future-shift cancellation, `deactivated_at/by` audit
  via the RPC). They are already wired into `EmployeeList` as first-class
  actions; the edit dialog's status field is a lightweight editor, not the
  offboarding flow.

### Changes

1. **Canonical `EmployeeStatus` type.** Export
   `EmployeeStatus = 'active' | 'inactive' | 'terminated'` from
   `src/types/scheduling.ts` and use it for `Employee.status` (replacing the
   inlined union). Import it wherever the status union is needed. Keeps
   TypeScript the single source of truth for the status domain — avoids a
   parallel union (both design reviewers flagged this).

2. **New helper** in `src/utils/employeeFilters.ts` (co-located with the existing
   activation utilities, already covered by `employeeActivation.test.ts`):

   ```ts
   import type { EmployeeStatus } from '@/types/scheduling';

   /**
    * Single source of truth for the is_active ↔ status invariant enforced by the
    * DB check constraint `employees_status_active_sync`.
    */
   export function isActiveForStatus(status: EmployeeStatus): boolean {
     return status === 'active';
   }
   ```

3. **`EmployeeDialog.tsx` `proceedWithSubmit`** — set
   `is_active: isActiveForStatus(status)` in the `employeeData` object (replaces
   `is_active: employee?.is_active ?? true`). Fixes create, update, and the
   deferred comp-change path at once (they share the `employeeData` object).

4. **`useEmployees.tsx` — remove both RPC fallbacks.** `useDeactivateEmployee`
   and `useReactivateEmployee` currently fall back to a raw `.update()` when the
   RPC errors. That fallback (a) duplicates RPC logic incompletely (no shift
   cancellation, no `deactivated_by`, no audit), (b) fires silently in
   production, and (c) was the source of the secondary desync. Remove it: on RPC
   error, throw so the existing `onError` toast surfaces the failure. The
   deployed `deactivate_employee`/`reactivate_employee` RPCs set both fields
   atomically, so the happy path is unchanged. (Resolves the supabase reviewer's
   `critical`; also serves the "avoid duplication" goal.)

## Testing

- **Unit** (`tests/unit/employeeActivation.test.ts`): `isActiveForStatus` →
  `active=true`, `inactive=false`, `terminated=false`.
- **Component** (extend an `EmployeeDialog` test): editing an existing active
  employee and changing status to `inactive` and to `terminated` submits an
  update payload with `is_active:false` and the matching `status`; leaving status
  `active` yields `is_active:true`. Cover all three write paths:
  - direct update (`updateEmployee.mutateAsync` payload),
  - deferred comp-change path (`pendingCompChange.updatePayload` applied by
    `handleApplyCompChange` when compensation also changed),
  - create (`createEmployeeWithHistory` payload).
  This is the direct regression test for the user-facing bug.
- **Hook** (`tests/unit/employeeActivation.test.ts`): when the RPC returns an
  error, `useDeactivateEmployee`/`useReactivateEmployee` reject (surface the
  error) and do **not** call `supabase.from('employees').update(...)` — i.e., no
  silent fallback. Happy-path tests (RPC success) remain unchanged.

## Decided trade-offs / out of scope

- The edit dialog's status change does **not** set `deactivated_at/by` or cancel
  future shifts — that remains the dedicated Deactivate dialog's responsibility.
  Accepted: the edit form is a lightweight profile editor.
- `'terminated'` remains settable only via the edit dialog (unchanged behaviour).
  Note: running the Deactivate dialog on an already-`terminated` employee resets
  their status to `inactive` (the RPC hardcodes `'inactive'`). Pre-existing; out
  of scope.
- Removing the RPC fallbacks means deactivate/reactivate now require the RPC to
  be present. Supabase preview/branch DBs apply migrations and unit tests mock
  the RPC, so this is safe; failures now surface loudly rather than silently
  writing a partial row.
- **Deferred (pre-existing, unrelated to this bug; candidate follow-ups):**
  missing `DialogDescription` on `EmployeeDialog`; raw colors in
  `DeactivateEmployeeDialog`; the RPCs' `SECURITY DEFINER` functions not pinning
  `search_path`; the `canReactivate` (false for `terminated`) vs. edit-dialog
  ability to set `status='active'` tension; no inline UX hint distinguishing the
  status dropdown from the dedicated Deactivate flow.
- No production data is modified. The existing duplicate employee row is cleaned
  up separately by the user through the now-fixed UI.

## Risk

Low. Pure client-side logic; the change makes every client write satisfy an
existing DB constraint. Backed by unit + hook + component tests.
