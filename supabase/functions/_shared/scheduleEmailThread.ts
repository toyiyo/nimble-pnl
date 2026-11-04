/**
 * scheduleEmailThread.ts
 *
 * Threads schedule-related emails (publish, unpublish, shift change) into
 * one conversation per restaurant and week, using RFC 5322 `References` /
 * `In-Reply-To` headers. This is the email equal of the push `tag`.
 *
 * See docs/superpowers/specs/2026-08-18-schedule-notification-residue-design.md
 * ("Gap 2 — Thread schedule email on restaurant and week").
 */

import { safeTz } from './timezone.ts';

/**
 * Build the `References` and `In-Reply-To` headers for a schedule email.
 * Both headers carry the same id, keyed on `restaurantId` and
 * `weekStartDate`, so a mail client groups every email for one restaurant's
 * one week into a single thread.
 */
export const scheduleThreadHeaders = (
  restaurantId: string,
  weekStartDate: string,
): Record<string, string> => {
  const id = `<schedule-${restaurantId}-${weekStartDate}@easyshifthq.com>`;
  return { References: id, 'In-Reply-To': id };
};

/**
 * Convert a shift's `start_time` to the restaurant's business day
 * (`YYYY-MM-DD`) in its own timezone, via the `en-CA` locale, which formats
 * as `YYYY-MM-DD`.
 *
 * Returns `null` instead of throwing for a missing, non-string, or
 * unparseable `start_time`. An invalid `timezone` falls back to the
 * platform default through `safeTz` rather than throwing.
 */
export const shiftBusinessDay = (
  startTime: string | null | undefined,
  timezone: string | null | undefined,
): string | null => {
  if (typeof startTime !== 'string' || startTime.length === 0) {
    return null;
  }
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTz(timezone),
  });
  return formatter.format(date);
};
