// Gusto Flows Hook
// Manages Gusto Flow URL generation for embedded UI components

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { GustoFlowType, GustoFlowResponse } from '@/types/gusto';

interface UseGustoFlowsReturn {
  flowUrl: string | null;
  expiresAt: Date | null;
  flowType: GustoFlowType | null;
  isLoading: boolean;
  error: Error | null;
  generateFlowUrl: (flowType: GustoFlowType, entityUuid?: string, entityType?: string) => Promise<void>;
  clearFlow: () => void;
  isExpired: boolean;
}

export const useGustoFlows = (
  restaurantId: string | null
): UseGustoFlowsReturn => {
  const { toast } = useToast();
  const [flowUrl, setFlowUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [flowType, setFlowType] = useState<GustoFlowType | null>(null);

  // Check if current flow is expired
  const isExpired = expiresAt ? new Date() > expiresAt : false;

  // Mutation to generate flow URL
  const generateMutation = useMutation({
    mutationFn: async ({
      flowType,
      entityUuid,
      entityType,
    }: {
      flowType: GustoFlowType;
      entityUuid?: string;
      entityType?: string;
    }) => {
      if (!restaurantId) throw new Error('Restaurant ID is required');

      const { data, error } = await supabase.functions.invoke('gusto-create-flow', {
        body: {
          restaurantId,
          flowType,
          entityUuid,
          entityType,
        },
      });

      if (error) throw error;
      if (!data?.flowUrl && !data?.url) throw new Error('No flow URL received');

      return data as GustoFlowResponse;
    },
    onSuccess: (data, variables) => {
      setFlowUrl(data.flowUrl || data.url);
      if (data.expires_at || data.expiresAt) {
        setExpiresAt(new Date(data.expires_at || data.expiresAt));
      }
      setFlowType(variables.flowType);
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to load Gusto',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const generateFlowUrl = useCallback(
    async (
      flowType: GustoFlowType,
      entityUuid?: string,
      entityType?: string
    ) => {
      await generateMutation.mutateAsync({ flowType, entityUuid, entityType });
    },
    [generateMutation]
  );

  const clearFlow = useCallback(() => {
    setFlowUrl(null);
    setExpiresAt(null);
    setFlowType(null);
  }, []);

  return {
    flowUrl,
    expiresAt,
    flowType,
    isLoading: generateMutation.isPending,
    error: generateMutation.error as Error | null,
    generateFlowUrl,
    clearFlow,
    isExpired,
  };
};

/**
 * Pre-defined flow configurations for common use cases
 * Flow types: https://docs.gusto.com/embedded-payroll/docs/flow-types
 */
export const GUSTO_FLOW_CONFIGS = {
  companyOnboarding: {
    flowType: 'company_onboarding' as GustoFlowType,
    title: 'Company Setup',
    description: 'Complete your company setup for payroll',
  },
  addEmployees: {
    flowType: 'add_employees' as GustoFlowType,
    title: 'Add Employees',
    description: 'Add new W-2 employees to payroll',
  },
  addContractors: {
    flowType: 'add_contractors' as GustoFlowType,
    title: 'Add Contractors',
    description: 'Add 1099 contractors for payments',
  },
  runPayroll: {
    flowType: 'run_payroll' as GustoFlowType,
    title: 'Run Payroll',
    description: 'Process payroll for your employees',
  },
  federalTaxSetup: {
    flowType: 'federal_tax_setup' as GustoFlowType,
    title: 'Federal Tax Setup',
    description: 'Configure federal tax settings',
  },
  stateTaxSetup: {
    flowType: 'state_tax_setup' as GustoFlowType,
    title: 'State Tax Setup',
    description: 'Configure state tax settings',
  },
} as const;
