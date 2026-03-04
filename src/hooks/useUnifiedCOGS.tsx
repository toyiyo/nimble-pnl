import { useMemo } from 'react';

import { useFoodCosts } from '@/hooks/useFoodCosts';
import { useCOGSFromFinancials } from '@/hooks/useCOGSFromFinancials';
import { useFinancialSettings, COGSMethod } from '@/hooks/useFinancialSettings';

export interface UnifiedCOGSResult {
  totalCOGS: number;
  dailyCOGS: { date: string; amount: number }[];
  breakdown: { inventory: number; financials: number };
  method: COGSMethod;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Orchestrator hook that reads the COGS calculation preference from
 * restaurant_financial_settings and delegates to the appropriate data
 * fetcher(s): inventory (useFoodCosts), financials (useCOGSFromFinancials),
 * or both (combined).
 *
 * Both source hooks always run (React hooks cannot be called conditionally).
 * The `method` setting determines which data populates `totalCOGS` and
 * `dailyCOGS`. The `breakdown` field always exposes both values regardless
 * of the active method (useful for the settings info box).
 */
export function useUnifiedCOGS(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date,
): UnifiedCOGSResult {
  // useFinancialSettings accepts string | undefined | null
  const { cogsMethod, isLoading: settingsLoading } = useFinancialSettings(
    restaurantId ?? undefined,
  );

  // Both hooks always execute — React rules of hooks
  const inventoryCosts = useFoodCosts(restaurantId, dateFrom, dateTo);
  const financialCosts = useCOGSFromFinancials(restaurantId, dateFrom, dateTo);

  return useMemo(() => {
    let totalCOGS = 0;
    let dailyCOGS: { date: string; amount: number }[] = [];

    switch (cogsMethod) {
      case 'inventory':
        totalCOGS = inventoryCosts.totalCost;
        dailyCOGS = inventoryCosts.dailyCosts.map((d) => ({
          date: d.date,
          amount: d.total_cost,
        }));
        break;

      case 'financials':
        totalCOGS = financialCosts.totalCost;
        dailyCOGS = financialCosts.dailyCosts.map((d) => ({
          date: d.date,
          amount: d.total_cost,
        }));
        break;

      case 'combined': {
        totalCOGS = inventoryCosts.totalCost + financialCosts.totalCost;

        // Merge daily data by date
        const dateMap = new Map<string, number>();
        inventoryCosts.dailyCosts.forEach((d) =>
          dateMap.set(d.date, (dateMap.get(d.date) || 0) + d.total_cost),
        );
        financialCosts.dailyCosts.forEach((d) =>
          dateMap.set(d.date, (dateMap.get(d.date) || 0) + d.total_cost),
        );

        dailyCOGS = Array.from(dateMap.entries())
          .map(([date, amount]) => ({ date, amount }))
          .sort((a, b) => a.date.localeCompare(b.date));
        break;
      }
    }

    return {
      totalCOGS,
      dailyCOGS,
      breakdown: {
        inventory: inventoryCosts.totalCost,
        financials: financialCosts.totalCost,
      },
      method: cogsMethod,
      isLoading:
        settingsLoading || inventoryCosts.isLoading || financialCosts.isLoading,
      error: inventoryCosts.error || financialCosts.error,
    };
  }, [cogsMethod, inventoryCosts, financialCosts, settingsLoading]);
}
