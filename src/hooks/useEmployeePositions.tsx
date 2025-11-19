import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const useEmployeePositions = (restaurantId: string | null) => {
  const { data: positions, isLoading, error } = useQuery({
    queryKey: ['employee-positions', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      // Fetch distinct positions from employees table
      const { data, error } = await supabase
        .from('employees')
        .select('position')
        .eq('restaurant_id', restaurantId);

      if (error) throw error;

      // Extract unique positions and sort alphabetically
      const uniquePositions = Array.from(
        new Set(data.map((employee) => employee.position).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b));

      return uniquePositions as string[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
  });

  return {
    positions: positions || [],
    isLoading,
    error,
  };
};
