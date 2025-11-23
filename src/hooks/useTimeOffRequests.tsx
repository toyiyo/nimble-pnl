import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TimeOffRequest } from '@/types/scheduling';

export const useTimeOffRequests = (restaurantId: string | null) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['timeOffRequests', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('time_off_requests')
        .select('*, employee:employees(*)')
        .eq('restaurant_id', restaurantId)
        .order('start_date', { ascending: false });

      if (error) throw error;

      return data as TimeOffRequest[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    timeOffRequests: data || [],
    loading: isLoading,
    error,
  };
};
