import { useMemo } from 'react';
import { useFoodCosts } from './useFoodCosts';
import { useLaborCosts } from './useLaborCosts';
import { useLaborCostsFromTransactions } from './useLaborCostsFromTransactions';

export interface DailyCostData {
  date: string;
  food_cost: number;
  labor_cost: number;
  labor_cost_from_timepunches: number;
  labor_cost_from_transactions: number;
  total_cost: number;
}

export interface CostsFromSourceResult {
  dailyCosts: DailyCostData[];
  totalFoodCost: number;
  totalLaborCost: number;
  totalLaborCostFromTimePunches: number;
  totalLaborCostFromTransactions: number;
  totalCost: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Combined hook that queries food costs from inventory_transactions, 
 * labor costs from daily_labor_costs (time punches), and labor costs
 * from bank transactions/pending outflows (financial accounts).
 * 
 * This provides the complete picture of labor costs from both operational
 * (time tracking) and financial (bank transactions) sources.
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
  const foodCosts = useFoodCosts(restaurantId, dateFrom, dateTo);
  const laborCosts = useLaborCosts(restaurantId, dateFrom, dateTo);
  const transactionLaborCosts = useLaborCostsFromTransactions(restaurantId, dateFrom, dateTo);

  const isLoading = foodCosts.isLoading || laborCosts.isLoading || transactionLaborCosts.isLoading;
  const error = foodCosts.error || laborCosts.error || transactionLaborCosts.error;

  // Combine daily costs from all sources
  const dailyCosts = useMemo(() => {
    const dateMap = new Map<string, DailyCostData>();

    // Add food costs
    foodCosts.dailyCosts.forEach((day) => {
      dateMap.set(day.date, {
        date: day.date,
        food_cost: day.total_cost,
        labor_cost: 0,
        labor_cost_from_timepunches: 0,
        labor_cost_from_transactions: 0,
        total_cost: day.total_cost,
      });
    });

    // Add labor costs from time punches
    laborCosts.dailyCosts.forEach((day) => {
      const existing = dateMap.get(day.date);
      if (existing) {
        existing.labor_cost_from_timepunches = day.total_labor_cost;
        existing.labor_cost = existing.labor_cost_from_timepunches + existing.labor_cost_from_transactions;
        existing.total_cost = existing.food_cost + existing.labor_cost;
      } else {
        dateMap.set(day.date, {
          date: day.date,
          food_cost: 0,
          labor_cost: day.total_labor_cost,
          labor_cost_from_timepunches: day.total_labor_cost,
          labor_cost_from_transactions: 0,
          total_cost: day.total_labor_cost,
        });
      }
    });

    // Add labor costs from bank transactions and pending outflows
    transactionLaborCosts.dailyCosts.forEach((day) => {
      const existing = dateMap.get(day.date);
      if (existing) {
        existing.labor_cost_from_transactions = day.labor_cost;
        existing.labor_cost = existing.labor_cost_from_timepunches + existing.labor_cost_from_transactions;
        existing.total_cost = existing.food_cost + existing.labor_cost;
      } else {
        dateMap.set(day.date, {
          date: day.date,
          food_cost: 0,
          labor_cost: day.labor_cost,
          labor_cost_from_timepunches: 0,
          labor_cost_from_transactions: day.labor_cost,
          total_cost: day.labor_cost,
        });
      }
    });

    // Convert to array and sort by date
    return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [foodCosts.dailyCosts, laborCosts.dailyCosts, transactionLaborCosts.dailyCosts]);

  const refetch = () => {
    return Promise.all([
      foodCosts.refetch(), 
      laborCosts.refetch(),
      transactionLaborCosts.refetch()
    ]);
  };

  const totalLaborCost = laborCosts.totalCost + transactionLaborCosts.totalCost;

  return {
    dailyCosts,
    totalFoodCost: foodCosts.totalCost,
    totalLaborCost,
    totalLaborCostFromTimePunches: laborCosts.totalCost,
    totalLaborCostFromTransactions: transactionLaborCosts.totalCost,
    totalCost: foodCosts.totalCost + totalLaborCost,
    isLoading,
    error,
    refetch,
  };
}
