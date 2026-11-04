import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mergePunchLocation,
  punchContextLocation,
  getDeviceInfo,
  collectPunchContext,
  startPunchContext,
  _resetPunchContextForTests,
} from '@/utils/punchContext';

describe('mergePunchLocation', () => {
  it('returns undefined when base location is undefined', () => {
    expect(mergePunchLocation(undefined)).toBeUndefined();
  });

  it('returns undefined for geofence data with no base location and no flag', () => {
    // The server deletes a client distance, so a distance alone is not a position.
    const result = mergePunchLocation(undefined, { distanceMeters: 500, within: false });
    expect(result).toBeUndefined();
  });

  it('returns base location without geofence when no result provided', () => {
    const result = mergePunchLocation({ latitude: 40.7, longitude: -74.0 });
    expect(result).toEqual({ latitude: 40.7, longitude: -74.0 });
  });

  it('merges geofence data into location', () => {
    const result = mergePunchLocation(
      { latitude: 40.7, longitude: -74.0 },
      { distanceMeters: 50, within: true }
    );
    expect(result).toEqual({
      latitude: 40.7,
      longitude: -74.0,
      distance_meters: 50,
      within_geofence: true,
    });
  });

  it('skips geofence data when distanceMeters is null/undefined', () => {
    const result = mergePunchLocation(
      { latitude: 40.7, longitude: -74.0 },
      { distanceMeters: undefined, within: undefined }
    );
    expect(result).toEqual({ latitude: 40.7, longitude: -74.0 });
  });

  it('includes within_geofence: false when within is false', () => {
    const result = mergePunchLocation(
      { latitude: 51.5, longitude: -0.1 },
      { distanceMeters: 500, within: false }
    );
    expect(result).toEqual({
      latitude: 51.5,
      longitude: -0.1,
      distance_meters: 500,
      within_geofence: false,
    });
  });

  it('preserves exact coordinate values', () => {
    const result = mergePunchLocation({ latitude: 0, longitude: 0 });
    expect(result?.latitude).toBe(0);
    expect(result?.longitude).toBe(0);
  });

  it('returns location_unavailable when locationUnavailable flag is set', () => {
    const result = mergePunchLocation(undefined, undefined, true);
    expect(result).toEqual({ location_unavailable: true });
  });

  it('includes location_unavailable alongside coordinates when both exist', () => {
    const result = mergePunchLocation(
      { latitude: 40.7, longitude: -74.0 },
      undefined,
      true
    );
    expect(result).toEqual({
      latitude: 40.7,
      longitude: -74.0,
      location_unavailable: true,
    });
  });

  it('does not include location_unavailable when flag is false', () => {
    const result = mergePunchLocation(
      { latitude: 40.7, longitude: -74.0 },
      { distanceMeters: 50, within: true },
      false
    );
    expect(result).toEqual({
      latitude: 40.7,
      longitude: -74.0,
      distance_meters: 50,
      within_geofence: true,
    });
    expect(result).not.toHaveProperty('location_unavailable');
  });
});

describe('punchContextLocation', () => {
  it('returns the coordinates when the GPS read succeeds', () => {
    const result = punchContextLocation({
      location: { latitude: 40.7, longitude: -74.0 },
      device_info: 'agent',
    });
    expect(result).toEqual({ latitude: 40.7, longitude: -74.0 });
    expect(result).not.toHaveProperty('location_unavailable');
  });

  it('sets location_unavailable when the GPS read fails or times out', () => {
    const result = punchContextLocation({ location: undefined, device_info: 'agent' });
    expect(result).toEqual({ location_unavailable: true });
  });

  it('sets location_unavailable when no context arrives in time', () => {
    expect(punchContextLocation(undefined)).toEqual({ location_unavailable: true });
    expect(punchContextLocation(null)).toEqual({ location_unavailable: true });
  });

  it('merges the geofence result with the coordinates', () => {
    const result = punchContextLocation(
      { location: { latitude: 51.5, longitude: -0.1 }, device_info: 'agent' },
      { distanceMeters: 500, within: false }
    );
    expect(result).toEqual({
      latitude: 51.5,
      longitude: -0.1,
      distance_meters: 500,
      within_geofence: false,
    });
  });

  it('sets location_unavailable for a geofence distance with no coordinates', () => {
    // The trigger deletes distance_meters and within_geofence, so without
    // coordinates the stored punch has no position.
    const result = punchContextLocation(
      { location: undefined, device_info: 'agent' },
      { distanceMeters: 50, within: true }
    );
    expect(result).toEqual({
      distance_meters: 50,
      within_geofence: true,
      location_unavailable: true,
    });
  });

  it('sends the geofence coordinates when the quick read fails', () => {
    const result = punchContextLocation(
      { location: undefined, device_info: 'agent' },
      { distanceMeters: 1500, within: false, latitude: 30.28, longitude: -97.74 }
    );
    expect(result).toEqual({
      latitude: 30.28,
      longitude: -97.74,
      distance_meters: 1500,
      within_geofence: false,
    });
    expect(result).not.toHaveProperty('location_unavailable');
  });

  it('prefers the quick-read coordinates over the geofence coordinates', () => {
    const result = punchContextLocation(
      { location: { latitude: 40.7, longitude: -74.0 }, device_info: 'agent' },
      { distanceMeters: 20, within: true, latitude: 40.6, longitude: -73.9 }
    );
    expect(result).toEqual({
      latitude: 40.7,
      longitude: -74.0,
      distance_meters: 20,
      within_geofence: true,
    });
  });

  it('ignores geofence coordinates that are not finite numbers', () => {
    const result = punchContextLocation(null, {
      distanceMeters: 50,
      within: true,
      latitude: Number.NaN,
      longitude: -97.74,
    });
    expect(result).toEqual({
      distance_meters: 50,
      within_geofence: true,
      location_unavailable: true,
    });
    expect(result).not.toHaveProperty('latitude');
  });

  it('sets location_unavailable when the geofence check reports no position', () => {
    const result = punchContextLocation(
      { location: { latitude: 40.7, longitude: -74.0 }, device_info: 'agent' },
      undefined,
      true
    );
    expect(result).toEqual({
      latitude: 40.7,
      longitude: -74.0,
      location_unavailable: true,
    });
  });
});

describe('getDeviceInfo', () => {
  it('returns a string', () => {
    const info = getDeviceInfo();
    expect(typeof info).toBe('string');
  });

  it('truncates to maxLength', () => {
    const info = getDeviceInfo(10);
    expect(info.length).toBeLessThanOrEqual(10);
  });

  it('returns full user agent up to default length', () => {
    const info = getDeviceInfo();
    expect(info.length).toBeLessThanOrEqual(100);
  });
});

describe('collectPunchContext', () => {
  it('returns an object with location and device_info keys', async () => {
    // geolocation is not available in jsdom, so location will be undefined
    const ctx = await collectPunchContext(50);
    expect(ctx).toHaveProperty('device_info');
    expect(ctx).toHaveProperty('location');
  });

  it('device_info is a string', async () => {
    const ctx = await collectPunchContext(50);
    expect(typeof ctx.device_info).toBe('string');
  });

  it('resolves to a location_unavailable punch location when the GPS read fails', async () => {
    _resetPunchContextForTests();
    const getCurrentPosition = vi.fn((_success: PositionCallback, error?: PositionErrorCallback) => {
      error?.({ code: 1, message: 'denied' } as GeolocationPositionError);
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    const ctx = await collectPunchContext(50);

    expect(ctx.location).toBeUndefined();
    expect(punchContextLocation(ctx)).toEqual({ location_unavailable: true });
  });
});

describe('startPunchContext', () => {
  beforeEach(() => {
    _resetPunchContextForTests();
  });

  afterEach(() => {
    _resetPunchContextForTests();
    vi.restoreAllMocks();
  });

  it('starts geolocation immediately and returns a shared promise across calls', () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, _error?: PositionErrorCallback) => {
      // Never resolve — we only want to know it was scheduled.
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    const p1 = startPunchContext(3000);
    const p2 = startPunchContext(3000);

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(p1).toBe(p2);
  });

  it('collectPunchContext reuses the in-flight start (no duplicate geolocation request)', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      // Resolve synchronously with a fake fix.
      success({
        coords: {
          latitude: 1,
          longitude: 2,
          accuracy: 5,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      } as GeolocationPosition);
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    void startPunchContext(3000);
    const ctx = await collectPunchContext(3000);

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(ctx.location).toEqual({ latitude: 1, longitude: 2 });
  });

  it('starts a new GPS read for the next punch flow after a failed read', async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, error?: PositionErrorCallback) => {
      error?.({ code: 3, message: 'timeout' } as GeolocationPositionError);
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    const first = await startPunchContext(3000);
    expect(first.location).toBeUndefined();

    // A cached failure would flag the next employee's punch without a new read.
    await startPunchContext(3000);

    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
  });

  it('collectPunchContext reuses a failed read of the same punch flow', async () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, error?: PositionErrorCallback) => {
      error?.({ code: 3, message: 'timeout' } as GeolocationPositionError);
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    await startPunchContext(3000);
    const ctx = await collectPunchContext(3000);

    expect(ctx.location).toBeUndefined();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });

  it('resolves with no location when getCurrentPosition throws', async () => {
    const getCurrentPosition = vi.fn(() => {
      throw new Error('geolocation blocked');
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    const ctx = await collectPunchContext(3000);

    expect(ctx.location).toBeUndefined();
    expect(punchContextLocation(ctx)).toEqual({ location_unavailable: true });
  });

  it('does not cache a rejection when the geolocation getter throws', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      get() {
        throw new Error('geolocation getter blocked');
      },
    });

    const first = await startPunchContext(3000);
    const second = await collectPunchContext(3000);

    expect(first.location).toBeUndefined();
    expect(second.location).toBeUndefined();
  });

  it('returns a fresh promise after _resetPunchContextForTests', () => {
    const getCurrentPosition = vi.fn();
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });

    const p1 = startPunchContext(3000);
    _resetPunchContextForTests();
    const p2 = startPunchContext(3000);

    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(p1).not.toBe(p2);
  });

  it('clears the cached promise ~10s after the original fix resolves so the next shift gets a fresh position', async () => {
    vi.useFakeTimers();
    try {
      const getCurrentPosition = vi.fn((success: PositionCallback) => {
        success({
          coords: {
            latitude: 10,
            longitude: 20,
            accuracy: 5,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        } as GeolocationPosition);
      });
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition },
      });

      const first = startPunchContext(3000);
      await vi.runOnlyPendingTimersAsync();
      await first;

      // The reset timer is armed in `.finally()`; advance past the reuse
      // window so the inFlight cache is cleared.
      await vi.advanceTimersByTimeAsync(11_000);

      // Next call must start a fresh getCurrentPosition.
      const second = startPunchContext(3000);
      await vi.runOnlyPendingTimersAsync();
      await second;

      expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
