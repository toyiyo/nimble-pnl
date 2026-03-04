import { useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { toast } from 'sonner';

export interface CheckBankAccount {
  id: string;
  restaurant_id: string;
  account_name: string;
  bank_name: string | null;
  connected_bank_id: string | null;
  next_check_number: number;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertCheckBankAccountInput {
  id?: string;
  account_name: string;
  bank_name?: string | null;
  connected_bank_id?: string | null;
  next_check_number?: number;
  is_default?: boolean;
  is_active?: boolean;
}

export function useCheckBankAccounts() {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['check-bank-accounts', restaurantId],
    queryFn: async () => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const { data, error } = await supabase
        .from('check_bank_accounts' as any)
        .select('id, restaurant_id, account_name, bank_name, connected_bank_id, next_check_number, is_default, is_active, created_at, updated_at')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('account_name');
      if (error) throw error;
      return data as unknown as CheckBankAccount[];
    },
    enabled: !!restaurantId,
    staleTime: 60_000,
  });

  const saveAccount = useMutation({
    mutationFn: async (input: UpsertCheckBankAccountInput) => {
      if (!restaurantId) throw new Error('No restaurant selected');
      const { id, ...rest } = input;
      if (id) {
        const { data, error } = await supabase
          .from('check_bank_accounts' as any)
          .update({ ...rest })
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return data as unknown as CheckBankAccount;
      } else {
        const { data, error } = await supabase
          .from('check_bank_accounts' as any)
          .insert({ restaurant_id: restaurantId, ...rest })
          .select()
          .single();
        if (error) throw error;
        return data as unknown as CheckBankAccount;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['check-bank-accounts'] });
      toast.success('Bank account saved');
    },
    onError: (error: Error) => {
      toast.error(`Failed to save bank account: ${error.message}`);
    },
  });

  const deleteAccount = useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await supabase
        .from('check_bank_accounts' as any)
        .delete()
        .eq('id', accountId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['check-bank-accounts'] });
      toast.success('Bank account removed');
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove bank account: ${error.message}`);
    },
  });

  const claimCheckNumbers = useMutation({
    mutationFn: async ({ accountId, count }: { accountId: string; count: number }) => {
      const { data, error } = await (supabase.rpc as any)('claim_check_numbers_for_account', {
        p_account_id: accountId,
        p_count: count,
      });
      if (error) throw error;
      if (typeof data !== 'number') throw new Error('Failed to claim check numbers');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['check-bank-accounts'] });
    },
  });

  // Auto-create check bank accounts from connected banks when none exist
  const autoCreatedRef = useRef(false);

  useEffect(() => {
    if (autoCreatedRef.current) return;
    if (query.isLoading || !restaurantId) return;
    if ((query.data?.length ?? 0) > 0) return;

    autoCreatedRef.current = true;

    (async () => {
      try {
        const { data: connectedBanks } = await supabase
          .from('connected_banks' as any)
          .select('id, institution_name')
          .eq('restaurant_id', restaurantId)
          .eq('status', 'connected');

        if (!connectedBanks?.length) return;

        for (let i = 0; i < connectedBanks.length; i++) {
          const bank = connectedBanks[i] as any;
          await saveAccount.mutateAsync({
            account_name: bank.institution_name,
            bank_name: bank.institution_name,
            connected_bank_id: bank.id,
            is_default: i === 0,
          });
        }
      } catch (err) {
        console.error('Auto-create check bank accounts failed:', err);
      }
    })();
  }, [query.isLoading, query.data?.length, restaurantId]);

  const defaultAccount = query.data?.find((a) => a.is_default) ?? query.data?.[0] ?? null;

  return {
    accounts: query.data ?? [],
    defaultAccount,
    isLoading: query.isLoading,
    error: query.error,
    saveAccount,
    deleteAccount,
    claimCheckNumbers,
  };
}
