import { describe, it, expect, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false }
}));

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    getCurrentPosition: vi.fn(),
  }
}));

import { evaluateGeofence } from '@/hooks/useGeofenceCheck';

describe('evaluateGeofence', () => {
  it('returns skip when enforcement is off', () => {
    const result = evaluateGeofence('off', null, null, 200, 40.7, -74.0);
    expect(result.action).toBe('allow');
    expect(result.checked).toBe(false);
  });

  it('returns skip when restaurant has no coordinates', () => {
    const result = evaluateGeofence('warn', null, null, 200, 40.7, -74.0);
    expect(result.action).toBe('allow');
    expect(result.checked).toBe(false);
  });

  it('returns allow when within radius', () => {
    const result = evaluateGeofence('warn', 40.7128, -74.006, 200, 40.7129, -74.0061);
    expect(result.action).toBe('allow');
    expect(result.within).toBe(true);
  });

  it('returns warn when outside radius with warn enforcement', () => {
    const result = evaluateGeofence('warn', 40.7128, -74.006, 200, 40.72, -74.006);
    expect(result.action).toBe('warn');
    expect(result.within).toBe(false);
  });

  it('returns block when outside radius with block enforcement', () => {
    const result = evaluateGeofence('block', 40.7128, -74.006, 200, 40.72, -74.006);
    expect(result.action).toBe('block');
    expect(result.within).toBe(false);
  });
});
