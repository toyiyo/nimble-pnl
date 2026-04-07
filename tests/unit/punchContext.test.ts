import { describe, it, expect, vi } from 'vitest';
import { mergePunchLocation, getDeviceInfo, collectPunchContext } from '@/utils/punchContext';

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
