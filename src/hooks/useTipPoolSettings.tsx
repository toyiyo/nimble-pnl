import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type TipSource = 'manual' | 'pos';
export type ShareMethod = 'hours' | 'role' | 'manual';
export type SplitCadence = 'daily' | 'weekly' | 'shift';

export interface TipPoolSettings {
  id: string;
  restaurant_id: string;
  tip_source: TipSource | null;
  share_method: ShareMethod | null;
  split_cadence: SplitCadence | null;
  role_weights: Record<string, number>;
  enabled_employee_ids: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TipPoolSettingsUpdate {
  tip_source?: TipSource;
  share_method?: ShareMethod;
  split_cadence?: SplitCadence;
  role_weights?: Record<string, number>;
  enabled_employee_ids?: string[];
}

/**
 * Hook to manage tip pool settings for a restaurant
 * Provides loading, saving, and updating of tip pooling configuration
 */
export function useTipPoolSettings(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch active settings
  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['tip-pool-settings', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;

      const { data, error } = await supabase
        .from('tip_pool_settings')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('active', true)
        .maybeSingle();

      if (error) throw error;
      return data as TipPoolSettings | null;
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
  });

  // Update settings (upsert)
  const { mutate: updateSettings, isPending: isUpdating } = useMutation({
    mutationFn: async (updates: TipPoolSettingsUpdate) => {
      if (!restaurantId) throw new Error('No restaurant selected');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // If settings exist, update them
      if (settings?.id) {
        const { data, error } = await supabase
          .from('tip_pool_settings')
          .update({
            ...updates,
            updated_at: new Date().toISOString(),
          })
          .eq('id', settings.id)
          .select()
          .single();

        if (error) throw error;
        return data;
      }

      // Otherwise, create new settings
      const { data, error } = await supabase
        .from('tip_pool_settings')
        .insert({
          restaurant_id: restaurantId,
          ...updates,
          active: true,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tip-pool-settings', restaurantId] });
      toast({
        title: 'Settings saved',
        description: 'Tip pooling preferences have been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error saving settings',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Reset to defaults
  const { mutate: resetSettings, isPending: isResetting } = useMutation({
    mutationFn: async () => {
      if (!settings?.id) return;

      const { error } = await supabase
        .from('tip_pool_settings')
        .update({ active: false })
        .eq('id', settings.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tip-pool-settings', restaurantId] });
      toast({
        title: 'Settings reset',
        description: 'Tip pooling has been reset to defaults.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error resetting settings',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    settings,
    isLoading,
    error,
    updateSettings,
    isUpdating,
    resetSettings,
    isResetting,
    hasSettings: !!settings,
  };
}
