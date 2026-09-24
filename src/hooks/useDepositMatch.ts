import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  parseDepositMatchReport,
  type DepositMatchLinkConfirmInput,
  type DepositMatchReport,
  type DepositMatchResolutionInput,
  type DepositMatchRule,
  type DepositMatchRuleInput,
  type DepositMatchRuleUpdate,
} from '@/types/depositMatch';

// deposit_match_rules / deposit_match_items / deposit_match_links and the
// refresh_deposit_matches / get_deposit_match_report RPCs aren't in the
// generated Supabase types yet (added by migrations after the last
// `npm run sync-types`) — every `as any` cast in this file is for that gap,
// not because the shape is genuinely unknown; the real shapes are the
// src/types/depositMatch.ts contracts.

/** The read query's key. A range change (or a restaurant switch) is a new key. */
export function depositMatchQueryKey(
  restaurantId: string | null | undefined,
  startDate: string | null | undefined,
  endDate: string | null | undefined
) {
  return ['deposit-match', restaurantId, startDate, endDate] as const;
}

/**
 * The partial key every write mutation invalidates on success. React Query
 * matches this prefix against every `depositMatchQueryKey(restaurantId, ...)`
 * entry, so one invalidation covers every date range cached for the
 * restaurant.
 */
function depositMatchInvalidationKey(restaurantId: string | null | undefined) {
  return ['deposit-match', restaurantId] as const;
}

interface UseDepositMatchArgs {
  restaurantId: string | null | undefined;
  startDate: string | null | undefined;
  endDate: string | null | undefined;
}

/**
 * Reads the deposit-match report for a date range, and runs the refresh RPC
 * once per `(restaurantId, startDate, endDate)` change before the read is
 * trusted. Per the design, the refresh RPC is NOT part of the read
 * `queryFn` — it is a mutation the hook fires as a side effect, so a
 * window-focus refetch of the read query never re-runs the refresh.
 */
export function useDepositMatch({ restaurantId, startDate, endDate }: UseDepositMatchArgs) {
  const queryClient = useQueryClient();
  const queryKey = depositMatchQueryKey(restaurantId, startDate, endDate);
  const hasRange = Boolean(restaurantId && startDate && endDate);

  const readQuery = useQuery({
    queryKey,
    queryFn: async (): Promise<DepositMatchReport> => {
      const { data, error } = await supabase.rpc('get_deposit_match_report' as any, {
        p_restaurant_id: restaurantId,
        p_start_date: startDate,
        p_end_date: endDate,
      });
      if (error) throw error;
      return parseDepositMatchReport(data);
    },
    enabled: hasRange,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('refresh_deposit_matches' as any, {
        p_restaurant_id: restaurantId,
        p_start_date: startDate,
        p_end_date: endDate,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  // Fire the refresh exactly once per (restaurantId, startDate, endDate)
  // change, not on every render and not on a read refetch.
  const lastRunKey = useRef<string | null>(null);
  useEffect(() => {
    if (!hasRange) return;
    const key = `${restaurantId}:${startDate}:${endDate}`;
    if (lastRunKey.current === key) return;
    lastRunKey.current = key;
    refreshMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, startDate, endDate, hasRange]);

  return {
    report: readQuery.data,
    isLoading: readQuery.isLoading,
    error: readQuery.error,
    isRefreshing: refreshMutation.isPending,
    refreshError: refreshMutation.error,
    // Lets a rule create/update force a re-run for the current range. A new
    // or newly active rule has zero `deposit_match_items` rows until
    // `refresh_deposit_matches` runs — only the effect above calls it, and
    // only once per distinct (restaurantId, startDate, endDate). Without
    // this, adding a rule leaves the ledger empty until the range changes.
    refreshNow: () => refreshMutation.mutate(),
  };
}

/**
 * Reads one rule by id, for the edit form. Filters by restaurant so a
 * cached row never leaks across a restaurant switch (the cache key
 * includes `restaurantId`, and the query itself is scoped the same way).
 */
export function useDepositMatchRule(
  ruleId: string | null | undefined,
  restaurantId: string | null | undefined
) {
  return useQuery({
    queryKey: ['deposit-match-rule', restaurantId, ruleId],
    queryFn: async (): Promise<DepositMatchRule> => {
      const { data, error } = await supabase
        .from('deposit_match_rules' as any)
        .select(
          'id, pos_source, connected_bank_id, settlement, lag_days_min, lag_days_max, fee_pct_min, fee_pct_max, active, source_config'
        )
        .eq('id', ruleId)
        .eq('restaurant_id', restaurantId)
        .single();
      if (error) throw error;
      return data as unknown as DepositMatchRule;
    },
    enabled: Boolean(ruleId && restaurantId),
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });
}

export function useCreateDepositMatchRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DepositMatchRuleInput) => {
      const { data, error } = await supabase
        .from('deposit_match_rules' as any)
        .insert(input as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: depositMatchInvalidationKey(input.restaurant_id) });
    },
  });
}

export function useUpdateDepositMatchRule(restaurantId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, update }: { id: string; update: DepositMatchRuleUpdate }) => {
      if (!restaurantId) {
        throw new Error('No restaurant is selected. Pick a restaurant before you update a rule.');
      }
      // Scope the match to the caller's own restaurant. RLS already limits
      // which rows the update can touch, but a bare `.eq('id', id)` still
      // matches the row for whichever restaurant it belongs to — a
      // multi-restaurant collaborator's request for restaurant A could
      // otherwise update a rule that belongs to restaurant B (found in
      // review, coderabbitai).
      const { data, error } = await supabase
        .from('deposit_match_rules' as any)
        .update(update as any)
        .eq('id', id)
        .eq('restaurant_id', restaurantId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: depositMatchInvalidationKey(restaurantId) });
    },
  });
}

/** Writes a manual resolution (accept/dispute) on an item. */
export function useSetDepositMatchResolution(restaurantId: string | null | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ item_id, resolution, resolution_note }: DepositMatchResolutionInput) => {
      const { data, error } = await supabase
        .from('deposit_match_items' as any)
        .update({
          resolution,
          resolution_note: resolution_note ?? null,
          resolved_by: user?.id ?? null,
          resolved_at: new Date().toISOString(),
        } as any)
        .eq('id', item_id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: depositMatchInvalidationKey(restaurantId) });
    },
  });
}

/** Confirms a suggested link, moving it from `suggested` to `confirmed`. */
export function useConfirmDepositMatchLink(restaurantId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ link_id }: DepositMatchLinkConfirmInput) => {
      const { data, error } = await supabase
        .from('deposit_match_links' as any)
        .update({ state: 'confirmed' } as any)
        .eq('id', link_id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: depositMatchInvalidationKey(restaurantId) });
    },
  });
}
