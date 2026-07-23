# Plan — accept_shift_trade authz + search_path hardening

**Design:** docs/superpowers/specs/2026-07-13-accept-trade-authz-design.md
**Branch:** `fix/accept-shift-trade-authz`

TDD via pgTAP. **After any migration add/edit, `npm run db:reset` before `npm run test:db`** (else
pgTAP runs against stale schema — prior-session lesson).

---

### Task 1 — new pgTAP authz test (RED first)
- **File** `supabase/tests/<nn>_accept_shift_trade_authz.sql` (next free NN). Pattern:
  `SET LOCAL ROLE authenticated` + `request.jwt.claims {sub}` per caller. Seed R1 {A offerer, B
  target, C bystander}, R2 {X}; an OPEN trade (A, target NULL) and a DIRECTED trade (A→B). Assert
  BOTH `jsonb->>'success'` and the resulting `accepted_by_employee_id`:
  1. C calls `accept(open, B's id)` (not C's) → success=false, accepted_by NULL. ← RED (today true)
  2. C calls `accept(open, C's id)` → success=true, accepted_by=C, status pending_approval.
  3. C calls `accept(directed A→B, C's id)` → success=false, accepted_by NULL. ← RED
  4. B calls `accept(directed A→B, B's id)` → success=true, accepted_by=B.
  5. X (R2) calls `accept(open, X's id)` → success=false (restaurant mismatch), unchanged.
  - `db:reset` + `test:db` → confirm 1,3,5 FAIL against current function.
- Dep: none.

### Task 2 — hardening migration (GREEN)
- **File** `supabase/migrations/<ts-after-20260713000000>_harden_accept_shift_trade.sql`:
  `CREATE OR REPLACE` all four functions, bodies **verbatim** from `20260105000100`, changing only:
  - `accept_shift_trade`: add `SET search_path = public, pg_temp` to header; insert the caller-owns-
    employee EXISTS check + the directed-target check (per design) after the `status != 'open'` check.
  - `approve/reject/cancel_shift_trade`: add `SET search_path = public, pg_temp` to header only —
    reproduce EXACT signatures: approve/reject `(UUID, UUID, TEXT DEFAULT NULL)`, cancel `(UUID, UUID)`.
  - Re-`GRANT EXECUTE … TO authenticated` on all four (idempotent).
- **Verify**: `db:reset` + `test:db` → Task 1 assertions GREEN. Then the overload guard:
  `SELECT proname, count(*) FROM pg_proc WHERE proname LIKE '%_shift_trade' GROUP BY 1` → 1 each.
- Dep: 1.

### Task 3 — fix the existing `17_shift_trade_functions_security.sql` (major, review)
- **Code**: before Test 1's accept happy-path, `SET LOCAL "request.jwt.claims" TO '{"sub":"…0002"}'`
  (employee 122's user = the actual accepter); restore to `…0001` before the later offerer/cancel
  tests. Confirm employee 122 has no schedule conflict with trade 141's shift (shifts 132/134 are
  Jan 21/23; trade offers shift 131 = Jan 20 → no overlap). All 12 assertions must still pass.
- **Verify**: `db:reset` + `test:db` → `17_` and the new file both green.
- Dep: 2.

---

## Phase 8 verify
`npm run db:reset` then `npm run test:db` (the proof — new file + 17_ both green, overload guard =1
each), `npm run test` (unit, unaffected), `typecheck`, `lint`, `build`.

## Task order
1 (RED) → 2 (GREEN) → 3 (fix existing test).

## Out of scope (follow-ups)
- `cancel_shift_trade` missing `is_active` in its ownership check (minor inconsistency).
- `task_344afce3` (buildEmails client), `task_26513232` (dedupe query).
- Phase B — admin per-type × per-channel notification matrix (next after this).
