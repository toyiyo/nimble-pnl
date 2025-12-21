import { useState } from "react";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useStripeConnect } from "@/hooks/useStripeConnect";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CreditCard,
  Wallet,
  Settings,
  FileText,
  AlertCircle,
  CheckCircle,
  Building2,
  Receipt,
  DollarSign,
  Shield
} from "lucide-react";
import { StripeEmbeddedConnect } from "@/components/StripeEmbeddedConnect";

export default function StripeAccountManagement() {
  const { selectedRestaurant } = useRestaurantContext();
  const { connectedAccount, isReadyForInvoicing, createAccount, isCreatingAccount } = useStripeConnect(selectedRestaurant?.restaurant_id || null);
  const [activeTab, setActiveTab] = useState("setup");

  // Show setup prompt if no account exists
  if (!connectedAccount) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stripe Account Management</h1>
          <p className="text-muted-foreground">
            Manage your Stripe Connect account, payments, and financial operations
          </p>
        </div>

        <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Set up Stripe Connect
            </CardTitle>
            <CardDescription>
              Connect your restaurant to Stripe to accept payments, manage payouts, and access financial tools.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => createAccount('express')}
              disabled={isCreatingAccount}
              className="w-full md:w-auto"
            >
              {isCreatingAccount ? "Setting up..." : "Set up Stripe Connect"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show onboarding prompt if account exists but not ready
  if (connectedAccount && !isReadyForInvoicing) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stripe Account Management</h1>
          <p className="text-muted-foreground">
            Complete your Stripe account setup to access all financial features
          </p>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Complete Account Setup</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Your Stripe Connect account was created but needs to be fully configured.
              Please complete the onboarding process below.
            </p>
            <StripeEmbeddedConnect
              restaurantId={selectedRestaurant?.restaurant_id || null}
              component="account_onboarding"
              onCompleted={() => {
                // Refresh will happen via React Query
                window.location.reload();
              }}
            />
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stripe Account Management</h1>
          <p className="text-muted-foreground">
            Manage your Stripe Connect account, payments, and financial operations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="flex items-center gap-1">
            <CheckCircle className="h-3 w-3 text-green-600" />
            Connected
          </Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="setup" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Account Setup
          </TabsTrigger>
          <TabsTrigger value="payments" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            Payments
          </TabsTrigger>
          <TabsTrigger value="payouts" className="flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            Payouts
          </TabsTrigger>
          <TabsTrigger value="details" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Account Details
          </TabsTrigger>
          <TabsTrigger value="tax" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Tax & Compliance
          </TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Account Setup & Management
              </CardTitle>
              <CardDescription>
                Manage your account details, banking information, and compliance settings
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StripeEmbeddedConnect
                restaurantId={selectedRestaurant?.restaurant_id || null}
                component="account_management"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Payments & Transactions
              </CardTitle>
              <CardDescription>
                View and manage payments, refunds, and transaction history
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StripeEmbeddedConnect
                restaurantId={selectedRestaurant?.restaurant_id || null}
                component="payments"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payouts" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5" />
                  Payouts
                </CardTitle>
                <CardDescription>
                  View payout history and manage payout schedules
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StripeEmbeddedConnect
                  restaurantId={selectedRestaurant?.restaurant_id || null}
                  component="payouts"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Balance
                </CardTitle>
                <CardDescription>
                  View your current balance and available funds
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StripeEmbeddedConnect
                  restaurantId={selectedRestaurant?.restaurant_id || null}
                  component="balances"
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="details" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Account Details
              </CardTitle>
              <CardDescription>
                View and manage your Stripe account information
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StripeEmbeddedConnect
                restaurantId={selectedRestaurant?.restaurant_id || null}
                component="account_management"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tax" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Tax Registrations
                </CardTitle>
                <CardDescription>
                  Manage tax registrations and compliance documents
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StripeEmbeddedConnect
                  restaurantId={selectedRestaurant?.restaurant_id || null}
                  component="tax_registrations"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  Tax Settings
                </CardTitle>
                <CardDescription>
                  Configure tax collection and reporting settings
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StripeEmbeddedConnect
                  restaurantId={selectedRestaurant?.restaurant_id || null}
                  component="tax_settings"
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}