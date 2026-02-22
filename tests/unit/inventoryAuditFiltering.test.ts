import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { countActiveFilters, getDatePresetRange } from '@/lib/inventoryAuditUtils';

const FIXED_DATE = new Date('2026-02-21T12:00:00Z');
const DEFAULT_DATES = { startDate: '2026-02-14', endDate: '2026-02-21' };

describe('countActiveFilters', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 when all filters are at defaults', () => {
    expect(countActiveFilters({
      typeFilter: 'all',
      searchTerm: '',
      ...DEFAULT_DATES,
    })).toBe(0);
  });

  it('counts type filter when not "all"', () => {
    expect(countActiveFilters({
      typeFilter: 'purchase',
      searchTerm: '',
      ...DEFAULT_DATES,
    })).toBe(1);
  });

  it('counts search term when non-empty', () => {
    expect(countActiveFilters({
      typeFilter: 'all',
      searchTerm: 'tomato',
      ...DEFAULT_DATES,
    })).toBe(1);
  });

  it('counts non-default date range as 1 filter', () => {
    expect(countActiveFilters({
      typeFilter: 'all',
      searchTerm: '',
      startDate: '2026-02-01',
      endDate: '2026-02-21',
    })).toBe(1);
  });

  it('counts multiple active filters', () => {
    expect(countActiveFilters({
      typeFilter: 'waste',
      searchTerm: 'milk',
      startDate: '2026-01-01',
      endDate: '2026-02-21',
    })).toBe(3);
  });
});

describe('getDatePresetRange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 7-day range for "7d"', () => {
    const range = getDatePresetRange('7d');
    expect(range.startDate).toBe('2026-02-14');
    expect(range.endDate).toBe('2026-02-21');
  });

  it('returns 14-day range for "14d"', () => {
    const range = getDatePresetRange('14d');
    expect(range.startDate).toBe('2026-02-07');
    expect(range.endDate).toBe('2026-02-21');
  });

  it('returns 30-day range for "30d"', () => {
    const range = getDatePresetRange('30d');
    expect(range.startDate).toBe('2026-01-22');
    expect(range.endDate).toBe('2026-02-21');
  });

  it('returns month-to-date range for "mtd"', () => {
    const range = getDatePresetRange('mtd');
    expect(range.startDate).toBe('2026-02-01');
    expect(range.endDate).toBe('2026-02-21');
  });
});
