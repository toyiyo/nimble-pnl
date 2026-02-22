import { format, subDays, startOfMonth } from 'date-fns';
import { formatDateInTimezone } from '@/lib/timezone';

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

// --- Display Value Types & Computation ---

export interface AuditDisplayValues {
  formattedQuantity: string;
  formattedUnitCost: string;
  formattedTotalCost: string;
  formattedDate: string;
  isPositiveQuantity: boolean;
  isPositiveCost: boolean;
  badgeColor: string;
  borderColor: string;
  conversionBadges: ('volume' | 'weight' | 'fallback')[];
}

interface AuditTransaction {
  quantity: number;
  unit_cost: number | null;
  total_cost: number | null;
  transaction_type: string;
  reason: string | null;
  created_at: string;
  transaction_date: string | null;
}

const BADGE_COLORS: Record<string, string> = {
  purchase: 'bg-emerald-100 text-emerald-700',
  usage: 'bg-rose-100 text-rose-700',
  adjustment: 'bg-blue-100 text-blue-700',
  waste: 'bg-amber-100 text-amber-700',
};

const BORDER_COLORS: Record<string, string> = {
  purchase: 'border-l-emerald-500',
  usage: 'border-l-rose-500',
  adjustment: 'border-l-blue-500',
  waste: 'border-l-amber-500',
};

export function computeAuditDisplayValues(
  transaction: AuditTransaction,
  timezone: string
): AuditDisplayValues {
  const qty = transaction.quantity;
  const unitCost = transaction.unit_cost || 0;
  const totalCost = transaction.total_cost || 0;

  const conversionBadges: ('volume' | 'weight' | 'fallback')[] = [];
  if (transaction.reason) {
    if (transaction.reason.includes('\u2713 VOL')) conversionBadges.push('volume');
    if (transaction.reason.includes('\u2713 WEIGHT')) conversionBadges.push('weight');
    if (transaction.reason.includes('\u26a0\ufe0f FALLBACK')) conversionBadges.push('fallback');
  }

  const dateSource = transaction.transaction_date || transaction.created_at;
  const dateFormat = transaction.transaction_date ? 'MMM dd, yyyy' : 'MMM dd, yyyy HH:mm';
  const formattedDate = formatDateInTimezone(dateSource, timezone, dateFormat);

  return {
    formattedQuantity: `${qty > 0 ? '+' : ''}${Number(qty).toFixed(2)}`,
    formattedUnitCost: `$${unitCost.toFixed(2)}`,
    formattedTotalCost: `$${Math.abs(totalCost).toFixed(2)}`,
    formattedDate,
    isPositiveQuantity: qty > 0,
    isPositiveCost: totalCost >= 0,
    badgeColor: BADGE_COLORS[transaction.transaction_type] || 'bg-gray-100 text-gray-700',
    borderColor: BORDER_COLORS[transaction.transaction_type] || 'border-l-gray-500',
    conversionBadges,
  };
}
