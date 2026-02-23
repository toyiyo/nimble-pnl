import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface BulkShiftInsert {
  restaurant_id: string;
  employee_id: string;
  start_time: string;
  end_time: string;
  break_duration: number;
  position: string;
  notes?: string | null;
  status: 'scheduled';
  is_published: boolean;
  locked: boolean;
}

const chunkSize = 500;

export function useBulkCreateShifts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (shifts: BulkShiftInsert[]) => {
      if (!shifts.length) return [];

      const allCreated: unknown[] = [];

      for (let i = 0; i < shifts.length; i += chunkSize) {
        const chunk = shifts.slice(i, i + chunkSize);
        const { data, error } = await supabase
          .from('shifts')
          .insert(chunk)
          .select();

        if (error) throw error;
        if (data) allCreated.push(...data);
      }

      return allCreated;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Import failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
