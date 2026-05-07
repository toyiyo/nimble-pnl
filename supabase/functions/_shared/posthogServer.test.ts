// Deno test for the server-side PostHog capture helper.
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type ServerEventInput,
  _setCaptureFnForTesting,
  captureServerEvent,
} from "./posthogServer.ts";

Deno.test("captureServerEvent forwards payload to injected impl", async () => {
  const calls: ServerEventInput[] = [];
  _setCaptureFnForTesting(async (payload) => {
    calls.push(payload);
  });

  await captureServerEvent({
    distinctId: "user-1",
    event: "subscription_created",
    properties: { tier: "growth", mrr_cents: 19900 },
  });

  _setCaptureFnForTesting(null);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].distinctId, "user-1");
  assertEquals(calls[0].event, "subscription_created");
  assertEquals(calls[0].properties?.tier, "growth");
  assertEquals(calls[0].properties?.mrr_cents, 19900);
});

Deno.test("captureServerEvent swallows errors thrown by the impl", async () => {
  _setCaptureFnForTesting(async () => {
    throw new Error("network down");
  });

  // Should NOT throw — telemetry must never break the calling webhook.
  await captureServerEvent({
    distinctId: "user-2",
    event: "subscription_canceled",
  });

  _setCaptureFnForTesting(null);
});

Deno.test("captureServerEvent default impl is a no-op without env vars", async () => {
  // Make sure no test pollution left an injected impl.
  _setCaptureFnForTesting(null);

  Deno.env.delete("POSTHOG_PROJECT_KEY");
  Deno.env.delete("POSTHOG_HOST");

  // Should resolve without importing posthog-node or making network calls.
  await captureServerEvent({
    distinctId: "user-3",
    event: "subscription_created",
  });
});
