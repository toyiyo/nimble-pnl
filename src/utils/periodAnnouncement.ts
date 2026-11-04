/**
 * Screen-reader message for the dashboard period live region.
 * Announces the load, then the result. A failed fetch must not
 * announce success.
 */
export function periodStatusMessage(
  fetching: boolean,
  error: Error | null,
  label: string,
): string {
  if (fetching) return `Loading ${label}…`;
  if (error) return `Failed to update the dashboard for ${label}`;
  return `Dashboard updated for ${label}`;
}
