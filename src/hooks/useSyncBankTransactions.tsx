import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface SyncBankTransactionsInput {
  bankId: string;
  /** Institution name, so a reauth toast can name the bank rather than
   *  reciting an opaque Stripe account id (design §5.3). */
  institutionName: string;
}

interface SyncBankTransactionsResult {
  sync: {
    needsReauth?: unknown[];
    synced?: number;
    message?: string;
  };
  balance: {
    refreshed?: number;
    message?: string;
  } | null;
}

export function useSyncBankTransactions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ bankId }: SyncBankTransactionsInput) => {
      // First sync transactions
      const { data: syncData, error: syncError } = await supabase.functions.invoke(
        'stripe-sync-transactions',
        {
          body: { bankId }
        }
      );

      if (syncError) throw syncError;

      // Then refresh balance
      const { data: balanceData, error: balanceError } = await supabase.functions.invoke(
        'stripe-refresh-balance',
        {
          body: { bankId }
        }
      );

      if (balanceError) {
        console.error('Balance refresh error:', balanceError);
        // Don't fail the entire operation if balance refresh fails
      }

      return { sync: syncData, balance: balanceData };
    },
    onSuccess: (data: SyncBankTransactionsResult, variables) => {
      const syncData = data.sync;
      const balanceData = data.balance;
      const needsReauth: unknown[] = syncData?.needsReauth ?? [];

      // A bank that needs reauth never gets to claim success, even when
      // sibling accounts on the same connection synced real rows this run
      // (design §5.3: "any needsReauth -> destructive toast naming the
      // bank" takes priority over the synced count).
      if (needsReauth.length > 0) {
        toast({
          title: "Reconnect required",
          description: `${variables.institutionName} needs to be reconnected before it can sync. Reconnect to resume.`,
          variant: "destructive",
        });
      } else if (syncData.synced > 0) {
        toast({
          title: "Sync complete",
          description: `Imported ${syncData.synced} new transactions across ${balanceData?.refreshed || 0} account(s)`,
        });
      } else {
        // synced === 0 and nothing needs reauth: nothing new happened —
        // never claim "Sync complete" for zero rows (design §1, problem #2).
        toast({
          title: "No new transactions",
          description: syncData.message || balanceData?.message || "Your accounts are already up to date.",
        });
      }

      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      // Both cache keys: 'connectedBanks' backs useStripeFinancialConnections
      // (Banking, Accounting), 'connected-banks' backs the separate
      // useConnectedBanks hook (Dashboard, FI, reconciliation) — design §5.3.
      queryClient.invalidateQueries({ queryKey: ['connectedBanks'] });
      queryClient.invalidateQueries({ queryKey: ['connected-banks'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
