import { useEffect } from "react";
import { ConnectAccountOnboarding, ConnectComponentsProvider } from "@stripe/react-connect-js";
import { useStripeEmbeddedConnect } from "@/hooks/useStripeEmbeddedConnect";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface StripeEmbeddedOnboardingProps {
  restaurantId: string | null;
  onCompleted?: () => void;
}

export function StripeEmbeddedOnboarding({ restaurantId, onCompleted }: StripeEmbeddedOnboardingProps) {
  const { connectInstance, start, isLoading, error } = useStripeEmbeddedConnect(restaurantId);

  // Once the user exits the embedded flow, refresh status
  const handleExit = () => {
    onCompleted?.();
  };

  useEffect(() => {
    // Optionally auto-start when component mounts if desired
    // start();
  }, [start]);

  return (
    <div className="space-y-3">
      {!connectInstance && (
        <Button onClick={() => start()} disabled={isLoading} className="w-full md:w-auto">
          {isLoading ? "Starting Stripe setup..." : "Continue Stripe Setup"}
        </Button>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {connectInstance && (
        <div className="rounded-lg border p-4 bg-white">
          <ConnectComponentsProvider connectInstance={connectInstance}>
            <ConnectAccountOnboarding onExit={handleExit} />
          </ConnectComponentsProvider>
        </div>
      )}
    </div>
  );
}
