import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export function useSyncBankTransactions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (bankId: string) => {
      const { data, error } = await supabase.functions.invoke(
        'stripe-sync-transactions',
        {
          body: { bankId }
        }
      );

      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      if (data.synced > 0) {
        toast({
          title: "Sync complete",
          description: `Imported ${data.synced} new transactions`,
        });
      } else {
        toast({
          title: "Sync initiated",
          description: data.message || "Transaction sync is in progress",
        });
      }
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
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
