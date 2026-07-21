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
   `approve_open_shift_claim(claim_id, NULL)` on their own claim and mint a
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
  - `managers_review_claims` (UPDATE) and `managers_view_restaurant_claims`
    (SELECT): `user_restaurants … role IN ('owner','manager','operations_manager')`.
    **This is the current deployed shape**, set by
    `20260702170000_add_operations_manager_role.sql:823-845` (the original
    `20260412145842` migration created them as `('owner','manager')`; the
    operations-manager migration widened both). Verified live:
    `\d public.open_shift_claims` shows `operations_manager` in both policies.
    The `edit:scheduling` capability likewise includes `operations_manager`
    (`20260702170000:145`), and the `/scheduling` claim-approval UI is
    reachable by that role — so `operations_manager` is a **legitimate
    approver/rejecter of claims today**.
  - `employees_insert_own_claims` (INSERT): `claimed_by_employee_id IN (SELECT id FROM employees WHERE user_id = auth.uid())`.

  The SECURITY DEFINER RPCs must re-apply these same invariants because they
  bypass RLS. Re-applying the **real** invariant means the approve/reject
  gate must include `operations_manager`, or the "hardening" would silently
  strip an existing privilege (a regression, and the read/write-audience
  mismatch trap of lesson [2026-07-13]).

## Fix

New migration `20260721000000_open_shift_claim_authz_guard.sql`
`CREATE OR REPLACE`s all four functions from their **current main
definitions verbatim**, adding an authorization guard at the top of each.
The approve function is re-created from `20260707090000` (preserving its
`is_active` guard and timezone handling); the other three from
`20260412145842`.

### 1. `approve_open_shift_claim` (and `reject_open_shift_claim`)

After locking the claim, gate on the manager audience for the **claim's**
restaurant. Collapse the not-found and not-authorized cases into a single
generic message so a cross-tenant caller cannot use the error shape to
probe whether a claim id exists (no enumeration signal):

```sql
SELECT * INTO v_claim FROM public.open_shift_claims WHERE id = p_claim_id FOR UPDATE;

IF NOT FOUND
   OR NOT public.user_has_role(v_claim.restaurant_id,
                               ARRAY['owner','manager','operations_manager']) THEN
    RETURN json_build_object('success', false, 'error', 'Claim not found or not authorized');
END IF;
```

(`IF a OR b` short-circuits in plpgsql, so `user_has_role` is not evaluated
when the claim is missing.) Role set `['owner','manager','operations_manager']`
matches the
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

- **Role set is `owner/manager/operations_manager`.** (Corrected after the
  Phase 4 build agent caught a stale premise in the first draft.) This is
  exact parity with the deployed `managers_review_claims` UPDATE policy and
  `managers_view_restaurant_claims` SELECT policy (both widened to include
  `operations_manager` on 2026-07-02), the `edit:scheduling` capability, and
  the `/scheduling` approval UI. Lesson [2026-07-13] ("read grant must match
  write grant") applies to the **directed-trade** feature (`shift_trades`),
  where the approve/reject audience is *deliberately* `owner/manager`-only —
  a **different table** with a different, intentionally narrower audience.
  Importing that narrowing to `open_shift_claims` would strip an existing
  `operations_manager` privilege and create exactly the read/write-audience
  mismatch that lesson warns against (operations_manager sees pending claims
  + approve buttons, RPC rejects them). So parity here *requires* including
  `operations_manager`.
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

Fixtures: restaurant R1 + manager M1 + **operations_manager OM1** + employee
E1 (claimer); restaurant R2 + manager M2 + employee E2; restaurant R3
(instant-approval, `require_shift_claim_approval=false`) + a second employee
row for E1 (same auth user, linked to R3) for the legitimate self-claim
scenario. R1 must stay `require_shift_claim_approval=true` for scenarios 1-6,
so R3 is a separate tenant rather than a second template/setting on R1.
Distinct pending claims per scenario so one scenario's write can't change
another's starting state.

**Fixture rows that must be present so scenarios 7 & 9 exercise real logic
(not short-circuit paths)** — call these out explicitly in the test header:
- `staffing_settings` for R1: `open_shifts_enabled=true`,
  `require_shift_claim_approval=true`; for R3:
  `open_shifts_enabled=true`, `require_shift_claim_approval=false` (instant
  approval so scenario 7's legit self-claim returns `success=true`).
- `shift_templates` for R1 and R3: `is_active=true`, `capacity>1`,
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
3b. **approve** — OM1 (operations_manager of R1) can approve an R1 claim →
   `success=true`. Pins the operations_manager parity so a future narrowing
   to `owner/manager` is caught (lesson [2026-07-13] non-vacuous clause test).
4. **reject** — E1 cannot reject own claim → `success=false`, stays pending.
5. **reject** — M2 cannot reject R1 claim → `success=false`, stays pending.
6. **reject** — M1 can reject R1 claim → `success=true`, claim `rejected`.
7. **claim** — E1 legitimately self-claims on R3 (instant-approval
   restaurant) → `success=true`.
8. **claim** — E2 (R2) cannot claim as E1 / into R1 (impersonation +
   cross-tenant) → `success=false`, no claim row created.
9. **get_open_shifts** — a linked R1 member/employee sees the open row;
   a stranger (R2 employee) sees zero rows for R1.

## Existing tests that MUST be updated (else the migration lands red)

`supabase/tests/60_claim_open_shift_active_guard.test.sql` and
`supabase/tests/61_approve_open_shift_claim_active_guard.test.sql` currently
invoke the guarded RPCs **entirely as `SET LOCAL role TO postgres`**, so
`auth.uid()` is NULL throughout. Once the new authz guards land, the "not
authorized" branch fires **before** the `is_active` branch those files test,
flipping their assertions red for an unrelated reason (60: tests 1,3,4,5,6,7;
61: tests 1,2,4).

**Convert EVERY guarded RPC call in both files, not only the enumerated
red-flipping ones.** In particular `60`'s test 2
(`get_open_shifts … NOT EXISTS`, "hidden template excludes its slot") still
*passes* post-guard even left as `postgres` — but only vacuously (an
unauthenticated caller gets an empty set regardless of `is_active`), so it
would stop exercising the `is_active` filter it is named for (the same
vacuous-test trap called out for scenario 9). Move test 2 to the same
authenticated employee context as the other `get_open_shifts` calls.

Both files must be updated so the RPC-calling statements run as
`authenticated` with a real caller:
- Give the fixture employees (60: `d1`/`d2`; 61: the claimers) an
  `auth.users` row and set `employees.user_id` to it; impersonate that user
  (`SET LOCAL role='authenticated'` + `request.jwt.claims`) for
  `claim_open_shift`/`get_open_shifts` calls.
- For 61's `approve` calls, add a manager (`user_restaurants` role
  `manager`/`owner`) + `auth.users` row and impersonate it.
- Keep setup + read-backs as `postgres`; only the guarded RPC calls switch to
  `authenticated`. Re-enable RLS before switching roles (per the
  `54_accept_shift_trade_authz.sql` precedent).

This is required scope for the migration task, not optional.

## Files

- `supabase/migrations/20260721000000_open_shift_claim_authz_guard.sql` (new)
- `supabase/tests/62_open_shift_claim_authz.test.sql` (new)
- `supabase/tests/60_claim_open_shift_active_guard.test.sql` (update: auth impersonation)
- `supabase/tests/61_approve_open_shift_claim_active_guard.test.sql` (update: auth impersonation)

No frontend changes — the hooks already surface `result.error` as a toast.
