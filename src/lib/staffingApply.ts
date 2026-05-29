import type { MinCrew, ShiftBlock, ShiftTemplate } from '@/types/scheduling';

export interface PositionCount {
  position: string;
  count: number;
}

/** Abbreviated day names, Sunday-first (matches Date.getDay()). */
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Format an integer hour (0-23) as "12PM"-style 12-hour string. */
export const fmtHour = (h: number): string => {
  const m = h % 24;
  return `${m % 12 === 0 ? 12 : m % 12}${m < 12 ? 'AM' : 'PM'}`;
};

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
  while (assigned < headcount) {
    byRemainder[i % byRemainder.length].count += 1;
    assigned += 1;
    i += 1;
  }
  return floored.filter((r) => r.count > 0).map((r) => ({ position: r.position, count: r.count }));
}

export type TemplateInsert = Omit<ShiftTemplate, 'id' | 'created_at' | 'updated_at' | 'area'>;

const pad = (h: number) => `${String(h % 24).padStart(2, '0')}:00:00`;

/** Day-of-week (0=Sun..6=Sat) from a YYYY-MM-DD string, noon-anchored to dodge DST. */
export function dayStringToDow(day: string): number {
  return new Date(day + 'T12:00:00').getDay();
}

/**
 * Convert consolidated shift blocks into shift_templates insert rows.
 * Headcount is split across Minimum Crew positions; each position becomes one
 * template with capacity = its share. start/end are restaurant-local TIME values.
 *
 * Each block targets one day, so it produces one row per (position, day) with
 * `days: [dow]` and its own capacity. Rows are NOT merged across days — the
 * unique index includes `days`, and merging would overstate capacity on the
 * quieter days (Fri=2 + Sat=4 must not become 4 openings on both).
 */
export function shiftBlocksToTemplates(
  blocks: ShiftBlock[],
  minCrew: MinCrew | null,
  restaurantId: string,
): TemplateInsert[] {
  // Group rows by (position, start_time, end_time, day) — day IS part of the key
  // so each day keeps its own capacity (no cross-day merge / overstating).
  const grouped = new Map<string, TemplateInsert>();

  for (const block of blocks) {
    const dow = dayStringToDow(block.day);
    const start = pad(block.startHour);
    const end = pad(block.endHour);
    for (const { position, count } of distributePositions(block.headcount, minCrew)) {
      const key = `${position}|${start}|${end}|${dow}`;
      const existing = grouped.get(key);
      if (existing) {
        // Same day-slot from overlapping blocks: keep the busiest.
        if (count > existing.capacity) {
          existing.capacity = count;
        }
      } else {
        grouped.set(key, {
          restaurant_id: restaurantId,
          name: `Suggested · ${position} ${start.slice(0, 5)}-${end.slice(0, 5)}`,
          days: [dow],
          start_time: start,
          end_time: end,
          break_duration: 0,
          position,
          capacity: count,
          is_active: true,
        });
      }
    }
  }
  return Array.from(grouped.values());
}
