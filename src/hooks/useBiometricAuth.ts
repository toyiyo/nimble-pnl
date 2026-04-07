import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { Preferences } from '@capacitor/preferences';

const BIOMETRIC_ENABLED_KEY = 'biometric_auth_enabled';
const MAX_ATTEMPTS = 3;

/** Testable helper */
export function isBiometricSupported(isNative: boolean, hardwareAvailable: boolean): boolean {
  return isNative && hardwareAvailable;
}

export function useBiometricAuth() {
  const isNative = Capacitor.isNativePlatform();
  const [isAvailable, setIsAvailable] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);

  useEffect(() => {
    if (!isNative) return;
    BiometricAuth.checkBiometry().then(({ isAvailable: available }) => {
      setIsAvailable(available);
    });
    Preferences.get({ key: BIOMETRIC_ENABLED_KEY }).then(({ value }) => {
      setIsEnabled(value === 'true');
    });
  }, [isNative]);

  const enable = useCallback(async () => {
    await Preferences.set({ key: BIOMETRIC_ENABLED_KEY, value: 'true' });
    setIsEnabled(true);
  }, []);

  const disable = useCallback(async () => {
    await Preferences.remove({ key: BIOMETRIC_ENABLED_KEY });
    setIsEnabled(false);
  }, []);

  const authenticate = useCallback(async (): Promise<boolean> => {
    try {
      await BiometricAuth.authenticate({ reason: 'Verify your identity' });
      setIsLocked(false);
      setFailedAttempts(0);
      return true;
    } catch {
      let shouldSignOut = false;
      setFailedAttempts(prev => {
        const next = prev + 1;
        if (next >= MAX_ATTEMPTS) shouldSignOut = true;
        return next;
      });
      return false;
    }
  }, []);

  const lock = useCallback(() => setIsLocked(true), []);
  const shouldSignOut = failedAttempts >= MAX_ATTEMPTS;

  return {
    isAvailable: isBiometricSupported(isNative, isAvailable),
    isEnabled,
    isLocked,
    shouldSignOut,
    failedAttempts,
    enable,
    disable,
    authenticate,
    lock,
  };
}
