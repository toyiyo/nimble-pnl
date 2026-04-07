import { describe, it, expect } from 'vitest';
import { haversineDistance, isWithinRadius } from '@/lib/haversine';

describe('haversineDistance', () => {
  it('returns 0 for identical coordinates', () => {
    expect(haversineDistance(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it('calculates distance between NYC and LA (~3944 km)', () => {
    const distance = haversineDistance(40.7128, -74.006, 34.0522, -118.2437);
    expect(distance).toBeGreaterThan(3900000);
    expect(distance).toBeLessThan(4000000);
  });

  it('calculates short distance (~111 m for 0.001 degree latitude)', () => {
    const distance = haversineDistance(40.0, -74.0, 40.001, -74.0);
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(120);
  });
});

describe('isWithinRadius', () => {
  it('returns true when within radius', () => {
    expect(isWithinRadius(40.7128, -74.006, 40.7129, -74.0061, 200)).toBe(true);
  });

  it('returns false when outside radius', () => {
    expect(isWithinRadius(40.7128, -74.006, 40.72, -74.006, 200)).toBe(false);
  });
});
