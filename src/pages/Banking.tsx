import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBankTransactions } from "@/hooks/useBankTransactions";
import { BankTransactionList } from "@/components/banking/BankTransactionList";
import { CategoryRulesDialog } from "@/components/banking/CategoryRulesDialog";
import { EnhancedReconciliationDialog } from "@/components/banking/EnhancedReconciliationDialog";
import { ReconciliationReport } from "@/components/banking/ReconciliationReport";
import { BankConnectionCard } from "@/components/BankConnectionCard";
import { MetricIcon } from "@/components/MetricIcon";
import { useCategorizeTransactions } from "@/hooks/useCategorizeTransactions";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useStripeFinancialConnections } from "@/hooks/useStripeFinancialConnections";
import { Loader2, Building2, Sparkles, CheckCircle2, FileText, Wand2, Plus, Wallet, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { loadStripe } from "@stripe/stripe-js";

export default function Banking() {
  const [activeTab, setActiveTab] = useState<'for_review' | 'categorized' | 'excluded' | 'reconciliation'>('for_review');
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [showReconciliationDialog, setShowReconciliationDialog] = useState(false);
  const { selectedRestaurant } = useRestaurantContext();
  
  const { data: forReviewTransactions, isLoading: isLoadingReview } = useBankTransactions('for_review');
  const { data: categorizedTransactions, isLoading: isLoadingCategorized } = useBankTransactions('categorized');
  const { data: excludedTransactions, isLoading: isLoadingExcluded } = useBankTransactions('excluded');
  const categorizeAll = useCategorizeTransactions();
  const { accounts } = useChartOfAccounts(selectedRestaurant?.restaurant_id || null);
  
  const {
    connectedBanks,
    loading: banksLoading,
    createFinancialConnectionsSession,
    isCreatingSession,
    refreshBalance,
    syncTransactions,
    disconnectBank,
  } = useStripeFinancialConnections(selectedRestaurant?.restaurant_id || null);
  
  const handleCategorizeAll = () => {
    if (selectedRestaurant?.restaurant_id) {
      categorizeAll.mutate(selectedRestaurant.restaurant_id);
    }
  };

  const handleConnectBank = async () => {
    if (!selectedRestaurant) return;

    try {
      const sessionData = await createFinancialConnectionsSession();

      if (sessionData?.clientSecret) {
        const stripe = await loadStripe(
          "pk_live_51SFateD9w6YUNUOUMLCT8LY9rmy9LtNevR4nhGYdSZdVqsdH2wjtbrMrrAAUZKAWzZq74RflwZQYHYOHu2CheQSn00Ug36fXVY",
        );

        if (!stripe) {
          throw new Error("Failed to load Stripe");
        }

        const { financialConnectionsSession } = await stripe.collectFinancialConnectionsAccounts({
          clientSecret: sessionData.clientSecret,
        });

        if (financialConnectionsSession.accounts && financialConnectionsSession.accounts.length > 0) {
          toast.success("Bank Connected Successfully - Syncing transactions...");
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        } else {
          toast.info("Connection Cancelled");
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to connect bank");
    }
  };

  const totalBalance = connectedBanks
    .flatMap((bank) => bank.balances || [])
    .reduce((sum, balance) => sum + (Number(balance?.current_balance) || 0), 0);

  const reviewCount = forReviewTransactions?.length || 0;
  const categorizedCount = categorizedTransactions?.length || 0;
  const excludedCount = excludedTransactions?.length || 0;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader 
        icon={Building2} 
        title="Banking"
        actions={
          <div className="flex gap-2">
            {reviewCount > 0 && (
              <Button 
                onClick={handleCategorizeAll} 
                disabled={categorizeAll.isPending}
                variant="default"
              >
                {categorizeAll.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4 mr-2" />
                )}
                Auto-Categorize All
              </Button>
            )}
            <Button onClick={() => setShowReconciliationDialog(true)} variant="outline">
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Reconcile
            </Button>
            <Button onClick={() => setShowRulesDialog(true)} variant="outline">
              <Sparkles className="h-4 w-4 mr-2" />
              Rules
            </Button>
          </div>
        }
      />

      <div className="container mx-auto px-4 py-8">
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
                    <div className="text-sm text-muted-foreground">Total Balance</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-all duration-200">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <MetricIcon icon={Building2} variant="blue" />
                  <div>
                    <div className="text-3xl font-bold">{connectedBanks.length}</div>
                    <div className="text-sm text-muted-foreground">Connected Banks</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-all duration-200">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <MetricIcon icon={TrendingUp} variant="purple" />
                  <div>
                    <div className="text-3xl font-bold">
                      {connectedBanks.reduce((sum, bank) => sum + (bank.balances?.length || 0), 0)}
                    </div>
                    <div className="text-sm text-muted-foreground">Accounts</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Connected Banks Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Connected Banks</h2>
              <Button onClick={handleConnectBank} disabled={isCreatingSession} className="gap-2">
                <Plus className="h-4 w-4" />
                {isCreatingSession ? "Connecting..." : "Connect Bank"}
              </Button>
            </div>

            {banksLoading ? (
              <div className="text-center p-8 text-muted-foreground">Loading connected banks...</div>
            ) : connectedBanks.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center p-12 text-center">
                  <MetricIcon icon={Building2} variant="blue" className="mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No Banks Connected</h3>
                  <p className="text-sm text-muted-foreground mb-6 max-w-md">
                    Connect your bank accounts to automatically track transactions, reconcile expenses, and gain
                    real-time financial insights.
                  </p>
                  <Button onClick={handleConnectBank} disabled={isCreatingSession}>
                    <Plus className="h-4 w-4 mr-2" />
                    Connect Your First Bank
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {connectedBanks.map((bank) => (
                  <BankConnectionCard
                    key={bank.id}
                    bank={bank}
                    restaurantId={selectedRestaurant?.restaurant_id || ""}
                    onRefreshBalance={refreshBalance}
                    onSyncTransactions={syncTransactions}
                    onDisconnect={disconnectBank}
                  />
                ))}
              </div>
            )}
          </div>
          
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="for_review" className="relative">
              For Review
              {reviewCount > 0 && (
                <span className="ml-2 bg-primary text-primary-foreground rounded-full px-2 py-0.5 text-xs">
                  {reviewCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="categorized" className="relative">
              Categorized
              {categorizedCount > 0 && (
                <span className="ml-2 bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                  {categorizedCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="excluded" className="relative">
              Excluded
              {excludedCount > 0 && (
                <span className="ml-2 bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                  {excludedCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="reconciliation">
              <FileText className="h-4 w-4 mr-2" />
              Reconciliation
            </TabsTrigger>
          </TabsList>

          <TabsContent value="for_review">
            <Card>
              <div className="p-6">
                {isLoadingReview ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : forReviewTransactions && forReviewTransactions.length > 0 ? (
                  <div className="-mx-6">
                    <BankTransactionList transactions={forReviewTransactions} status="for_review" accounts={accounts} />
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-lg">No transactions to review</p>
                    <p className="text-sm mt-2">All caught up! 🎉</p>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="categorized">
            <Card>
              <div className="p-6">
                {isLoadingCategorized ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : categorizedTransactions && categorizedTransactions.length > 0 ? (
                  <div className="-mx-6">
                    <BankTransactionList transactions={categorizedTransactions} status="categorized" accounts={accounts} />
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-lg">No categorized transactions</p>
                    <p className="text-sm mt-2">Start categorizing transactions from the "For Review" tab</p>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="excluded">
            <Card>
              <div className="p-6">
                {isLoadingExcluded ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : excludedTransactions && excludedTransactions.length > 0 ? (
                  <div className="-mx-6">
                    <BankTransactionList transactions={excludedTransactions} status="excluded" accounts={accounts} />
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-lg">No excluded transactions</p>
                    <p className="text-sm mt-2">Duplicate or personal transactions will appear here</p>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="reconciliation">
            <ReconciliationReport />
          </TabsContent>
          </Tabs>
        </div>
      </div>

      <CategoryRulesDialog
        open={showRulesDialog}
        onOpenChange={setShowRulesDialog}
      />

      <EnhancedReconciliationDialog
        isOpen={showReconciliationDialog}
        onClose={() => setShowReconciliationDialog(false)}
      />
    </div>
  );
}
