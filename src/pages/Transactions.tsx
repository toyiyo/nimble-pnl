import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { MetricIcon } from '@/components/MetricIcon';
import { Receipt, Search, Download, Building2, Filter, TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { TransactionFiltersSheet, type TransactionFilters } from '@/components/TransactionFilters';
import { useToast } from '@/hooks/use-toast';
import { CategorySelector } from '@/components/CategorySelector';
import { useCategorizeTransactions } from '@/hooks/useCategorizeTransactions';
import { TransactionCard } from '@/components/banking/TransactionCard';
import { TransactionSkeleton, TransactionTableSkeleton } from '@/components/banking/TransactionSkeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { CategoryRulesDialog } from '@/components/banking/CategoryRulesDialog';
import { ReconciliationDialog } from '@/components/banking/ReconciliationDialog';
import { BankTransactionList } from '@/components/banking/BankTransactionList';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import { useChartOfAccounts } from '@/hooks/useChartOfAccounts';

const Transactions = () => {
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<TransactionFilters>({});
  const { toast } = useToast();
  const categorizeTransactions = useCategorizeTransactions();
  const isMobile = useIsMobile();
  const { accounts } = useChartOfAccounts(selectedRestaurant?.restaurant_id || null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showRulesDialog, setShowRulesDialog] = useState(false);
  const [showReconciliationDialog, setShowReconciliationDialog] = useState(false);

  // Fetch transactions
  const { data: transactions, isLoading, refetch } = useQuery({
    queryKey: ['bank-transactions', selectedRestaurant?.restaurant_id],
    queryFn: async () => {
      if (!selectedRestaurant) return [];

      const { data, error } = await supabase
        .from('bank_transactions')
        .select(`
          *,
          connected_bank:connected_banks!inner(
            id,
            institution_name,
            bank_account_balances(id, account_mask, account_name)
          ),
          chart_account:chart_of_accounts!category_id(
            account_name
          )
        `)
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .order('transaction_date', { ascending: false })
        .limit(1000);

      if (error) throw error;
      setIsInitialLoad(false);
      return data || [];
    },
    enabled: !!selectedRestaurant,
  });

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
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
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

  const filteredTransactions = transactions?.filter(txn => {
    // Search filter
    const matchesSearch = !searchTerm || 
      txn.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      txn.merchant_name?.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Date filters
    const matchesDateFrom = !filters.dateFrom || new Date(txn.transaction_date) >= new Date(filters.dateFrom);
    const matchesDateTo = !filters.dateTo || new Date(txn.transaction_date) <= new Date(filters.dateTo);
    
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
  }) || [];

  const totalDebits = filteredTransactions
    .filter(t => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const totalCredits = filteredTransactions
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
          createRestaurant={createRestaurant}
        />
      </div>
    );
  }

  const activeFilterCount = Object.values(filters).filter(v => v !== undefined && v !== '').length;

  return (
    <div className="space-y-4 md:space-y-6 overflow-x-hidden">
      {/* Hero Section - More compact on mobile */}
      <div className="relative overflow-hidden rounded-xl md:rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 p-6 md:p-8">
        <div className="relative z-10">
          <div className="flex items-center gap-3 md:gap-4">
            <MetricIcon icon={Receipt} variant="blue" className="hidden sm:flex" />
            <div>
              <h1 className="text-xl md:text-2xl lg:text-3xl font-bold">Bank Transactions</h1>
              <p className="text-xs md:text-sm text-muted-foreground mt-1">
                View and categorize your bank transactions
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
                <div className="text-2xl md:text-3xl font-bold">{filteredTransactions.length}</div>
                <div className="text-xs md:text-sm text-muted-foreground mt-1">Total Transactions</div>
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
            {/* Search Bar */}
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search transactions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-11"
              />
            </div>
            
            {/* Action Buttons */}
            <div className="grid grid-cols-2 md:flex gap-2">
              <Button
                variant="secondary"
                onClick={() => categorizeTransactions.mutate(selectedRestaurant.restaurant_id)}
                disabled={categorizeTransactions.isPending}
                className="w-full md:w-auto h-11"
              >
                {categorizeTransactions.isPending ? 'Categorizing...' : isMobile ? 'Auto-Categorize' : 'Categorize All'}
              </Button>
              <div className="relative">
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
                className="h-11 gap-2"
                onClick={() => setShowRulesDialog(true)}
              >
                <Sparkles className="h-4 w-4" />
                {!isMobile && <span>Rules</span>}
              </Button>
              
              <Button
                variant="outline" 
                className="h-11 gap-2"
                onClick={() => setShowReconciliationDialog(true)}
              >
                <CheckCircle2 className="h-4 w-4" />
                {!isMobile && <span>Reconcile</span>}
              </Button>
              
              <Button
                variant="outline" 
                className="h-11"
                title={isMobile ? "Export to CSV" : "Export"}
                onClick={() => {
                  if (filteredTransactions.length === 0) {
                    toast({
                      title: "No transactions to export",
                      description: "There are no transactions matching your filters.",
                      variant: "destructive",
                    });
                    return;
                  }
                  
                  // Create CSV content
                  const headers = ['Date', 'Description', 'Merchant', 'Bank', 'Amount', 'Status', 'Category'];
                  const rows = filteredTransactions.map(txn => [
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
                    description: `Exported ${filteredTransactions.length} transactions to CSV.`,
                  });
                }}
              >
                <Download className="h-4 w-4" />
                {!isMobile && <span>Export</span>}
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
      ) : filteredTransactions.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center p-8 md:p-12">
              <MetricIcon icon={Receipt} variant="blue" className="mx-auto mb-4" />
              <h3 className="text-base md:text-lg font-semibold mb-2">No Transactions Yet</h3>
              <p className="text-xs md:text-sm text-muted-foreground mb-6">
                {activeFilterCount > 0 
                  ? 'No transactions match your filters. Try adjusting your filters.'
                  : 'Click "Sync Transactions" on your connected banks to import transactions'
                }
              </p>
              <Button onClick={() => window.location.href = '/accounting'}>
                Go to Accounting
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : isMobile ? (
        // Mobile Card View
        <div className="space-y-3">
          {filteredTransactions.map((txn) => (
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
        <Card>
          <div className="p-6">
            <div className="-mx-6">
              <BankTransactionList 
                transactions={filteredTransactions as any} 
                status={filteredTransactions.every(t => t.is_categorized) ? 'categorized' : 'for_review'} 
                accounts={accounts}
              />
            </div>
          </div>
        </Card>
      )}
      
      <CategoryRulesDialog
        isOpen={showRulesDialog}
        onClose={() => setShowRulesDialog(false)}
      />
      
      <ReconciliationDialog
        isOpen={showReconciliationDialog}
        onClose={() => setShowReconciliationDialog(false)}
      />
    </div>
  );
};

export default Transactions;
