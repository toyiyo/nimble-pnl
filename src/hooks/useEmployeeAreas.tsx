import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const DEFAULT_AREAS = [
  'Back of House',
  'Front of House',
  'Bar',
  'Management',
];

/** Merge and deduplicate area arrays, sorted alphabetically */
export function mergeAreas(employeeAreas: string[], templateAreas: string[]): string[] {
  const unique = new Set([...employeeAreas, ...templateAreas]);
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

export const useEmployeeAreas = (restaurantId: string | null) => {
  const { data: areas, isLoading, error } = useQuery({
    queryKey: ['restaurant-areas', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const [employeesResult, templatesResult] = await Promise.all([
        supabase
          .from('employees')
          .select('area' as any)
          .eq('restaurant_id', restaurantId)
          .not('area', 'is', null),
        supabase
          .from('shift_templates')
          .select('area' as any)
          .eq('restaurant_id', restaurantId)
          .not('area', 'is', null),
      ]);

      if (employeesResult.error) throw employeesResult.error;
      if (templatesResult.error) throw templatesResult.error;

      const employeeAreas = (employeesResult.data as any[])
        .map((e) => e.area as string)
        .filter(Boolean);

      const templateAreas = (templatesResult.data as any[])
        .map((t) => t.area as string)
        .filter(Boolean);

      return mergeAreas(employeeAreas, templateAreas);
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
