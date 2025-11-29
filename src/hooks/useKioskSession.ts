import { useEffect, useState } from 'react';
import { KioskSessionToken } from '@/types/timeTracking';
import { hashString, KIOSK_SESSION_KEY, loadFromStorage, saveToStorage } from '@/utils/kiosk';

type StartSessionOptions = {
  requireManagerPin?: boolean;
  minLength?: number;
};

const createInstanceId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `kiosk-${Math.random().toString(36).slice(2)}`;
};

export const useKioskSession = () => {
  const [session, setSession] = useState<KioskSessionToken | null>(() =>
    loadFromStorage<KioskSessionToken>(KIOSK_SESSION_KEY)
  );

  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === KIOSK_SESSION_KEY) {
        setSession(event.newValue ? (JSON.parse(event.newValue) as KioskSessionToken) : null);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const startSession = async (
    locationId: string,
    managerId: string,
    options?: StartSessionOptions
  ) => {
    const token: KioskSessionToken = {
      location_id: locationId,
      kiosk_instance_id: createInstanceId(),
      manager_id_hash: await hashString(managerId),
      kiosk_mode: true,
      started_at: new Date().toISOString(),
      require_manager_pin: options?.requireManagerPin ?? true,
      min_length: options?.minLength ?? 4,
    };

    saveToStorage(KIOSK_SESSION_KEY, token);
    setSession(token);
    return token;
  };

  const refreshSession = (updates: Partial<KioskSessionToken>) => {
    if (!session) return null;
    const updated = { ...session, ...updates };
    saveToStorage(KIOSK_SESSION_KEY, updated);
    setSession(updated);
    return updated;
  };

  const endSession = () => {
    saveToStorage(KIOSK_SESSION_KEY, null);
    setSession(null);
  };

  return {
    session,
    isLocked: !!session?.kiosk_mode,
    startSession,
    endSession,
    refreshSession,
  };
};
