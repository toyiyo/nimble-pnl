import { useMemo } from 'react';

import { useMarketplaceTrades } from '@/hooks/useShiftTrades';
import { useShiftProtection } from '@/hooks/useShiftProtection';
import { usePermissions } from '@/hooks/usePermissions';
import { useNowTick } from '@/hooks/useNowTick';

import type { ClaimableTrade, MarketplaceTrade } from '@/lib/claimableTrades';
import type { ShiftProtectionSettings } from '@/lib/shiftProtection';

import { selectClaimableTrades } from '@/lib/claimableTrades';
import { SHIFT_PROTECTION_DEFAULTS } from '@/lib/shiftProtection';

const EMPTY: ClaimableTrade[] = [];

/**
 * Open trades that this employee can accept now.
 *
 * The queries stay off until both ids are known, so a user without an
 * employee row sends no request. The hook reports `loading: true` and
 * `count: 0` until the employee, the protection settings and the
 * permissions are all known. A count from half the data can show a trade
 * that the accept RPC refuses.
 */
export function useClaimableTrades(restaurantId: string | null, employeeId: string | null) {
  const enabled = !!restaurantId && !!employeeId;
  const { trades, loading, error, refetch } = useMarketplaceTrades(restaurantId, employeeId, { enabled });
  const {
    protection,
    isLoading: protectionLoading,
    error: protectionError,
  } = useShiftProtection(enabled ? restaurantId : null);
  const { hasCapability, isResolved } = usePermissions();
  const isExemptFromBlock = isResolved && hasCapability('edit:scheduling');

  // On a read error, fail closed. The server can enforce block mode, so a
  // fallback to mode 'off' could show trades that the accept RPC refuses.
  const effectiveProtection = useMemo<ShiftProtectionSettings>(
    () =>
      protectionError
        ? {
            ...SHIFT_PROTECTION_DEFAULTS,
            trade_deadline_mode: 'block',
            trade_deadline_hours: SHIFT_PROTECTION_DEFAULTS.trade_deadline_hours,
          }
        : protection,
    [protectionError, protection],
  );

  // The tick moves "now" forward, so a trade leaves the list when its shift
  // starts, even when the query data does not change.
  const nowMs = useNowTick(60_000);

  const isLoading = !enabled || loading || protectionLoading || !isResolved;

  const claimable = useMemo(() => {
    if (isLoading || !employeeId) return EMPTY;
    return selectClaimableTrades(trades as MarketplaceTrade[], {
      employeeId,
      now: new Date(nowMs),
      protection: effectiveProtection,
      isExemptFromBlock,
    });
  }, [isLoading, trades, nowMs, effectiveProtection, isExemptFromBlock, employeeId]);

  return {
    trades: claimable,
    count: claimable.length,
    loading: isLoading,
    error: enabled ? error : null,
    refetch,
  };
}
