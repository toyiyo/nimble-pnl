import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { TransactionFiltersSheet, type TransactionFilters } from "@/components/TransactionFilters";
import { useDateFormat } from "@/hooks/useDateFormat";
import { formatDateInTimezone } from "@/lib/timezone";
import { Loader2, Building2, Sparkles, CheckCircle2, FileText, Wand2, Plus, Wallet, TrendingUp, Search, ArrowUpDown, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { loadStripe } from "@stripe/stripe-js";

export default function Banking() {
  const [activeTab, setActiveTab] = useState<'for_review' | 'categorized' | 'excluded' | 'reconciliation'>('for_review');
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [showReconciliationDialog, setShowReconciliationDialog] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<TransactionFilters>({});
  const [sortBy, setSortBy] = useState<'date' | 'payee' | 'amount' | 'category'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const { selectedRestaurant } = useRestaurantContext();
  const { formatTransactionDate, timezone } = useDateFormat();
  
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
    verifyConnectionSession,
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

      if (sessionData?.clientSecret && sessionData?.sessionId) {
        const stripe = await loadStripe(
          "pk_live_51SFateD9w6YUNUOUMLCT8LY9rmy9LtNevR4nhGYdSZdVqsdH2wjtbrMrrAAUZKAWzZq74RflwZQYHYOHu2CheQSn00Ug36fXVY",
        );

        if (!stripe) {
          throw new Error("Failed to load Stripe");
        }

        const { financialConnectionsSession } = await stripe.collectFinancialConnectionsAccounts({
          clientSecret: sessionData.clientSecret,
        });

        // Always verify the session, even if Stripe reports no accounts
        // This handles cases where webhooks fail or aren't sent (e.g., reconnections)
        console.log("[BANKING] Session completed, verifying with backend...");
        await verifyConnectionSession(sessionData.sessionId, selectedRestaurant.restaurant_id);
        
        // The verifyConnectionSession function will show appropriate toasts
        // and refresh the banks list automatically
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to connect bank");
    }
  };

  const totalBalance = connectedBanks
    .flatMap((bank) => bank.balances || [])
    .reduce((sum, balance) => sum + (Number(balance?.current_balance) || 0), 0);

  // Apply filters and sorting
  const applyFiltersAndSort = (transactions: typeof forReviewTransactions) => {
    if (!transactions) return [];
    
    return transactions.filter(txn => {
      // Search filter
      const matchesSearch = !searchTerm || 
        txn.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        txn.merchant_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        txn.normalized_payee?.toLowerCase().includes(searchTerm.toLowerCase());
      
      // Date filters - Convert timestamp to restaurant's local date for accurate filtering
      const transactionLocalDate = formatDateInTimezone(txn.transaction_date, timezone, 'yyyy-MM-dd');
      const matchesDateFrom = !filters.dateFrom || transactionLocalDate >= filters.dateFrom;
      const matchesDateTo = !filters.dateTo || transactionLocalDate <= filters.dateTo;
      
      // Amount filters
      const matchesMinAmount = filters.minAmount === undefined || Math.abs(txn.amount) >= filters.minAmount;
      const matchesMaxAmount = filters.maxAmount === undefined || Math.abs(txn.amount) <= filters.maxAmount;
      
      // Status filter
      const matchesStatus = !filters.status || txn.status === filters.status;
      
      // Transaction type filter
      const matchesType = !filters.transactionType || 
        (filters.transactionType === 'debit' && txn.amount < 0) ||
        (filters.transactionType === 'credit' && txn.amount > 0);
      
      // Category filter
      const matchesCategory = !filters.categoryId || txn.category_id === filters.categoryId;
      
      // Bank account filter
      const matchesBankAccount = !filters.bankAccountId || 
        (txn.connected_bank?.bank_account_balances?.some((acc: any) => acc.id === filters.bankAccountId) ?? false);
      
      // Uncategorized filter
      const matchesUncategorized = filters.showUncategorized === undefined || 
        (filters.showUncategorized ? !txn.is_categorized : true);
      
      return matchesSearch && matchesDateFrom && matchesDateTo && 
             matchesMinAmount && matchesMaxAmount && matchesStatus && matchesType &&
             matchesCategory && matchesBankAccount && matchesUncategorized;
    }).sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'date':
          comparison = new Date(a.transaction_date).getTime() - new Date(b.transaction_date).getTime();
          if (comparison === 0) {
            comparison = a.id.localeCompare(b.id);
          }
          break;
        case 'payee':
          const payeeA = a.normalized_payee || a.merchant_name || '';
          const payeeB = b.normalized_payee || b.merchant_name || '';
          comparison = payeeA.localeCompare(payeeB);
          break;
        case 'amount':
          comparison = Math.abs(a.amount) - Math.abs(b.amount);
          break;
        case 'category':
          const categoryA = a.chart_account?.account_name || '';
          const categoryB = b.chart_account?.account_name || '';
          comparison = categoryA.localeCompare(categoryB);
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  };

  const filteredForReview = applyFiltersAndSort(forReviewTransactions);
  const filteredCategorized = applyFiltersAndSort(categorizedTransactions);
  const filteredExcluded = applyFiltersAndSort(excludedTransactions);
  
  const reviewCount = filteredForReview?.length || 0;
  const categorizedCount = filteredCategorized?.length || 0;
  const excludedCount = filteredExcluded?.length || 0;
  
  const activeFilterCount = Object.values(filters).filter(v => v !== undefined && v !== '').length;

  return (
    <div className="min-h-screen bg-background">
      <PageHeader 
        icon={Building2} 
        title="Banking"
        actions={
          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            {reviewCount > 0 && (
              <Button 
                onClick={handleCategorizeAll} 
                disabled={categorizeAll.isPending}
                variant="default"
                className="w-full sm:w-auto"
              >
                {categorizeAll.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4 mr-2" />
                )}
                <span className="hidden sm:inline">Auto-Categorize All</span>
                <span className="sm:hidden">Categorize</span>
              </Button>
            )}
            <Button 
              onClick={() => setShowReconciliationDialog(true)} 
              variant="outline"
              className="w-full sm:w-auto"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Reconcile
            </Button>
            <Button 
              onClick={() => setShowRulesDialog(true)} 
              variant="outline"
              className="w-full sm:w-auto"
            >
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Connected Banks</h2>
              <Button 
                onClick={handleConnectBank} 
                disabled={isCreatingSession} 
                className="gap-2 w-full sm:w-auto"
              >
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
          
          {/* Search, Filter, and Sort Controls */}
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="flex flex-col gap-3">
                {/* Search and Sort */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search transactions..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 h-11"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Select value={sortBy} onValueChange={(value: 'date' | 'payee' | 'amount' | 'category') => setSortBy(value)}>
                      <SelectTrigger className="w-[160px] h-11">
                        <ArrowUpDown className="w-4 h-4 mr-2" />
                        <SelectValue placeholder="Sort by..." />
                      </SelectTrigger>
                      <SelectContent className="z-50 bg-background">
                        <SelectItem value="date">📅 Date</SelectItem>
                        <SelectItem value="payee">🏢 Payee</SelectItem>
                        <SelectItem value="amount">💰 Amount</SelectItem>
                        <SelectItem value="category">📊 Category</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button 
                      variant={sortDirection === 'desc' ? 'default' : 'outline'} 
                      size="icon"
                      onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
                      className="h-11 w-11"
                      title={sortDirection === 'desc' ? 'Descending order' : 'Ascending order'}
                    >
                      <ArrowUpDown className={`w-4 h-4 transition-transform ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                    </Button>
                  </div>
                </div>

                {/* Filter Button */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <TransactionFiltersSheet 
                      restaurantId={selectedRestaurant?.restaurant_id || ''}
                      filters={filters} 
                      onFiltersChange={setFilters} 
                    />
                    {activeFilterCount > 0 && (
                      <Badge 
                        variant="destructive" 
                        className="absolute -top-2 -right-2 h-5 w-5 p-0 flex items-center justify-center text-xs"
                      >
                        {activeFilterCount}
                      </Badge>
                    )}
                  </div>
                  {activeFilterCount > 0 && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Filter className="h-4 w-4" />
                      <span>{activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active</span>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => setFilters({})}
                        className="h-7 text-xs"
                      >
                        Clear
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 mb-6 h-auto">
            <TabsTrigger value="for_review" className="relative py-2.5">
              <span className="hidden sm:inline">For Review</span>
              <span className="sm:hidden">Review</span>
              {reviewCount > 0 && (
                <span className="ml-1 sm:ml-2 bg-primary text-primary-foreground rounded-full px-1.5 sm:px-2 py-0.5 text-xs">
                  {reviewCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="categorized" className="relative py-2.5">
              <span className="hidden sm:inline">Categorized</span>
              <span className="sm:hidden">Done</span>
              {categorizedCount > 0 && (
                <span className="ml-1 sm:ml-2 bg-muted text-muted-foreground rounded-full px-1.5 sm:px-2 py-0.5 text-xs">
                  {categorizedCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="excluded" className="relative py-2.5">
              Excluded
              {excludedCount > 0 && (
                <span className="ml-1 sm:ml-2 bg-muted text-muted-foreground rounded-full px-1.5 sm:px-2 py-0.5 text-xs">
                  {excludedCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="reconciliation" className="py-2.5">
              <FileText className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Reconciliation</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="for_review">
            <Card>
              <div className="p-6">
                {isLoadingReview ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredForReview && filteredForReview.length > 0 ? (
                  <div className="-mx-6">
                    <BankTransactionList transactions={filteredForReview} status="for_review" accounts={accounts} />
                  </div>
                ) : forReviewTransactions && forReviewTransactions.length > 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-lg">No transactions match your filters</p>
                    <p className="text-sm mt-2">Try adjusting your search or filter criteria</p>
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
                ) : filteredCategorized && filteredCategorized.length > 0 ? (
                  <div className="-mx-6">
                    <BankTransactionList transactions={filteredCategorized} status="categorized" accounts={accounts} />
                  </div>
                ) : categorizedTransactions && categorizedTransactions.length > 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-lg">No transactions match your filters</p>
                    <p className="text-sm mt-2">Try adjusting your search or filter criteria</p>
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
                ) : filteredExcluded && filteredExcluded.length > 0 ? (
                  <div className="-mx-6">
                    <BankTransactionList transactions={filteredExcluded} status="excluded" accounts={accounts} />
                  </div>
                ) : excludedTransactions && excludedTransactions.length > 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-lg">No transactions match your filters</p>
                    <p className="text-sm mt-2">Try adjusting your search or filter criteria</p>
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

      {selectedRestaurant && (
        <>
          <CategoryRulesDialog
            open={showRulesDialog}
            onOpenChange={setShowRulesDialog}
          />

          <EnhancedReconciliationDialog
            isOpen={showReconciliationDialog}
            onClose={() => setShowReconciliationDialog(false)}
          />
        </>
      )}
    </div>
  );
}
