# Deposit Match Toast CAPTURED filter — build plan

Date: 2026-09-05
Design: docs/superpowers/specs/2026-09-05-deposit-match-toast-captured-design.md
Branch: `fix/deposit-match-toast-captured` (worktree
`.claude/worktrees/deposit-match-toast-captured`, off origin/main 9af6b452)

Each task follows TDD: write the failing test first, then the code.

## Task 1 — Test: non-CAPTURED rows must not count

Files:
- Change: `supabase/tests/deposit_match_adapters_test.sql`

Steps:
1. Add `payment_status` to the toast fixture INSERT column list
   (lines 23-27). Set 'CAPTURED' on the existing CREDIT row and the
   existing CASH row.
2. Add four CREDIT fixture rows on 2026-08-25, restaurant
   `44444444-1000-0000-0000-000000000001`, in the same fixture block:
   DENIED (amount 9.98), VOIDED (6.48), AUTHORIZED (5.00), and NULL
   `payment_status` (4.00). Give each row a unique
   `toast_payment_guid` and `toast_order_guid`.
3. Do not add assertions. The existing assertions at lines 101-116
   (expected 90.00, row_count 1) prove the exclusion. `plan(N)` stays
   23.
4. Add a fixture comment: only CAPTURED rows settle; the four extra
   rows must not change the sum.
5. Run `npm run db:reset`, then `npm run test:db`. The toast
   assertions must FAIL now (sum 115.46, row_count 5). Record the
   failure.

## Task 2 — Migration: add the CAPTURED filter

Files:
- New: `supabase/migrations/20260905090000_deposit_match_toast_captured.sql`

Steps:
1. Check the prefix is unique against merged main right before push.
   `20260905090000` is free as of 2026-09-05.
2. Add a provenance header: the function body comes whole from
   `supabase/migrations/20260901150000_deposit_match_adapters.sql:89-123`,
   the only prior definition. State the one change.
3. Copy the function whole. Add one condition to the WHERE clause:
   `AND tp.payment_status = 'CAPTURED'`. Add a short comment above it:
   only CAPTURED rows settle to the bank; DENIED, VOIDED, AUTHORIZED,
   CANCELLED, ERROR, OPEN, PROCESSING_VOID, and NULL rows do not.
4. Keep `SECURITY DEFINER`, `SET search_path = public, pg_temp`,
   STABLE, and both config guards unchanged.
5. Repeat the REVOKE by exact signature:
   `REVOKE ALL ON FUNCTION public.deposit_match_source_toast(uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;`
6. Run `npm run db:reset`, then `npm run test:db`. All tests must
   pass, including `deposit_match_lag_window_test.sql` (no fixture
   change there — it inserts no `toast_payments` rows).

## Task 3 — Verify, PR, CI

1. `npm run typecheck` and `npm run lint` (no TS change expected;
   confirm a clean baseline).
2. `npm run test` (unit suite; no unit test change expected).
3. Skip the UI review: no frontend file changes.
4. Open the PR against main. Link the design doc. State the effect:
   the next refresh recomputes expected amounts; eight overstated
   Toast days for restaurant `7c0c76e3-e770-401b-a2a9-c1edd407efed`
   flip to matched.
5. Watch CI to green with `gh pr checks --watch`.

## Risks

- The fixture edit changes an INSERT shared by all toast assertions.
  A wrong `payment_status` on the existing rows breaks the 90.00 sum;
  Task 1 step 5 catches this before the migration exists.
- The migration prefix can collide with a migration merged after
  2026-09-05. Re-check before push.
