# Assigning a role to someone who is already here

**Date:** 2026-08-02
**Status:** Approved design, PR 1 of 3
**Prototype:** `docs/design-reference/role-assignment.html`
**Predecessor:** PR #683 (roles-and-areas)

## The problem

PR #683 shipped custom roles. They can be created, edited, previewed, and
copied between restaurants — and then never given to anybody. In production,
restaurant `7c0c76e3-e770-401b-a2a9-c1edd407efed` holds a custom role
"Operations lead" (`d9cf6461-b1d3-4a5a-bb85-6e27b3f10b05`) with zero members,
while all 40 of its people sit on builtin role ids.

The database path is open and deliberate. The migration that created it names
the path in its own header: writing `role` and `role_id` together in one UPDATE
means "the caller wins, untouched — this is the custom-role assignment path"
(`supabase/migrations/20260730170000_invitation_role_id_and_membership_role_sync.sql:62`).
No client ever calls it.

Three client gaps sit on top of that:

1. `src/components/TeamMembers.tsx:252` sources its dropdown from the closed
   `Role` union, which structurally cannot contain a custom role — every custom
   role shares the single string `'collaborator_custom'`
   (`src/lib/permissions/invitations.ts:59`). And `updateMemberRole`
   (`src/components/TeamMembers.tsx:112`) writes only the legacy `role` column,
   so even if a custom role could be selected, the sync trigger would derive
   `builtin_role_id_for('collaborator_custom')` → NULL → a member with zero
   capabilities.
2. `src/hooks/useCollaborators.ts` has no update-role mutation at all. The only
   way to change a collaborator's role is remove → re-invite → re-accept.
3. `src/components/EmployeeDialog.tsx:412` hardcodes `role: 'staff'`.

This spec covers **Move 1** — the write path and the picker on Team members and
Collaborators. Moves 2 (role card → roster) and 3 (EmployeeDialog app access)
follow as separate PRs against this same design.

## The finding that shapes everything

`user_restaurants` UPDATE passes through two independent gates.

| Policy | Type | Clause |
|---|---|---|
| Owners can manage restaurant associations | PERMISSIVE | `USING (user_id = auth.uid() OR is_restaurant_owner(restaurant_id, auth.uid()))` |
| Prevent self-escalation to privileged roles | RESTRICTIVE | `WITH CHECK (is_restaurant_owner(...) OR (role IN ('staff','kiosk') AND (role_id IS NULL OR role_id = builtin_role_id_for(role))))` |

(Verified against production `pg_policies`; the restrictive policy is
`supabase/migrations/20260730180000_close_role_id_self_escalation.sql`.)

The PERMISSIVE `USING` clause decides whether a row is **targetable at all**. A
manager updating another member's row matches neither branch, so zero rows
match — and Postgres raises no error for a row that RLS filtered away.
`src/components/TeamMembers.tsx:119` checks only `{ error }` and then fires a
success toast at line 121. **A manager changing anyone's role today sees
"Member role updated successfully" while nothing changed.** This is a live
silent-failure bug, not a hypothetical.

The two paths also disagree with each other. Inviting runs through the
`send-team-invitation` edge function on the service-role key, which does its own
matrix check and admits managers to custom roles
(`supabase/functions/send-team-invitation/index.ts:45`). So a manager can invite
a brand-new person straight into "Operations lead" but cannot move an existing
person into it — the same confusion this work exists to remove, wearing a
different hat.

**Decision (user, 2026-08-02): role changes match the invite matrix.** A manager
may change someone to any role they could already have invited them to, custom
roles included. Owners keep full reach.

## Architecture

### Where the privilege decision lives

A `SECURITY DEFINER` RPC in Postgres, not a new edge function.

`user_restaurants` has `relforcerowsecurity = false` and is owned by `postgres`,
so a definer function bypasses RLS on it. `copy_role_to_restaurants` is already
exactly this shape — a `SECURITY DEFINER` RPC for role administration
(`prosecdef = true`, verified in production). The deciding factor is testing:
pgTAP runs in CI via `npm run test:db` with `copy_role_to_restaurants_test.sql`
and `replace_role_grants_test.sql` as direct templates, while edge functions
have no harness wired into `npm run test`. The most security-sensitive logic in
this change belongs where it can be tested.

The cost is a third copy of the invite matrix — TS, Deno, now SQL.
`tests/unit/inviteMatrixMirror.test.ts` already exists solely to prevent TS↔Deno
drift by parsing both source files textually; it gains a third parser for the
SQL `VALUES` list so all three stay pinned to each other.

### `assign_membership_role(p_membership_id, p_role, p_role_id)`

`SECURITY DEFINER`, `SET search_path = public`. **Raises on every denial** with
`ERRCODE 42501`, following `invitations_validate_role_id()`
(`supabase/migrations/20260730170000_invitation_role_id_and_membership_role_sync.sql`).
Raising rather than filtering is the point: a definer function that returned
zero rows would reproduce the exact silent no-op this change exists to kill.

Rules, in order:

1. **The membership must exist.** Load it; its `restaurant_id` is authoritative.
   Restaurant scope is never taken from client input.
2. **Never self-target.** If the membership's `user_id = auth.uid()`, refuse.
   Self-escalation is what the restrictive policy protects against, and the UI
   has no need for it — you do not change your own role from this surface.
3. **Resolve the caller's role** in that restaurant from `user_restaurants`.
4. **Matrix check.** `p_role` must appear in the caller's row of the SQL invite
   matrix. `kiosk` is absent from every row by design — a kiosk is a shared
   device credential, not a person
   (`src/lib/permissions/invitations.ts:12-13`) — so nobody can be moved *into*
   it. The matrix cannot express the other direction, so it is a separate rule:
   a membership whose current role is `kiosk` is refused outright. Converting a
   shared device credential into a person's account is not a role change.
5. **Owners are special-cased twice.** Only an owner may change a member whose
   *current* role is `owner`; otherwise a manager could demote the owner, since
   `staff` is in the manager's matrix row. And the last remaining owner cannot
   be changed at all, or a restaurant orphans itself.
6. **Custom role.** When `p_role = 'collaborator_custom'`, `p_role_id` is
   required, the caller's role must be in `CUSTOM_ROLE_INVITERS`, and the named
   `roles` row must have `restaurant_id` equal to the membership's — never a
   global builtin, never another tenant's. When `p_role` is anything else,
   `p_role_id` must be NULL; passing both is a caller error, not a silent
   preference.
7. **Write both columns together.** `{role, role_id}` in one UPDATE, per the
   path the migration header names. Builtins get
   `builtin_role_id_for(p_role)` written *explicitly* rather than left to the
   sync trigger, which fires only when `role` changes and `role_id` does not
   (`…170000_invitation_role_id_and_membership_role_sync.sql`, section 3).
   Writing both means the caller always wins, and the resulting row is
   never a `collaborator_custom` with a NULL `role_id` — the zero-capability
   state.

Moving someone out of a custom role is the ordinary case of rule 7: the caller
picks `staff`, and the row lands on `staff` + the `staff` builtin id. Never
NULL.

### The builtin-role ↔ `roles`-row mapping

The picker renders area chips and a permission delta for **every** option,
builtin and custom alike. Custom roles carry their grants already — `useRoles`
returns `role_areas`/`role_flags` per row (`src/hooks/useRoles.ts:59`), which
feeds `buildRolePreview(grants, flags, roleName)`
(`src/lib/permissions/preview.ts:218`) directly.

Builtins are the gap. `useRoles` returns their rows too, but nothing links the
legacy role string `'chef'` to the row `b0000000-…-04`. That mapping exists only
inside `builtin_role_id_for`, and `grep` confirms **no builtin UUID appears
anywhere in `src/`** — the client has deliberately never hardcoded them. This
design does not start.

Matching on display name is not an option either: the DB names
(`Employee (self-service)`, `Recipe Consultant`) and `ROLE_METADATA` labels
(`src/lib/permissions/definitions.ts:299`) are maintained separately, so a
rename would break the join silently.

**Add a nullable `legacy_role TEXT` column to `roles`**, populated on the ten
builtin rows and NULL for custom roles. `useRoles` selects it, and the client
gets an exact, data-driven mapping with no hardcoded UUIDs and no name
matching.

`builtin_role_id_for` is deliberately **not** rewritten to read the column.
It is `IMMUTABLE` and referenced inside a RESTRICTIVE policy's `WITH CHECK`;
reading a table would force it to `STABLE`, which is a change to a
security-critical function that this PR has no reason to make. Instead a pgTAP
test asserts the column and the function agree for all ten builtins, so the two
cannot drift.

### The picker

One shared component, used from Team members and from Collaborators. Per the
approved prototype, the role chip **is** the control — clicking it opens a
popover with search, grouped "Your custom roles" / "Built-in", each row showing
name, description, area chips, and a checkmark on the current role. It replaces
the `Badge` + `…` `DropdownMenu` + `Select` stack at
`src/components/TeamMembers.tsx:229-258`.

Options are built from the invite matrix for the *caller's* role, so a manager
and an owner see different lists — and the list is what the RPC will actually
accept, rather than a superset the server rejects.

On selection, before committing, the popover shows the permission delta: run
`buildRolePreview` on the current role and the candidate, diff the resulting
capability sets, and render GAINS / LOSES lines. When the two roles grant the
same areas, say so plainly rather than showing two empty lists.

Visual language extends the approved warm-paper/terracotta system already
implemented in `src/components/roles/*`, mapped onto semantic tokens
(`bg-background`, `text-foreground`, `border-border/40`) — never direct colors,
per CLAUDE.md.

Three states are handled explicitly per CLAUDE.md: skeleton while `useRoles`
loads, an error row inside the list, and — for a restaurant with no custom roles
yet — an empty-state line pointing at the Roles tab. Note that `useRoles` is
`enabled: !!restaurantId` (`src/hooks/useRoles.ts:78`), and a disabled React
Query reports `isLoading === false`; the loading branch must key off a resolved
`restaurantId` as well, not `isLoading` alone.

The list lives inside a `CommandList`, and loading/error/empty render as direct
children of it rather than through `CommandEmpty` — cmdk's `CommandEmpty` means
"no rows registered", never "something failed", so routing a load failure
through it would report the error as "no roles found".

### Client mutation

A new `useAssignRole(restaurantId)` hook wrapping the RPC, alongside
`useRoles`. It invalidates `['roles', restaurantId]` (member counts change) and
`['restaurants']` — the second is not belt-and-braces: `useRestaurants` embeds
the signed-in user's own `roleRecord`, so changing a role that the current user
can see must refresh their own resolved capabilities, exactly as `useRoles`
already documents (`src/hooks/useRoles.ts:15-19`).

Error handling follows the established shape: PostgREST rejections arrive as
plain `{code, message, details, hint}` objects, not `Error` instances, so
`instanceof Error` must be the last branch. The `42501` denials get mapped to
their human sentences ("Only an owner can change an owner's role") rather than
surfaced raw.

### Two bugs fixed in passing

- `src/components/TeamMembers.tsx:62` builds
  `[...getInvitableRoles('owner'), 'owner']`, but `'owner'` is already the first
  entry of the owner row (`src/lib/permissions/invitations.ts:14-15`). An owner
  therefore sees a duplicated menu entry rendered with a colliding React key.
- The kiosk explainer at `src/components/TeamMembers.tsx:259` is unreachable:
  line 234 already excludes kiosk rows from the dropdown entirely.

Both disappear with the component they live in, but they are named here so the
replacement is not written to preserve them.

## Testing

| Layer | Location | Covers |
|---|---|---|
| pgTAP | `supabase/tests/assign_membership_role_test.sql` | every rule above: self-target refused, matrix enforced per caller role, owner-demotion blocked for non-owners, last owner protected, cross-tenant `role_id` refused, `kiosk` refused both directions, `p_role_id` required/forbidden, and both columns written together |
| pgTAP | same file | `roles.legacy_role` agrees with `builtin_role_id_for` for all ten builtins |
| Unit | `tests/unit/inviteMatrixMirror.test.ts` | extended with a third parser so the SQL matrix is pinned to the TS and Deno copies |
| Unit | `tests/unit/useAssignRole.test.ts` | mutation shape, invalidation keys, `42501` message mapping, non-`Error` rejection objects |
| Unit | `tests/unit/RolePicker.test.tsx` | option list differs by caller role, delta lines, loading/error/empty inside `CommandList`, current-role checkmark |
| E2E | `tests/e2e/role-assignment.spec.ts` | an owner moves a member into a custom role and the chip reflects it after reload |

The pgTAP suite is where the privilege rules are actually proven. Every denial
path gets a `throws_ok` with the expected errcode, because a rule that silently
permits is the failure mode this whole change exists to eliminate.

## Out of scope

- Move 2 (role card member count → roster; Areas | People tabs in the editor).
- Move 3 (EmployeeDialog "App access" row; unhardcoding `role: 'staff'`).
- Bulk reassignment of a whole role's membership.
- Any change to how invitations work — the invite path is correct today and is
  the reference this change conforms to.
