import { describe, it, expect } from 'vitest';
import { localIso, localHms, localTimeFields } from '../../supabase/functions/_shared/restaurantDate';

const CHI = 'America/Chicago';

describe('localIso', () => {
  it('gives the Chicago wall clock with the winter offset', () => {
    expect(localIso('2026-12-05T23:00:00Z', CHI)).toBe('2026-12-05T17:00:00-06:00');
  });

  it('gives the summer offset in July', () => {
    expect(localIso('2026-07-05T22:00:00Z', CHI)).toBe('2026-07-05T17:00:00-05:00');
  });

  it('uses the offset of each instant on the fall-back day (2026-11-01)', () => {
    // 01:30 CDT, then 01:30 CST one hour later.
    expect(localIso('2026-11-01T06:30:00Z', CHI)).toBe('2026-11-01T01:30:00-05:00');
    expect(localIso('2026-11-01T07:30:00Z', CHI)).toBe('2026-11-01T01:30:00-06:00');
  });

  it('uses the offset of each instant on the spring-forward day (2027-03-14)', () => {
    expect(localIso('2027-03-14T07:59:00Z', CHI)).toBe('2027-03-14T01:59:00-06:00');
    expect(localIso('2027-03-14T08:00:00Z', CHI)).toBe('2027-03-14T03:00:00-05:00');
  });

  it('gives +00:00 for UTC', () => {
    expect(localIso('2026-12-05T23:00:00Z', 'UTC')).toBe('2026-12-05T23:00:00+00:00');
  });

  it('gives a positive offset east of UTC', () => {
    expect(localIso('2026-12-05T23:00:00Z', 'Asia/Kolkata')).toBe('2026-12-06T04:30:00+05:30');
  });
});

describe('localHms', () => {
  it('gives the local HH:MM:SS in the zone', () => {
    expect(localHms('2026-12-05T23:00:00Z', CHI)).toBe('17:00:00');
    expect(localHms('2026-07-05T22:00:00Z', CHI)).toBe('17:00:00');
  });
});

describe('localTimeFields', () => {
  it('gives both local times and the zone', () => {
    expect(localTimeFields('2026-12-05T23:00:00Z', '2026-12-06T05:00:00Z', CHI)).toEqual({
      start_time_local: '2026-12-05T17:00:00-06:00',
      end_time_local: '2026-12-05T23:00:00-06:00',
      tz: CHI,
    });
  });

  it('shows the fallback zone, not the invalid input, so the label agrees with the offset', () => {
    expect(localTimeFields('2026-12-05T23:00:00Z', '2026-12-06T05:00:00Z', 'Bad/Zone').tz).toBe(CHI);
  });
});
