# Plan: employee self-scoped data reads

- **Design:** `docs/superpowers/specs/2026-08-05-employee-self-scoped-data-design.md` (commit `3b58fdf9`)
- **Branch:** `fix/employee-self-scoped-data`
- **Approach:** C — self-scoped hooks + RLS tightening on six tables; `employees` deferred.

Steps are TDD-ordered: each test step must fail for the right reason before its
implementation step runs.

---

## Step 0 — Baseline

1. `npm run typecheck && npm run lint`
2. `npm run test -- --run`
3. `npm run db:reset` then `npm run test:db`

Record the baseline pass counts. Any pre-existing failure is noted, not fixed.

---

## Step 1 (RED) — `useMyShifts` unit tests

New `tests/unit/useMyShifts.test.ts`, mocking the `supabase` client so the **recorded
query-builder calls** are asserted (not the returned rows — a row-based assertion would pass
vacuously if the filter were applied client-side):

- `useMyShifts(rid, 'emp-1', start, end)` records `.eq('employee_id', 'emp-1')`.
- `useMyShifts(rid, null, start, end)` records **zero** queries against `shifts`.
- `useShifts(rid, start, end)` records exactly the calls it records today —
  `.eq('restaurant_id', rid)`, the `start_time` bounds, `.order('start_time')`, and the
  `'*, employee:employees(*)'` select — and **no** `employee_id` predicate.
- The `employeeId` appears in the query key so admin and self caches cannot collide.

## Step 2 (GREEN) — refactor `src/hooks/useShifts.tsx`

Extract the body of `useShifts` ([:48-90](../../../src/hooks/useShifts.tsx#L48)) into an
internal `useShiftsQuery(restaurantId, startDate, endDate, employeeId?)`:

- append `employeeId ?? 'all'` to the query key;
- apply `.eq('employee_id', employeeId)` only when set;
- `enabled: !!restaurantId && (employeeId === undefined || !!employeeId)`.

Export `useShifts` with its current signature unchanged (admin callers
[useShiftPlanner.ts:539](../../../src/hooks/useShiftPlanner.ts#L539),
[Scheduling.tsx:291](../../../src/pages/Scheduling.tsx#L291) must not be touched) and a new
`useMyShifts(restaurantId, employeeId: string | null, startDate?, endDate?)`.

## Step 3 — swap the two shift pages

- [EmployeeSchedule.tsx:70-79](../../../src/pages/EmployeeSchedule.tsx#L70) → `useMyShifts`;
  delete the `myShifts` filter `useMemo`; **keep** `|| employeeLoading` in the loading gate and
  rewrite the now-stale comment at [:92-94](../../../src/pages/EmployeeSchedule.tsx#L92) to
  state the real reason (a disabled query reports `isLoading: false`).
- [AvailableShiftsPage.tsx:250-254](../../../src/pages/AvailableShiftsPage.tsx#L250) →
  `useMyShifts`; drop the `employee_id` predicate from the `useMemo` but **keep**
  `status !== 'cancelled'`; fold the hook's loading into
  [:327](../../../src/pages/AvailableShiftsPage.tsx#L327)'s `const loading = feedLoading;` so
  conflict badges are not silently omitted while shifts load.

Verify: `npm run test -- --run` and `npm run typecheck`.

---

## Step 4 (RED) — `useMyPayroll` unit tests

New `tests/unit/useMyPayroll.test.ts`:

- `.eq('employee_id', id)` is recorded on all seven per-employee tables — `time_punches`,
  `tip_split_items`, `daily_labor_allocations`, `employee_tips`, `tip_payouts`,
  `overtime_adjustments` — and `.eq('id', id)` on `employees`.
- `tip_splits` and `overtime_rules` stay restaurant-scoped (design §3.2).
- `useMyPayroll(rid, null, …)` records zero queries.
- `loading` is `true` while the inner `useEmployees` query is in flight — the disabled-query
  window from design §3.2. This test must fail against today's `usePayroll` before the fix.
- `usePayroll` (admin) records today's queries unchanged.

## Step 5 (GREEN) — `useEmployees` + `usePayroll`

- `src/hooks/useEmployees.tsx`: add `employeeId?: string` to `UseEmployeesOptions`, apply
  `.eq('id', employeeId)`, add it to the query key. **Preserve the module-level
  `EMPTY_EMPLOYEES` stable reference** — it guards an infinite render loop in
  [Tips.tsx](../../../src/pages/Tips.tsx).
- `src/hooks/usePayroll.tsx`: internal implementation takes `employeeId?: string` and threads
  the predicate into the seven queries; destructure `loading: employeesLoading` at
  [:116](../../../src/hooks/usePayroll.tsx#L116) and return
  `loading: isLoading || employeesLoading` at [:484](../../../src/hooks/usePayroll.tsx#L484);
  add `employeeId` to the query key; export `usePayroll` (unchanged signature) and
  `useMyPayroll`.

Confirm [usePayroll.pagination.test.ts](../../../tests/unit/usePayroll.pagination.test.ts) and
[usePayroll.fetchRange.test.ts](../../../tests/unit/usePayroll.fetchRange.test.ts) stay green.

## Step 6 — swap `EmployeePay`

[EmployeePay.tsx:58](../../../src/pages/EmployeePay.tsx#L58) → `useMyPayroll(restaurantId,
currentEmployee?.id ?? null, startDate, endDate)`. The `.find(...)` at
[:61-64](../../../src/pages/EmployeePay.tsx#L61) still resolves against the one-element array.

---

## Step 7 (RED) — pgTAP RLS tests

New `supabase/tests/rls_employee_self_scope.sql`. Fixtures: one restaurant; a `staff`
employee with a linked `auth.users` row; a coworker employee; a `chef` member; a
`collaborator_accountant` member; a `manager` member. Switch identity with
`set_config('request.jwt.claims', …)`.

For each of the six tables — `shifts`, `employee_compensation_history`, `time_punches`,
`employee_tips`, `overtime_adjustments`, `daily_labor_allocations`:

| Subject | Expectation | Arm isolated |
|---|---|---|
| staff | own row visible | own-row clause |
| staff | coworker row **not** visible | the fix |
| chef | both visible | `view:scheduling` only |
| collaborator_accountant | both visible | `view:payroll` only |

Plus, for `shifts` specifically:

- staff sees a coworker's shift referenced by a `shift_trades.offered_shift_id` row;
- staff sees a coworker's shift referenced by a `shift_trades.requested_shift_id` row
  (inert in production — fixtures insert it directly);
- staff does **not** see a coworker's shift with no trade referencing it.

A `manager` fixture is deliberately **not** used to isolate either capability arm: it holds
both, so it cannot distinguish a working clause from an unreached one.

## Step 8 (GREEN) — the migration

`supabase/migrations/<ts>_self_scope_employee_reads.sql`. For each of the six tables:
`DROP POLICY IF EXISTS "<exact name from design §1.3>"`, then create the own-row policy and
the `user_has_capability(restaurant_id,'view:scheduling') OR
user_has_capability(restaurant_id,'view:payroll')` policy, plus the `shift_trades` clause on
`shifts` (design §4.3). Policy bodies are transcribed from the production `pg_policies` output
in design §1.3, not re-derived.

Every new policy is `TO authenticated` and spells the own-row check `(select auth.uid())`, not
bare `auth.uid()` — per-query InitPlan instead of a per-row call (design §4.1). Also create
`idx_shift_trades_requested_shift ON shift_trades (requested_shift_id)`: production has no
index on that column and the new `shifts` clause filters on it (design §4.6).

On `time_punches` and `employee_tips`, additionally drop the **pre-existing** own-row policies
(`Employees can view own time punches`, `Employees can view own tips`) so the uniform policy
replaces rather than stacks on them, and collapse each table's two byte-identical
`Managers can view …` policies to one. Both are justified in design §4.2.1 — verified
behaviour-preserving, and they keep two redundant per-row subqueries off the hottest tables.

Then: `npm run db:reset && npm run test:db` — **never** `test:db` without a reset, or the old
migration state is what gets tested.

## Step 9 — existing pgTAP sweep

`grep -rln` `supabase/tests/` for each of the six table names. Narrowing a SELECT predicate can
make an unrelated assertion **vacuous** rather than failing it, so every hit is read and
re-checked, not just re-run. Update anything that now passes for the wrong reason.

---

## Step 10 — AI tool gating (design §4.4)

`ai-execute-tool` applies RLS (anon key + forwarded JWT,
[index.ts:3615-3618](../../../supabase/functions/ai-execute-tool/index.ts#L3615)):

- Move `get_labor_costs` and `get_schedule_overview` out of `basicTools`
  ([tools-registry.ts:889-899](../../../supabase/functions/_shared/tools-registry.ts#L889)) and
  gate them on `view:scheduling OR view:payroll`, resolved via the `user_has_capability` RPC
  rather than a second hard-coded role list.
- Leave `get_kpis` basic, but have its labor component omit the labor fields with an explicit
  reason when the caller lacks the capability — never a total computed from a truncated set.
- Sweep the remaining `supabase/functions/` for forwarded-JWT clients touching the six tables.
  `generate-schedule` and `notify-schedule-published` are already confirmed `owner`/`manager`-gated.

---

## Step 11 — Verification

Run from the worktree, printing `pwd` in the same invocation as each command:

1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -- --run`
4. `npm run db:reset && npm run test:db`
5. Manual RLS spot-check against **local** Supabase: authenticate as a staff user and confirm
   a direct `supabase.from('shifts').select()` returns only that employee's rows.
6. `EXPLAIN ANALYZE` a payroll-window `time_punches` select as a `manager`, before and after the
   migration, and record both in the PR. The `user_has_capability` arm is correlated to the row
   and cannot be hoisted (design §4.6); the fallback if it regresses materially is noted there.

No E2E is added: the pages' observable behaviour is unchanged by design, and what changed is
what crosses the wire — which the unit tests assert directly and Playwright cannot.

---

## Out of scope

- Tightening `employees` (design §6) — a staff-facing surface legitimately needs coworker rows
  ([TradeRequestDialog.tsx:53](../../../src/components/schedule/TradeRequestDialog.tsx#L53)) and
  the correct fix is column-level. **File a follow-up issue** and state the residual risk in the
  PR description: a `staff` user can still enumerate coworker `employees` rows.
- ~~Consolidating the duplicate legacy `owner`/`manager` policies on `time_punches` /
  `employee_tips`~~ — pulled **in** scope (Step 8, design §4.2.1): the migration rewrites these
  exact policies anyway and the duplicates cost a per-row subquery for nothing.
- Narrowing `chef`'s access to pay rates — a product decision, not a security fix.
