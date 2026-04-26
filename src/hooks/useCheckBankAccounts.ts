import { useRef, useEffect, useCallback } from 'react';
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
  // MICR-printing fields. account_number_encrypted is intentionally NOT exposed —
  // plaintext is fetched on demand via fetchAccountSecrets.
  routing_number: string | null;
  account_number_last4: string | null;
  print_bank_info: boolean;
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
  print_bank_info?: boolean;
}

export interface CheckBankAccountSecrets {
  routing_number: string;
  account_number: string;
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
        .select('id, restaurant_id, account_name, bank_name, connected_bank_id, next_check_number, is_default, is_active, routing_number, account_number_last4, print_bank_info, created_at, updated_at')
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

      // When setting as default, unset other defaults first
      if (rest.is_default) {
        const { error: unsetError } = await supabase
          .from('check_bank_accounts' as any)
          .update({ is_default: false })
          .eq('restaurant_id', restaurantId)
          .eq('is_default', true);
        if (unsetError) throw unsetError;
      }

      if (id) {
        const { data, error } = await supabase
          .from('check_bank_accounts' as any)
          .update(rest)
          .eq('id', id)
          .eq('restaurant_id', restaurantId)
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
      if (!restaurantId) throw new Error('No restaurant selected');

      // Fetch fresh state to check if account is the default
      const { data: deletedAccount } = await supabase
        .from('check_bank_accounts' as any)
        .select('is_default')
        .eq('id', accountId)
        .eq('restaurant_id', restaurantId)
        .single();
      const wasDefault = (deletedAccount as any)?.is_default ?? false;

      // Soft-delete: set is_active=false and clear is_default to avoid unique constraint conflict
      const { error } = await supabase
        .from('check_bank_accounts' as any)
        .update({ is_active: false, is_default: false })
        .eq('id', accountId)
        .eq('restaurant_id', restaurantId);
      if (error) throw error;

      // Promote another account to default if we just deleted the default
      if (wasDefault) {
        const { data: remaining } = await supabase
          .from('check_bank_accounts' as any)
          .select('id')
          .eq('restaurant_id', restaurantId)
          .eq('is_active', true)
          .neq('id', accountId)
          .limit(1);
        if (remaining?.length) {
          const { error: promoteError } = await supabase
            .from('check_bank_accounts' as any)
            .update({ is_default: true })
            .eq('id', (remaining as any[])[0].id)
            .eq('restaurant_id', restaurantId);
          if (promoteError) throw promoteError;
        }
      }
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

  const saveAccountSecrets = useMutation({
    mutationFn: async ({ id, routing, account }: { id: string; routing: string; account: string }) => {
      const { error } = await (supabase.rpc as any)('set_check_bank_account_secrets', {
        p_id: id,
        p_routing: routing,
        p_account: account,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['check-bank-accounts', restaurantId] });
    },
  });

  const fetchAccountSecrets = useCallback(
    async (id: string): Promise<CheckBankAccountSecrets | null> => {
      const { data, error } = await (supabase.rpc as any)('get_check_bank_account_secrets', { p_id: id });
      if (error) throw new Error(error.message);
      if (!Array.isArray(data) || data.length === 0) return null;
      const { routing_number, account_number } = data[0] as CheckBankAccountSecrets;
      return { routing_number, account_number };
    },
    [],
  );

  const autoCreatedRef = useRef<string | null>(null);

  useEffect(() => {
    if (query.isLoading || !restaurantId) return;
    if (autoCreatedRef.current === restaurantId) return;
    if ((query.data?.length ?? 0) > 0) return;

    autoCreatedRef.current = restaurantId;
    let cancelled = false;

    (async () => {
      try {
        const { data: connectedBanks } = await supabase
          .from('connected_banks' as any)
          .select('id, institution_name')
          .eq('restaurant_id', restaurantId)
          .eq('status', 'connected');

        if (!connectedBanks?.length || cancelled) return;

        for (const [i, bank] of (connectedBanks as any[]).entries()) {
          if (cancelled) return;
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

    return () => { cancelled = true; };
  }, [query.isLoading, query.data?.length, restaurantId, saveAccount]);

  const defaultAccount = query.data?.find((a) => a.is_default) ?? query.data?.[0] ?? null;

  return {
    accounts: query.data ?? [],
    defaultAccount,
    isLoading: query.isLoading,
    error: query.error,
    saveAccount,
    deleteAccount,
    claimCheckNumbers,
    saveAccountSecrets,
    fetchAccountSecrets,
  };
}
