// Handle a Stripe Connect "account.updated" event.
// The caller (stripe-invoice-webhook) checks the signature first.
// No Deno globals here: Vitest imports this file.
import { deriveStatuses } from "./stripeAccountStatus.ts";

export interface AccountUpdatedDeps {
  stripe: any;
  db: any;
}

const LOG = "[INVOICE-WEBHOOK][account.updated]";

const json = (body: unknown, status: number, headers: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });

export const handleAccountUpdated = async (
  event: any,
  deps: AccountUpdatedDeps,
  headers: Record<string, string> = {},
): Promise<Response> => {
  const { stripe, db } = deps;
  const ignored = () => json({ received: true, ignored: true }, 200, headers);

  const accountId: unknown = event?.account;
  if (typeof accountId !== "string" || !accountId) {
    console.warn(`${LOG} Event has no account`);
    return ignored();
  }
  if (event.data?.object?.id !== accountId) {
    console.warn(`${LOG} Payload account id does not match event.account`);
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
      console.log(`${LOG} Unknown account:`, accountId);
      return json({ received: true, unknown: true }, 200, headers);
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

    return json({ received: true }, 200, headers);
  } catch (err) {
    // Log ids for tracing. Never log the payload or secrets.
    console.error(`${LOG} Processing failed:`, {
      eventId: event?.id,
      eventType: event?.type,
      accountId,
      err,
    });
    return json({ error: "Webhook processing failed" }, 500, headers);
  }
};
