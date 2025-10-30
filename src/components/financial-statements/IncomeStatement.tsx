import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { ExportDropdown } from './shared/ExportDropdown';
import { generateFinancialReportPDF, generateStandardFilename } from '@/utils/pdfExport';
import { useRevenueBreakdown } from '@/hooks/useRevenueBreakdown';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface IncomeStatementProps {
  restaurantId: string;
  dateFrom: Date;
  dateTo: Date;
}

export function IncomeStatement({ restaurantId, dateFrom, dateTo }: IncomeStatementProps) {
  const { toast } = useToast();
  const navigate = useNavigate();

  // Fetch revenue breakdown from categorized POS sales
  const { data: revenueBreakdown, isLoading: revenueLoading } = useRevenueBreakdown(
    restaurantId,
    dateFrom,
    dateTo
  );

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

  // Use categorized POS sales data if available, otherwise fall back to journal entries
  const usePOSData = revenueBreakdown?.hasCategorizationData;
  
  const totalRevenue = usePOSData 
    ? revenueBreakdown.netRevenue 
    : incomeData?.revenue.reduce((sum, acc) => sum + acc.current_balance, 0) || 0;
  const totalCOGS = incomeData?.cogs.reduce((sum, acc) => sum + acc.current_balance, 0) || 0;
  const totalExpenses = incomeData?.expenses.reduce((sum, acc) => sum + acc.current_balance, 0) || 0;
  const grossProfit = totalRevenue - totalCOGS;
  const netIncome = grossProfit - totalExpenses;

  const handleExportCSV = () => {
    const csvRows: string[][] = [
      ['Income Statement'],
      [`Period: ${format(dateFrom, 'MMM dd, yyyy')} - ${format(dateTo, 'MMM dd, yyyy')}`],
      [''],
      ['Revenue'],
    ];

    // Add revenue section based on data source
    if (usePOSData) {
      // Enhanced revenue with POS categorization
      revenueBreakdown.revenueCategories.forEach(cat => {
        csvRows.push([cat.account_code, cat.account_name, cat.total.toString()]);
      });
      csvRows.push(['', 'Gross Revenue', revenueBreakdown.grossRevenue.toString()]);
      
      if (revenueBreakdown.discountsAndComps > 0) {
        csvRows.push(['', 'Less: Discounts & Comps', (-revenueBreakdown.discountsAndComps).toString()]);
      }
      if (revenueBreakdown.refunds > 0) {
        csvRows.push(['', 'Less: Refunds & Returns', (-revenueBreakdown.refunds).toString()]);
      }
      csvRows.push(['', 'Net Sales Revenue', revenueBreakdown.netRevenue.toString()]);
      
      // Add pass-through items if present
      if (revenueBreakdown.salesTax > 0 || revenueBreakdown.tips > 0) {
        csvRows.push([''], ['Other Collections (Pass-Through)']);
        if (revenueBreakdown.salesTax > 0) {
          csvRows.push(['', 'Sales Tax Collected (Liability)', revenueBreakdown.salesTax.toString()]);
        }
        if (revenueBreakdown.tips > 0) {
          csvRows.push(['', 'Tips Collected (Liability)', revenueBreakdown.tips.toString()]);
        }
      }
    } else {
      // Traditional journal entry based revenue
      incomeData!.revenue.forEach(acc => {
        csvRows.push([acc.account_code, acc.account_name, acc.current_balance.toString()]);
      });
      csvRows.push(['', 'Total Revenue', totalRevenue.toString()]);
    }

    csvRows.push(
      [''],
      ['Cost of Goods Sold'],
      ...incomeData!.cogs.map(acc => [acc.account_code, acc.account_name, acc.current_balance.toString()]),
      ['', 'Total COGS', totalCOGS.toString()],
      [''],
      ['', 'Gross Profit', grossProfit.toString()],
      [''],
      ['Operating Expenses'],
      ...incomeData!.expenses.map(acc => [acc.account_code, acc.account_name, acc.current_balance.toString()]),
      ['', 'Total Expenses', totalExpenses.toString()],
      [''],
      ['', 'Net Income', netIncome.toString()],
    );

    const csvContent = csvRows.map(row => row.join(',')).join('\n');

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
    const data: any[] = [];

    // Revenue section based on data source
    if (usePOSData) {
      data.push({ label: 'Revenue', amount: undefined, isBold: true });
      
      // Individual categories
      revenueBreakdown.revenueCategories.forEach(cat => {
        data.push({
          label: `${cat.account_code} - ${cat.account_name}`,
          amount: cat.total,
          indent: 1,
        });
      });
      
      data.push({ label: 'Gross Revenue', amount: revenueBreakdown.grossRevenue, isSubtotal: true });
      
      if (revenueBreakdown.discountsAndComps > 0) {
        data.push({
          label: 'Less: Discounts & Comps',
          amount: -revenueBreakdown.discountsAndComps,
          indent: 1,
        });
      }
      
      if (revenueBreakdown.refunds > 0) {
        data.push({
          label: 'Less: Refunds & Returns',
          amount: -revenueBreakdown.refunds,
          indent: 1,
        });
      }
      
      data.push({ label: 'Net Sales Revenue', amount: revenueBreakdown.netRevenue, isTotal: true });
      
      // Pass-through items
      if (revenueBreakdown.salesTax > 0 || revenueBreakdown.tips > 0) {
        data.push({ label: '', amount: undefined });
        data.push({ label: 'Other Collections (Pass-Through)', amount: undefined, isBold: true });
        
        if (revenueBreakdown.salesTax > 0) {
          data.push({
            label: 'Sales Tax Collected (Liability)',
            amount: revenueBreakdown.salesTax,
            indent: 1,
          });
        }
        
        if (revenueBreakdown.tips > 0) {
          data.push({
            label: 'Tips Collected (Liability)',
            amount: revenueBreakdown.tips,
            indent: 1,
          });
        }
      }
    } else {
      // Traditional revenue
      data.push(
        ...incomeData!.revenue.map(acc => ({
          label: `${acc.account_code} - ${acc.account_name}`,
          amount: acc.current_balance,
          indent: 1,
        })),
        { label: 'Total Revenue', amount: totalRevenue, isSubtotal: true }
      );
    }

    // COGS, Expenses, and totals
    data.push(
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
    );

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

  if (isLoading || revenueLoading) {
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
          {/* Revenue Section - Enhanced with POS Categorization */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-lg">Revenue</h3>
              {!usePOSData && (
                <Badge variant="outline" className="gap-1.5">
                  <AlertCircle className="h-3 w-3" />
                  Journal Entry Based
                </Badge>
              )}
            </div>
            
            {usePOSData ? (
              <div className="space-y-2">
                {/* Individual Revenue Categories from POS */}
                {revenueBreakdown.revenueCategories.map((category, idx) => (
                  <div key={idx} className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-muted/50">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted-foreground">{category.account_code}</span>
                      <span>{category.account_name}</span>
                    </div>
                    <span className="font-medium">{formatCurrency(category.total)}</span>
                  </div>
                ))}
                
                {/* Gross Revenue Subtotal */}
                <div className="flex justify-between items-center py-2 px-3 border-t font-semibold bg-muted/30">
                  <span>Gross Revenue</span>
                  <span>{formatCurrency(revenueBreakdown.grossRevenue)}</span>
                </div>

                {/* Deductions */}
                {revenueBreakdown.discountsAndComps > 0 && (
                  <div className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-muted/50 text-destructive">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted-foreground">-</span>
                      <span>Less: Discounts & Comps</span>
                    </div>
                    <span className="font-medium">({formatCurrency(revenueBreakdown.discountsAndComps)})</span>
                  </div>
                )}
                
                {revenueBreakdown.refunds > 0 && (
                  <div className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-muted/50 text-destructive">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted-foreground">-</span>
                      <span>Less: Refunds & Returns</span>
                    </div>
                    <span className="font-medium">({formatCurrency(revenueBreakdown.refunds)})</span>
                  </div>
                )}

                {/* Net Sales Revenue */}
                <div className="flex justify-between items-center py-2 px-3 border-t-2 font-bold text-lg bg-gradient-to-r from-primary/5 to-transparent">
                  <span>Net Sales Revenue</span>
                  <span className="text-success">{formatCurrency(revenueBreakdown.netRevenue)}</span>
                </div>
              </div>
            ) : (
              <>
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
                
                {/* Prompt to categorize POS sales */}
                <div className="mt-4 p-4 rounded-lg bg-gradient-to-br from-primary/5 to-transparent border border-primary/20">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-primary mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium mb-1">Enhanced Revenue Breakdown Available</p>
                      <p className="text-xs text-muted-foreground mb-3">
                        Categorize your POS sales to see detailed revenue by category (Food, Beverages, Alcohol, etc.)
                      </p>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => navigate('/pos-sales')}
                        className="gap-2"
                      >
                        Categorize Sales
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Other Collections (Pass-Through Items) - Only show if POS data available */}
          {usePOSData && (revenueBreakdown.salesTax > 0 || revenueBreakdown.tips > 0) && (
            <div>
              <h3 className="font-semibold text-lg mb-3">Other Collections (Pass-Through)</h3>
              <div className="space-y-2">
                {revenueBreakdown.salesTax > 0 && (
                  <div className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-muted/50">
                    <div className="flex items-center gap-3">
                      <span>Sales Tax Collected</span>
                      <Badge variant="outline" className="text-xs">Liability</Badge>
                    </div>
                    <span className="font-medium text-muted-foreground">{formatCurrency(revenueBreakdown.salesTax)}</span>
                  </div>
                )}
                
                {revenueBreakdown.tips > 0 && (
                  <div className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-muted/50">
                    <div className="flex items-center gap-3">
                      <span>Tips Collected</span>
                      <Badge variant="outline" className="text-xs">Liability</Badge>
                    </div>
                    <span className="font-medium text-muted-foreground">{formatCurrency(revenueBreakdown.tips)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

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