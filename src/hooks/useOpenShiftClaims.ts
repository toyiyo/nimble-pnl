import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { OpenShiftClaim } from '@/types/scheduling';

export function useOpenShiftClaims(restaurantId: string | null, employeeId?: string | null) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['open_shift_claims', restaurantId, employeeId],
    queryFn: async () => {
      if (!restaurantId) return [];
      let query = (supabase.from('open_shift_claims') as any)
        .select('*, shift_template:shift_templates(name, start_time, end_time, position)')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (employeeId) {
        query = query.eq('claimed_by_employee_id', employeeId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as (OpenShiftClaim & { shift_template?: { name: string; start_time: string; end_time: string; position: string } })[];
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  return { claims: data ?? [], loading: isLoading, error };
}

export function useClaimOpenShift() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      restaurantId: string;
      templateId: string;
      shiftDate: string;
      employeeId: string;
    }) => {
      const { data, error } = await (supabase.rpc as any)('claim_open_shift', {
        p_restaurant_id: params.restaurantId,
        p_template_id: params.templateId,
        p_shift_date: params.shiftDate,
        p_employee_id: params.employeeId,
      });

      if (error) throw error;
      const result = data as { success: boolean; error?: string; status?: string; message?: string };
      if (!result.success) throw new Error(result.error ?? 'Failed to claim shift');
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['open_shifts'] });
      queryClient.invalidateQueries({ queryKey: ['open_shift_claims'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({
        title: result.status === 'pending_approval' ? 'Claim submitted' : 'Shift claimed!',
        description: result.message,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Cannot claim shift', description: error.message, variant: 'destructive' });
    },
  });
}

export function useApproveClaimMutation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { claimId: string; note?: string }) => {
      const { data, error } = await (supabase.rpc as any)('approve_open_shift_claim', {
        p_claim_id: params.claimId,
        p_reviewer_note: params.note ?? null,
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error ?? 'Failed to approve claim');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['open_shift_claims'] });
      queryClient.invalidateQueries({ queryKey: ['open_shifts'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast({ title: 'Claim approved' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
}

export function useRejectClaimMutation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { claimId: string; note?: string }) => {
      const { data, error } = await (supabase.rpc as any)('reject_open_shift_claim', {
        p_claim_id: params.claimId,
        p_reviewer_note: params.note ?? null,
      });
      if (error) throw error;
      const result = data as { success: boolean; error?: string };
      if (!result.success) throw new Error(result.error ?? 'Failed to reject claim');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['open_shift_claims'] });
      queryClient.invalidateQueries({ queryKey: ['open_shifts'] });
      toast({ title: 'Claim rejected' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });
}
