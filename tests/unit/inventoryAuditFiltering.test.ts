import { describe, it, expect, vi, afterEach } from 'vitest';
import { countActiveFilters, getDatePresetRange, type DatePreset } from '@/lib/inventoryAuditUtils';

describe('countActiveFilters', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 when all filters are at defaults', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    expect(countActiveFilters({
      typeFilter: 'all',
      searchTerm: '',
      startDate: '2026-02-14',
      endDate: '2026-02-21',
    })).toBe(0);
    vi.useRealTimers();
  });

  it('counts type filter when not "all"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    expect(countActiveFilters({
      typeFilter: 'purchase',
      searchTerm: '',
      startDate: '2026-02-14',
      endDate: '2026-02-21',
    })).toBe(1);
    vi.useRealTimers();
  });

  it('counts search term when non-empty', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    expect(countActiveFilters({
      typeFilter: 'all',
      searchTerm: 'tomato',
      startDate: '2026-02-14',
      endDate: '2026-02-21',
    })).toBe(1);
    vi.useRealTimers();
  });

  it('counts non-default date range as 1 filter', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    expect(countActiveFilters({
      typeFilter: 'all',
      searchTerm: '',
      startDate: '2026-02-01',
      endDate: '2026-02-21',
    })).toBe(1);
    vi.useRealTimers();
  });

  it('counts multiple active filters', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    expect(countActiveFilters({
      typeFilter: 'waste',
      searchTerm: 'milk',
      startDate: '2026-01-01',
      endDate: '2026-02-21',
    })).toBe(3);
    vi.useRealTimers();
  });
});

describe('getDatePresetRange', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 7-day range for "7d"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    const range = getDatePresetRange('7d');
    expect(range.startDate).toBe('2026-02-14');
    expect(range.endDate).toBe('2026-02-21');
    vi.useRealTimers();
  });

  it('returns 14-day range for "14d"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    const range = getDatePresetRange('14d');
    expect(range.startDate).toBe('2026-02-07');
    expect(range.endDate).toBe('2026-02-21');
    vi.useRealTimers();
  });

  it('returns 30-day range for "30d"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    const range = getDatePresetRange('30d');
    expect(range.startDate).toBe('2026-01-22');
    expect(range.endDate).toBe('2026-02-21');
    vi.useRealTimers();
  });

  it('returns month-to-date range for "mtd"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
    const range = getDatePresetRange('mtd');
    expect(range.startDate).toBe('2026-02-01');
    expect(range.endDate).toBe('2026-02-21');
    vi.useRealTimers();
  });
});
