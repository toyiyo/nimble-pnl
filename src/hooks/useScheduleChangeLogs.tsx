import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ScheduleChangeLog } from '@/types/scheduling';

type ChangeLogParams = {
  restaurantId?: string | null;
  shiftId?: string | null;
  startDate?: Date;
  endDate?: Date;
};

const fetchChangeLogs = async ({ restaurantId, shiftId, startDate, endDate }: ChangeLogParams) => {
  if (!restaurantId && !shiftId) return [];

  let query = supabase
    .from('schedule_change_logs')
    .select('*, employee:employees(*)');

  if (restaurantId) {
    query = query.eq('restaurant_id', restaurantId);
  }

  if (shiftId) {
    query = query.eq('shift_id', shiftId);
  }

  if (startDate) {
    query = query.gte('changed_at', startDate.toISOString());
  }

  if (endDate) {
    query = query.lte('changed_at', endDate.toISOString());
  }

  const { data, error } = await query.order('changed_at', { ascending: false });
  if (error) throw error;
  return data as ScheduleChangeLog[];
};

export const useScheduleChangeLogs = (
  restaurantId: string | null,
  startDate?: Date,
  endDate?: Date
) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['schedule_change_logs', restaurantId, startDate?.toISOString(), endDate?.toISOString()],
    queryFn: () => fetchChangeLogs({ restaurantId, startDate, endDate }),
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    changeLogs: data || [],
    loading: isLoading,
    error,
  };
};

export const useShiftChangeLogs = (shiftId: string | null) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['shift_change_logs', shiftId],
    queryFn: () => fetchChangeLogs({ shiftId }),
    enabled: !!shiftId,
    staleTime: 30000,
  });

  return {
    changeLogs: data || [],
    loading: isLoading,
    error,
  };
};
