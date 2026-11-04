import { useInventoryUsageByDay } from '@/hooks/useInventoryUsageByDay';

export interface FoodCostData {
  date: string;
  total_cost: number;
}

export interface FoodCostsResult {
  dailyCosts: FoodCostData[];
  totalCost: number;
  capped: boolean;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Food costs from inventory_transactions (source of truth), aggregated per
 * day by the get_inventory_usage_by_day RPC. The database aggregates, so
 * the result cannot hit a page cap: `capped` is always false and stays
 * only for interface compatibility.
 *
 * @param restaurantId - Restaurant ID to filter transactions
 * @param dateFrom - Start date for the period
 * @param dateTo - End date for the period
 * @returns Food cost data aggregated by date
 */
export function useFoodCosts(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
): FoodCostsResult {
  const { data, isLoading, error, refetch } = useInventoryUsageByDay(
    restaurantId,
    dateFrom,
    dateTo
  );

  return {
    dailyCosts: data?.dailyCosts || [],
    totalCost: data?.totalCost || 0,
    capped: false,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
