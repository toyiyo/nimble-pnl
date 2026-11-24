import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useStripeConnect, StripeConnectedAccount } from '@/hooks/useStripeConnect';
import { stripeConnectedAccountKey } from '@/lib/stripeConnectKeys';
import { getPaymentSetupState, PaymentSetupState } from '@/lib/paymentSetupState';

const FUNCTION_NAME = 'stripe-create-connected-account';

/**
 * Run one async action at a time. Show a destructive toast when it fails.
 * The ref blocks a second call while the first call runs.
 */
function useGuardedAction(errorTitle: string) {
  const { toast } = useToast();
  const [isRunning, setIsRunning] = useState(false);
  const guardRef = useRef(false);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (guardRef.current) return;
      guardRef.current = true;
      setIsRunning(true);
      try {
        await action();
      } catch (e) {
        toast({
          title: errorTitle,
          description: e instanceof Error ? e.message : 'An unexpected error occurred',
          variant: 'destructive',
        });
      } finally {
        guardRef.current = false;
        setIsRunning(false);
      }
    },
    [toast, errorTitle],
  );

  return { run, isRunning };
}

/**
 * Own the payment setup flow for one restaurant.
 * Call this hook one time per page. Pass the result to the card and the sheet.
 * There is no timed poll. The webhook and `checkStatus` update the account row.
 */
export function usePaymentSetup(restaurantId: string | null) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { connectedAccount, loading, error } = useStripeConnect(restaurantId);

  // Store the restaurant that opened the sheet. A restaurant change closes the sheet.
  const [sheetRestaurantId, setSheetRestaurantId] = useState<string | null>(null);
  const isSheetOpen = restaurantId !== null && sheetRestaurantId === restaurantId;
  // Each restaurant change makes a new generation. A pending openSetup from an older
  // generation must not open the sheet, also after a return to the same restaurant.
  const generationRef = useRef(0);
  // Clear the stored restaurant on a change. Return to a restaurant must not reopen its sheet.
  useEffect(() => {
    generationRef.current += 1;
    setSheetRestaurantId(null);
  }, [restaurantId]);

  const state: PaymentSetupState = getPaymentSetupState(connectedAccount);

  const accountQueryKey = useMemo(() => stripeConnectedAccountKey(restaurantId), [restaurantId]);

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: accountQueryKey }),
    [queryClient, accountQueryKey],
  );

  // throwOnError makes a failed refetch fail the action. Stale cache is not fresh data.
  const refetchOrThrow = useCallback(
    () => queryClient.invalidateQueries({ queryKey: accountQueryKey }, { throwOnError: true }),
    [queryClient, accountQueryKey],
  );

  // Call the edge function, then refresh the account row.
  const invokeAndRefetch = useCallback(
    async (body: Record<string, unknown>) => {
      const { error: invokeError } = await supabase.functions.invoke(FUNCTION_NAME, { body });
      if (invokeError) throw invokeError;
      await refetchOrThrow();
    },
    [refetchOrThrow],
  );

  const { run: runStart, isRunning: isStarting } = useGuardedAction('Could not start payment setup');
  const { run: runCheck, isRunning: isChecking } = useGuardedAction('Could not check payment status');

  const checkStatus = useCallback(async () => {
    if (!restaurantId) return;
    await runCheck(async () => {
      await invokeAndRefetch({ restaurantId, statusOnly: true });
      const fresh = queryClient.getQueryData<StripeConnectedAccount | null>(accountQueryKey);
      // Show no toast when the cache has no data. Any value would be stale.
      if (fresh === undefined) return;
      const current = getPaymentSetupState(fresh);
      if (current === 'ready') {
        toast({ title: 'Payments are on' });
      } else if (current === 'pending') {
        toast({ title: 'Stripe is still checking your details' });
      }
    });
  }, [restaurantId, runCheck, invokeAndRefetch, queryClient, accountQueryKey, toast]);

  const openSetup = useCallback(async () => {
    // Do not write to the server from unknown data. Wait for the account row.
    if (!restaurantId || loading || error) return;
    const generation = generationRef.current;
    await runStart(async () => {
      if (state === 'not_started') {
        await invokeAndRefetch({ restaurantId, accountType: 'express' });
      }
      if (generation !== generationRef.current) return;
      setSheetRestaurantId(restaurantId);
    });
  }, [restaurantId, loading, error, runStart, invokeAndRefetch, state]);

  const closeSetup = useCallback(() => {
    setSheetRestaurantId(null);
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
