import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// --- mocks must be declared before any import of the module under test ---

const mockCheckBiometry = vi.fn();
const mockAuthenticate = vi.fn();
const mockPreferencesGet = vi.fn();
const mockPreferencesSet = vi.fn();
const mockPreferencesRemove = vi.fn();
let _isNative = false;

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => _isNative,
  },
}));

vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: {
    checkBiometry: (...args: unknown[]) => mockCheckBiometry(...args),
    authenticate: (...args: unknown[]) => mockAuthenticate(...args),
  },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: (...args: unknown[]) => mockPreferencesGet(...args),
    set: (...args: unknown[]) => mockPreferencesSet(...args),
    remove: (...args: unknown[]) => mockPreferencesRemove(...args),
  },
}));

import { isBiometricSupported, useBiometricAuth } from '@/hooks/useBiometricAuth';

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------
describe('isBiometricSupported (pure helper)', () => {
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

// ---------------------------------------------------------------------------
// Hook tests – web platform (isNativePlatform = false)
// ---------------------------------------------------------------------------
describe('useBiometricAuth hook – web platform', () => {
  beforeEach(() => {
    _isNative = false;
    vi.clearAllMocks();
    mockPreferencesGet.mockResolvedValue({ value: null });
    mockCheckBiometry.mockResolvedValue({ isAvailable: false });
  });

  it('initial state: isAvailable=false, isEnabled=false, isLocked=false, failedAttempts=0', () => {
    const { result } = renderHook(() => useBiometricAuth());
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.isEnabled).toBe(false);
    expect(result.current.isLocked).toBe(false);
    expect(result.current.failedAttempts).toBe(0);
    expect(result.current.shouldSignOut).toBe(false);
  });

  it('does NOT call BiometricAuth.checkBiometry on web', async () => {
    renderHook(() => useBiometricAuth());
    await waitFor(() => {
      expect(mockCheckBiometry).not.toHaveBeenCalled();
    });
  });

  it('does NOT call Preferences.get on web', async () => {
    renderHook(() => useBiometricAuth());
    await waitFor(() => {
      expect(mockPreferencesGet).not.toHaveBeenCalled();
    });
  });

  it('enable() calls Preferences.set with the right key/value', async () => {
    mockPreferencesSet.mockResolvedValue(undefined);
    const { result } = renderHook(() => useBiometricAuth());

    await act(async () => {
      await result.current.enable();
    });

    expect(mockPreferencesSet).toHaveBeenCalledWith({
      key: 'biometric_auth_enabled',
      value: 'true',
    });
    expect(result.current.isEnabled).toBe(true);
  });

  it('disable() calls Preferences.remove with the right key', async () => {
    mockPreferencesRemove.mockResolvedValue(undefined);
    const { result } = renderHook(() => useBiometricAuth());

    await act(async () => {
      await result.current.disable();
    });

    expect(mockPreferencesRemove).toHaveBeenCalledWith({
      key: 'biometric_auth_enabled',
    });
    expect(result.current.isEnabled).toBe(false);
  });

  it('authenticate() returns true when BiometricAuth.authenticate resolves', async () => {
    mockAuthenticate.mockResolvedValue(undefined);
    const { result } = renderHook(() => useBiometricAuth());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.authenticate();
    });

    expect(success).toBe(true);
    expect(result.current.failedAttempts).toBe(0);
    expect(result.current.isLocked).toBe(false);
  });

  it('authenticate() returns false when BiometricAuth.authenticate rejects', async () => {
    mockAuthenticate.mockRejectedValue(new Error('biometric failed'));
    const { result } = renderHook(() => useBiometricAuth());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.authenticate();
    });

    expect(success).toBe(false);
    expect(result.current.failedAttempts).toBe(1);
  });

  it('shouldSignOut becomes true after MAX_ATTEMPTS (3) failures', async () => {
    mockAuthenticate.mockRejectedValue(new Error('fail'));
    const { result } = renderHook(() => useBiometricAuth());

    await act(async () => { await result.current.authenticate(); });
    await act(async () => { await result.current.authenticate(); });
    expect(result.current.shouldSignOut).toBe(false);

    await act(async () => { await result.current.authenticate(); });
    expect(result.current.failedAttempts).toBe(3);
    expect(result.current.shouldSignOut).toBe(true);
  });

  it('authenticate() resets failedAttempts to 0 on success', async () => {
    mockAuthenticate
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useBiometricAuth());

    await act(async () => { await result.current.authenticate(); });
    expect(result.current.failedAttempts).toBe(1);

    await act(async () => { await result.current.authenticate(); });
    expect(result.current.failedAttempts).toBe(0);
    expect(result.current.shouldSignOut).toBe(false);
  });

  it('lock() sets isLocked to true', async () => {
    const { result } = renderHook(() => useBiometricAuth());
    expect(result.current.isLocked).toBe(false);

    act(() => {
      result.current.lock();
    });

    expect(result.current.isLocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hook tests – native platform (isNativePlatform = true)
// ---------------------------------------------------------------------------
describe('useBiometricAuth hook – native platform', () => {
  beforeEach(() => {
    _isNative = true;
    vi.clearAllMocks();
    mockPreferencesGet.mockResolvedValue({ value: null });
    mockCheckBiometry.mockResolvedValue({ isAvailable: true });
    mockPreferencesSet.mockResolvedValue(undefined);
    mockPreferencesRemove.mockResolvedValue(undefined);
  });

  it('calls BiometricAuth.checkBiometry on mount', async () => {
    renderHook(() => useBiometricAuth());
    await waitFor(() => {
      expect(mockCheckBiometry).toHaveBeenCalledTimes(1);
    });
  });

  it('calls Preferences.get on mount to read stored biometric preference', async () => {
    renderHook(() => useBiometricAuth());
    await waitFor(() => {
      expect(mockPreferencesGet).toHaveBeenCalledWith({ key: 'biometric_auth_enabled' });
    });
  });

  it('isAvailable becomes true when hardware is available on native', async () => {
    mockCheckBiometry.mockResolvedValue({ isAvailable: true });
    const { result } = renderHook(() => useBiometricAuth());

    await waitFor(() => {
      expect(result.current.isAvailable).toBe(true);
    });
  });

  it('isEnabled becomes true when Preferences.get returns "true"', async () => {
    mockPreferencesGet.mockResolvedValue({ value: 'true' });
    const { result } = renderHook(() => useBiometricAuth());

    await waitFor(() => {
      expect(result.current.isEnabled).toBe(true);
    });
  });

  it('isEnabled stays false when Preferences.get returns null', async () => {
    mockPreferencesGet.mockResolvedValue({ value: null });
    const { result } = renderHook(() => useBiometricAuth());

    await waitFor(() => {
      expect(mockPreferencesGet).toHaveBeenCalled();
    });
    expect(result.current.isEnabled).toBe(false);
  });
});
