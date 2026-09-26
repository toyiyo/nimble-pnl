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
import { randomUUID } from 'node:crypto';
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

  // The loop ends at the filesystem root. Both paths below take `dirname(dir)`
  // and return when it stops changing, so the walk is bounded by the path
  // depth. A fixed depth cap is not safe here: a worktree sits three levels
  // inside the repository, and a test can start deeper still.
  for (;;) {
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

    // The file exists but does not hold this key. Continue upward. A nested
    // `.env.local` for an unrelated purpose must not hide the repository-level
    // one.
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
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

/**
 * Return the shared service-role client, and build it on the first call.
 *
 * The build is lazy on purpose. An import of this module must not throw in a
 * spec that never calls `setSubscriptionTier`.
 */
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

/**
 * Seed one product and its usage transactions for a restaurant.
 * The dashboard COGS reads these rows through the
 * get_inventory_usage_by_day RPC, which sums ABS(total_cost) for
 * rows with transaction_type = 'usage'.
 */
export async function seedInventoryUsage(
  restaurantId: string,
  usageRows: Array<{ totalCost: number; transactionDate: string }>
): Promise<void> {
  const supabase = getServiceRoleClient();

  const { data: product, error: productError } = await supabase
    .from('products')
    .insert({
      restaurant_id: restaurantId,
      sku: `E2E-COGS-${Date.now()}`,
      name: 'E2E COGS Test Product',
    })
    .select('id')
    .single();

  if (productError || !product) {
    throw new Error(`Failed to seed product: ${productError?.message}`);
  }

  const { error: txnError } = await supabase
    .from('inventory_transactions')
    .insert(
      usageRows.map((row) => ({
        restaurant_id: restaurantId,
        product_id: product.id,
        transaction_type: 'usage',
        quantity: -5,
        total_cost: row.totalCost,
        transaction_date: row.transactionDate,
      }))
    );

  if (txnError) {
    throw new Error(`Failed to seed usage transactions: ${txnError.message}`);
  }
}

/**
 * Seed one Toast card payment for a restaurant, as the service role.
 *
 * `toast_payments` only carries a member SELECT policy (supabase/migrations/
 * 20251116100100_toast_integration.sql) — writes come from the sync edge
 * functions, which use the service-role key. A spec must seed through this
 * helper instead of the page's own browser session.
 */
export async function seedToastPayment(
  restaurantId: string,
  input: {
    paymentDate: string;
    amount: number;
    tipAmount?: number;
    paymentType?: string;
    paymentStatus?: string;
  }
): Promise<void> {
  const supabase = getServiceRoleClient();

  const { error } = await supabase.from('toast_payments').insert({
    restaurant_id: restaurantId,
    toast_payment_guid: `e2e-pay-${randomUUID()}`,
    toast_order_guid: `e2e-order-${randomUUID()}`,
    payment_type: input.paymentType ?? 'CREDIT',
    amount: input.amount,
    tip_amount: input.tipAmount ?? 0,
    payment_date: input.paymentDate,
    // The deposit-match Toast adapter now counts only settled payments
    // (`AND tp.payment_status = 'CAPTURED'` in
    // `supabase/migrations/20260905090000_deposit_match_toast_captured.sql`).
    // Default to a settled payment so a spec that does not care about
    // `payment_status` still models a real, batch-closed Toast payment.
    payment_status: input.paymentStatus ?? 'CAPTURED',
  });

  if (error) {
    throw new Error(`Failed to seed Toast payment: ${error.message}`);
  }
}

/**
 * Run one auto-link sweep pass for a restaurant, as the service role.
 *
 * `auto_link_pending_outflows_internal` is granted to `service_role` only
 * (supabase/migrations/20260830100000_auto_link_pending_outflows.sql), so a
 * spec must call it through this client instead of the page's normal
 * browser session, and instead of waiting for the cron tick that calls it
 * in production.
 */
export async function runAutoLinkPendingOutflows(
  restaurantId: string
): Promise<{ linkedCount: number; candidateCount: number }> {
  const supabase = getServiceRoleClient();

  const { data, error } = await supabase.rpc('auto_link_pending_outflows_internal', {
    p_restaurant_id: restaurantId,
  });

  if (error) {
    throw new Error(`Failed to run auto_link_pending_outflows_internal: ${error.message}`);
  }

  const row = data?.[0];
  return {
    linkedCount: row?.linked_count ?? 0,
    candidateCount: row?.candidate_count ?? 0,
  };
}
