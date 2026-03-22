import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ConflictCheck } from '@/types/scheduling';

export interface ConflictCheckParams {
  employeeId: string;
  restaurantId: string;
  startTime: string; // ISO timestamp
  endTime: string; // ISO timestamp
}

interface TimeOffConflictResponse {
  has_conflict: boolean;
  time_off_id: string;
  start_date: string;
  end_date: string;
  status: string;
}

interface AvailabilityConflictResponse {
  has_conflict: boolean;
  conflict_type: 'recurring' | 'exception';
  message: string;
  available_start: string | null;
  available_end: string | null;
}

/**
 * Fetch all scheduling conflicts (time-off + availability) for a proposed shift.
 * Shared by both the reactive hook and imperative helper.
 */
async function fetchConflicts(
  params: ConflictCheckParams,
): Promise<{ conflicts: ConflictCheck[]; hasConflicts: boolean }> {
  const conflicts: ConflictCheck[] = [];

  const { data: timeOffConflicts, error: timeOffError } = await supabase
    .rpc('check_timeoff_conflict', {
      p_employee_id: params.employeeId,
      p_start_time: params.startTime,
      p_end_time: params.endTime,
    });

  if (timeOffError) throw timeOffError;

  if (timeOffConflicts && timeOffConflicts.length > 0) {
    for (const conflict of timeOffConflicts as TimeOffConflictResponse[]) {
      conflicts.push({
        has_conflict: true,
        conflict_type: 'time-off',
        message: `Employee has ${conflict.status} time-off from ${conflict.start_date} to ${conflict.end_date}`,
        time_off_id: conflict.time_off_id,
        start_date: conflict.start_date,
        end_date: conflict.end_date,
        status: conflict.status,
      });
    }
  }

  const { data: availabilityConflicts, error: availError } = await supabase
    .rpc('check_availability_conflict', {
      p_employee_id: params.employeeId,
      p_restaurant_id: params.restaurantId,
      p_start_time: params.startTime,
      p_end_time: params.endTime,
    });

  if (availError) throw availError;

  if (availabilityConflicts && availabilityConflicts.length > 0) {
    for (const conflict of availabilityConflicts as AvailabilityConflictResponse[]) {
      conflicts.push({
        has_conflict: true,
        conflict_type: conflict.conflict_type,
        message: conflict.message,
        available_start: conflict.available_start ?? undefined,
        available_end: conflict.available_end ?? undefined,
      });
    }
  }

  return { conflicts, hasConflicts: conflicts.length > 0 };
}

export function useCheckConflicts(params: ConflictCheckParams | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['conflict-check', params?.employeeId, params?.startTime, params?.endTime],
    queryFn: () => {
      if (!params) return { conflicts: [] as ConflictCheck[], hasConflicts: false };
      return fetchConflicts(params);
    },
    enabled: !!params && !!params.employeeId && !!params.startTime && !!params.endTime,
    staleTime: 10000,
    refetchOnWindowFocus: true,
  });

  return {
    conflicts: data?.conflicts || [],
    hasConflicts: data?.hasConflicts || false,
    loading: isLoading,
    error,
  };
}

/**
 * Imperative (non-reactive) conflict check for use in event handlers.
 * Calls the same RPCs as useCheckConflicts but returns a Promise.
 */
export async function checkConflictsImperative(
  params: ConflictCheckParams,
): Promise<{ conflicts: ConflictCheck[]; hasConflicts: boolean }> {
  return fetchConflicts(params);
}
