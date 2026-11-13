import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ShiftTrade } from '@/hooks/useShiftTrades';
import {
  CLOSED_TRADE_STATUSES,
  type ClosedTradeStatus,
  type TradeHistoryFilter,
} from '@/lib/shiftTradeHistory';

export const TRADE_HISTORY_PAGE_SIZE = 25;
export const FORMER_TEAM_MEMBER = 'a former team member';

export type ShiftTradeHistoryRow = Omit<ShiftTrade, 'status'> & {
  status: ClosedTradeStatus;
  reviewer_name: string | null;
};

interface HistoryPage {
  rows: ShiftTradeHistoryRow[];
  rawCount: number;
  nextOffset: number;
}

type ReviewerRow = { id: string; email: string | null; full_name: string | null };

const COLUMNS = `
  id,
  status,
  offered_shift_id,
  offered_by_employee_id,
  accepted_by_employee_id,
  target_employee_id,
  reviewed_by,
  reviewed_at,
  manager_note,
  created_at,
  updated_at,
  offered_shift:shifts!offered_shift_id(id, start_time, end_time, position),
  offered_by:employees!offered_by_employee_id(id, name),
  accepted_by:employees!accepted_by_employee_id(id, name),
  target_employee:employees!target_employee_id(id, name)
`;

async function fetchReviewerNames(ids: string[]): Promise<Map<string, string> | null> {
  if (ids.length === 0) return new Map();
  let result: { data: ReviewerRow[] | null; error: unknown };
  try {
    // get_users_by_ids is not in the generated RPC types. Same cast as useTipSplitAuditLog.ts.
    result = (await supabase.rpc('get_users_by_ids', {
      user_ids: ids,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any as { data: ReviewerRow[] | null; error: unknown };
  } catch (error_) {
    result = { data: null, error: error_ };
  }
  const { data, error } = result;
  if (error) {
    console.error('Failed to load trade reviewer names', error);
    return null;
  }
  const names = new Map<string, string>();
  for (const user of data ?? []) {
    const name = user.full_name || user.email;
    if (name) names.set(user.id, name);
  }
  return names;
}

export const useShiftTradeHistory = (
  restaurantId: string | null,
  filter: TradeHistoryFilter,
) => {
  const query = useInfiniteQuery({
    // restaurantId comes second so that ['shift_trades', restaurantId] invalidations match.
    queryKey: ['shift_trades', restaurantId, 'history', filter],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<HistoryPage> => {
      const from = pageParam as number;
      let q = supabase
        .from('shift_trades')
        .select(COLUMNS)
        .eq('restaurant_id', restaurantId as string);

      q = filter === 'all' ? q.in('status', [...CLOSED_TRADE_STATUSES]) : q.eq('status', filter);

      const { data, error } = await q
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + TRADE_HISTORY_PAGE_SIZE - 1);

      if (error) throw error;

      const raw = (data ?? []) as unknown as ShiftTrade[];
      // Keep a trade with an unreadable poster. The row shows 'Former employee' for it.
      const valid = raw.filter((t) => t.offered_shift != null);
      const reviewerIds = [
        ...new Set(valid.map((t) => t.reviewed_by).filter((id): id is string => !!id)),
      ];
      const names = await fetchReviewerNames(reviewerIds);

      // reviewer_name is null when the lookup failed or no reviewer exists.
      // It is the former-member text when the lookup worked but the id is missing.
      const rows = valid.map((t) => ({
        ...t,
        reviewer_name:
          t.reviewed_by && names ? (names.get(t.reviewed_by) ?? FORMER_TEAM_MEMBER) : null,
      })) as ShiftTradeHistoryRow[];

      return { rows, rawCount: raw.length, nextOffset: from + TRADE_HISTORY_PAGE_SIZE };
    },
    getNextPageParam: (lastPage) =>
      lastPage.rawCount === TRADE_HISTORY_PAGE_SIZE ? lastPage.nextOffset : undefined,
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const trades = useMemo(() => {
    const seen = new Set<string>();
    const out: ShiftTradeHistoryRow[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const row of page.rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        out.push(row);
      }
    }
    return out;
  }, [query.data]);

  return {
    trades,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
    error: query.error,
  };
};
