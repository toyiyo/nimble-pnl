import { useQuery } from "@tanstack/react-query";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { format, subDays, differenceInDays } from "date-fns";
import { useTopVendors } from "./useTopVendors";
import { useExpenseHealth } from "./useExpenseHealth";
import { usePredictableExpenses } from "./usePredictableExpenses";

export type AlertSeverity = 'info' | 'warn' | 'critical';

export interface ExpenseAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  metricRefs: string[];
  cta?: {
    label: string;
    route: string;
    filters?: Record<string, any>;
  };
}

export function useExpenseAlerts(startDate: Date, endDate: Date) {
  const { selectedRestaurant } = useRestaurantContext();
  const { data: topVendors, isLoading: vendorsLoading } = useTopVendors(startDate, endDate);
  const { data: expenseHealth, isLoading: healthLoading } = useExpenseHealth(startDate, endDate);
  const { data: predictableExpenses, isLoading: expensesLoading } = usePredictableExpenses(7); // Next 7 days

  return useQuery({
    queryKey: ['expense-alerts', selectedRestaurant?.restaurant_id, format(startDate, 'yyyy-MM-dd'), format(endDate, 'yyyy-MM-dd')],
    queryFn: async (): Promise<ExpenseAlert[]> => {
      if (!selectedRestaurant?.restaurant_id || !topVendors || !expenseHealth || !predictableExpenses) {
        return [];
      }

      const alerts: ExpenseAlert[] = [];

      // Alert 1: Vendor Spike
      topVendors.topVendors.forEach(vendor => {
        if (vendor.momChange && vendor.momChange > 25 && vendor.spend > 500) {
          alerts.push({
            id: `vendor-spike-${vendor.vendor}`,
            severity: vendor.momChange > 50 ? 'critical' : 'warn',
            title: 'Vendor Spend Spike',
            message: `Spend with ${vendor.vendor} up ${vendor.momChange.toFixed(0)}% vs last month`,
            metricRefs: ['topVendors', vendor.vendor],
            cta: {
              label: 'Review Transactions',
              route: '/banking',
              filters: { vendor: vendor.vendor },
            },
          });
        }
      });

      // Alert 2: Low Cash Coverage Before Payroll
      if (expenseHealth.cashCoverageBeforePayroll > 0 && expenseHealth.cashCoverageBeforePayroll < 1.2) {
        alerts.push({
          id: 'low-cash-coverage',
          severity: expenseHealth.cashCoverageBeforePayroll < 1.0 ? 'critical' : 'warn',
          title: 'Low Cash Coverage',
          message: `Cash coverage only ${expenseHealth.cashCoverageBeforePayroll.toFixed(1)}× payroll. Risk of shortfall.`,
          metricRefs: ['cashCoverage'],
          cta: {
            label: 'Review Cash Flow',
            route: '/banking',
          },
        });
      }

      // Alert 3: High Uncategorized Spend
      if (expenseHealth.uncategorizedSpendPercentage > expenseHealth.uncategorizedSpendTarget) {
        alerts.push({
          id: 'high-uncategorized',
          severity: expenseHealth.uncategorizedSpendPercentage > 10 ? 'warn' : 'info',
          title: 'High Uncategorized Spend',
          message: `${expenseHealth.uncategorizedSpendPercentage.toFixed(0)}% of expenses uncategorized — categorize to improve accuracy`,
          metricRefs: ['uncategorizedSpend'],
          cta: {
            label: 'Categorize Transactions',
            route: '/banking',
            filters: { uncategorized: true },
          },
        });
      }

      // Alert 4: Processing Fee Creep
      if (expenseHealth.processingFeePercentage > expenseHealth.processingFeeTarget) {
        alerts.push({
          id: 'high-processing-fees',
          severity: expenseHealth.processingFeePercentage > 3.5 ? 'warn' : 'info',
          title: 'High Processing Fees',
          message: `Processing fees at ${expenseHealth.processingFeePercentage.toFixed(1)}% of revenue (target: ${expenseHealth.processingFeeTarget}%)`,
          metricRefs: ['processingFees'],
          cta: {
            label: 'Review Fees',
            route: '/banking',
            filters: { category: 'Processing/Bank Fees' },
          },
        });
      }

      // Alert 5: Food Cost Out of Range
      if (
        expenseHealth.foodCostPercentage > 0 &&
        (expenseHealth.foodCostPercentage < expenseHealth.foodCostTarget.min ||
          expenseHealth.foodCostPercentage > expenseHealth.foodCostTarget.max)
      ) {
        const isHigh = expenseHealth.foodCostPercentage > expenseHealth.foodCostTarget.max;
        alerts.push({
          id: 'food-cost-out-of-range',
          severity: isHigh ? 'warn' : 'info',
          title: isHigh ? 'High Food Cost %' : 'Low Food Cost %',
          message: `Food cost at ${expenseHealth.foodCostPercentage.toFixed(1)}% (target: ${expenseHealth.foodCostTarget.min}-${expenseHealth.foodCostTarget.max}%)`,
          metricRefs: ['foodCost'],
          cta: {
            label: 'Review COGS',
            route: '/inventory',
          },
        });
      }

      // Alert 6: Labor Cost Out of Range
      if (
        expenseHealth.laborPercentage > 0 &&
        (expenseHealth.laborPercentage < expenseHealth.laborTarget.min ||
          expenseHealth.laborPercentage > expenseHealth.laborTarget.max)
      ) {
        const isHigh = expenseHealth.laborPercentage > expenseHealth.laborTarget.max;
        alerts.push({
          id: 'labor-cost-out-of-range',
          severity: isHigh ? 'warn' : 'info',
          title: isHigh ? 'High Labor %' : 'Low Labor %',
          message: `Labor at ${expenseHealth.laborPercentage.toFixed(1)}% (target: ${expenseHealth.laborTarget.min}-${expenseHealth.laborTarget.max}%)`,
          metricRefs: ['labor'],
          cta: {
            label: 'Review Payroll',
            route: '/banking',
            filters: { category: 'Labor/Payroll' },
          },
        });
      }

      // Alert 7: Vendor Concentration Risk
      if (topVendors.vendorConcentration > 40) {
        alerts.push({
          id: 'vendor-concentration',
          severity: 'info',
          title: 'High Vendor Concentration',
          message: `Top 3 vendors represent ${topVendors.vendorConcentration.toFixed(0)}% of spending — consider diversification`,
          metricRefs: ['vendorConcentration'],
        });
      }

      // Sort by severity (critical > warn > info)
      const severityOrder = { critical: 0, warn: 1, info: 2 };
      alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

      return alerts;
    },
    enabled: !!selectedRestaurant?.restaurant_id && !vendorsLoading && !healthLoading && !expensesLoading,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}
