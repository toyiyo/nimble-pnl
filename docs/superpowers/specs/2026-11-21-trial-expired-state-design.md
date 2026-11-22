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

So the stored value stays `'trialing'`. This is not a defect of a job that fails.
No job exists, by design.

## Access is already correct

The gates calculate the expiry at read time:

- `has_subscription_feature` returns `FALSE` for an expired trial
  (`supabase/migrations/20260915120000_decommission_weekly_brief_ops_inbox.sql:140-147`).
- `get_effective_subscription_tier` returns `NULL` for an expired trial
  (`supabase/migrations/20260129000000_add_subscription_system.sql:210-216`).
- `useSubscription` returns `effectiveTier = null` for an expired trial
  (`src/hooks/useSubscription.ts:65-69`).

## Defects in the UI and in the tier

1. Tier mismatch. SQL gives a trial `'growth'`
   (`20260915120000_decommission_weekly_brief_ops_inbox.sql:143`).
   The frontend gives `'pro'` (`src/hooks/useSubscription.ts:64-67`).
   A Pro-only feature shows in the UI, and then the RPC refuses it.
2. Wrong banner. For an expired trial, `isTrialing` is true
   (`src/hooks/useSubscription.ts:86`). `trialDaysRemaining` stops at 0
   (`src/hooks/useSubscription.ts:103-107`). The banner shows
   "0 days left in your Pro trial" (`src/components/subscription/TrialBanner.tsx:18-30`).
3. The header badge shows "0 days left" for the same reason
   (`src/components/AppHeader.tsx:264-273`).
4. The Subscription card shows a skeleton forever for an expired trial.
   It renders the skeleton when `!effectiveTier`
   (`src/components/subscription/SubscriptionStatus.tsx:24-35`).
5. The text says "Pro trial" in four places:
   `src/components/subscription/TrialBanner.tsx:30`,
   `src/components/subscription/WelcomeModal.tsx:33` and `:51`,
   `src/content/help/getting-started/subscription-plans.md:21` and `:110`,
   `src/content/help/getting-started/sign-in-create-account.md:4` and `:100`.

## Decisions (from the user)

- Do not add a stored status. Do not add a cron job. Derive "trial expired" at read time.
- A trial gives the **Growth** tier in SQL and in the frontend.
  The original design says the same: "14-day Growth trial"
  (`20260129000000_add_subscription_system.sql:11`).
- Give restaurant `f0b5906d…` the end date `now() + 14 days` (one-row backfill, user approves).

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
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_status = 'trialing'
     AND p_trial_ends_at IS NOT NULL
     AND p_trial_ends_at < now()
    THEN 'trial_expired'
    ELSE p_status
  END;
$$;
```

- It takes column values, not a restaurant id. A set query (the health score) can
  call it per row with no extra table read.
- It reads no table, so `SECURITY INVOKER` is correct. No RLS question.
- `STABLE`, because it reads `now()`.
- Grant `EXECUTE` to `authenticated` and `service_role`. Revoke from `PUBLIC` and `anon`.
- The boundary matches the gates: the gates keep access while `NOW() <= trial_ends_at`.
  The helper says `trial_expired` only when `trial_ends_at < now()`.
- A `NULL` end date stays `trialing`. This matches the gates (`IS NULL OR …`).

The existing gates stay as they are. They already use the same rule.
A pgTAP test asserts parity: for each fixture row, `effective_subscription_status = 'trial_expired'`
if and only if the row is `trialing` and `get_effective_subscription_tier` returns `NULL`.

`users_in_trial_email_window` keeps `status = 'trialing'`. It counts days from
`created_at` and must still send the day-15 `expired` email
(`supabase/migrations/20260507120200_users_in_trial_email_window_rpc.sql:36-41`).
No change there.

### Frontend: one helper and one hook flag

`src/lib/subscriptionPlans.ts`:

- New type `EffectiveSubscriptionStatus = SubscriptionStatus | 'trial_expired'`.
- New pure function `getEffectiveSubscriptionStatus(status, trialEndsAt, now = new Date())`.
  It uses the same rule as the SQL helper.

`src/hooks/useSubscription.ts`:

- Add `effectiveStatus` and `isTrialExpired`.
- `isTrialing` becomes true only for a trial that has not ended
  (`effectiveStatus === 'trialing'`).
- `trialDaysRemaining` is `null` when the trial ended (it follows `isTrialing`).
- A running trial gives `'growth'`, not `'pro'`.

UI:

- `TrialBanner`: when `isTrialExpired`, show "Your trial ended. Choose a plan to keep
  your Growth features." with a "Choose Plan" button. Change "Pro trial" to "Growth trial".
- `AppHeader`: no change in code. The badge hides, because `isTrialing` is false.
- `SubscriptionStatus`: when `isTrialExpired`, show a card "Trial ended" with a
  "Choose a plan below" message, not a skeleton.
- `WelcomeModal`: mark Growth as the trial plan, and change the badge text to Growth.
- Help docs: change "Pro trial" to "Growth trial".

## Backfill (production, needs user approval)

One row only. No status rows change.

```sql
UPDATE public.restaurants
SET trial_ends_at = now() + interval '14 days'
WHERE id = 'f0b5906d-3b45-498e-b4cd-424e7743b36f'
  AND subscription_status = 'trialing'
  AND trial_ends_at IS NULL;
-- expect: UPDATE 1
```

The guard trigger `_guard_restaurant_billing_columns` lets this run as `postgres`
(`supabase/migrations/20260809100000_guard_restaurant_billing_columns.sql:64-77`).

## Tests

- pgTAP `supabase/tests/effective_subscription_status.test.sql`: expired, running,
  NULL end, other statuses, boundary, grants, and parity with `get_effective_subscription_tier`.
- Vitest `tests/unit/subscriptionPlans.test.ts`: `getEffectiveSubscriptionStatus` cases.
- Vitest `tests/unit/useSubscription.test.ts`: Growth tier in a trial,
  `isTrialExpired`, `isTrialing` false after the end, `trialDaysRemaining` null after the end.

## Not in scope

- The health score. It uses `effective_subscription_status` later.
- A cron job or a stored `trial_expired` value.
- The trial email schedule.

## TLA+ check

No `run-tla` trigger matches. The change has no concurrency, no retry, and no state machine with writes.
