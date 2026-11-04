# Invitation role guard — plan

Design: `docs/superpowers/specs/2026-10-26-invitation-role-guard-design.md`

## Tasks

1. Write the pgTAP test `supabase/tests/invitation_role_guard_test.sql`.
   It must fail on the current schema.
2. Write the migration `supabase/migrations/20261026120200_invitation_role_guard.sql`:
   helper functions, trigger, policies, column grants, and the new
   `accept_my_invitation` and `get_my_pending_invitations` bodies.
3. Change `supabase/tests/invitee_pending_invitations.test.sql`: give the
   fixture inviter an owner membership.
4. Write the Vitest test `tests/unit/invitePermissions.test.ts` and the
   mirror assertion in `tests/unit/inviteMatrixMirror.test.ts`.
5. Write `supabase/functions/_shared/invitePermissions.ts`.
6. Change `supabase/functions/accept-invitation/index.ts`: check the
   inviter's role before the membership insert.
7. Write the E2E spec `tests/e2e/invitation-role-guard.spec.ts`.
8. Run lint, typecheck, unit tests, and the SQL tests on a local Postgres.

## Dependencies

- Task 2 depends on task 1.
- Task 3 depends on task 2.
- Task 6 depends on task 5. Task 5 depends on task 4.
