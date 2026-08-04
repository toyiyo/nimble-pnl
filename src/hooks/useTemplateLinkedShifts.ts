import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import type { LinkedShift } from '@/lib/scheduling/templateHoursBuckets';

/**
 * Every shift linked to a template, with only the fields the hour-cascade
 * buckets need.
 *
 * Critically, this query does NOT depend on the new times the manager is
 * typing. Fetch once on dialog open; every recompute is pure client-side
 * bucketing, so a keystroke never becomes a network request.
 *
 * Shape mirrors the sibling impact hook, useTemplateDeletionImpact:
 * refetchOnMount 'always' so a stale cached list cannot understate the blast
 * radius of a change the manager is about to commit.
 */
export function useTemplateLinkedShifts(
  restaurantId: string | null,
  templateId: string | null
): { shifts: LinkedShift[]; isLoading: boolean; error: Error | null; refetch: () => void } {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['template-linked-shifts', restaurantId, templateId],
    queryFn: async (): Promise<LinkedShift[]> => {
      if (!restaurantId || !templateId) return [];

      const { data, error } = await (supabase.from('shifts') as any)
        .select('id, start_time, end_time, is_published, locked, employee_id, employee:employees!employee_id(name)')
        .eq('restaurant_id', restaurantId)
        .eq('shift_template_id', templateId)
        .order('start_time');

      if (error) throw error;

      return (data ?? []).map((row: any): LinkedShift => ({
        id: row.id,
        start_time: row.start_time,
        end_time: row.end_time,
        is_published: !!row.is_published,
        locked: !!row.locked,
        employee_id: row.employee_id,
        // employee_id is NOT NULL, so this is null only when the join failed
        // to resolve a name — never "unassigned".
        employeeName: row.employee?.name ?? null,
      }));
    },
    enabled: !!restaurantId && !!templateId,
    staleTime: 30000,
    refetchOnMount: 'always',
  });

  return {
    shifts: data ?? [],
    isLoading,
    error: (error as Error) ?? null,
    refetch: () => { void refetch(); },
  };
}
