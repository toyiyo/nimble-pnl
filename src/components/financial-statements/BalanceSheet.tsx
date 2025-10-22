import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { ExportDropdown } from './shared/ExportDropdown';
import { generateFinancialReportPDF, generateStandardFilename } from '@/utils/pdfExport';

interface BalanceSheetProps {
  restaurantId: string;
  asOfDate: Date;
}

export function BalanceSheet({ restaurantId, asOfDate }: BalanceSheetProps) {
  const { toast } = useToast();

  // Fetch restaurant name for exports
  const { data: restaurant } = useQuery({
    queryKey: ['restaurant', restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('restaurants')
        .select('name')
        .eq('id', restaurantId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!restaurantId,
  });

  const { data: balanceData, isLoading } = useQuery({
    queryKey: ['balance-sheet', restaurantId, asOfDate],
    queryFn: async () => {
      // Fetch all chart of accounts for balance sheet categories
      const { data: accounts, error: accountsError } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type, normal_balance')
        .eq('restaurant_id', restaurantId)
        .in('account_type', ['asset', 'liability', 'equity'])
        .eq('is_active', true)
        .order('account_code');

      if (accountsError) throw accountsError;

      // Compute balance for each account from journal entries
      const accountsWithBalances = await Promise.all(
        (accounts || []).map(async (account) => {
          const { data: balance, error: balanceError } = await supabase.rpc(
            'compute_account_balance',
            {
              p_account_id: account.id,
              p_as_of_date: format(asOfDate, 'yyyy-MM-dd'),
            }
          );

          if (balanceError) {
            console.error('Error computing balance:', balanceError);
            return { ...account, current_balance: 0 };
          }

          return { ...account, current_balance: balance || 0 };
        })
      );

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

  const handleExportCSV = () => {
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
    const filename = generateStandardFilename(
      'balance-sheet',
      restaurant?.name || 'restaurant',
      undefined,
      undefined,
      asOfDate
    );
    a.href = url;
    a.download = `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    toast({
      title: 'Export successful',
      description: 'Balance sheet exported to CSV',
    });
  };

  const handleExportPDF = () => {
    const data = [
      { label: 'ASSETS', amount: undefined, isBold: true },
      ...balanceData!.assets.map(acc => ({
        label: `${acc.account_code} - ${acc.account_name}`,
        amount: acc.current_balance,
        indent: 1,
      })),
      { label: 'Total Assets', amount: totalAssets, isTotal: true },
      { label: '', amount: undefined },
      { label: 'LIABILITIES', amount: undefined, isBold: true },
      ...balanceData!.liabilities.map(acc => ({
        label: `${acc.account_code} - ${acc.account_name}`,
        amount: Math.abs(acc.current_balance),
        indent: 1,
      })),
      { label: 'Total Liabilities', amount: totalLiabilities, isSubtotal: true },
      { label: '', amount: undefined },
      { label: 'EQUITY', amount: undefined, isBold: true },
      ...balanceData!.equity.map(acc => ({
        label: `${acc.account_code} - ${acc.account_name}`,
        amount: Math.abs(acc.current_balance),
        indent: 1,
      })),
      { label: 'Total Equity', amount: totalEquity, isSubtotal: true },
      { label: '', amount: undefined },
      { label: 'Total Liabilities & Equity', amount: totalLiabilitiesAndEquity, isTotal: true },
    ];

    const filename = generateStandardFilename(
      'balance-sheet',
      restaurant?.name || 'restaurant',
      undefined,
      undefined,
      asOfDate
    );

    generateFinancialReportPDF({
      title: 'Balance Sheet',
      restaurantName: restaurant?.name || 'Restaurant',
      asOfDate: `As of ${format(asOfDate, 'MMM dd, yyyy')}`,
      data,
      filename: `${filename}.pdf`,
    });

    toast({
      title: 'Export successful',
      description: 'Balance sheet exported to PDF',
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
          <ExportDropdown onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} />
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
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm font-medium text-destructive">
                ⚠️ Balance Sheet doesn't balance! Difference: {formatCurrency(totalAssets - totalLiabilitiesAndEquity)}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}