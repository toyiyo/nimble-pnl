/**
 * Service-role Supabase client for E2E test setup.
 *
 * Playwright specs run as a normal browser session and cannot write
 * restaurant billing columns once the billing-column guard trigger is in
 * place (see supabase/migrations/20260809100000_guard_restaurant_billing_columns.sql).
 * This helper uses the service-role key, which the guard's second,
 * defense-in-depth check always allows, so E2E setup can still seed a
 * restaurant's subscription tier for a test.
 *
 * Never import this file from application code. It is test-only and reads
 * SUPABASE_SERVICE_ROLE_KEY, a secret that must never reach the browser.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/integrations/supabase/types';
import type { SubscriptionTier, SubscriptionStatus } from '@/lib/subscriptionPlans';

export type { SubscriptionTier, SubscriptionStatus };

let cachedClient: SupabaseClient<Database> | null = null;

function getServiceRoleClient(): SupabaseClient<Database> {
  if (cachedClient) {
    return cachedClient;
  }

  const url = process.env.SUPABASE_URL;
  if (!url) {
    throw new Error(
      'SUPABASE_URL environment variable is required for the E2E service-role helper.'
    );
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY environment variable is required for the E2E service-role helper.'
    );
  }

  cachedClient = createClient<Database>(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}

/**
 * Set a restaurant's subscription tier and status as the service role.
 * Use this from E2E setup instead of the browser-session client, because
 * the billing-column guard trigger blocks the update for any other role.
 */
export async function setSubscriptionTier(
  restaurantId: string,
  tier: SubscriptionTier = 'pro',
  status: SubscriptionStatus = 'active'
): Promise<void> {
  const supabase = getServiceRoleClient();

  const { error } = await supabase
    .from('restaurants')
    .update({
      subscription_tier: tier,
      subscription_status: status,
    })
    .eq('id', restaurantId);

  if (error) {
    throw new Error(`Failed to set subscription tier: ${error.message}`);
  }
}
