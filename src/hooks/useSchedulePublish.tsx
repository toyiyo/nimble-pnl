import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SchedulePublication } from '@/types/scheduling';
import { useToast } from '@/hooks/use-toast';

interface PublishScheduleParams {
  restaurantId: string;
  weekStart: Date;
  weekEnd: Date;
  notes?: string;
}

interface UnpublishScheduleParams {
  restaurantId: string;
  weekStart: Date;
  weekEnd: Date;
  reason?: string;
}

export const useSchedulePublications = (restaurantId: string | null) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['schedule_publications', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('schedule_publications')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('published_at', { ascending: false });

      if (error) throw error;
      return data as SchedulePublication[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    publications: data || [],
    loading: isLoading,
    error,
  };
};

export const usePublishSchedule = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ restaurantId, weekStart, weekEnd, notes }: PublishScheduleParams) => {
      // Format dates as YYYY-MM-DD
      const weekStartStr = weekStart.toISOString().split('T')[0];
      const weekEndStr = weekEnd.toISOString().split('T')[0];

      // Call the publish_schedule function
      const { data, error } = await supabase.rpc('publish_schedule', {
        p_restaurant_id: restaurantId,
        p_week_start: weekStartStr,
        p_week_end: weekEndStr,
        p_notes: notes || null,
      });

      if (error) throw error;
      
      const publicationId = data;

      // Send push notifications asynchronously (don't await)
      supabase.functions
        .invoke('notify-schedule-published', {
          body: {
            publicationId,
            restaurantId,
            weekStart: weekStartStr,
            weekEnd: weekEndStr,
          },
        })
        .then((result) => {
          if (result.error) {
            console.error('Failed to send notifications:', result.error);
          } else {
            console.log('Notifications sent:', result.data);
          }
        });
      
      return { publicationId, restaurantId };
    },
    onSuccess: ({ restaurantId }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['schedule_publications', restaurantId] });
      
      toast({
        title: 'Schedule Published',
        description: 'The schedule has been published and locked. Employees will be notified.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error Publishing Schedule',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUnpublishSchedule = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ restaurantId, weekStart, weekEnd, reason }: UnpublishScheduleParams) => {
      // Format dates as YYYY-MM-DD
      const weekStartStr = weekStart.toISOString().split('T')[0];
      const weekEndStr = weekEnd.toISOString().split('T')[0];

      // Call the unpublish_schedule function
      const { data, error } = await supabase.rpc('unpublish_schedule', {
        p_restaurant_id: restaurantId,
        p_week_start: weekStartStr,
        p_week_end: weekEndStr,
        p_reason: reason || null,
      });

      if (error) throw error;
      
      return { shiftCount: data, restaurantId };
    },
    onSuccess: ({ shiftCount, restaurantId }) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['shifts', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['schedule_publications', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['schedule_change_logs', restaurantId] });
      
      toast({
        title: 'Schedule Unpublished',
        description: `${shiftCount} shift${shiftCount !== 1 ? 's' : ''} have been unlocked for editing.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error Unpublishing Schedule',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useWeekPublicationStatus = (
  restaurantId: string | null,
  weekStart: Date,
  weekEnd: Date
) => {
  const { data, isLoading } = useQuery({
    queryKey: ['week_publication_status', restaurantId, weekStart.toISOString(), weekEnd.toISOString()],
    queryFn: async () => {
      if (!restaurantId) return null;

      const weekStartStr = weekStart.toISOString().split('T')[0];
      const weekEndStr = weekEnd.toISOString().split('T')[0];

      // Check if there are actually published shifts for this week
      const { count: publishedShiftCount, error: shiftError } = await supabase
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .gte('start_time', `${weekStartStr}T00:00:00Z`)
        .lte('start_time', `${weekEndStr}T23:59:59Z`)
        .eq('is_published', true);

      if (shiftError) throw shiftError;

      // If no published shifts, return null (not published)
      if (!publishedShiftCount || publishedShiftCount === 0) {
        return null;
      }

      // Get the publication record if shifts are published
      const { data, error } = await supabase
        .from('schedule_publications')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('week_start_date', weekStartStr)
        .eq('week_end_date', weekEndStr)
        .order('published_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as SchedulePublication | null;
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return {
    publication: data,
    isPublished: !!data,
    loading: isLoading,
  };
};
