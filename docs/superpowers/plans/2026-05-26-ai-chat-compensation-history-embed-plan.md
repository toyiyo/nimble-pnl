# Plan — Fix Phantom `employees.compensation_history` Column

Design: `docs/superpowers/specs/2026-05-26-ai-chat-compensation-history-embed-design.md`

## Tasks

### Task 1 — Vitest regression test (RED)
**File:** `tests/unit/employeeLaborColumns.test.ts`

Write a failing test that:
- Imports `EMPLOYEE_LABOR_COLUMNS` (will fail to compile — not yet exported from a Vitest-importable module).
- Asserts the projection uses the embed-alias form `compensation_history:employee_compensation_history(...)`.
- Asserts no bare `compensation_history` token appears.
- Asserts the consumed embed columns equal `effective_date, compensation_type, amount_cents, pay_period_type`.
- Asserts the base-column tokens exactly equal the snapshot of columns that exist on `employees`.

Run: `npm test -- tests/unit/employeeLaborColumns.test.ts` — should fail to compile.

### Task 2 — Extract projection to `_shared/` + fix the SELECT (GREEN)
**Files:**
- `supabase/functions/_shared/employeeLaborColumns.ts` (new — pure module, no Deno imports, importable by Vitest)
- `supabase/functions/ai-execute-tool/index.ts` (import from `_shared/`, remove local const)

- Create the new shared module that exports `EMPLOYEE_LABOR_COLUMNS`.
- Use the embed-alias form `compensation_history:employee_compensation_history(effective_date,compensation_type,amount_cents,pay_period_type)` so PostgREST resolves the FK and the payload stays narrow.
- Update `ai-execute-tool/index.ts` to import from `_shared/` and delete the local constant.

Re-run the Vitest test — should pass.

### Task 3 — pgTAP regression test
**File:** `supabase/tests/employee_compensation_history_embed.test.sql`

pgTAP `BEGIN; SELECT plan(2); ... ROLLBACK;` block asserting:

1. `has_table('public', 'employee_compensation_history', 'table exists')`.
2. `fk_ok('public', 'employee_compensation_history', ARRAY['employee_id'], 'public', 'employees', ARRAY['id'], ...)` — pins the FK PostgREST follows for the embed.

### Task 4 — RLS tighten migration (DEFERRED)

The Phase 2.5 reviewer surfaced an RLS asymmetry on `employee_compensation_history` (INSERT/UPDATE gated to owner/manager, SELECT open to any restaurant member). We initially folded a tighten into this PR.

Phase 7a security review showed the tighten would silently break `collaborator_accountant` on `/payroll` and `chef` on `/scheduling`, both of which legitimately read rates via `useEmployees`' embed. The right RLS posture needs its own design + per-role tests, so the migration was dropped from this PR. See the spec's "Defense-in-depth — DEFERRED" section.

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

- Task 1 → Task 2 (test must exist before fix to follow TDD).
- Task 3 is independent of Tasks 1/2 and runs against the existing schema.
- Build order: 1 → 2 → 3 → 5.

## Out of scope

- Live preview-deploy integration test.
- Code-generation type sync from DB schema.
- RLS posture redesign for `employee_compensation_history` (its own PR — see Task 4).
- Other phantom-column references (if any) elsewhere in the edge-function corpus — grep confirms there are none on `employees`, but a sweep is a separate hardening PR.
