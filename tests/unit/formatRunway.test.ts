import { describe, it, expect } from 'vitest';

import { formatRunway } from '@/lib/formatRunway';

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
