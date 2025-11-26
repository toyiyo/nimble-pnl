import { useEffect, useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { fetchInventoryTransactions } from '@/services/inventoryTransactions.service';

export interface HighUsageItem {
  productId: string;
  productName: string;
  sku?: string;
  totalUsage: number;
  avgDailyUsage: number;
  lastUsedAt: string;
  suggestedQuantity: number;
}

interface HighUsageOptions {
  daysWindow?: number;
  limit?: number;
  enabled?: boolean;
}

export const useHighUsageItems = (
  restaurantId: string | null,
  { daysWindow = 14, limit = 10, enabled = true }: HighUsageOptions = {},
) => {
  const [usageItems, setUsageItems] = useState<HighUsageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = async () => {
    if (!restaurantId || !enabled) {
      setUsageItems([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const windowStart = format(subDays(new Date(), daysWindow), 'yyyy-MM-dd');
      const transactions = await fetchInventoryTransactions(supabase, {
        restaurantId,
        typeFilter: 'usage',
        startDate: windowStart,
        limit: 2000,
      });

      const usageByProduct = new Map<
        string,
        { total: number; lastUsedAt: string; productName: string; sku?: string }
      >();

      transactions.forEach((transaction) => {
        const productId = transaction.product?.id;
        if (!productId) return;

        const quantity = Math.abs(transaction.quantity || 0);
        if (!usageByProduct.has(productId)) {
          usageByProduct.set(productId, {
            total: 0,
            lastUsedAt: transaction.transaction_date || transaction.created_at,
            productName: transaction.product?.name || 'Unknown Product',
            sku: transaction.product?.sku || undefined,
          });
        }

        const entry = usageByProduct.get(productId);
        if (!entry) return;
        entry.total += quantity;
        const transactionDate = transaction.transaction_date || transaction.created_at;
        if (transactionDate > entry.lastUsedAt) {
          entry.lastUsedAt = transactionDate;
        }
      });

      const safeWindowDays = Math.max(daysWindow, 1);

      const rankedUsage = Array.from(usageByProduct.entries())
        .map(([productId, details]) => {
          const avgDaily = details.total / safeWindowDays;
          return {
            productId,
            productName: details.productName,
            sku: details.sku,
            totalUsage: Number(details.total.toFixed(2)),
            avgDailyUsage: Number(avgDaily.toFixed(2)),
            lastUsedAt: details.lastUsedAt,
            suggestedQuantity: Math.max(Number(details.total.toFixed(2)), Number((avgDaily * 7).toFixed(2))),
          };
        })
        .sort((a, b) => b.totalUsage - a.totalUsage)
        .slice(0, limit);

      setUsageItems(rankedUsage);
    } catch (err: any) {
      console.error('Error fetching high usage items:', err);
      setError(err.message || 'Failed to analyze usage history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsage();
  }, [restaurantId, daysWindow, limit, enabled]);

  const lastRefreshed = useMemo(() => new Date().toISOString(), [usageItems]);

  return {
    usageItems,
    loading,
    error,
    lastRefreshed,
    refetch: fetchUsage,
  };
};
