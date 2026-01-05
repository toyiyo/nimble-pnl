import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type TipSource = 'cash' | 'credit' | 'pool' | 'other';

export interface EmployeeTip {
  id: string;
  restaurant_id: string;
  employee_id: string;
  shift_id?: string;
  tip_amount: number; // In cents
  tip_source: TipSource;
  recorded_at: string;
  tip_date: string; // YYYY-MM-DD format for date-based filtering
  notes?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  employee?: {
    name: string;
    position?: string;
  };
}

export interface CreateEmployeeTipInput {
  restaurant_id: string;
  employee_id: string;
  tip_amount: number; // In cents
  tip_source: TipSource;
  notes?: string;
  shift_id?: string;
}

/**
 * Hook to manage employee tip submissions
 * Used for employees to declare their own tips (cash/credit)
 */
export function useEmployeeTips(restaurantId: string | null, employeeId?: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch employee tips
  const { data: tips, isLoading, error } = useQuery({
    queryKey: ['employee-tips', restaurantId, employeeId],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('employee_tips')
        .select(`
          *,
          employee:employees!employee_id(name, position)
        `)
        .eq('restaurant_id', restaurantId)
        .order('recorded_at', { ascending: false });

      if (employeeId) {
        query = query.eq('employee_id', employeeId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as EmployeeTip[];
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
  });

  // Create employee tip submission
  const { mutateAsync: submitTip, isPending: isSubmitting } = useMutation({
    mutationFn: async (input: CreateEmployeeTipInput) => {
      const { data: user } = await supabase.auth.getUser();
      const now = new Date();
      
      const { data, error } = await supabase
        .from('employee_tips')
        .insert({
          restaurant_id: input.restaurant_id,
          employee_id: input.employee_id,
          tip_amount: input.tip_amount,
          tip_source: input.tip_source,
          notes: input.notes,
          shift_id: input.shift_id,
          recorded_at: now.toISOString(),
          tip_date: now.toISOString().split('T')[0], // YYYY-MM-DD format
          created_by: user.user?.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as EmployeeTip;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employee-tips'] });
      toast({
        title: 'Tips submitted',
        description: `Your tips have been recorded and will be reviewed by management.`,
      });
    },
    onError: (error) => {
      if (import.meta.env.DEV) {
        console.error('Error submitting tips:', error);
      }
      toast({
        title: 'Failed to submit tips',
        description: 'Please try again or contact a manager.',
        variant: 'destructive',
      });
    },
  });

  // Delete employee tip (admin only)
  const { mutate: deleteTip, isPending: isDeleting } = useMutation({
    mutationFn: async (tipId: string) => {
      const { error } = await supabase
        .from('employee_tips')
        .delete()
        .eq('id', tipId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employee-tips'] });
      toast({
        title: 'Tip deleted',
        description: 'The tip submission has been removed.',
      });
    },
    onError: (error) => {
      if (import.meta.env.DEV) {
        console.error('Error deleting tip:', error);
      }
      toast({
        title: 'Failed to delete tip',
        description: 'Please try again.',
        variant: 'destructive',
      });
    },
  });

  return {
    tips: tips || [],
    isLoading,
    error,
    submitTip,
    isSubmitting,
    deleteTip,
    isDeleting,
  };
}

/**
 * Calculate total tips for an employee in a date range
 */
export function calculateEmployeeTipTotal(tips: EmployeeTip[]): number {
  return tips.reduce((sum, tip) => sum + tip.tip_amount, 0);
}

/**
 * Group tips by date
 */
export function groupTipsByDate(tips: EmployeeTip[]): Map<string, EmployeeTip[]> {
  const grouped = new Map<string, EmployeeTip[]>();
  
  tips.forEach(tip => {
    const date = tip.recorded_at.split('T')[0]; // Get YYYY-MM-DD
    if (!grouped.has(date)) {
      grouped.set(date, []);
    }
    grouped.get(date)!.push(tip);
  });
  
  return grouped;
}
