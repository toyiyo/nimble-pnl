import { useState, useEffect } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBankTransactions } from "@/hooks/useBankTransactions";
import { BankTransactionList } from "@/components/banking/BankTransactionList";
import { EnhancedCategoryRulesDialog } from "@/components/banking/EnhancedCategoryRulesDialog";
import { EnhancedReconciliationDialog } from "@/components/banking/EnhancedReconciliationDialog";
import { ReconciliationReport } from "@/components/banking/ReconciliationReport";
import { BankConnectionCard } from "@/components/BankConnectionCard";
import { MetricIcon } from "@/components/MetricIcon";
import { Link, useLocation } from "react-router-dom";
import { FeatureGate } from "@/components/subscription";
import { useCategorizeTransactions } from "@/hooks/useCategorizeTransactions";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useStripeFinancialConnections } from "@/hooks/useStripeFinancialConnections";
import { TransactionFiltersSheet, type TransactionFilters } from "@/components/TransactionFilters";
import { BankStatementUpload } from "@/components/BankStatementUpload";
import { BankStatementReview } from "@/components/BankStatementReview";
import { useBankStatementImport } from "@/hooks/useBankStatementImport";
import { Loader2, Building2, Sparkles, CheckCircle2, FileText, Wand2, Plus, Wallet, Search, ArrowUpDown, Filter, Brain, ArrowRight, Upload, Tags, XCircle, ArrowLeftRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { loadStripe } from "@stripe/stripe-js";
import { supabase } from "@/integrations/supabase/client";
import { type BankStatus, type GroupedBank } from "@/utils/financialConnections";
import { useBulkSelection } from "@/hooks/useBulkSelection";
import { BulkActionBar } from "@/components/bulk-edit/BulkActionBar";
import { BulkCategorizeTransactionsPanel } from "@/components/banking/BulkCategorizeTransactionsPanel";
import { useBulkCategorizeTransactions, useBulkExcludeTransactions, useBulkMarkAsTransfer } from "@/hooks/useBulkTransactionActions";
import { isMultiSelectKey } from "@/utils/bulkEditUtils";

export default function Banking() {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<'for_review' | 'categorized' | 'excluded' | 'reconciliation' | 'upload_statement'>('for_review');
  const [activeStatementId, setActiveStatementId] = useState<string | null>(null);
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [showReconciliationDialog, setShowReconciliationDialog] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<TransactionFilters>({});
  const [activeCategoryName, setActiveCategoryName] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'date' | 'payee' | 'amount' | 'category'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showBulkCategorizePanel, setShowBulkCategorizePanel] = useState(false);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const { selectedRestaurant } = useRestaurantContext();
  const hasActiveFilters = searchTerm.length > 0 || Object.values(filters).some(v => v !== undefined && v !== '');
  
  // Handle navigation state from Dashboard category clicks
  useEffect(() => {
    const state = location.state as { 
      categoryId?: string; 
      categoryName?: string;
      tab?: string;
      filterUncategorized?: boolean;
    } | null;
    
    if (state?.categoryId) {
      setFilters(prev => ({ ...prev, categoryId: state.categoryId }));
      setActiveCategoryName(state.categoryName || null);
      setActiveTab('categorized');
      // Clear the state to prevent re-applying on refresh
      window.history.replaceState({}, document.title);
    }
    
    if (state?.filterUncategorized) {
      setFilters(prev => ({ ...prev, showUncategorized: true }));
      setActiveTab('for_review');
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);
  
  // Bulk selection hooks
  const bulkSelection = useBulkSelection();
  const bulkCategorize = useBulkCategorizeTransactions();
  const bulkExclude = useBulkExcludeTransactions();
  const bulkMarkTransfer = useBulkMarkAsTransfer();
  
  const {
    transactions: reviewTransactions = [],
    totalCount: reviewCount = 0,
    isLoading: isLoadingReview,
    loadingMore: loadingMoreReview,
    hasMore: hasMoreReview,
    loadMore: loadMoreReview,
  } = useBankTransactions('for_review', {
    searchTerm,
    filters,
    sortBy,
    sortDirection,
  });
  const {
    transactions: categorizedTransactions = [],
    totalCount: categorizedCount = 0,
    isLoading: isLoadingCategorized,
    loadingMore: loadingMoreCategorized,
    hasMore: hasMoreCategorized,
    loadMore: loadMoreCategorized,
  } = useBankTransactions('categorized', {
    searchTerm,
    filters,
    sortBy,
    sortDirection,
  });
  const {
    transactions: excludedTransactions = [],
    totalCount: excludedCount = 0,
    isLoading: isLoadingExcluded,
    loadingMore: loadingMoreExcluded,
    hasMore: hasMoreExcluded,
    loadMore: loadMoreExcluded,
  } = useBankTransactions('excluded', {
    searchTerm,
    filters,
    sortBy,
    sortDirection,
  });
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
    groupedBanks,
    totalBalance,
    bankCount,
    accountCount,
  } = useStripeFinancialConnections(selectedRestaurant?.restaurant_id || null);

  const { recalculateBankBalance } = useBankStatementImport();

  // Auto-recalculate balances for Manual Upload banks with $0 balance
  useEffect(() => {
    const checkAndRecalculateBalances = async () => {
      if (!connectedBanks || connectedBanks.length === 0) return;

      for (const bank of connectedBanks) {
        // Check if it's a Manual Upload bank with $0 balance
        if (bank.institution_name === 'Manual Upload') {
          const balance = bank.balances?.[0];
          if (balance && balance.current_balance === 0) {
            // Check if there are transactions for this bank
            const { data: transactions } = await supabase
              .from('bank_transactions')
              .select('id')
              .eq('connected_bank_id', bank.id)
              .limit(1);

            if (transactions && transactions.length > 0) {
              console.log('Recalculating balance for Manual Upload bank:', bank.id);
              try {
                await recalculateBankBalance(bank.id);
                // Refresh the banks list to show updated balance
                window.location.reload();
              } catch (error) {
                console.error('Error recalculating balance:', error);
              }
            }
          }
        }
      }
    };

    checkAndRecalculateBalances();
  }, [connectedBanks, recalculateBankBalance]);
  
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

  // Bulk selection handlers
  const handleSelectionToggle = (id: string, event: React.MouseEvent) => {
    const modifiers = isMultiSelectKey(event);
    
    if (modifiers.isRange && lastSelectedId) {
      // Get current transactions based on active tab
      const currentTransactions = activeTab === 'for_review' 
        ? reviewTransactions 
        : activeTab === 'categorized'
        ? categorizedTransactions
        : excludedTransactions;
        
      bulkSelection.selectRange(currentTransactions, lastSelectedId, id);
    } else if (modifiers.isToggle) {
      bulkSelection.toggleItem(id);
    } else {
      bulkSelection.toggleItem(id);
    }
    
    setLastSelectedId(id);
  };

  const handleSelectAll = () => {
    const currentTransactions = activeTab === 'for_review' 
      ? reviewTransactions 
      : activeTab === 'categorized'
      ? categorizedTransactions
      : excludedTransactions;
    
    bulkSelection.selectAll(currentTransactions);
  };

  const handleBulkCategorize = (categoryId: string, overrideExisting: boolean) => {
    if (!selectedRestaurant?.restaurant_id || bulkSelection.selectedCount === 0) return;
    
    bulkCategorize.mutate({
      transactionIds: Array.from(bulkSelection.selectedIds),
      categoryId,
      restaurantId: selectedRestaurant.restaurant_id,
    }, {
      onSuccess: () => {
        setShowBulkCategorizePanel(false);
        bulkSelection.exitSelectionMode();
      },
    });
  };

  const handleBulkExclude = () => {
    if (!selectedRestaurant?.restaurant_id || bulkSelection.selectedCount === 0) return;
    
    bulkExclude.mutate({
      transactionIds: Array.from(bulkSelection.selectedIds),
      reason: 'Bulk excluded by user',
      restaurantId: selectedRestaurant.restaurant_id,
    }, {
      onSuccess: () => {
        bulkSelection.exitSelectionMode();
      },
    });
  };

  const handleBulkMarkTransfer = () => {
    if (!selectedRestaurant?.restaurant_id || bulkSelection.selectedCount === 0) return;
    
    bulkMarkTransfer.mutate({
      transactionIds: Array.from(bulkSelection.selectedIds),
      isTransfer: true,
      restaurantId: selectedRestaurant.restaurant_id,
    }, {
      onSuccess: () => {
        bulkSelection.exitSelectionMode();
      },
    });
  };

  // Exit selection mode when changing tabs
  useEffect(() => {
    bulkSelection.exitSelectionMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const activeFilterCount = Object.values(filters).filter(v => v !== undefined && v !== '').length;
  const reviewEmptyState = hasActiveFilters
    ? { title: 'No transactions match your filters', subtitle: 'Try adjusting your search or filter criteria' }
    : { title: 'No transactions to review', subtitle: 'All caught up! 🎉' };
  const categorizedEmptyState = hasActiveFilters
    ? { title: 'No transactions match your filters', subtitle: 'Try adjusting your search or filter criteria' }
    : { title: 'No categorized transactions', subtitle: 'Start categorizing transactions from the "For Review" tab' };
  const excludedEmptyState = hasActiveFilters
    ? { title: 'No transactions match your filters', subtitle: 'Try adjusting your search or filter criteria' }
    : { title: 'No excluded transactions', subtitle: 'Duplicate or personal transactions will appear here' };

  return (
    <FeatureGate featureKey="banking">
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

      <div className="w-full px-4 py-8">
        <div className="space-y-6">
          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

            <Card className="hover:shadow-lg transition-all duration-200">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <MetricIcon icon={Building2} variant="blue" />
                  <div>
                    <div className="text-3xl font-bold">{bankCount}</div>
                    <div className="text-sm text-muted-foreground">Institutions • {accountCount} account{accountCount !== 1 ? 's' : ''}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Financial Intelligence Link */}
          {connectedBanks.length > 0 && (
            <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10 hover:shadow-lg transition-all duration-300">
              <CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <MetricIcon icon={Brain} variant="purple" />
                    <div>
                      <h3 className="text-lg font-semibold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent mb-1">
                        Financial Intelligence
                      </h3>
                      <p className="text-sm text-muted-foreground max-w-lg">
                        View deep insights, cash flow analysis, spending patterns, and AI-powered predictions
                      </p>
                    </div>
                  </div>
                  <Button variant="default" asChild className="w-full sm:w-auto">
                    <Link to="/financial-intelligence">
                      View Insights
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

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
              <div className="space-y-3">
                {groupedBanks.map((bank) => (
                  <BankConnectionCard
                    key={bank.id}
                    bank={bank}
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
                    <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
                      <Filter className="h-4 w-4" />
                      <span>{activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active</span>
                      {activeCategoryName && filters.categoryId && (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <Tags className="h-3 w-3" />
                          {activeCategoryName}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-4 w-4 p-0 ml-1 hover:bg-transparent"
                            onClick={() => {
                              setFilters(prev => ({ ...prev, categoryId: undefined }));
                              setActiveCategoryName(null);
                            }}
                          >
                            <XCircle className="h-3 w-3" />
                          </Button>
                        </Badge>
                      )}
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => {
                          setFilters({});
                          setActiveCategoryName(null);
                        }}
                        className="h-7 text-xs"
                      >
                        Clear All
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList className="grid w-full grid-cols-3 sm:grid-cols-5 mb-6 h-auto">
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
            <TabsTrigger value="upload_statement" className="py-2.5">
              <Upload className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">Upload Statement</span>
              <span className="sm:hidden">Upload</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="for_review">
            <Card>
              <div className="p-6">
                {/* Select button (top right) */}
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm text-muted-foreground">
                    {reviewTransactions.length > 0 && `${reviewTransactions.length} transaction${reviewTransactions.length !== 1 ? 's' : ''}`}
                  </div>
                  {reviewTransactions.length > 0 && (
                    <Button
                      variant={bulkSelection.isSelectionMode ? "default" : "outline"}
                      size="sm"
                      onClick={bulkSelection.toggleSelectionMode}
                    >
                      {bulkSelection.isSelectionMode ? 'Done' : 'Select'}
                    </Button>
                  )}
                </div>

                {isLoadingReview ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : reviewTransactions.length > 0 ? (
                  <>
                    <div className="-mx-6">
                      <BankTransactionList 
                        transactions={reviewTransactions} 
                        status="for_review" 
                        accounts={accounts}
                        isSelectionMode={bulkSelection.isSelectionMode}
                        selectedIds={bulkSelection.selectedIds}
                        onSelectionToggle={handleSelectionToggle}
                        onSelectAll={handleSelectAll}
                        onClearSelection={bulkSelection.clearSelection}
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4">
                      <div className="text-sm text-muted-foreground">
                        Loaded {reviewTransactions.length} of {reviewCount} transactions
                      </div>
                      {hasMoreReview && (
                        <Button variant="outline" onClick={() => loadMoreReview()} disabled={loadingMoreReview}>
                          {loadingMoreReview ? "Loading..." : "Load more"}
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-lg">{reviewEmptyState.title}</p>
                    <p className="text-sm mt-2">{reviewEmptyState.subtitle}</p>
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
                ) : categorizedTransactions.length > 0 ? (
                  <>
                    <div className="-mx-6">
                      <BankTransactionList transactions={categorizedTransactions} status="categorized" accounts={accounts} />
                    </div>
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4">
                      <div className="text-sm text-muted-foreground">
                        Loaded {categorizedTransactions.length} of {categorizedCount} transactions
                      </div>
                      {hasMoreCategorized && (
                        <Button variant="outline" onClick={() => loadMoreCategorized()} disabled={loadingMoreCategorized}>
                          {loadingMoreCategorized ? "Loading..." : "Load more"}
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-lg">{categorizedEmptyState.title}</p>
                    <p className="text-sm mt-2">{categorizedEmptyState.subtitle}</p>
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
                ) : excludedTransactions.length > 0 ? (
                  <>
                    <div className="-mx-6">
                      <BankTransactionList transactions={excludedTransactions} status="excluded" accounts={accounts} />
                    </div>
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4">
                      <div className="text-sm text-muted-foreground">
                        Loaded {excludedTransactions.length} of {excludedCount} transactions
                      </div>
                      {hasMoreExcluded && (
                        <Button variant="outline" onClick={() => loadMoreExcluded()} disabled={loadingMoreExcluded}>
                          {loadingMoreExcluded ? "Loading..." : "Load more"}
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-lg">{excludedEmptyState.title}</p>
                    <p className="text-sm mt-2">{excludedEmptyState.subtitle}</p>
                  </div>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="reconciliation">
            <ReconciliationReport />
          </TabsContent>

          <TabsContent value="upload_statement">
            {!activeStatementId ? (
              <BankStatementUpload
                onStatementProcessed={(statementId) => setActiveStatementId(statementId)}
              />
            ) : (
              <div className="space-y-4">
                <Button
                  variant="outline"
                  onClick={() => setActiveStatementId(null)}
                  className="flex items-center gap-2"
                >
                  <ArrowRight className="w-4 h-4 rotate-180" />
                  Back to Upload
                </Button>
                <BankStatementReview
                  statementUploadId={activeStatementId}
                  onImportComplete={() => {
                    setActiveStatementId(null);
                    setActiveTab('for_review');
                    toast.success('Transactions imported successfully');
                  }}
                />
              </div>
            )}
          </TabsContent>
          </Tabs>
        </div>
      </div>

      {selectedRestaurant && (
        <>
          <EnhancedCategoryRulesDialog
            open={showRulesDialog}
            onOpenChange={setShowRulesDialog}
            defaultTab="bank"
          />

          <EnhancedReconciliationDialog
            isOpen={showReconciliationDialog}
            onClose={() => setShowReconciliationDialog(false)}
          />

          {/* Bulk action bar (appears when items are selected) */}
          {bulkSelection.hasSelection && (
            <BulkActionBar
              selectedCount={bulkSelection.selectedCount}
              onClose={bulkSelection.exitSelectionMode}
              actions={[
                {
                  label: 'Categorize',
                  icon: <Tags className="h-4 w-4" />,
                  onClick: () => setShowBulkCategorizePanel(true),
                },
                {
                  label: 'Mark as Transfer',
                  icon: <ArrowLeftRight className="h-4 w-4" />,
                  onClick: handleBulkMarkTransfer,
                },
                {
                  label: 'Exclude',
                  icon: <XCircle className="h-4 w-4" />,
                  onClick: handleBulkExclude,
                  variant: 'destructive',
                },
              ]}
            />
          )}

          {/* Bulk categorize panel */}
          <BulkCategorizeTransactionsPanel
            isOpen={showBulkCategorizePanel}
            onClose={() => setShowBulkCategorizePanel(false)}
            selectedCount={bulkSelection.selectedCount}
            onApply={handleBulkCategorize}
            isApplying={bulkCategorize.isPending}
          />
        </>
      )}
    </div>
    </FeatureGate>
  );
}
