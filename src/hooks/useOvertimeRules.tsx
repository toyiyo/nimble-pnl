import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { OvertimeRules } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

export const useOvertimeRules = (restaurantId: string | null) => {
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['overtimeRules', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;

      const { data, error } = await supabase
        .from('overtime_rules')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .single();

      if (error) {
        // If no rules exist, return default values
        if (error.code === 'PGRST116') {
          return {
            restaurant_id: restaurantId,
            daily_threshold_minutes: 480, // 8 hours
            weekly_threshold_minutes: 2400, // 40 hours
            enabled: true,
          } as Partial<OvertimeRules>;
        }
        throw error;
      }

      return data as OvertimeRules;
    },
    enabled: !!restaurantId,
    staleTime: 60000, // 1 minute
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    overtimeRules: data,
    loading: isLoading,
    error,
  };
};

export const useUpdateOvertimeRules = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (rules: Partial<OvertimeRules> & { restaurant_id: string }) => {
      // Check if rules exist
      const { data: existing } = await supabase
        .from('overtime_rules')
        .select('id')
        .eq('restaurant_id', rules.restaurant_id)
        .single();

      if (existing) {
        // Update existing rules
        const { data, error } = await supabase
          .from('overtime_rules')
          .update({
            daily_threshold_minutes: rules.daily_threshold_minutes,
            weekly_threshold_minutes: rules.weekly_threshold_minutes,
            enabled: rules.enabled,
          })
          .eq('restaurant_id', rules.restaurant_id)
          .select()
          .single();

        if (error) throw error;
        return data as OvertimeRules;
      } else {
        // Create new rules
        const { data, error } = await supabase
          .from('overtime_rules')
          .insert({
            restaurant_id: rules.restaurant_id,
            daily_threshold_minutes: rules.daily_threshold_minutes || 480,
            weekly_threshold_minutes: rules.weekly_threshold_minutes || 2400,
            enabled: rules.enabled ?? true,
          })
          .select()
          .single();

        if (error) throw error;
        return data as OvertimeRules;
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['overtimeRules', data.restaurant_id] });
      toast({
        title: 'Overtime rules updated',
        description: 'Your overtime settings have been saved.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating overtime rules',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
