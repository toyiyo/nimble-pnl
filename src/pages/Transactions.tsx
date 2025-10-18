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
import { Receipt, Search, Download, Building2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { TransactionFiltersSheet, type TransactionFilters } from '@/components/TransactionFilters';
import { useToast } from '@/hooks/use-toast';

const Transactions = () => {
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<TransactionFilters>({});
  const { toast } = useToast();

  // Fetch transactions
  const { data: transactions, isLoading, refetch } = useQuery({
    queryKey: ['bank-transactions', selectedRestaurant?.restaurant_id],
    queryFn: async () => {
      if (!selectedRestaurant) return [];

      const { data, error } = await supabase
        .from('bank_transactions')
        .select(`
          *,
          connected_bank:connected_banks(
            institution_name,
            bank_account_balances(account_mask)
          ),
          chart_account:chart_of_accounts(
            account_name
          )
        `)
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .order('transaction_date', { ascending: false })
        .limit(100);

      if (error) throw error;
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
    
    return matchesSearch && matchesDateFrom && matchesDateTo && 
           matchesMinAmount && matchesMaxAmount && matchesStatus && matchesType;
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

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 p-8">
        <div className="relative z-10">
          <div className="flex items-center gap-4">
            <MetricIcon icon={Receipt} variant="blue" />
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">Bank Transactions</h1>
              <p className="text-sm md:text-base text-muted-foreground mt-1">
                View and categorize your bank transactions
              </p>
            </div>
          </div>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -z-0" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-accent/5 rounded-full blur-3xl -z-0" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{filteredTransactions.length}</div>
            <div className="text-sm text-muted-foreground">Total Transactions</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-red-500">{formatCurrency(totalDebits)}</div>
            <div className="text-sm text-muted-foreground">Total Debits</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-500">{formatCurrency(totalCredits)}</div>
            <div className="text-sm text-muted-foreground">Total Credits</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Actions */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative flex-1 w-full md:w-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search transactions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2 w-full md:w-auto">
              <TransactionFiltersSheet filters={filters} onFiltersChange={setFilters} />
              <Button 
                variant="outline" 
                className="gap-2"
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
                Export
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transactions Table */}
      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="text-center p-8 text-muted-foreground">
              Loading transactions...
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center p-12">
              <MetricIcon icon={Receipt} variant="blue" className="mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Transactions Yet</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Click "Sync Transactions" on your connected banks to import transactions
              </p>
              <Button onClick={() => window.location.href = '/accounting'}>
                Go to Accounting
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Bank Account</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTransactions.map((txn) => (
                    <TableRow key={txn.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell className="font-medium">
                        {formatDate(txn.transaction_date)}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{txn.merchant_name || txn.description}</div>
                          {txn.merchant_name && txn.description !== txn.merchant_name && (
                            <div className="text-xs text-muted-foreground">{txn.description}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div>{txn.connected_bank?.institution_name}</div>
                            {txn.connected_bank?.bank_account_balances?.[0]?.account_mask && (
                              <div className="text-xs text-muted-foreground">
                                ••••{txn.connected_bank.bank_account_balances[0].account_mask}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {txn.chart_account ? (
                          <Badge variant="outline">
                            {txn.chart_account.account_name}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Uncategorized</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cn(
                          "font-medium",
                          txn.amount < 0 ? "text-red-500" : "text-green-500"
                        )}>
                          {formatCurrency(txn.amount)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={txn.status === 'posted' ? 'default' : 'secondary'}>
                          {txn.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Transactions;
