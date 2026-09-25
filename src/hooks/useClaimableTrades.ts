import { useMemo } from 'react';

import { useMarketplaceTrades } from '@/hooks/useShiftTrades';
import { useShiftProtection } from '@/hooks/useShiftProtection';
import { usePermissions } from '@/hooks/usePermissions';
import { useNowTick } from '@/hooks/useNowTick';

import type { ClaimableTrade, MarketplaceTrade } from '@/lib/claimableTrades';

import { selectClaimableTrades } from '@/lib/claimableTrades';

const EMPTY: ClaimableTrade[] = [];

/**
 * Open trades that this employee can accept now, for the home card and the
 * nav badges.
 *
 * The query stays off until both ids are known, so a manager in work mode
 * without an employee row sends no request. While the employee is not
 * known, the hook reports `count: 0` and `loading: true`.
 */
export function useClaimableTrades(restaurantId: string | null, employeeId: string | null) {
  const enabled = !!restaurantId && !!employeeId;
  const { trades, loading, error, refetch } = useMarketplaceTrades(restaurantId, employeeId, { enabled });
  const { protection } = useShiftProtection(restaurantId);
  const { hasCapability, isResolved } = usePermissions();
  const isExemptFromBlock = isResolved && hasCapability('edit:scheduling');

  // The tick moves "now" forward, so a trade leaves the list when its shift
  // starts, even when the query data does not change.
  const nowMs = useNowTick(60_000);

  const claimable = useMemo(() => {
    if (!enabled || !employeeId) return EMPTY;
    return selectClaimableTrades(trades as MarketplaceTrade[], {
      employeeId,
      now: new Date(nowMs),
      protection,
      isExemptFromBlock,
    });
  }, [enabled, trades, nowMs, protection, isExemptFromBlock, employeeId]);

  return {
    trades: claimable,
    count: claimable.length,
    loading: !enabled || loading,
    error: enabled ? error : null,
    refetch,
  };
}
