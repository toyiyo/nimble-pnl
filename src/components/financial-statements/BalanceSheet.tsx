import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { ExportDropdown } from './shared/ExportDropdown';
import { generateFinancialReportPDF, generateStandardFilename } from '@/utils/pdfExport';
import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface BalanceSheetProps {
  restaurantId: string;
  asOfDate: Date;
}

interface JournalEntryLine {
  account_id: string;
  debit_amount: number | null;
  credit_amount: number | null;
  journal_entry: {
    entry_date: string;
    restaurant_id: string;
  };
}

export function BalanceSheet({ restaurantId, asOfDate }: BalanceSheetProps) {
  const { toast } = useToast();
  const [glOnly, setGlOnly] = useState(false);

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
    queryKey: ['balance-sheet', restaurantId, asOfDate, glOnly],
    queryFn: async () => {
      const asOfStr = format(asOfDate, 'yyyy-MM-dd');

      // Fetch all chart of accounts needed for BS + P&L linkage
      const { data: accounts, error: accountsError } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type, normal_balance')
        .eq('restaurant_id', restaurantId)
        .in('account_type', ['asset', 'liability', 'equity', 'revenue', 'expense', 'cogs'])
        .eq('is_active', true)
        .order('account_code');

      if (accountsError) throw accountsError;

      type JournalEntryLine = {
        account_id: string;
        debit_amount: number | null;
        credit_amount: number | null;
        journal_entry: {
          entry_date: string;
          restaurant_id: string;
        };
      };

      // Pull journal lines once up to asOf
      const { data: journalLines, error: journalError } = await supabase
        .from('journal_entry_lines')
        .select(`
          account_id,
          debit_amount,
          credit_amount,
          journal_entry:journal_entries!inner(entry_date, restaurant_id)
        `)
        .lte('journal_entry.entry_date', asOfStr)
        .eq('journal_entry.restaurant_id', restaurantId);

      if (journalError) throw journalError;

      const accountBalances = new Map<string, { debits: number; credits: number }>();
      journalLines?.forEach((line: JournalEntryLine) => {
        const current = accountBalances.get(line.account_id) || { debits: 0, credits: 0 };
        accountBalances.set(line.account_id, {
          debits: current.debits + (line.debit_amount || 0),
          credits: current.credits + (line.credit_amount || 0),
        });
      });

      let accountsWithBalances =
        accounts?.map(account => {
          const balance = accountBalances.get(account.id) || { debits: 0, credits: 0 };
          let amount = 0;

          if (account.account_type === 'asset') {
            amount = balance.debits - balance.credits;
          } else if (['liability', 'equity', 'revenue'].includes(account.account_type)) {
            amount = balance.credits - balance.debits;
          } else {
            // expense and cogs
            amount = balance.debits - balance.credits;
          }

          return {
            ...account,
            current_balance: amount,
          };
        }) || [];

      // Inventory usage fallback for accrual: if no COGS journaled, reduce assets by usage
      const totalJournalCOGS = accountsWithBalances
        .filter(a => a.account_type === 'cogs')
        .reduce((sum, acc) => sum + acc.current_balance, 0);

      let inventoryUsageTotal = 0;
      if (!glOnly && totalJournalCOGS === 0) {
        // Aggregate in-database to avoid Supabase row limits
        const { data: usageAgg, error: usageError } = await supabase
          .from('inventory_transactions')
          .select('sum:sum(total_cost)')
          .eq('restaurant_id', restaurantId)
          .eq('transaction_type', 'usage')
          .or(
            `transaction_date.lte.${asOfStr},and(transaction_date.is.null,created_at.lte.${asOfStr}T23:59:59.999Z)`
          )
          .maybeSingle();

        if (usageError) {
          if (import.meta.env.DEV) {
            console.warn('Failed to fetch inventory usage for BS:', usageError);
          }
        } else {
          inventoryUsageTotal = Math.abs(Number(usageAgg?.sum) || 0);
        }
      }

      if (inventoryUsageTotal > 0) {
        accountsWithBalances = [
          ...accountsWithBalances,
          {
            id: 'inventory-usage-adjustment',
            account_code: 'INV-ADJ',
            account_name: 'Inventory Usage Adjustment (unposted)',
            account_type: 'asset',
            normal_balance: 'debit',
            current_balance: -inventoryUsageTotal,
            is_inventory_usage: true,
          },
        ];
      }

      // Payroll expense/liability fallback (hourly punches + salary/contractor allocations) when no payroll JEs exist
      const payrollExpenseJE = accountsWithBalances
        .filter(a =>
          a.account_type === 'expense' &&
          ((a as any).account_subtype === 'payroll' ||
            (a.account_name || '').toLowerCase().includes('payroll'))
        )
        .reduce((sum, acc) => sum + acc.current_balance, 0);

      let payrollFallbackTotal = 0;
      if (!glOnly && payrollExpenseJE === 0) {
        const { data: hourlyAgg, error: hourlyErr } = await supabase
          .from('daily_labor_costs')
          .select('sum:sum(total_labor_cost)')
          .eq('restaurant_id', restaurantId)
          .lte('date', asOfStr)
          .maybeSingle();

        if (hourlyErr) {
          console.warn('Failed to fetch hourly labor costs for BS:', hourlyErr);
        }

        const { data: allocationAgg, error: allocErr } = await supabase
          .from('daily_labor_allocations')
          .select('sum:sum(allocated_cost)')
          .eq('restaurant_id', restaurantId)
          .lte('date', asOfStr)
          .maybeSingle();

        if (allocErr) {
          console.warn('Failed to fetch salary/contractor allocations for BS:', allocErr);
        }

        payrollFallbackTotal =
          Math.abs(Number(hourlyAgg?.sum) || 0) + Math.abs(Number(allocationAgg?.sum) || 0);

        if (payrollFallbackTotal > 0) {
          accountsWithBalances = [
            ...accountsWithBalances,
            {
              id: 'payroll-expense-fallback',
              account_code: 'PAYROLL-EXP',
              account_name: 'Payroll Expense (unposted)',
              account_type: 'expense',
              normal_balance: 'debit',
              current_balance: payrollFallbackTotal,
              is_payroll_fallback: true,
            },
            {
              id: 'payroll-liability-fallback',
              account_code: 'PAYROLL-LIAB',
              account_name: 'Payroll Accrual (unposted)',
              account_type: 'liability',
              normal_balance: 'credit',
              current_balance: payrollFallbackTotal,
              is_payroll_fallback: true,
            },
          ];
        }
      }

      // Net income roll-up into equity (accrual)
      if (glOnly) {
        accountsWithBalances = accountsWithBalances.filter(
          acc => !acc.is_inventory_usage && !acc.is_payroll_fallback
        );
      }

      const totalRevenue = accountsWithBalances
        .filter(a => a.account_type === 'revenue')
        .reduce((sum, acc) => sum + acc.current_balance, 0);

      // Treat COGS as a positive expense: sum journaled COGS (may be negative credits) and inventory usage,
      // then take the absolute to get a positive expense figure.
      const totalCOGS = Math.abs(totalJournalCOGS + inventoryUsageTotal);

      const totalExpenses = accountsWithBalances
        .filter(a => a.account_type === 'expense')
        .reduce((sum, acc) => sum + acc.current_balance, 0);

      const netIncome = totalRevenue - totalCOGS - totalExpenses;

      const equityWithNet = [
        ...accountsWithBalances.filter(a => a.account_type === 'equity'),
        {
          id: 'net-income',
          account_code: 'NI',
          account_name: 'Current Period Net Income',
          account_type: 'equity',
          normal_balance: 'credit',
          current_balance: netIncome,
          is_net_income: true,
        },
      ];

      return {
        assets: accountsWithBalances.filter(a => a.account_type === 'asset'),
        liabilities: accountsWithBalances.filter(a => a.account_type === 'liability'),
        equity: equityWithNet,
      };
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
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
  const totalLiabilities = balanceData?.liabilities.reduce((sum, acc) => sum + acc.current_balance, 0) || 0;
  const totalEquity = balanceData?.equity.reduce((sum, acc) => sum + acc.current_balance, 0) || 0;
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
      ...balanceData!.liabilities.map(acc => [acc.account_code, acc.account_name, Math.abs(acc.current_balance)]),
      ['', 'Total Liabilities', totalLiabilities],
      [''],
      ['EQUITY'],
      ...balanceData!.equity.map(acc => [acc.account_code, acc.account_name, Math.abs(acc.current_balance)]),
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
          <div className="flex items-center gap-4">
            <div className="flex items-center space-x-2">
              <Switch id="bs-gl-only" checked={glOnly} onCheckedChange={setGlOnly} />
              <Label htmlFor="bs-gl-only">GL-only (no unposted accruals)</Label>
            </div>
            <ExportDropdown onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} />
          </div>
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
