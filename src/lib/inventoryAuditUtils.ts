import { format, subDays, startOfMonth } from 'date-fns';

/**
 * Returns the default start date (7 days ago) in yyyy-MM-dd format.
 */
export function getDefaultStartDate(): string {
  return format(subDays(new Date(), 7), 'yyyy-MM-dd');
}

/**
 * Returns the default end date (today) in yyyy-MM-dd format.
 */
export function getDefaultEndDate(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Returns the start of the current month in yyyy-MM-dd format.
 */
export function getMonthToDateStart(): string {
  return format(startOfMonth(new Date()), 'yyyy-MM-dd');
}

/**
 * Checks whether the given date range matches the default 7-day range.
 */
export function isDefaultDateRange(startDate: string, endDate: string): boolean {
  if (!startDate || !endDate) return false;
  return startDate === getDefaultStartDate() && endDate === getDefaultEndDate();
}

/**
 * Date preset options for the filter UI.
 */
export type DatePreset = '7d' | '14d' | '30d' | 'mtd';

export function getDatePresetRange(preset: DatePreset): { startDate: string; endDate: string } {
  const endDate = format(new Date(), 'yyyy-MM-dd');
  switch (preset) {
    case '7d':
      return { startDate: format(subDays(new Date(), 7), 'yyyy-MM-dd'), endDate };
    case '14d':
      return { startDate: format(subDays(new Date(), 14), 'yyyy-MM-dd'), endDate };
    case '30d':
      return { startDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'), endDate };
    case 'mtd':
      return { startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'), endDate };
  }
}
