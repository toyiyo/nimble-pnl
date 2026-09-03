import { useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import {
  SHIFT_PROTECTION_DEFAULTS,
  type ShiftProtectionSettings,
} from '@/lib/shiftProtection';

export const shiftProtectionQueryKey = (restaurantId: string | null) =>
  ['shift-protection', restaurantId] as const;

/**
 * Read the Shift Protection rules through get_shift_protection_settings.
 * The RPC admits restaurant members AND active employees, so this works
 * in the employee portal where staffing_settings RLS does not.
 *
 * The client fails open: on error the defaults (everything off) apply,
 * and the server triggers stay the backstop for block mode.
 */
export function useShiftProtection(restaurantId: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: shiftProtectionQueryKey(restaurantId),
    queryFn: async (): Promise<ShiftProtectionSettings> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
      const { data, error } = await (supabase.rpc as any)('get_shift_protection_settings', {
        p_restaurant_id: restaurantId,
      });
      if (error) throw error;
      return { ...SHIFT_PROTECTION_DEFAULTS, ...(data ?? {}) };
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });

  return {
    protection: data ?? SHIFT_PROTECTION_DEFAULTS,
    isLoading,
    error,
  };
}

export interface TimeoffDayCount {
  day: string;
  approved_count: number;
}

/**
 * Per-day counts of other approved same-position time off, for the
 * request dialog warning. Counts only — the RPC returns no names.
 */
export function useTimeoffDayCounts(
  restaurantId: string | null,
  employeeId: string | null,
  startDate: string | null,
  endDate: string | null
) {
  return useQuery({
    queryKey: ['timeoff-day-counts', restaurantId, employeeId, startDate, endDate],
    queryFn: async (): Promise<TimeoffDayCount[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
      const { data, error } = await (supabase.rpc as any)('get_timeoff_day_counts', {
        p_restaurant_id: restaurantId,
        p_employee_id: employeeId,
        p_start: startDate,
        p_end: endDate,
      });
      if (error) throw error;
      return (data ?? []) as TimeoffDayCount[];
    },
    enabled: !!restaurantId && !!employeeId && !!startDate && !!endDate && startDate <= endDate,
    staleTime: 30000,
  });
}

export interface CoverageImpactShift {
  shift_id: string;
  shift_date: string;
  position: string;
  start_time: string;
  end_time: string;
  required: number;
  current_count: number;
  after_count: number;
}

export interface CoverageImpact {
  shifts: CoverageImpactShift[];
  overlapping_approved: number;
}

/**
 * Coverage impact of a time-off approval, for the manager queue.
 * Fetch lazily — pass null until the approve action needs it.
 */
export function useTimeoffCoverageImpact(requestId: string | null) {
  return useQuery({
    queryKey: ['timeoff-coverage-impact', requestId],
    queryFn: async (): Promise<CoverageImpact> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
      const { data, error } = await (supabase.rpc as any)('get_timeoff_coverage_impact', {
        p_request_id: requestId,
      });
      if (error) throw error;
      return {
        shifts: (data?.shifts ?? []) as CoverageImpactShift[],
        overlapping_approved: (data?.overlapping_approved ?? 0) as number,
      };
    },
    enabled: !!requestId,
    staleTime: 30000,
  });
}

/**
 * Invalidate the protection rules after a settings save, so the warning
 * panels never read stale rules (the staffing-settings upsert
 * invalidates only its own key).
 */
export function useInvalidateShiftProtection() {
  const queryClient = useQueryClient();
  return (restaurantId: string | null) =>
    queryClient.invalidateQueries({ queryKey: shiftProtectionQueryKey(restaurantId) });
}
