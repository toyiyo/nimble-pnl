import { useMemo } from 'react';

import { useMarketplaceTrades } from '@/hooks/useShiftTrades';
import { useShiftProtection } from '@/hooks/useShiftProtection';
import { usePermissions } from '@/hooks/usePermissions';
import { useNowTick } from '@/hooks/useNowTick';

import type { ClaimableTrade } from '@/lib/claimableTrades';

import { selectClaimableTrades } from '@/lib/claimableTrades';

const EMPTY: ClaimableTrade[] = [];

/**
 * Open trades that this employee can accept now.
 *
 * The queries stay off until both ids are known, so a user without an
 * employee row sends no request. The hook reports `loading: true` and
 * `count: 0` until the employee, the protection settings and the
 * permissions are all known. A count from half the data can show a trade
 * that the accept RPC refuses.
 *
 * Pass `nowMs` when the caller has its own clock. The hook then starts no
 * interval of its own.
 */
export function useClaimableTrades(
  restaurantId: string | null,
  employeeId: string | null,
  nowMs?: number,
) {
  const enabled = !!restaurantId && !!employeeId;
  const { trades, loading, error, refetch } = useMarketplaceTrades(restaurantId, employeeId, { enabled });
  const {
    protection,
    hasData: hasProtection,
    isLoading: protectionLoading,
    error: protectionError,
  } = useShiftProtection(enabled ? restaurantId : null);
  const { hasCapability, isResolved } = usePermissions();
  const isExemptFromBlock = isResolved && hasCapability('edit:scheduling');

  // On a read error with no cached settings, fail closed: show no trades.
  // The server can enforce block mode, so the defaults (mode 'off') could
  // show trades that the accept RPC refuses. When a background refetch
  // fails, the cached settings are still correct, so use them.
  const protectionFailed = enabled && !!protectionError && !hasProtection;

  // The tick moves "now" forward, so a trade leaves the list when its shift
  // starts, even when the query data does not change.
  const ownNowMs = useNowTick(60_000, { enabled: nowMs === undefined });
  const effectiveNowMs = nowMs ?? ownNowMs;

  const isLoading = !protectionFailed && (!enabled || loading || protectionLoading || !isResolved);

  const claimable = useMemo(() => {
    if (protectionFailed || isLoading || !employeeId) return EMPTY;
    return selectClaimableTrades(trades, {
      employeeId,
      now: new Date(effectiveNowMs),
      protection,
      isExemptFromBlock,
    });
  }, [protectionFailed, isLoading, trades, effectiveNowMs, protection, isExemptFromBlock, employeeId]);

  return {
    trades: claimable,
    count: claimable.length,
    loading: isLoading,
    error: protectionFailed ? protectionError : enabled ? error : null,
    refetch,
  };
}
