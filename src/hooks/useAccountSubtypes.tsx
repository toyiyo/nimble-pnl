import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AccountSubtypes {
  asset: string[];
  liability: string[];
  equity: string[];
  revenue: string[];
  expense: string[];
  cogs: string[];
}

export const useAccountSubtypes = () => {
  return useQuery({
    queryKey: ['account-subtypes'],
    queryFn: async () => {
      // Query PostgreSQL system tables to get enum values
      const { data, error } = await supabase.rpc('get_account_subtypes');
      
      if (error) throw error;
      
      return data as AccountSubtypes;
    },
    staleTime: 1000 * 60 * 60, // Cache for 1 hour since enum values rarely change
  });
};
