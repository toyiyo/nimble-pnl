import { useState, useEffect } from 'react';
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
  const [connectedBanks, setConnectedBanks] = useState<ConnectedBank[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const { toast } = useToast();

  // Fetch connected banks
  const fetchConnectedBanks = async () => {
    if (!restaurantId) {
      setConnectedBanks([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

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

      setConnectedBanks(banks || []);
    } catch (error) {
      console.error('Error fetching connected banks:', error);
      toast({
        title: "Failed to Load Banks",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

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

  // Disconnect a bank
  const disconnectBank = async (bankId: string) => {
    try {
      const { error } = await supabase
        .from('connected_banks')
        .update({
          status: 'disconnected',
          disconnected_at: new Date().toISOString(),
        })
        .eq('id', bankId);

      if (error) throw error;

      toast({
        title: "Bank Disconnected",
        description: "The bank account has been disconnected successfully",
      });

      // Refresh the list
      await fetchConnectedBanks();
    } catch (error) {
      console.error('Error disconnecting bank:', error);
      toast({
        title: "Failed to Disconnect",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  // Load banks on mount and when restaurantId changes
  useEffect(() => {
    fetchConnectedBanks();
  }, [restaurantId]);

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
          fetchConnectedBanks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantId]);

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
      await fetchConnectedBanks();

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
        description: data.message || `Synced ${data.synced} new transactions`,
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
    refreshBanks: fetchConnectedBanks,
    refreshBalance,
    syncTransactions,
  };
};
