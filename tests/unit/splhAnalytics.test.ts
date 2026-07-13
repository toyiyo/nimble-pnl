import { describe, it, expect } from 'vitest';
import { validateTimeZone } from '@/lib/splhAnalytics';

describe('validateTimeZone', () => {
  it('passes through a valid IANA zone', () => {
    expect(validateTimeZone('America/New_York')).toBe('America/New_York');
  });
  it('falls back to UTC for an invalid zone', () => {
    expect(validateTimeZone('Not/AZone')).toBe('UTC');
    expect(validateTimeZone('')).toBe('UTC');
    expect(validateTimeZone(undefined)).toBe('UTC');
  });
});
