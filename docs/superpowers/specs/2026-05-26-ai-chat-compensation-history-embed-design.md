# AI Chat — Fix Phantom `employees.compensation_history` Column

## Problem

The AI chat is returning `TOOL_ERROR` when a manager asks "tell me about the hours worked this month." Production edge-function logs (`ai-execute-tool`) show HTTP 500s; the AI's user-facing error names a missing column: `employees.compensation_history`.

Verified in prod via Supabase MCP:
- `employees` table does NOT contain a column named `compensation_history` (confirmed by `information_schema.columns` query — 0 rows).
- `employee_compensation_history` exists as a separate table (189 rows in prod) with `employee_id` FK to `employees.id`.

## Root cause

`supabase/functions/ai-execute-tool/index.ts:1865-1869` defines:

```ts
const EMPLOYEE_LABOR_COLUMNS =
  'id, name, position, status, restaurant_id, compensation_type, ' +
  'hourly_rate, salary_amount, pay_period_type, ' +
  'contractor_payment_amount, contractor_payment_interval, ' +
  'daily_rate_amount, hire_date, termination_date, compensation_history';
```

The trailing `compensation_history` token is a **bare column reference**. PostgREST forwards it to PostgreSQL, which returns `column employees.compensation_history does not exist`. The edge function bubbles the error up as a 500, and the AI tool router surfaces it as `TOOL_ERROR`.

Both PR #519's `get_labor_costs` and `get_time_punches` tools use this projection via `fetchLaborData`, so both are broken in prod for any caller hitting the labor-cost code path.

The canonical working pattern lives in `src/hooks/useEmployees.tsx:29`:

```ts
.select(`
  *,
  compensation_history:employee_compensation_history(*)
`)
```

That's PostgREST's embedded-resource alias syntax (`<output_field>:<related_table>(<columns>)`). It instructs PostgREST to follow the FK from `employee_compensation_history.employee_id → employees.id` and embed the related rows as an array under the field name `compensation_history`. This matches the downstream consumer shape in `supabase/functions/_shared/laborCalculations.ts:39` (`compensation_history?: CompensationHistoryEntry[]`).

## Fix

One-line change in `supabase/functions/ai-execute-tool/index.ts`:

```diff
-  'daily_rate_amount, hire_date, termination_date, compensation_history';
+  'daily_rate_amount, hire_date, termination_date, ' +
+  'compensation_history:employee_compensation_history(*)';
```

No type changes needed (consumer already expects `CompensationHistoryEntry[]`).
No migration needed (the table already exists; this is purely a SELECT-string typo).
No new RLS policy needed (`employee_compensation_history` already has SELECT/INSERT/UPDATE policies covering manager/owner roles — see migrations `20251216093000_add_employee_compensation_history.sql` and `20260305120000_allow_compensation_history_upsert.sql`).

## Regression prevention

The bug shipped because every existing unit test for `laborCalculations` builds `Employee` mocks directly with `compensation_history: []` pre-populated. The PostgREST projection layer is never exercised. We need a regression that catches phantom-column SELECTs **and** wrong-table embeds at PR time, not in prod.

**Two-layer approach:**

### Layer 1 — Vitest string-shape contract

Export `EMPLOYEE_LABOR_COLUMNS` from `ai-execute-tool/index.ts` and add `tests/unit/aiExecuteTool.employeeLaborColumns.test.ts`:

1. Asserts the projection includes `compensation_history:employee_compensation_history(*)` (positive contract — would fail if someone "simplifies" back to a bare column).
2. Asserts no bare `compensation_history` token appears outside the embed.
3. Snapshots the list of base-column tokens (everything before any `:`) against a hard-coded set of columns that actually exist on `employees` per the migrations.

This catches the specific bug (bare column reference) and drift in the base columns list, in unit-test time.

### Layer 2 — pgTAP live-FK/RLS contract

Add `supabase/tests/employee_compensation_history_embed.test.sql` that:

1. `has_table('employee_compensation_history')`.
2. `has_fk('employee_compensation_history', 'employee_id')` referencing `employees(id)` — proves PostgREST can resolve the relationship.
3. With a manager-role test JWT (via `set_config('request.jwt.claims', ...)`), SELECT employees with the embedded `employee_compensation_history` rows and assert the rows come back. This proves the embed works under live RLS.
4. With a staff-role test JWT, assert the embedded rows do NOT come back (after the RLS tightening in the next section).

The pgTAP path catches wrong-table embeds (e.g., a typo'd `employee_payroll_history(*)`) that string-shape can't, and it runs against `npm run test:db` against a real local Supabase instance.

A full preview-deploy + signed-JWT integration test was considered and deferred — pgTAP closes the gap without that infra.

## Why CI missed it

- `tests/unit/laborCalculations*.test.ts` mock `Employee` objects directly. The SELECT projection never executes.
- `useEmployees.tsx` has the correct embed, so `src/`-side typecheck and existing unit tests never disagreed with the edge function's wrong projection.
- Phase 7 multi-model reviewers (security/perf/maintainability/sound-logic + Codex) read code semantics — they don't validate SELECT strings against the schema.
- CodeRabbit reads diff semantics — same gap.
- No E2E smoke test invokes the AI tool against a live DB with a real JWT.

The string-shape regression test plus the lesson entry close the loop for this specific bug. Future schema/contract drift will need a broader integration-test story (out of scope for this hotfix).

## Defense-in-depth — tighten compensation_history SELECT RLS

Phase 2.5 review surfaced a pre-existing asymmetry in `supabase/migrations/20251216093000_add_employee_compensation_history.sql`:

- `INSERT`/`UPDATE` policies correctly restrict to `role IN ('owner', 'manager')`.
- `SELECT` policy restricts only by `restaurant_id` and `user_id = auth.uid()`, **without a role filter** — any `staff` or `kiosk` account can SELECT every employee's compensation history for their restaurant via a direct PostgREST call.

This hotfix does NOT introduce the exposure (the edge-function tool is already manager+owner gated at the dispatcher layer in `ai-execute-tool`), but it does start exercising the embed via a code path that ships, so the gap should be closed defense-in-depth.

**Fix:** add a migration that drops the existing `Users can view employee_compensation_history for their restaurant` policy and re-creates it with the role filter:

```sql
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

This matches the role posture on `employees.hourly_rate`/`salary_amount` reads elsewhere in the codebase. pgTAP test layer 2 above also asserts staff CANNOT read the embedded rows, pinning the policy.

## Decided trade-offs

- **No live preview-deploy + signed-JWT integration test.** Deferred for cost/complexity; pgTAP closes the gap.
- **No type-level enforcement.** TypeScript can't verify a string against a DB schema without code generation; we already have `generate_typescript_types` available, but wiring that into the edge function would be a separate refactor.
- **Export of `EMPLOYEE_LABOR_COLUMNS`.** Small API surface widening — the only consumer is the test file. Acceptable.
- **Keep `(*)` in the embed.** Mirrors `useEmployees.tsx`. A narrower projection is a follow-up if payload size becomes an issue.

## Files touched

- `supabase/functions/ai-execute-tool/index.ts` — one-line fix + add `export` to the constant.
- `supabase/migrations/<ts>_tighten_compensation_history_select_rls.sql` — new migration tightening SELECT policy to owner/manager.
- `tests/unit/aiExecuteTool.employeeLaborColumns.test.ts` — new Vitest regression.
- `supabase/tests/employee_compensation_history_embed.test.sql` — new pgTAP regression (FK + RLS both roles).
- `memory/lessons.md` — append lesson about schema verification on edge-function SELECTs (Phase 10).
