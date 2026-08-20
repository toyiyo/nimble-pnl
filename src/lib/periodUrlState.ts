/**
 * URL search-param state for the /financial-intelligence page.
 *
 * The page keeps its period, dashboard tab, chart view, and chart interval
 * in the URL, so a refresh or a shared link restores the same view. This
 * file is the single codec. Components read with `readPeriodParams` /
 * `readEnumParam` and write with `writePeriodParams` / `URLSearchParams.set`.
 */

import { endOfDay, format, startOfDay, startOfMonth, startOfQuarter, startOfWeek, subDays } from 'date-fns';

import type { Period } from '@/components/PeriodSelector';
import { toDateOnlyString } from '@/lib/dateOnly';

export const PERIOD_PARAM = 'period';
export const FROM_PARAM = 'from';
export const TO_PARAM = 'to';

export const PRESET_PERIOD_TYPES = ['today', 'week', 'month', 'quarter', 'last30', 'last90'] as const;
export type PresetPeriodType = (typeof PRESET_PERIOD_TYPES)[number];

const PRESET_LABELS: Record<PresetPeriodType, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  quarter: 'This Quarter',
  last30: 'Last 30 Days',
  last90: 'Last 90 Days',
};

const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build a preset period relative to `today`. The preset tabs and the URL
 * codec share this one builder, so a decoded link matches a tab click.
 */
export function presetPeriod(type: PresetPeriodType, today: Date = new Date()): Period {
  const to = endOfDay(today);
  let from: Date;
  switch (type) {
    case 'today':
      from = startOfDay(today);
      break;
    case 'week':
      from = startOfDay(startOfWeek(today, { weekStartsOn: 1 }));
      break;
    case 'month':
      from = startOfDay(startOfMonth(today));
      break;
    case 'quarter':
      from = startOfDay(startOfQuarter(today));
      break;
    case 'last30':
      from = startOfDay(subDays(today, 29));
      break;
    case 'last90':
      from = startOfDay(subDays(today, 89));
      break;
  }
  return { type, from, to, label: PRESET_LABELS[type] };
}

/** Label for a custom period. The start year appears when the range crosses a year boundary. */
export function customPeriodLabel(from: Date, to: Date): string {
  const sameYear = from.getFullYear() === to.getFullYear();
  return `${format(from, sameYear ? 'MMM d' : 'MMM d, yyyy')} - ${format(to, 'MMM d, yyyy')}`;
}

function parseDateParam(value: string | null): Date | null {
  if (!value || !DATE_PARAM_PATTERN.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  // Reject a rolled-over date such as 2026-02-31.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/**
 * Read the period from the URL. A preset type rebuilds its dates relative
 * to `today`; a custom period restores its exact dates. Returns null when
 * the params are absent or invalid, so the caller falls back to a default.
 */
export function readPeriodParams(params: URLSearchParams, today: Date = new Date()): Period | null {
  const type = params.get(PERIOD_PARAM);
  if (!type) return null;
  if ((PRESET_PERIOD_TYPES as readonly string[]).includes(type)) {
    return presetPeriod(type as PresetPeriodType, today);
  }
  if (type !== 'custom') return null;

  const from = parseDateParam(params.get(FROM_PARAM));
  const to = parseDateParam(params.get(TO_PARAM));
  if (!from || !to || from > to) return null;

  const fromDay = startOfDay(from);
  const toDay = endOfDay(to);
  return { type: 'custom', from: fromDay, to: toDay, label: customPeriodLabel(fromDay, toDay) };
}

/** Write the period into `params`. A preset stores its type; custom stores its dates. */
export function writePeriodParams(params: URLSearchParams, period: Period): void {
  params.set(PERIOD_PARAM, period.type);
  if (period.type === 'custom') {
    params.set(FROM_PARAM, toDateOnlyString(period.from));
    params.set(TO_PARAM, toDateOnlyString(period.to));
  } else {
    params.delete(FROM_PARAM);
    params.delete(TO_PARAM);
  }
}

/** Read a URL param constrained to a known value list. Returns null for anything else. */
export function readEnumParam<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
): T | null {
  const value = params.get(key);
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
