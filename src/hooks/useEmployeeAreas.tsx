import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const DEFAULT_AREAS = [
  'Back of House',
  'Front of House',
  'Bar',
  'Management',
];

export const useEmployeeAreas = (restaurantId: string | null) => {
  const { data: areas, isLoading, error } = useQuery({
    queryKey: ['employee-areas', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('employees')
        .select('area' as any)
        .eq('restaurant_id', restaurantId)
        .not('area', 'is', null);

      if (error) throw error;

      const uniqueAreas = Array.from(
        new Set((data as any[]).map((employee) => employee.area as string).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b));

      return uniqueAreas;
    },
    enabled: !!restaurantId,
    staleTime: 30000,
  });

  return {
    areas: areas || [],
    isLoading,
    error,
  };
};
