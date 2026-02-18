# Pro Gating: Ops Inbox & Weekly Brief — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Gate the Ops Inbox and Weekly Brief features behind the Pro subscription tier, with upsell screens for non-Pro users and backend filtering to skip generation for non-Pro restaurants.

**Architecture:** Add two new feature keys (`ops_inbox`, `weekly_brief`) to the existing `SUBSCRIPTION_FEATURES` system. Frontend uses `<FeatureGate>` wrapper on page content and `hasFeature()` for dashboard widgets. Backend migration updates `has_subscription_feature()` and `enqueue_weekly_brief_jobs()` to filter by subscription tier.

**Tech Stack:** React, TypeScript, Supabase (PostgreSQL, Edge Functions), existing subscription infrastructure (`FeatureGate`, `useSubscription`, `has_subscription_feature`)

---

### Task 1: Add feature keys to SUBSCRIPTION_FEATURES

**Files:**
- Modify: `src/lib/subscriptionPlans.ts:248-317` (Pro tier features section)

**Step 1: Add `ops_inbox` and `weekly_brief` feature definitions**

In `src/lib/subscriptionPlans.ts`, add two entries to `SUBSCRIPTION_FEATURES` inside the Pro tier section (after `ai_assistant`):

```typescript
  ops_inbox: {
    key: 'ops_inbox',
    name: 'Ops Inbox',
    requiredTier: 'pro' as SubscriptionTier,
    description: 'AI-powered operational alerts, anomaly detection, and reconciliation insights',
    benefits: [
      'Automatic anomaly detection for revenue drops and cost spikes',
      'Bank-to-POS reconciliation gap alerts',
      'Uncategorized transaction backlog tracking',
    ],
  },
  weekly_brief: {
    key: 'weekly_brief',
    name: 'Weekly Brief',
    requiredTier: 'pro' as SubscriptionTier,
    description: 'AI-generated weekly performance summary with variance analysis',
    benefits: [
      'Weekly P&L variance analysis vs prior periods',
      'AI-written narrative summary of your week',
      'Actionable recommendations for improvement',
    ],
  },
```

Also add "Ops Inbox" and "Weekly Brief" to `SUBSCRIPTION_PLANS.pro.features` array (after 'AI Assistant'):

```typescript
'Ops Inbox',
'Weekly Brief',
```

**Step 2: Commit**

```bash
git add src/lib/subscriptionPlans.ts
git commit -m "feat: add ops_inbox and weekly_brief to SUBSCRIPTION_FEATURES as Pro-tier"
```

---

### Task 2: Add unit tests for new feature keys

**Files:**
- Modify: `tests/unit/subscriptionPlans.test.ts`

**Step 1: Add tierHasFeature tests for ops_inbox and weekly_brief**

In the `tierHasFeature` describe block, add these tests:

In `starter tier` → `does NOT have access to pro features`:
```typescript
expect(tierHasFeature('starter', 'ops_inbox')).toBe(false);
expect(tierHasFeature('starter', 'weekly_brief')).toBe(false);
```

In `growth tier` → `does NOT have access to pro features`:
```typescript
expect(tierHasFeature('growth', 'ops_inbox')).toBe(false);
expect(tierHasFeature('growth', 'weekly_brief')).toBe(false);
```

In `pro tier` → `HAS access to pro features`:
```typescript
expect(tierHasFeature('pro', 'ops_inbox')).toBe(true);
expect(tierHasFeature('pro', 'weekly_brief')).toBe(true);
```

**Step 2: Add getRequiredTier tests**

In the `pro tier features` describe block:
```typescript
it('returns pro for ops_inbox', () => {
  expect(getRequiredTier('ops_inbox')).toBe('pro');
});

it('returns pro for weekly_brief', () => {
  expect(getRequiredTier('weekly_brief')).toBe('pro');
});
```

**Step 3: Run tests**

Run: `npm run test -- tests/unit/subscriptionPlans.test.ts`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add tests/unit/subscriptionPlans.test.ts
git commit -m "test: add unit tests for ops_inbox and weekly_brief feature gating"
```

---

### Task 3: Gate Ops Inbox page with FeatureGate

**Files:**
- Modify: `src/pages/OpsInbox.tsx`

**Step 1: Import FeatureGate**

Add to imports:
```typescript
import { FeatureGate } from '@/components/subscription/FeatureGate';
```

**Step 2: Wrap page content with FeatureGate**

Find the main return statement of the OpsInbox component. Wrap the entire page content (the outermost container `<div>`) with:

```typescript
<FeatureGate featureKey="ops_inbox">
  {/* existing page content */}
</FeatureGate>
```

**Step 3: Commit**

```bash
git add src/pages/OpsInbox.tsx
git commit -m "feat: gate Ops Inbox page behind Pro subscription"
```

---

### Task 4: Gate Weekly Brief page with FeatureGate

**Files:**
- Modify: `src/pages/WeeklyBrief.tsx`

**Step 1: Import FeatureGate**

Add to imports:
```typescript
import { FeatureGate } from '@/components/subscription/FeatureGate';
```

**Step 2: Wrap page content with FeatureGate**

Find the main return statement of the WeeklyBrief component. Wrap the entire page content with:

```typescript
<FeatureGate featureKey="weekly_brief">
  {/* existing page content */}
</FeatureGate>
```

**Step 3: Commit**

```bash
git add src/pages/WeeklyBrief.tsx
git commit -m "feat: gate Weekly Brief page behind Pro subscription"
```

---

### Task 5: Hide dashboard ops/brief widgets for non-Pro users

**Files:**
- Modify: `src/pages/Index.tsx:1096-1129` (AI Operator section)

**Step 1: Import useSubscription**

Add to imports:
```typescript
import { useSubscription } from '@/hooks/useSubscription';
```

**Step 2: Get hasFeature from the hook**

Inside the main component function, add:
```typescript
const { hasFeature } = useSubscription();
```

**Step 3: Conditionally render the AI Operator section**

Wrap the "AI Operator" grid (`<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">`) with a `hasFeature` check. The entire grid contains both the ops inbox button and weekly brief button. Wrap it:

```typescript
{hasFeature('ops_inbox') && (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
    {/* existing ops inbox button */}
    {/* existing weekly brief button */}
  </div>
)}
```

Note: Since both ops_inbox and weekly_brief are Pro-tier, checking either one is sufficient — `hasFeature('ops_inbox')` covers both. If you wanted them independent, you'd check each button separately, but since both require the same tier this is cleaner.

**Step 4: Commit**

```bash
git add src/pages/Index.tsx
git commit -m "feat: hide ops inbox and weekly brief dashboard widgets for non-Pro users"
```

---

### Task 6: Add PRO badge to nav items in AppSidebar

**Files:**
- Modify: `src/components/AppSidebar.tsx:61-73` (FEATURE_GATED_PATHS)

**Step 1: Add ops-inbox and weekly-brief to FEATURE_GATED_PATHS**

The sidebar already has a `FEATURE_GATED_PATHS` mapping and renders PRO/Growth badges with the existing `Sparkles` badge UI. Just add two entries:

```typescript
const FEATURE_GATED_PATHS: Record<string, keyof typeof SUBSCRIPTION_FEATURES> = {
  // Growth tier (AI features)
  '/financial-intelligence': 'financial_intelligence',
  '/scheduling': 'scheduling',
  '/receipt-import': 'inventory_automation',
  // Pro tier (Stripe features)
  '/ops-inbox': 'ops_inbox',       // ADD THIS
  '/weekly-brief': 'weekly_brief', // ADD THIS
  '/banking': 'banking',
  '/invoices': 'invoicing',
  '/expenses': 'expenses',
  '/print-checks': 'expenses',
  '/assets': 'assets',
  '/payroll': 'payroll',
};
```

No other changes needed — the existing rendering logic already handles the badge display and color (`bg-purple-100` for Pro) based on this mapping.

**Step 2: Commit**

```bash
git add src/components/AppSidebar.tsx
git commit -m "feat: add PRO badge to ops inbox and weekly brief nav items"
```

---

### Task 7: Backend migration — update has_subscription_feature and enqueue_weekly_brief_jobs

**Files:**
- Create: `supabase/migrations/<timestamp>_gate_ops_weekly_brief_pro.sql`

**Step 1: Write migration**

Create a new migration file. The migration does two things:

1. **Update `has_subscription_feature()`** to recognize `ops_inbox` and `weekly_brief` as Pro-only features.
2. **Update `enqueue_weekly_brief_jobs()`** to skip non-Pro restaurants.

```sql
-- Gate ops_inbox and weekly_brief behind Pro subscription tier.
-- 1. Update has_subscription_feature to include new feature keys
-- 2. Update enqueue_weekly_brief_jobs to skip non-Pro restaurants

-- ========================================================
-- 1. Re-create has_subscription_feature with new feature keys
-- ========================================================
CREATE OR REPLACE FUNCTION public.has_subscription_feature(
  p_restaurant_id UUID,
  p_feature TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier TEXT;
  v_status TEXT;
  v_grandfathered_until TIMESTAMPTZ;
  v_trial_ends_at TIMESTAMPTZ;
  v_effective_tier TEXT;
BEGIN
  SELECT
    subscription_tier,
    subscription_status,
    grandfathered_until,
    trial_ends_at
  INTO v_tier, v_status, v_grandfathered_until, v_trial_ends_at
  FROM restaurants
  WHERE id = p_restaurant_id;

  IF v_tier IS NULL THEN
    RETURN FALSE;
  END IF;

  v_effective_tier := v_tier;

  -- Handle grandfathered status
  IF v_status = 'grandfathered' THEN
    IF v_grandfathered_until IS NULL OR NOW() <= v_grandfathered_until THEN
      v_effective_tier := 'pro';
    ELSE
      v_effective_tier := 'starter';
      v_status := 'active';
    END IF;
  END IF;

  -- Handle trial status
  IF v_status = 'trialing' THEN
    IF v_trial_ends_at IS NULL OR NOW() <= v_trial_ends_at THEN
      v_effective_tier := 'growth';
    ELSE
      RETURN FALSE;
    END IF;
  END IF;

  -- Handle inactive subscriptions
  IF v_status IN ('canceled', 'past_due') THEN
    IF v_status = 'past_due' THEN
      v_effective_tier := 'starter';
    ELSE
      v_effective_tier := 'starter';
    END IF;
  END IF;

  -- Feature tier requirements
  RETURN CASE p_feature
    -- Pro-only features
    WHEN 'ai_assistant' THEN v_effective_tier = 'pro'
    WHEN 'ops_inbox' THEN v_effective_tier = 'pro'
    WHEN 'weekly_brief' THEN v_effective_tier = 'pro'

    -- Growth+ features (Growth and Pro)
    WHEN 'financial_intelligence' THEN v_effective_tier IN ('growth', 'pro')
    WHEN 'inventory_automation' THEN v_effective_tier IN ('growth', 'pro')
    WHEN 'scheduling' THEN v_effective_tier IN ('growth', 'pro')
    WHEN 'ai_alerts' THEN v_effective_tier IN ('growth', 'pro')
    WHEN 'multi_location_dashboard' THEN v_effective_tier IN ('growth', 'pro')
    WHEN 'recipe_profitability' THEN v_effective_tier IN ('growth', 'pro')

    -- Starter+ features (all tiers)
    WHEN 'basic_pnl' THEN TRUE
    WHEN 'basic_inventory' THEN TRUE
    WHEN 'labor_tracking' THEN TRUE
    WHEN 'pos_integration' THEN TRUE
    WHEN 'bank_sync' THEN TRUE

    ELSE FALSE
  END;
END;
$$;


-- ========================================================
-- 2. Update enqueue_weekly_brief_jobs to skip non-Pro restaurants
-- ========================================================
CREATE OR REPLACE FUNCTION public.enqueue_weekly_brief_jobs()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_week_end DATE;
  v_dow INTEGER;
  v_restaurant RECORD;
  v_msg_id BIGINT;
  v_enqueued INTEGER := 0;
  v_skipped INTEGER := 0;
BEGIN
  v_dow := EXTRACT(DOW FROM CURRENT_DATE)::integer;

  IF v_dow = 1 THEN
    v_week_end := CURRENT_DATE - 1;
  ELSIF v_dow = 0 THEN
    v_week_end := CURRENT_DATE - 7;
  ELSE
    v_week_end := CURRENT_DATE - v_dow;
  END IF;

  -- Only enqueue for restaurants with Pro subscription (or grandfathered/trialing with Pro access)
  FOR v_restaurant IN
    SELECT id FROM public.restaurants
    WHERE public.has_subscription_feature(id, 'weekly_brief')
  LOOP
    -- Skip if brief already exists for this restaurant + week
    IF EXISTS (
      SELECT 1 FROM public.weekly_brief wb
      WHERE wb.restaurant_id = v_restaurant.id
        AND wb.brief_week_end = v_week_end
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_msg_id := pgmq.send(
      'weekly_brief_jobs',
      jsonb_build_object(
        'restaurant_id', v_restaurant.id,
        'brief_week_end', v_week_end
      )
    );

    INSERT INTO public.weekly_brief_job_log (
      restaurant_id, brief_week_end, status, attempt, msg_id
    ) VALUES (
      v_restaurant.id, v_week_end, 'queued', 1, v_msg_id
    );

    v_enqueued := v_enqueued + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'week_end', v_week_end,
    'enqueued', v_enqueued,
    'skipped', v_skipped
  );
END;
$$;
```

**Step 2: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: gate ops_inbox and weekly_brief in has_subscription_feature and enqueue cron"
```

---

### Task 8: Add pgTAP tests for backend gating

**Files:**
- Modify: `supabase/tests/20260129000000_subscription_system.sql`

**Step 1: Add test block for ops_inbox and weekly_brief features**

Append a new test block at the end of the file:

```sql
-- 5) ops_inbox and weekly_brief require Pro tier
BEGIN;
SELECT plan(8);

-- Active Pro
INSERT INTO restaurants (id, name, subscription_tier, subscription_status) VALUES
  ('00000000-0000-0000-0000-eee000000001', 'Pro Restaurant', 'pro', 'active')
ON CONFLICT DO NOTHING;

SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-eee000000001', 'ops_inbox'),
  true,
  'Active Pro has ops_inbox'
);
SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-eee000000001', 'weekly_brief'),
  true,
  'Active Pro has weekly_brief'
);

-- Active Growth
INSERT INTO restaurants (id, name, subscription_tier, subscription_status) VALUES
  ('00000000-0000-0000-0000-eee000000002', 'Growth Restaurant', 'growth', 'active')
ON CONFLICT DO NOTHING;

SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-eee000000002', 'ops_inbox'),
  false,
  'Active Growth lacks ops_inbox'
);
SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-eee000000002', 'weekly_brief'),
  false,
  'Active Growth lacks weekly_brief'
);

-- Active Starter
INSERT INTO restaurants (id, name, subscription_tier, subscription_status) VALUES
  ('00000000-0000-0000-0000-eee000000003', 'Starter Restaurant', 'starter', 'active')
ON CONFLICT DO NOTHING;

SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-eee000000003', 'ops_inbox'),
  false,
  'Active Starter lacks ops_inbox'
);
SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-eee000000003', 'weekly_brief'),
  false,
  'Active Starter lacks weekly_brief'
);

-- Grandfathered (within window) gets Pro access
INSERT INTO restaurants (id, name, subscription_tier, subscription_status, grandfathered_until) VALUES
  ('00000000-0000-0000-0000-eee000000004', 'Grandfathered Restaurant', 'starter', 'grandfathered', now() + interval '30 days')
ON CONFLICT DO NOTHING;

SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-eee000000004', 'ops_inbox'),
  true,
  'Grandfathered restaurant has ops_inbox'
);
SELECT is(
  has_subscription_feature('00000000-0000-0000-0000-eee000000004', 'weekly_brief'),
  true,
  'Grandfathered restaurant has weekly_brief'
);

SELECT * FROM finish();
ROLLBACK;
```

**Step 2: Commit**

```bash
git add supabase/tests/20260129000000_subscription_system.sql
git commit -m "test: add pgTAP tests for ops_inbox and weekly_brief Pro gating"
```

---

### Task 9: Verify build and run tests

**Step 1: Run unit tests**

Run: `npm run test -- tests/unit/subscriptionPlans.test.ts`
Expected: ALL PASS

**Step 2: Run lint**

Run: `npm run lint -- --quiet 2>&1 | head -20`
Expected: No new errors introduced

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Final commit (if any fixes needed)**

If any issues found, fix and commit with descriptive message.
