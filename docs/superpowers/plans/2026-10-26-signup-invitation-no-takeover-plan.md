# Plan: signup-with-invitation must not change an existing account

Design: `docs/superpowers/specs/2026-10-26-signup-invitation-no-takeover-design.md`

1. Write `tests/unit/signupWithInvitationHandler.test.ts` (RED). Write
   `supabase/functions/_shared/signupWithInvitationHandler.ts` (GREEN).
2. Change `supabase/functions/signup-with-invitation/index.ts` to call the handler.
   Delete `listUsers` and `updateUserById`.
3. Write `readFunctionErrorBody` tests in `tests/unit/invitationUtils.test.ts` (RED).
   Add the helper to `src/lib/invitationUtils.ts` (GREEN).
4. Add the `account_exists` page test to `tests/unit/AcceptInvitation.test.tsx` (RED).
   Change `handleSignUp` in `src/pages/AcceptInvitation.tsx` (GREEN).
5. Run typecheck, lint, and the unit tests. Review the diff. Open the PR.
