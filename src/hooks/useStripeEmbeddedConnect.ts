import { useState, useCallback } from "react";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { supabase } from "@/integrations/supabase/client";

const BRAND_PRIMARY = "#0f172a";
const BRAND_BACKGROUND = "#f1f5f9";

interface UseStripeEmbeddedConnectOptions {
  onReady?: (clientSecret: string) => void;
}

export function useStripeEmbeddedConnect(restaurantId: string | null, options: UseStripeEmbeddedConnectOptions = {}) {
  const [connectInstance, setConnectInstance] = useState<any>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (!restaurantId) {
      setError("Restaurant is not selected");
      return null;
    }

    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "stripe-create-account-session",
        { body: { restaurantId } }
      );

      if (fnError) {
        throw new Error(fnError.message || "Failed to create Stripe Account Session");
      }

      const secret = data?.clientSecret;
      if (!secret) {
        throw new Error("Missing client secret from Stripe Account Session");
      }

      setClientSecret(secret);
      options.onReady?.(secret);

      const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
      if (!publishableKey) {
        throw new Error("Missing VITE_STRIPE_PUBLISHABLE_KEY");
      }

      const connect = await loadConnectAndInitialize({
        publishableKey,
        fetchClientSecret: async () => secret,
        appearance: {
          variables: {
            colorPrimary: BRAND_PRIMARY,
            colorBackground: BRAND_BACKGROUND,
          },
        },
      });

      setConnectInstance(connect);
      return connect;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [restaurantId, options]);

  return {
    connectInstance,
    clientSecret,
    isLoading,
    error,
    start,
  };
}
