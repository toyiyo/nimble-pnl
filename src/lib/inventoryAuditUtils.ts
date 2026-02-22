import { format, subDays, startOfMonth } from 'date-fns';
import { formatDateInTimezone } from '@/lib/timezone';

const DATE_FORMAT = 'yyyy-MM-dd';

function formatToday(): string {
  return format(new Date(), DATE_FORMAT);
}

function formatDaysAgo(days: number): string {
  return format(subDays(new Date(), days), DATE_FORMAT);
}

/**
 * Returns the default start date (7 days ago) in yyyy-MM-dd format.
 */
export function getDefaultStartDate(): string {
  return formatDaysAgo(7);
}

/**
 * Returns the default end date (today) in yyyy-MM-dd format.
 */
export function getDefaultEndDate(): string {
  return formatToday();
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
  const endDate = formatToday();
  switch (preset) {
    case '7d':
      return { startDate: formatDaysAgo(7), endDate };
    case '14d':
      return { startDate: formatDaysAgo(14), endDate };
    case '30d':
      return { startDate: formatDaysAgo(30), endDate };
    case 'mtd':
      return { startDate: format(startOfMonth(new Date()), DATE_FORMAT), endDate };
  }
}

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

const TRANSACTION_STYLES: Record<string, { badge: string; border: string }> = {
  purchase: { badge: 'bg-emerald-100 text-emerald-700', border: 'border-l-emerald-500' },
  usage: { badge: 'bg-rose-100 text-rose-700', border: 'border-l-rose-500' },
  adjustment: { badge: 'bg-blue-100 text-blue-700', border: 'border-l-blue-500' },
  waste: { badge: 'bg-amber-100 text-amber-700', border: 'border-l-amber-500' },
};

const DEFAULT_STYLE = { badge: 'bg-gray-100 text-gray-700', border: 'border-l-gray-500' };

type ConversionBadge = 'volume' | 'weight' | 'fallback';

const CONVERSION_MARKERS: { marker: string; badge: ConversionBadge }[] = [
  { marker: '\u2713 VOL', badge: 'volume' },
  { marker: '\u2713 WEIGHT', badge: 'weight' },
  { marker: '\u26a0\ufe0f FALLBACK', badge: 'fallback' },
];

function parseConversionBadges(reason: string | null): ConversionBadge[] {
  if (!reason) return [];
  return CONVERSION_MARKERS
    .filter(({ marker }) => reason.includes(marker))
    .map(({ badge }) => badge);
}

export function computeAuditDisplayValues(
  transaction: AuditTransaction,
  timezone: string
): AuditDisplayValues {
  const qty = transaction.quantity;
  const unitCost = transaction.unit_cost || 0;
  const totalCost = transaction.total_cost || 0;
  const style = TRANSACTION_STYLES[transaction.transaction_type] || DEFAULT_STYLE;

  const dateSource = transaction.transaction_date || transaction.created_at;
  const dateFormat = transaction.transaction_date ? 'MMM dd, yyyy' : 'MMM dd, yyyy HH:mm';

  return {
    formattedQuantity: `${qty > 0 ? '+' : ''}${qty.toFixed(2)}`,
    formattedUnitCost: `$${unitCost.toFixed(2)}`,
    formattedTotalCost: `$${Math.abs(totalCost).toFixed(2)}`,
    formattedDate: formatDateInTimezone(dateSource, timezone, dateFormat),
    isPositiveQuantity: qty > 0,
    isPositiveCost: totalCost >= 0,
    badgeColor: style.badge,
    borderColor: style.border,
    conversionBadges: parseConversionBadges(transaction.reason),
  };
}

interface FilterState {
  typeFilter: string;
  searchTerm: string;
  startDate: string;
  endDate: string;
}

/**
 * Counts the number of active filters that differ from defaults.
 * The default 7-day date range does NOT count as an active filter.
 */
export function countActiveFilters(filters: FilterState): number {
  let count = 0;
  if (filters.typeFilter !== 'all') count++;
  if (filters.searchTerm.trim() !== '') count++;
  if (!isDefaultDateRange(filters.startDate, filters.endDate)) count++;
  return count;
}
