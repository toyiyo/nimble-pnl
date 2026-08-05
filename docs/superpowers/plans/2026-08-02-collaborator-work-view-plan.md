# Plan — work view for collaborators who are also employees

**Design:** [`../specs/2026-08-02-collaborator-work-view-design.md`](../specs/2026-08-02-collaborator-work-view-design.md)
**Branch:** `fix/collaborator-work-view`
**Scope:** frontend only — no migration, no RLS change, no edge function.

## Files touched

| File | Change |
|---|---|
| `src/lib/viewModeEligibility.ts` | delete the `collaborator_` prefix rule; rewrite the doc comment |
| `src/contexts/ViewModeContext.tsx` | expose `isWorkViewResolved` |
| `src/App.tsx` | extract `EMPLOYEE_SELF_SERVICE_PATHS`; add the scoped grant in `StaffRoleChecker` |
| `tests/unit/viewModeEligibility.test.ts` | update the assertions that encode the defect |
| `tests/unit/ViewModeSwitch.test.tsx` | add the eligible-collaborator case |
| `tests/unit/StaffRoleChecker.employeeRoutes.test.tsx` | **new** — route-gating behaviour |
| `docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md` | correct the superseded rule at `:28` / `:31` |

Not touched, deliberately: `COLLABORATOR_ROUTES`' `allowed` arrays,
`src/lib/permissions/routeAreas.ts`, any migration.

## Tasks, in order

### 1. RED — eligibility
Rewrite `tests/unit/viewModeEligibility.test.ts`. The current `it.each` at
`:25-36` lumps `staff`/`kiosk` together with the four `collaborator_*` roles and
asserts all six are ineligible *with* an employee record. Split it:

- with an employee record: `owner`, `manager`, `chef`, `operations_manager`, **and
  all four `collaborator_*`** ⇒ `true`
- with an employee record: `staff`, `kiosk` ⇒ `false`
- with `currentEmployee: null`: every role, including each `collaborator_*` ⇒ `false`
- existing undefined-role / both-absent cases unchanged

Also fix the stale rule in that file's header comment (`:5`).
**Run it — the collaborator cases must fail.**

### 2. GREEN — eligibility
Delete `src/lib/viewModeEligibility.ts:28` and rewrite the doc comment at
`:6-9` so the stated premise matches the new rule (the current text asserts
collaborators are external, which is the false premise that caused this bug).

### 3. RED — `isWorkViewResolved`
Add to the `ViewModeContext` tests: the value is `false` when no restaurant is
selected, `false` while `employeeLoading`, `true` once both settle — including
the disabled-query case the existing comment at `ViewModeContext.tsx:73-78`
warns about.

### 4. GREEN — `isWorkViewResolved`
Add `isWorkViewResolved: boolean` to `ViewModeContextValue`, computed as
`!!selectedRestaurant && !employeeLoading`, and reuse it in the existing
`confirmedIneligible` expression rather than repeating the predicate.

### 5. RED — route gating
New `tests/unit/StaffRoleChecker.employeeRoutes.test.tsx`. Assert **behaviour**,
never the presence of a hook call:

1. collaborator + employee record + `/employee/schedule` ⇒ children render, no redirect
2. collaborator + **no** employee record + `/employee/schedule` ⇒ redirect to the role's landing
3. collaborator + unresolved + `/employee/schedule` ⇒ `RouteLoadingScreen`, **not** a redirect
4. collaborator + eligible + `/scheduling` ⇒ renders immediately, **not** held
   *(the guard against scoping the hold too widely — design "Route gating", bullet 1)*
5. collaborator + eligible + `/banking` ⇒ still redirected (grant didn't widen anything else)
6. `staff` on `/employee/schedule` ⇒ unchanged
7. `kiosk` on `/employee/schedule` ⇒ still forced to `/kiosk` (the kiosk check precedes everything)

### 6. GREEN — route gating
In `src/App.tsx`:

- Extract `const EMPLOYEE_SELF_SERVICE_PATHS = [...nine /employee/* paths]` at
  module scope; redefine `staffAllowedPaths` (`:286`) as
  `[...EMPLOYEE_SELF_SERVICE_PATHS, '/settings']`.
- In `StaffRoleChecker`, read `{ canUseWorkView, isWorkViewResolved }` from
  `useViewMode()`.
- Inside the `if (isCollaborator && role)` block, **before** the allow-list
  check, handle the employee-path case only:
  - if `currentPath` is not under `EMPLOYEE_SELF_SERVICE_PATHS` ⇒ fall through
    to the existing allow-list logic unchanged (no new blocking)
  - else if `!isWorkViewResolved` ⇒ `<RouteLoadingScreen />`
  - else if `canUseWorkView` ⇒ allow
  - else ⇒ fall through to the existing redirect

  Result: no `COLLABORATOR_ROUTES` array is mutated and non-employee paths keep
  their current, instant behaviour.

### 7. Docs
Correct `docs/superpowers/specs/2026-07-24-admin-work-view-mode-design.md:28`
and its collaborator bullet at `:31`, adding a pointer to the new spec.

### 8. Verify
- `npx vitest run` on the four affected files, then the full unit suite
- `npm run typecheck`
- **Vacuity check** (lesson 2026-07-30): `git stash` the `src/` changes only and
  confirm the new tests go red for the right reason, then restore
- Confirm `tests/unit/routeAreas.test.ts` and `tests/unit/App.viewModeWiring.test.ts`
  still pass **unchanged** — if either needed editing, task 6 was done wrong

## Risks

| Risk | Mitigation |
|---|---|
| Hold scoped too widely ⇒ every collaborator route blocks on the employee query | test 5.4 fails if so |
| Paths appended to `COLLABORATOR_ROUTES.allowed` ⇒ calibration breaks | `routeAreas.test.ts:64-72` must pass unedited |
| Persistent query error ⇒ redirect, not hold | deliberate and documented (design, "What happens if the employee query *errors*") |
| Widened surface leaks admin data | RLS confirmed self-scoped in Phase 2.5; re-audited in Phase 7 |

## Out of scope

The four pre-existing issues in the design's "Pre-existing issues surfaced by
review" section — the divergent `useCurrentEmployee` in `useTimePunches.tsx`,
`is_current_user_employee()`'s missing `status` check, the unrouted
`EmployeeShiftMarketplace.tsx`, and work-mode chrome over admin pages. Each
gets its own task.
