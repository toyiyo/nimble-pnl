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

      if (error) throw error;

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

      if (error) throw error;

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
    onError: (error) => {
      console.error('Error creating connected account:', error);
      toast({
        title: "Failed to Create Account",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    },
  });

  // Check if account is ready for invoicing
  const isReadyForInvoicing = connectedAccount?.charges_enabled && connectedAccount?.onboarding_complete;

  return {
    connectedAccount,
    loading,
    error: queryError,
    isReadyForInvoicing,
    createAccount: createAccountMutation.mutate,
    isCreatingAccount: createAccountMutation.isPending,
  };
};
