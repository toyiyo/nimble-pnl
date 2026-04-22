import { useMemo } from 'react';

import { toLocalDateKey, toLocalEpoch } from '@/lib/shiftAllocation';

import type { Shift } from '@/types/scheduling';

export const COVERAGE_START_HOUR = 6;
export const COVERAGE_END_HOUR = 23; // exclusive
export const COVERAGE_BUCKETS = COVERAGE_END_HOUR - COVERAGE_START_HOUR; // 17
export const MAX_OVERVIEW_LANES = 3;

export interface OverviewPill {
  shiftId: string;
  employeeId: string | null;
  employeeName: string;
  position: string | null;
  startHour: number; // float, e.g. 13.5
  endHour: number;
  lane: number;    // 0..MAX_OVERVIEW_LANES-1 or -1 for overflow
}

export interface OverviewDay {
  day: string;            // YYYY-MM-DD
  pills: OverviewPill[];
  collapsedCount: number; // shifts that didn't fit in visible lanes
  hasGap: boolean;
  gapLabel: string | null;
  unstaffed: boolean;
}

export interface UsePlannerShiftsIndexReturn {
  shiftsByEmployee: Map<string, Shift[]>;
  coverageByDay: Map<string, number[]>; // day -> 17 numbers
  overviewDays: OverviewDay[];
}

function hourOfDay(iso: string): number {
  const d = new Date(toLocalEpoch(iso));
  return d.getHours() + d.getMinutes() / 60;
}

export function usePlannerShiftsIndex(
  shifts: readonly Shift[],
  weekDays: readonly string[],
): UsePlannerShiftsIndexReturn {
  const shiftsByEmployee = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const shift of shifts) {
      if (shift.status === 'cancelled' || !shift.employee_id) continue;
      const bucket = map.get(shift.employee_id) ?? [];
      bucket.push(shift);
      map.set(shift.employee_id, bucket);
    }
    return map;
  }, [shifts]);

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const day of weekDays) map.set(day, []);
    for (const shift of shifts) {
      if (shift.status === 'cancelled') continue;
      const key = toLocalDateKey(shift.start_time);
      const bucket = map.get(key);
      if (bucket) bucket.push(shift);
    }
    return map;
  }, [shifts, weekDays]);

  const coverageByDay = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const day of weekDays) {
      const counts = new Array<number>(COVERAGE_BUCKETS).fill(0);
      const dayShifts = shiftsByDay.get(day) ?? [];
      for (const shift of dayShifts) {
        const startHour = hourOfDay(shift.start_time);
        const endHour = hourOfDay(shift.end_time);
        const startBucket = Math.max(0, Math.floor(startHour) - COVERAGE_START_HOUR);
        const endBucket = Math.min(COVERAGE_BUCKETS, Math.ceil(endHour) - COVERAGE_START_HOUR);
        for (let b = startBucket; b < endBucket; b++) counts[b]++;
      }
      map.set(day, counts);
    }
    return map;
  }, [shiftsByDay, weekDays]);

  const overviewDays = useMemo<OverviewDay[]>(() => {
    return weekDays.map((day) => {
      const dayShifts = (shiftsByDay.get(day) ?? [])
        .slice()
        .sort((a, b) => a.start_time.localeCompare(b.start_time));

      const lanes: number[] = []; // lanes[i] = end timestamp of last shift in lane i
      const pills: OverviewPill[] = [];
      let collapsedCount = 0;

      for (const shift of dayShifts) {
        const start = toLocalEpoch(shift.start_time);
        const end = toLocalEpoch(shift.end_time);
        let placed = -1;
        for (let i = 0; i < lanes.length; i++) {
          if (lanes[i] <= start) {
            placed = i;
            lanes[i] = end;
            break;
          }
        }
        if (placed === -1) {
          if (lanes.length < MAX_OVERVIEW_LANES) {
            placed = lanes.length;
            lanes.push(end);
          } else {
            collapsedCount++;
            continue;
          }
        }
        pills.push({
          shiftId: shift.id,
          employeeId: shift.employee_id ?? null,
          employeeName: shift.employee?.name ?? 'Unassigned',
          position: shift.position ?? null,
          startHour: hourOfDay(shift.start_time),
          endHour: hourOfDay(shift.end_time),
          lane: placed,
        });
      }

      const { hasGap, gapLabel } = detectGap(dayShifts);
      const unstaffed = dayShifts.length === 0;

      return { day, pills, collapsedCount, hasGap, gapLabel, unstaffed };
    });
  }, [shiftsByDay, weekDays]);

  return { shiftsByEmployee, coverageByDay, overviewDays };
}

function detectGap(dayShifts: readonly Shift[]): { hasGap: boolean; gapLabel: string | null } {
  if (dayShifts.length < 2) return { hasGap: false, gapLabel: null };
  const sorted = dayShifts.slice().sort((a, b) => a.start_time.localeCompare(b.start_time));
  const earliest = toLocalEpoch(sorted[0].start_time);
  const latest = Math.max(...sorted.map((s) => toLocalEpoch(s.end_time)));

  // Walk the timeline in 30-minute chunks; flag the first >=60-min window with 0 coverage.
  const STEP_MS = 30 * 60 * 1000;
  let cursor = earliest;
  while (cursor < latest) {
    const chunkEnd = cursor + STEP_MS;
    const covered = sorted.some((s) => {
      const start = toLocalEpoch(s.start_time);
      const end = toLocalEpoch(s.end_time);
      return start < chunkEnd && end > cursor;
    });
    if (!covered) {
      // Extend gap window forward
      let gapEnd = chunkEnd;
      while (gapEnd < latest) {
        const next = gapEnd + STEP_MS;
        const nextCovered = sorted.some((s) => {
          const start = toLocalEpoch(s.start_time);
          const end = toLocalEpoch(s.end_time);
          return start < next && end > gapEnd;
        });
        if (nextCovered) break;
        gapEnd = next;
      }
      if (gapEnd - cursor >= 60 * 60 * 1000) {
        const gapDate = new Date(cursor);
        const hour = gapDate.getHours();
        const suffix = hour >= 12 ? 'p' : 'a';
        const display = ((hour + 11) % 12) + 1;
        return { hasGap: true, gapLabel: `Gap ${display}${suffix}` };
      }
      cursor = gapEnd;
    } else {
      cursor = chunkEnd;
    }
  }
  return { hasGap: false, gapLabel: null };
}
