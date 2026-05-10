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
 * Whole days elapsed since `iso`. Negative inputs (future dates) clamp to 0.
 * `now` is injectable for deterministic tests.
 */
export function daysSince(iso: string, now: Date = new Date()): number {
  const then = new Date(iso).getTime();
  const diff = now.getTime() - then;
  if (diff < 0) return 0;
  return Math.floor(diff / MS_PER_DAY);
}
