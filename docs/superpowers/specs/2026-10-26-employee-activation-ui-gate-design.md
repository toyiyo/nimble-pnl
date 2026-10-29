# Design: hide Deactivate and Reactivate from roles without manage:employees

Follow-up to toyiyo/nimble-pnl PR 853. This document is STE-aligned.

## Problem

PR 853 adds a server gate to `deactivate_employee` and `reactivate_employee`
(`supabase/migrations/20261026120500_secure_employee_activation_rpcs.sql`).
Both require `manage:employees` in the employee's restaurant.

The UI still shows the two actions to every role that opens `/employees`:

- `src/pages/Employees.tsx:126-132` always passes `onEmployeeDeactivate` and
  `onEmployeeReactivate` to `EmployeeList`.
- `src/components/EmployeeList.tsx:143-149`, `:166-172` and `:189-196` pass
  the handlers to `EmployeeCard` with no capability check.
- `src/components/EmployeeList.tsx:334-361` shows a button when the handler
  is set.
- `src/App.tsx:218` and `src/App.tsx:263` route `collaborator_accountant` and
  `collaborator_operations_manager` to `/employees`. These roles do not hold
  `manage:employees` (`src/lib/permissions/definitions.ts`).

For these roles, a click fails with the toast "Access denied: you cannot
manage employees for this restaurant".

## Approach

Put the gate in `EmployeeList`, because `EmployeeList` is the only component
that shows the buttons. `src/pages/Employees.tsx` is its only caller.

- Call `usePermissions()` in `EmployeeList`.
- Set `canManageEmployees = isResolved && hasCapability('manage:employees')`.
  `usePermissions` does not force `manage:employees` off while the role
  loads (`src/hooks/usePermissions.ts:86-92` names only three sensitive
  flags). The `isResolved` term makes the gate fail closed during load. This
  is the same pattern as `useReactivateEmployee`
  (`src/hooks/useEmployees.tsx:255-267`).
- When `canManageEmployees` is false, pass `undefined` for the deactivate and
  reactivate handlers on all three tabs. The existing `onDeactivate &&` and
  `onReactivate &&` checks then hide the buttons.

Rejected: a gate in `Employees.tsx`. It works for the one caller today, but a
new caller of `EmployeeList` can show the buttons again.

## Out of scope

- The Add Employee and Edit actions. They write through other paths with
  their own server checks. A separate change can gate them.
- Server behavior. PR 853 owns it.

## Tests

`tests/unit/EmployeeListActivationGate.test.tsx`:

- Hidden: no `manage:employees`, on the Active, Inactive and All tabs.
- Hidden: `manage:employees` but `isResolved` is false.
- Shown: `manage:employees` and `isResolved` true.

`tests/unit/EmployeeListMaskedRate.test.tsx` renders `EmployeeList` with no
`RestaurantContext`. It gets a `usePermissions` mock.

E2E: justified exception. The change hides two buttons by one client flag.
The unit test covers each role state. PR 853 covers the server gate in pgTAP.
