# Plan: derived "trial expired" state and Growth trial tier

Design: `docs/superpowers/specs/2026-11-21-trial-expired-state-design.md`
Branch: `claude/stoic-banach-50644a`

Use TDD for each task: write the failing test, run it, write the code, run it again.

## Task 1. SQL helper (pgTAP first)

1. Write `supabase/tests/effective_subscription_status.test.sql`.
   - Cases: expired, running, NULL end date, boundary `trial_ends_at = now()`,
     pass-through for `active`, `past_due`, `canceled`, `grandfathered`.
   - Grants: `authenticated` and `service_role` can execute. `anon` cannot.
   - Parity: create `trialing` restaurants with `create_restaurant_with_owner`.
     Set `trial_ends_at` to the past on one and to the future on another.
     Assert `trial_expired` if and only if `get_effective_subscription_tier` is NULL,
     `has_subscription_feature(id, 'basic_pnl')` is FALSE, and `scheduling` is FALSE.
2. Run `npm run test:db`. Expect a failure (no function).
3. Write `supabase/migrations/20261121120000_effective_subscription_status.sql` from the design.
4. Run `npm run db:reset` and `npm run test:db`. Expect a pass.

## Task 2. Frontend helper

1. Add tests in `tests/unit/subscriptionPlans.test.ts` for `getEffectiveSubscriptionStatus`:
   expired, running, `trialEndsAt === now`, null, invalid string, other statuses.
2. Add `EffectiveSubscriptionStatus` and `getEffectiveSubscriptionStatus` in
   `src/lib/subscriptionPlans.ts`.

## Task 3. Hook

1. Change the tests in `tests/unit/useSubscription.test.ts`:
   `:156-176` (`'growth'`), `:541-557` (Growth true, `banking` and `invoicing` false),
   `:317-335` (`trialDaysRemaining` null, `isTrialing` false, `isTrialExpired` true),
   `:179-199` (`effectiveStatus === 'trial_expired'`).
2. Change `src/hooks/useSubscription.ts`: calculate `effectiveStatus` once,
   calculate `effectiveTier` from it, add `effectiveStatus` and `isTrialExpired`.

## Task 4. UI

1. Write render tests: `tests/unit/TrialBanner.test.tsx` and
   `tests/unit/SubscriptionStatus.test.tsx` for the expired state. Mock `useSubscription`.
2. `TrialBanner.tsx`: expired `Alert variant="destructive"` with
   "Your trial ended — choose a plan" and "Choose Plan". Running copy says "Growth trial".
3. `SubscriptionStatus.tsx`: skeleton only for `!subscription`. Expired card before the
   plan lookup. Status line prints `effectiveStatus`.
4. `AppHeader.tsx`: "Trial ended" badge when `isTrialExpired`, with `aria-label`,
   to `/settings?tab=subscription`. Use semantic tokens.

## Task 5. Copy (one commit)

1. `WelcomeModal.tsx:33` copy to Growth. `:51` to `tier === 'growth'`.
2. Help docs: the four "Pro trial" lines to "Growth trial". Add the expired banner sentence.

## Task 6. Checks

1. `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:db`, `npm run build`.

## Task 7. Ship

1. Review, simplify, verify, QA, PR, CI (workflow `dev-build-and-ship.js`).
2. PR body: put the backfill SQL and "expect: UPDATE 1" in a section "Needs approval".

## Task 8. Backfill (only after explicit user approval)

1. Check `current_user` on production once.
2. Run the backfill SQL from the design. Expect `UPDATE 1`.
3. Do not run it without a clear "yes" from the user in chat.
