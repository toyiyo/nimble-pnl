# Design: Stop invited staff from self-serve owner signups

Date: 2026-09-08 (revised after the Phase 2.5 design review)
Branch: `claude/staff-invite-owner-account-bug-sf0ktj`

## Problem

Restaurant owners invite staff by email. Some invitees create a new
self-serve owner account instead. PostHog shows the pattern in 3 of 8
invited signups in the last 30 days (Sep 8, Sep 3, Aug 21). Each case
follows the same shape: the invitee opens the invite link, leaves the
page, signs up through `/auth`, lands on the empty dashboard, and
creates a restaurant as an owner.

Case study (synthetic identity; one real invited-staff session from
2026-09-08, timeline generalized to minute offsets):

1. t+0:00 — The invitee opens `/accept-invitation?token=…`. They leave after about 50 seconds.
2. t+0:54 — They sign up on `/auth` (self-serve form).
3. t+2:07 — They confirm the email. They now have an account with zero restaurants.
4. t+3:02 — They re-open the invite link while signed in. The page shows a signup form. The accept does not run (bug 2).
5. t+6:15 — A second fresh account resolves from `/auth` as `self_serve` / `owner`. `trial_started` fires.

## Root causes in the current code

1. **The app never shows a signed-in invitee their pending invitation.**
   The token exists only in the email link
   (`supabase/functions/send-team-invitation/index.ts:314`). `/auth`
   does not check pending invitations (`src/pages/Auth.tsx:31-51`). RLS
   does let the invitee read their own pending, unexpired rows — policy
   "Users can view invitations sent to their email"
   (`supabase/migrations/20251220025830_90b9fc81-c25d-47b1-9802-45071a86922d.sql:22-28`)
   — but no client code queries it, and the invitee cannot read
   `restaurants.name` because the restaurants SELECT policy is
   membership-gated
   (`supabase/migrations/20250915210020_774bc2c1-abb6-4f03-b10f-5cfc85e9b772.sql:27-35`).
   The empty dashboard shows one action — create a restaurant
   (`src/pages/Index.tsx:619-642`), and `canUserCreateRestaurant`
   permits every zero-restaurant user
   (`src/lib/restaurantPermissions.ts:14-18`).

2. **A stale-closure race strands signed-in invitees.**
   `validateInvitation` runs from a `useEffect` keyed on `[token]` only
   (`src/pages/AcceptInvitation.tsx:42-46`). It reads `user` from the
   mount-time closure (`src/pages/AcceptInvitation.tsx:99`), which is
   `null` while `authLoading` is true. It then sets `needs_auth`. The
   accept effect requires `status === 'valid'`
   (`src/pages/AcceptInvitation.tsx:57-61`), so the accept never runs.
   A signed-in invitee sees a "Create Your Account" form.

3. **The intended path forces a second manual sign-in.**
   `signup-with-invitation` creates the account and answers "Please sign
   in with your new account."
   (`supabase/functions/signup-with-invitation/index.ts:126`). The client
   then shows the sign-in form again
   (`src/pages/AcceptInvitation.tsx:223-229`). The invitee must retype
   the password on a phone. This step loses people.

4. **Analytics hide the failure and merge users.**
   `team_member_joined` fires from a localStorage classification, not
   from a real accept (`src/lib/analytics.ts:240-244`). It fired for the
   case-study user, who never joined. `signOut` never calls
   `posthog.reset()` (`src/hooks/useAuth.tsx:196-230`), so two auth users
   in one browser merge into one PostHog person. The restaurant group is
   already cleared on sign-out
   (`src/contexts/RestaurantContext.tsx:98-101`); the person identity is
   not.

## Fixes

### Fix 1: Pending-invitation notice on the empty dashboard

New migration with two functions. The RPC shape is chosen over a direct
table query for three reasons: it joins `restaurants.name` (which RLS
denies to the invitee, see root cause 1), it never exposes the `token`
column (the column stores a SHA-256 hash,
`supabase/functions/send-team-invitation/index.ts:254`), and it keeps
the accept authorization server-side.

- `get_my_pending_invitations()` — `SECURITY DEFINER`, `STABLE`,
  `SET search_path = public, pg_temp`. Returns
  `(invitation_id, restaurant_name, role, expires_at)` for rows where
  `lower(email) = lower(auth.email())`, `status = 'pending'`, and
  `expires_at > now()`. Returns an empty set when `auth.email()` is
  NULL. `REVOKE` from `PUBLIC` and `anon`; `GRANT EXECUTE` to
  `authenticated`.

- `accept_my_invitation(p_invitation_id uuid)` — `SECURITY DEFINER`,
  `VOLATILE`, `SET search_path = public, pg_temp`. Token-free accept for
  a signed-in invitee. Authorization: `lower(auth.email())` must equal
  `lower(invitations.email)`. Both sides are lowercased because
  historical rows carried mixed case — the same bug the RLS fix
  `supabase/migrations/20251220025830_90b9fc81-c25d-47b1-9802-45071a86922d.sql:9,25`
  corrected. The emailed token protects the link in transit; the email
  match is the real authorization, as in the edge function
  (`supabase/functions/accept-invitation/index.ts:104-106`). Steps, in
  the order of the edge function:
  1. Return `reason = 'no_email'` when `auth.email()` is NULL.
  2. Lock per (user, invitation) with `pg_advisory_xact_lock`.
  3. Check the row: `status = 'pending'`, `expires_at > now()`, email
     match as above. Return `reason = 'not_found'` otherwise (one
     undifferentiated reason, so the RPC is not a probe oracle).
  4. Insert into `user_restaurants (user_id, restaurant_id, role, role_id)`
     guarded by `NOT EXISTS` plus a `unique_violation` handler. The
     handler makes a concurrent accept through the token path
     (`supabase/functions/accept-invitation/index.ts:117-137`, no shared
     lock key) idempotent instead of an error — `user_restaurants` has
     `UNIQUE(user_id, restaurant_id)`
     (`supabase/migrations/20250915210020_774bc2c1-abb6-4f03-b10f-5cfc85e9b772.sql:19`).
     A handler is used instead of `ON CONFLICT` because the conflict
     column list would collide with the `restaurant_id` output parameter
     under plpgsql variable substitution.
  5. Call `link_invited_employee` inside
     `BEGIN ... EXCEPTION WHEN OTHERS` — the link is non-fatal, and in
     plpgsql an uncaught error would roll back the membership insert.
     The call passes the privilege check because `postgres` owns both
     functions and an owner keeps implicit EXECUTE; the
     service-role-only grant boundary
     (`supabase/migrations/20260723170000_link_invited_employee.sql:165-166`)
     stays intact for direct callers. The precondition documented in
     that file's header — "the invitation decided the link target" —
     holds here too. Register the second caller: update the header
     comment of `20260723170000_link_invited_employee.sql` and re-issue
     `COMMENT ON FUNCTION` in the new migration.
  6. Delete old `accepted` rows for the (restaurant, email) pair, then
     set `status = 'accepted'`, `accepted_at`, `accepted_by`
     (mirror of `supabase/functions/accept-invitation/index.ts:166-183`;
     the delete avoids the `UNIQUE(restaurant_id, email, status)`
     violation,
     `supabase/migrations/20250915233731_c8aadd3f-3240-4058-a373-1ef2728919eb.sql:15`).
  Returns `(accepted boolean, restaurant_id uuid, restaurant_name text, reason text)`.
  `REVOKE` from `PUBLIC` and `anon`; `GRANT EXECUTE` to `authenticated`.

- Partial expression index
  `CREATE INDEX ... ON invitations (lower(email)) WHERE status = 'pending'`
  for the new lookup — the existing unique index leads with
  `restaurant_id` and does not help.

Writer registry: `accept_my_invitation` is a new INSERT writer for
`user_restaurants`. The restrictive INSERT guard
(`supabase/migrations/20260808100000_restrict_user_restaurants_insert.sql`)
does not block it: the function is `SECURITY DEFINER`, owned by
`postgres`, and the table does not set `FORCE ROW LEVEL SECURITY`.
Record the new writer in both migration headers.

Client:

- New hook `src/hooks/usePendingInvitations.ts` — React Query,
  `queryKey: ['pending-invitations', user?.id]`, `staleTime: 30000`,
  enabled when a user exists. Exposes the list and an `accept` mutation
  that calls `accept_my_invitation`. On success with `accepted = true`:
  call `recordTeamMemberJoined`, invalidate
  `['pending-invitations', userId]` and `['restaurants', userId]`
  (`src/hooks/useRestaurants.tsx:163`). On `accepted = false`: show a
  destructive toast with a generic message and invalidate
  `['pending-invitations', userId]` so the stale row disappears.
- New component `src/components/PendingInvitationsCard.tsx` — lists each
  pending invitation with restaurant name, role, expiry, and an Accept
  button. The button carries
  `aria-label={"Accept invitation to " + restaurantName}`, shows
  "Accepting..." and disables while the mutation is pending. Handles the
  three render states; renders nothing when the list is empty.
- `src/pages/Index.tsx` — show the card above `RestaurantSelector` in
  the `!selectedRestaurant` branch (`src/pages/Index.tsx:619-642`), only
  when `restaurants.length === 0`. Keep the heading copy neutral until
  the pending-invitations query settles. After a zero-restaurant invitee
  accepts, the refetched single restaurant auto-selects
  (`src/contexts/RestaurantContext.tsx:66-71`), so the invitee lands in
  the restaurant with no extra click.

### Fix 2: Delete the stale-closure race in `AcceptInvitation.tsx`

- Gate validation on settled auth: change the effect to
  `useEffect(() => { if (token && !authLoading) validateInvitation(); }, [token, authLoading])`.
  With `authLoading` false, the closure `user` is current. A signed-in
  invitee with a matched email goes straight to `valid`, and the accept
  effect (`src/pages/AcceptInvitation.tsx:57-61`) runs.
- Compare emails case-insensitively on the client
  (`user.email.toLowerCase() === invitation.email.toLowerCase()`) in
  both the effect and `validateInvitation`.
- Guard the auto-accept with a one-shot ref so a `user` object identity
  change cannot fire `acceptInvitation` twice. The manual Accept button
  stays as the retry path.
- New status `email_mismatch` replaces the toast + `invalid` dead end
  (`src/pages/AcceptInvitation.tsx:102-108`): a card states "This
  invitation was sent to {invitation.email}, but you're signed in as
  {user.email}" and offers a "Sign out and switch account" button. The
  button calls `supabase.auth.signOut({ scope: 'local' })` and reloads
  the current URL, so the token survives and the page returns as
  `needs_auth`.
- Render the loading card while `status === 'valid'` and `user` is still
  null, instead of `return null`
  (`src/pages/AcceptInvitation.tsx:325,569`).
- The loading screen already covers the validation wait
  (`src/pages/AcceptInvitation.tsx:245-259`).

### Fix 3: Auto sign-in after `signup-with-invitation`

- Client-only change in `handleSignUp`
  (`src/pages/AcceptInvitation.tsx:198-243`): on `data.success`, call
  `supabase.auth.signInWithPassword({ email, password })` with the
  password already in state. On success set `status = 'valid'` (the
  accept effect completes the join). On error, fall back to the current
  "Please sign in" path.
- No edge-function change. The function already confirms the email
  (`supabase/functions/signup-with-invitation/index.ts:99`).

### Fix 4: Analytics corrections

- `src/lib/analytics.ts` — stop the `team_member_joined` capture inside
  `recordAuthEvents` (`src/lib/analytics.ts:240-244`). Keep
  `account_created` with the classification, and keep `trial_started`
  for `self_serve` only.
- New export `recordTeamMemberJoined(posthog, properties?)` in
  `src/lib/analytics.ts` — captures `team_member_joined`, swallows
  capture errors. Call it from the two real join points:
  `acceptInvitation` success in `src/pages/AcceptInvitation.tsx:135` and
  the `accept` mutation success in `usePendingInvitations`.
- `src/hooks/useAuth.tsx` — call `posthog.reset()` inside `signOut` on
  both exit paths: before the redirect at `src/hooks/useAuth.tsx:222`
  and in the catch block (`src/hooks/useAuth.tsx:223-228`).

## Decided trade-offs

- The classification heuristic in `readStoredSignupClassification`
  stays. A visitor who opens an invite link and then signs up self-serve
  still counts as `invitation_accept` on `account_created`. The true
  join signal moves to `team_member_joined`, so the funnel stays honest.
- The card is gated on `restaurants.length === 0`. An existing member
  invited to a second restaurant still needs the email link. This keeps
  the change small; a follow-up can widen it.
- The `signup_claimed_at` race guard from the 2026-08-08 lesson is out
  of scope here; this change does not touch the edge function.
- The token path (`accept-invitation` edge function) keeps its
  lock-free insert; the `ON CONFLICT` clause in the new RPC absorbs the
  cross-path race.

## Test plan

- Unit (`tests/unit/`): `recordAuthEvents` no longer captures
  `team_member_joined`; `recordTeamMemberJoined` captures once and
  swallows errors; `signOut` calls `posthog.reset()` on both exit
  paths; `usePendingInvitations` maps rows, handles `accepted = false`,
  and invalidates both query keys; `PendingInvitationsCard` render
  states, pending state, and accessible names; `AcceptInvitation`
  validation waits for auth, mismatch screen, auto sign-in, one-shot
  accept.
- pgTAP (`supabase/tests/`): `get_my_pending_invitations` returns only
  the caller's pending, unexpired rows, matches email
  case-insensitively, and never returns the token;
  `accept_my_invitation` inserts the membership, links the employee,
  marks the row accepted, rejects another user's invitation, rejects an
  expired row, returns `no_email` without an email claim, and succeeds
  without a duplicate row for an existing member (`ON CONFLICT`).
- E2E (`tests/e2e/`): owner seeds an invitation row (the owner-side RLS
  policy admits the INSERT); a second user signs up self-serve with the
  invited email; the dashboard shows the pending invitation; Accept
  joins and auto-selects the restaurant.
