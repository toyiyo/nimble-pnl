import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";

import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import { Wallet, TrendingUp, CheckCircle2, Printer } from "lucide-react";

import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { usePendingOutflows } from "@/hooks/usePendingOutflows";
import { useStripeFinancialConnections } from "@/hooks/useStripeFinancialConnections";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";

import { PendingOutflowsList } from "@/components/pending-outflows/PendingOutflowsList";
import { AddExpenseSheet } from "@/components/pending-outflows/AddExpenseSheet";
import { EditExpenseSheet } from "@/components/pending-outflows/EditExpenseSheet";
import { BankReauthBanner, toReauthBannerBanks } from "@/components/banking/BankReauthBanner";
import { MetricIcon } from "@/components/MetricIcon";
import { FeatureGate } from "@/components/subscription";

import type { PendingOutflow } from "@/types/pending-outflows";

export default function Expenses() {
  const navigate = useNavigate();
  const [showAddExpenseSheet, setShowAddExpenseSheet] = useState(false);
  const [editingExpense, setEditingExpense] = useState<PendingOutflow | null>(null);
  const { selectedRestaurant } = useRestaurantContext();
  const { toast } = useToast();
  const { hasCapability, isResolved } = usePermissions();

  const { data: expenses } = usePendingOutflows();

  const {
    connectedBanks,
    loading: banksLoading,
    totalBalance,
    createFinancialConnectionsSession,
    verifyConnectionSession,
  } = useStripeFinancialConnections(selectedRestaurant?.restaurant_id || null);

  const totalExpenses = (expenses || [])
    .filter(expense => ['pending', 'stale_30', 'stale_60', 'stale_90'].includes(expense.status))
    .reduce((sum, expense) => sum + expense.amount, 0);

  const bookBalance = totalBalance - totalExpenses;

  // Reconnect flow for a quarantined bank surfaced by <BankReauthBanner> —
  // same client-side session-collection flow as Banking.tsx/Accounting.tsx;
  // the difference is entirely server-side (design §4.5/§5.4).
  const handleConnectBank = async (connectedBankId?: string) => {
    if (!selectedRestaurant) return;

    try {
      const sessionData = await createFinancialConnectionsSession(connectedBankId);

      if (sessionData?.clientSecret && sessionData?.sessionId) {
        const stripe = await loadStripe(
          "pk_live_51SFateD9w6YUNUOUMLCT8LY9rmy9LtNevR4nhGYdSZdVqsdH2wjtbrMrrAAUZKAWzZq74RflwZQYHYOHu2CheQSn00Ug36fXVY",
        );

        if (!stripe) {
          throw new Error("Failed to load Stripe");
        }

        await stripe.collectFinancialConnectionsAccounts({
          clientSecret: sessionData.clientSecret,
        });

        await verifyConnectionSession(sessionData.sessionId, selectedRestaurant.restaurant_id);
      }
    } catch (error) {
      toast({
        title: "Failed to Connect Bank",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  // The minimal per-account shape `<BankReauthBanner>` needs — see
  // src/components/banking/BankReauthBanner.tsx (design §5.2).
  const reauthBannerBanks = useMemo(() => toReauthBannerBanks(connectedBanks), [connectedBanks]);

  return (
    <FeatureGate featureKey="expenses">
    <div className="min-h-screen bg-background">
      <PageHeader
        icon={Wallet}
        title="Expenses"
        actions={
          isResolved && hasCapability('edit:pending_outflows') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/print-checks')}
              aria-label="Print checks"
            >
              <Printer className="h-4 w-4 mr-2" />
              Print Checks
            </Button>
          )
        }
      />

      <div className="w-full px-4 py-8">
        <div className="space-y-6">
          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="hover:shadow-lg transition-all duration-200">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <MetricIcon icon={Wallet} variant="emerald" />
                  <div>
                    <div className="text-3xl font-bold">
                      ${totalBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-sm text-muted-foreground">Bank Balance</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-all duration-200 border-amber-500/20">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <MetricIcon icon={TrendingUp} variant="amber" />
                  <div>
                    <div className="text-3xl font-bold text-destructive">
                      ${totalExpenses.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-sm text-muted-foreground">Uncommitted Expenses</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-all duration-200 border-green-500/20 bg-gradient-to-br from-green-50/50 to-transparent">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <MetricIcon icon={CheckCircle2} variant="emerald" />
                  <div>
                    <div className="text-3xl font-bold text-green-600">
                      ${bookBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Book Balance
                      <span className="block text-xs">After expenses clear</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <BankReauthBanner
            banks={reauthBannerBanks}
            loading={banksLoading}
            onReconnect={handleConnectBank}
          />

          <PendingOutflowsList
            onAddClick={() => setShowAddExpenseSheet(true)}
            onEditExpense={setEditingExpense}
            statusFilter="all"
          />
        </div>
      </div>

      {selectedRestaurant && (
        <>
          <AddExpenseSheet open={showAddExpenseSheet} onOpenChange={setShowAddExpenseSheet} />
          <EditExpenseSheet
            expense={editingExpense}
            open={!!editingExpense}
            onOpenChange={(open) => !open && setEditingExpense(null)}
          />
        </>
      )}
    </div>
    </FeatureGate>
  );
}
