import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useTimePunches } from '@/hooks/useTimePunches';
import { useRestaurantClock } from '@/hooks/useRestaurantClock';
import { businessDayRangeToInstants } from '@/lib/restaurantClock';
import { toDateOnlyString } from '@/lib/dateOnly';
import {
  auditScheduleAgainstClocks,
  type AuditResult,
  type AuditShift,
} from '@/utils/scheduleClockAudit';
import { bufferPunchFetchRange } from '@/utils/punchWindow';
import { fetchAllRows } from '@/utils/fetchAllRows';

/**
 * Compare the scheduled shifts with the time punches for a pay period.
 *
 * `start`/`end` are viewer-local calendar-day tokens, the same contract
 * `usePayroll` uses — converted here to restaurant-zone instants before any
 * fetch or comparison. Converting the raw tokens directly would query and
 * filter against the VIEWER's day boundaries, not the restaurant's, and drop
 * or misplace shifts near midnight when the two zones differ.
 *
 * The punch fetch window grows by the overnight buffer so a shift that
 * crosses the period boundary still finds both of its punches.
 */
export function useScheduleClockAudit(
  restaurantId: string | null,
  start: Date,
  end: Date,
  toleranceMinutes: number,
) {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const { tz: timezone } = useRestaurantClock();

  // The memo dependencies below are the primitive `startMs`/`endMs`, not the
  // `start`/`end` Date objects: the caller (Payroll.tsx's `getDateRange`)
  // rebuilds `start`/`end` as new Date instances on every render, which
  // would otherwise bust every memo below on every unrelated page re-render.
  const { dayStart, dayEnd } = useMemo(() => {
    const range = businessDayRangeToInstants(
      toDateOnlyString(start),
      toDateOnlyString(end),
      timezone,
    );
    return { dayStart: range.start, dayEnd: range.end };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on primitives, not the Date objects
  }, [startMs, endMs, timezone]);

  const { fetchStart, fetchEnd } = useMemo(
    () => bufferPunchFetchRange(dayStart, dayEnd),
    [dayStart, dayEnd],
  );

  const {
    data: shifts,
    isLoading: shiftsLoading,
    error: shiftsError,
  } = useQuery({
    // Widen the lower bound by the overnight buffer so a shift that starts
    // the day before the period, but overlaps into it, is still fetched. No
    // need to widen the upper bound: a shift starting after `dayEnd` cannot
    // overlap the period. `auditScheduleAgainstClocks` then applies the real
    // overlap rule (start_time <= rangeEnd, end_time >= rangeStart) so a
    // shift that only got fetched because of this widened window, but does
    // not actually overlap the period, is excluded.
    queryKey: ['shifts', 'clock-audit', restaurantId, fetchStart.toISOString(), dayEnd.toISOString()],
    queryFn: async () => {
      if (!restaurantId) return [];
      // Paginated via `fetchAllRows` (not a single unbounded `.select()`):
      // PostgREST caps an unpaginated response at 1,000 rows, which would
      // silently drop shifts once a pay period at a busy restaurant crosses
      // that threshold — the exact condition this audit exists to catch.
      // The `.order('id')` tiebreaker makes each page boundary deterministic
      // when multiple shifts share a `start_time`.
      const { rows, capped } = await fetchAllRows<AuditShift>((from, to) =>
        supabase
          .from('shifts')
          .select(
            'id, restaurant_id, employee_id, start_time, end_time, break_duration, position, status, is_published',
          )
          .eq('restaurant_id', restaurantId)
          .gte('start_time', fetchStart.toISOString())
          .lte('start_time', dayEnd.toISOString())
          .order('start_time', { ascending: true })
          .order('id')
          .range(from, to),
      );
      // A capped result is a truncated shift list. An audit on a truncated
      // list reports real shifts as absent. Fail loudly instead.
      if (capped) {
        throw new Error(
          'The shift list is incomplete: the query hit the page cap. Select a shorter date range.',
        );
      }
      return rows;
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const {
    punches,
    loading: punchesLoading,
    error: punchesError,
  } = useTimePunches(restaurantId, undefined, fetchStart, fetchEnd);

  const result: AuditResult = useMemo(
    () =>
      auditScheduleAgainstClocks(shifts ?? [], punches, dayStart, dayEnd, {
        toleranceMinutes,
      }),
    [shifts, punches, dayStart, dayEnd, toleranceMinutes],
  );

  return {
    rows: result.rows,
    summary: result.summary,
    loading: shiftsLoading || punchesLoading,
    error: shiftsError || punchesError || null,
  };
}
