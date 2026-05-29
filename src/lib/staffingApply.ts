import type { MinCrew } from '@/types/scheduling';

export interface PositionCount {
  position: string;
  count: number;
}

/**
 * Split a headcount across Minimum Crew positions proportionally to their weights,
 * preserving the total. Largest-remainder rounding (no lost or invented heads).
 * Falls back to a single generic "Staff" position when no crew is configured.
 */
export function distributePositions(headcount: number, minCrew: MinCrew | null): PositionCount[] {
  if (headcount <= 0) return [];
  const entries = minCrew ? Object.entries(minCrew).filter(([, w]) => w > 0) : [];
  if (entries.length === 0) return [{ position: 'Staff', count: headcount }];

  const totalWeight = entries.reduce((s, [, w]) => s + w, 0);
  const raw = entries.map(([position, w]) => ({ position, exact: (w / totalWeight) * headcount }));
  const floored = raw.map((r) => ({
    position: r.position,
    count: Math.floor(r.exact),
    rem: r.exact - Math.floor(r.exact),
  }));
  let assigned = floored.reduce((s, r) => s + r.count, 0);

  // Distribute the remaining heads to the largest remainders.
  const byRemainder = [...floored].sort((a, b) => b.rem - a.rem);
  let i = 0;
  while (assigned < headcount && byRemainder.length > 0) {
    byRemainder[i % byRemainder.length].count += 1;
    assigned += 1;
    i += 1;
  }
  return floored.filter((r) => r.count > 0).map((r) => ({ position: r.position, count: r.count }));
}
