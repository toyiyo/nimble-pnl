import { test, expect } from '@playwright/test';
import { signUpAndCreateRestaurant, generateTestUser } from '../helpers/e2e-supabase';

/**
 * E2E test for the restaurant billing column guard.
 *
 * See supabase/migrations/20260809100000_guard_restaurant_billing_columns.sql
 * and docs/superpowers/specs/2026-08-09-restaurant-billing-column-guard-design.md.
 *
 * An owner's browser session must not be able to write
 * `restaurants.subscription_tier` directly. Only the service role (Stripe
 * webhooks, the migration role) may change billing columns.
 *
 * A zero-row UPDATE returns no error from PostgREST, so this test also
 * re-reads the row. An error assertion alone could pass for the wrong
 * reason — for example a WHERE clause that quietly matches no row.
 */
test.describe('Restaurant billing column guard', () => {
  test('blocks an owner from self-upgrading subscription_tier', async ({ page }) => {
    const user = generateTestUser('billing-guard');
    await signUpAndCreateRestaurant(page, user);

    const restaurantId = await page.evaluate(() => (window as any).__getRestaurantId());
    expect(restaurantId).toBeTruthy();

    const readSubscriptionTier = (stage: 'before' | 'after') =>
      page.evaluate(
        async ({ id, stage }) => {
          const supabase = (window as any).__supabase;
          const { data, error } = await supabase
            .from('restaurants')
            .select('subscription_tier')
            .eq('id', id)
            .single();
          if (error) {
            throw new Error(`Failed to read restaurant ${stage} the self-upgrade attempt: ${error.message}`);
          }
          return data.subscription_tier as string;
        },
        { id: restaurantId, stage }
      );

    // signUpAndCreateRestaurant seeds the tier to 'pro' through the
    // service-role helper, so the owner's own attempt below must target a
    // different value for the write to count as a change.
    expect(await readSubscriptionTier('before')).toBe('pro');

    const selfUpgrade = await page.evaluate(async (id: string) => {
      const supabase = (window as any).__supabase;
      const { error } = await supabase
        .from('restaurants')
        .update({ subscription_tier: 'growth' })
        .eq('id', id);
      return { message: error?.message ?? null };
    }, restaurantId);

    expect(selfUpgrade.message).toBeTruthy();

    expect(await readSubscriptionTier('after')).toBe('pro');
  });
});
