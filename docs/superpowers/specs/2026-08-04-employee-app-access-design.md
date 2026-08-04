# Move 3 — App access on the employee dialog

**Status:** approved
**Date:** 2026-08-04
**Parent design:** `docs/superpowers/specs/2026-08-02-role-assignment-design.md`
**Prototype:** `docs/design-reference/role-assignment.html`, section `#v-employee`
**Depends on:** Move 1 (#688, `assign_membership_role` + `RolePicker`), Move 2 (#691, `RoleRoster`)

---

## The problem

Two separate defects, both in `src/components/EmployeeDialog.tsx`, both producing the
same report: *"I created a custom role and I can't apply it to an employee."*

**1. Every invite is hardcoded to `staff`.**

```tsx
// src/components/EmployeeDialog.tsx:425-431
supabase.functions.invoke('send-team-invitation', {
  body: {
    restaurantId: restaurantId,
    email: email.trim(),
    role: 'staff',
    employeeId: newEmployee.id, // Pass employee ID for linking
  },
})
```

The server has accepted a role choice since Move 1's predecessor:
`supabase/functions/send-team-invitation/index.ts:52-59` declares `roleId?: string`
alongside `role`, validates the pairing at `:105` and `:111`, and writes
`invitationData.role_id` at `:262`. Only the client assumes.

**2. An existing employee's dialog has no app-access row at all.**

`src/components/EmployeeDialog.tsx:1110` opens the entire block with
`{isCreateMode && (existingMember ? … : …)}`, closing at `:1167`. `isCreateMode`
is `!employee` (`:159`). So the moment an employee exists, the dialog goes silent
about whether they can sign in and as what — which is precisely when an owner
goes looking for it.

The parent design doc cites this hardcode as `EmployeeDialog.tsx:412`. That line
number is stale; it is `:429` on `f2a31da8`.

## The idea the UI has to carry

From the prototype's annotation:

> A role lives on the account, not on the employee row — which is why looking for
> it on an employee found nothing.

`employees.user_id` (`src/types/scheduling.ts:41`, nullable) is the link to an
account. The role hangs off `user_restaurants`, one row per person per restaurant.
The dialog should not grow a fake `role` field on the employee record; it should
name the real relationship and give direct access to it.

## Architecture

One new component, `src/components/employees/EmployeeAppAccessRow.tsx`, rendered
in **both** create and edit mode. `EmployeeDialog` keeps ownership of the invite
side effect; the row is presentational plus a self-contained `RolePicker`.

### State resolution

Three inputs: `employee?.user_id`, the `useRestaurantMembers(restaurantId)` roster,
and the typed `email`. `RestaurantMember` (`src/hooks/useRestaurantMembers.ts:6-27`)
carries `membershipId`, `userId`, `email`, `role`, `roleId` — exactly `RolePicker`'s
inputs. The match is `members.find(m => m.userId === employee.user_id)`.

| # | Condition | Renders |
|---|-----------|---------|
| 1 | `employee.user_id` matches a member of this restaurant | "Signed in as {email}" + live `RolePicker` on that `membershipId` + "Roles belong to the EasyShiftHQ account, not the employee record — the same control appears on Team members." |
| 2 | No `user_id` | Create mode: today's invite switch + a role choice. Edit mode: "No access — they can't sign in yet." + `Invite to the app…` |
| 3 | `user_id` set, no membership in this restaurant | Same as 2 |

State 3 is not in the prototype. It is reachable: the account was removed from the
team, or `user_id` points at an account whose membership lives in another
restaurant. Falling through to state 1 would render a `RolePicker` with no
`membershipId` — so it is explicitly folded into state 2, which offers the invite
that repairs it.

The roster query is restaurant-scoped by design (`useRestaurantMembers.ts` header
comment: a global "does this email have an account" lookup would be an
account-enumeration oracle). Matching on `userId` reads nothing the caller cannot
already see on the Team page.

While `useRestaurantMembers` is loading or has errored, state 1 cannot be
distinguished from state 3. The row renders a skeleton rather than guessing —
guessing state 2 would offer an invite to someone who already has access.

### Splitting `RolePicker`

`src/components/roles/RolePicker.tsx` welds three things together: option
selection, the gains/loses delta, and the write. `useAssignRole` at `:84`,
`commit()` at `:124-153`, and the delta footer at `:273-300` all assume a
`membershipId` to write to and a *current* role to diff against.

An invite has neither. There is no membership yet, and diffing against "no access"
would render every grant as a gain — noise, not information.

So `RolePicker.tsx` splits in two:

**`src/components/roles/RoleSelect.tsx`** — the popover, the search box, and the
two option groups. Controlled:

```ts
export interface RoleSelectProps {
  restaurantId: string;
  /** The signed-in user's role in this restaurant — gates the option list. */
  callerRole: Role;
  /** Currently selected role id, or null for "nothing chosen yet". */
  value: string | null;
  onSelect: (role: RoleWithGrants) => void;
  /** Accessible name for the trigger. Hosts differ; see WCAG note below. */
  triggerLabel: string;
  /** Visible text on the trigger chip. Must appear inside `triggerLabel`. */
  triggerText: string;
  disabled?: boolean;
  /** Rendered below the list, inside the popover. `RolePicker` puts its delta + commit here. */
  footer?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}
```

It keeps, unchanged, the filters that Move 1 established:
`isAssignableCustomRole(r, restaurantId)` and
`getInvitableRoles(callerRole)` (`RolePicker.tsx:97-103`), the "Only an owner or
manager can assign a custom role" in-place explanation (`:256-266` — hiding the
group is what produced the original confusion), and the three explicit list states
at `:231-249` rendered as direct children of `CommandList`, never through
`CommandEmpty`.

**`RolePicker.tsx`** — becomes `RoleSelect` plus the delta panel and commit button
passed as `footer`, holding `candidateId` and the `useAssignRole` mutation. Its
exported `RolePickerProps` is unchanged, so `TeamMembers.tsx:187`,
`RoleRoster.tsx:109`, `RolesList.tsx:235`/`:314`, and
`CollaboratorInvitations.tsx:538` need no edits.

`footer` is a `ReactNode` slot rather than a render prop because the footer's only
input is the candidate, which `RolePicker` already holds.

The invite branch renders bare `RoleSelect`. That is what makes the prototype's
claim — *"The invite asks which role, using the same picker"* — literally true
rather than a lookalike that drifts.

### The trigger's accessible name

`RolePicker.tsx:159` computes `${personName}: role is ${currentLabel}. Change role`.
WCAG 2.5.3 Label in Name requires the accessible name to *contain* the visible
text, so a voice-control user saying "click Manager" still hits the control. The
two hosts word it differently, so it is a prop:

- `RolePicker`: `${personName}: role is ${currentLabel}. Change role` (unchanged)
- invite branch: `Invite as ${selectedLabel}. Change role`

Both embed the visible chip text.

### Copy that stops lying

The existing hint (`EmployeeDialog.tsx:1146-1149`) hardcodes staff's access:

> Lets them clock in, view their own schedule, and request time off from their
> phone. They will not see sales, costs, payroll, or other employees.

True of Staff, false of anything else. Once the role is selectable it is replaced
by the selected role's own `description` plus `<RoleAreaChips areas={role.role_areas} />`
— the same two fields `RolePicker` already renders per option row
(`RolePicker.tsx:177-182`). "Add an email address to enable." is unchanged.

Default selection stays **Staff**: least privilege, matches today's behaviour, and
`getInvitableRoles` returns it for every inviter who can invite at all.

### Caller gating

`callerRole` comes from `useRestaurantContext().selectedRestaurant.role`
(`useRestaurants.tsx:68`, typed `Role`). `EmployeeDialog` already reads
`selectedRestaurant` at `:71`.

The dialog takes `restaurantId` as a prop. Both call sites pass the selected
restaurant (`src/pages/Employees.tsx:137`, `src/pages/Scheduling.tsx:1621`), but
the row does not assume it: `callerRole` is used only when
`selectedRestaurant?.restaurant_id === restaurantId`. On a mismatch the role
renders as a plain read-only label and the invite control is hidden — a caller
whose reach cannot be established gets no assignment surface.

Within a matching restaurant, reach is whatever `getInvitableRoles` and
`canInviteCustomRole` already grant, per the decision recorded in the parent
design: a manager may change someone to any role they could already invite them
to, custom roles included; owners keep full reach. No new matrix.

### What does not change

- No migration. `assign_membership_role` is Move 1's and is reused as-is.
- No edge-function change. `send-team-invitation` already accepts `roleId`.
- The `existingMember` / `linkToExisting` branch (`EmployeeDialog.tsx:1111-1141`,
  `link_employee_to_user` RPC at `:401`) is untouched. Linking an already-registered account is a
  different action from inviting a new one, and it already lands the person on a
  membership whose role state 1 then governs.

## Error handling

| Failure | Behaviour |
|---------|-----------|
| `useRestaurantMembers` loading | Skeleton in place of the row. No invite offered — it could be a duplicate. |
| `useRestaurantMembers` errors | Same skeleton replaced by "Couldn't load access details." No control. Consistent with the fail-closed hint in `resolveAccountlessEmployeeHint`. |
| `useRoles` loading / errors | `RoleSelect` renders its existing `:231-244` states inside the popover. |
| Assignment rejected (42501) | `RolePicker`'s existing toast via `assignRoleErrorMessage`. Unchanged. |
| Invite rejected | Existing `EmployeeDialog.tsx:432-440` toast path, unchanged. The employee is still created — the invite is fire-and-forget by design. |

## Testing

**Unit — `tests/unit/EmployeeDialog.appAccess.test.tsx` (extend):**
- create mode, switch on, role left at default → invite body carries `role: 'staff'`, no `roleId`
- create mode, custom role chosen → body carries `role: 'collaborator_custom'` and that role's `roleId`
- create mode, built-in non-staff chosen → body carries that `role`, no `roleId`
- edit mode, `user_id` matches a member → "Signed in as", chip shows the member's role
- edit mode, no `user_id` → "No access", `Invite to the app…`
- edit mode, `user_id` set with no membership here → state 2, not a `RolePicker` without a membership
- roster loading → skeleton, no invite control
- `selectedRestaurant.restaurant_id !== restaurantId` → read-only label

**Unit — `tests/unit/RolePicker.test.tsx`: must pass untouched.** That file is the
regression gate on the split; if the extraction changed observable behaviour it
fails here.

**Unit — `tests/unit/RoleSelect.test.tsx` (new):** the option-list filters —
custom roles gated by `isAssignableCustomRole`, built-ins by
`getInvitableRoles(callerRole)`, the owner/manager explanation rendering in place
of rows rather than hiding the group, and the three list states.

**E2E:**
- `tests/e2e/accountless-employee-invite.spec.ts` — extend with a custom-role invite
- `tests/e2e/role-assignment.spec.ts` — add changing an employee's role from the
  edit dialog and confirming it on the Team page, proving both surfaces write the
  same row

## Files

| Path | Change |
|------|--------|
| `src/components/roles/RoleSelect.tsx` | new — controlled option list, extracted from `RolePicker` |
| `src/components/roles/RolePicker.tsx` | modify — renders `RoleSelect` + delta/commit footer; props unchanged |
| `src/components/employees/EmployeeAppAccessRow.tsx` | new — the three states |
| `src/components/EmployeeDialog.tsx` | modify — render the row in both modes; `:429` takes the chosen role |
| `tests/unit/RoleSelect.test.tsx` | new |
| `tests/unit/EmployeeDialog.appAccess.test.tsx` | extend |
| `tests/e2e/accountless-employee-invite.spec.ts` | extend |
| `tests/e2e/role-assignment.spec.ts` | extend |

## Out of scope

- Revoking app access from the employee dialog. Removing a membership is a Team-page
  action with its own confirmation; duplicating it here would be a second path to a
  destructive operation.
- Changing an employee's role in bulk from the employee list. Move 2's
  `AssignPeopleDialog` already covers role-first bulk assignment.
- Any change to `send-team-invitation` or to `assign_membership_role`.
