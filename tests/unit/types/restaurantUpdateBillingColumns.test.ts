/**
 * Compile-time guard for the restaurant billing columns.
 *
 * The `restaurant_billing_columns_guard` trigger raises SQLSTATE 42501 and
 * aborts the whole statement when a PostgREST caller writes a billing column
 * (supabase/migrations/20260809100000_guard_restaurant_billing_columns.sql).
 *
 * PR #738 and PR #739 show the failure mode this file prevents: a server-side
 * gate landed on a column, the client kept touching that column, and the break
 * appeared at runtime instead of at build time. `RestaurantUpdate` blocks the
 * ten guarded columns, so `tsc` rejects such a payload before it ships.
 *
 * These are type assertions, so `npm run typecheck:types` is the real test.
 * Do not rely on Vitest here. Vitest strips the types with esbuild and never
 * checks them, so every `@ts-expect-error` below passes under `npm run test`
 * whatever the type says. `npm run typecheck` does not cover this file either:
 * tsconfig.app.json includes only `src`. The CI `Unit Tests` job runs
 * `typecheck:types` for that reason.
 */
import { describe, it, expect } from 'vitest';
import type { RestaurantUpdate } from '@/hooks/useRestaurants';

describe('CRITICAL: RestaurantUpdate excludes the guarded billing columns', () => {
  it('accepts the non-billing columns the settings page writes', () => {
    const settings: RestaurantUpdate = {
      name: 'Test Restaurant',
      address: '1 Test Way',
      phone: '555-0100',
      cuisine_type: 'italian',
      timezone: 'America/Chicago',
    };

    const business: RestaurantUpdate = {
      legal_name: 'Test Restaurant LLC',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      business_email: 'owner@test.com',
      ein: '00-0000000',
      entity_type: 'llc',
    };

    expect(settings.name).toBe('Test Restaurant');
    expect(business.city).toBe('Austin');
  });

  it('rejects the guarded billing columns at compile time', () => {
    // Each @ts-expect-error below fails the build if the column becomes
    // assignable again. That is the assertion.
    //
    // All ten guarded columns appear here.
    const rejected: RestaurantUpdate[] = [
      // @ts-expect-error subscription_tier is guarded; Stripe owns it
      { subscription_tier: 'pro' },
      // @ts-expect-error subscription_status is guarded; Stripe owns it
      { subscription_status: 'active' },
      // @ts-expect-error subscription_period is guarded; Stripe owns it
      { subscription_period: 'annual' },
      // @ts-expect-error stripe_subscription_customer_id is guarded
      { stripe_subscription_customer_id: 'cus_fake' },
      // @ts-expect-error stripe_subscription_id is guarded
      { stripe_subscription_id: 'sub_fake' },
      // @ts-expect-error trial_ends_at is guarded; Stripe owns it
      { trial_ends_at: '2030-01-01T00:00:00Z' },
      // @ts-expect-error subscription_ends_at is guarded; Stripe owns it
      { subscription_ends_at: '2030-01-01T00:00:00Z' },
      // @ts-expect-error grandfathered_until is guarded; Stripe owns it
      { grandfathered_until: '2030-01-01T00:00:00Z' },
      // @ts-expect-error stripe_customer_id is guarded; Stripe owns it
      { stripe_customer_id: 'cus_fake2' },
      // @ts-expect-error subscription_cancel_at is guarded; Stripe owns it
      { subscription_cancel_at: '2030-01-01T00:00:00Z' },
    ];

    expect(rejected).toHaveLength(10);
  });

  it('rejects a guarded column in a variable payload, not only in a literal', () => {
    // TypeScript checks excess properties only on an object literal at the
    // assignment. A variable is checked by structural assignability, which
    // permits extra properties. `Omit` alone therefore lets these three through
    // to the database, where the guard raises SQLSTATE 42501 at runtime. The
    // `?: never` half of `RestaurantUpdate` rejects them at build time.
    const withTier = { name: 'Test Restaurant', subscription_tier: 'pro' };
    // @ts-expect-error subscription_tier is guarded, even in a variable payload
    const tierPayload: RestaurantUpdate = withTier;

    const withCustomer = { name: 'Test Restaurant', stripe_customer_id: 'cus_fake' };
    // @ts-expect-error stripe_customer_id is guarded, even in a variable payload
    const customerPayload: RestaurantUpdate = withCustomer;

    const withCancelAt = { name: 'Test Restaurant', subscription_cancel_at: '2030-01-01' };
    // @ts-expect-error subscription_cancel_at is guarded, even in a variable payload
    const cancelAtPayload: RestaurantUpdate = withCancelAt;

    expect([tierPayload, customerPayload, cancelAtPayload]).toHaveLength(3);
  });

  it('accepts a variable payload that holds only allowed columns', () => {
    // The negative cases above must not pass for the wrong reason. This case
    // proves a variable payload is still assignable when no column is guarded.
    const allowed = { name: 'Test Restaurant', city: 'Austin' };
    const payload: RestaurantUpdate = allowed;

    expect(payload.city).toBe('Austin');
  });
});
