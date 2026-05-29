# Plan: Include capacity-1 templates in open-shift pool

Spec: `docs/superpowers/specs/2026-05-29-open-shifts-capacity-one-design.md`

## Tasks

### Task 1 — RED: write the regression test
- Create `supabase/tests/open_shifts_capacity_one.test.sql`, `plan(3)`.
- Fixtures: restaurant (America/Chicago), capacity-1 Sunday "Server"
  template, two employees, `staffing_settings` (open_shifts_enabled=true,
  require_shift_claim_approval=false), `schedule_publications` for the
  next-Sunday week. RLS off; `BEGIN … ROLLBACK`.
- Assert (1) capacity-1 template shows `open_spots = 1`; (2) after one
  instant claim, template no longer returned (`NOT EXISTS`); (3) second
  claim returns `success = false`.
- Run `npm run test:db` → test 1 should FAIL against current schema
  (capacity-1 excluded by `> 1`).
- Dependency: none.

### Task 2 — GREEN: write the fix migration
- Create `supabase/migrations/20260529120000_fix_open_shifts_capacity_one.sql`.
- `CREATE OR REPLACE FUNCTION public.get_open_shifts(...)` — body copied
  verbatim from `20260413001912`, with: `st.capacity > 1` → `st.capacity > 0`,
  add `SET search_path = public`, declare `STABLE`.
- Run `npm run test:db` → all 3 new tests PASS, existing
  `open_shift_claim_timezone` + `open_shift_claims` tests still PASS.
- Dependency: Task 1.

### Task 3 — Verify & regression-sweep
- `npm run test:db` full suite green.
- `npm run typecheck`, `npm run lint`, `npm run build` (no TS touched but
  workflow Phase 8 requires the full gate).
- Dependency: Task 2.
