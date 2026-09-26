# Plan: Stop invited staff from self-serve owner signups

Design: `docs/superpowers/specs/2026-09-08-invite-owner-account-leak-design.md`

Each task is small. Run the named tests after each task. Commit each
green task with explicit paths.

## Task 1 — Analytics: move `team_member_joined` to the real join

- Files: `src/lib/analytics.ts`, `tests/unit/analytics.test.ts`
- RED: change the tests at `tests/unit/analytics.test.ts:494-546` —
  `recordAuthEvents` must NOT capture `team_member_joined`; add tests
  for a new `recordTeamMemberJoined(posthog)` export (captures once,
  swallows capture errors).
- GREEN: delete the capture at `src/lib/analytics.ts:243`; add
  `recordTeamMemberJoined`.
- Test: `npx vitest run tests/unit/analytics.test.ts`

## Task 2 — Analytics: `posthog.reset()` on sign-out

- Files: `src/hooks/useAuth.tsx`, `tests/unit/useAuth.test.tsx`
- RED: add a test — `signOut` calls `posthog.reset()` before the
  redirect.
- GREEN: call `posthog.reset()` in `signOut`
  (`src/hooks/useAuth.tsx:196-230`), inside the try block, before
  `window.location.href = '/auth'`.
- Test: `npx vitest run tests/unit/useAuth.test.tsx`

## Task 3 — Migration: `get_my_pending_invitations` + `accept_my_invitation`

- Files: `supabase/migrations/20260908<hhmmss>_invitee_pending_invitations.sql`
- Content per the design doc: two `SECURITY DEFINER` functions,
  `SET search_path = public, pg_temp`, `REVOKE` from `PUBLIC`/`anon`,
  `GRANT EXECUTE` to `authenticated`. Header lists the new
  `user_restaurants` INSERT writer.
- Review deltas: `STABLE` getter; lowercase both email sides;
  `ON CONFLICT (user_id, restaurant_id) DO NOTHING`; wrap the
  `link_invited_employee` call in `EXCEPTION WHEN OTHERS`; `no_email`
  reason; partial index on `(lower(email)) WHERE status = 'pending'`;
  re-issue `COMMENT ON FUNCTION link_invited_employee` with the second
  caller and update the header of
  `supabase/migrations/20260723170000_link_invited_employee.sql`.
- No runnable DB here; pgTAP in Task 4 runs in CI (`npm run test:db`).

## Task 4 — pgTAP tests for the two functions

- Files: `supabase/tests/invitee_pending_invitations.test.sql`
- Cases: visibility scoped to `auth.email()` with case-insensitive
  match; no token column in the return type; accept inserts membership +
  links employee + marks accepted; rejects wrong email, expired,
  cancelled; returns `no_email` without an email claim; second accept
  for an existing member returns success without a duplicate row.

## Task 5 — Hook: `usePendingInvitations`

- Files: `src/hooks/usePendingInvitations.ts`,
  `tests/unit/usePendingInvitations.test.tsx`
- RED: tests with a mocked supabase client — maps RPC rows, `enabled`
  only with a user, accept mutation calls `accept_my_invitation` and
  invalidates `['pending-invitations', userId]` and
  `['restaurants', userId]`, fires `recordTeamMemberJoined` on success,
  shows a destructive toast and invalidates the pending list on
  `accepted = false`.
- GREEN: implement with React Query, `staleTime: 30000`.
- Test: `npx vitest run tests/unit/usePendingInvitations.test.tsx`

## Task 6 — UI: `PendingInvitationsCard` + Index.tsx placement

- Files: `src/components/PendingInvitationsCard.tsx`,
  `src/pages/Index.tsx`, `tests/unit/PendingInvitationsCard.test.tsx`
- RED: component tests — loading state, empty renders nothing, list
  renders restaurant name + role + Accept button with
  `aria-label="Accept invitation to {name}"`, the button disables and
  shows "Accepting..." while pending, accept click calls the mutation.
- GREEN: card per the CLAUDE.md style rules; show it above
  `RestaurantSelector` in the `!selectedRestaurant` branch
  (`src/pages/Index.tsx:619-642`), gated on `restaurants.length === 0`;
  keep the heading copy neutral until the query settles.
- Test: `npx vitest run tests/unit/PendingInvitationsCard.test.tsx`

## Task 7 — AcceptInvitation: race fix + auto sign-in + real join event

- Files: `src/pages/AcceptInvitation.tsx`,
  `tests/unit/AcceptInvitation.test.tsx` (new)
- RED: tests — validation waits for `authLoading === false`; a
  signed-in user with a matched email (case-insensitive) reaches the
  accept call once (one-shot ref); a mismatched email shows the
  `email_mismatch` card with a sign-out button; signup success signs in
  with the typed password and does not show the manual sign-in form;
  accept success calls `recordTeamMemberJoined`.
- GREEN: per the design doc.
- Test: `npx vitest run tests/unit/AcceptInvitation.test.tsx`

## Task 8 — E2E: dashboard invitation accept

- Files: `tests/e2e/pending-invitation-dashboard.spec.ts`
- Flow: owner signs up and creates a restaurant; owner inserts an
  invitation row (RLS INSERT policy admits owners); a second user signs
  up self-serve with the invited email; the dashboard shows the pending
  invitation; Accept joins the restaurant; the restaurant dashboard
  loads.
- Cannot run in this session (no local Supabase). CI runs it.

## Task 9 — Verify + ship

- `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Push to `claude/staff-invite-owner-account-bug-sf0ktj`. No PR (host
  rule).
