import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface StripeConnectedAccount {
  id: string;
  restaurant_id: string;
  stripe_account_id: string;
  account_type: 'express' | 'standard';
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  onboarding_complete: boolean;
  created_at: string;
  updated_at: string;
}

export const useStripeConnect = (restaurantId: string | null) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch connected account
  const {
    data: connectedAccount = null,
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['stripe-connected-account', restaurantId],
    queryFn: async () => {
      if (!restaurantId) {
        return null;
      }

      const { data, error } = await supabase
        .from('stripe_connected_accounts')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

      if (error) {
        console.error('Supabase error fetching connected account:', error.message || 'Unknown error');
        throw new Error(error.message || 'Failed to fetch connected account');
      }

      return data as StripeConnectedAccount | null;
    },
    enabled: !!restaurantId,
    staleTime: 60000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Create connected account
  const createAccountMutation = useMutation({
    mutationFn: async (accountType: 'express' | 'standard' = 'express') => {
      // Ensure accountType is a valid string, not an event object
      if (typeof accountType !== 'string' || !['express', 'standard'].includes(accountType)) {
        accountType = 'express';
      }

      if (!restaurantId) {
        throw new Error("No restaurant selected");
      }

      const { data, error } = await supabase.functions.invoke(
        'stripe-create-connected-account',
        {
          body: {
            restaurantId,
            accountType,
          }
        }
      );

      if (error) {
        console.error('Supabase function error:', error.message || 'Unknown error');
        throw new Error(error.message || 'Failed to create connected account');
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['stripe-connected-account', restaurantId] });
      
      // Open onboarding URL if provided
      if (data.onboardingUrl) {
        window.location.href = data.onboardingUrl;
      } else {
        toast({
          title: "Account Created",
          description: "Your Stripe Connect account has been created",
        });
      }
    },
    onError: (error: unknown) => {
      let errorMessage = "An unexpected error occurred while creating your Stripe account";
      try {
        if (error instanceof Error) {
          errorMessage = error.message;
        } else if (typeof error === 'object' && error !== null && 'message' in error) {
          errorMessage = String((error as any).message);
        }
      } catch (e) {
        // If we can't extract the message safely, use the default
        console.error('Error extracting error message:', e);
      }
      
      console.error('Error creating connected account:', errorMessage);
      toast({
        title: "Failed to Create Account",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Check if account is ready for invoicing
  const isReadyForInvoicing = connectedAccount?.charges_enabled && connectedAccount?.onboarding_complete;

  // Create a dashboard login link
  const createDashboardLinkMutation = useMutation({
    mutationFn: async () => {
      if (!restaurantId) {
        throw new Error("No restaurant selected");
      }

      const { data, error } = await supabase.functions.invoke('stripe-create-login-link', {
        body: { restaurantId },
      });

      if (error) {
        console.error('Supabase function error (login link):', error.message || 'Unknown error');
        throw new Error(error.message || 'Failed to create Stripe dashboard link');
      }

      return data as { url?: string };
    },
    onSuccess: (data) => {
      if (data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      } else {
        toast({
          title: "Dashboard Link Unavailable",
          description: "Could not get a Stripe dashboard link right now.",
          variant: "destructive",
        });
      }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "An error occurred";
      console.error('Error creating Stripe dashboard link:', message);
      toast({
        title: "Failed to Open Dashboard",
        description: message,
        variant: "destructive",
      });
    },
  });

  return {
    connectedAccount,
    loading,
    error: queryError,
    isReadyForInvoicing,
    createAccount: createAccountMutation.mutate,
    isCreatingAccount: createAccountMutation.isPending,
    openDashboard: createDashboardLinkMutation.mutate,
    isOpeningDashboard: createDashboardLinkMutation.isPending,
  };
};
