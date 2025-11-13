import { useMemo } from 'react';
import { useFoodCosts } from './useFoodCosts';
import { useLaborCosts } from './useLaborCosts';

export interface DailyCostData {
  date: string;
  food_cost: number;
  labor_cost: number;
  total_cost: number;
}

export interface CostsFromSourceResult {
  dailyCosts: DailyCostData[];
  totalFoodCost: number;
  totalLaborCost: number;
  totalCost: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Combined hook that queries food costs from inventory_transactions and 
 * labor costs from daily_labor_costs (both source tables).
 * 
 * This replaces queries to daily_pnl for cost data.
 * 
 * @param restaurantId - Restaurant ID to filter costs
 * @param dateFrom - Start date for the period
 * @param dateTo - End date for the period
 * @returns Combined cost data from source tables
 */
export function useCostsFromSource(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date
): CostsFromSourceResult {
  const foodCosts = useFoodCosts(restaurantId, dateFrom, dateTo);
  const laborCosts = useLaborCosts(restaurantId, dateFrom, dateTo);

  const isLoading = foodCosts.isLoading || laborCosts.isLoading;
  const error = foodCosts.error || laborCosts.error;

  // Combine daily costs from both sources
  const dailyCosts = useMemo(() => {
    const dateMap = new Map<string, DailyCostData>();

    // Add food costs
    foodCosts.dailyCosts.forEach((day) => {
      dateMap.set(day.date, {
        date: day.date,
        food_cost: day.total_cost,
        labor_cost: 0,
        total_cost: day.total_cost,
      });
    });

    // Add labor costs
    laborCosts.dailyCosts.forEach((day) => {
      const existing = dateMap.get(day.date);
      if (existing) {
        existing.labor_cost = day.total_labor_cost;
        existing.total_cost = existing.food_cost + day.total_labor_cost;
      } else {
        dateMap.set(day.date, {
          date: day.date,
          food_cost: 0,
          labor_cost: day.total_labor_cost,
          total_cost: day.total_labor_cost,
        });
      }
    });

    // Convert to array and sort by date
    return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [foodCosts.dailyCosts, laborCosts.dailyCosts]);

  const refetch = () => {
    return Promise.all([foodCosts.refetch(), laborCosts.refetch()]);
  };

  return {
    dailyCosts,
    totalFoodCost: foodCosts.totalCost,
    totalLaborCost: laborCosts.totalCost,
    totalCost: foodCosts.totalCost + laborCosts.totalCost,
    isLoading,
    error,
    refetch,
  };
}
