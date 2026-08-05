import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { ReviewMetrics } from '@/lib/reviews/reviewMetrics';

export type ReviewResponseStatus = 'new' | 'in_progress' | 'resolved';

export interface ReviewResponse {
  id: string;
  restaurant_id: string;
  review_page_id: string;
  rating: number;
  routed_to: 'destination' | 'feedback';
  comment: string | null;
  contact_consent: boolean;
  status: ReviewResponseStatus;
  submitted_at: string;
  commented_at: string | null;
}

export interface ReviewResponseContact {
  contact_name: string | null;
  contact_email: string | null;
}

interface ReviewResponseMetricsRow {
  average_rating: number | null;
  total_ratings: number;
  comment_count: number;
  unread_count: number;
}

// review_responses / review_response_contacts / review_response_metrics
// aren't in the generated Supabase types yet (added by migrations after the
// last `npm run sync-types`) — every `.from('table' as any)` /
// `.rpc('review_response_metrics' as any)` cast in this file is for that
// gap; the real shapes are the interfaces above.

export function useReviewResponses(restaurantId?: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ['review-responses', restaurantId],
    enabled: Boolean(restaurantId),
    staleTime: 30000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ReviewResponse[]> => {
      // Capped at 500 for the inbox *list* only — that's a reasonable amount
      // of recent comments to page through. The header metrics below do NOT
      // come from this capped array; they're a separate, uncapped server-side
      // aggregate, so a restaurant past 500 responses still sees a correct
      // average/total/unread count.
      const { data, error } = await supabase
        .from('review_responses' as any)
        .select(
          'id, restaurant_id, review_page_id, rating, routed_to, comment, contact_consent, status, submitted_at, commented_at'
        )
        .eq('restaurant_id', restaurantId!)
        .order('submitted_at', { ascending: false })
        .limit(500);

      if (error) throw error;
      return (data ?? []) as unknown as ReviewResponse[];
    },
  });

  const metricsQuery = useQuery({
    queryKey: ['review-response-metrics', restaurantId],
    enabled: Boolean(restaurantId),
    staleTime: 30000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ReviewMetrics> => {
      // review_response_metrics isn't in the generated Supabase types yet
      // (added by 20260804110000_review_response_aggregates.sql, after the
      // last `npm run sync-types`) — hence the `as any` cast.
      const { data, error } = await supabase.rpc('review_response_metrics' as any, {
        p_restaurant_id: restaurantId!,
      });
      if (error) throw error;
      const row = ((data ?? []) as unknown as ReviewResponseMetricsRow[])[0];
      return {
        averageRating: row?.average_rating ?? null,
        totalRatings: row?.total_ratings ?? 0,
        commentCount: row?.comment_count ?? 0,
        unreadCount: row?.unread_count ?? 0,
      };
    },
  });

  const responses = query.data ?? [];
  const metrics: ReviewMetrics =
    metricsQuery.data ?? { averageRating: null, totalRatings: 0, commentCount: 0, unreadCount: 0 };

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ReviewResponseStatus }) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const { error } = await supabase
        .from('review_responses' as any)
        .update({ status })
        .eq('id', id)
        .eq('restaurant_id', restaurantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-responses', restaurantId] });
      // A status change (e.g. clearing "new") moves unreadCount, which comes
      // from the separate aggregate query, not the list above.
      queryClient.invalidateQueries({ queryKey: ['review-response-metrics', restaurantId] });
    },
    onError: (error: Error) => {
      toast({ title: 'Could not update', description: error.message, variant: 'destructive' });
    },
  });

  // Contact details live in their own table so that RLS — which is row-level,
  // not column-level — can hold them to manage:reviews while the comment
  // itself stays readable at view:reviews. A viewer's fetch returns no rows
  // rather than an error, and the caller renders nothing.
  const fetchContact = useCallback(
    async (responseId: string): Promise<ReviewResponseContact | null> => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const { data, error } = await supabase
        .from('review_response_contacts' as any)
        .select('contact_name, contact_email')
        .eq('review_response_id', responseId)
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error) return null;
      return (data as unknown as ReviewResponseContact) ?? null;
    },
    [restaurantId]
  );

  return {
    responses,
    metrics,
    isLoading: query.isLoading || metricsQuery.isLoading,
    error: (query.error ?? metricsQuery.error) as Error | null,
    updateStatus: updateStatus.mutateAsync,
    fetchContact,
  };
}
