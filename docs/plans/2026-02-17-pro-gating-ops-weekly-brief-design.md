# Pro Subscription Gating: Ops Inbox & Weekly Brief

**Date**: 2026-02-17
**Status**: Approved

## Summary

Gate the Ops Inbox and Weekly Brief features behind the Pro subscription tier ($299/mo). Uses the existing `SUBSCRIPTION_FEATURES` + `FeatureGate` infrastructure — no new patterns needed.

## Decisions

| Question | Decision |
|----------|----------|
| Which ops inbox item types are gated? | All — entire feature is Pro-only |
| Upsell experience | Existing `FeatureGate` component (inline upgrade card) |
| Backend generation for non-Pro? | Skip entirely — save AI/compute costs |
| Dashboard ops/brief widgets for non-Pro? | Hidden entirely |
| Nav items for non-Pro? | Visible with PRO badge, page-level FeatureGate on click |

## Design

### 1. Feature Definitions

Add two new feature keys to `SUBSCRIPTION_FEATURES` in `src/lib/subscriptionPlans.ts`:

- `ops_inbox` — requiredTier: `pro`
- `weekly_brief` — requiredTier: `pro`

Both get name, description, and benefits arrays for the FeatureGate upgrade prompt.

### 2. Frontend Gating

**Pages** (`OpsInbox.tsx`, `WeeklyBrief.tsx`): Wrap page content with `<FeatureGate featureKey="...">`. Non-Pro users see the upgrade card.

**Dashboard** (`Index.tsx`): Conditionally render ops inbox count widget and weekly brief link using `hasFeature()`. Non-Pro users don't see them at all.

**Navigation** (`AppSidebar.tsx`): Add optional `proFeature` field to nav item config. When set and user lacks access, render a small "PRO" badge next to the label. Clicking navigates to the page where `FeatureGate` handles the upsell. Badge disappears for Pro users.

### 3. Backend Gating

**Weekly brief cron** — Update `enqueue_weekly_brief_jobs()` to filter: `WHERE public.has_subscription_feature(id, 'weekly_brief')`. Non-Pro restaurants are skipped entirely.

**Anomaly detectors** — Gate at the caller level (the edge function/cron that invokes `detect_uncategorized_backlog`, `detect_metric_anomalies`, `detect_reconciliation_gaps`). Check `has_subscription_feature(restaurant_id, 'ops_inbox')` before calling detectors. SQL functions remain reusable.

**DB feature mapping** — New migration adds `ops_inbox` and `weekly_brief` to the feature-to-tier mapping in `has_subscription_feature()`.

### 4. Edge Cases

- **Downgrade**: Historical data stays in DB, becomes inaccessible behind FeatureGate. No deletion.
- **Re-upgrade**: Data is still there, immediately accessible again.
- **Grandfathered**: Already handled by `has_subscription_feature()` — Pro access until grace period expires.
- **Trial**: 14-day Growth trial doesn't include Pro features. Consistent with AI assistant.

### 5. Testing

- Unit: `tierHasFeature()` returns correct results for `ops_inbox`/`weekly_brief` across tiers
- pgTAP: `has_subscription_feature(id, 'ops_inbox')` returns true only for Pro
- pgTAP: `enqueue_weekly_brief_jobs()` skips non-Pro restaurants

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/subscriptionPlans.ts` | Add `ops_inbox` and `weekly_brief` feature keys |
| `src/pages/OpsInbox.tsx` | Wrap content with `<FeatureGate>` |
| `src/pages/WeeklyBrief.tsx` | Wrap content with `<FeatureGate>` |
| `src/pages/Index.tsx` | Gate dashboard widgets with `hasFeature()` |
| `src/components/AppSidebar.tsx` | Add PRO badge to nav items |
| `supabase/migrations/new` | Update `has_subscription_feature()` + `enqueue_weekly_brief_jobs()` |
| Edge function (anomaly cron) | Add subscription check before running detectors |
| `tests/unit/` | Unit tests for feature tier checks |
| `supabase/tests/` | pgTAP tests for DB-level gating |
