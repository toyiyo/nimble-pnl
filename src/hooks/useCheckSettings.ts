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
  const restaurantId = selectedRestaurant?.restaurant_id;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['check-settings', restaurantId],
    queryFn: async () => {
      if (!restaurantId) throw new Error('No restaurant selected');

      const { data, error } = await supabase
        .from('check_settings' as any)
        .select('id, restaurant_id, business_name, business_address_line1, business_address_line2, business_city, business_state, business_zip, created_at, updated_at')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error) throw error;
      return data as unknown as CheckSettings | null;
    },
    enabled: !!restaurantId,
    staleTime: 60_000,
  });

  const saveSettings = useMutation({
    mutationFn: async (input: UpsertCheckSettingsInput) => {
      if (!restaurantId) throw new Error('No restaurant selected');

      const { data, error } = await supabase
        .from('check_settings' as any)
        .upsert(
          { restaurant_id: restaurantId, ...input },
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
