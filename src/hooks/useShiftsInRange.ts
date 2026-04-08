import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Shift } from '@/types/scheduling';

export function useShiftsInRange(
  restaurantId: string,
  dateRange: { start: string; end: string } | null,
) {
  return useQuery({
    queryKey: ['shifts', 'import-range', restaurantId, dateRange?.start, dateRange?.end],
    queryFn: async () => {
      if (!dateRange) return [];
      const { data, error } = await supabase
        .from('shifts')
        .select('id, restaurant_id, employee_id, start_time, end_time, break_duration, position, status, is_published, locked, created_at, updated_at')
        .eq('restaurant_id', restaurantId)
        .gte('start_time', dateRange.start)
        .lte('start_time', dateRange.end);
      if (error) throw error;
      return (data ?? []) as Shift[];
    },
    enabled: !!dateRange,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });
}
