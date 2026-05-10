import type { TimeOffRequest } from '@/types/scheduling';

export interface Partitioned {
  pending: TimeOffRequest[];
  decided: TimeOffRequest[];
}

/**
 * Split time-off requests into pending vs decided.
 * - pending: sorted oldest first (created_at asc) so managers work the
 *   queue FIFO.
 * - decided: sorted by start_date desc (matches existing audit ordering).
 * Unknown statuses fall into `decided` so we never silently drop rows.
 */
export function partitionByStatus(requests: TimeOffRequest[]): Partitioned {
  const pending: TimeOffRequest[] = [];
  const decided: TimeOffRequest[] = [];

  for (const r of requests) {
    if (r.status === 'pending') pending.push(r);
    else decided.push(r);
  }

  pending.sort((a, b) => a.created_at.localeCompare(b.created_at));
  decided.sort((a, b) => b.start_date.localeCompare(a.start_date));

  return { pending, decided };
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Calendar-day delta between `iso` and `now`, ignoring time-of-day.
 *
 * "Requested 2 days ago" should mean "submitted on a date 2 calendar days
 * before today," not "submitted 48 full hours ago" — managers reason in
 * dates, not 24h blocks. Both timestamps are truncated to UTC midnight
 * before subtracting. Future timestamps clamp to 0 so the UI never shows
 * a negative count. `now` is injectable for deterministic tests.
 */
export function daysSince(iso: string, now: Date = new Date()): number {
  const then = new Date(iso);
  const thenUtc = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diff = nowUtc - thenUtc;
  if (diff < 0) return 0;
  return Math.round(diff / MS_PER_DAY);
}
