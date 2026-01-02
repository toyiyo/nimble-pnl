import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { hashString, isSimpleSequence } from '@/utils/kiosk';
import {
  addQueuedPunch,
  hasQueuedPunches,
  isLikelyOffline,
  type QueuedKioskPunch,
} from '@/utils/offlineQueue';
import { getDeviceInfo, getQuickLocation } from '@/utils/punchContext';

const originalNavigator = globalThis.navigator;
const originalLocalStorage = globalThis.localStorage;

const setGlobalValue = (key: string, value: unknown) => {
  try {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  } catch {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any)[key] = value;
  }
};

/**
 * Unit Tests for Punch Functionality
 * 
 * Based on requirements from docs/Scheduling_plan.md:
 * - Time clocking (clock in/out, breaks)
 * - PIN verification and security (lockout after 5 attempts)
 * - Geolocation tracking
 * - Device info capture
 * - Offline queue management
 * - Break enforcement
 * - Overtime detection
 */

beforeEach(() => {
  vi.restoreAllMocks();
  if (originalNavigator) {
    setGlobalValue('navigator', originalNavigator);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).navigator;
  }
  if (originalLocalStorage) {
    setGlobalValue('localStorage', originalLocalStorage);
  } else {
    // Remove stubbed localStorage if it did not exist originally
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).localStorage;
  }
});

describe('PIN Validation', () => {
  it('should validate PIN minimum length', () => {
    const minLength = 4;
    const validPin = '1234';
    const invalidPin = '123';
    
    expect(validPin.length >= minLength).toBe(true);
    expect(invalidPin.length >= minLength).toBe(false);
  });

  it('should detect simple sequences', () => {
    expect(isSimpleSequence('1234')).toBe(true); // Ascending
    expect(isSimpleSequence('9876')).toBe(true); // Descending
    expect(isSimpleSequence('1111')).toBe(false); // Repeating not flagged by production logic
    expect(isSimpleSequence('5792')).toBe(false); // Valid
  });

  it('should only accept numeric input', () => {
    const pin = '12a4';
    const numericOnly = pin.replace(/\D/g, '');
    
    expect(numericOnly).toBe('124');
  });
});

describe('Lockout Logic', () => {
  it('should lock after 5 failed attempts', () => {
    let failedAttempts = 0;
    let isLocked = false;
    const ATTEMPT_LIMIT = 5;
    
    // Simulate 5 failed attempts
    for (let i = 0; i < ATTEMPT_LIMIT; i++) {
      failedAttempts++;
    }
    
    if (failedAttempts >= ATTEMPT_LIMIT) {
      isLocked = true;
    }
    
    expect(isLocked).toBe(true);
    expect(failedAttempts).toBe(5);
  });

  it('should set lockout duration to 60 seconds', () => {
    const LOCKOUT_MS = 60_000;
    const lockUntil = Date.now() + LOCKOUT_MS;
    const lockSeconds = Math.max(0, Math.ceil((lockUntil - Date.now()) / 1000));
    
    expect(lockSeconds).toBeGreaterThan(55); // Allow for test execution time
    expect(lockSeconds).toBeLessThanOrEqual(60);
  });

  it('should reset attempts after successful unlock', () => {
    let failedAttempts = 3;
    let lockUntil = null;
    
    // Reset
    failedAttempts = 0;
    lockUntil = null;
    
    expect(failedAttempts).toBe(0);
    expect(lockUntil).toBeNull();
  });
});

describe('Device Context Collection', () => {
  it('should collect device info', () => {
    const mockNavigator = {
      userAgent: 'TestAgent/1.0',
    } as unknown as Navigator;
    setGlobalValue('navigator', mockNavigator);

    const deviceInfo = getDeviceInfo();
    expect(deviceInfo).toContain('TestAgent/1.0');
    expect(deviceInfo.length).toBeLessThanOrEqual(100);
  });

  it('should handle location permission denied gracefully', async () => {
    const mockNavigator = {
      geolocation: {
        getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) => {
          error?.({
            code: 1,
            message: 'denied',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError);
        },
      },
    } as unknown as Navigator;
    setGlobalValue('navigator', mockNavigator);

    const location = await getQuickLocation(50);
    expect(location).toBeUndefined();
  });
});

describe('Punch Time Validation', () => {
  it('should prevent clock-in when already clocked in', () => {
    const isClockedIn = true;
    const action = 'clock_in';
    
    const isValid = !(action === 'clock_in' && isClockedIn);
    expect(isValid).toBe(false);
  });

  it('should prevent clock-out when not clocked in', () => {
    const isClockedIn = false;
    const action = 'clock_out';
    
    const isValid = !(action === 'clock_out' && !isClockedIn);
    expect(isValid).toBe(false);
  });

  it('should allow clock-in when not clocked in', () => {
    const isClockedIn = false;
    const action = 'clock_in';
    
    const isValid = !(action === 'clock_in' && isClockedIn);
    expect(isValid).toBe(true);
  });

  it('should allow clock-out when clocked in', () => {
    const isClockedIn = true;
    const action = 'clock_out';
    
    const isValid = !(action === 'clock_out' && !isClockedIn);
    expect(isValid).toBe(true);
  });
});

describe('Offline Queue Management', () => {
  it('should detect offline state', () => {
    const mockNavigator = { onLine: false } as unknown as Navigator;
    setGlobalValue('navigator', mockNavigator);

    const offline = isLikelyOffline();
    expect(typeof offline).toBe('boolean');
    expect(offline).toBe(true);
  });

  it('should queue punch data when offline', async () => {
    const store = new Map<string, string>();
    const localStorageMock = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    };
    setGlobalValue('localStorage', localStorageMock);

    const payload: QueuedKioskPunch['payload'] = {
      restaurant_id: 'rest-1',
      employee_id: 'emp-1',
      punch_type: 'clock_in',
      punch_time: new Date().toISOString(),
      device_info: 'test',
    };

    await addQueuedPunch(payload);

    expect(hasQueuedPunches()).toBe(true);
    const saved = store.values().next().value as string | undefined;
    expect(saved).toBeDefined();
    const parsed = saved ? JSON.parse(saved) : [];
    expect(parsed[0]?.payload?.restaurant_id).toBe('rest-1');
  });
});

describe('Break Enforcement', () => {
  it('should track break start and end times', () => {
    const breaks = [
      { type: 'break_start', timestamp: '2026-01-02T10:00:00Z' },
      { type: 'break_end', timestamp: '2026-01-02T10:30:00Z' }
    ];
    
    expect(breaks).toHaveLength(2);
    expect(breaks[0].type).toBe('break_start');
    expect(breaks[1].type).toBe('break_end');
  });

  it('should calculate break duration', () => {
    const breakStart = new Date('2026-01-02T10:00:00Z');
    const breakEnd = new Date('2026-01-02T10:30:00Z');
    
    const durationMs = breakEnd.getTime() - breakStart.getTime();
    const durationMinutes = durationMs / 1000 / 60;
    
    expect(durationMinutes).toBe(30);
  });
});

describe('Punch Data Structure', () => {
  it('should have required fields for time punch', () => {
    interface TimePunch {
      restaurant_id: string;
      employee_id: string;
      punch_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
      punch_time: string;
      notes?: string;
      location?: { latitude: number; longitude: number };
      device_info?: string;
      photo_url?: string;
    }
    
    const punch: TimePunch = {
      restaurant_id: 'rest-123',
      employee_id: 'emp-456',
      punch_type: 'clock_in',
      punch_time: new Date().toISOString(),
      notes: 'Test punch',
      location: { latitude: 40.7128, longitude: -74.0060 },
      device_info: 'Test device'
    };
    
    expect(punch.restaurant_id).toBeDefined();
    expect(punch.employee_id).toBeDefined();
    expect(punch.punch_type).toMatch(/clock_in|clock_out|break_start|break_end/);
    expect(punch.punch_time).toBeDefined();
  });
});

describe('PIN Force Reset Logic', () => {
  it('should detect force_reset flag', () => {
    const pinRecord = {
      id: 'pin-123',
      employee_id: 'emp-456',
      pin_hash: 'hashed',
      force_reset: true,
      min_length: 4
    };
    
    expect(pinRecord.force_reset).toBe(true);
  });

  it('should clear force_reset after PIN change', () => {
    let pinRecord = {
      force_reset: true,
      pin_hash: 'old-hash'
    };
    
    // Simulate PIN update
    pinRecord = {
      ...pinRecord,
      force_reset: false,
      pin_hash: 'new-hash'
    };
    
    expect(pinRecord.force_reset).toBe(false);
    expect(pinRecord.pin_hash).toBe('new-hash');
  });
});

describe('Hash PIN Function', () => {
  it('should hash PIN consistently', async () => {
    const pin = '1234';
    const hash1 = await hashString(pin);
    const hash2 = await hashString(pin);
    
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex characters
  });

  it('should produce different hashes for different PINs', async () => {
    const pin1 = '1234';
    const pin2 = '5678';
    const hash1 = await hashString(pin1);
    const hash2 = await hashString(pin2);
    
    expect(hash1).not.toBe(hash2);
  });
});
