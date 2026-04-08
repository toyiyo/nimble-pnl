import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let _isNative = false;

const mockGetCurrentPosition = vi.fn();

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => _isNative,
  },
}));

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    getCurrentPosition: (...args: unknown[]) => mockGetCurrentPosition(...args),
  },
}));

import { evaluateGeofence, useGeofenceCheck } from '@/hooks/useGeofenceCheck';

// ---------------------------------------------------------------------------
// Pure evaluateGeofence helper
// ---------------------------------------------------------------------------
describe('evaluateGeofence (pure helper)', () => {
  it('returns allow/unchecked when enforcement is off', () => {
    const result = evaluateGeofence('off', null, null, 200, 40.7, -74.0);
    expect(result.action).toBe('allow');
    expect(result.checked).toBe(false);
  });

  it('returns allow/unchecked when restaurant coordinates are null', () => {
    const result = evaluateGeofence('warn', null, null, 200, 40.7, -74.0);
    expect(result.action).toBe('allow');
    expect(result.checked).toBe(false);
  });

  it('returns allow when within radius', () => {
    const result = evaluateGeofence('warn', 40.7128, -74.006, 200, 40.7129, -74.0061);
    expect(result.action).toBe('allow');
    expect(result.within).toBe(true);
    expect(result.checked).toBe(true);
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

  it('includes distanceMeters and userLat/userLng in result', () => {
    const result = evaluateGeofence('warn', 40.7128, -74.006, 200, 40.7129, -74.0061);
    expect(typeof result.distanceMeters).toBe('number');
    expect(result.userLat).toBe(40.7129);
    expect(result.userLng).toBe(-74.0061);
  });
});

// ---------------------------------------------------------------------------
// useGeofenceCheck hook – initial state
// ---------------------------------------------------------------------------
describe('useGeofenceCheck hook – initial state', () => {
  beforeEach(() => {
    _isNative = false;
    vi.clearAllMocks();
  });

  it('returns checkLocation function and checking=false initially', () => {
    const { result } = renderHook(() => useGeofenceCheck(null));
    expect(typeof result.current.checkLocation).toBe('function');
    expect(result.current.checking).toBe(false);
  });

  it('returns checking=false initially even with a restaurant', () => {
    const restaurant = {
      latitude: 40.7128,
      longitude: -74.006,
      geofence_radius_meters: 200,
      geofence_enforcement: 'warn' as const,
    };
    const { result } = renderHook(() => useGeofenceCheck(restaurant));
    expect(result.current.checking).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useGeofenceCheck hook – checkLocation() with enforcement='off'
// ---------------------------------------------------------------------------
describe('useGeofenceCheck hook – checkLocation enforcement=off', () => {
  beforeEach(() => {
    _isNative = false;
    vi.clearAllMocks();
  });

  it('returns allow immediately when restaurant is null', async () => {
    const { result } = renderHook(() => useGeofenceCheck(null));
    let geofenceResult: Awaited<ReturnType<typeof result.current.checkLocation>> | undefined;
    await act(async () => {
      geofenceResult = await result.current.checkLocation();
    });
    expect(geofenceResult?.action).toBe('allow');
    expect(geofenceResult?.checked).toBe(false);
  });

  it('returns allow immediately when enforcement is off', async () => {
    const restaurant = {
      latitude: 40.7128,
      longitude: -74.006,
      geofence_radius_meters: 200,
      geofence_enforcement: 'off' as const,
    };
    const { result } = renderHook(() => useGeofenceCheck(restaurant));
    let geofenceResult: Awaited<ReturnType<typeof result.current.checkLocation>> | undefined;
    await act(async () => {
      geofenceResult = await result.current.checkLocation();
    });
    expect(geofenceResult?.action).toBe('allow');
    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
  });

  it('returns allow immediately when restaurant coords are null', async () => {
    const restaurant = {
      latitude: null,
      longitude: null,
      geofence_radius_meters: 200,
      geofence_enforcement: 'warn' as const,
    };
    const { result } = renderHook(() => useGeofenceCheck(restaurant));
    let geofenceResult: Awaited<ReturnType<typeof result.current.checkLocation>> | undefined;
    await act(async () => {
      geofenceResult = await result.current.checkLocation();
    });
    expect(geofenceResult?.action).toBe('allow');
    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useGeofenceCheck hook – web geolocation path
// ---------------------------------------------------------------------------
describe('useGeofenceCheck hook – web geolocation', () => {
  beforeEach(() => {
    _isNative = false;
    vi.clearAllMocks();

    // Mock navigator.geolocation
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        geolocation: {
          getCurrentPosition: vi.fn(),
        },
      },
    });
  });

  it('uses navigator.geolocation on web (not Capacitor plugin)', async () => {
    const mockNavGeo = vi.fn().mockImplementation((resolve) => {
      resolve({ coords: { latitude: 40.7129, longitude: -74.0061 } });
    });
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: mockNavGeo },
    });

    const restaurant = {
      latitude: 40.7128,
      longitude: -74.006,
      geofence_radius_meters: 500,
      geofence_enforcement: 'warn' as const,
    };

    const { result } = renderHook(() => useGeofenceCheck(restaurant));
    let geofenceResult: Awaited<ReturnType<typeof result.current.checkLocation>> | undefined;

    await act(async () => {
      geofenceResult = await result.current.checkLocation();
    });

    expect(mockGetCurrentPosition).not.toHaveBeenCalled();
    expect(mockNavGeo).toHaveBeenCalled();
    expect(geofenceResult?.action).toBe('allow');
    expect(geofenceResult?.checked).toBe(true);
  });

  it('returns allow/unchecked when geolocation throws', async () => {
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn().mockImplementation((_res, reject) => {
          reject(new Error('permission denied'));
        }),
      },
    });

    const restaurant = {
      latitude: 40.7128,
      longitude: -74.006,
      geofence_radius_meters: 200,
      geofence_enforcement: 'warn' as const,
    };

    const { result } = renderHook(() => useGeofenceCheck(restaurant));
    let geofenceResult: Awaited<ReturnType<typeof result.current.checkLocation>> | undefined;

    await act(async () => {
      geofenceResult = await result.current.checkLocation();
    });

    expect(geofenceResult?.action).toBe('allow');
    expect(geofenceResult?.checked).toBe(false);
    expect(result.current.checking).toBe(false);
    expect(geofenceResult?.locationUnavailable).toBe(true);
  });

  it('returns locationUnavailable=true when geolocation throws and enforcement is warn', async () => {
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn().mockImplementation((_res, reject) => {
          reject(new Error('permission denied'));
        }),
      },
    });

    const restaurant = {
      latitude: 40.7128,
      longitude: -74.006,
      geofence_radius_meters: 200,
      geofence_enforcement: 'warn' as const,
    };

    const { result } = renderHook(() => useGeofenceCheck(restaurant));
    let geofenceResult: Awaited<ReturnType<typeof result.current.checkLocation>> | undefined;

    await act(async () => {
      geofenceResult = await result.current.checkLocation();
    });

    expect(geofenceResult?.action).toBe('allow');
    expect(geofenceResult?.checked).toBe(false);
    expect(geofenceResult?.locationUnavailable).toBe(true);
  });

  it('returns locationUnavailable=true when geolocation throws and enforcement is block', async () => {
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn().mockImplementation((_res, reject) => {
          reject(new Error('location services disabled'));
        }),
      },
    });

    const restaurant = {
      latitude: 40.7128,
      longitude: -74.006,
      geofence_radius_meters: 200,
      geofence_enforcement: 'block' as const,
    };

    const { result } = renderHook(() => useGeofenceCheck(restaurant));
    let geofenceResult: Awaited<ReturnType<typeof result.current.checkLocation>> | undefined;

    await act(async () => {
      geofenceResult = await result.current.checkLocation();
    });

    expect(geofenceResult?.action).toBe('allow');
    expect(geofenceResult?.checked).toBe(false);
    expect(geofenceResult?.locationUnavailable).toBe(true);
  });

  it('does NOT set locationUnavailable when enforcement is off', async () => {
    const restaurant = {
      latitude: 40.7128,
      longitude: -74.006,
      geofence_radius_meters: 200,
      geofence_enforcement: 'off' as const,
    };

    const { result } = renderHook(() => useGeofenceCheck(restaurant));
    let geofenceResult: Awaited<ReturnType<typeof result.current.checkLocation>> | undefined;

    await act(async () => {
      geofenceResult = await result.current.checkLocation();
    });

    expect(geofenceResult?.locationUnavailable).toBeUndefined();
  });

  it('does NOT set locationUnavailable when geolocation succeeds', async () => {
    Object.defineProperty(globalThis.navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn().mockImplementation((resolve) => {
          resolve({ coords: { latitude: 40.7129, longitude: -74.0061 } });
        }),
      },
    });

    const restaurant = {
      latitude: 40.7128,
      longitude: -74.006,
      geofence_radius_meters: 500,
      geofence_enforcement: 'warn' as const,
    };

    const { result } = renderHook(() => useGeofenceCheck(restaurant));
    let geofenceResult: Awaited<ReturnType<typeof result.current.checkLocation>> | undefined;

    await act(async () => {
      geofenceResult = await result.current.checkLocation();
    });

    expect(geofenceResult?.locationUnavailable).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// useGeofenceCheck hook – native Capacitor path
// ---------------------------------------------------------------------------
describe('useGeofenceCheck hook – native Capacitor geolocation', () => {
  beforeEach(() => {
    _isNative = true;
    vi.clearAllMocks();
  });

  it('uses Capacitor Geolocation on native', async () => {
    mockGetCurrentPosition.mockResolvedValue({
      coords: { latitude: 40.7129, longitude: -74.0061 },
    });

    const restaurant = {
      latitude: 40.7128,
      longitude: -74.006,
      geofence_radius_meters: 500,
      geofence_enforcement: 'warn' as const,
    };

    const { result } = renderHook(() => useGeofenceCheck(restaurant));
    let geofenceResult: Awaited<ReturnType<typeof result.current.checkLocation>> | undefined;

    await act(async () => {
      geofenceResult = await result.current.checkLocation();
    });

    expect(mockGetCurrentPosition).toHaveBeenCalled();
    expect(geofenceResult?.checked).toBe(true);
  });
});
