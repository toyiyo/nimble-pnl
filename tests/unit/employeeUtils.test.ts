import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeAge, isMinor } from '@/lib/employeeUtils';

describe('computeAge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes age for a past birthday this year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15'));
    expect(computeAge('1990-03-10')).toBe(36);
  });

  it('computes age when birthday has not yet occurred this year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01'));
    expect(computeAge('1990-03-10')).toBe(35);
  });

  it('computes age on the exact birthday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10'));
    expect(computeAge('1990-03-10')).toBe(36);
  });

  it('handles leap year birthday (Feb 29)', () => {
    vi.useFakeTimers();
    // 2026 is not a leap year; Feb 29 anniversary = Mar 1 (UTC midnight).
    // On Mar 1 2026, someone born Feb 29 2008 has reached their 18th birthday.
    vi.setSystemTime(new Date('2026-03-01'));
    expect(computeAge('2008-02-29')).toBe(18);
  });
});

describe('isMinor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for age under 18', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13'));
    expect(isMinor('2010-06-15')).toBe(true);
  });

  it('returns false for exactly 18', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13'));
    expect(isMinor('2008-04-13')).toBe(false);
  });

  it('returns false for over 18', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13'));
    expect(isMinor('1990-01-01')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isMinor(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isMinor(undefined)).toBe(false);
  });
});
