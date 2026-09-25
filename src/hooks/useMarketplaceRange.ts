import { useMemo } from 'react';

import { marketplaceRange } from '@/lib/claimableTrades';
import { toDateOnlyString } from '@/lib/dateOnly';
import { parseDateLocal } from '@/lib/dateUtils';

/**
 * The marketplace range for the host local day of `nowMs`.
 *
 * The memo key is the host local day, so a tab open past midnight gets a
 * new range, and the object stays the same during one day. Pass the caller
 * clock tick as `nowMs`. Without it, the hook reads the time on each render.
 */
export function useMarketplaceRange(nowMs?: number): { start: Date; end: Date } {
  const hostDayKey = toDateOnlyString(new Date(nowMs ?? Date.now()));
  return useMemo(() => marketplaceRange(parseDateLocal(hostDayKey)), [hostDayKey]);
}
