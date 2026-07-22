# Design: Clarify platform access vs. employee self-service in the invite/access UI

**Date:** 2026-07-22
**Branch:** `feature/invite-access-clarity`
**Status:** Approved scope (PR 1 of a series)

## Problem

A RushBowls owner tried to give the EasyShiftHQ collaborator (an accountant) access.
They opened **Employees → Add Employee**, filled in the person's name and email, and
saved. That silently provisioned the accountant a login with `role = 'staff'` and put
them on payroll. The intended path — **Team → Collaborators** — was never taken,
because nothing in the employee form indicated it was also an access-granting surface.

This is not user error in any meaningful sense. `EmployeeDialog` renders a bare `Email`
label sitting next to `Phone` in a compensation form (`EmployeeDialog.tsx:1017`), and on
save fires `send-team-invitation` with a hardcoded `role: 'staff'`
(`EmployeeDialog.tsx:358`). The side effect is unlabelled and the field looks inert.

### Root cause (named, not fixed here)

`user_restaurants.role` answers two orthogonal questions at once:

- **Employment** — on payroll, schedulable, clocks in. Really a property of `employees`.
- **Access** — which parts of EasyShiftHQ this person may open.

`user_restaurants` carries `UNIQUE(user_id, restaurant_id)`, so one person gets exactly
one role per restaurant. Welding the two questions together produces both observed
failures: a manager who is also on payroll cannot exist (drives the two-account
workaround), and an accountant who is not on payroll gets accidentally created as one.
Same bug, two directions.

Splitting employment from access is a schema change and is **out of scope for this PR**.
This PR fixes the surfaces where the confusion is actually created.

### Second failure, discovered while scoping this design

The recovery path from a mis-provisioned invite is silently broken.
`accept-invitation/index.ts:109-131` checks whether the invitee is already a member of
the restaurant and, if so, **skips the `user_restaurants` insert entirely** and just marks
the invitation accepted:

```ts
if (!existingMember) { /* insert with invitation.role */ }
else { console.log('User is already a member, just marking invitation as accepted'); }
```

So the natural remedy — "I invited them wrong, let me re-invite them as an Accountant" —
sends an email, the invitee clicks it, the UI says success, and **their access does not
change**. There is no error anywhere. This is the same shape as the Cold Stone `$0`
batch-costing bug (lessons, 2026-07-05): a "did work" function that no-ops on a lookup
hit, with no signal to the caller.

The correct remedy is the role dropdown in **Team → Team Members**, which writes
`user_restaurants.role` directly. Nothing in the invite UI says so.

## Scope

Four changes. No schema change, no migration, no edge-function behaviour change beyond
keeping the invite matrix mirrors in sync.

### 1. `EmployeeDialog` — explicit opt-in instead of a load-bearing Email field

**Today:** non-empty `email` on create ⇒ silent `send-team-invitation` with `role: 'staff'`.

**After:** the email field is a contact/payroll field and grants nothing. A new **App
access** section appears in create mode only, containing a single `Switch`, default
**off**:

> **Invite to the employee app**
> Lets them clock in, view their own schedule, and request time off from their phone.
> They will not see sales, costs, payroll, or other employees.

- The switch is `disabled` when the email field is empty, with the hint
  *"Add an email address to enable."*
- The invite fires only when the switch is on **and** an email is present.
- Toast copy distinguishes the two outcomes ("Employee created" vs.
  "Employee created and invited").

**Create mode only, deliberately.** The invite side effect only exists in the create path
today; edit mode never invites. Rendering the switch in edit mode would imply a
capability that does not exist. Access for existing employees is managed from the Team
page — that stays true and this PR does not change it.

**Accepted behaviour change:** a manager who previously got an invite "for free" by typing
an email now needs one deliberate click. That extra click is the entire point.

### 2. Vocabulary — "Staff" becomes "Employee (self-service)"

`ROLE_METADATA.staff` in `src/lib/permissions/definitions.ts`:

| field | before | after |
|---|---|---|
| `label` | `Staff` | `Employee (self-service)` |
| `description` | `Employee self-service` | `Clock in/out, view their own schedule, request time off` |

"Staff" reads as a generic bucket that any restaurant worker belongs in — including the
accountant, in the mind of the person doing the inviting. "Employee (self-service)" names
the actual capability boundary.

The `TeamInvitations` role `Select` currently renders every invitable role as one flat,
undifferentiated list of labels (`TeamInvitations.tsx:289`). It gains:

- **Three `SelectGroup`s with `SelectLabel`s** — `Management access`, `Employee
  self-service`, `External collaborators` — derived from `ROLE_METADATA.category` plus
  the `staff` split, so the platform-vs-employee distinction is visible at the exact
  moment of the decision.
- **Two-line `SelectItem`s** — label on top, `ROLE_METADATA[role].description` beneath in
  `text-[12px] text-muted-foreground`.

`ROLE_METADATA.staff.label` is also rendered as a `Badge` in `TeamMembers.tsx:223`. See
*Decided trade-offs*.

### 3. Detect an email that already belongs to a team member

A shared helper resolves "is this email already a member of *this restaurant*?" against
the same `user_restaurants` + `profiles` join `TeamMembers.tsx:70-90` already performs.

**Scoped to the current restaurant on purpose.** Checking whether an arbitrary email has
an EasyShiftHQ account anywhere would be an account-enumeration oracle. Restricting the
lookup to members of the restaurant the caller already administers leaks nothing they
cannot already read on the Team page.

Two consumers:

**a. `TeamInvitations` — block, don't warn.** When the typed email matches an existing
member, disable the Send button and render an amber panel:

> **{name} is already on your team as {Role}.**
> Sending another invitation will not change their access — accepting it is a no-op.
> To change what they can see, use the role dropdown in **Team Members**.

A hard block rather than the existing `pendingConflict` "resend anyway" pattern, because
the action provably does nothing (see *Second failure* above). Offering "send anyway"
would be offering to send an email that lies.

**b. `EmployeeDialog` — offer to link instead of double-provisioning.** When the entered
email matches an existing member, the App access section swaps its switch for:

> **{name} already has an EasyShiftHQ account ({Role}).**
> Link this employee record to that account — they will keep their current access and be
> able to clock in.

On save this calls the existing `link_employee_to_user(p_employee_id, p_user_id)` RPC
(`20251115100200_link_employee_to_user_helper.sql`) instead of `send-team-invitation`.
No second account, no second login, no downgrade. This is precisely the RushBowls
manager-who-must-also-punch-in case.

The RPC is `SECURITY DEFINER` and gates on `role IN ('owner','manager')` — note that
`operations_manager` is **not** in that list even though it holds `manage:employees`. It
returns `success=false` with a message rather than raising, so the client must read the
returned row and surface the failure; the employee is still created either way.

### 4. Remove `'kiosk'` from the human invite matrix

A kiosk is a shared device credential, not a person with an inbox. It sits in the
`owner` and `manager` rows of `INVITABLE_ROLES` today
(`src/lib/permissions/invitations.ts:13,18`), which makes "Kiosk" an option in the same
dropdown as "Accountant" — the same category error as the one this PR is fixing, just
cheaper so far.

The matrix is mirrored verbatim in the Deno edge function
(`supabase/functions/send-team-invitation/index.ts:12-24`), which the file header already
flags as a must-stay-in-sync duplicate. **Both must change together**, and a test must
assert they agree — a schema→consumer contract with two consumers and no compiler link
between them is exactly the drift shape from the 2026-05-22 lesson.

`tests/unit/invitationMatrix.test.ts:23` currently asserts kiosk *is* invitable
("preserving pre-existing behavior"). That assertion inverts.

## Out of scope (deferred, agreed)

| Deferred | Why |
|---|---|
| Unified role-first invite flow across all doors | Needs the employment/access schema decision first |
| Consequence preview ("can see / can't see") in `TeamInvitations` | Larger UI; `COLLABORATOR_PRESETS.features` already holds the data |
| Team page columns for access + payroll status | Depends on the same schema split |
| SCIM/SSO `default_role: 'staff'` + `auto_provisioning: true` defaults | Same trap at org scale, unreachable from any wizard; own PR |
| `accept-invitation` silent role no-op | Real bug, but fixing it is a behaviour change to an auth path — deserves its own PR and its own tests |

## Decided trade-offs

- **`Employee (self-service)` is long for a `Badge`.** It renders at ~22 characters in
  `TeamMembers.tsx:223`. Accepted: the badge is on a wide desktop table row, and the
  clarity is worth more at the invite decision point than the tidiness is worth in the
  member list. Rejected the alternative of adding a `shortLabel` field to
  `RoleMetadata` — a second name for the same role is how vocabulary drifts back apart.
- **The `EmployeeDialog` access switch is create-only.** Consistent with the only path
  that actually invites. Revisit when access moves out of `user_restaurants.role`.
- **`TeamInvitations` blocks rather than warns on an existing member.** Honest about a
  no-op; costs an owner one navigation to Team Members in the rare legitimate case.
- **Existing-member lookup is restaurant-scoped.** Deliberately not a global "does this
  email have an account" check — that would be an enumeration oracle.
- **`accept-invitation`'s no-op is documented, not fixed.** Change 3a routes users away
  from it; the underlying auth-path fix is its own PR.

## Testing

| Change | Test | Location |
|---|---|---|
| 1 | Switch defaults off; no invite when off; invite fires when on; disabled with empty email | `tests/unit/EmployeeDialog.appAccess.test.tsx` |
| 2 | `ROLE_METADATA.staff` label/description; groups + descriptions render in the invite Select | `tests/unit/permissions.test.ts`, `tests/unit/TeamInvitations.test.tsx` |
| 3a | Existing member ⇒ Send disabled + panel; non-member ⇒ enabled | `tests/unit/TeamInvitations.test.tsx` |
| 3b | Match ⇒ `link_employee_to_user` called, `send-team-invitation` not; RPC `success=false` surfaces a toast | `tests/unit/EmployeeDialog.appAccess.test.tsx` |
| 4 | kiosk not invitable by anyone; **TS matrix and Deno mirror agree** | `tests/unit/invitationMatrix.test.ts` |

Assertions use accessible roles/labels, not text-node fragments (lessons, 2026-06-27).

## Implementation notes carried from lessons

- Any dialog subtitle must be `<DialogDescription>`, never a plain `<p>` — Radix wires
  `aria-describedby` off the primitive (lessons, 2026-05-29).
- If a confirm control must survive an async result, `event.preventDefault()` before the
  first `await` (lessons, 2026-07-05). Relevant if the link-to-existing flow grows a
  confirmation step.
- The Deno invite-matrix mirror is a second consumer of the same contract; grep the
  symbol across `src/` **and** `supabase/` before declaring the change wired up
  (lessons, 2026-05-22).
