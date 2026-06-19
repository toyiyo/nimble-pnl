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

1. **New helper** in `src/utils/employeeFilters.ts` (co-located with the existing
   activation utilities, already covered by `employeeActivation.test.ts`):

   ```ts
   export type EmployeeStatus = 'active' | 'inactive' | 'terminated';

   /**
    * Single source of truth for the is_active ↔ status invariant enforced by the
    * DB check constraint `employees_status_active_sync`.
    */
   export function isActiveForStatus(status: EmployeeStatus): boolean {
     return status === 'active';
   }
   ```

2. **`EmployeeDialog.tsx`** — `is_active: isActiveForStatus(status)` replaces
   `is_active: employee?.is_active ?? true`. Fixes create, update, and
   comp-change paths at once (they share the `employeeData` object).

3. **`useEmployees.tsx` deactivate fallback** — add `status: 'inactive'` next to
   `is_active: false` (mirrors the RPC).

4. **`useEmployees.tsx` reactivate fallback** — add `status: 'active'` next to
   `is_active: true` (mirrors the RPC).

## Testing

- **Unit** (`tests/unit/employeeActivation.test.ts`): `isActiveForStatus` →
  `active=true`, `inactive=false`, `terminated=false`.
- **Hook** (same file): when the RPC returns an error, the deactivate fallback
  `.update(...)` payload contains `status:'inactive'` **and** `is_active:false`;
  the reactivate fallback contains `status:'active'` **and** `is_active:true`.
- **Component** (extend `tests/unit/EmployeeDialog.*.test.tsx` or add one):
  editing an active employee and changing status to `inactive` / `terminated`
  submits an update payload with `is_active:false` (and matching `status`);
  leaving status `active` yields `is_active:true`. This is the direct regression
  test for the user-facing bug.

## Decided trade-offs / out of scope

- The edit dialog's status change does **not** set `deactivated_at/by` or cancel
  future shifts — that remains the dedicated Deactivate dialog's responsibility.
  Accepted: the edit form is a lightweight profile editor.
- `'terminated'` remains settable only via the edit dialog (unchanged behaviour).
  Giving it a dedicated RPC-backed flow is a separate product decision.
- No production data is modified. The existing duplicate employee row is cleaned
  up separately by the user through the now-fixed UI.

## Risk

Low. Pure client-side logic; the change makes every client write satisfy an
existing DB constraint. Backed by unit + hook + component tests.
