import { describe, it, expect } from 'vitest';
import { toImportedSaleDate } from '@/lib/timezone';

describe('toImportedSaleDate', () => {
  it('keeps a valid YYYY-MM-DD day with no change', () => {
    expect(toImportedSaleDate('2026-11-03')).toBe('2026-11-03');
    expect(toImportedSaleDate('2024-02-29')).toBe('2024-02-29');
  });

  it('keeps the stated day for a US date string', () => {
    expect(toImportedSaleDate('11/3/2026')).toBe('2026-11-03');
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
});
