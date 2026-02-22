import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDefaultStartDate, getDefaultEndDate, isDefaultDateRange } from '@/lib/inventoryAuditUtils';

const FIXED_DATE = new Date('2026-02-21T12:00:00Z');

describe('inventoryAuditDefaults', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getDefaultStartDate', () => {
    it('returns date 7 days ago in yyyy-MM-dd format', () => {
      expect(getDefaultStartDate()).toBe('2026-02-14');
    });

    it('handles month boundary correctly', () => {
      vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
      expect(getDefaultStartDate()).toBe('2026-02-24');
    });
  });

  describe('getDefaultEndDate', () => {
    it('returns today in yyyy-MM-dd format', () => {
      expect(getDefaultEndDate()).toBe('2026-02-21');
    });
  });

  describe('isDefaultDateRange', () => {
    it('returns true when dates match 7-day default', () => {
      expect(isDefaultDateRange('2026-02-14', '2026-02-21')).toBe(true);
    });

    it('returns false when dates differ from default', () => {
      expect(isDefaultDateRange('2026-02-01', '2026-02-21')).toBe(false);
    });

    it('returns false when dates are empty', () => {
      expect(isDefaultDateRange('', '')).toBe(false);
    });
  });
});
