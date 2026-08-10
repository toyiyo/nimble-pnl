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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/integrations/supabase/types';
import type { SubscriptionTier, SubscriptionStatus } from '@/lib/subscriptionPlans';

export type { SubscriptionTier, SubscriptionStatus };

let cachedClient: SupabaseClient<Database> | null = null;

/**
 * Read one key from `.env.local`.
 *
 * The CI job sets both variables in the job env, so this fallback never
 * runs there. `playwright.config.ts` loads no dotenv file, and `dotenv` is
 * not a dependency, so a local `npm run test:e2e` has no other way to find
 * the local service-role key.
 *
 * Search upward from the working directory, because Playwright and Vitest
 * can both start from a subdirectory.
 */
function readEnvLocal(key: string): string | undefined {
  let dir = process.cwd();

  for (let depth = 0; depth < 5; depth += 1) {
    let contents: string;
    try {
      contents = readFileSync(join(dir, '.env.local'), 'utf8');
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
      continue;
    }

    for (const line of contents.split('\n')) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (match?.[1] === key) {
        return match[2].trim().replace(/^["']|["']$/g, '');
      }
    }
    return undefined;
  }

  return undefined;
}

/** Prefer the process env, so the CI job env always wins. */
function requireEnv(key: string): string {
  const value = process.env[key] || readEnvLocal(key);
  if (!value) {
    throw new Error(
      `${key} environment variable is required for the E2E service-role helper. ` +
        `Set it in the shell or in .env.local at the repository root.`
    );
  }
  return value;
}

function getServiceRoleClient(): SupabaseClient<Database> {
  if (cachedClient) {
    return cachedClient;
  }

  const url = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

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

  const { data, error } = await supabase
    .from('restaurants')
    .update({
      subscription_tier: tier,
      subscription_status: status,
    })
    .eq('id', restaurantId)
    .select('id');

  if (error) {
    throw new Error(`Failed to set subscription tier: ${error.message}`);
  }

  // PostgREST returns no error for an UPDATE that matches zero rows. Without
  // this check a wrong restaurant ID leaves the test on the default tier and
  // the spec fails later for an unrelated reason.
  if (!data || data.length === 0) {
    throw new Error(
      `Failed to set subscription tier: no restaurant row matched id ${restaurantId}`
    );
  }
}
