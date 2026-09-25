import { useCallback, useMemo } from 'react';
import type { OpenShift } from '@/types/scheduling';
import type { MarketplaceTrade } from '@/hooks/useShiftTrades';
import { useOpenShifts } from '@/hooks/useOpenShifts';
import { useMarketplaceTrades } from '@/hooks/useShiftTrades';

export interface AvailableShiftItem {
  key: string;
  type: 'open_shift' | 'trade';
  date: string;
  openShift?: OpenShift;
  trade?: MarketplaceTrade;
}

export function mergeAvailableShifts(
  openShifts: OpenShift[],
  trades: readonly MarketplaceTrade[],
): AvailableShiftItem[] {
  const items: AvailableShiftItem[] = [];

  for (const os of openShifts) {
    items.push({
      key: `open-${os.template_id}-${os.shift_date}`,
      type: 'open_shift',
      date: os.shift_date,
      openShift: os,
    });
  }

  for (const trade of trades) {
    const tradeDate = trade.offered_shift?.start_time?.split('T')[0] ?? '';
    items.push({
      key: `trade-${trade.id}`,
      type: 'trade',
      date: tradeDate,
      trade,
    });
  }

  items.sort((a, b) => a.date.localeCompare(b.date));
  return items;
}

export function useAvailableShifts(
  restaurantId: string | null,
  employeeId: string | null,
  weekStart: Date | null,
  weekEnd: Date | null,
) {
  const {
    openShifts,
    loading: openLoading,
    error: openError,
    refetch: refetchOpenShifts,
  } = useOpenShifts(restaurantId, weekStart, weekEnd);
  const {
    trades,
    loading: tradesLoading,
    error: tradesError,
    refetch: refetchTrades,
  } = useMarketplaceTrades(restaurantId, employeeId, { enabled: !!employeeId });

  const items = useMemo(
    () => mergeAvailableShifts(openShifts, trades),
    [openShifts, trades],
  );

  // Retry both queries. A failed load must not look like an empty list.
  const refetch = useCallback(
    () => Promise.all([refetchOpenShifts(), refetchTrades()]),
    [refetchOpenShifts, refetchTrades],
  );

  return {
    items,
    loading: openLoading || tradesLoading,
    error: openError ?? tradesError ?? null,
    refetch,
    openShiftCount: openShifts.length,
    tradeCount: trades.length,
  };
}
