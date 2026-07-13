# Plan — Enforce directed-trade privacy in shift_trades RLS

**Design:** docs/superpowers/specs/2026-07-13-shift-trade-directed-rls-design.md
**Branch:** `fix/shift-trade-directed-rls`

TDD via pgTAP (RED: failing visibility test against current policy → GREEN: migration).

---

### Task 1 — pgTAP RLS test (RED first)
- **File** `supabase/tests/<nn>_directed_shift_trade_rls.sql` (pick next free NN; align with
  existing numbering). Pattern: `33_tip_splits_employee_rls.sql`.
- Setup (as `postgres`): seed 1 restaurant + employees A(offerer), B(target), C(bystander),
  M(owner/manager via user_restaurants), O(operations_manager via user_restaurants), and a 2nd
  restaurant + employee X. Insert one DIRECTED trade (offered_by A, target B) and one OPEN trade
  (offered_by A, target NULL). Give A/B/C/M/O/X distinct `auth.users` + `employees.user_id`.
- **CRITICAL:** after seeding, `ALTER TABLE shift_trades ENABLE ROW LEVEL SECURITY;` (the sibling
  16_ test disables and never re-enables — assertions would pass vacuously otherwise).
- Per-user assertions via `SET LOCAL ROLE authenticated` + `SET LOCAL "request.jwt.claims" TO
  '{"sub":"<user>","role":"authenticated"}'`, `RESET`/re-set between users:
  1. C (bystander): directed trade → `is(COUNT,0)`  ← **RED against current policy** (currently 1)
  2. B (target): directed → 1
  3. A (offerer): directed → 1
  4. accepter case: set `accepted_by_employee_id=B`; B still 1
  5. M (manager): directed → 1
  6. O (operations_manager): directed → 1  ← RED (current Policy 4 excludes operations_manager)
  7. open trade: A,B,C each → 1
  8. X (other restaurant): both → 0
- Run `npm run test:db` → confirm 1 (bystander) and 6 (ops_manager) FAIL against current policies.
- Dep: none.

### Task 2 — migration (GREEN)
- **File** `supabase/migrations/<ts-after-latest>_restrict_directed_shift_trade_visibility.sql`:
  - `DROP POLICY IF EXISTS "Employees can view shift trades in their restaurant" ON shift_trades;`
    then recreate with the tightened `USING` (active-employee-of-restaurant AND (target NULL OR
    me.id IN (target, offered_by, accepted_by), restaurant-scoped)) per design.
  - `DROP POLICY IF EXISTS "Managers can view all shift trades" ON shift_trades;` then recreate
    verbatim with `role IN ('owner','manager','operations_manager')`.
  - `COMMENT ON POLICY` for both explaining the privacy rule + task_35a15d77.
- Run `npm run test:db` → all Task 1 assertions GREEN.
- Dep: 1.

---

## Phase 8 verify
`npm run test:db` (pgTAP — the core proof), `npm run test` (unit, unaffected), `npm run typecheck`,
`npm run lint`, `npm run build`. Migration applies cleanly on `db:reset`.

## Task order
1 (RED) → 2 (GREEN).

## Out of scope (follow-ups filed)
- `task_d9ab7984` — `accept_shift_trade` RPC missing authz (accepter identity / directed-target
  check) + `SET search_path` on the 4 SECURITY DEFINER trade functions. Write-side complement.
- `task_344afce3` — buildEmails caller-scoped client. `task_26513232` — dedupe query.
- Phase B — admin per-type × per-channel notification matrix.
