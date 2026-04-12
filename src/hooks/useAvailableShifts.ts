import { useMemo } from 'react';
import type { OpenShift } from '@/types/scheduling';
import type { ShiftTrade } from '@/hooks/useShiftTrades';
import { useOpenShifts } from '@/hooks/useOpenShifts';
import { useMarketplaceTrades } from '@/hooks/useShiftTrades';

export interface AvailableShiftItem {
  key: string;
  type: 'open_shift' | 'trade';
  date: string;
  openShift?: OpenShift;
  trade?: ShiftTrade & { hasConflict?: boolean };
}

export function mergeAvailableShifts(
  openShifts: OpenShift[],
  trades: (ShiftTrade & { hasConflict?: boolean })[],
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
  const { openShifts, loading: openLoading } = useOpenShifts(restaurantId, weekStart, weekEnd);
  const { trades, loading: tradesLoading } = useMarketplaceTrades(restaurantId, employeeId);

  const items = useMemo(
    () => mergeAvailableShifts(openShifts, trades),
    [openShifts, trades],
  );

  return {
    items,
    loading: openLoading || tradesLoading,
    openShiftCount: openShifts.length,
    tradeCount: trades.length,
  };
}
