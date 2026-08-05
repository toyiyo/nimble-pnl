import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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

interface ResponseStatRow {
  review_page_id: string;
  rating: number;
  comment: string | null;
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
      // Two queries, not one per card. The stats query returns every response
      // for the restaurant and is folded into per-page aggregates in memory —
      // a restaurant with five pages costs two round trips, not six.
      const [pagesResult, statsResult] = await Promise.all([
        supabase
          .from('review_pages' as any)
          .select(
            'id, restaurant_id, slug, name, is_active, logo_path, headline, subheadline, promoter_threshold, destination_url, created_at, updated_at'
          )
          .eq('restaurant_id', restaurantId!)
          .order('created_at', { ascending: false }),
        supabase
          .from('review_responses' as any)
          .select('review_page_id, rating, comment')
          .eq('restaurant_id', restaurantId!),
      ]);

      if (pagesResult.error) throw pagesResult.error;
      if (statsResult.error) throw statsResult.error;

      const totals = new Map<string, { sum: number; count: number; comments: number }>();
      for (const row of (statsResult.data ?? []) as unknown as ResponseStatRow[]) {
        const entry = totals.get(row.review_page_id) ?? { sum: 0, count: 0, comments: 0 };
        entry.sum += row.rating;
        entry.count += 1;
        if (row.comment) entry.comments += 1;
        totals.set(row.review_page_id, entry);
      }

      return ((pagesResult.data ?? []) as unknown as ReviewPage[]).map((page) => {
        const entry = totals.get(page.id);
        return {
          ...page,
          averageRating: entry && entry.count > 0 ? Math.round((entry.sum / entry.count) * 10) / 10 : null,
          ratingCount: entry?.count ?? 0,
          commentCount: entry?.comments ?? 0,
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

      const { data, error } = await supabase
        .from('review_pages' as any)
        .insert({
          ...input,
          restaurant_id: restaurantId,
          created_by: auth.user?.id ?? null,
        })
        .select('id')
        .single();

      if (error) throw error;
      return data as unknown as { id: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-pages', restaurantId] });
      toast({ title: 'Page created' });
    },
    onError: (error: Error) => {
      const duplicate = error.message.includes('review_pages_slug_key');
      toast({
        title: duplicate ? 'That link is taken' : 'Could not create the page',
        description: duplicate ? 'Pick a different link and try again.' : error.message,
        variant: 'destructive',
      });
    },
  });

  const updatePage = useMutation({
    mutationFn: async ({ id, ...rest }: Partial<ReviewPage> & { id: string }) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      // The .eq('restaurant_id', …) is belt to RLS's braces: an id from a stale
      // cache or a hand-edited request can never reach another tenant's row.
      const { error } = await supabase
        .from('review_pages' as any)
        .update(rest)
        .eq('id', id)
        .eq('restaurant_id', restaurantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-pages', restaurantId] });
      toast({ title: 'Saved' });
    },
    onError: (error: Error) => {
      const duplicate = error.message.includes('review_pages_slug_key');
      toast({
        title: duplicate ? 'That link is taken' : 'Could not save',
        description: duplicate ? 'Pick a different link and try again.' : error.message,
        variant: 'destructive',
      });
    },
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
