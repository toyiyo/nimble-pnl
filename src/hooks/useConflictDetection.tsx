import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ConflictCheck } from '@/types/scheduling';

interface ConflictCheckParams {
  employeeId: string;
  restaurantId: string;
  startTime: string; // ISO timestamp
  endTime: string; // ISO timestamp
}

export const useCheckConflicts = (params: ConflictCheckParams | null) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['conflict-check', params?.employeeId, params?.startTime, params?.endTime],
    queryFn: async () => {
      if (!params) return { conflicts: [], hasConflicts: false };

      const conflicts: ConflictCheck[] = [];

      // Check time-off conflicts
      const { data: timeOffConflicts, error: timeOffError } = await supabase
        .rpc('check_timeoff_conflict', {
          p_employee_id: params.employeeId,
          p_start_time: params.startTime,
          p_end_time: params.endTime,
        });

      if (timeOffError) throw timeOffError;

      if (timeOffConflicts && timeOffConflicts.length > 0) {
        timeOffConflicts.forEach((conflict: any) => {
          conflicts.push({
            has_conflict: true,
            conflict_type: 'time-off',
            message: `Employee has ${conflict.status} time-off from ${conflict.start_date} to ${conflict.end_date}`,
            time_off_id: conflict.time_off_id,
            start_date: conflict.start_date,
            end_date: conflict.end_date,
            status: conflict.status,
          });
        });
      }

      // Check availability conflicts
      const { data: availabilityConflicts, error: availError } = await supabase
        .rpc('check_availability_conflict', {
          p_employee_id: params.employeeId,
          p_restaurant_id: params.restaurantId,
          p_start_time: params.startTime,
          p_end_time: params.endTime,
        });

      if (availError) throw availError;

      if (availabilityConflicts && availabilityConflicts.length > 0) {
        availabilityConflicts.forEach((conflict: any) => {
          conflicts.push({
            has_conflict: true,
            conflict_type: conflict.conflict_type,
            message: conflict.message,
          });
        });
      }

      return {
        conflicts,
        hasConflicts: conflicts.length > 0,
      };
    },
    enabled: !!params && !!params.employeeId && !!params.startTime && !!params.endTime,
    staleTime: 10000, // 10 seconds - conflicts should be checked frequently
    refetchOnWindowFocus: true,
  });

  return {
    conflicts: data?.conflicts || [],
    hasConflicts: data?.hasConflicts || false,
    loading: isLoading,
    error,
  };
};
