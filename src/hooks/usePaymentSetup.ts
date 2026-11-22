import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useStripeConnect, StripeConnectedAccount } from '@/hooks/useStripeConnect';
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
  const stateRef = useRef(state);
  stateRef.current = state;

  const refetch = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['stripe-connected-account', restaurantId] }),
    [queryClient, restaurantId],
  );

  const checkStatus = useCallback(async () => {
    if (!restaurantId || checkingRef.current) return;
    checkingRef.current = true;
    setIsChecking(true);
    try {
      const { error: invokeError } = await supabase.functions.invoke(FUNCTION_NAME, {
        body: { restaurantId, statusOnly: true },
      });
      if (invokeError) throw invokeError;
      await queryClient.invalidateQueries({ queryKey: ['stripe-connected-account', restaurantId] });
      const fresh = queryClient.getQueryData<StripeConnectedAccount | null>([
        'stripe-connected-account',
        restaurantId,
      ]);
      const current = fresh === undefined ? stateRef.current : getPaymentSetupState(fresh);
      if (current === 'ready') {
        toast({ title: 'Payments are on' });
      } else if (current === 'pending') {
        toast({ title: 'Stripe is still checking your details' });
      }
    } catch (e) {
      toast({
        title: 'Could not check payment status',
        description: e instanceof Error ? e.message : 'An unexpected error occurred',
        variant: 'destructive',
      });
    } finally {
      checkingRef.current = false;
      setIsChecking(false);
    }
  }, [restaurantId, queryClient, toast]);

  const openSetup = useCallback(async () => {
    if (!restaurantId || startingRef.current) return;
    startingRef.current = true;
    setIsStarting(true);
    try {
      if (stateRef.current === 'not_started') {
        const { error: invokeError } = await supabase.functions.invoke(FUNCTION_NAME, {
          body: { restaurantId, accountType: 'express' },
        });
        if (invokeError) throw invokeError;
        await refetch();
      }
      setIsSheetOpen(true);
    } catch (e) {
      toast({
        title: 'Could not start payment setup',
        description: e instanceof Error ? e.message : 'An unexpected error occurred',
        variant: 'destructive',
      });
    } finally {
      startingRef.current = false;
      setIsStarting(false);
    }
  }, [restaurantId, refetch, toast]);

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
