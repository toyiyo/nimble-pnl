import { useMemo } from 'react';
import { useIsFetching } from '@tanstack/react-query';
import { useUnifiedCOGS } from './useUnifiedCOGS';
import { useLaborCostsFromTimeTracking } from './useLaborCostsFromTimeTracking';
import { useLaborCostsFromTransactions } from './useLaborCostsFromTransactions';
import {
  resolveLaborBasis,
  combineDailyCosts,
  type LaborBasis,
} from '@/lib/combineCosts';

export interface DailyCostData {
  date: string;
  food_cost: number;
  labor_cost: number;
  pending_labor_cost: number; // From time punches (scheduled/accrued)
  actual_labor_cost: number;  // From bank transactions (paid)
  total_cost: number;
}

export interface CostsFromSourceResult {
  dailyCosts: DailyCostData[];
  totalFoodCost: number;
  totalLaborCost: number;
  pendingLaborCost: number;  // From time punches (scheduled/accrued)
  actualLaborCost: number;   // From bank transactions (paid)
  laborBasis: LaborBasis;    // Which source is authoritative for this period
  totalCost: number;
  capped: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Combined hook that queries COGS via the unified COGS orchestrator
 * (which reads the restaurant's cogs_method preference and delegates to
 * inventory, financials, or both), pending labor costs from
 * daily_labor_costs (time punches - scheduled/accrued), and actual labor
 * costs from bank transactions/pending outflows (paid labor).
 *
 * This follows the same pattern as pending outflows vs actual expenses:
 * - Pending Labor: Time punches showing scheduled/accrued labor costs
 * - Actual Labor: Bank transactions showing money actually paid out
 *
 * Both sources are shown separately to give owners visibility into:
 * - What labor costs are scheduled/owed (pending)
 * - What labor costs have actually been paid (actual)
 *
 * @param restaurantId - Restaurant ID to filter costs
 * @param dateFrom - Start date for the period
 * @param dateTo - End date for the period
 * @returns Combined cost data from all source tables
 */
export function useCostsFromSource(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
): CostsFromSourceResult {
  const unifiedCOGS = useUnifiedCOGS(restaurantId, dateFrom, dateTo);
  const laborCosts = useLaborCostsFromTimeTracking(restaurantId, dateFrom, dateTo);
  const transactionLaborCosts = useLaborCostsFromTransactions(restaurantId, dateFrom, dateTo);

  const isLoading = unifiedCOGS.isLoading || laborCosts.isLoading || transactionLaborCosts.isLoading;
  const error = unifiedCOGS.error || laborCosts.error || transactionLaborCosts.error;

  // useUnifiedCOGS does not expose isFetching, and peer sessions own that
  // file. Count its leaf queries through the query cache instead. The key
  // prefix scopes the count to this restaurant.
  const cogsFetchCount =
    useIsFetching({ queryKey: ['inventory-usage-by-day', restaurantId] }) +
    useIsFetching({ queryKey: ['cogs-financials', restaurantId] });
  const isFetching =
    cogsFetchCount > 0 ||
    laborCosts.isFetching ||
    transactionLaborCosts.isFetching;

  // Per-period labor basis: accrued when the period has wage labor (worked
  // hours or per-job payments), else paid. wageCost excludes tips owed —
  // tips alone must not hide paid (bank) labor behind the accrued pick.
  const laborBasis = resolveLaborBasis(laborCosts.wageCost);

  // Combine daily costs; the daily labor_cost/total_cost respect the basis.
  const dailyCosts = useMemo(
    () =>
      combineDailyCosts(
        unifiedCOGS.dailyCOGS,
        laborCosts.dailyCosts,
        transactionLaborCosts.dailyCosts,
        laborBasis,
      ),
    [
      unifiedCOGS.dailyCOGS,
      laborCosts.dailyCosts,
      transactionLaborCosts.dailyCosts,
      laborBasis,
    ],
  );

  const refetch = () => {
    // useUnifiedCOGS relies on React Query auto-refetch (no manual refetch exposed)
    laborCosts.refetch();
    transactionLaborCosts.refetch();
  };

  // De-duplicated period labor: the basis source only, never the sum.
  const totalLaborCost =
    laborBasis === 'accrued' ? laborCosts.totalCost : transactionLaborCosts.totalCost;

  return {
    dailyCosts,
    totalFoodCost: unifiedCOGS.totalCOGS,
    totalLaborCost,
    pendingLaborCost: laborCosts.totalCost,
    actualLaborCost: transactionLaborCosts.totalCost,
    laborBasis,
    totalCost: unifiedCOGS.totalCOGS + totalLaborCost,
    capped: unifiedCOGS.capped || laborCosts.capped,
    isLoading,
    isFetching,
    error,
    refetch,
  };
}
