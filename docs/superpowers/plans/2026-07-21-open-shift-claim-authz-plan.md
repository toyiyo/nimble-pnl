# Plan: Authorization guards for open-shift claim RPCs

Design: docs/superpowers/specs/2026-07-21-open-shift-claim-authz-design.md

TDD order: write the failing pgTAP test first (RED), then the migration (GREEN).

## Task 1 — pgTAP authz test (RED)
File: `supabase/tests/62_open_shift_claim_authz.test.sql`
- Header: cite bug, lesson [2026-04-21] CURRENT_DATE dates, [2026-04-22]
  ON CONFLICT DO UPDATE, [2026-07-13] vacuous-test trap, and the fixture-row
  requirements from the design doc.
- Setup as `postgres`: disable RLS on restaurants, employees, shifts,
  shift_templates, open_shift_claims, staffing_settings, user_restaurants,
  schedule_publications, auth.users. Delete-before-insert in FK order.
  Re-enable RLS before switching to `authenticated`.
- Fixtures (UUID namespace `62000000-…`):
  - `require_shift_claim_approval` is restaurant-scoped, so R1 cannot be
    both approval-required (scenarios 1-6) and instant-approval (scenario 7)
    via a second template — use a separate restaurant instead: R1
    (approval-required) for approve/reject scenarios; R3
    (instant-approval), with its own linked employee/auth fixture and
    staffing/template/publication rows, for the claim success scenario. R2
    for cross-tenant. Keep each scenario's claim row independent.
  - auth.users + user_restaurants(role manager) for M1(R1), M2(R2).
  - auth.users + user_restaurants(role operations_manager) for OM1(R1).
  - auth.users + employees(user_id) for E1(R1 claimer), E2(R2).
  - shift_templates active/capacity>1/days=DOW; staffing_settings enabled;
    schedule_publications window covering target date (for get_open_shifts).
  - Pending claims: one per approve/reject scenario.
- Scenarios & assertions (impersonate via SET LOCAL role authenticated +
  request.jwt.claims; read-backs as postgres):
  1. approve: E1 self-approve own claim → success=false; claim still
     pending_approval; no shift row.
  2. approve: M2 approve R1 claim → success=false; claim still pending.
  3. approve: M1 approve R1 claim → success=true; claim approved; shift exists.
  3b. approve: OM1 (operations_manager R1) approve R1 claim → success=true
      (pins operations_manager parity — non-vacuous clause test).
  4. reject: E1 reject own claim → success=false; still pending.
  5. reject: M2 reject R1 claim → success=false; still pending.
  6. reject: M1 reject R1 claim → success=true; claim rejected.
  7. claim: E1 self-claim on instant-approval restaurant → success=true.
  8. claim: E2 claim as E1 into R1 (impersonation+cross-tenant) → success=false;
     no new claim row for that template/date/E1.
  9. get_open_shifts: E1 (linked employee of R1) sees ≥1 open row; E2
     (stranger to R1) sees 0 rows for R1.
- Run: `npm run db:reset && npm run test:db` — confirm RED on exactly the
  unauthorized-path assertions (scenarios 1, 2, 4, 5, 8, and 9's stranger
  case) because no guard exists yet to reject them; the legitimate/
  authorized-path assertions (scenarios 3, 3b, 6, 7, and 9's linked-employee
  control) are expected to already pass — they are regression controls, not
  part of the RED signal.
- Commit.

## Task 2 — Migration (GREEN)
File: `supabase/migrations/20260721000000_open_shift_claim_authz_guard.sql`
- `CREATE OR REPLACE` all four functions from their current-main bodies,
  each with `SET search_path = public` added and the authz guard:
  - `get_open_shifts`: guard = user_is_internal_team OR employee-linked →
    RETURN (empty) at top.
  - `claim_open_shift`: guard = caller owns employee row in restaurant →
    'Not authorized' at top.
  - `approve_open_shift_claim`: re-create from 20260707090000 (keep is_active
    guard + tz); after FOR UPDATE fetch, `IF NOT FOUND OR NOT
    user_has_role(v_claim.restaurant_id,
    ARRAY['owner','manager','operations_manager'])` →
    'Claim not found or not authorized'.
  - `reject_open_shift_claim`: same guard shape after fetch.
- Re-GRANT EXECUTE to authenticated (signatures unchanged, but include for
  clarity/idempotency safety — harmless).

### Task 2b — Update existing tests 60 & 61 for the new authz context
Required (else the migration lands red): tests 60/61 call the guarded RPCs as
`postgres` (auth.uid()=NULL) and would hit the new "not authorized" branch.
- `60_claim_open_shift_active_guard.test.sql`: give employees d1/d2 an
  `auth.users` row + `employees.user_id`; wrap EVERY `claim_open_shift`/
  `get_open_shifts` assertion (including test 2's `NOT EXISTS`, else it passes
  vacuously) in `SET LOCAL role='authenticated'` + `request.jwt.claims` for
  the right employee. Re-enable RLS before switching roles; read-backs stay
  `postgres`.
- `61_approve_open_shift_claim_active_guard.test.sql`: add a manager
  (`user_restaurants` role manager) + `auth.users` row; impersonate it for
  the `approve_open_shift_claim` assertions. Keep the is_active semantics the
  tests target intact (only the caller context changes).
- Run: `npm run db:reset && npm run test:db` — confirm GREEN (all 62-test
  assertions pass; 60/61 pass under authenticated context; no other
  open_shift regressions).
- Commit.

## Task 3 — Verify (Phase 8)
- `npm run test` (unit) — no impact expected (no src changes) but run.
- `npm run typecheck`, `npm run lint`, `npm run build` — should be unaffected
  (SQL-only change). Confirm.
- `npm run test:db` full suite green.

## Dependencies
- Task 2 depends on Task 1 (RED before GREEN).
- Task 3 depends on Task 2.

## Out of scope (documented trade-offs)
- manager-assign claim path (fill-by-assignment PR owns it).
- is_active check in claim guard.
- No frontend changes (hooks already surface result.error).
