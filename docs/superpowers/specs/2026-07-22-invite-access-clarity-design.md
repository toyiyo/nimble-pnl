# Design: Clarify platform access vs. employee self-service in the invite/access UI

**Date:** 2026-07-22
**Branch:** `feature/invite-access-clarity`
**Status:** Revised after Phase 2.5 review (supabase-design-reviewer + frontend-design-reviewer)

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

`send-team-invitation` has **three** client call sites, not one — `EmployeeDialog.tsx`,
`TeamInvitations.tsx`, and `useCollaborators.ts:138,248` (behind
`CollaboratorInvitations.tsx`). The collaborator door is the one the RushBowls owner
should have used and the one they will use to *correct* the mistake, so it needs the same
guard. Guarding only `TeamInvitations` would leave the highest-traffic recovery path
silently broken.

## Scope

Five changes. One small migration; no schema change to any table.

### 1. `EmployeeDialog` — explicit opt-in instead of a load-bearing Email field

**Today:** non-empty `email` on create ⇒ silent `send-team-invitation` with `role: 'staff'`.

**After:** the email field is a contact/payroll field and grants nothing. A new **App
access** section, in create mode only, containing a single `Switch`, default **off**:

> **Invite to the employee app**
> Lets them clock in, view their own schedule, and request time off from their phone.
> They will not see sales, costs, payroll, or other employees.

- **Placement: immediately after the Email/Phone grid** (`EmployeeDialog.tsx:1041`), not
  appended at the end of the form. The coupling "type an email → this becomes usable" is
  only legible if the two are spatially adjacent; 700 lines of compensation fields
  between them would recreate the confusion this change exists to remove.
- **Not natively `disabled` when email is empty.** A `disabled` Radix `Switch` leaves the
  tab order, so a keyboard user tabs straight past the one control that explains the
  situation. Use `aria-disabled="true"` + a no-op guard in `onCheckedChange`, with the
  hint *"Add an email address to enable"* wired via `aria-describedby`. Mirrors the
  existing `Label`+`Switch` id pairing at `EmployeeDialog.tsx:730-743`.
- The invite fires only when the switch is on **and** an email is present.
- Toast copy distinguishes the outcomes ("Employee created" vs. "Employee created and
  invited").

**Create mode only, deliberately.** The invite side effect only exists in the create path
today; edit mode never invites. Rendering the switch in edit mode would imply a
capability that does not exist. Access for existing employees is managed from the Team
page — that stays true and this PR does not change it.

**Accepted behaviour change:** a manager who previously got an invite "for free" by typing
an email now needs one deliberate click. That extra click is the entire point.

### 2. Vocabulary — "Staff" becomes "Employee (self-service)", and the Select is grouped

`ROLE_METADATA.staff` in `src/lib/permissions/definitions.ts`:

| field | before | after |
|---|---|---|
| `label` | `Staff` | `Employee (self-service)` |
| `description` | `Employee self-service` | `Clock in/out, view their own schedule, request time off` |

"Staff" reads as a generic bucket that any restaurant worker belongs in — including the
accountant, in the mind of the person doing the inviting. "Employee (self-service)" names
the actual capability boundary.

**New `accessGroup` field on `RoleMetadata`.** The first draft said to derive the Select's
groups from `ROLE_METADATA.category`, which was wrong: `category` has only two values and
`internal` contains `chef` (`definitions.ts:284-291`), so that bucketing would file Chef
under "Management" — the same category error this PR exists to kill. Instead add an
explicit, typed field:

| `accessGroup` | roles | Select group heading |
|---|---|---|
| `platform` | `owner`, `manager`, `operations_manager`, `chef` | **Platform access (EasyShiftHQ)** |
| `employee` | `staff` | **Employee self-service** |
| `collaborator` | the three `collaborator_*` roles | **External collaborators** |
| `device` | `kiosk` | *(never rendered — not a person; see change 4)* |

`chef` is genuinely platform access without being management, so "Platform access" is the
honest heading and the grouping stops needing a special case. `device` exists so the
`Record<Role, RoleMetadata>` stays total and documents *why* kiosk is not invitable.

The `TeamInvitations` role `Select` (`TeamInvitations.tsx:284-292`) gains:

- **`SelectGroup` + `SelectLabel` per `accessGroup`**, in the order above. Group headings
  render only when more than one group has items — `operations_manager` can invite only
  `staff` (`invitations.ts:21`), and a lone heading over a one-item list is noise.
- **Two-line `SelectItem`s** — label, then `ROLE_METADATA[role].description` in
  `text-[12px] text-muted-foreground`.
- **`SelectValue` must be given explicit children.** `ui/select.tsx:119` wraps a
  `SelectItem`'s entire `children` in `SelectPrimitive.ItemText`, and a childless
  `<SelectValue />` makes Radix portal that whole subtree into the trigger. With two-line
  items the trigger — which carries `[&>span]:line-clamp-1` (`ui/select.tsx:22`) — would
  render label and description mashed into one clamped line
  ("AccountantFinancial data access for bookkeeping…"). Render
  `<SelectValue>{ROLE_METADATA[inviteForm.role]?.label}</SelectValue>` so only the label
  reaches the trigger.

`ROLE_METADATA.staff.label` also renders as a `Badge` in `TeamMembers.tsx:223`. See
*Decided trade-offs*.

### 3. Detect an email that already belongs to a team member

A shared React Query hook resolves "is this email already a member of *this restaurant*?"
from the same `user_restaurants` + `profiles` join `TeamMembers.tsx:70-90` performs.

- **React Query, not the raw `useEffect` + `useState` fetch that `TeamMembers` uses.**
  That existing code predates the convention and copying it would propagate a CLAUDE.md
  "No Manual Caching" violation into new code.
  `useQuery({ queryKey: ['restaurant-members', restaurantId], staleTime: 30000 })`.
- **Fetched once per dialog session, keyed on `restaurantId`, and diffed client-side** —
  not re-fetched per keystroke in the email field.
- **Case-insensitive comparison.** `profiles.email` is plain `TEXT`, not `CITEXT`
  (`20250915204511_*.sql:5`). Normalize with `toLowerCase()` on both sides or a
  mixed-case address false-negatives past the check.
- **Three-state discipline.** While the roster query is in flight, render the *default*
  UI — never the "already a member" state. On lookup error, **fail open**: fall back to
  the normal switch/send-enabled behaviour rather than blocking the whole feature because
  a lookup failed.
- **Scoped to the current restaurant on purpose.** Checking whether an arbitrary email has
  an EasyShiftHQ account anywhere would be an account-enumeration oracle. Restricting the
  lookup to members of the restaurant the caller already administers leaks nothing they
  cannot already read on the Team page. Confirmed RLS-safe by review: the
  `user_restaurants` SELECT policy (`20260120100000_add_collaborator_roles.sql:201-213`,
  via `user_is_internal_team`) and the paired `profiles` SELECT policy
  (`20251006212711_*.sql:42-64`) scope reads to the caller's own restaurant's team.

Three consumers:

**a. `TeamInvitations` — block, don't warn.** When the typed email matches an existing
member, render an amber panel and stop the send:

> **{name} is already on your team as {Role}.**
> Sending another invitation will not change their access — accepting it does nothing.
> To change what they can see, use the role dropdown in **Team Members**.

A hard block rather than the existing `pendingConflict` "resend anyway" pattern
(`TeamInvitations.tsx:295-311`), because the action provably does nothing. Offering "send
anyway" would be offering to send an email that lies.

**Announced, not silently inert.** Do not use native `disabled` on the Send button — that
removes it from the tab order and announces nothing, so a keyboard user tabs from the
Role select into a void. Instead: keep the button focusable with `aria-disabled="true"`,
guard the click handler, give the panel an `id` referenced by `aria-describedby` on the
button, and mark the panel `role="status" aria-live="polite"` so it is announced when the
match is detected.

**b. `CollaboratorInvitations` — same guard.** `handleSendInvitation`
(`CollaboratorInvitations.tsx:50-65`) has no existing-member check at all; its Send button
is disabled only on `!email` or in-flight. This is the door the RushBowls owner *should*
have used and the one they will reach for to correct the mistake — re-inviting an existing
member as `collaborator_accountant` hits the same silent no-op. Same hook, same amber
panel, same `aria-disabled` treatment.

**c. `EmployeeDialog` — offer to link, on an explicit gesture.** When the entered email
matches an existing member, the App access section swaps its invite switch for a
link affordance:

> **{name} already has an EasyShiftHQ account ({Role}).**
> **Link this employee record to their account** *(switch, default off)*
> They keep their current access and can also clock in. No second account is created.
> *Not them? Leave this off — the employee record is created without linking or inviting.*

**The switch is required and defaults off.** The first draft had linking fire
automatically on save whenever the email happened to match, which directly contradicts
this PR's own principle that access-granting needs a deliberate click. Two employees can
share a household email and an owner can mistype an address into a collision; an ambient
consequence of what was typed is exactly the failure mode being fixed. Leaving the switch
off still creates the employee record — declining to link is a first-class outcome, not a
dead end requiring the owner to edit the email.

On save with the switch on, call `link_employee_to_user(p_employee_id, p_user_id)`
(`20251115100200_link_employee_to_user_helper.sql`) instead of `send-team-invitation`.
No second account, no second login, no downgrade. This is precisely the RushBowls
manager-who-must-also-punch-in case.

The RPC returns a row with a `success` boolean rather than raising, so the client must
read the returned row and surface failures. **`already linked to user …` is a soft
success** — a double-click or retry must not produce a false-failure toast for work that
already landed.

### 4. Remove `'kiosk'` from the human invite matrix

A kiosk is a shared device credential, not a person with an inbox. It sits in the
`owner` and `manager` rows of `INVITABLE_ROLES` today
(`src/lib/permissions/invitations.ts:13,18`), which makes "Kiosk" an option in the same
dropdown as "Accountant" — the same category error as the one this PR is fixing, just
cheaper so far. Review confirmed this is a pure allowlist shrink: `send-team-invitation`
runs `canInviteRole()` before inserting the invitation row
(`send-team-invitation/index.ts:106-113`), so there is no migration or data repair.

The matrix is mirrored verbatim in the Deno edge function
(`send-team-invitation/index.ts:12-24`), which the source file header already flags as a
must-stay-in-sync duplicate. Both change together.

**The sync test must structurally compare the two literals, not check `kiosk`'s absence
twice.** Two independent `not.toContain('kiosk')` assertions would still pass if a future
change added a role to one file and not the other — the exact drift shape being guarded
against. Regex-extract both `INVITABLE_ROLES` object literals from source text and
deep-equal them key by key. Reading the Deno file as text is required (its
`https://deno.land/...` specifiers cannot be imported into Vitest); precedent:
`tests/unit/stripe-sync-rpc-name.test.ts`.

`tests/unit/invitationMatrix.test.ts:23` currently asserts kiosk *is* invitable
("preserving pre-existing behavior"). That assertion inverts.

### 5. Migration — repair `link_employee_to_user` before routing UI traffic to it

Change 3c makes this RPC a real user-facing path for the first time. Three defects make
it unfit as-is:

1. **`operations_manager` is excluded.** The allowlist is `role IN ('owner','manager')`
   (`20251115100200_*.sql:47-60`), but `operations_manager` holds `manage:employees`
   (`definitions.ts:166`) and can invite staff. They can therefore reach the link
   affordance, get `success=false`, and be left with an orphaned `employees` row
   (`user_id = NULL`) beside an existing membership — reproducing the double-provisioning
   this PR exists to prevent, with an error message instead of silence. The allowlist
   predates the role. Precedent for extending it:
   `20260702170000_add_operations_manager_role.sql`.
2. **Existence leaks before authorization.** The employee and target `auth.users` lookups
   run *before* the caller's authorization check, returning distinct "Employee not found"
   / "User not found" messages. Any authenticated user can distinguish "doesn't exist"
   from "exists, not authorized." Reorder: resolve the employee, collapse a miss into a
   single non-committal message, authorize, and only then look up the target user.
3. **A comment that overstates protection.** Lines 96-100 claim the public grant was
   removed; no `REVOKE EXECUTE … FROM PUBLIC` exists anywhere in `supabase/migrations/`.
   Postgres grants `EXECUTE` to `PUBLIC` by default and Supabase grants it to
   `anon`/`authenticated` — which is what makes the client `rpc()` call in 3c work at all.
   The internal check is the *only* boundary. Correct the comment so nobody reads a
   second layer that isn't there.

pgTAP coverage per CLAUDE.md: owner links, manager links, operations_manager links, chef
rejected, cross-restaurant caller rejected, already-linked path, unauthorized caller gets
the non-committal message.

## Out of scope (deferred, agreed)

| Deferred | Why |
|---|---|
| Unified role-first invite flow across all doors | Needs the employment/access schema decision first |
| Consequence preview ("can see / can't see") in the invite dialogs | Larger UI; `COLLABORATOR_PRESETS.features` already holds the data |
| Team page columns for access + payroll status | Depends on the same schema split |
| SCIM/SSO `default_role: 'staff'` + `auto_provisioning: true` defaults | Same trap at org scale, unreachable from any wizard; own PR |
| `accept-invitation` silent role no-op (`accept-invitation/index.ts:109-131`) | Real bug, but fixing it changes behaviour on an auth path — own PR with its own tests. Changes 3a and 3b block the two UI paths that reach it; a deep link to a stale invitation URL still can. |

## Decided trade-offs

- **`Employee (self-service)` is long for a `Badge`.** ~22 characters in
  `TeamMembers.tsx:223`, whose row (`TeamMembers.tsx:200`) has no `min-w-0`/`truncate` on
  either side. Verify at 375×667 and add `min-w-0` + `truncate` to the name container if
  the row wraps. Rejected adding a `shortLabel` to `RoleMetadata` — a second name for the
  same role is how vocabulary drifts back apart.
- **The `EmployeeDialog` access switch is create-only.** Consistent with the only path
  that actually invites. Revisit when access moves out of `user_restaurants.role`.
- **The invite dialogs block rather than warn on an existing member.** Honest about a
  no-op; costs an owner one navigation to Team Members in the rare legitimate case.
- **Existing-member lookup is restaurant-scoped**, deliberately not a global
  "does this email have an account" check.
- **Lookup failures fail open**, favouring a working invite flow over a guard that can
  strand an owner when the roster query errors.
- **Amber panels use `bg-amber-500/10 border-amber-500/20` with `text-foreground` body**
  — the CLAUDE.md-documented pattern and the existing `TeamInvitations.tsx:296` panel.
  `EmployeeDialog.tsx:750` uses `text-amber-700 dark:text-amber-400` for the FLSA warning;
  not worth churning, but new panels follow the documented pattern.
- **Copy blocks reuse the existing `isExempt` scale** (`EmployeeDialog.tsx:729-736`):
  `text-[14px] font-medium text-foreground` title, `text-[13px] text-muted-foreground`
  body. No new type sizes.

## Testing

| Change | Test | Location |
|---|---|---|
| 1 | Switch defaults off; no invite when off; invite fires when on; `aria-disabled` + hint wiring with empty email; switch is focusable while aria-disabled | `tests/unit/EmployeeDialog.appAccess.test.tsx` |
| 2 | `ROLE_METADATA.staff` label/description; every role has an `accessGroup`; `chef` is `platform`, not management; groups + descriptions render; trigger shows label only (not label+description) | `tests/unit/permissions.test.ts`, `tests/unit/TeamInvitations.test.tsx` |
| 3 | Case-insensitive match; pending lookup renders default UI; lookup error fails open | `tests/unit/useRestaurantMembers.test.ts` |
| 3a/3b | Existing member ⇒ send guarded + panel announced (`role="status"`, `aria-describedby`); non-member ⇒ normal send | `tests/unit/TeamInvitations.test.tsx`, `tests/unit/CollaboratorInvitations.test.tsx` |
| 3c | Match + switch on ⇒ `link_employee_to_user` called and `send-team-invitation` not; switch off ⇒ neither, employee still created; `success=false` surfaces a toast; `already linked` is a soft success | `tests/unit/EmployeeDialog.appAccess.test.tsx` |
| 4 | kiosk not invitable by anyone; **TS and Deno matrices deep-equal**, not just both kiosk-free | `tests/unit/invitationMatrix.test.ts` |
| 5 | owner/manager/operations_manager link; chef and cross-restaurant callers rejected; unauthorized caller gets the non-committal message; already-linked path | `supabase/tests/link_employee_to_user.sql` |

Assertions use accessible roles/labels, not text-node fragments (lessons, 2026-06-27).

## Implementation notes carried from lessons

- Any dialog subtitle must be `<DialogDescription>`, never a plain `<p>` — Radix wires
  `aria-describedby` off the primitive (lessons, 2026-05-29).
- If a confirm control must survive an async result, `event.preventDefault()` before the
  first `await` (lessons, 2026-07-05).
- The Deno invite-matrix mirror is a second consumer of the same contract; grep the
  symbol across `src/` **and** `supabase/` before declaring the change wired up
  (lessons, 2026-05-22).
- A "did work" function that can no-op must fail loudly when work was expected
  (lessons, 2026-07-05) — the reason change 3a blocks rather than warns.
