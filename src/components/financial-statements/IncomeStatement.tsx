import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { ExportDropdown } from './shared/ExportDropdown';
import { generateFinancialReportPDF, generateStandardFilename } from '@/utils/pdfExport';

interface IncomeStatementProps {
  restaurantId: string;
  dateFrom: Date;
  dateTo: Date;
}

export function IncomeStatement({ restaurantId, dateFrom, dateTo }: IncomeStatementProps) {
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

  const { data: incomeData, isLoading } = useQuery({
    queryKey: ['income-statement', restaurantId, dateFrom, dateTo],
    queryFn: async () => {
      // Fetch all chart of accounts for this restaurant
      const { data: accounts, error: accountsError } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type, normal_balance')
        .eq('restaurant_id', restaurantId)
        .in('account_type', ['revenue', 'expense', 'cogs'])
        .eq('is_active', true)
        .order('account_code');

      if (accountsError) throw accountsError;

      // Fetch journal entry lines for the date range
      const { data: journalLines, error: journalError } = await supabase
        .from('journal_entry_lines')
        .select(`
          account_id,
          debit_amount,
          credit_amount,
          journal_entry:journal_entries!inner(
            entry_date,
            restaurant_id
          )
        `)
        .gte('journal_entry.entry_date', dateFrom.toISOString().split('T')[0])
        .lte('journal_entry.entry_date', dateTo.toISOString().split('T')[0])
        .eq('journal_entry.restaurant_id', restaurantId);

      if (journalError) throw journalError;

      // Calculate balances by account
      const accountBalances = new Map<string, { debits: number; credits: number }>();
      
      journalLines?.forEach((line: any) => {
        const current = accountBalances.get(line.account_id) || { debits: 0, credits: 0 };
        accountBalances.set(line.account_id, {
          debits: current.debits + (line.debit_amount || 0),
          credits: current.credits + (line.credit_amount || 0),
        });
      });

      // Map accounts with their calculated balances
      // Revenue accounts: credits increase, debits decrease (normal balance = credit)
      // Expense/COGS accounts: debits increase, credits decrease (normal balance = debit)
      const accountsWithBalances = accounts?.map(account => {
        const balance = accountBalances.get(account.id) || { debits: 0, credits: 0 };
        let amount = 0;
        
        if (account.account_type === 'revenue') {
          // Revenue: credits - debits (show as positive)
          amount = balance.credits - balance.debits;
        } else {
          // Expenses/COGS: debits - credits (show as positive)
          amount = balance.debits - balance.credits;
        }
        
        return {
          ...account,
          current_balance: amount,
        };
      }) || [];

      return {
        revenue: accountsWithBalances.filter(a => a.account_type === 'revenue'),
        expenses: accountsWithBalances.filter(a => a.account_type === 'expense'),
        cogs: accountsWithBalances.filter(a => a.account_type === 'cogs'),
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

  const totalRevenue = incomeData?.revenue.reduce((sum, acc) => sum + acc.current_balance, 0) || 0;
  const totalCOGS = incomeData?.cogs.reduce((sum, acc) => sum + acc.current_balance, 0) || 0;
  const totalExpenses = incomeData?.expenses.reduce((sum, acc) => sum + acc.current_balance, 0) || 0;
  const grossProfit = totalRevenue - totalCOGS;
  const netIncome = grossProfit - totalExpenses;

  const handleExportCSV = () => {
    const csvContent = [
      ['Income Statement'],
      [`Period: ${format(dateFrom, 'MMM dd, yyyy')} - ${format(dateTo, 'MMM dd, yyyy')}`],
      [''],
      ['Revenue'],
      ...incomeData!.revenue.map(acc => [acc.account_code, acc.account_name, acc.current_balance]),
      ['', 'Total Revenue', totalRevenue],
      [''],
      ['Cost of Goods Sold'],
      ...incomeData!.cogs.map(acc => [acc.account_code, acc.account_name, acc.current_balance]),
      ['', 'Total COGS', totalCOGS],
      [''],
      ['', 'Gross Profit', grossProfit],
      [''],
      ['Operating Expenses'],
      ...incomeData!.expenses.map(acc => [acc.account_code, acc.account_name, acc.current_balance]),
      ['', 'Total Expenses', totalExpenses],
      [''],
      ['', 'Net Income', netIncome],
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const filename = generateStandardFilename(
      'income-statement',
      restaurant?.name || 'restaurant',
      dateFrom,
      dateTo
    );
    a.href = url;
    a.download = `${filename}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    toast({
      title: 'Export successful',
      description: 'Income statement exported to CSV',
    });
  };

  const handleExportPDF = () => {
    const data = [
      ...incomeData!.revenue.map(acc => ({
        label: `${acc.account_code} - ${acc.account_name}`,
        amount: acc.current_balance,
        indent: 1,
      })),
      { label: 'Total Revenue', amount: totalRevenue, isSubtotal: true },
      { label: '', amount: undefined },
      { label: 'Cost of Goods Sold', amount: undefined, isBold: true },
      ...incomeData!.cogs.map(acc => ({
        label: `${acc.account_code} - ${acc.account_name}`,
        amount: acc.current_balance,
        indent: 1,
      })),
      { label: 'Total COGS', amount: totalCOGS, isSubtotal: true },
      { label: '', amount: undefined },
      { label: 'Gross Profit', amount: grossProfit, isTotal: true },
      { label: '', amount: undefined },
      { label: 'Operating Expenses', amount: undefined, isBold: true },
      ...incomeData!.expenses.map(acc => ({
        label: `${acc.account_code} - ${acc.account_name}`,
        amount: acc.current_balance,
        indent: 1,
      })),
      { label: 'Total Expenses', amount: totalExpenses, isSubtotal: true },
      { label: '', amount: undefined },
      { label: 'Net Income', amount: netIncome, isTotal: true },
    ];

    const filename = generateStandardFilename(
      'income-statement',
      restaurant?.name || 'restaurant',
      dateFrom,
      dateTo
    );

    generateFinancialReportPDF({
      title: 'Income Statement',
      restaurantName: restaurant?.name || 'Restaurant',
      dateRange: `For the period ${format(dateFrom, 'MMM dd, yyyy')} - ${format(dateTo, 'MMM dd, yyyy')}`,
      data,
      filename: `${filename}.pdf`,
    });

    toast({
      title: 'Export successful',
      description: 'Income statement exported to PDF',
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
            <CardTitle>Income Statement</CardTitle>
            <CardDescription>
              For the period {format(dateFrom, 'MMM dd, yyyy')} - {format(dateTo, 'MMM dd, yyyy')}
            </CardDescription>
          </div>
          <ExportDropdown onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Revenue Section */}
          <div>
            <h3 className="font-semibold text-lg mb-3">Revenue</h3>
            <div className="space-y-2">
              {incomeData?.revenue.map((account) => (
                <div key={account.id} className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-muted/50">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-muted-foreground">{account.account_code}</span>
                    <span>{account.account_name}</span>
                  </div>
                  <span className="font-medium">{formatCurrency(account.current_balance)}</span>
                </div>
              ))}
              <div className="flex justify-between items-center py-2 px-3 border-t font-semibold">
                <span>Total Revenue</span>
                <span>{formatCurrency(totalRevenue)}</span>
              </div>
            </div>
          </div>

          {/* COGS Section */}
          <div>
            <h3 className="font-semibold text-lg mb-3">Cost of Goods Sold</h3>
            <div className="space-y-2">
              {incomeData?.cogs.map((account) => (
                <div key={account.id} className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-muted/50">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-muted-foreground">{account.account_code}</span>
                    <span>{account.account_name}</span>
                  </div>
                  <span className="font-medium">{formatCurrency(account.current_balance)}</span>
                </div>
              ))}
              <div className="flex justify-between items-center py-2 px-3 border-t font-semibold">
                <span>Total COGS</span>
                <span>{formatCurrency(totalCOGS)}</span>
              </div>
            </div>
          </div>

          {/* Gross Profit */}
          <div className="flex justify-between items-center py-3 px-3 bg-muted rounded-lg font-bold text-lg">
            <span>Gross Profit</span>
            <span className={grossProfit >= 0 ? 'text-success' : 'text-destructive'}>
              {formatCurrency(grossProfit)}
            </span>
          </div>

          {/* Expenses Section */}
          <div>
            <h3 className="font-semibold text-lg mb-3">Operating Expenses</h3>
            <div className="space-y-2">
              {incomeData?.expenses.map((account) => (
                <div key={account.id} className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-muted/50">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-muted-foreground">{account.account_code}</span>
                    <span>{account.account_name}</span>
                  </div>
                  <span className="font-medium">{formatCurrency(account.current_balance)}</span>
                </div>
              ))}
              <div className="flex justify-between items-center py-2 px-3 border-t font-semibold">
                <span>Total Expenses</span>
                <span>{formatCurrency(totalExpenses)}</span>
              </div>
            </div>
          </div>

          {/* Net Income */}
          <div className="flex justify-between items-center py-4 px-3 bg-primary/10 border border-primary/20 rounded-lg font-bold text-xl">
            <span>Net Income</span>
            <span className={netIncome >= 0 ? 'text-success' : 'text-destructive'}>
              {formatCurrency(netIncome)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}