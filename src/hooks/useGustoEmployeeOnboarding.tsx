// Gusto Employee Onboarding Hook
// Manages employee-side Gusto payroll onboarding state and flows

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useState, useCallback, useEffect } from 'react';
import { GustoFlowType, GustoEmployeeOnboardingStatus } from '@/types/gusto';

interface GustoEmployeeOnboardingState {
  gustoEmployeeUuid: string | null;
  onboardingStatus: GustoEmployeeOnboardingStatus | null;
  syncStatus: 'not_synced' | 'pending' | 'synced' | 'error' | null;
  syncedAt: string | null;
}

interface UseGustoEmployeeOnboardingReturn {
  // Onboarding state
  onboardingState: GustoEmployeeOnboardingState | null;
  isLoading: boolean;
  error: Error | null;

  // Flow management
  flowUrl: string | null;
  flowLoading: boolean;
  flowExpired: boolean;

  // Actions
  openOnboardingFlow: () => Promise<void>;
  clearFlow: () => void;
  refreshStatus: () => void;

  // Status helpers
  isOnboardingComplete: boolean;
  isOnboardingPending: boolean;
  needsOnboarding: boolean;
  hasGustoAccount: boolean;
}

/**
 * Hook for managing employee-side Gusto onboarding
 * Used in the employee portal to allow employees to complete payroll setup
 */
export const useGustoEmployeeOnboarding = (
  restaurantId: string | null,
  employeeId: string | null
): UseGustoEmployeeOnboardingReturn => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [flowUrl, setFlowUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);

  // Check if flow is expired
  const flowExpired = expiresAt ? new Date() > expiresAt : false;

  // Query employee's Gusto onboarding state
  const {
    data: onboardingState,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['gustoEmployeeOnboarding', restaurantId, employeeId],
    queryFn: async () => {
      if (!restaurantId || !employeeId) return null;

      const { data, error } = await supabase
        .from('employees')
        .select('gusto_employee_uuid, gusto_onboarding_status, gusto_sync_status, gusto_synced_at')
        .eq('id', employeeId)
        .eq('restaurant_id', restaurantId)
        .single();

      if (error) throw error;

      return {
        gustoEmployeeUuid: data.gusto_employee_uuid,
        onboardingStatus: data.gusto_onboarding_status as GustoEmployeeOnboardingStatus | null,
        syncStatus: data.gusto_sync_status as 'not_synced' | 'pending' | 'synced' | 'error' | null,
        syncedAt: data.gusto_synced_at,
      } as GustoEmployeeOnboardingState;
    },
    enabled: !!restaurantId && !!employeeId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  // Mutation to generate the self-management flow URL
  const generateFlowMutation = useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error('Restaurant ID is required');
      if (!onboardingState?.gustoEmployeeUuid) {
        throw new Error('Employee is not yet synced to Gusto. Please contact your manager.');
      }

      const { data, error } = await supabase.functions.invoke('gusto-create-flow', {
        body: {
          restaurantId,
          flowType: 'employee_self_management' as GustoFlowType,
          entityUuid: onboardingState.gustoEmployeeUuid,
          entityType: 'Employee',
        },
      });

      if (error) throw error;
      if (!data?.flowUrl && !data?.url) throw new Error('No flow URL received');

      return data;
    },
    onSuccess: (data) => {
      setFlowUrl(data.flowUrl || data.url);
      if (data.expires_at || data.expiresAt) {
        setExpiresAt(new Date(data.expires_at || data.expiresAt));
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to load payroll onboarding',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Note: We intentionally use an empty dependency array here because
  // mutateAsync is stable and we don't want to cause infinite loops
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const openOnboardingFlow = useCallback(async () => {
    await generateFlowMutation.mutateAsync();
  }, []);

  const clearFlow = useCallback(() => {
    setFlowUrl(null);
    setExpiresAt(null);
  }, []);

  const refreshStatus = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ['gustoEmployeeOnboarding', restaurantId, employeeId],
    });
    queryClient.invalidateQueries({
      queryKey: ['current-employee', restaurantId],
    });
  }, [queryClient, restaurantId, employeeId]);

  // Status helpers
  const hasGustoAccount = !!onboardingState?.gustoEmployeeUuid;

  const isOnboardingComplete =
    onboardingState?.onboardingStatus === 'onboarding_completed' ||
    onboardingState?.onboardingStatus === 'self_onboarding_completed_by_employee';

  const isOnboardingPending =
    onboardingState?.onboardingStatus === 'self_onboarding_pending_invite' ||
    onboardingState?.onboardingStatus === 'self_onboarding_invited' ||
    onboardingState?.onboardingStatus === 'self_onboarding_in_progress' ||
    onboardingState?.onboardingStatus === 'admin_onboarding_incomplete';

  const needsOnboarding = hasGustoAccount && !isOnboardingComplete;

  return {
    onboardingState,
    isLoading,
    error: error as Error | null,
    flowUrl,
    flowLoading: generateFlowMutation.isPending,
    flowExpired,
    openOnboardingFlow,
    clearFlow,
    refreshStatus,
    isOnboardingComplete,
    isOnboardingPending,
    needsOnboarding,
    hasGustoAccount,
  };
};

/**
 * Get human-readable onboarding status
 */
export const getOnboardingStatusLabel = (
  status: GustoEmployeeOnboardingStatus | null | undefined
): { label: string; description: string; variant: 'default' | 'warning' | 'success' | 'destructive' } => {
  switch (status) {
    case 'onboarding_completed':
    case 'self_onboarding_completed_by_employee':
      return {
        label: 'Complete',
        description: 'Payroll onboarding is complete. You\'re all set!',
        variant: 'success',
      };
    case 'self_onboarding_in_progress':
      return {
        label: 'In Progress',
        description: 'Continue your payroll setup to complete onboarding.',
        variant: 'warning',
      };
    case 'self_onboarding_invited':
      return {
        label: 'Invited',
        description: 'You\'ve been invited to complete payroll setup. Click below to continue.',
        variant: 'warning',
      };
    case 'self_onboarding_pending_invite':
      return {
        label: 'Pending',
        description: 'Your payroll account is being set up. You\'ll receive an invitation soon.',
        variant: 'default',
      };
    case 'admin_onboarding_incomplete':
      return {
        label: 'Setup Required',
        description: 'Complete your payroll information to get paid.',
        variant: 'warning',
      };
    default:
      return {
        label: 'Not Started',
        description: 'Payroll setup has not been started yet.',
        variant: 'default',
      };
  }
};

/**
 * Hook to manage the welcome dialog state
 * Shows the dialog once per session when employee needs onboarding
 */
export const useGustoWelcomeDialog = (needsOnboarding: boolean, hasGustoAccount: boolean) => {
  const storageKey = 'gusto_welcome_dismissed';
  const [showWelcome, setShowWelcome] = useState(false);
  const [hasBeenShown, setHasBeenShown] = useState(false);

  useEffect(() => {
    // Only show if:
    // 1. Employee has Gusto account but hasn't completed onboarding
    // 2. Dialog hasn't been shown yet this render cycle (prevents race conditions)
    if (needsOnboarding && hasGustoAccount && !hasBeenShown) {
      // Check if already dismissed this session
      const dismissed = sessionStorage.getItem(storageKey);
      if (!dismissed) {
        setShowWelcome(true);
        setHasBeenShown(true);
      }
    }
  }, [needsOnboarding, hasGustoAccount, hasBeenShown]);

  const dismissWelcome = () => {
    sessionStorage.setItem(storageKey, 'true');
    setShowWelcome(false);
  };

  const openWelcome = () => {
    setShowWelcome(true);
  };

  return {
    showWelcome,
    setShowWelcome,
    dismissWelcome,
    openWelcome,
  };
};
