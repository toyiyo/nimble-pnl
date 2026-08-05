import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { withCollisionSuffix } from '@/lib/reviews/reviewSlug';

export interface ReviewPage {
  id: string;
  restaurant_id: string;
  slug: string;
  name: string;
  is_active: boolean;
  logo_path: string | null;
  headline: string;
  subheadline: string | null;
  promoter_threshold: number;
  destination_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewPageWithStats extends ReviewPage {
  averageRating: number | null;
  ratingCount: number;
  commentCount: number;
}

interface ReviewPageStatsRow {
  review_page_id: string;
  average_rating: number | null;
  rating_count: number;
  comment_count: number;
}

// review_pages / review_page_stats aren't in the generated Supabase types yet
// (added by migrations after the last `npm run sync-types`) — every
// `.from('review_pages' as any)` / `.rpc('review_page_stats' as any)` cast in
// this file is for that gap, not because the shape is genuinely unknown; the
// real shape is the `ReviewPage`/`ReviewPageStatsRow` interfaces above.
type ToastFn = ReturnType<typeof useToast>['toast'];

/** `slug` is globally unique across every tenant — see review_pages_slug_key. */
function isSlugCollision(error: { message?: string } | null | undefined): boolean {
  return Boolean(error?.message?.includes('review_pages_slug_key'));
}

function toastSaveError(toast: ToastFn, error: Error, fallbackTitle: string) {
  toast({ title: fallbackTitle, description: error.message, variant: 'destructive' });
}

/** Shared `UPDATE ... WHERE id = ... AND restaurant_id = ...` chain for review_pages. */
function updateReviewPageRow(id: string, restaurantId: string, patch: Record<string, unknown>) {
  return supabase
    .from('review_pages' as any)
    .update(patch)
    .eq('id', id)
    .eq('restaurant_id', restaurantId);
}

const MAX_SLUG_COLLISION_RETRIES = 5;

/**
 * Retries `attempt` with a fresh `withCollisionSuffix` slug whenever it fails
 * on review_pages_slug_key, instead of ever surfacing "that link is taken" —
 * slug is a single global namespace, so telling a caller their exact guess
 * collided would let anyone probe other tenants' slugs (see the design's
 * "Slug is globally unique" note). Bounded, not unbounded: a real conflict
 * loop this long would mean the RNG's 36^4 space is exhausted, not a genuine
 * collision, so at that point a generic error is the honest answer.
 */
async function withSlugCollisionRetry<T>(
  slug: string,
  attempt: (slug: string) => Promise<{ data: T | null; error: { message?: string } | null }>
): Promise<T> {
  let candidate = slug;
  for (let i = 0; i < MAX_SLUG_COLLISION_RETRIES; i++) {
    const { data, error } = await attempt(candidate);
    if (!error) {
      if (data === null) throw new Error('Save succeeded but returned no data.');
      return data;
    }
    if (!isSlugCollision(error)) throw error;
    candidate = withCollisionSuffix(candidate);
  }
  throw new Error('Could not find an available link right now. Try again in a moment.');
}

export function useReviewPages(restaurantId?: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ['review-pages', restaurantId],
    enabled: Boolean(restaurantId),
    staleTime: 30000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<ReviewPageWithStats[]> => {
      // Two queries, not one per card. The stats query is a server-side
      // GROUP BY (public.review_page_stats), not every response row for the
      // restaurant folded into per-page aggregates in memory — a restaurant
      // with five pages and thousands of responses still costs two round
      // trips, not a payload that grows with response history.
      const [pagesResult, statsResult] = await Promise.all([
        supabase
          .from('review_pages' as any)
          .select(
            'id, restaurant_id, slug, name, is_active, logo_path, headline, subheadline, promoter_threshold, destination_url, created_at, updated_at'
          )
          .eq('restaurant_id', restaurantId!)
          .order('created_at', { ascending: false }),
        // review_page_stats/review_response_metrics aren't in the generated
        // Supabase types yet (added by 20260804110000_review_response_aggregates.sql,
        // after the last `npm run sync-types`); the `as any` casts below are for that.
        supabase.rpc('review_page_stats' as any, { p_restaurant_id: restaurantId! }),
      ]);

      if (pagesResult.error) throw pagesResult.error;
      if (statsResult.error) throw statsResult.error;

      const totals = new Map<string, ReviewPageStatsRow>();
      for (const row of (statsResult.data ?? []) as unknown as ReviewPageStatsRow[]) {
        totals.set(row.review_page_id, row);
      }

      return ((pagesResult.data ?? []) as unknown as ReviewPage[]).map((page) => {
        const entry = totals.get(page.id);
        return {
          ...page,
          averageRating: entry?.average_rating ?? null,
          ratingCount: entry?.rating_count ?? 0,
          commentCount: entry?.comment_count ?? 0,
        };
      });
    },
  });

  const createPage = useMutation({
    mutationFn: async (input: {
      name: string;
      slug: string;
      headline: string;
      subheadline: string | null;
      promoter_threshold: number;
      destination_url: string | null;
    }) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const { data: auth } = await supabase.auth.getUser();

      return withSlugCollisionRetry(input.slug, async (slug) => {
        const { data, error } = await supabase
          .from('review_pages' as any)
          .insert({
            ...input,
            slug,
            restaurant_id: restaurantId,
            created_by: auth.user?.id ?? null,
          })
          .select('id')
          .single();
        return { data: data as unknown as { id: string } | null, error };
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-pages', restaurantId] });
      toast({ title: 'Page created' });
    },
    onError: (error: Error) => toastSaveError(toast, error, 'Could not create the page'),
  });

  const updatePage = useMutation({
    mutationFn: async ({ id, ...rest }: Partial<ReviewPage> & { id: string }) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      // The .eq('restaurant_id', …) is belt to RLS's braces: an id from a stale
      // cache or a hand-edited request can never reach another tenant's row.
      if (rest.slug === undefined) {
        const { error } = await updateReviewPageRow(id, restaurantId, rest);
        if (error) throw error;
        return;
      }

      await withSlugCollisionRetry(rest.slug, async (slug) => {
        const { error } = await updateReviewPageRow(id, restaurantId, { ...rest, slug });
        return { data: error ? null : {}, error };
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-pages', restaurantId] });
      toast({ title: 'Saved' });
    },
    onError: (error: Error) => toastSaveError(toast, error, 'Could not save'),
  });

  const uploadLogo = useCallback(
    async (pageId: string, file: File): Promise<string> => {
      if (!restaurantId) throw new Error('No restaurant selected');

      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      const path = `${restaurantId}/${pageId}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from('review-page-logos')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('review_pages' as any)
        .update({ logo_path: path })
        .eq('id', pageId)
        .eq('restaurant_id', restaurantId);
      if (updateError) throw updateError;

      queryClient.invalidateQueries({ queryKey: ['review-pages', restaurantId] });
      return path;
    },
    [queryClient, restaurantId]
  );

  return {
    pages: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    createPage: createPage.mutateAsync,
    updatePage: updatePage.mutateAsync,
    uploadLogo,
    isSaving: createPage.isPending || updatePage.isPending,
  };
}
