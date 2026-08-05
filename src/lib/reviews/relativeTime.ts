/**
 * Coarse "how long ago" for inbox rows.
 *
 * Deliberately timezone-free: an elapsed duration is the same number of
 * minutes everywhere, so this needs no restaurant clock. The exact
 * wall-clock timestamp — which very much does need one — is rendered in the
 * detail pane through useRestaurantClock().formatInstant.
 */
export function formatRelativeTime(iso: string, nowMs: number): string {
  // `Date.parse` answers NaN for anything it cannot read — an empty string, a
  // truncated timestamp, a null that reached here as "". NaN then survives
  // Math.max and Math.floor untouched and loses every `<` comparison below,
  // so the function falls all the way through and renders the literal string
  // "NaNd ago" into an inbox row. An unreadable timestamp is not a duration;
  // say so instead of doing arithmetic on it.
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return 'recently';

  const elapsed = Math.max(0, nowMs - parsed);
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
