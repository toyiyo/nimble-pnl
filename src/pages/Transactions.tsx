import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { MetricIcon } from '@/components/MetricIcon';
import { Receipt, Search, Download, Filter, TrendingUp, TrendingDown, Wallet, ArrowUpDown } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { TransactionFiltersSheet, type TransactionFilters } from '@/components/TransactionFilters';
import { useToast } from '@/hooks/use-toast';
import { useCategorizeTransactions } from '@/hooks/useCategorizeTransactions';
import { TransactionCard } from '@/components/banking/TransactionCard';
import { TransactionSkeleton } from '@/components/banking/TransactionSkeleton';
import { useIsMobile } from '@/hooks/use-mobile';

import { ReconciliationDialog } from '@/components/banking/ReconciliationDialog';
import { BankTransactionList } from '@/components/banking/BankTransactionList';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import { useChartOfAccounts } from '@/hooks/useChartOfAccounts';
import { useBankTransactions } from '@/hooks/useBankTransactions';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { BankTransactionSort } from '@/types/transactions';

const Transactions = () => {
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant, canCreateRestaurant } = useRestaurantContext();
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<TransactionFilters>({});
  const { toast } = useToast();
  const categorizeTransactions = useCategorizeTransactions();
  const isMobile = useIsMobile();
  const { accounts } = useChartOfAccounts(selectedRestaurant?.restaurant_id || null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  
  const [showReconciliationDialog, setShowReconciliationDialog] = useState(false);
  const { formatTransactionDate } = useDateFormat();
  const [sortBy, setSortBy] = useState<BankTransactionSort>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Fetch transactions with server-side pagination & filters
  const {
    transactions = [],
    totalCount = 0,
    isLoading,
    loadingMore,
    hasMore,
    loadMore,
    refetch,
  } = useBankTransactions(undefined, {
    searchTerm,
    filters,
    sortBy,
    sortDirection,
  });

  useEffect(() => {
    if (!isLoading && isInitialLoad) {
      setIsInitialLoad(false);
    }
  }, [isLoading, isInitialLoad]);

  const handleRestaurantSelect = (restaurant: any) => {
    setSelectedRestaurant(restaurant);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return formatTransactionDate(dateString, 'MMM dd, yyyy');
  };

  const handleCategorize = async (transactionId: string, categoryId: string) => {
    try {
      // Use the new database function that handles deduplication and reversing entries
      const { data, error } = await supabase.rpc('categorize_bank_transaction', {
        p_transaction_id: transactionId,
        p_category_id: categoryId,
        p_restaurant_id: selectedRestaurant.restaurant_id,
      });

      if (error) throw error;

      const result = data as { success: boolean; message: string };

      toast({
        title: "Transaction categorized",
        description: result?.message || "Journal entry created successfully.",
      });

      refetch();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const listStatus: 'for_review' | 'categorized' | 'excluded' = useMemo(() => {
    if (transactions.length === 0) return 'for_review';
    if (transactions.every(t => t.excluded_reason)) return 'excluded';
    if (transactions.every(t => t.is_categorized)) return 'categorized';
    return 'for_review';
  }, [transactions]);

  const totalDebits = transactions
    .filter(t => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const totalCredits = transactions
    .filter(t => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);

  if (!selectedRestaurant) {
    return (
      <div className="space-y-6">
        <div className="text-center p-8 rounded-lg bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50">
          <MetricIcon icon={Receipt} variant="blue" className="mx-auto mb-4" />
          <h2 className="text-2xl md:text-3xl font-bold mb-2">Bank Transactions</h2>
          <p className="text-sm md:text-base text-muted-foreground">
            Please select a restaurant to view transactions
          </p>
        </div>
        <RestaurantSelector 
          selectedRestaurant={selectedRestaurant}
          onSelectRestaurant={handleRestaurantSelect}
          restaurants={restaurants}
          loading={restaurantsLoading}
          canCreateRestaurant={canCreateRestaurant}
            createRestaurant={createRestaurant}
        />
      </div>
    );
  }

  const activeFilterCount = Object.values(filters).filter(v => v !== undefined && v !== '').length;
  const emptyStateMessage = activeFilterCount > 0
    ? 'No transactions match your filters. Try adjusting your filters.'
    : 'Click "Sync Transactions" on your connected banks to import transactions';

  return (
    <div className="space-y-4 md:space-y-6 w-full max-w-full overflow-x-hidden px-4 md:px-0">
      {/* Hero Section - More compact on mobile */}
      <div className="relative overflow-hidden rounded-xl md:rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 p-6 md:p-8 w-full max-w-full">
        <div className="relative z-10">
            <div className="flex items-center gap-3 md:gap-4">
            <MetricIcon icon={Receipt} variant="blue" className="hidden sm:flex" />
            <div>
              <h1 className="text-xl md:text-2xl lg:text-3xl font-bold">Bank Transactions</h1>
              <p className="text-xs md:text-sm text-muted-foreground mt-1">
                Loaded {transactions.length} of {totalCount} transactions
              </p>
            </div>
          </div>
        </div>
        <div className="absolute top-0 right-0 w-32 md:w-64 h-32 md:h-64 bg-primary/5 rounded-full blur-3xl -z-0" />
        <div className="absolute bottom-0 left-0 w-24 md:w-48 h-24 md:h-48 bg-accent/5 rounded-full blur-3xl -z-0" />
      </div>

      {/* Enhanced Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <Card className="transition-all hover:shadow-lg hover:scale-[1.02]">
          <CardContent className="pt-4 md:pt-6">
              <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl md:text-3xl font-bold">{totalCount}</div>
                <div className="text-xs md:text-sm text-muted-foreground mt-1">Total Transactions (matching filters)</div>
              </div>
              <Wallet className="h-8 w-8 md:h-10 md:w-10 text-primary/40" />
            </div>
          </CardContent>
        </Card>
        <Card className="transition-all hover:shadow-lg hover:scale-[1.02] bg-gradient-to-br from-red-500/5 to-transparent">
          <CardContent className="pt-4 md:pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl md:text-3xl font-bold text-red-500">{formatCurrency(totalDebits)}</div>
                <div className="text-xs md:text-sm text-muted-foreground mt-1">Total Debits</div>
              </div>
              <TrendingDown className="h-8 w-8 md:h-10 md:w-10 text-red-500/40" />
            </div>
          </CardContent>
        </Card>
        <Card className="transition-all hover:shadow-lg hover:scale-[1.02] bg-gradient-to-br from-green-500/5 to-transparent">
          <CardContent className="pt-4 md:pt-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-2xl md:text-3xl font-bold text-green-500">{formatCurrency(totalCredits)}</div>
                <div className="text-xs md:text-sm text-muted-foreground mt-1">Total Credits</div>
              </div>
              <TrendingUp className="h-8 w-8 md:h-10 md:w-10 text-green-500/40" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Actions - Optimized for mobile */}
      <Card>
        <CardContent className="pt-4 md:pt-6">
          <div className="flex flex-col gap-3 md:gap-4">
            {/* Search Bar and Sort Controls */}
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
                <Select value={sortBy} onValueChange={(value: BankTransactionSort) => setSortBy(value)}>
                  <SelectTrigger className="w-[160px] border-border/50 hover:border-primary/50 transition-colors h-11">
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
                  className="transition-all hover:scale-105 duration-200 h-11 w-11"
                  title={sortDirection === 'desc' ? 'Descending order' : 'Ascending order'}
                >
                  <ArrowUpDown className={`w-4 h-4 transition-transform ${sortDirection === 'asc' ? 'rotate-180' : ''}`} />
                </Button>
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
              <Button
                variant="secondary"
                onClick={() => categorizeTransactions.mutate(selectedRestaurant.restaurant_id)}
                disabled={categorizeTransactions.isPending}
                className="w-full md:w-auto h-11"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                {categorizeTransactions.isPending ? 'AI Categorizing...' : isMobile ? 'AI Categorize' : 'AI Categorize All'}
              </Button>
              <div className="relative w-full md:w-auto">
                <TransactionFiltersSheet 
                  restaurantId={selectedRestaurant.restaurant_id}
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
              
              
              <Button
                variant="outline" 
                className="w-full md:w-auto h-11 gap-2"
                onClick={() => setShowReconciliationDialog(true)}
              >
                <CheckCircle2 className="h-4 w-4" />
                {!isMobile && <span>Reconcile</span>}
              </Button>
              
              <Button
                variant="outline" 
                className="col-span-2 md:col-span-1 md:w-auto h-11 gap-2"
                title={isMobile ? "Export to CSV" : "Export"}
                onClick={() => {
                  if (transactions.length === 0) {
                    toast({
                      title: "No transactions to export",
                      description: "There are no transactions matching your filters.",
                      variant: "destructive",
                    });
                    return;
                  }
                  
                  // Create CSV content
                  const headers = ['Date', 'Description', 'Merchant', 'Bank', 'Amount', 'Status', 'Category'];
                  const rows = transactions.map(txn => [
                    formatDate(txn.transaction_date),
                    txn.description || '',
                    txn.merchant_name || '',
                    txn.connected_bank?.institution_name || '',
                    txn.amount.toString(),
                    txn.status,
                    txn.chart_account?.account_name || 'Uncategorized'
                  ]);
                  
                  const csv = [
                    headers.join(','),
                    ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
                  ].join('\n');
                  
                  // Download CSV
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `transactions-${new Date().toISOString().split('T')[0]}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  window.URL.revokeObjectURL(url);
                  
                  toast({
                    title: "Export successful",
                    description: `Exported ${transactions.length} transactions to CSV.`,
                  });
                }}
              >
                <Download className="h-4 w-4" />
                {!isMobile && <span className="ml-2">Export</span>}
              </Button>
            </div>

            {/* Active Filters Indicator */}
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
                  Clear all
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Transactions - Mobile Card View / Desktop Table */}
      {isLoading || isInitialLoad ? (
        <div className="space-y-3">
          <TransactionSkeleton />
          <TransactionSkeleton />
          <TransactionSkeleton />
        </div>
      ) : transactions.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center p-8 md:p-12">
              <MetricIcon icon={Receipt} variant="blue" className="mx-auto mb-4" />
              <h3 className="text-base md:text-lg font-semibold mb-2">No Transactions Yet</h3>
              <p className="text-xs md:text-sm text-muted-foreground mb-6">
                {emptyStateMessage}
              </p>
              <Button onClick={() => window.location.href = '/banking'}>
                Go to Banking
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : isMobile ? (
        // Mobile Card View - Properly constrained
        <div className="space-y-3 w-full max-w-full overflow-x-hidden">
          {transactions.map((txn) => (
            <TransactionCard
              key={txn.id}
              transaction={txn}
              onCategorize={handleCategorize}
              restaurantId={selectedRestaurant.restaurant_id}
              formatDate={formatDate}
              formatCurrency={formatCurrency}
            />
          ))}
        </div>
      ) : (
        // Desktop Table View - Use BankTransactionList for full functionality
        <Card className="w-full max-w-full overflow-hidden">
          <CardContent className="p-0 w-full max-w-full">
            <BankTransactionList 
              transactions={transactions as any} 
              status={listStatus} 
              accounts={accounts}
            />
          </CardContent>
        </Card>
      )}
      
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => loadMore()} disabled={loadingMore}>
            {loadingMore ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
      
      <ReconciliationDialog
        isOpen={showReconciliationDialog}
        onClose={() => setShowReconciliationDialog(false)}
      />
    </div>
  );
};

export default Transactions;
