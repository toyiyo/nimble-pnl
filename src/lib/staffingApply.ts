import type { MinCrew, ShiftBlock, ShiftTemplate } from '@/types/scheduling';

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
 * Blocks for the same (position, start_time, end_time) on different days are
 * merged into a single template row with a multi-day `days` array. This matches
 * the partial unique index on shift_templates (restaurant_id, position, start_time,
 * end_time) WHERE is_active = true — preventing 23505 conflicts when the same
 * time slot recurs across multiple days of the week.
 * Capacity is taken as the maximum across merged days.
 */
export function shiftBlocksToTemplates(
  blocks: ShiftBlock[],
  minCrew: MinCrew | null,
  restaurantId: string,
): TemplateInsert[] {
  // Group rows by (position, start_time, end_time) key
  const grouped = new Map<string, TemplateInsert>();

  for (const block of blocks) {
    const dow = dayStringToDow(block.day);
    const start = pad(block.startHour);
    const end = pad(block.endHour);
    for (const { position, count } of distributePositions(block.headcount, minCrew)) {
      const key = `${position}|${start}|${end}`;
      const existing = grouped.get(key);
      if (existing) {
        // Merge: add the day (dedup in case of duplicate blocks) and take max capacity
        if (!existing.days.includes(dow)) {
          existing.days = [...existing.days, dow].sort((a, b) => a - b);
        }
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
