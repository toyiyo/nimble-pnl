import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mergePunchLocation,
  getDeviceInfo,
  collectPunchContext,
  startPunchContext,
  _resetPunchContextForTests,
} from '@/utils/punchContext';

describe('mergePunchLocation', () => {
  it('returns undefined when base location is undefined', () => {
    expect(mergePunchLocation(undefined)).toBeUndefined();
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
});
