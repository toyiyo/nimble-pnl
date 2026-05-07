// Deno test for customer.subscription.updated cancellation scenario
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import type Stripe from "https://esm.sh/stripe@20.1.0";
import { processSubscriptionEvent } from "./subscription-handler.ts";
import { _setCaptureFnForTesting } from "../_shared/posthogServer.ts";

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

// Minimal stripe mock
function createStripeMock() {
  return {
    subscriptions: {
      retrieve: async () => ({} as Stripe.Subscription),
    },
  } as unknown as Stripe;
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

  await processSubscriptionEvent(event, supabaseMock as any, createStripeMock());

  assertEquals(supabaseMock.calls.length, 1);
  const call = supabaseMock.calls[0];
  assertEquals(call.val, "b8e32fff-af18-407f-9e2f-3fef821963a1");
  assertEquals(call.data.subscription_status, "active");
  assertEquals(call.data.subscription_tier, "starter");
  assertEquals(call.data.subscription_period, "monthly");
  assertEquals(call.data.stripe_subscription_id, "sub_1Sv5RDD9w6YUNUOUzsr1KrKl");
  assertEquals(call.data.subscription_ends_at, new Date(1772237988 * 1000).toISOString());
});

function captureMock() {
  const events: { distinctId: string; event: string; properties?: Record<string, unknown> }[] = [];
  return {
    events,
    fn: async (input: { distinctId: string; event: string; properties?: Record<string, unknown> }) => {
      events.push(input);
    },
  };
}

function makeSubscriptionEvent(
  type: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted",
  overrides: Record<string, unknown> = {},
): Stripe.Event {
  return {
    id: `evt_${type}`,
    object: "event",
    api_version: "2025-08-27.basil",
    created: 1769783457,
    livemode: false,
    type,
    data: {
      object: {
        id: "sub_test_123",
        object: "subscription",
        status: "active",
        metadata: {
          restaurant_id: "rest_abc",
          user_id: "user_xyz",
          tier: "growth",
          period: "monthly",
        },
        current_period_end: 1772237988,
        trial_end: null,
        items: {
          data: [
            {
              price: {
                id: "price_growth_monthly",
                recurring: { interval: "month" },
                unit_amount: 19900,
              },
            },
          ],
        },
        customer: "cus_test_123",
        ...overrides,
      },
    },
  } as unknown as Stripe.Event;
}

Deno.test("customer.subscription.created fires subscription_created PostHog event", async () => {
  const supabaseMock = createSupabaseMock();
  const capture = captureMock();
  _setCaptureFnForTesting(capture.fn);

  try {
    await processSubscriptionEvent(
      makeSubscriptionEvent("customer.subscription.created"),
      supabaseMock as any,
      createStripeMock(),
    );

    assertEquals(capture.events.length, 1);
    assertEquals(capture.events[0].distinctId, "user_xyz");
    assertEquals(capture.events[0].event, "subscription_created");
    assertEquals(capture.events[0].properties?.tier, "growth");
    assertEquals(capture.events[0].properties?.period, "monthly");
    assertEquals(capture.events[0].properties?.mrr_cents, 19900);
  } finally {
    _setCaptureFnForTesting(null);
  }
});

Deno.test("customer.subscription.updated does NOT fire subscription_created", async () => {
  const supabaseMock = createSupabaseMock();
  const capture = captureMock();
  _setCaptureFnForTesting(capture.fn);

  try {
    await processSubscriptionEvent(
      makeSubscriptionEvent("customer.subscription.updated"),
      supabaseMock as any,
      createStripeMock(),
    );

    assertEquals(capture.events.length, 0);
  } finally {
    _setCaptureFnForTesting(null);
  }
});

Deno.test("customer.subscription.deleted fires subscription_canceled PostHog event", async () => {
  const calls: any[] = [];
  const supabaseMock = {
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
            maybeSingle: async () => ({ data: { id: "rest_abc" } }),
          }),
        }),
      };
    },
  };
  const capture = captureMock();
  _setCaptureFnForTesting(capture.fn);

  try {
    await processSubscriptionEvent(
      makeSubscriptionEvent("customer.subscription.deleted"),
      supabaseMock as any,
      createStripeMock(),
    );

    assertEquals(capture.events.length, 1);
    assertEquals(capture.events[0].distinctId, "user_xyz");
    assertEquals(capture.events[0].event, "subscription_canceled");
    assertEquals(capture.events[0].properties?.tier, "growth");
  } finally {
    _setCaptureFnForTesting(null);
  }
});

Deno.test("subscription_created normalizes annual mrr_cents to monthly", async () => {
  const supabaseMock = createSupabaseMock();
  const capture = captureMock();
  _setCaptureFnForTesting(capture.fn);

  try {
    const event = makeSubscriptionEvent("customer.subscription.created", {
      items: {
        data: [
          {
            price: {
              id: "price_growth_annual",
              recurring: { interval: "year" },
              unit_amount: 199000, // $1,990/year
            },
          },
        ],
      },
    });

    await processSubscriptionEvent(event, supabaseMock as any, createStripeMock());

    assertEquals(capture.events.length, 1);
    assertEquals(capture.events[0].properties?.period, "annual");
    // 199000 / 12 = 16583.33 → rounds to 16583
    assertEquals(capture.events[0].properties?.mrr_cents, 16583);
  } finally {
    _setCaptureFnForTesting(null);
  }
});

Deno.test("subscription_canceled derives tier and period from price (not stale metadata)", async () => {
  const calls: any[] = [];
  const supabaseMock = {
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
            maybeSingle: async () => ({ data: { id: "rest_abc" } }),
          }),
        }),
      };
    },
  };
  const capture = captureMock();
  _setCaptureFnForTesting(capture.fn);

  try {
    // Metadata says "starter/monthly" (stale from upgrade), but price says pro/annual.
    const event = makeSubscriptionEvent("customer.subscription.deleted", {
      metadata: {
        restaurant_id: "rest_abc",
        user_id: "user_xyz",
        tier: "starter",
        period: "monthly",
      },
      items: {
        data: [
          {
            price: {
              id: "price_pro_annual",
              recurring: { interval: "year" },
              unit_amount: 299000,
            },
          },
        ],
      },
    });

    await processSubscriptionEvent(event, supabaseMock as any, createStripeMock());

    assertEquals(capture.events.length, 1);
    assertEquals(capture.events[0].event, "subscription_canceled");
    // Should reflect actual price, not stale metadata.
    assertEquals(capture.events[0].properties?.tier, "pro");
    assertEquals(capture.events[0].properties?.period, "annual");
  } finally {
    _setCaptureFnForTesting(null);
  }
});
