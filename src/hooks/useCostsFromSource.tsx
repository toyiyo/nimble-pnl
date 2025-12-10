import { useMemo } from 'react';
import { useFoodCosts } from './useFoodCosts';
import { useLaborCostsFromTimeTracking } from './useLaborCostsFromTimeTracking';
import { useLaborCostsFromTransactions } from './useLaborCostsFromTransactions';

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
  totalCost: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Combined hook that queries food costs from inventory_transactions, 
 * pending labor costs from daily_labor_costs (time punches - scheduled/accrued), 
 * and actual labor costs from bank transactions/pending outflows (paid labor).
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
  const foodCosts = useFoodCosts(restaurantId, dateFrom, dateTo);
  const laborCosts = useLaborCostsFromTimeTracking(restaurantId, dateFrom, dateTo);
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
        pending_labor_cost: 0,
        actual_labor_cost: 0,
        total_cost: day.total_cost,
      });
    });

    // Add pending labor costs from time punches (scheduled/accrued labor)
    laborCosts.dailyCosts.forEach((day) => {
      const existing = dateMap.get(day.date);
      if (existing) {
        existing.pending_labor_cost = day.total_labor_cost;
        existing.labor_cost = existing.pending_labor_cost + existing.actual_labor_cost;
        existing.total_cost = existing.food_cost + existing.labor_cost;
      } else {
        dateMap.set(day.date, {
          date: day.date,
          food_cost: 0,
          labor_cost: day.total_labor_cost,
          pending_labor_cost: day.total_labor_cost,
          actual_labor_cost: 0,
          total_cost: day.total_labor_cost,
        });
      }
    });

    // Add actual labor costs from bank transactions and pending outflows (paid labor)
    transactionLaborCosts.dailyCosts.forEach((day) => {
      const existing = dateMap.get(day.date);
      if (existing) {
        existing.actual_labor_cost = day.labor_cost;
        existing.labor_cost = existing.pending_labor_cost + existing.actual_labor_cost;
        existing.total_cost = existing.food_cost + existing.labor_cost;
      } else {
        dateMap.set(day.date, {
          date: day.date,
          food_cost: 0,
          labor_cost: day.labor_cost,
          pending_labor_cost: 0,
          actual_labor_cost: day.labor_cost,
          total_cost: day.labor_cost,
        });
      }
    });

    // Convert to array and sort by date
    return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [foodCosts.dailyCosts, laborCosts.dailyCosts, transactionLaborCosts.dailyCosts]);

  const refetch = () => {
    foodCosts.refetch(); 
    laborCosts.refetch();
    transactionLaborCosts.refetch();
  };

  const totalLaborCost = laborCosts.totalCost + transactionLaborCosts.totalCost;

  return {
    dailyCosts,
    totalFoodCost: foodCosts.totalCost,
    totalLaborCost,
    pendingLaborCost: laborCosts.totalCost,
    actualLaborCost: transactionLaborCosts.totalCost,
    totalCost: foodCosts.totalCost + totalLaborCost,
    isLoading,
    error,
    refetch,
  };
}
