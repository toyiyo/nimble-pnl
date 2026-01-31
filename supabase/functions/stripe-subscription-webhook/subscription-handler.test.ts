// Deno test for customer.subscription.updated cancellation scenario
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import type Stripe from "https://esm.sh/stripe@20.1.0";
import { processSubscriptionEvent } from "./subscription-handler.ts";

// Minimal supabase client mock
function createSupabaseMock() {
  const calls: any[] = [];
  return {
    calls,
    from(table: string) {
      if (table !== "restaurants") throw new Error(`Unexpected table ${table}`);
      return {
        update: (data: Record<string, unknown>) => ({
          eq: (col: string, val: string) => {
            calls.push({ type: "update", data, col, val });
            return { error: null };
          },
        }),
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      };
    },
  };
}

Deno.test("processSubscriptionEvent handles cancellation update payload", async () => {
  const supabaseMock = createSupabaseMock();

  const event = {
    id: "evt_test_cancel_001",
    object: "event",
    api_version: "2025-08-27.basil",
    created: 1769783457,
    livemode: false,
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_1Sv5RDD9w6YUNUOUzsr1KrKl",
        object: "subscription",
        status: "active",
        metadata: {
          restaurant_id: "b8e32fff-af18-407f-9e2f-3fef821963a1",
          tier: "starter",
          period: "monthly",
        },
        current_period_end: 1772237988,
        trial_end: null,
        items: {
          data: [
            {
              price: {
                id: "price_1Sv59bD9w6YUNUOU4f0lvUDx",
                recurring: { interval: "month" },
              },
            },
          ],
        },
        customer: "cus_Tsqvg2fLyfEUDa",
      },
      previous_attributes: {
        cancel_at: null,
        cancel_at_period_end: false,
        canceled_at: null,
        cancellation_details: { reason: null },
      },
    },
  } as unknown as Stripe.Event;

  await processSubscriptionEvent(event, supabaseMock as any);

  assertEquals(supabaseMock.calls.length, 1);
  const call = supabaseMock.calls[0];
  assertEquals(call.val, "b8e32fff-af18-407f-9e2f-3fef821963a1");
  assertEquals(call.data.subscription_status, "active");
  assertEquals(call.data.subscription_tier, "starter");
  assertEquals(call.data.subscription_period, "monthly");
  assertEquals(call.data.stripe_subscription_id, "sub_1Sv5RDD9w6YUNUOUzsr1KrKl");
  assertEquals(call.data.subscription_ends_at, new Date(1772237988 * 1000).toISOString());
});
