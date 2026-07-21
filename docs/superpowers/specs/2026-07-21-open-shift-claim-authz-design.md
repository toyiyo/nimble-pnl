# Design: Authorization guards for open-shift claim RPCs

**Date:** 2026-07-21
**Branch:** claude/determined-rosalind-373bef
**Ticket:** Security fix deferred from the shift-fill-by-assignment PR (`fix/shift-fill-by-assignment`). Codex flagged the approve hole as CRITICAL during that PR's Phase 7 review.

## Problem

Four `SECURITY DEFINER` RPCs in the open-shift-claims family trust their
inputs and perform **no authorization check**. Because `SECURITY DEFINER`
bypasses RLS, `auth.uid()` is used only to *record* the actor, never to
*gate* the action.

| RPC | Grant | Bug | Severity |
|-----|-------|-----|----------|
| `approve_open_shift_claim(uuid, text)` | `authenticated` | Looks up claim by id, checks `status='pending_approval'`, creates shift + marks approved. No role check. | **CRITICAL** |
| `reject_open_shift_claim(uuid, text)` | `authenticated` | Same shape — any user can reject any claim by id. | **Major** |
| `claim_open_shift(uuid, uuid, date, uuid)` | `authenticated` | Trusts client `p_employee_id`; never checks the caller owns that employee row or belongs to `p_restaurant_id`. | **Major** |
| `get_open_shifts(uuid, date, date)` | `authenticated` | No membership check on `p_restaurant_id`; leaks another restaurant's open-shift availability. | **Minor (read leak)** |

### Concrete exploits

1. **Self-approval bypass.** `claim_open_shift` returns the new `claim_id`
   to the claimer. On an approval-required restaurant
   (`require_shift_claim_approval=true`), the claiming employee can call
   `approve_open_shift_claim(claim_id)` on their own claim and mint a
   published shift, bypassing the manager gate entirely.
2. **Cross-tenant approval / rejection.** A user in restaurant A who obtains
   or guesses a claim id in restaurant B can approve or reject it.
3. **Employee impersonation / cross-tenant claim.** Any authenticated user
   can call `claim_open_shift` with an arbitrary `p_employee_id` in any
   restaurant, creating claims/shifts for employees they don't own.
4. **Cross-tenant read.** Any authenticated user can enumerate another
   restaurant's open-shift template names, positions, and counts via
   `get_open_shifts`.

## Authorization model in this codebase

- **Managers/owners** are represented in `public.user_restaurants`
  (`role IN ('owner','manager', …)`). The canonical helper is
  `public.user_has_role(p_restaurant_id, p_roles TEXT[])` (SECURITY
  DEFINER, STABLE, `SET search_path=public`) — added in
  `20260120100000_add_collaborator_roles.sql`, used by every
  manager-gated RLS policy.
- **Employees** (self-service portal, `AvailableShiftsPage`) are linked via
  `public.employees.user_id → auth.users`. A claiming employee is **not
  guaranteed** to have a `user_restaurants` row, so employee-facing RPCs
  must authorize via the `employees` table, not `user_has_role`.
- The existing `open_shift_claims` RLS already encodes the intended
  audiences:
  - `managers_review_claims` (UPDATE): `user_restaurants … role IN ('owner','manager')`.
  - `employees_insert_own_claims` (INSERT): `claimed_by_employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())`.

  The SECURITY DEFINER RPCs must re-apply these same invariants because they
  bypass RLS.

## Fix

New migration `20260721000000_open_shift_claim_authz_guard.sql`
`CREATE OR REPLACE`s all four functions from their **current main
definitions verbatim**, adding an authorization guard at the top of each.
The approve function is re-created from `20260707090000` (preserving its
`is_active` guard and timezone handling); the other three from
`20260412145842`.

### 1. `approve_open_shift_claim` (and `reject_open_shift_claim`)

After locking the claim, gate on manager/owner role for the **claim's**
restaurant. Collapse the not-found and not-authorized cases into a single
generic message so a cross-tenant caller cannot use the error shape to
probe whether a claim id exists (no enumeration signal):

```sql
SELECT * INTO v_claim FROM public.open_shift_claims WHERE id = p_claim_id FOR UPDATE;

IF NOT FOUND
   OR NOT public.user_has_role(v_claim.restaurant_id, ARRAY['owner','manager']) THEN
    RETURN json_build_object('success', false, 'error', 'Claim not found or not authorized');
END IF;
```

(`IF a OR b` short-circuits in plpgsql, so `user_has_role` is not evaluated
when the claim is missing.) Role set `['owner','manager']` matches the
existing `managers_review_claims` RLS policy exactly. The subsequent
`status != 'pending_approval'` branch keeps its specific message — it is
only reachable by an already-authorized manager, so it leaks nothing
cross-tenant.

### 2. `claim_open_shift`

Gate at the very top: the caller may only claim for an employee row they
own, in the target restaurant (mirrors `employees_insert_own_claims`
INSERT RLS + adds the restaurant scope the RPC signature separates out):

```sql
IF NOT EXISTS (
    SELECT 1 FROM public.employees e
    WHERE e.id = p_employee_id
      AND e.user_id = auth.uid()
      AND e.restaurant_id = p_restaurant_id
) THEN
    RETURN json_build_object('success', false, 'error', 'Not authorized');
END IF;
```

Constant message → no enumeration of employees/restaurants.

### 3. `get_open_shifts`

Gate at the top; a caller must belong to the restaurant as **either** an
internal team member **or** a linked employee (employees legitimately view
open shifts to claim them). Silent empty return — same shape as the existing
`open_shifts_enabled=false` branch — so there is no enumeration signal:

```sql
IF NOT (
    public.user_is_internal_team(p_restaurant_id)
    OR EXISTS (SELECT 1 FROM public.employees e
            WHERE e.user_id = auth.uid() AND e.restaurant_id = p_restaurant_id)
) THEN
    RETURN;
END IF;
```

`user_is_internal_team` (owner/manager/chef/staff, defined in
`20260120100000_add_collaborator_roles.sql:49`) is used instead of blanket
`user_restaurants` membership so `kiosk` and external `collaborator_*` roles
— which have no operational reason to browse open-shift availability — are
excluded. Linked employees are covered by the second branch.

## Decided trade-offs

- **Role set is `owner/manager`, not `operations_manager`.** Matches the
  existing `managers_review_claims` RLS policy and the approve/reject action
  audience. Per lesson [2026-07-13] "read grant must match write grant,"
  widening approval to `operations_manager` is a separate product decision,
  not smuggled in via a security fix.
- **`SET search_path = public` added to all four functions.** (Revised after
  Phase 2.5 review.) Every table reference in the new bodies is already
  schema-qualified so this is a zero-behavior-change addition, and it matches
  the helper (`user_has_role`/`user_is_internal_team`) which already set
  `search_path`. Adding it while the file is open removes the SECURITY
  DEFINER search-path-injection gap rather than deferring it.
- **`claim_open_shift` stays employee-self-service-only.** On `main` there is
  no manager-assigns-employee caller; the fill-by-assignment PR introduces
  that flow and re-creates these functions, so it will define any
  manager-assign authorization itself. This change reflects main's current
  intent. Whichever PR lands second rebases.
- **No `is_active` check added to the `claim_open_shift` guard.** The
  existing function and the INSERT RLS both omit it; adding it is scope
  creep. Inactive-employee auth blocking lives elsewhere.

## Testing (pgTAP)

New file `supabase/tests/62_open_shift_claim_authz.test.sql`, modeled on
`54_accept_shift_trade_authz.sql` (the same class of bug). Impersonate real
callers via `SET LOCAL role='authenticated'` + `request.jwt.claims` so the
`authenticated` GRANT + `auth.uid()` boundary is actually exercised (a
postgres-role DO block would make `auth.uid()` NULL and the assertions
vacuous). Dates relative to `CURRENT_DATE`; delete-before-insert in FK order;
`ON CONFLICT DO UPDATE` fixtures. Read-backs run as `postgres` (RLS bypassed)
so they observe the RPC's real write, not the caller's RLS-scoped view.

Fixtures: restaurant R1 + manager M1 + employee E1 (claimer); restaurant R2
+ manager M2 + employee E2. Distinct pending claims per scenario so one
scenario's write can't change another's starting state.

**Fixture rows that must be present so scenarios 7 & 9 exercise real logic
(not short-circuit paths)** — call these out explicitly in the test header:
- `staffing_settings` for R1: `open_shifts_enabled=true`; scenario 7's
  restaurant needs `require_shift_claim_approval=false` (instant approval so
  the legit self-claim returns `success=true`).
- `shift_templates` for R1: `is_active=true`, `capacity>1`,
  `days` containing the target date's DOW, matching times.
- `schedule_publications` covering the target week for R1, else
  `get_open_shifts` (scenario 9) returns zero rows for everyone and the
  membership assertion passes vacuously.
- The membership-allowed subject in scenario 9 must be denied-by-default
  baseline first where practical, then shown to see the row — avoid the
  vacuous-test trap (lesson [2026-07-13]).

Scenarios:
1. **approve** — E1 (claimer, non-manager) cannot approve their own claim →
   `success=false`, claim stays `pending_approval`, no shift created.
2. **approve** — M2 (manager of R2) cannot approve an R1 claim →
   `success=false`, claim stays pending.
3. **approve** — M1 (manager of R1) can approve an R1 claim →
   `success=true`, claim `approved`, shift row created.
4. **reject** — E1 cannot reject own claim → `success=false`, stays pending.
5. **reject** — M2 cannot reject R1 claim → `success=false`, stays pending.
6. **reject** — M1 can reject R1 claim → `success=true`, claim `rejected`.
7. **claim** — E1 legitimately self-claims (instant-approval restaurant) →
   `success=true`.
8. **claim** — E2 (R2) cannot claim as E1 / into R1 (impersonation +
   cross-tenant) → `success=false`, no claim row created.
9. **get_open_shifts** — a linked R1 member/employee sees the open row;
   a stranger (R2 employee) sees zero rows for R1.

## Files

- `supabase/migrations/20260721000000_open_shift_claim_authz_guard.sql` (new)
- `supabase/tests/62_open_shift_claim_authz.test.sql` (new)

No frontend changes — the hooks already surface `result.error` as a toast.
