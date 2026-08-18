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
  const {
    data: shifts,
    isLoading: shiftsLoading,
    error: shiftsError,
  } = useQuery({
    queryKey: ['shifts', 'clock-audit', restaurantId, start.toISOString(), end.toISOString()],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('shifts')
        .select(
          'id, restaurant_id, employee_id, start_time, end_time, break_duration, position, status, is_published',
        )
        .eq('restaurant_id', restaurantId)
        .gte('start_time', start.toISOString())
        .lte('start_time', end.toISOString());
      if (error) throw error;
      return (data ?? []) as AuditShift[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const { fetchStart, fetchEnd } = useMemo(
    () => bufferPunchFetchRange(start, end),
    [start, end],
  );

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
    [shifts, punches, start, end, toleranceMinutes],
  );

  return {
    rows: result.rows,
    summary: result.summary,
    loading: shiftsLoading || punchesLoading,
    error: shiftsError || punchesError || null,
  };
}
