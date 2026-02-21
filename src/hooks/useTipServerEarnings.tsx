import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface TipServerEarning {
  id: string;
  tip_split_id: string;
  employee_id: string;
  earned_amount: number;
  retained_amount: number;
  refunded_amount: number;
  created_at: string;
  employee_name?: string;
}

export type SaveServerEarningsInput = {
  employee_id: string;
  earned_amount: number;
  retained_amount: number;
  refunded_amount: number;
};

export function useTipServerEarnings(splitId: string | null) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: earnings = [], isLoading, error } = useQuery({
    queryKey: ['tip-server-earnings', splitId],
    queryFn: async () => {
      if (!splitId) return [];

      const { data, error } = await supabase
        .from('tip_server_earnings')
        .select('*, employees(first_name, last_name)')
        .eq('tip_split_id', splitId);

      if (error) throw error;

      type EarningRow = Omit<TipServerEarning, 'employee_name'> & {
        employees: { first_name: string; last_name: string } | null;
      };

      return (data ?? []).map((row: EarningRow) => ({
        id: row.id,
        tip_split_id: row.tip_split_id,
        employee_id: row.employee_id,
        earned_amount: row.earned_amount,
        retained_amount: row.retained_amount,
        refunded_amount: row.refunded_amount,
        created_at: row.created_at,
        employee_name: row.employees
          ? `${row.employees.first_name} ${row.employees.last_name}`
          : undefined,
      }));
    },
    enabled: !!splitId,
    staleTime: 30000,
  });

  const { mutateAsync: saveServerEarnings, isPending: isSaving } = useMutation({
    mutationFn: async ({ splitId: sid, earnings: earningsInput }: { splitId: string; earnings: SaveServerEarningsInput[] }) => {
      // Delete existing earnings for this split, then insert new ones
      const { error: deleteError } = await supabase
        .from('tip_server_earnings')
        .delete()
        .eq('tip_split_id', sid);

      if (deleteError) throw deleteError;

      if (earningsInput.length === 0) return [];

      const rows = earningsInput.map(e => ({
        tip_split_id: sid,
        employee_id: e.employee_id,
        earned_amount: e.earned_amount,
        retained_amount: e.retained_amount,
        refunded_amount: e.refunded_amount,
      }));

      const { data, error } = await supabase
        .from('tip_server_earnings')
        .insert(rows)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tip-server-earnings', variables.splitId] });
    },
    onError: (error: Error) => {
      toast({ title: 'Error saving server earnings', description: error.message, variant: 'destructive' });
    },
  });

  return {
    earnings,
    isLoading,
    error,
    saveServerEarnings,
    isSaving,
  };
}
