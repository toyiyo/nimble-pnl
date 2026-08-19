import { describe, it, expect } from 'vitest';
import { isPublishingRestaurant, publishWindowStart } from '@/lib/schedulePublisher';

const NY = 'America/New_York';
const NOW = new Date('2026-08-19T16:00:00Z');

describe('publishWindowStart', () => {
  it('returns 8 days before the current week start', () => {
    expect(publishWindowStart(NOW, NY)).toBe('2026-08-09');
  });
});

describe('isPublishingRestaurant', () => {
  it('returns false for an empty list', () => {
    expect(isPublishingRestaurant([], NOW, NY)).toBe(false);
  });

  it('returns true when the current week is published', () => {
    expect(isPublishingRestaurant([{ week_start_date: '2026-08-17' }], NOW, NY)).toBe(true);
  });

  it('returns true when the previous week is published', () => {
    expect(isPublishingRestaurant([{ week_start_date: '2026-08-10' }], NOW, NY)).toBe(true);
  });

  it('returns false when the newest publication is 2 weeks old', () => {
    expect(isPublishingRestaurant([{ week_start_date: '2026-08-03' }], NOW, NY)).toBe(false);
  });

  it('accepts a week start that a manager device shifted by one day', () => {
    // The manager device wrote Sunday, not Monday. The 8-day window keeps it.
    expect(isPublishingRestaurant([{ week_start_date: '2026-08-09' }], NOW, NY)).toBe(true);
  });

  it('reads the window from the restaurant day, not the UTC day', () => {
    const sundayNight = new Date('2026-08-17T02:00:00Z');
    // In New York the current week still starts 2026-08-10, so the window
    // opens on 2026-08-02.
    expect(isPublishingRestaurant([{ week_start_date: '2026-08-03' }], sundayNight, NY)).toBe(true);
    expect(isPublishingRestaurant([{ week_start_date: '2026-08-03' }], sundayNight, 'UTC')).toBe(false);
  });
});
