import { useMemo } from 'react';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import type { StaffingSettings } from '@/types/scheduling';

const DEFAULTS: Omit<StaffingSettings, 'id' | 'restaurant_id' | 'created_at' | 'updated_at'> = {
  target_splh: 60,
  avg_ticket_size: 8,
  target_labor_pct: 22,
  min_staff: 1,
  lookback_weeks: 4,
  manual_projections: null,
};

export function useStaffingSettings(restaurantId: string | null) {
  const queryClient = useQueryClient();
  const queryKey = ['staffing-settings', restaurantId];

  const { data: settings, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!restaurantId) return null;
      // Generated types may not have the `staffing_settings` table yet (migration ahead of codegen),
      // so we cast to `any` for the query and type the result manually.
      const { data, error } = await (supabase
        .from('staffing_settings') as any)
        .select('id, restaurant_id, target_splh, avg_ticket_size, target_labor_pct, min_staff, lookback_weeks, manual_projections, created_at, updated_at')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error) throw error;
      return data as StaffingSettings | null;
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });

  const upsertMutation = useMutation({
    mutationFn: async (updates: Partial<StaffingSettings>) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const { data, error } = await (supabase
        .from('staffing_settings') as any)
        .upsert(
          { restaurant_id: restaurantId, ...updates },
          { onConflict: 'restaurant_id' },
        )
        .select()
        .single();
      if (error) throw error;
      return data as StaffingSettings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const effectiveSettings = useMemo(() => ({
    ...DEFAULTS,
    ...(settings ?? {}),
  }), [settings]);

  return {
    settings,
    effectiveSettings,
    isLoading,
    updateSettings: upsertMutation.mutateAsync,
    isSaving: upsertMutation.isPending,
  };
}
