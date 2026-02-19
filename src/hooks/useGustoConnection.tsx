// Gusto Connection Hook
// Manages Gusto integration connection state and operations

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { GustoConnection } from '@/types/gusto';

interface CreateCompanyParams {
  companyName: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  ein?: string;
  contractorOnly?: boolean;
}

interface UseGustoConnectionReturn {
  connection: GustoConnection | null;
  isConnected: boolean;
  isLoading: boolean;
  error: Error | null;
  connectGusto: () => Promise<void>;
  createGustoCompany: (params: CreateCompanyParams) => Promise<void>;
  disconnectGusto: (clearEmployeeData?: boolean) => Promise<void>;
  isConnecting: boolean;
  isCreatingCompany: boolean;
  isDisconnecting: boolean;
}

export const useGustoConnection = (
  restaurantId: string | null
): UseGustoConnectionReturn => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Query for connection status
  const {
    data: connection,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['gustoConnection', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;

      const { data, error } = await supabase
        .from('gusto_connections')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error) throw error;
      return data as GustoConnection | null;
    },
    enabled: !!restaurantId,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  });

  // Mutation to initiate OAuth flow
  const connectMutation = useMutation({
    mutationFn: async () => {
      if (!restaurantId) throw new Error('Restaurant ID is required');

      const { data, error } = await supabase.functions.invoke('gusto-oauth', {
        body: { action: 'authorize', restaurantId },
      });

      if (error) throw error;
      if (!data?.authorizationUrl) throw new Error('No authorization URL received');

      return data.authorizationUrl as string;
    },
    onSuccess: (authUrl) => {
      // Redirect to Gusto OAuth
      window.location.href = authUrl;
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to connect to Gusto',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Mutation to create a Partner Managed Company (proper embedded flow)
  const createCompanyMutation = useMutation({
    mutationFn: async (params: CreateCompanyParams) => {
      if (!restaurantId) throw new Error('Restaurant ID is required');

      const { data, error } = await supabase.functions.invoke('gusto-oauth', {
        body: {
          action: 'create-company',
          restaurantId,
          companyName: params.companyName,
          adminFirstName: params.adminFirstName,
          adminLastName: params.adminLastName,
          adminEmail: params.adminEmail,
          ein: params.ein,
          contractorOnly: params.contractorOnly,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['gustoConnection', restaurantId] });
      toast({
        title: 'Gusto Company Created',
        description: `${data.companyName} has been created. Complete the setup to start using payroll.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to create Gusto company',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Mutation to disconnect
  const disconnectMutation = useMutation({
    mutationFn: async (clearEmployeeData: boolean = false) => {
      if (!restaurantId) throw new Error('Restaurant ID is required');

      const { data, error } = await supabase.functions.invoke('gusto-disconnect', {
        body: { restaurantId, clearEmployeeGusto: clearEmployeeData },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gustoConnection', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['employees', restaurantId] });
      toast({
        title: 'Disconnected from Gusto',
        description: 'Your restaurant has been disconnected from Gusto payroll.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Failed to disconnect from Gusto',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return {
    connection: connection || null,
    isConnected: !!connection,
    isLoading,
    error: error as Error | null,
    connectGusto: () => connectMutation.mutateAsync(),
    createGustoCompany: (params: CreateCompanyParams) => createCompanyMutation.mutateAsync(params),
    disconnectGusto: (clearEmployeeData?: boolean) =>
      disconnectMutation.mutateAsync(clearEmployeeData ?? false),
    isConnecting: connectMutation.isPending,
    isCreatingCompany: createCompanyMutation.isPending,
    isDisconnecting: disconnectMutation.isPending,
  };
};

/**
 * Hook to handle OAuth callback
 * Call this in the GustoCallback page component
 */
export const useGustoOAuthCallback = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ code, state }: { code: string; state: string }) => {
      const { data, error } = await supabase.functions.invoke('gusto-oauth', {
        body: { action: 'callback', code, state },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      // Invalidate connection query for the restaurant
      queryClient.invalidateQueries({ queryKey: ['gustoConnection', variables.state] });
      toast({
        title: 'Connected to Gusto',
        description: `Successfully connected to ${data.companyName || 'Gusto'}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Connection failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
};
