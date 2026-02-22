import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDefaultStartDate, getDefaultEndDate, isDefaultDateRange } from '@/lib/inventoryAuditUtils';

describe('inventoryAuditDefaults', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getDefaultStartDate', () => {
    it('returns date 7 days ago in yyyy-MM-dd format', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
      expect(getDefaultStartDate()).toBe('2026-02-14');
      vi.useRealTimers();
    });

    it('handles month boundary correctly', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
      expect(getDefaultStartDate()).toBe('2026-02-24');
      vi.useRealTimers();
    });
  });

  describe('getDefaultEndDate', () => {
    it('returns today in yyyy-MM-dd format', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
      expect(getDefaultEndDate()).toBe('2026-02-21');
      vi.useRealTimers();
    });
  });

  describe('isDefaultDateRange', () => {
    it('returns true when dates match 7-day default', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
      expect(isDefaultDateRange('2026-02-14', '2026-02-21')).toBe(true);
      vi.useRealTimers();
    });

    it('returns false when dates differ from default', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-21T12:00:00Z'));
      expect(isDefaultDateRange('2026-02-01', '2026-02-21')).toBe(false);
      vi.useRealTimers();
    });

    it('returns false when dates are empty', () => {
      expect(isDefaultDateRange('', '')).toBe(false);
    });
  });
});
