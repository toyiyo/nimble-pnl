import { describe, it, expect } from 'vitest';

import { formatRunway, formatRunwayDays } from '@/lib/formatRunway';

describe('formatRunway', () => {
  it('rounds a fractional day count down to a whole day', () => {
    expect(formatRunway(45.8)).toBe('45');
  });

  it('shows "365+" above one year', () => {
    expect(formatRunway(400)).toBe('365+');
  });

  it('shows "0" for zero days of runway', () => {
    expect(formatRunway(0)).toBe('0');
  });
});

describe('formatRunwayDays', () => {
  it('adds the word "days" to the whole day count', () => {
    expect(formatRunwayDays(168.4)).toBe('168 days');
  });

  it('uses "day" for one day', () => {
    expect(formatRunwayDays(1)).toBe('1 day');
  });

  it('shows "365+ days" above one year', () => {
    expect(formatRunwayDays(400)).toBe('365+ days');
  });

  it('shows "Cash growing" for no burn (Infinity)', () => {
    expect(formatRunwayDays(Infinity)).toBe('Cash growing');
  });

  it('shows "0 days" for zero days of runway', () => {
    expect(formatRunwayDays(0)).toBe('0 days');
  });
});
