import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { OpenShift } from '@/types/scheduling';

/**
 * Forward-looking window for "upcoming open spots". Bounded (not "all
 * future") so the get_open_shifts read stays cheap — see design doc
 * non-goal #15 (impact hook sums whole-restaurant open_spots then filters
 * to this template client-side; bounded/cheap at current scale).
 */
const OPEN_SPOTS_WINDOW_DAYS = 28;

export interface TemplateDeletionImpact {
  pendingClaims: { count: number; names: string[] };
  scheduledShiftsKept: number;
  upcomingOpenSpots: number;
}

export interface TemplateDeletionImpactResult extends TemplateDeletionImpact {
  isLoading: boolean;
  error: Error | null;
  /** Retry affordance for the ledger's error-state row (design review #3). */
  refetch: () => void;
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

async function fetchTemplateDeletionImpact(
  restaurantId: string,
  templateId: string,
): Promise<TemplateDeletionImpact> {
  const today = new Date();
  const windowEnd = new Date(today);
  windowEnd.setDate(windowEnd.getDate() + OPEN_SPOTS_WINDOW_DAYS);

  const [claimsResult, shiftsResult, openShiftsResult] = await Promise.all([
    // 1. Pending claims — destroyed by the open_shift_claims CASCADE, so
    //    these are the irreversible part of a hard delete.
    (supabase.from('open_shift_claims') as any)
      .select('employee:employees(name)')
      .eq('restaurant_id', restaurantId)
      .eq('shift_template_id', templateId)
      .eq('status', 'pending_approval'),
    // 2. Already-scheduled future shifts — survive the delete (FK is
    //    ON DELETE SET NULL), worth naming as "kept" in the ledger.
    //    `shifts` has no `shift_date` column — it's a `start_time` timestamptz
    //    (UTC), same column the existing shift-range hooks filter on
    //    (useShiftsInRange.ts, useShifts.tsx).
    (supabase.from('shifts') as any)
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .eq('shift_template_id', templateId)
      .gte('start_time', today.toISOString()),
    // 3. Upcoming open spots — no per-template filter on the RPC, so filter
    //    client-side below (design non-goal #15).
    (supabase.rpc as any)('get_open_shifts', {
      p_restaurant_id: restaurantId,
      p_week_start: toDateStr(today),
      p_week_end: toDateStr(windowEnd),
    }),
  ]);

  if (claimsResult.error) throw claimsResult.error;
  if (shiftsResult.error) throw shiftsResult.error;
  if (openShiftsResult.error) throw openShiftsResult.error;

  const claimRows = (claimsResult.data ?? []) as {
    employee: { name: string } | null;
  }[];
  const names = claimRows
    .map((row) => row.employee?.name)
    .filter((name): name is string => Boolean(name));

  const openShiftRows = (openShiftsResult.data ?? []) as OpenShift[];
  const upcomingOpenSpots = openShiftRows
    .filter((row) => row.template_id === templateId)
    .reduce((sum, row) => sum + row.open_spots, 0);

  return {
    pendingClaims: { count: claimRows.length, names },
    scheduledShiftsKept: shiftsResult.count ?? 0,
    upcomingOpenSpots,
  };
}

/**
 * Client-side "blast radius" reads that back the shift-template hard-delete
 * Impact Ledger (docs/superpowers/specs/2026-07-20-impact-aware-deletion-design.md).
 * Driven by dialog-open state — pass `null` for either id when no delete is
 * in flight so the query stays disabled rather than always-on.
 */
export function useTemplateDeletionImpact(
  restaurantId: string | null,
  templateId: string | null,
): TemplateDeletionImpactResult {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['template-deletion-impact', templateId],
    queryFn: () =>
      fetchTemplateDeletionImpact(restaurantId as string, templateId as string),
    enabled: !!restaurantId && !!templateId,
    staleTime: 30000,
  });

  return {
    pendingClaims: data?.pendingClaims ?? { count: 0, names: [] },
    scheduledShiftsKept: data?.scheduledShiftsKept ?? 0,
    upcomingOpenSpots: data?.upcomingOpenSpots ?? 0,
    isLoading,
    error: (error as Error) ?? null,
    refetch,
  };
}
