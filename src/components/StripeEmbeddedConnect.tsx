import { useEffect } from "react";
import {
  ConnectAccountOnboarding,
  ConnectAccountManagement,
  ConnectPayments,
  ConnectPayouts,
  ConnectBalances,
  ConnectTaxRegistrations,
  ConnectTaxSettings,
  ConnectComponentsProvider
} from "@stripe/react-connect-js";
import { useStripeEmbeddedConnect } from "@/hooks/useStripeEmbeddedConnect";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";

type StripeComponentType =
  | "account_onboarding"
  | "account_management"
  | "payments"
  | "payouts"
  | "balances"
  | "tax_registrations"
  | "tax_settings";

interface StripeEmbeddedConnectProps {
  restaurantId: string | null;
  component: StripeComponentType;
  onCompleted?: () => void;
  className?: string;
}

export function StripeEmbeddedConnect({
  restaurantId,
  component,
  onCompleted,
  className = ""
}: StripeEmbeddedConnectProps) {
  const { connectInstance, start, isLoading, error } = useStripeEmbeddedConnect(restaurantId);

  // Auto-start when component mounts
  useEffect(() => {
    if (!connectInstance && !isLoading) {
      start();
    }
  }, [connectInstance, isLoading, start]);

  const renderComponent = () => {
    if (!connectInstance) return null;

    switch (component) {
      case "account_onboarding":
        return <ConnectAccountOnboarding onExit={onCompleted ? () => onCompleted() : undefined} />;
      case "account_management":
        return <ConnectAccountManagement />;
      case "payments":
        return <ConnectPayments />;
      case "payouts":
        return <ConnectPayouts />;
      case "balances":
        return <ConnectBalances />;
      case "tax_registrations":
        return <ConnectTaxRegistrations />;
      case "tax_settings":
        return <ConnectTaxSettings />;
      default:
        return (
          <div className="p-4 text-center text-muted-foreground">
            Component "{component}" not implemented yet
          </div>
        );
    }
  };

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="text-center space-y-2">
          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading payment interface...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={className}>
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!connectInstance) {
    return (
      <div className={`p-4 ${className}`}>
        <Button onClick={() => start()} disabled={isLoading} className="w-full">
          {isLoading ? "Loading..." : "Load Payment Interface"}
        </Button>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border ${className}`}>
      <ConnectComponentsProvider connectInstance={connectInstance}>
        {renderComponent()}
      </ConnectComponentsProvider>
    </div>
  );
}