import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';

import { useToast } from '@/hooks/use-toast';

import { SchedulePublication } from '@/types/scheduling';

// ---------------------------------------------------------------------------
// Query: check if a week has been published
// ---------------------------------------------------------------------------

export function useWeekPublicationStatus(
  restaurantId: string | null,
  weekStartDate: string | null,
) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['schedule-publication-status', restaurantId, weekStartDate],
    queryFn: async () => {
      if (!restaurantId || !weekStartDate) return null;

      // Calculate week end date (6 days after start)
      const start = new Date(weekStartDate + 'T00:00:00');
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const weekEndDate = end.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from('schedule_publications')
        .select('id, restaurant_id, week_start_date, week_end_date, published_at, published_by, shift_count, notes')
        .eq('restaurant_id', restaurantId)
        .eq('week_start_date', weekStartDate)
        .eq('week_end_date', weekEndDate)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as SchedulePublication | null;
    },
    enabled: !!restaurantId && !!weekStartDate,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return {
    publication: data ?? null,
    isPublished: !!data,
    isLoading,
    loading: isLoading,
    error,
  };
}

// ---------------------------------------------------------------------------
// Mutation: publish a schedule for a week
// ---------------------------------------------------------------------------

export function usePublishSchedule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      restaurantId,
      weekStartDate,
      notes,
    }: {
      restaurantId: string;
      weekStartDate: string;
      notes?: string;
    }) => {
      // Calculate week end date (6 days after start)
      const start = new Date(weekStartDate + 'T00:00:00');
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const weekEndDate = end.toISOString().slice(0, 10);

      const { data, error } = await supabase.rpc('publish_schedule', {
        p_restaurant_id: restaurantId,
        p_week_start: weekStartDate,
        p_week_end: weekEndDate,
        p_notes: notes ?? null,
      });

      if (error) throw error;
      return { publicationId: data, restaurantId, weekStartDate };
    },
    onSuccess: ({ restaurantId, weekStartDate }) => {
      queryClient.invalidateQueries({
        queryKey: ['schedule-publication-status', restaurantId, weekStartDate],
      });
      queryClient.invalidateQueries({
        queryKey: ['schedule-slots', restaurantId, weekStartDate],
      });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({
        title: 'Schedule published',
        description: 'The schedule has been published and shifts are now locked.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error publishing schedule',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Mutation: unpublish a schedule for a week
// ---------------------------------------------------------------------------

export function useUnpublishSchedule() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      restaurantId,
      weekStart,
      weekEnd,
      reason,
    }: {
      restaurantId: string;
      weekStart: string;
      weekEnd: string;
      reason?: string;
    }) => {
      const { data, error } = await supabase.rpc('unpublish_schedule', {
        p_restaurant_id: restaurantId,
        p_week_start: weekStart,
        p_week_end: weekEnd,
        p_reason: reason ?? null,
      });

      if (error) throw error;
      return { shiftCount: data, restaurantId, weekStart };
    },
    onSuccess: ({ restaurantId, weekStart }) => {
      queryClient.invalidateQueries({
        queryKey: ['schedule-publication-status', restaurantId, weekStart],
      });
      queryClient.invalidateQueries({
        queryKey: ['schedule-slots', restaurantId, weekStart],
      });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({
        title: 'Schedule unpublished',
        description: 'The schedule has been unpublished and shifts are now unlocked.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error unpublishing schedule',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
