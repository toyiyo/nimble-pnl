// Gusto Employee Sync Hook
// Manages syncing employees from EasyShiftHQ to Gusto

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SyncResult {
  success: boolean;
  message: string;
  synced: number;
  skipped: number;
  errors: Array<{
    employeeId: string;
    employeeName: string;
    error: string;
  }>;
}

interface UseGustoEmployeeSyncReturn {
  syncEmployees: (employeeIds?: string[], selfOnboarding?: boolean) => Promise<SyncResult>;
  syncTimePunches: (startDate?: string, endDate?: string) => Promise<void>;
  isSyncingEmployees: boolean;
  isSyncingTimePunches: boolean;
  lastSyncResult: SyncResult | null;
}

export const useGustoEmployeeSync = (
  restaurantId: string | null
): UseGustoEmployeeSyncReturn => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Mutation to sync employees
  const employeeSyncMutation = useMutation({
    mutationFn: async ({
      employeeIds,
      selfOnboarding = true,
    }: {
      employeeIds?: string[];
      selfOnboarding?: boolean;
    }) => {
      if (!restaurantId) throw new Error('Restaurant ID is required');

      const { data, error } = await supabase.functions.invoke('gusto-sync-employees', {
        body: { restaurantId, employeeIds, selfOnboarding },
      });

      if (error) throw error;
      return data as SyncResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['employees', restaurantId] });

      if (data.synced > 0) {
        toast({
          title: 'Employees synced',
          description: `Successfully synced ${data.synced} employee${data.synced === 1 ? '' : 's'} to Gusto`,
        });
      }

      if (data.errors.length > 0) {
        toast({
          title: 'Some employees failed to sync',
          description: `${data.errors.length} employee${data.errors.length === 1 ? '' : 's'} could not be synced`,
          variant: 'destructive',
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Sync failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Mutation to sync time punches
  const timePunchSyncMutation = useMutation({
    mutationFn: async ({
      startDate,
      endDate,
    }: {
      startDate?: string;
      endDate?: string;
    }) => {
      if (!restaurantId) throw new Error('Restaurant ID is required');

      const { data, error } = await supabase.functions.invoke('gusto-sync-time-punches', {
        body: { restaurantId, startDate, endDate },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: 'Time punches synced',
        description: `Synced ${data.timeActivities || 0} time entries to Gusto`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Time sync failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const syncEmployees = async (
    employeeIds?: string[],
    selfOnboarding?: boolean
  ): Promise<SyncResult> => {
    return employeeSyncMutation.mutateAsync({ employeeIds, selfOnboarding });
  };

  const syncTimePunches = async (
    startDate?: string,
    endDate?: string
  ): Promise<void> => {
    await timePunchSyncMutation.mutateAsync({ startDate, endDate });
  };

  return {
    syncEmployees,
    syncTimePunches,
    isSyncingEmployees: employeeSyncMutation.isPending,
    isSyncingTimePunches: timePunchSyncMutation.isPending,
    lastSyncResult: employeeSyncMutation.data ?? null,
  };
};
