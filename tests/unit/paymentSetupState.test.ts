import { describe, it, expect } from 'vitest';
import { getPaymentSetupState } from '@/lib/paymentSetupState';

describe('getPaymentSetupState', () => {
  it('returns not_started for null', () => {
    expect(getPaymentSetupState(null)).toBe('not_started');
  });

  it('returns not_started for undefined', () => {
    expect(getPaymentSetupState(undefined)).toBe('not_started');
  });

  it('returns ready when charges are enabled and onboarding is complete', () => {
    expect(
      getPaymentSetupState({ charges_enabled: true, onboarding_complete: true }),
    ).toBe('ready');
  });

  it('returns pending when charges are not enabled', () => {
    expect(
      getPaymentSetupState({ charges_enabled: false, onboarding_complete: true }),
    ).toBe('pending');
  });

  it('returns pending when onboarding is not complete', () => {
    expect(
      getPaymentSetupState({ charges_enabled: true, onboarding_complete: false }),
    ).toBe('pending');
  });

  it('returns pending when both flags are false', () => {
    expect(
      getPaymentSetupState({ charges_enabled: false, onboarding_complete: false }),
    ).toBe('pending');
  });
});
