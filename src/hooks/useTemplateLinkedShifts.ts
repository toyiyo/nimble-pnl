import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import type { LinkedShift } from '@/lib/scheduling/templateHoursBuckets';

interface TemplateLinkedShiftsResult {
  shifts: LinkedShift[];
  /** Shifts linked to the template with `start_time` before the cutoff. */
  pastCount: number;
}

async function fetchTemplateLinkedShifts(
  restaurantId: string,
  templateId: string,
): Promise<TemplateLinkedShiftsResult> {
  // Computed once and reused in both predicates below, so the count query's
  // "before" set and the row query's "at or after" set are provably
  // disjoint — no shift can be double-counted or dropped between them.
  const cutoff = new Date().toISOString();

  const [countResult, rowsResult] = await Promise.all([
    // Exact count of past shifts — PostgREST's row cap (default 1000) never
    // touches this, unlike fetching every row and counting client-side.
    supabase.from('shifts')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .eq('shift_template_id', templateId)
      .lt('start_time', cutoff),
    // Row data is bounded to future/current shifts only — an ascending
    // order on an unbounded historical join used to let PostgREST's cap
    // truncate exactly the future shifts the ledger needs to count.
    supabase.from('shifts')
      .select('id, start_time, end_time, is_published, locked, employee_id, employee:employees!employee_id(name)')
      .eq('restaurant_id', restaurantId)
      .eq('shift_template_id', templateId)
      .gte('start_time', cutoff)
      .order('start_time'),
  ]);

  if (countResult.error) throw countResult.error;
  if (rowsResult.error) throw rowsResult.error;

  const shifts = (rowsResult.data ?? []).map((row): LinkedShift => ({
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

  return { shifts, pastCount: countResult.count ?? 0 };
}

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
): {
  shifts: LinkedShift[];
  pastCount: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['template-linked-shifts', restaurantId, templateId],
    queryFn: (): Promise<TemplateLinkedShiftsResult> => {
      if (!restaurantId || !templateId) return Promise.resolve({ shifts: [], pastCount: 0 });
      return fetchTemplateLinkedShifts(restaurantId, templateId);
    },
    enabled: !!restaurantId && !!templateId,
    staleTime: 30000,
    refetchOnMount: 'always',
  });

  return {
    shifts: data?.shifts ?? [],
    pastCount: data?.pastCount ?? 0,
    isLoading,
    error: (error as Error) ?? null,
    refetch: () => { void refetch(); },
  };
}
