import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface TipContributionPool {
  id: string;
  restaurant_id: string;
  settings_id: string;
  name: string;
  contribution_percentage: number;
  share_method: 'hours' | 'role' | 'even';
  role_weights: Record<string, number>;
  eligible_employee_ids: string[];
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type CreatePoolInput = {
  name: string;
  contribution_percentage: number;
  share_method: 'hours' | 'role' | 'even';
  role_weights?: Record<string, number>;
  eligible_employee_ids: string[];
  sort_order?: number;
};

export type UpdatePoolInput = Partial<
  Pick<TipContributionPool, 'name' | 'contribution_percentage' | 'share_method' | 'role_weights' | 'eligible_employee_ids' | 'sort_order'>
>;

export function useTipContributionPools(restaurantId: string | null, settingsId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: pools = [], isLoading, error } = useQuery({
    queryKey: ['tip-contribution-pools', settingsId],
    queryFn: async () => {
      if (!settingsId) return [];

      const { data, error } = await supabase
        .from('tip_contribution_pools')
        .select('*')
        .eq('settings_id', settingsId)
        .eq('active', true)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return (data ?? []) as TipContributionPool[];
    },
    enabled: !!settingsId,
    staleTime: 30000,
  });

  const { mutateAsync: createPool, isPending: isCreating } = useMutation({
    mutationFn: async (input: CreatePoolInput) => {
      if (!restaurantId || !settingsId) throw new Error('Missing restaurant or settings');

      const { data, error } = await supabase
        .from('tip_contribution_pools')
        .insert({
          restaurant_id: restaurantId,
          settings_id: settingsId,
          name: input.name,
          contribution_percentage: input.contribution_percentage,
          share_method: input.share_method,
          role_weights: input.role_weights ?? {},
          eligible_employee_ids: input.eligible_employee_ids,
          sort_order: input.sort_order ?? pools.length,
        })
        .select()
        .single();

      if (error) throw error;
      return data as TipContributionPool;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tip-contribution-pools', settingsId] });
    },
    onError: (error: Error) => {
      toast({ title: 'Error creating pool', description: error.message, variant: 'destructive' });
    },
  });

  const { mutateAsync: updatePool, isPending: isUpdating } = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: UpdatePoolInput }) => {
      const { data, error } = await supabase
        .from('tip_contribution_pools')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as TipContributionPool;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tip-contribution-pools', settingsId] });
    },
    onError: (error: Error) => {
      toast({ title: 'Error updating pool', description: error.message, variant: 'destructive' });
    },
  });

  const { mutateAsync: deletePool, isPending: isDeleting } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('tip_contribution_pools')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tip-contribution-pools', settingsId] });
    },
    onError: (error: Error) => {
      toast({ title: 'Error deleting pool', description: error.message, variant: 'destructive' });
    },
  });

  const totalContributionPercentage = pools.reduce((sum, p) => sum + Number(p.contribution_percentage), 0);

  return {
    pools,
    isLoading,
    error,
    createPool,
    isCreating,
    updatePool,
    isUpdating,
    deletePool,
    isDeleting,
    totalContributionPercentage,
  };
}
