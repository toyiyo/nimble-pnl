import { describe, it, expect } from 'vitest';

// Replicate the exact calculateDateRange function from ai-execute-tool/index.ts
// since the actual function lives in a Deno edge function and can't be imported directly.

type PeriodType =
  | 'today' | 'yesterday' | 'tomorrow'
  | 'week' | 'month' | 'quarter' | 'year'
  | 'current_week' | 'last_week' | 'current_month' | 'last_month'
  | 'custom';

interface DateRange {
  startDate: Date;
  endDate: Date;
  startDateStr: string;
  endDateStr: string;
}

function calculateDateRange(
  period: PeriodType,
  customStartDate?: string,
  customEndDate?: string
): DateRange {
  const now = new Date();
  let startDate: Date;
  let endDate: Date = now;

  switch (period) {
    case 'today':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      break;
    case 'yesterday':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
      break;
    case 'tomorrow':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59);
      break;
    case 'week':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      break;
    case 'current_week': {
      const dayOfWeek = now.getDay();
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - dayOfWeek), 23, 59, 59);
      break;
    }
    case 'last_week': {
      const dayOfWeek = now.getDay();
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek - 7);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek - 1, 23, 59, 59);
      break;
    }
    case 'month':
    case 'current_month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
      break;
    case 'last_month':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      break;
    case 'quarter': {
      const quarter = Math.floor(now.getMonth() / 3);
      startDate = new Date(now.getFullYear(), quarter * 3, 1);
      break;
    }
    case 'year':
      startDate = new Date(now.getFullYear(), 0, 1);
      break;
    case 'custom':
      if (!customStartDate || !customEndDate) {
        throw new Error('Custom period requires start_date and end_date');
      }
      startDate = new Date(customStartDate);
      endDate = new Date(customEndDate);
      break;
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  }

  return {
    startDate,
    endDate,
    startDateStr: startDate.toISOString().split('T')[0],
    endDateStr: endDate.toISOString().split('T')[0],
  };
}

// Helper to format Date as local YYYY-MM-DD (avoids UTC timezone shift from toISOString)
function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('calculateDateRange', () => {
  it('month returns current month boundaries', () => {
    const result = calculateDateRange('month');
    const now = new Date();
    expect(result.startDate.getDate()).toBe(1);
    expect(result.startDate.getMonth()).toBe(now.getMonth());
    // endDate should be last day of current month
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    expect(result.endDate.getDate()).toBe(lastDay.getDate());
    expect(result.endDate.getMonth()).toBe(now.getMonth());
  });

  it('last_month returns previous month boundaries', () => {
    const result = calculateDateRange('last_month');
    const now = new Date();
    const expectedStartMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    expect(result.startDate.getDate()).toBe(1);
    expect(result.startDate.getMonth()).toBe(expectedStartMonth);
    // endDate should be last day of previous month
    const lastDayPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    expect(result.endDate.getDate()).toBe(lastDayPrevMonth.getDate());
  });

  it('last_month does not overlap with current month', () => {
    const result = calculateDateRange('last_month');
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    expect(result.endDate < currentMonthStart).toBe(true);
  });

  it('year returns Jan 1 to today', () => {
    const result = calculateDateRange('year');
    const now = new Date();
    expect(result.startDate.getMonth()).toBe(0);
    expect(result.startDate.getDate()).toBe(1);
    expect(result.startDate.getFullYear()).toBe(now.getFullYear());
    expect(formatLocalDate(result.endDate)).toBe(formatLocalDate(now));
  });

  it('custom with explicit dates works', () => {
    const result = calculateDateRange('custom', '2026-02-01', '2026-02-28');
    expect(result.startDateStr).toBe('2026-02-01');
    expect(result.endDateStr).toBe('2026-02-28');
  });

  it('custom without dates throws', () => {
    expect(() => calculateDateRange('custom')).toThrow('Custom period requires start_date and end_date');
  });

  it('last_week spans 7 days', () => {
    const result = calculateDateRange('last_week');
    // last_week: Sunday to Saturday = 7 calendar days
    const startDay = result.startDate.getDay();
    expect(startDay).toBe(0); // Should start on Sunday
    expect(result.endDate.getDay()).toBe(6); // Should end on Saturday
  });

  it('today start and end are same calendar day', () => {
    const result = calculateDateRange('today');
    expect(result.startDate.getDate()).toBe(result.endDate.getDate());
    expect(result.startDate.getMonth()).toBe(result.endDate.getMonth());
  });
});

describe('get_sales_summary previous period calculation', () => {
  // Replicate the previous-period logic from executeGetSalesSummary
  function getPreviousPeriod(effectivePeriod: string, startDate: Date, endDate: Date) {
    let prevStartDate: Date;
    let prevEndDate: Date;
    const durationMs = endDate.getTime() - startDate.getTime();

    switch (effectivePeriod) {
      case 'today':
      case 'yesterday': {
        prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - 1);
        prevEndDate = new Date(prevStartDate);
        prevEndDate.setHours(23, 59, 59);
        break;
      }
      case 'week':
      case 'last_week': {
        prevEndDate = new Date(startDate.getTime() - 1);
        prevStartDate = new Date(prevEndDate.getTime() - durationMs);
        break;
      }
      case 'month':
      case 'last_month': {
        prevStartDate = new Date(startDate.getFullYear(), startDate.getMonth() - 1, 1);
        prevEndDate = new Date(startDate.getFullYear(), startDate.getMonth(), 0, 23, 59, 59);
        break;
      }
      case 'year': {
        prevStartDate = new Date(startDate.getFullYear() - 1, 0, 1);
        prevEndDate = new Date(startDate.getFullYear() - 1, endDate.getMonth(), endDate.getDate(), 23, 59, 59);
        break;
      }
      default: {
        prevEndDate = new Date(startDate.getTime() - 1);
        prevStartDate = new Date(prevEndDate.getTime() - durationMs);
      }
    }

    return { prevStartDate, prevEndDate };
  }

  it('last_month previous period does not overlap with last_month period', () => {
    // Simulate: last_month period is the previous month
    const range = calculateDateRange('last_month');
    const { prevStartDate, prevEndDate } = getPreviousPeriod('last_month', range.startDate, range.endDate);

    // Previous period should end before last_month starts
    expect(prevEndDate.getTime()).toBeLessThan(range.startDate.getTime());
    // Previous period should be one full month
    expect(prevStartDate.getDate()).toBe(1);
  });

  it('month previous period is the month before current', () => {
    const range = calculateDateRange('month');
    const { prevStartDate, prevEndDate } = getPreviousPeriod('month', range.startDate, range.endDate);

    // Previous period should end before current month starts
    expect(prevEndDate.getTime()).toBeLessThan(range.startDate.getTime());
    expect(prevStartDate.getDate()).toBe(1);
  });

  it('year previous period is same YTD window one year ago', () => {
    const range = calculateDateRange('year');
    const { prevStartDate, prevEndDate } = getPreviousPeriod('year', range.startDate, range.endDate);

    expect(prevStartDate.getMonth()).toBe(0); // January
    expect(prevStartDate.getDate()).toBe(1);
    expect(prevStartDate.getFullYear()).toBe(range.startDate.getFullYear() - 1);
    expect(prevEndDate.getFullYear()).toBe(range.startDate.getFullYear() - 1);
  });
});

describe('get_break_even_progress month param parsing', () => {
  it('parses YYYY-MM month format correctly', () => {
    const month = '2026-02';
    const [yearStr, monthStr] = month.split('-').map(Number);
    const monthStart = new Date(yearStr, monthStr - 1, 1);
    const monthEnd = new Date(yearStr, monthStr, 0);

    expect(monthStart.toISOString().split('T')[0]).toBe('2026-02-01');
    expect(monthEnd.toISOString().split('T')[0]).toBe('2026-02-28');
    expect(monthEnd.getDate()).toBe(28);
  });

  it('handles leap year February', () => {
    const month = '2024-02';
    const [yearStr, monthStr] = month.split('-').map(Number);
    const monthEnd = new Date(yearStr, monthStr, 0);
    expect(monthEnd.getDate()).toBe(29);
  });

  it('handles December correctly (no year rollover bug)', () => {
    const month = '2026-12';
    const [yearStr, monthStr] = month.split('-').map(Number);
    const monthStart = new Date(yearStr, monthStr - 1, 1);
    const monthEnd = new Date(yearStr, monthStr, 0);

    expect(monthStart.toISOString().split('T')[0]).toBe('2026-12-01');
    expect(monthEnd.toISOString().split('T')[0]).toBe('2026-12-31');
  });

  it('handles January correctly (month index 0)', () => {
    const month = '2026-01';
    const [yearStr, monthStr] = month.split('-').map(Number);
    const monthStart = new Date(yearStr, monthStr - 1, 1);
    const monthEnd = new Date(yearStr, monthStr, 0);

    expect(monthStart.toISOString().split('T')[0]).toBe('2026-01-01');
    expect(monthEnd.toISOString().split('T')[0]).toBe('2026-01-31');
  });
});
