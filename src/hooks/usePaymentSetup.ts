import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useStripeConnect, StripeConnectedAccount } from '@/hooks/useStripeConnect';
import { stripeConnectedAccountKey } from '@/lib/stripeConnectKeys';
import { getPaymentSetupState, PaymentSetupState } from '@/lib/paymentSetupState';

const FUNCTION_NAME = 'stripe-create-connected-account';

/**
 * Own the payment setup flow for one restaurant.
 * Call this hook one time per page. Pass the result to the card and the sheet.
 * There is no timed poll. The webhook and `checkStatus` update the account row.
 */
export function usePaymentSetup(restaurantId: string | null) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { connectedAccount, loading, error } = useStripeConnect(restaurantId);

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const startingRef = useRef(false);
  const checkingRef = useRef(false);

  const state: PaymentSetupState = getPaymentSetupState(connectedAccount);

  const accountQueryKey = useMemo(() => stripeConnectedAccountKey(restaurantId), [restaurantId]);

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: accountQueryKey }),
    [queryClient, accountQueryKey],
  );

  // Call the edge function, then refresh the account row.
  const invokeAndRefetch = useCallback(
    async (body: Record<string, unknown>) => {
      const { error: invokeError } = await supabase.functions.invoke(FUNCTION_NAME, { body });
      if (invokeError) throw invokeError;
      await refetch();
    },
    [refetch],
  );

  // Run one guarded action. The ref blocks a second call while the first call runs.
  const runGuarded = useCallback(
    async (
      guard: { current: boolean },
      setFlag: (value: boolean) => void,
      errorTitle: string,
      action: () => Promise<void>,
    ) => {
      if (guard.current) return;
      guard.current = true;
      setFlag(true);
      try {
        await action();
      } catch (e) {
        toast({
          title: errorTitle,
          description: e instanceof Error ? e.message : 'An unexpected error occurred',
          variant: 'destructive',
        });
      } finally {
        guard.current = false;
        setFlag(false);
      }
    },
    [toast],
  );

  const checkStatus = useCallback(async () => {
    if (!restaurantId) return;
    await runGuarded(checkingRef, setIsChecking, 'Could not check payment status', async () => {
      await invokeAndRefetch({ restaurantId, statusOnly: true });
      const fresh = queryClient.getQueryData<StripeConnectedAccount | null>(accountQueryKey);
      const current = fresh === undefined ? state : getPaymentSetupState(fresh);
      if (current === 'ready') {
        toast({ title: 'Payments are on' });
      } else if (current === 'pending') {
        toast({ title: 'Stripe is still checking your details' });
      }
    });
  }, [restaurantId, runGuarded, invokeAndRefetch, queryClient, accountQueryKey, state, toast]);

  const openSetup = useCallback(async () => {
    // Do not write to the server from unknown data. Wait for the account row.
    if (!restaurantId || loading || error) return;
    await runGuarded(startingRef, setIsStarting, 'Could not start payment setup', async () => {
      if (state === 'not_started') {
        await invokeAndRefetch({ restaurantId, accountType: 'express' });
      }
      setIsSheetOpen(true);
    });
  }, [restaurantId, loading, error, runGuarded, invokeAndRefetch, state]);

  const closeSetup = useCallback(() => {
    setIsSheetOpen(false);
    void checkStatus();
  }, [checkStatus]);

  return {
    state,
    isLoading: loading,
    error: (error as Error | null) ?? null,
    refetch,
    isSheetOpen,
    openSetup,
    closeSetup,
    checkStatus,
    isChecking,
    isStarting,
  };
}

export type PaymentSetup = ReturnType<typeof usePaymentSetup>;
