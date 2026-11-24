// Handle Stripe Connect "account.updated" webhooks.
// No Deno globals here: Vitest imports this file.
import { deriveStatuses } from "./stripeAccountStatus.ts";

export interface StripeConnectWebhookDeps {
  secret: string;
  stripe: any;
  db: any;
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const ignored = (): Response => json({ received: true, ignored: true }, 200);

export const handleStripeConnectWebhook = async (
  req: Request,
  deps: StripeConnectWebhookDeps,
): Promise<Response> => {
  const { secret, stripe, db } = deps;

  if (!secret) {
    console.error("[CONNECT-WEBHOOK] STRIPE_CONNECT_WEBHOOK_SECRET is not set");
    return new Response("Webhook not configured", { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("No signature header", { status: 400 });
  }

  let event: any;
  try {
    const rawBody = await req.text();
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown webhook error";
    console.error("[CONNECT-WEBHOOK] Signature verification failed:", message);
    return new Response("Invalid signature", { status: 400 });
  }

  if (event?.type !== "account.updated") {
    return ignored();
  }

  const accountId: unknown = event.account;
  if (typeof accountId !== "string" || !accountId) {
    console.warn("[CONNECT-WEBHOOK] Event has no account");
    return ignored();
  }
  if (event.data?.object?.id !== accountId) {
    console.warn("[CONNECT-WEBHOOK] Payload account id does not match event.account");
    return ignored();
  }

  try {
    const { data: row, error: selectError } = await db
      .from("stripe_connected_accounts")
      .select("id")
      .eq("stripe_account_id", accountId)
      .maybeSingle();
    if (selectError) throw selectError;
    if (!row) {
      console.log("[CONNECT-WEBHOOK] Unknown account:", accountId);
      return json({ received: true, unknown: true }, 200);
    }

    // Do not trust the payload for state. Read the live account.
    const live = await stripe.accounts.retrieve(accountId);
    const statuses = deriveStatuses(live);

    const { error: updateError } = await db
      .from("stripe_connected_accounts")
      .update({
        charges_enabled: statuses.chargesEnabled,
        payouts_enabled: statuses.payoutsEnabled,
        details_submitted: statuses.detailsSubmitted,
        onboarding_complete: statuses.onboardingComplete,
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_account_id", accountId);
    if (updateError) throw updateError;

    return json({ received: true }, 200);
  } catch (err) {
    // Log ids for tracing. Never log the payload or secrets.
    console.error("[CONNECT-WEBHOOK] Processing failed:", {
      eventId: event?.id,
      eventType: event?.type,
      accountId,
      err,
    });
    return json({ error: "Webhook processing failed" }, 500);
  }
};
