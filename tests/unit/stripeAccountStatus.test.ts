import { describe, it, expect } from 'vitest';
import { deriveStatuses } from '../../supabase/functions/_shared/stripeAccountStatus';

describe('deriveStatuses', () => {
  it('marks onboarding complete when details are submitted and charges are enabled', () => {
    expect(
      deriveStatuses({ charges_enabled: true, payouts_enabled: true, details_submitted: true }),
    ).toEqual({
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      onboardingComplete: true,
    });
  });

  it('does not mark onboarding complete when charges are disabled', () => {
    const result = deriveStatuses({ charges_enabled: false, payouts_enabled: true, details_submitted: true });
    expect(result.onboardingComplete).toBe(false);
    expect(result.payoutsEnabled).toBe(true);
  });

  it('does not mark onboarding complete when details are not submitted', () => {
    const result = deriveStatuses({ charges_enabled: true, payouts_enabled: false, details_submitted: false });
    expect(result.onboardingComplete).toBe(false);
    expect(result.chargesEnabled).toBe(true);
  });

  it('returns all false for null, undefined, or empty accounts', () => {
    const allFalse = {
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
      onboardingComplete: false,
    };
    expect(deriveStatuses(null)).toEqual(allFalse);
    expect(deriveStatuses(undefined)).toEqual(allFalse);
    expect(deriveStatuses({})).toEqual(allFalse);
  });
});
