import { describe, it, expect } from 'vitest';
import { parseLocalDate } from '@/lib/parseLocalDate';

describe('parseLocalDate', () => {
  it('parses a yyyy-MM-dd string as local-zone midnight', () => {
    const result = parseLocalDate('2026-06-01');
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(5); // 0-indexed: June
    expect(result.getDate()).toBe(1);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });

  it('preserves the calendar weekday regardless of host TZ offset', () => {
    // 2026-06-01 is a Monday. Native `new Date('2026-06-01')` would read
    // this as UTC midnight, which in a negative-UTC-offset host TZ formats
    // back to Sunday.
    const result = parseLocalDate('2026-06-01');
    expect(result.getDay()).toBe(1); // Monday
  });

  it('handles single-digit months and days', () => {
    const result = parseLocalDate('2026-01-05');
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(5);
  });

  it('handles December 31 without rolling into the next year', () => {
    const result = parseLocalDate('2026-12-31');
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(11);
    expect(result.getDate()).toBe(31);
  });
});
