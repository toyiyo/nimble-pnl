import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useApproverCount(restaurantId: string | undefined) {
  return useQuery({
    queryKey: ['approver-count', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return 0;
      const { count, error } = await supabase
        .from('user_restaurants')
        .select('*', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .in('role', ['owner', 'manager']);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
