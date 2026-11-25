export type PaymentSetupState = 'not_started' | 'pending' | 'ready';

/**
 * Choose the payment setup state from a connected account row.
 * The ready rule matches `isReadyForInvoicing` in useStripeConnect.
 */
export function getPaymentSetupState(
  account:
    | { charges_enabled: boolean; onboarding_complete: boolean }
    | null
    | undefined,
): PaymentSetupState {
  if (!account) return 'not_started';
  if (account.charges_enabled && account.onboarding_complete) return 'ready';
  return 'pending';
}
