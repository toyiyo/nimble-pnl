import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface CRUDHookConfig<T> {
  tableName: string;
  queryKey: string;
  entityName: string;
  getRestaurantId: (data: any) => string;
}

export function useCreateEntity<T>(config: CRUDHookConfig<T>) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (entity: Omit<T, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from(config.tableName)
        .insert(entity as any)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const restaurantId = config.getRestaurantId(data);
      queryClient.invalidateQueries({ queryKey: [config.queryKey, restaurantId] });
      toast({
        title: `${config.entityName} created`,
        description: `The ${config.entityName.toLowerCase()} has been created successfully.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: `Error creating ${config.entityName.toLowerCase()}`,
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

export function useUpdateEntity<T>(config: CRUDHookConfig<T>) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<T> & { id: string }) => {
      const { data, error } = await supabase
        .from(config.tableName)
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const restaurantId = config.getRestaurantId(data);
      queryClient.invalidateQueries({ queryKey: [config.queryKey, restaurantId] });
      toast({
        title: `${config.entityName} updated`,
        description: `The ${config.entityName.toLowerCase()} has been updated successfully.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: `Error updating ${config.entityName.toLowerCase()}`,
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

export function useDeleteEntity<T>(config: CRUDHookConfig<T>) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, restaurantId }: { id: string; restaurantId: string }) => {
      const { error } = await supabase
        .from(config.tableName)
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { id, restaurantId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [config.queryKey, data.restaurantId] });
      toast({
        title: `${config.entityName} deleted`,
        description: `The ${config.entityName.toLowerCase()} has been removed.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: `Error deleting ${config.entityName.toLowerCase()}`,
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}
