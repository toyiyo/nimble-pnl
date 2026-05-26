# Plan — Fix Phantom `employees.compensation_history` Column

Design: `docs/superpowers/specs/2026-05-26-ai-chat-compensation-history-embed-design.md`

## Tasks

### Task 1 — Vitest regression test (RED)
**File:** `tests/unit/aiExecuteTool.employeeLaborColumns.test.ts`

Write a failing test that:
- Imports `EMPLOYEE_LABOR_COLUMNS` (will fail to compile — not yet exported).
- Asserts the string contains the substring `compensation_history:employee_compensation_history(*)`.
- Asserts no bare `compensation_history` token (regex `/(?:^|,\s*)compensation_history\s*(?:,|$)/`) appears.
- Asserts the base-column tokens (split on `,`, strip whitespace, take everything before any `:`) exactly equal the snapshot of columns that exist on `employees`: `id, name, position, status, restaurant_id, compensation_type, hourly_rate, salary_amount, pay_period_type, contractor_payment_amount, contractor_payment_interval, daily_rate_amount, hire_date, termination_date, compensation_history`.

Run: `npm test -- tests/unit/aiExecuteTool.employeeLaborColumns.test.ts` — should fail to compile.

### Task 2 — Export + fix the SELECT (GREEN)
**File:** `supabase/functions/ai-execute-tool/index.ts`

- Add `export` keyword to `EMPLOYEE_LABOR_COLUMNS`.
- Replace the trailing bare `compensation_history` token with `compensation_history:employee_compensation_history(*)`.

Re-run the test — should pass.

### Task 3 — pgTAP regression test
**File:** `supabase/tests/employee_compensation_history_embed.test.sql`

pgTAP `BEGIN; SELECT plan(...); ... ROLLBACK;` block asserting:

1. `has_table('public', 'employee_compensation_history', 'table exists')`.
2. `has_fk('public', 'employee_compensation_history', 'fk_employee_id', ...)` referencing `employees(id)`.
3. Set up fixture: one restaurant, one owner user, one manager user, one staff user, one employee, two compensation history rows.
4. With `request.jwt.claims` set to owner — query `employees` with `employee_compensation_history` as a side select (or via the PostgREST embed name) and assert both history rows return.
5. With `request.jwt.claims` set to manager — same, assert both rows return.
6. With `request.jwt.claims` set to staff — assert 0 history rows return (post-RLS-tighten).

Fixture cleanup at end of `ROLLBACK`. RLS off inside the txn for setup, on for the assertion queries (use `SET LOCAL ROLE authenticated`).

### Task 4 — RLS tighten migration
**File:** `supabase/migrations/20260526120000_tighten_compensation_history_select_rls.sql`

```sql
DROP POLICY IF EXISTS "Users can view employee_compensation_history for their restaurant"
  ON public.employee_compensation_history;

CREATE POLICY "Owners and managers can view employee_compensation_history"
  ON public.employee_compensation_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = employee_compensation_history.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );
```

Re-run pgTAP: all 6 plan items should pass.

### Task 5 — Local verify (Phase 8)
```
npm run typecheck
npm run lint
npm run test
npm run test:db
npm run build
```

All must be green before push.

## Dependencies

- Task 1 → Task 2 (test must exist before fix to follow TDD)
- Task 3 + Task 4 are independent of Task 1/2 but Task 3's role-based assertion depends on Task 4's tighter policy
- Build order: 1 → 2 → 4 → 3 → 5

## Out of scope

- Live preview-deploy integration test
- Narrowing the `(*)` embed projection
- Code-generation type sync from DB schema
- Other phantom-column references (if any) elsewhere in the edge-function corpus — grep confirms there are none on `employees`, but a sweep is a separate hardening PR.
