import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Employee } from '@/types/scheduling';

/**
 * Hook to get the employee record for the currently logged-in user
 * This is used for employee self-service features
 */
export const useCurrentEmployee = (restaurantId: string | null) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['current-employee', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // Find employee record linked to this user
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('user_id', user.id)
        .eq('restaurant_id', restaurantId)
        .eq('status', 'active')
        .single();

      if (error) {
        // If no employee found, that's ok (user might be manager/owner only)
        if (error.code === 'PGRST116') return null;
        throw error;
      }

      return data as Employee;
    },
    enabled: !!restaurantId,
    staleTime: 60000, // 1 minute
    refetchOnWindowFocus: false,
  });

  return {
    currentEmployee: data || null,
    loading: isLoading,
    error,
  };
};
