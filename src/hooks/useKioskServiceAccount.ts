import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from './use-toast';

export type KioskServiceAccount = {
  id: string;
  restaurant_id: string;
  user_id: string;
  email: string;
  created_at: string;
};

export const useKioskServiceAccount = (restaurantId: string | null) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['kioskServiceAccount', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;
      const { data, error } = await supabase
        .from('kiosk_service_accounts')
        .select('id, restaurant_id, user_id, email, created_at')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error) {
        if (error.code === 'PGRST116') return null; // no rows
        throw error;
      }
      return (data as KioskServiceAccount) || null;
    },
    enabled: !!restaurantId,
    staleTime: 15000,
  });

  const createOrRotate = useMutation({
    mutationFn: async ({ rotate }: { rotate?: boolean }) => {
      if (!restaurantId) throw new Error('Restaurant required');
      const { data, error } = await supabase.functions.invoke('create-kiosk-service-account', {
        body: { restaurantId, rotate: rotate ?? true },
      });
      if (error) throw error;
      return data as { email: string; password: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kioskServiceAccount', restaurantId] });
    },
    onError: (error: any) => {
      toast({
        title: 'Could not create kiosk login',
        description: error?.message || 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  return {
    account: data,
    loading: isLoading,
    error,
    createOrRotate,
  };
};
