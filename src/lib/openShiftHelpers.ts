/**
 * Format a HH:MM[:SS] time string into a compact 12-hour label.
 * Examples: "14:00" → "2p", "09:30" → "9:30a"
 */
export function formatCompactTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'p' : 'a';
  const hour12 = h % 12 || 12;
  if (m === 0) return `${hour12}${suffix}`;
  return `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}
