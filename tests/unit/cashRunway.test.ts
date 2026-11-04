import { describe, it, expect } from 'vitest';
import { differenceInDays, format } from 'date-fns';
import {
  RUNWAY_WINDOW_DAYS,
  getRunwayWindow,
  buildCashRunwayAlert,
} from '@/lib/cashRunway';

describe('getRunwayWindow', () => {
  it('starts 29 days before now at 00:00', () => {
    const now = new Date('2026-06-15T14:30:00');
    const { start } = getRunwayWindow(now);
    expect(format(start, 'yyyy-MM-dd')).toBe('2026-05-17');
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });

  it('ends at now at 23:59:59.999', () => {
    const now = new Date('2026-06-15T14:30:00');
    const { end } = getRunwayWindow(now);
    expect(format(end, 'yyyy-MM-dd')).toBe('2026-06-15');
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
  });

  it('spans exactly 30 days', () => {
    const now = new Date('2026-06-15T14:30:00');
    const { start, end } = getRunwayWindow(now);
    expect(differenceInDays(end, start) + 1).toBe(RUNWAY_WINDOW_DAYS);
  });

  it('spans 30 days across a month edge', () => {
    const now = new Date('2026-03-05T09:00:00');
    const { start, end } = getRunwayWindow(now);
    expect(format(start, 'yyyy-MM-dd')).toBe('2026-02-04');
    expect(differenceInDays(end, start) + 1).toBe(RUNWAY_WINDOW_DAYS);
  });

  it('spans 30 days across the 2026-03-08 DST edge', () => {
    const now = new Date('2026-03-08T09:00:00');
    const { start, end } = getRunwayWindow(now);
    expect(differenceInDays(end, start) + 1).toBe(RUNWAY_WINDOW_DAYS);
  });

  it('spans 30 days across the 2026-11-01 DST edge', () => {
    const now = new Date('2026-11-01T09:00:00');
    const { start, end } = getRunwayWindow(now);
    expect(differenceInDays(end, start) + 1).toBe(RUNWAY_WINDOW_DAYS);
  });
});

describe('buildCashRunwayAlert', () => {
  it('returns null for null', () => {
    expect(buildCashRunwayAlert(null)).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(buildCashRunwayAlert(Infinity)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(buildCashRunwayAlert(NaN)).toBeNull();
  });

  it('returns null for 0', () => {
    expect(buildCashRunwayAlert(0)).toBeNull();
  });

  it('returns null for -5', () => {
    expect(buildCashRunwayAlert(-5)).toBeNull();
  });

  it('returns null for 30', () => {
    expect(buildCashRunwayAlert(30)).toBeNull();
  });

  it('returns a critical alert for 13.9 days', () => {
    const alert = buildCashRunwayAlert(13.9);
    expect(alert).toEqual({
      id: 'cash-runway',
      type: 'cash',
      severity: 'critical',
      title: '13 days of cash runway',
      description: 'Monitor cash flow closely',
      action: { label: 'View Banking', path: '/banking' },
    });
  });

  it('returns a warning alert for 14 days', () => {
    const alert = buildCashRunwayAlert(14);
    expect(alert?.severity).toBe('warning');
    expect(alert?.title).toBe('14 days of cash runway');
  });

  it('returns a warning alert for 29.9 days', () => {
    const alert = buildCashRunwayAlert(29.9);
    expect(alert?.severity).toBe('warning');
    expect(alert?.title).toBe('29 days of cash runway');
  });
});
