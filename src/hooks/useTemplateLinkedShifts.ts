import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import type { LinkedShift } from '@/lib/scheduling/templateHoursBuckets';

interface TemplateLinkedShiftsResult {
  shifts: LinkedShift[];
  /** Shifts linked to the template with `start_time` before the cutoff. */
  pastCount: number;
}

interface LinkedShiftRow {
  id: string;
  start_time: string;
  end_time: string;
  is_published: boolean | null;
  locked: boolean | null;
  employee_id: string;
  employee: { name: string } | null;
}

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

/**
 * Every future/current shift linked to the template, paged.
 *
 * Bounding the query to `>= cutoff` stops PostgREST's row cap from truncating
 * the future shifts the ledger counts, but it does not remove the cap: one
 * template with more future linked shifts than a single page would still
 * understate the blast radius, while the RPC's unpaged UPDATE moves every
 * eligible row. The ledger's whole job is to state that number correctly, so
 * it pages until a short page proves the set is exhausted.
 */
async function fetchFutureLinkedShiftRows(
  restaurantId: string,
  templateId: string,
  cutoff: string,
): Promise<LinkedShiftRow[]> {
  const rows: LinkedShiftRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase.from('shifts')
      .select('id, start_time, end_time, is_published, locked, employee_id, employee:employees!employee_id(name)')
      .eq('restaurant_id', restaurantId)
      .eq('shift_template_id', templateId)
      .gte('start_time', cutoff)
      .order('start_time')
      // Tiebreaker: shifts sharing a start_time have no inherent order, and an
      // unstable one across page boundaries drops and duplicates rows.
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as LinkedShiftRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchTemplateLinkedShifts(
  restaurantId: string,
  templateId: string,
): Promise<TemplateLinkedShiftsResult> {
  // Computed once and reused in both predicates below, so the count query's
  // "before" set and the row query's "at or after" set are provably
  // disjoint — no shift can be double-counted or dropped between them.
  const cutoff = new Date().toISOString();

  const [countResult, rows] = await Promise.all([
    // Exact count of past shifts — PostgREST's row cap (default 1000) never
    // touches this, unlike fetching every row and counting client-side.
    supabase.from('shifts')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .eq('shift_template_id', templateId)
      .lt('start_time', cutoff),
    fetchFutureLinkedShiftRows(restaurantId, templateId, cutoff),
  ]);

  if (countResult.error) throw countResult.error;

  const shifts = rows.map((row): LinkedShift => ({
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
 *
 * `isOpen` is the dialog's own open state, and it is load-bearing.
 * TemplateFormDialog is rendered unconditionally by the planner and closing it
 * only flips `open`, so this query never unmounts and refetchOnMount fires
 * exactly once per page load. Gating `enabled` on `isOpen` — with staleTime 0,
 * so re-enabling always refetches — is what makes the second open see shifts
 * that were linked to the template while the dialog was shut. Without it the
 * ledger can report nothing to move and save with the cascade off.
 */
export function useTemplateLinkedShifts(
  restaurantId: string | null,
  templateId: string | null,
  isOpen: boolean = true,
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
    enabled: !!restaurantId && !!templateId && isOpen,
    staleTime: 0,
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
