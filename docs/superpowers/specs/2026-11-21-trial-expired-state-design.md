# Design: one derived "trial expired" state and one trial tier

Date: 2026-11-21
Branch: `claude/stoic-banach-50644a`

## Problem

On 2026-11-21, production has 31 restaurants with `subscription_status = 'trialing'`
and `trial_ends_at < now()`. All 31 have `stripe_subscription_id IS NULL`.
One more restaurant (`f0b5906d-3b45-498e-b4cd-424e7743b36f`) is `trialing` with
`trial_ends_at IS NULL`, so its trial never ends.

A planned churn-risk health score needs a correct subscription state.

## Cause (existing code)

- The trial is local to the database. `create_restaurant_with_owner` writes
  `'trialing'` and `NOW() + INTERVAL '14 days'`
  (`supabase/migrations/20260129000000_add_subscription_system.sql:404-411`).
- The checkout says the same: "our trial is local, not a Stripe subscription trial"
  (`supabase/functions/stripe-subscription-checkout/index.ts:128`).
- Only the Stripe webhook writes `subscription_status`
  (`supabase/functions/stripe-subscription-webhook/subscription-handler.ts:336`).
  A restaurant without a Stripe subscription gets no webhook event.
- No pg_cron job changes the status. The production `cron.job` list has no such job.
  Job 21 (`trial-expiry-emails`) only sends email.

So the stored value stays `'trialing'`. No job fails. No job exists, by design.

## Access is already correct

The gates calculate the expiry at read time:

- `has_subscription_feature` returns `FALSE` for an expired trial
  (`supabase/migrations/20260915120000_decommission_weekly_brief_ops_inbox.sql:140-147`).
  This is the latest of three definitions.
- `get_effective_subscription_tier` returns `NULL` for an expired trial
  (`supabase/migrations/20260129000000_add_subscription_system.sql:210-216`).
  This is its only definition.
- `useSubscription` returns `effectiveTier = null` for an expired trial
  (`src/hooks/useSubscription.ts:64-69`).

## Defects in the UI and in the tier

1. Tier mismatch. SQL gives a trial `'growth'`
   (`20260915120000_decommission_weekly_brief_ops_inbox.sql:143`).
   The frontend gives `'pro'` (`src/hooks/useSubscription.ts:64-69`).
   A Pro-only feature shows in the UI, and then the RPC refuses it.
2. Wrong banner. For an expired trial, `isTrialing` is true
   (`src/hooks/useSubscription.ts:86`). `trialDaysRemaining` stops at 0
   (`src/hooks/useSubscription.ts:103-107`). The banner shows
   "0 days left in your Pro trial" (`src/components/subscription/TrialBanner.tsx:18-30`).
3. The header badge shows "0 days left" for the same reason
   (`src/components/AppHeader.tsx:264-273`).
4. The Subscription card shows a skeleton forever for an expired trial.
   It shows the skeleton when `!effectiveTier`
   (`src/components/subscription/SubscriptionStatus.tsx:24-35`).
   Its status line prints the raw stored value (`SubscriptionStatus.tsx:150`).
5. The copy promises Pro during the trial:
   - `src/components/subscription/TrialBanner.tsx:30` ("Pro trial").
   - `src/components/subscription/WelcomeModal.tsx:33` ("Pro features FREE").
   - `src/components/subscription/WelcomeModal.tsx:51` (`isTrialPlan = tier === 'pro'`).
   - `src/content/help/getting-started/subscription-plans.md:21` and `:110`.
   - `src/content/help/getting-started/sign-in-create-account.md:4` and `:100`.

## Decisions (from the user)

- Do not add a stored status. Do not add a cron job. Derive "trial expired" at read time.
- A trial gives the **Growth** tier in SQL and in the frontend.
  The original design says the same: "14-day Growth trial"
  (`20260129000000_add_subscription_system.sql:11`).
- Give restaurant `f0b5906d…` the end date `now() + 14 days` (one-row backfill, user approves).
- The expired banner says "Your trial ended — choose a plan".

## Design

### SQL: one helper

New migration `supabase/migrations/20261121120000_effective_subscription_status.sql`:

```sql
CREATE OR REPLACE FUNCTION public.effective_subscription_status(
  p_status TEXT,
  p_trial_ends_at TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_status = 'trialing'
     AND p_trial_ends_at IS NOT NULL
     AND p_trial_ends_at < pg_catalog.now()
    THEN 'trial_expired'
    ELSE p_status
  END;
$$;

REVOKE ALL ON FUNCTION public.effective_subscription_status(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.effective_subscription_status(TEXT, TIMESTAMPTZ)
  TO authenticated, service_role;
```

- It takes column values, not a restaurant id. A set query (the health score) can
  call it per row with no extra table read.
- It reads no table. The caller still reads `restaurants` under RLS.
- `STABLE`, because it reads `now()`. `now()` is the transaction start time.
  The gates use `NOW()` too, so the two agree inside one transaction.
- The boundary matches the gates. The gates keep access while `NOW() <= trial_ends_at`.
  The helper says `trial_expired` only when `trial_ends_at < now()`.
  At `trial_ends_at = now()` the trial is still running.
- A `NULL` end date stays `trialing`. This matches the gates (`IS NULL OR …`).
- `anon` gets no access. The gates grant only `authenticated`
  (`20260129000000_add_subscription_system.sql:469-470`). The helper adds `service_role`
  for the health score.

The existing gates stay as they are. They already use the same rule.
A later change to a gate must change the helper too. The pgTAP parity test guards this.

`users_in_trial_email_window` keeps `status = 'trialing'`
(`supabase/migrations/20260507120200_users_in_trial_email_window_rpc.sql:62`).
It must still send the day-15 `expired` email. No change there.

No other SQL function, view, RPC, or edge function reads `'trialing'`.
`subscription-handler.ts:74` reads the status only together with a Stripe subscription.

### Frontend: one helper and one hook rule

`src/lib/subscriptionPlans.ts`:

- New type `EffectiveSubscriptionStatus = SubscriptionStatus | 'trial_expired'`.
- New pure function `getEffectiveSubscriptionStatus(status, trialEndsAt, now = new Date())`.
  It uses the same rule as the SQL helper: expired only when `trialEndsAt < now`.
  A null or invalid date string keeps `'trialing'`.

`src/hooks/useSubscription.ts`:

- Calculate `effectiveStatus` once. Calculate `effectiveTier` from `effectiveStatus`,
  so the two cannot drift apart.
- `effectiveStatus === 'trialing'` gives `'growth'`. `'trial_expired'` gives `null`.
- Add `effectiveStatus` and `isTrialExpired` to the return value.
- `isTrialing` is true only for a running trial (`effectiveStatus === 'trialing'`).
- `trialDaysRemaining` is `null` when the trial is not running.
- The value updates on a refetch. A page that stays open across the end time shows the
  old state until then. This is the current behavior. We accept it.

Consumers that the change in `isTrialing` fixes, with no other edit:
`AppHeader.tsx:264`, `TrialBanner.tsx:18`, `SubscriptionStatus.tsx:49` and `:84`.
Consumers that the change does not touch: `AppHeader.tsx:356`, `FeatureGate.tsx:65` and `:182`,
`SubscriptionPlans.tsx:98`, `Index.tsx:101`.

UI (semantic tokens only; do not copy `border-blue-200 bg-blue-50` from `TrialBanner.tsx:24`):

- `TrialBanner`: when `isTrialExpired`, show an `Alert variant="destructive"` with
  "Your trial ended — choose a plan" and a visible "Choose Plan" button.
  Do not use `getTrialBadgeStyles` or `isUrgent` for this state.
  Change "Pro trial" to "Growth trial" in the running state.
- `AppHeader`: when `isTrialExpired`, show a "Trial ended" button badge.
  It goes to `/settings?tab=subscription` and has an `aria-label`.
  This gives a signal outside Settings, because `TrialBanner` shows only on Settings.
- `SubscriptionStatus`: keep the skeleton only for `!subscription`.
  When `isTrialExpired`, return a "Trial ended" card with "Choose a plan below",
  before the `SUBSCRIPTION_PLANS[effectiveTier]` lookup (`SubscriptionStatus.tsx:37`).
  Print `effectiveStatus` in the status line, not the stored value.
- `WelcomeModal`: change the copy at `:33` to Growth. Change `:51` to `tier === 'growth'`.
- Help docs: change the four "Pro trial" lines to "Growth trial".
  Add one sentence on the expired banner next to the banner text at `subscription-plans.md:21`.

All copy changes go in one commit.

## Backfill (production, needs user approval)

One row only. No status rows change.

```sql
UPDATE public.restaurants
SET trial_ends_at = now() + interval '14 days'
WHERE id = 'f0b5906d-3b45-498e-b4cd-424e7743b36f'
  AND subscription_status = 'trialing'
  AND trial_ends_at IS NULL
RETURNING id, trial_ends_at;
-- expect: UPDATE 1
```

- A second run changes no row, because of `trial_ends_at IS NULL`.
- The restaurant gets 14 new days. The 31 expired rows stay expired.
- The guard trigger `_guard_restaurant_billing_columns` lets the write pass when
  `current_user` is not `authenticated` or `anon` and no JWT claims are set
  (`supabase/migrations/20260809100000_guard_restaurant_billing_columns.sql:48-77`).
  Check `current_user` once before the run.

## Tests

pgTAP `supabase/tests/effective_subscription_status.test.sql`:

- Expired trial, running trial, NULL end date, boundary `trial_ends_at = now()`.
- Each other status passes through unchanged.
- Grants: `authenticated` and `service_role` can execute. `anon` cannot.
- Parity on `trialing` fixtures from `create_restaurant_with_owner`
  (pattern in `supabase/tests/20260129000000_subscription_system.sql:73,94`):
  `trial_expired` if and only if `get_effective_subscription_tier` is `NULL`,
  `has_subscription_feature(id, 'basic_pnl')` is FALSE, and one Growth feature is FALSE.

Vitest `tests/unit/subscriptionPlans.test.ts`:

- `getEffectiveSubscriptionStatus`: expired, running, `trialEndsAt === now`, null, invalid string,
  other statuses.

Vitest `tests/unit/useSubscription.test.ts` (existing tests to change):

- `:156-176`: expect `'growth'`, not `'pro'`.
- `:541-557`: Growth features are true. Pro-only features (`banking`, `invoicing`) are false.
- `:317-335`: expect `trialDaysRemaining` `null`, `isTrialing` false, `isTrialExpired` true.
- `:179-199`: expect `effectiveStatus === 'trial_expired'`.

Vitest render tests (one each): `TrialBanner` expired state, `SubscriptionStatus` expired
state (no skeleton), `AppHeader` "Trial ended" badge if the header test setup allows it.

## Not in scope

- The health score. It uses `effective_subscription_status` later.
- A cron job or a stored `trial_expired` value.
- The trial email schedule.

## Design review (Phase 2.5)

- Supabase reviewer: no blocker. Fixed in this doc: grants (`anon`), `search_path = ''`,
  explicit `SECURITY INVOKER`, the `now()` note, parity fixtures, the guard condition,
  `RETURNING` on the backfill, and three citation ranges.
- Frontend reviewer: no blocker. Fixed in this doc: the list of tests to change,
  `effectiveTier` from `effectiveStatus`, the status line, the header badge for the expired
  state, semantic tokens, the WelcomeModal citations, and render tests.

## TLA+ check

No `run-tla` trigger matches. The change has no concurrency, no retry, and no state machine with writes.
