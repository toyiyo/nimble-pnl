import { useState, useCallback, useRef, useEffect } from "react";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import { supabase } from "@/integrations/supabase/client";

// Use app's primary and secondary colors for Stripe embed branding
const BRAND_PRIMARY = "#0f1419"; // App's primary color (hsl(222.2, 47.4%, 11.2%))
const BRAND_BACKGROUND = "#f4f7fa"; // App's secondary color (hsl(210, 40%, 96.1%))

interface UseStripeEmbeddedConnectOptions {
  onReady?: (clientSecret: string) => void;
}

export function useStripeEmbeddedConnect(restaurantId: string | null, options: UseStripeEmbeddedConnectOptions = {}) {
  const [connectInstance, setConnectInstance] = useState<any>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read onReady through a ref so a new options object keeps start stable.
  const onReadyRef = useRef(options.onReady);
  useEffect(() => {
    onReadyRef.current = options.onReady;
  }, [options.onReady]);

  // Track the current restaurant. A start for an earlier restaurant must not set state.
  const activeRestaurantRef = useRef(restaurantId);
  useEffect(() => {
    activeRestaurantRef.current = restaurantId;
    setConnectInstance(null);
    setClientSecret(null);
    setError(null);
    setIsLoading(false);
  }, [restaurantId]);

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

      if (activeRestaurantRef.current !== restaurantId) return null;
      setClientSecret(secret);
      onReadyRef.current?.(secret);

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

      if (activeRestaurantRef.current !== restaurantId) return null;
      setConnectInstance(connect);
      return connect;
    } catch (err) {
      if (activeRestaurantRef.current !== restaurantId) return null;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    } finally {
      if (activeRestaurantRef.current === restaurantId) setIsLoading(false);
    }
  }, [restaurantId]);

  return {
    connectInstance,
    clientSecret,
    isLoading,
    error,
    start,
  };
}
