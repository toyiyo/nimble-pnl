import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false }
}));

vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: {
    checkBiometry: vi.fn().mockResolvedValue({ isAvailable: false }),
    authenticate: vi.fn(),
  }
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn().mockResolvedValue({ value: null }),
    set: vi.fn(),
    remove: vi.fn(),
  }
}));

import { isBiometricSupported } from '@/hooks/useBiometricAuth';

describe('useBiometricAuth', () => {
  it('returns false when not native', () => {
    expect(isBiometricSupported(false, false)).toBe(false);
  });

  it('returns false when native but hardware unavailable', () => {
    expect(isBiometricSupported(true, false)).toBe(false);
  });

  it('returns true when native and hardware available', () => {
    expect(isBiometricSupported(true, true)).toBe(true);
  });
});
