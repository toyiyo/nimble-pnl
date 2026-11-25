// Derive status flags from a Stripe connected account object.
// No Deno globals here: Vitest imports this file.
export interface StripeAccountStatuses {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  onboardingComplete: boolean;
}

export const deriveStatuses = (acct: any): StripeAccountStatuses => {
  const chargesEnabled = Boolean(acct?.charges_enabled);
  const payoutsEnabled = Boolean(acct?.payouts_enabled);
  const detailsSubmitted = Boolean(acct?.details_submitted);
  const onboardingComplete = Boolean(detailsSubmitted && chargesEnabled);

  return {
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
    onboardingComplete,
  };
};
