import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useTimePunches } from '@/hooks/useTimePunches';
import {
  auditScheduleAgainstClocks,
  type AuditResult,
  type AuditShift,
} from '@/utils/scheduleClockAudit';
import { bufferPunchFetchRange } from '@/utils/punchWindow';

/**
 * Compare the scheduled shifts with the time punches for a pay period.
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

  // The memo dependencies below are the primitive `startMs`/`endMs`, not the
  // `start`/`end` Date objects: the caller (Payroll.tsx's `getDateRange`)
  // rebuilds `start`/`end` as new Date instances on every render, which
  // would otherwise bust every memo below on every unrelated page re-render.
  const { fetchStart, fetchEnd } = useMemo(
    () => bufferPunchFetchRange(start, end),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on primitives, not the Date objects
    [startMs, endMs],
  );

  const {
    data: shifts,
    isLoading: shiftsLoading,
    error: shiftsError,
  } = useQuery({
    // Widen the lower bound by the overnight buffer so a shift that starts
    // the day before the period, but overlaps into it, is still fetched. No
    // need to widen the upper bound: a shift starting after `end` cannot
    // overlap the period. `auditScheduleAgainstClocks` then applies the real
    // overlap rule (start_time <= rangeEnd, end_time >= rangeStart) so a
    // shift that only got fetched because of this widened window, but does
    // not actually overlap the period, is excluded.
    queryKey: ['shifts', 'clock-audit', restaurantId, fetchStart.toISOString(), end.toISOString()],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('shifts')
        .select(
          'id, restaurant_id, employee_id, start_time, end_time, break_duration, position, status, is_published',
        )
        .eq('restaurant_id', restaurantId)
        .gte('start_time', fetchStart.toISOString())
        .lte('start_time', end.toISOString());
      if (error) throw error;
      return (data ?? []) as AuditShift[];
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
      auditScheduleAgainstClocks(shifts ?? [], punches, start, end, {
        toleranceMinutes,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start/end keyed on primitives (startMs/endMs), not the Date objects
    [shifts, punches, startMs, endMs, toleranceMinutes],
  );

  return {
    rows: result.rows,
    summary: result.summary,
    loading: shiftsLoading || punchesLoading,
    error: shiftsError || punchesError || null,
  };
}
