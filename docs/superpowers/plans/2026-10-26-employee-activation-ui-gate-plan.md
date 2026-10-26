# Plan: hide Deactivate and Reactivate from roles without manage:employees

Design: `docs/superpowers/specs/2026-10-26-employee-activation-ui-gate-design.md`

1. RED: write `tests/unit/EmployeeListActivationGate.test.tsx`. Mock
   `useEmployees` and `usePermissions`. Assert the hidden and shown cases.
2. GREEN: in `src/components/EmployeeList.tsx`, call `usePermissions()`.
   Compute `canManageEmployees`. Pass `undefined` handlers when it is false.
3. Add a `usePermissions` mock to `tests/unit/EmployeeListMaskedRate.test.tsx`.
4. Run `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`.
5. Push to `claude/great-bell-knqz1j`. Open a PR with base
   `claude/keen-thompson-1157fv` (PR 853).
