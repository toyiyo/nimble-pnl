# Invitation role guard — design

Date: 2026-10-26
Fix: 2 of 7 from the 2026-10-26 security audit (severity: high)

## Problem

A manager can write an invitation for the `owner` role through PostgREST.
An invitee can change the role of their own pending invitation. When the
invitation is accepted, the new member gets the forged role.

### Current behavior (cited)

1. The policy "Restaurant owners and managers can manage invitations" is
   `FOR ALL` with a `USING` clause and no `WITH CHECK`
   (`supabase/migrations/20260702170000_add_operations_manager_role.sql:919-927`).
   Postgres uses `USING` for new rows too. That clause checks only the
   caller's membership in `restaurant_id`. It does not check `role` or
   `invited_by`.
2. The trigger `invitations_validate_role_id` returns at once when
   `role_id IS NULL`
   (`supabase/migrations/20260730210000_invitation_role_id_must_agree_with_role.sql:87-89`).
   No other check looks at `role`.
3. The policy "Users can accept their own invitations" has a `WITH CHECK`
   that checks only `email`, `status` and `accepted_by`
   (`supabase/migrations/20251220025830_90b9fc81-c25d-47b1-9802-45071a86922d.sql:6-17`).
   The invitee can change `role`, `role_id`, `token` and `restaurant_id` in
   the same UPDATE.
4. `accept-invitation` copies `invitation.role` into `user_restaurants`
   with the service role (`supabase/functions/accept-invitation/index.ts:120-137`).
   It checks only the token hash and the email
   (`supabase/functions/accept-invitation/index.ts:66-106`).
5. `accept_my_invitation` (the token-free accept RPC) copies `v_inv.role`
   into `user_restaurants` the same way
   (`supabase/migrations/20260908230000_invitee_pending_invitations.sql:92-131`).
   It is a second accept path with the same gap.
6. The invite matrix exists in three copies that a unit test keeps equal:
   TS `INVITABLE_ROLES` (`src/lib/permissions/invitations.ts:10-34`), Deno
   (`supabase/functions/send-team-invitation/index.ts:21-36`), and SQL
   `public.invitable_roles` plus `public.can_invite_custom_role`
   (`supabase/migrations/20260802110000_assign_membership_role.sql:32-60`).
   The test is `tests/unit/inviteMatrixMirror.test.ts`.
7. The app does not INSERT or UPDATE `invitations` from the browser. It
   only does SELECT and DELETE (`src/components/TeamInvitations.tsx:87-91`,
   `src/components/TeamInvitations.tsx:129-133`,
   `src/hooks/useCollaborators.ts:93-98`, `src/hooks/useCollaborators.ts:216-220`).
   `send-team-invitation` writes with the service role
   (`supabase/functions/send-team-invitation/index.ts:216-221`,
   `supabase/functions/send-team-invitation/index.ts:296-300`).
   The E2E spec `tests/e2e/pending-invitation-dashboard.spec.ts:40-48`
   inserts a staff invitation from the owner's browser session.

## Role rules

The rules are the matrix in `INVITABLE_ROLES` and `public.invitable_roles`:

| Inviter | May invite |
|---|---|
| owner | owner, manager, operations_manager, chef, staff, 4 builtin collaborator roles, `collaborator_custom` |
| manager | manager, operations_manager, chef, staff, 4 builtin collaborator roles, `collaborator_custom` |
| operations_manager | staff |
| all other roles | nothing |

Nobody may invite `kiosk`.

The task text says "Manager cannot invite owner or manager". The matrix
lets a manager invite a manager, and the Team page uses that today. This
fix follows the matrix, so a manager cannot invite an owner but can invite
a manager. A change to the matrix is a product decision and needs all
three copies to change together.

## Design

One new migration, `20261026120200_invitation_role_guard.sql`.

### 1. Helper functions

- `public.inviter_may_invite(p_inviter uuid, p_restaurant_id uuid, p_role text) RETURNS boolean`.
  `SECURITY DEFINER`, `STABLE`. It reads the inviter's role in
  `user_restaurants` for that restaurant. It returns true when
  `p_role = 'collaborator_custom'` and `can_invite_custom_role(role)`, or
  when `p_role = ANY (invitable_roles(role))`. A missing membership returns
  false. EXECUTE goes to `service_role` only, because the function can
  tell about the role of any user.
- `public.caller_may_invite(p_restaurant_id uuid, p_role text) RETURNS boolean`.
  `SECURITY DEFINER`, `STABLE`. It calls `inviter_may_invite(auth.uid(), …)`.
  EXECUTE goes to `authenticated`. It tells the caller only about their own
  rights.

Both reuse `invitable_roles` and `can_invite_custom_role`, so the matrix
keeps three copies, not four.

### 2. Trigger `invitations_enforce_invitable_role`

`BEFORE INSERT OR UPDATE OF role, restaurant_id, invited_by ON public.invitations`.
The function is `SECURITY INVOKER`, so `current_user` is the real caller.

- If `current_user` is not `anon` or `authenticated`, return NEW. This is
  the service role (`send-team-invitation`, `accept-invitation`), the
  `postgres` owner of `SECURITY DEFINER` functions, and migrations.
- Else, if `auth.uid()` is NULL, raise `42501`.
- Else, if `NEW.invited_by` is not `auth.uid()`, raise `42501`. A forged
  `invited_by` would make the accept-time check use the wrong inviter.
- Else, if `caller_may_invite(NEW.restaurant_id, NEW.role)` is false, raise
  `42501`.
- On INSERT, replace `NEW.token` with a random SHA-256 hex value. The token
  is the accept secret, and `signup-with-invitation` trusts whoever knows
  it. A browser must not choose it. Only `send-team-invitation` issues a
  usable token. The E2E specs that seed rows from the browser do not use
  the token.

### 3. Policies

Drop "Restaurant owners and managers can manage invitations". Create:

- INSERT `TO authenticated`, `WITH CHECK`: `invited_by = auth.uid()` and
  the caller is owner, manager or operations_manager of `restaurant_id`.
- UPDATE `TO authenticated`, `USING` and `WITH CHECK`: the caller is owner,
  manager or operations_manager of `restaurant_id`.
- DELETE `TO authenticated`, `USING`: the same membership check.

SELECT keeps the policy "Restaurant owners and managers can view
invitations (no tokens)"
(`supabase/migrations/20260702170000_add_operations_manager_role.sql:904-914`).
It has the same condition, so a new SELECT policy adds nothing. Postgres
does not allow `WITH CHECK` on SELECT or DELETE, or `USING` on INSERT.

### 4. Grants

`REVOKE INSERT, UPDATE ON public.invitations FROM anon`.
`REVOKE UPDATE ON public.invitations FROM authenticated`.

After this, no browser session can UPDATE an invitation. This fixes the
invitee path (item 3). The app sends no UPDATE (item 7). The invitee
accepts through `accept_my_invitation` (postgres) or `accept-invitation`
(service role), which the REVOKE does not affect.

A column grant on `status` is not safe. A manager could set a cancelled or
accepted owner invitation back to `pending`, and the trigger does not fire
for `status`. The security review in Phase 7 found this path.

### 5. Accept paths check the inviter

- `accept-invitation`: before the membership insert, read the role of
  `invitation.invited_by` in `user_restaurants` for
  `invitation.restaurant_id`. Reject when the inviter has no membership or
  `inviterMayInvite(inviterRole, invitation.role)` is false. The helper is
  `supabase/functions/_shared/invitePermissions.ts`. It holds a fourth copy
  of the matrix, and `tests/unit/inviteMatrixMirror.test.ts` pins it to the
  TS copy.
- `accept_my_invitation`: `CREATE OR REPLACE` with the same body plus one
  check after the row lock. A failed check returns `not_found`, the same
  undifferentiated reason as today.
- `get_my_pending_invitations`: hide rows that fail the same check, so the
  dashboard does not show an invitation that cannot be accepted.

These checks also catch rows that a manager forged before this fix, and
rows whose inviter lost the right after the invitation was sent.

### Out of scope

- `signup-with-invitation` (fix 1 changes it).
- `send-team-invitation`. It checks the matrix already
  (`supabase/functions/send-team-invitation/index.ts:161-166`).
- A change to the matrix itself.

## Tests

- pgTAP `supabase/tests/invitation_role_guard_test.sql`: manager cannot
  insert an owner invitation; manager can insert staff and manager
  invitations; operations_manager can insert only staff; owner can invite a
  manager and an owner; nobody can invite kiosk; staff cannot insert;
  forged `invited_by` fails; manager cannot UPDATE `role`; invitee cannot
  UPDATE `role` or `token`; column grants are correct; the service-role
  path inserts any role; `accept_my_invitation` refuses a forged row and
  accepts a valid row; `get_my_pending_invitations` hides the forged row.
- `supabase/tests/invitee_pending_invitations.test.sql`: give the
  fixture inviter an owner membership, because the accept RPC now checks
  the inviter.
- Vitest `tests/unit/invitePermissions.test.ts` for `inviterMayInvite`,
  plus a mirror assertion in `tests/unit/inviteMatrixMirror.test.ts`.
- E2E `tests/e2e/invitation-role-guard.spec.ts`: the owner inserts a staff
  invitation from the browser (allowed), then cannot change its role to
  `owner` and cannot insert a row with another `invited_by`.

## Decided trade-offs

- The trigger trusts every non-client role (`service_role`, `postgres`).
  The task asks for this, so `send-team-invitation` keeps working. Those
  writers check the matrix themselves.
- `accept_my_invitation` returns `not_found` for a failed inviter check.
  A new reason would need UI work and would give a probe signal.
- A pending invitation from an inviter who left the restaurant now fails
  at accept. The owner must send a new invitation. This is the safe
  result.

## TLA+ check

No trigger from `.claude/skills/run-tla/SKILL.md` matches. The change adds
no cursor, cron, retry, watermark or multi-step state machine. The accept
RPC keeps its advisory lock and row lock unchanged.
