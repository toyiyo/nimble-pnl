import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface BalanceSheetProps {
  restaurantId: string;
  asOfDate: Date;
}

export function BalanceSheet({ restaurantId, asOfDate }: BalanceSheetProps) {
  const { toast } = useToast();

  const { data: balanceData, isLoading } = useQuery({
    queryKey: ['balance-sheet', restaurantId, asOfDate],
    queryFn: async () => {
      // Fetch all chart of accounts for balance sheet categories with their current balances
      const { data: accounts, error: accountsError } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type, current_balance')
        .eq('restaurant_id', restaurantId)
        .in('account_type', ['asset', 'liability', 'equity'])
        .eq('is_active', true)
        .order('account_code');

      if (accountsError) throw accountsError;

      // The current_balance field already contains the account balance
      // updated from journal entries
      const accountsWithBalances = accounts || [];

      return {
        assets: accountsWithBalances.filter(a => a.account_type === 'asset'),
        liabilities: accountsWithBalances.filter(a => a.account_type === 'liability'),
        equity: accountsWithBalances.filter(a => a.account_type === 'equity'),
      };
    },
    enabled: !!restaurantId,
  });

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  // For balance sheet display: 
  // - Assets (debit normal) show as-is
  // - Liabilities (credit normal) show absolute value 
  // - Equity (credit normal) show absolute value
  const totalAssets = balanceData?.assets.reduce((sum, acc) => sum + acc.current_balance, 0) || 0;
  const totalLiabilities = balanceData?.liabilities.reduce((sum, acc) => sum + Math.abs(acc.current_balance), 0) || 0;
  const totalEquity = balanceData?.equity.reduce((sum, acc) => sum + Math.abs(acc.current_balance), 0) || 0;
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;

  const handleExport = () => {
    const csvContent = [
      ['Balance Sheet'],
      [`As of: ${format(asOfDate, 'MMM dd, yyyy')}`],
      [''],
      ['ASSETS'],
      ...balanceData!.assets.map(acc => [acc.account_code, acc.account_name, acc.current_balance]),
      ['', 'Total Assets', totalAssets],
      [''],
      ['LIABILITIES'],
      ...balanceData!.liabilities.map(acc => [acc.account_code, acc.account_name, acc.current_balance]),
      ['', 'Total Liabilities', totalLiabilities],
      [''],
      ['EQUITY'],
      ...balanceData!.equity.map(acc => [acc.account_code, acc.account_name, acc.current_balance]),
      ['', 'Total Equity', totalEquity],
      [''],
      ['', 'Total Liabilities & Equity', totalLiabilitiesAndEquity],
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `balance-sheet-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    toast({
      title: 'Export successful',
      description: 'Balance sheet exported to CSV',
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Balance Sheet</CardTitle>
            <CardDescription>As of {format(asOfDate, 'MMM dd, yyyy')}</CardDescription>
          </div>
          <Button onClick={handleExport} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Assets */}
          <div>
            <h3 className="font-semibold text-lg mb-3">ASSETS</h3>
            <div className="space-y-2">
              {balanceData?.assets.map((account) => (
                <div key={account.id} className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-muted/50">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-muted-foreground">{account.account_code}</span>
                    <span>{account.account_name}</span>
                  </div>
                  <span className="font-medium">{formatCurrency(account.current_balance)}</span>
                </div>
              ))}
              <div className="flex justify-between items-center py-2 px-3 border-t font-semibold">
                <span>Total Assets</span>
                <span>{formatCurrency(totalAssets)}</span>
              </div>
            </div>
          </div>

          {/* Liabilities */}
          <div>
            <h3 className="font-semibold text-lg mb-3">LIABILITIES</h3>
            <div className="space-y-2">
              {balanceData?.liabilities.map((account) => (
                <div key={account.id} className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-muted/50">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-muted-foreground">{account.account_code}</span>
                    <span>{account.account_name}</span>
                  </div>
                  <span className="font-medium">{formatCurrency(Math.abs(account.current_balance))}</span>
                </div>
              ))}
              <div className="flex justify-between items-center py-2 px-3 border-t font-semibold">
                <span>Total Liabilities</span>
                <span>{formatCurrency(totalLiabilities)}</span>
              </div>
            </div>
          </div>

          {/* Equity */}
          <div>
            <h3 className="font-semibold text-lg mb-3">EQUITY</h3>
            <div className="space-y-2">
              {balanceData?.equity.map((account) => (
                <div key={account.id} className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-muted/50">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-muted-foreground">{account.account_code}</span>
                    <span>{account.account_name}</span>
                  </div>
                  <span className="font-medium">{formatCurrency(Math.abs(account.current_balance))}</span>
                </div>
              ))}
              <div className="flex justify-between items-center py-2 px-3 border-t font-semibold">
                <span>Total Equity</span>
                <span>{formatCurrency(totalEquity)}</span>
              </div>
            </div>
          </div>

          {/* Total Liabilities & Equity */}
          <div className="flex justify-between items-center py-4 px-3 bg-primary/10 border border-primary/20 rounded-lg font-bold text-xl">
            <span>Total Liabilities & Equity</span>
            <span>{formatCurrency(totalLiabilitiesAndEquity)}</span>
          </div>

          {/* Balance Check */}
          {Math.abs(totalAssets - totalLiabilitiesAndEquity) > 0.01 && (
            <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm font-medium text-red-800 dark:text-red-200">
                ⚠️ Balance Sheet doesn't balance! Difference: {formatCurrency(totalAssets - totalLiabilitiesAndEquity)}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}