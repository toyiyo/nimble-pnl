import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { ExportDropdown } from './shared/ExportDropdown';
import { generateFinancialReportPDF, generateStandardFilename } from '@/utils/pdfExport';
import { useRevenueBreakdown } from '@/hooks/useRevenueBreakdown';

interface IncomeStatementProps {
  restaurantId: string;
  dateFrom: Date;
  dateTo: Date;
}

export function IncomeStatement({ restaurantId, dateFrom, dateTo }: IncomeStatementProps) {
  const { toast } = useToast();

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

  const totalRevenue = incomeData?.revenue.reduce((sum, acc) => sum + acc.current_balance, 0) || 0;
  const totalCOGS = incomeData?.cogs.reduce((sum, acc) => sum + acc.current_balance, 0) || 0;
  const totalExpenses = incomeData?.expenses.reduce((sum, acc) => sum + acc.current_balance, 0) || 0;
  
  // Use revenue breakdown data if available, otherwise fall back to journal entries
  const effectiveRevenue = (revenueBreakdown && revenueBreakdown.revenue_categories.length > 0) 
    ? revenueBreakdown.totals.net_revenue 
    : totalRevenue;
  
  const grossProfit = effectiveRevenue - totalCOGS;
  const netIncome = grossProfit - totalExpenses;

  const handleExportCSV = () => {
    const csvRows = [
      ['Income Statement'],
      [`Period: ${format(dateFrom, 'MMM dd, yyyy')} - ${format(dateTo, 'MMM dd, yyyy')}`],
      [''],
    ];
    
    // Revenue Section - Use revenueBreakdown if available, otherwise fall back to incomeData
    if (revenueBreakdown && revenueBreakdown.revenue_categories.length > 0) {
      csvRows.push(['REVENUE']);
      
      // Revenue Categories from POS Sales
      revenueBreakdown.revenue_categories.forEach((category) => {
        csvRows.push([category.account_code, category.account_name, category.total_amount]);
      });
      
      csvRows.push(['', 'Gross Revenue', revenueBreakdown.totals.gross_revenue]);
      
      // Discounts, Refunds & Comps
      if (revenueBreakdown.discount_categories.length > 0 || revenueBreakdown.refund_categories?.length > 0) {
        csvRows.push(['']);
        csvRows.push(['Less: Deductions']);
        
        revenueBreakdown.discount_categories.forEach((category) => {
          csvRows.push([category.account_code, category.account_name, -Math.abs(category.total_amount)]);
        });
        
        if (revenueBreakdown.refund_categories) {
          revenueBreakdown.refund_categories.forEach((category) => {
            csvRows.push([category.account_code, category.account_name, -Math.abs(category.total_amount)]);
          });
        }
      }
      
      // Net Revenue
      csvRows.push(['', 'Net Sales Revenue', revenueBreakdown.totals.net_revenue]);
      
      // Pass-Through Collections (if any)
      if (revenueBreakdown.totals.sales_tax > 0 || revenueBreakdown.totals.tips > 0) {
        csvRows.push(['']);
        csvRows.push(['OTHER COLLECTIONS (Pass-Through)']);
        
        revenueBreakdown.tax_categories.forEach((category) => {
          csvRows.push([category.account_code, `${category.account_name} (Liability)`, category.total_amount]);
        });
        
        revenueBreakdown.tip_categories.forEach((category) => {
          csvRows.push([category.account_code, `${category.account_name} (Liability)`, category.total_amount]);
        });
      }
    } else {
      // Fallback to journal entries if no POS categorization
      csvRows.push(['Revenue']);
      incomeData!.revenue.forEach(acc => {
        csvRows.push([acc.account_code, acc.account_name, acc.current_balance]);
      });
      csvRows.push(['', 'Total Revenue', totalRevenue]);
    }
    
    csvRows.push(['']);
    
    // COGS Section
    csvRows.push(['Cost of Goods Sold']);
    incomeData!.cogs.forEach(acc => {
      csvRows.push([acc.account_code, acc.account_name, acc.current_balance]);
    });
    csvRows.push(['', 'Total COGS', totalCOGS]);
    csvRows.push(['']);
    csvRows.push(['', 'Gross Profit', grossProfit]);
    csvRows.push(['']);
    
    // Expenses Section
    csvRows.push(['Operating Expenses']);
    incomeData!.expenses.forEach(acc => {
      csvRows.push([acc.account_code, acc.account_name, acc.current_balance]);
    });
    csvRows.push(['', 'Total Expenses', totalExpenses]);
    csvRows.push(['']);
    csvRows.push(['', 'Net Income', netIncome]);
    
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
    const data = [];
    
    // Revenue Section - Use revenueBreakdown if available, otherwise fall back to incomeData
    if (revenueBreakdown && revenueBreakdown.revenue_categories.length > 0) {
      data.push({ label: 'REVENUE', amount: undefined, isBold: true });
      
      // Revenue Categories from POS Sales
      revenueBreakdown.revenue_categories.forEach((category) => {
        data.push({
          label: `${category.account_code} - ${category.account_name}`,
          amount: category.total_amount,
          indent: 1,
        });
      });
      
      data.push({ label: 'Gross Revenue', amount: revenueBreakdown.totals.gross_revenue, isSubtotal: true });
      
      // Discounts, Refunds & Comps
      if (revenueBreakdown.discount_categories.length > 0 || revenueBreakdown.refund_categories?.length > 0) {
        data.push({ label: '', amount: undefined });
        data.push({ label: 'Less: Deductions', amount: undefined, isBold: true });
        
        revenueBreakdown.discount_categories.forEach((category) => {
          data.push({
            label: `${category.account_code} - ${category.account_name}`,
            amount: -Math.abs(category.total_amount),
            indent: 1,
          });
        });
        
        if (revenueBreakdown.refund_categories) {
          revenueBreakdown.refund_categories.forEach((category) => {
            data.push({
              label: `${category.account_code} - ${category.account_name}`,
              amount: -Math.abs(category.total_amount),
              indent: 1,
            });
          });
        }
      }
      
      // Net Revenue
      data.push({ label: 'Net Sales Revenue', amount: revenueBreakdown.totals.net_revenue, isSubtotal: true });
      
      // Pass-Through Collections (if any)
      if (revenueBreakdown.totals.sales_tax > 0 || revenueBreakdown.totals.tips > 0) {
        data.push({ label: '', amount: undefined });
        data.push({ label: 'OTHER COLLECTIONS (Pass-Through)', amount: undefined, isBold: true });
        
        revenueBreakdown.tax_categories.forEach((category) => {
          data.push({
            label: `${category.account_code} - ${category.account_name} (Liability)`,
            amount: category.total_amount,
            indent: 1,
          });
        });
        
        revenueBreakdown.tip_categories.forEach((category) => {
          data.push({
            label: `${category.account_code} - ${category.account_name} (Liability)`,
            amount: category.total_amount,
            indent: 1,
          });
        });
      }
    } else {
      // Fallback to journal entries if no POS categorization
      data.push({ label: 'REVENUE', amount: undefined, isBold: true });
      incomeData!.revenue.forEach(acc => {
        data.push({
          label: `${acc.account_code} - ${acc.account_name}`,
          amount: acc.current_balance,
          indent: 1,
        });
      });
      data.push({ label: 'Total Revenue', amount: totalRevenue, isSubtotal: true });
    }
    
    data.push({ label: '', amount: undefined });
    
    // COGS Section
    data.push({ label: 'Cost of Goods Sold', amount: undefined, isBold: true });
    incomeData!.cogs.forEach(acc => {
      data.push({
        label: `${acc.account_code} - ${acc.account_name}`,
        amount: acc.current_balance,
        indent: 1,
      });
    });
    data.push({ label: 'Total COGS', amount: totalCOGS, isSubtotal: true });
    data.push({ label: '', amount: undefined });
    data.push({ label: 'Gross Profit', amount: grossProfit, isTotal: true });
    data.push({ label: '', amount: undefined });
    
    // Expenses Section
    data.push({ label: 'Operating Expenses', amount: undefined, isBold: true });
    incomeData!.expenses.forEach(acc => {
      data.push({
        label: `${acc.account_code} - ${acc.account_name}`,
        amount: acc.current_balance,
        indent: 1,
      });
    });
    data.push({ label: 'Total Expenses', amount: totalExpenses, isSubtotal: true });
    data.push({ label: '', amount: undefined });
    data.push({ label: 'Net Income', amount: netIncome, isTotal: true });

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
          {/* Revenue Section - Enhanced with POS Sales Breakdown */}
          <div>
            <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <div className="h-1 w-8 bg-gradient-to-r from-green-500 to-emerald-600 rounded-full" />
              REVENUE
            </h3>
            <div className="space-y-2">
              {revenueBreakdown && revenueBreakdown.revenue_categories.length > 0 ? (
                <>
                  {/* Revenue Categories from POS Sales */}
                  {revenueBreakdown.revenue_categories.map((category) => (
                    <div key={category.account_id} className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-muted/50">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-muted-foreground">{category.account_code}</span>
                        <span>{category.account_name}</span>
                      </div>
                      <span className="font-medium">{formatCurrency(category.total_amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center py-2 px-3 border-t text-sm">
                    <span>Gross Revenue</span>
                    <span className="font-semibold">{formatCurrency(revenueBreakdown.totals.gross_revenue)}</span>
                  </div>

                  {/* Discounts, Refunds & Comps */}
                  {(revenueBreakdown.discount_categories.length > 0 || revenueBreakdown.refund_categories?.length > 0) && (
                    <div className="mt-2">
                      <div className="text-sm text-muted-foreground mb-1 px-3">Less: Deductions</div>
                      {revenueBreakdown.discount_categories.map((category) => (
                        <div key={category.account_id} className="flex justify-between items-center py-1 px-3">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-mono text-muted-foreground">{category.account_code}</span>
                            <span className="text-sm text-red-600">{category.account_name}</span>
                          </div>
                          <span className="font-medium text-red-600">({formatCurrency(Math.abs(category.total_amount))})</span>
                        </div>
                      ))}
                      {revenueBreakdown.refund_categories?.map((category) => (
                        <div key={category.account_id} className="flex justify-between items-center py-1 px-3">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-mono text-muted-foreground">{category.account_code}</span>
                            <span className="text-sm text-red-600">{category.account_name}</span>
                          </div>
                          <span className="font-medium text-red-600">({formatCurrency(Math.abs(category.total_amount))})</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Net Revenue */}
                  <div className="flex justify-between items-center py-2 px-3 border-t-2 font-semibold">
                    <span>Net Sales Revenue</span>
                    <span>{formatCurrency(revenueBreakdown.totals.net_revenue)}</span>
                  </div>

                  {/* Pass-Through Collections */}
                  {(revenueBreakdown.totals.sales_tax > 0 || revenueBreakdown.totals.tips > 0) && (
                    <div className="mt-4 pt-4 border-t">
                      <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide px-3">
                        OTHER COLLECTIONS (Pass-Through)
                      </div>
                      <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                        {revenueBreakdown.tax_categories.map((category) => (
                          <div key={category.account_id} className="flex justify-between items-center py-1">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-mono text-muted-foreground">{category.account_code}</span>
                              <span className="text-sm">{category.account_name}</span>
                              <span className="text-xs text-amber-600 font-medium">(Liability)</span>
                            </div>
                            <span className="font-medium text-sm">{formatCurrency(category.total_amount)}</span>
                          </div>
                        ))}
                        {revenueBreakdown.tip_categories.map((category) => (
                          <div key={category.account_id} className="flex justify-between items-center py-1">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-mono text-muted-foreground">{category.account_code}</span>
                              <span className="text-sm">{category.account_name}</span>
                              <span className="text-xs text-amber-600 font-medium">(Liability)</span>
                            </div>
                            <span className="font-medium text-sm">{formatCurrency(category.total_amount)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* Fallback to journal entries if no POS categorization */
                <>
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
                </>
              )}
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