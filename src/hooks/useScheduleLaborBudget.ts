import { useMemo } from 'react';
import { useOperatingCosts } from './useOperatingCosts';
import { useBreakEvenAnalysis } from './useBreakEvenAnalysis';
import { calculateLaborBudget } from '../../supabase/functions/_shared/labor/laborBudget.ts';
import type { LaborBudgetData } from '../../supabase/functions/_shared/labor/laborBudget.ts';

export { calculateLaborBudget };
export type { LaborBudgetData };

/**
 * React hook that computes labor budget comparison for the scheduling page.
 */
export function useScheduleLaborBudget(
  scheduledTotal: number,
  restaurantId: string | null,
): LaborBudgetData {
  const { costs, isLoading: costsLoading } = useOperatingCosts(restaurantId);
  const { data: breakEvenData, isLoading: breakEvenLoading } =
    useBreakEvenAnalysis(restaurantId);

  const laborEntry = costs.find((c) => c.category === 'labor') ?? null;
  const needsBreakEven = laborEntry?.entryType === 'percentage';
  const isLoading = costsLoading || (needsBreakEven && breakEvenLoading);

  const budgetData = useMemo(
    () => calculateLaborBudget(scheduledTotal, costs, breakEvenData),
    [scheduledTotal, costs, breakEvenData],
  );

  return { ...budgetData, isLoading };
}
