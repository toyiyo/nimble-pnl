export type CapacityStatus = 'full' | 'partial' | 'empty';

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

/**
 * Compute how many open spots remain for a template on a given day.
 * Clamps to 0 (never negative).
 */
export function computeOpenSpots(
  capacity: number | undefined,
  assignedCount: number,
): number {
  const cap = capacity ?? 1;
  return Math.max(0, cap - assignedCount);
}

/**
 * Classify how filled a template slot is on a given day.
 */
export function classifyCapacity(
  capacity: number | undefined,
  assignedCount: number,
): CapacityStatus {
  const open = computeOpenSpots(capacity, assignedCount);
  if (open === 0) return 'full';
  if (assignedCount > 0) return 'partial';
  return 'empty';
}
