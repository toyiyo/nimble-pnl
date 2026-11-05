import { describe, it, expect } from 'vitest';
import { toImportedSaleDate } from '@/lib/timezone';

describe('toImportedSaleDate', () => {
  it('keeps the stated day of ISO text with Z or an offset', () => {
    expect(toImportedSaleDate('2026-11-03T00:00:00Z')).toBe('2026-11-03');
    expect(toImportedSaleDate('2026-11-03T22:30:00-06:00')).toBe('2026-11-03');
    expect(toImportedSaleDate('2026-11-03T00:30:00+13:00')).toBe('2026-11-03');
  });

  it('gives an empty day for ISO text with an impossible day or time', () => {
    expect(toImportedSaleDate('2026-02-31T10:00:00Z')).toBe('');
    expect(toImportedSaleDate('2026-11-03T25:00:00')).toBe('');
  });

  it('keeps a valid YYYY-MM-DD day with no change', () => {
    expect(toImportedSaleDate('2026-11-03')).toBe('2026-11-03');
    expect(toImportedSaleDate('2024-02-29')).toBe('2024-02-29');
  });

  it('keeps the stated day for a US date string', () => {
    expect(toImportedSaleDate('11/3/2026')).toBe('2026-11-03');
  });

  it('keeps the stated day for a US date with a time', () => {
    expect(toImportedSaleDate('11/03/2026')).toBe('2026-11-03');
    expect(toImportedSaleDate('11/03/2026 22:30')).toBe('2026-11-03');
  });

  it('keeps the stated day for a date and time without an offset', () => {
    expect(toImportedSaleDate('2026-11-03T22:46:00')).toBe('2026-11-03');
    expect(toImportedSaleDate('2026-11-03 22:46:00')).toBe('2026-11-03');
  });

  it('gives an empty string for impossible days', () => {
    expect(toImportedSaleDate('2026-13-45')).toBe('');
    expect(toImportedSaleDate('2026-02-31')).toBe('');
    expect(toImportedSaleDate('2025-02-29')).toBe('');
  });

  it('gives an empty string for text that is not a date', () => {
    expect(toImportedSaleDate('not a date')).toBe('');
    expect(toImportedSaleDate('')).toBe('');
  });

  it('gives an empty string for null and undefined', () => {
    expect(toImportedSaleDate(null)).toBe('');
    expect(toImportedSaleDate(undefined)).toBe('');
  });

  it('gives an empty string for impossible non-ISO days', () => {
    expect(toImportedSaleDate('02/31/2026')).toBe('');
    expect(toImportedSaleDate('02-31-2026')).toBe('');
    expect(toImportedSaleDate('Feb 31, 2026')).toBe('');
    expect(toImportedSaleDate('31 Feb 2026')).toBe('');
  });

  it('keeps real non-ISO days', () => {
    expect(toImportedSaleDate('02/28/2026')).toBe('2026-02-28');
    expect(toImportedSaleDate('2/8/2026 10:30 PM')).toBe('2026-02-08');
    expect(toImportedSaleDate('Feb 28, 2026')).toBe('2026-02-28');
    expect(toImportedSaleDate('28 Feb 2026')).toBe('2026-02-28');
  });
});
