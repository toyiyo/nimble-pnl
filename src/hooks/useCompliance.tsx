import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { 
  ComplianceRule, 
  ComplianceViolation, 
  ComplianceCheckResult,
  ViolationDetails 
} from '@/types/compliance';

// Cache configuration
const COMPLIANCE_CACHE_STALE_TIME = 30000; // 30 seconds

// Fetch compliance rules for a restaurant
export const useComplianceRules = (restaurantId: string | null) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['compliance-rules', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return [];

      const { data, error } = await supabase
        .from('compliance_rules')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('rule_type');

      if (error) throw error;
      return data as ComplianceRule[];
    },
    enabled: !!restaurantId,
    staleTime: COMPLIANCE_CACHE_STALE_TIME,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    rules: data || [],
    loading: isLoading,
    error,
  };
};

// Create compliance rule
export const useCreateComplianceRule = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (rule: Omit<ComplianceRule, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('compliance_rules')
        .insert(rule)
        .select()
        .single();

      if (error) throw error;
      return data as ComplianceRule;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['compliance-rules', data.restaurant_id] });
      toast({
        title: 'Compliance rule created',
        description: 'The compliance rule has been added.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error creating compliance rule',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

// Update compliance rule
export const useUpdateComplianceRule = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ComplianceRule> & { id: string }) => {
      const { data, error } = await supabase
        .from('compliance_rules')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as ComplianceRule;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['compliance-rules', data.restaurant_id] });
      toast({
        title: 'Compliance rule updated',
        description: 'The compliance rule has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating compliance rule',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

// Delete compliance rule
export const useDeleteComplianceRule = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { error } = await supabase
        .from('compliance_rules')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { id, restaurantId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['compliance-rules', data.restaurantId] });
      toast({
        title: 'Compliance rule deleted',
        description: 'The compliance rule has been removed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting compliance rule',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

// Check shift compliance (calls the database function)
export const useCheckShiftCompliance = () => {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      shiftId,
      restaurantId,
      employeeId,
      startTime,
      endTime,
    }: {
      shiftId: string | null;
      restaurantId: string;
      employeeId: string;
      startTime: string;
      endTime: string;
    }) => {
      const { data, error } = await supabase.rpc('check_shift_compliance', {
        p_shift_id: shiftId,
        p_restaurant_id: restaurantId,
        p_employee_id: employeeId,
        p_start_time: startTime,
        p_end_time: endTime,
      });

      if (error) throw error;

      const violations = (data as ViolationDetails[]) || [];
      
      const result: ComplianceCheckResult = {
        hasViolations: violations.length > 0,
        violations,
        canOverride: violations.every(v => v.severity !== 'critical'),
        requiresOverride: violations.some(v => v.severity === 'error'),
      };

      return result;
    },
    onError: (error: Error) => {
      toast({
        title: 'Error checking compliance',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

// Fetch compliance violations
export const useComplianceViolations = (
  restaurantId: string | null,
  filters?: {
    status?: string;
    employeeId?: string;
    startDate?: Date;
    endDate?: Date;
  }
) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['compliance-violations', restaurantId, filters],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('compliance_violations')
        .select(`
          *,
          employee:employees(id, name, position),
          shift:shifts(id, start_time, end_time, position)
        `)
        .eq('restaurant_id', restaurantId);

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      if (filters?.employeeId) {
        query = query.eq('employee_id', filters.employeeId);
      }

      if (filters?.startDate) {
        query = query.gte('created_at', filters.startDate.toISOString());
      }

      if (filters?.endDate) {
        query = query.lte('created_at', filters.endDate.toISOString());
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      return data as ComplianceViolation[];
    },
    enabled: !!restaurantId,
    staleTime: COMPLIANCE_CACHE_STALE_TIME,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    violations: data || [],
    loading: isLoading,
    error,
  };
};

// Override a compliance violation
export const useOverrideViolation = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      overrideReason,
      userId,
    }: {
      id: string;
      overrideReason: string;
      userId: string;
    }) => {
      const { data, error } = await supabase
        .from('compliance_violations')
        .update({
          status: 'overridden',
          override_reason: overrideReason,
          overridden_by: userId,
          overridden_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as ComplianceViolation;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['compliance-violations', data.restaurant_id] });
      toast({
        title: 'Violation overridden',
        description: 'The compliance violation has been overridden.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error overriding violation',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

// Create compliance violation
export const useCreateComplianceViolation = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (
      violation: Omit<ComplianceViolation, 'id' | 'created_at' | 'updated_at' | 'employee' | 'shift'>
    ) => {
      const { data, error } = await supabase
        .from('compliance_violations')
        .insert(violation)
        .select()
        .single();

      if (error) throw error;
      return data as ComplianceViolation;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['compliance-violations', data.restaurant_id] });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error creating violation record',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
