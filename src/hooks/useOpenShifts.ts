import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { OpenShift } from '@/types/scheduling';

export function useOpenShifts(restaurantId: string | null, weekStart: Date | null, weekEnd: Date | null) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['open_shifts', restaurantId, weekStart?.toISOString(), weekEnd?.toISOString()],
    queryFn: async () => {
      if (!restaurantId || !weekStart || !weekEnd) return [];

      const startStr = weekStart.toISOString().split('T')[0];
      const endStr = weekEnd.toISOString().split('T')[0];

      const { data, error } = await (supabase.rpc as any)('get_open_shifts', {
        p_restaurant_id: restaurantId,
        p_week_start: startStr,
        p_week_end: endStr,
      });

      if (error) throw error;
      return (data ?? []) as OpenShift[];
    },
    enabled: !!restaurantId && !!weekStart && !!weekEnd,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return { openShifts: data ?? [], loading: isLoading, error, refetch };
}
