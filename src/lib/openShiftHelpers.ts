export type CapacityStatus = 'full' | 'partial' | 'empty';

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
