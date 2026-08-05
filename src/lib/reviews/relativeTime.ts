/**
 * Coarse "how long ago" for inbox rows.
 *
 * Deliberately timezone-free: an elapsed duration is the same number of
 * minutes everywhere, so this needs no restaurant clock. The exact
 * wall-clock timestamp — which very much does need one — is rendered in the
 * detail pane through useRestaurantClock().formatInstant.
 */
export function formatRelativeTime(iso: string, nowMs: number): string {
  const elapsed = Math.max(0, nowMs - Date.parse(iso));
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
