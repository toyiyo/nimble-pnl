import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ConnectedBank {
  id: string;
  stripe_financial_account_id: string;
  institution_name: string;
  institution_logo_url: string | null;
  status: 'connected' | 'disconnected' | 'error' | 'requires_reauth';
  connected_at: string;
  disconnected_at: string | null;
  last_sync_at: string | null;
  sync_error: string | null;
  balances: Array<{
    id: string;
    account_name: string;
    account_type: string | null;
    account_mask: string | null;
    current_balance: number;
    available_balance: number | null;
    currency: string;
    as_of_date: string;
    is_active: boolean;
  }>;
}

interface FinancialConnectionSession {
  clientSecret: string;
  sessionId: string;
}

export const useStripeFinancialConnections = (restaurantId: string | null) => {
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch connected banks using React Query
  const {
    data: connectedBanks = [],
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ['connectedBanks', restaurantId],
    queryFn: async () => {
      if (!restaurantId) {
        return [];
      }

      // Fetch connected banks with their balances
      const { data: banks, error: banksError } = await supabase
        .from('connected_banks')
        .select(`
          id,
          stripe_financial_account_id,
          institution_name,
          institution_logo_url,
          status,
          connected_at,
          disconnected_at,
          last_sync_at,
          sync_error,
          balances:bank_account_balances(
            id,
            account_name,
            account_type,
            account_mask,
            current_balance,
            available_balance,
            currency,
            as_of_date,
            is_active
          )
        `)
        .eq('restaurant_id', restaurantId)
        .eq('status', 'connected')
        .order('connected_at', { ascending: false });

      if (banksError) throw banksError;

      return (banks || []) as ConnectedBank[];
    },
    enabled: !!restaurantId,
    staleTime: 60000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Handle query errors with toast
  useEffect(() => {
    if (queryError) {
      console.error('Error fetching connected banks:', queryError);
      toast({
        title: "Failed to Load Banks",
        description: queryError instanceof Error ? queryError.message : "An error occurred",
        variant: "destructive",
      });
    }
  }, [queryError, toast]);

  // Create Financial Connections session
  const createFinancialConnectionsSession = async (): Promise<FinancialConnectionSession | null> => {
    if (!restaurantId) {
      toast({
        title: "No Restaurant Selected",
        description: "Please select a restaurant first",
        variant: "destructive",
      });
      return null;
    }

    try {
      setIsCreatingSession(true);

      const { data, error } = await supabase.functions.invoke(
        'stripe-financial-connections-session',
        {
          body: { restaurantId }
        }
      );

      if (error) throw error;

      return data as FinancialConnectionSession;
    } catch (error) {
      console.error('Error creating Financial Connections session:', error);
      toast({
        title: "Failed to Create Session",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
      return null;
    } finally {
      setIsCreatingSession(false);
    }
  };

  // Disconnect a bank and optionally delete data
  const disconnectBank = async (bankId: string, deleteData: boolean = false) => {
    // Show loading toast
    const loadingToast = toast({
      title: deleteData ? "Disconnecting Bank..." : "Disconnecting...",
      description: deleteData 
        ? "This may take a moment as we prepare to delete all associated data." 
        : "Removing bank connection...",
      duration: Infinity, // Keep visible until we dismiss it
    });

    try {
      const { data, error } = await supabase.functions.invoke(
        'stripe-disconnect-bank',
        {
          body: { bankId, deleteData }
        }
      );

      // Dismiss loading toast
      loadingToast.dismiss();

      if (error) throw error;

      // Show success message based on whether it's background processing
      if (data.background) {
        toast({
          title: "Bank Disconnected",
          description: "Your bank has been disconnected. All associated data is being deleted in the background. This may take a few minutes.",
          duration: 8000,
        });
      } else {
        toast({
          title: "Bank Disconnected",
          description: data.message || "The bank account has been disconnected successfully",
        });
      }

      // Refresh the list
      queryClient.invalidateQueries({ queryKey: ['connectedBanks', restaurantId] });
      
      // If data was deleted, also invalidate transactions queries
      if (deleteData) {
        queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
        queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
      }
    } catch (error) {
      // Dismiss loading toast
      loadingToast.dismiss();
      
      console.error('Error disconnecting bank:', error);
      toast({
        title: "Failed to Disconnect",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
      throw error; // Re-throw to let dialog handle it
    }
  };

  // Set up real-time subscription for bank updates
  useEffect(() => {
    if (!restaurantId) return;

    const channel = supabase
      .channel('connected-banks-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'connected_banks',
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['connectedBanks', restaurantId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantId, queryClient]);

  // Refresh balance for a specific bank
  const refreshBalance = async (bankId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke(
        'stripe-refresh-balance',
        {
          body: { bankId }
        }
      );

      if (error) throw error;

      toast({
        title: "Balance Refreshed",
        description: "Your account balance has been updated",
      });

      // Refresh the banks list
      queryClient.invalidateQueries({ queryKey: ['connectedBanks', restaurantId] });

      return data;
    } catch (error) {
      console.error('Error refreshing balance:', error);
      toast({
        title: "Failed to Refresh Balance",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  // Sync transactions for a specific bank
  const syncTransactions = async (bankId: string) => {
    // Show immediate feedback that sync is starting
    toast({
      title: "Importing Transactions",
      description: "Fetching all transactions from your bank account. This may take a moment...",
    });

    try {
      const { data, error } = await supabase.functions.invoke(
        'stripe-sync-transactions',
        {
          body: { bankId }
        }
      );

      if (error) throw error;

      toast({
        title: data.message ? "Transaction Sync Started" : "Transactions Synced",
        description: data.message || `Successfully imported and categorized ${data.synced} new transactions (${data.skipped} already existed). Your financial statements are now up to date.`,
      });

      return data;
    } catch (error) {
      console.error('Error syncing transactions:', error);
      toast({
        title: "Failed to Sync Transactions",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  return {
    connectedBanks,
    loading,
    isCreatingSession,
    createFinancialConnectionsSession,
    disconnectBank,
    refreshBanks: () => queryClient.invalidateQueries({ queryKey: ['connectedBanks', restaurantId] }),
    refreshBalance,
    syncTransactions,
  };
};
