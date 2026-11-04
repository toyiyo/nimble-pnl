import { useCallback, useMemo } from 'react';
import type { OpenShift } from '@/types/scheduling';
import type { MarketplaceTrade } from '@/hooks/useShiftTrades';
import { useOpenShifts } from '@/hooks/useOpenShifts';
import { useMarketplaceTrades } from '@/hooks/useShiftTrades';
import { parseWallClock, toBusinessDay } from '@/lib/restaurantClock';

export interface AvailableShiftItem {
  key: string;
  type: 'open_shift' | 'trade';
  date: string;
  startsAt: number;
  openShift?: OpenShift;
  trade?: MarketplaceTrade;
}

// Note: two open items with no start time both get NEGATIVE_INFINITY.
// Subtraction (a.startsAt - b.startsAt) turns that pair into NaN, so this
// comparator uses explicit checks instead of a numeric difference.
function compareByStartsAt(a: AvailableShiftItem, b: AvailableShiftItem): number {
  if (a.startsAt < b.startsAt) return -1;
  if (a.startsAt > b.startsAt) return 1;
  return 0;
}

export function mergeAvailableShifts(
  openShifts: OpenShift[],
  trades: readonly MarketplaceTrade[],
  tz: string,
): AvailableShiftItem[] {
  const items: AvailableShiftItem[] = [];

  for (const os of openShifts) {
    const startsAt = Date.parse(parseWallClock(`${os.shift_date}T${os.start_time}`, tz));
    items.push({
      key: `open-${os.template_id}-${os.shift_date}`,
      type: 'open_shift',
      date: os.shift_date,
      startsAt,
      openShift: os,
    });
  }

  for (const trade of trades) {
    const startTime = trade.offered_shift?.start_time;
    const tradeDate = startTime ? toBusinessDay(startTime, tz) : '';
    const startsAt = startTime ? Date.parse(startTime) : Number.NEGATIVE_INFINITY;
    items.push({
      key: `trade-${trade.id}`,
      type: 'trade',
      date: tradeDate,
      startsAt,
      trade,
    });
  }

  items.sort(compareByStartsAt);
  return items;
}

export function useAvailableShifts(
  restaurantId: string | null,
  employeeId: string | null,
  weekStart: Date | null,
  weekEnd: Date | null,
  tz: string,
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
    () => mergeAvailableShifts(openShifts, trades, tz),
    [openShifts, trades, tz],
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
