import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useConnectedBanks(restaurantId: string | null | undefined, enabled: boolean = true) {
  return useQuery({
    queryKey: ['connected-banks', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];
      
      const { data, error } = await supabase
        .from('connected_banks')
        .select('*, bank_account_balances(*)')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'connected')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!restaurantId && enabled,
    staleTime: 60_000, // 1 minute
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
}
