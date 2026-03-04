import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { toast } from 'sonner';

export interface CheckSettings {
  id: string;
  restaurant_id: string;
  business_name: string;
  business_address_line1: string | null;
  business_address_line2: string | null;
  business_city: string | null;
  business_state: string | null;
  business_zip: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertCheckSettingsInput {
  business_name: string;
  business_address_line1?: string | null;
  business_address_line2?: string | null;
  business_city?: string | null;
  business_state?: string | null;
  business_zip?: string | null;
}

export function useCheckSettings() {
  const { selectedRestaurant } = useRestaurantContext();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['check-settings', selectedRestaurant?.restaurant_id],
    queryFn: async () => {
      if (!selectedRestaurant?.restaurant_id) throw new Error('No restaurant selected');

      const { data, error } = await supabase
        .from('check_settings' as any)
        .select('id, restaurant_id, business_name, business_address_line1, business_address_line2, business_city, business_state, business_zip, created_at, updated_at')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .maybeSingle();

      if (error) throw error;
      return data as unknown as CheckSettings | null;
    },
    enabled: !!selectedRestaurant?.restaurant_id,
    staleTime: 5 * 60 * 1000, // 5 minutes — settings rarely change
  });

  const saveSettings = useMutation({
    mutationFn: async (input: UpsertCheckSettingsInput) => {
      if (!selectedRestaurant?.restaurant_id) throw new Error('No restaurant selected');

      // Upsert: insert if no row exists, update if one does
      const { data, error } = await supabase
        .from('check_settings' as any)
        .upsert(
          {
            restaurant_id: selectedRestaurant.restaurant_id,
            ...input,
          },
          { onConflict: 'restaurant_id' },
        )
        .select()
        .single();

      if (error) throw error;
      return data as unknown as CheckSettings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['check-settings'] });
      toast.success('Check settings saved');
    },
    onError: (error: Error) => {
      toast.error(`Failed to save settings: ${error.message}`);
    },
  });

  return {
    settings: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    saveSettings,
  };
}
