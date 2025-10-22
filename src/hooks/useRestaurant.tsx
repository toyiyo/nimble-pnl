import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface Restaurant {
  name: string;
}

export function useRestaurant(restaurantId: string | undefined) {
  return useQuery({
    queryKey: ['restaurant', restaurantId],
    queryFn: async () => {
      if (!restaurantId) throw new Error('Restaurant ID is required');
      
      const { data, error } = await supabase
        .from('restaurants')
        .select('name')
        .eq('id', restaurantId)
        .single();
      
      if (error) throw error;
      return data as Restaurant;
    },
    enabled: !!restaurantId,
    staleTime: 60_000, // 1 minute
  });
}
