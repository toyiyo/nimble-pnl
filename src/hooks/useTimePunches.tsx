import { QueryKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TimePunch, PunchStatus, EmployeeTip } from '@/types/timeTracking';
import { useToast } from '@/hooks/use-toast';
import { TimePunchInsert, EmployeeTipInsert } from '@/utils/timePunchImport';

export const useTimePunches = (restaurantId: string | null, employeeId?: string, startDate?: Date, endDate?: Date) => {
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery({
    queryKey: ['timePunches', restaurantId, employeeId, startDate?.toISOString(), endDate?.toISOString()],
    queryFn: async () => {
      if (!restaurantId) return [];

      let query = supabase
        .from('time_punches')
        .select(`
          id,
          restaurant_id,
          employee_id,
          shift_id,
          punch_type,
          punch_time,
          location,
          device_info,
          photo_path,
          notes,
          created_at,
          updated_at,
          created_by,
          modified_by,
          employee:employees(id, name, position)
        `)
        .eq('restaurant_id', restaurantId);

      if (employeeId) {
        query = query.eq('employee_id', employeeId);
      }
      if (startDate) {
        query = query.gte('punch_time', startDate.toISOString());
      }
      if (endDate) {
        query = query.lte('punch_time', endDate.toISOString());
      }

      const { data, error } = await query.order('punch_time', { ascending: false });

      if (error) throw error;
      return data as unknown as TimePunch[];
    },
    enabled: !!restaurantId,
    staleTime: 10000, // 10 seconds for real-time updates
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  return {
    punches: data || [],
    loading: isLoading,
    error,
  };
};

export const useEmployeePunchStatus = (employeeId: string | null) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['punchStatus', employeeId],
    queryFn: async () => {
      if (!employeeId) return null;

      const { data, error } = await supabase.rpc('get_employee_punch_status', {
        p_employee_id: employeeId,
      });

      if (error) throw error;
      return data && data.length > 0 ? data[0] as PunchStatus : null;
    },
    enabled: !!employeeId,
    staleTime: 5000, // 5 seconds for very real-time status
    refetchInterval: 30000, // Auto-refresh every 30 seconds
    refetchOnWindowFocus: true,
  });

  return {
    status: data,
    loading: isLoading,
    error,
  };
};

type CreateTimePunchInput =
  Omit<TimePunch, 'id' | 'created_at' | 'updated_at' | 'employee'>
  & {
    photoBlob?: Blob;
    // Suppress the global success toast. Callers (e.g. KioskMode) that surface
    // their own success UI use this to avoid stacking a toast on top.
    silent?: boolean;
  };

// The photo upload must never block or hang the punch itself. If the upload
// hasn't settled within this window, we abandon it (no-op catch so the
// rejection doesn't become an unhandled rejection) and proceed without a
// photo_path.
const PHOTO_UPLOAD_TIMEOUT_MS = 10_000;

// The punch INSERT itself must never hang indefinitely on a black-holed
// fetch (e.g. dropped connection with no response). If it hasn't settled
// within this window, the AbortSignal rejects the request instead.
const PUNCH_INSERT_TIMEOUT_MS = 15_000;

export const useCreateTimePunch = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (punch: CreateTimePunchInput) => {
      // getSession() reads the local cache (no network round-trip), whereas
      // getUser() hits /auth/v1/user every call. On the kiosk hot path this
      // saves 50-150 ms per punch.
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      let photo_path: string | undefined;
      let photoUploadFailed = false;
      if (punch.photoBlob) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), PHOTO_UPLOAD_TIMEOUT_MS);

        // Declared outside the try block so the catch handler can still
        // reach it to attach a no-op rejection handler on the abandoned
        // promise (relevant when we raced it away via the timeout).
        let uploadPromise: Promise<{ data: { path: string } | null; error: Error | null }> | undefined;

        try {
          const timestamp = Date.now();
          const filename = `punch-${timestamp}.jpg`;
          const filePath = `${punch.restaurant_id}/${punch.employee_id}/${filename}`;

          uploadPromise = supabase.storage
            .from('time-clock-photos')
            .upload(filePath, punch.photoBlob, {
              contentType: 'image/jpeg',
              upsert: false,
            });

          const timeoutPromise = new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => {
              reject(new DOMException('Photo upload timed out', 'TimeoutError'));
            });
          });

          const { data: uploadData, error: uploadError } = await Promise.race([
            uploadPromise,
            timeoutPromise,
          ]);

          if (uploadError) {
            console.error('Photo upload error:', uploadError);
            photoUploadFailed = true;
          } else {
            photo_path = uploadData.path;
          }
        } catch (error) {
          console.error('Photo upload exception:', error);
          photoUploadFailed = true;
          // The upload promise may still resolve/reject after we've moved on
          // (e.g. after a timeout abandons it) — swallow that so it doesn't
          // surface as an unhandled rejection.
          uploadPromise?.catch(() => {});
        } finally {
          clearTimeout(timeoutId);
        }
      }

      // Remove photoBlob and silent from the punch data; both are local-only.
      const { photoBlob, silent, ...punchData } = punch;

      const insertController = new AbortController();
      const insertTimeoutId = setTimeout(
        () => insertController.abort(),
        PUNCH_INSERT_TIMEOUT_MS,
      );

      let data: Record<string, unknown>;
      let error: Error | null;
      try {
        ({ data, error } = await supabase
          .from('time_punches')
          .insert({
            ...punchData,
            photo_path,
            created_by: userId,
          })
          .select()
          .abortSignal(insertController.signal)
          .single());
      } finally {
        clearTimeout(insertTimeoutId);
      }

      if (error) throw error;
      return { ...data, photoUploadFailed };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['timePunches', data.restaurant_id] });
      queryClient.invalidateQueries({ queryKey: ['punchStatus', data.employee_id] });

      if (variables?.silent) return;

      const punchTypeText = data.punch_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
      toast({
        title: 'Punch recorded',
        description: data.photoUploadFailed
          ? 'Punch recorded — photo could not be uploaded'
          : `${punchTypeText} at ${new Date(data.punch_time).toLocaleTimeString()}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error recording punch',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useUpdateTimePunch = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<TimePunch> & { id: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      const { employee, ...punchUpdates } = updates as Partial<TimePunch>;

      const { data, error } = await supabase
        .from('time_punches')
        .update({
          ...punchUpdates,
          modified_by: userId,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['timePunches', data.restaurant_id] });
      queryClient.invalidateQueries({ queryKey: ['punchStatus', data.employee_id] });
      toast({
        title: 'Punch updated',
        description: 'Time punch has been updated.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error updating punch',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

export const useDeleteTimePunch = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId, employeeId }: { id: string; restaurantId: string; employeeId: string }) => {
      const { error } = await supabase
        .from('time_punches')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { id, restaurantId, employeeId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['timePunches', data.restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['punchStatus', data.employeeId] });
      toast({
        title: 'Punch deleted',
        description: 'Time punch has been removed.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error deleting punch',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};

type TimePunchEmployeeLookup = Record<string, {
  id: string;
  name: string;
  position?: string | null;
}>;

interface BulkCreateTimePunchesInput {
  restaurantId: string;
  punches: TimePunchInsert[];
  employeeLookup?: TimePunchEmployeeLookup;
}

interface TimePunchOptimisticContext {
  previousQueries: Array<[QueryKey, TimePunch[] | undefined]>;
}

const chunkSize = 500;

const matchesTimePunchQuery = (queryKey: QueryKey, restaurantId: string, employeeIds: Set<string>) => {
  if (queryKey.length < 2 || queryKey[0] !== 'timePunches' || queryKey[1] !== restaurantId) {
    return false;
  }
  const potentialEmployeeId = typeof queryKey[2] === 'string' ? queryKey[2] : undefined;
  if (potentialEmployeeId && !employeeIds.has(potentialEmployeeId)) {
    return false;
  }
  return true;
};

export const useBulkCreateTimePunches = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ restaurantId, punches }: BulkCreateTimePunchesInput) => {
      const { data: { session } } = await supabase.auth.getSession();
      const createdBy = session?.user?.id ?? null;
      const insertedPunches: TimePunch[] = [];

      for (let i = 0; i < punches.length; i += chunkSize) {
        const chunk = punches.slice(i, i + chunkSize).map((punch) => ({
          ...punch,
          created_by: createdBy,
        }));
        const { data, error } = await supabase
          .from('time_punches')
          .insert(chunk)
          .select();
        if (error) throw error;
        insertedPunches.push(...(data as unknown as TimePunch[]));
      }

      return insertedPunches;
    },
    onMutate: async (variables): Promise<TimePunchOptimisticContext> => {
      const employeeIds = new Set(variables.punches.map((punch) => punch.employee_id));
      await queryClient.cancelQueries({
        predicate: (query) =>
          matchesTimePunchQuery(query.queryKey, variables.restaurantId, employeeIds),
      });

      const timestamp = new Date().toISOString();
      const optimisticPunches = variables.punches.map((punch, index) => {
        const employee = variables.employeeLookup?.[punch.employee_id];
        return {
          id: `optimistic-${punch.employee_id}-${timestamp}-${index}`,
          restaurant_id: variables.restaurantId,
          employee_id: punch.employee_id,
          punch_type: punch.punch_type,
          punch_time: punch.punch_time,
          notes: punch.notes ?? undefined,
          device_info: punch.device_info ?? undefined,
          created_at: timestamp,
          updated_at: timestamp,
          created_by: null,
          modified_by: null,
          employee: employee
            ? {
                id: employee.id,
                name: employee.name,
                position: employee.position ?? '',
              }
            : undefined,
        } as TimePunch;
      });

      const previousQueries = queryClient.getQueriesData({
        predicate: (query) => matchesTimePunchQuery(query.queryKey, variables.restaurantId, employeeIds),
      }) as Array<[QueryKey, TimePunch[] | undefined]>;

      previousQueries.forEach(([queryKey, data]) => {
        if (!Array.isArray(data)) return;
        queryClient.setQueryData(queryKey, () => [...optimisticPunches, ...data]);
      });

      return { previousQueries };
    },
    onError: (_error, _variables, context?: TimePunchOptimisticContext) => {
      context?.previousQueries.forEach(([queryKey, previous]) => {
        queryClient.setQueryData(queryKey, previous);
      });
    },
    onSettled: (_data, _error, variables) => {
      if (!variables) return;
      const employeeIds = Array.from(new Set(variables.punches.map((punch) => punch.employee_id)));
      queryClient.invalidateQueries({ queryKey: ['timePunches', variables.restaurantId] });
      employeeIds.forEach((employeeId) => {
        queryClient.invalidateQueries({ queryKey: ['punchStatus', employeeId] });
      });
    },
  });
};

interface BulkCreateEmployeeTipsInput {
  restaurantId: string;
  tips: EmployeeTipInsert[];
}

interface EmployeeTipsOptimisticContext {
  previousQueries: Array<[QueryKey, EmployeeTip[] | undefined]>;
}

const matchesEmployeeTipsQuery = (queryKey: QueryKey, restaurantId: string, employeeIds: Set<string>) => {
  if (queryKey.length < 2 || queryKey[0] !== 'employee-tips' || queryKey[1] !== restaurantId) {
    return false;
  }
  const potentialEmployeeId = typeof queryKey[2] === 'string' ? queryKey[2] : undefined;
  if (potentialEmployeeId && !employeeIds.has(potentialEmployeeId)) {
    return false;
  }
  return true;
};

export const useBulkCreateEmployeeTips = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ restaurantId, tips }: BulkCreateEmployeeTipsInput) => {
      const { data: { session } } = await supabase.auth.getSession();
      const createdBy = session?.user?.id ?? null;
      const insertedTips: EmployeeTip[] = [];

      for (let i = 0; i < tips.length; i += chunkSize) {
        const chunk = tips.slice(i, i + chunkSize).map((tip) => ({
          ...tip,
          created_by: createdBy,
        }));
        const { data, error } = await supabase
          .from('employee_tips')
          .insert(chunk)
          .select();
        if (error) throw error;
        insertedTips.push(...(data as EmployeeTip[]));
      }

      return insertedTips;
    },
    onMutate: async (variables): Promise<EmployeeTipsOptimisticContext> => {
      const employeeIds = new Set(variables.tips.map((tip) => tip.employee_id));
      await queryClient.cancelQueries({
        predicate: (query) =>
          matchesEmployeeTipsQuery(query.queryKey, variables.restaurantId, employeeIds),
      });

      const now = new Date().toISOString();
      const optimisticTips = variables.tips.map((tip, index) => ({
        id: `optimistic-tip-${tip.employee_id}-${now}-${index}`,
        restaurant_id: variables.restaurantId,
        employee_id: tip.employee_id,
        shift_id: tip.shift_id,
        tip_amount: tip.tip_amount,
        tip_source: tip.tip_source as EmployeeTip['tip_source'],
        tip_date: tip.tip_date,
        recorded_at: tip.recorded_at,
        notes: tip.notes ?? undefined,
        created_at: now,
        updated_at: now,
        created_by: null,
      }));

      const previousQueries = queryClient.getQueriesData({
        predicate: (query) => matchesEmployeeTipsQuery(query.queryKey, variables.restaurantId, employeeIds),
      }) as Array<[QueryKey, EmployeeTip[] | undefined]>;

      previousQueries.forEach(([queryKey, data]) => {
        if (!Array.isArray(data)) return;
        queryClient.setQueryData(queryKey, () => [...optimisticTips, ...data]);
      });

      return { previousQueries };
    },
    onError: (_error, _variables, context?: EmployeeTipsOptimisticContext) => {
      context?.previousQueries.forEach(([queryKey, previous]) => {
        queryClient.setQueryData(queryKey, previous);
      });
    },
    onSettled: (_data, _error, variables) => {
      if (!variables) return;
      const employeeIds = Array.from(new Set(variables.tips.map((tip) => tip.employee_id)));
      queryClient.invalidateQueries({ queryKey: ['employee-tips', variables.restaurantId] });
      employeeIds.forEach((employeeId) => {
        queryClient.invalidateQueries({ queryKey: ['employee-tips', variables.restaurantId, employeeId] });
      });
    },
  });
};

// Hook for getting current employee from auth user
export const useCurrentEmployee = (restaurantId: string | null) => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['currentEmployee', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('user_id', user.id)
        .single();

      if (error) {
        // If no employee found for this user, return null (not an error)
        if (error.code === 'PGRST116') return null;
        throw error;
      }
      return data;
    },
    enabled: !!restaurantId,
    staleTime: 60000, // 1 minute
  });

  return {
    employee: data,
    loading: isLoading,
    error,
  };
};
