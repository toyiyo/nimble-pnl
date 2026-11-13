import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import type { ReturningGuestTrends } from '@/lib/returningGuests';

const MIN_WEEKS = 1;
const MAX_WEEKS = 26;
const PERMISSION_DENIED = '42501';

function isValidDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === value;
}

/**
 * Load the returning guest trends for one restaurant. Calls the
 * `get_returning_guest_trends` RPC. The query stays disabled until the
 * restaurant, a valid campaign start date and a `weeks` value of 1 to 26 exist.
 */
export function useReturningGuestTrends(
  restaurantId: string | null,
  campaignStart: string | null,
  weeks: number,
) {
  const weeksValid = Number.isInteger(weeks) && weeks >= MIN_WEEKS && weeks <= MAX_WEEKS;
  return useQuery({
    queryKey: ['returning-guest-trends', restaurantId, campaignStart, weeks],
    queryFn: async (): Promise<ReturningGuestTrends> => {
      // The generated types do not list this RPC yet. Cast the client for this call.
      const rpc = supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { code?: string } | null }>;
      const { data, error } = await rpc.call(supabase, 'get_returning_guest_trends', {
        p_restaurant_id: restaurantId!,
        p_campaign_start: campaignStart!,
        p_weeks: weeks,
      });
      if (error) throw error;
      return data as ReturningGuestTrends;
    },
    enabled: !!restaurantId && isValidDate(campaignStart) && weeksValid,
    staleTime: 60000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: (failureCount, error) =>
      (error as { code?: string } | null)?.code !== PERMISSION_DENIED && failureCount < 2,
  });
}
