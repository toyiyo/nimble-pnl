import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { ExportDropdown } from './shared/ExportDropdown';
import { generateFinancialReportPDF, generateStandardFilename } from '@/utils/pdfExport';
import { useRevenueBreakdown } from '@/hooks/useRevenueBreakdown';
import { useUnifiedCOGS } from '@/hooks/useUnifiedCOGS';
import { useUncategorizedTotals } from '@/hooks/useUncategorizedTotals';
import { calculateSalaryForPeriod, calculateContractorPayForPeriod } from '@/utils/compensationCalculations';
import type { Employee } from '@/types/scheduling';
import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
// USAR-aligned expense grouping by account_subtype
const LABOR_SUBTYPES = new Set(['labor', 'payroll']);
const FIXED_SUBTYPES = new Set(['rent', 'insurance', 'depreciation']);
// Everything else in 'expense' type that isn't labor or fixed → controllable

interface LineItemProps {
  code: string;
  name: string;
  amount: number;
  pct: string;
  formatCurrency: (n: number) => string;
  variant?: 'default' | 'deduction' | 'liability';
}

function LineItem({ code, name, amount, pct, formatCurrency, variant = 'default' }: LineItemProps) {
  if (variant === 'deduction') {
    return (
      <div className="flex justify-between items-center py-1 px-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-muted-foreground">{code}</span>
          <span className="text-sm text-destructive">{name}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-medium text-destructive">({formatCurrency(Math.abs(amount))})</span>
          <span className="text-xs text-muted-foreground w-14 text-right">{pct}</span>
        </div>
      </div>
    );
  }

  if (variant === 'liability') {
    return (
      <div className="flex justify-between items-center py-1">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-muted-foreground">{code}</span>
          <span className="text-sm">{name}</span>
          <span className="text-xs text-amber-600 font-medium">(Liability)</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-medium text-sm">{formatCurrency(amount)}</span>
          <span className="text-xs text-muted-foreground w-14 text-right">{pct}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-between items-center py-2 px-3 rounded-lg hover:bg-muted/50">
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-muted-foreground">{code}</span>
        <span>{name}</span>
      </div>
      <div className="flex items-center gap-4">
        <span className="font-medium">{formatCurrency(amount)}</span>
        <span className="text-xs text-muted-foreground w-14 text-right">{pct}</span>
      </div>
    </div>
  );
}

interface SubtotalRowProps {
  label: string;
  amount: number;
  pct: string;
  formatCurrency: (n: number) => string;
  borderClass?: string;
}

function SubtotalRow({ label, amount, pct, formatCurrency, borderClass = 'border-t' }: SubtotalRowProps) {
  return (
    <div className={`flex justify-between items-center py-2 px-3 ${borderClass} font-semibold`}>
      <span>{label}</span>
      <div className="flex items-center gap-4">
        <span>{formatCurrency(amount)}</span>
        <span className="text-xs text-muted-foreground w-14 text-right">{pct}</span>
      </div>
    </div>
  );
}

interface HighlightRowProps {
  label: string;
  amount: number;
  pct: string;
  formatCurrency: (n: number) => string;
  colorBySign?: boolean;
  className?: string;
}

function HighlightRow({ label, amount, pct, formatCurrency, colorBySign = false, className = '' }: HighlightRowProps) {
  return (
    <div className={`flex justify-between items-center py-3 px-3 rounded-lg font-bold text-lg ${className}`}>
      <span>{label}</span>
      <div className="flex items-center gap-4">
        <span className={colorBySign ? (amount >= 0 ? 'text-success' : 'text-destructive') : ''}>
          {formatCurrency(amount)}
        </span>
        <span className="text-xs text-muted-foreground w-14 text-right font-medium">{pct}</span>
      </div>
    </div>
  );
}

interface IncomeStatementProps {
  restaurantId: string;
  dateFrom: Date;
  dateTo: Date;
}

export function IncomeStatement({ restaurantId, dateFrom, dateTo }: IncomeStatementProps) {
  const { toast } = useToast();
  const [glOnly, setGlOnly] = useState(false);
  const [accrualMode, setAccrualMode] = useState<'actual' | 'projected'>('actual');
  
  // Check if dateTo is in the future (for showing indicator)
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const periodIncludesFuture = dateTo > today;

  // Merge inventory usage into COGS accounts (additive — always adds if inventory COGS > 0)
  const mergeInventoryCOGS = <T extends { current_balance?: number }>(
    cogsAccounts: T[],
    inventoryUsageTotal: number
  ): T[] => {
    if (inventoryUsageTotal <= 0) return cogsAccounts;

    return [
      ...cogsAccounts,
      {
        id: 'inventory-usage',
        account_code: 'COGS-INV',
        account_name: 'COGS (from tracking)',
        account_type: 'cogs',
        account_subtype: 'cost_of_goods_sold',
        normal_balance: 'debit',
        current_balance: inventoryUsageTotal,
        is_inventory_usage: true,
      } as unknown as T,
    ];
  };

  // Fetch revenue breakdown from categorized POS sales
  const { data: revenueBreakdown, isLoading: revenueLoading } = useRevenueBreakdown(
    restaurantId,
    dateFrom,
    dateTo
  );

  // Unified COGS from inventory tracking, financials, or both (per restaurant settings)
  const unifiedCOGS = useUnifiedCOGS(restaurantId, dateFrom, dateTo);
  const uncategorized = useUncategorizedTotals(restaurantId, dateFrom, dateTo);
  const navigate = useNavigate();

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
    queryKey: ['income-statement', restaurantId, dateFrom, dateTo, glOnly, accrualMode, unifiedCOGS.totalCOGS],
    queryFn: async () => {
      // Fetch all chart of accounts for this restaurant
      const { data: accounts, error: accountsError } = await supabase
        .from('chart_of_accounts')
        .select('id, account_code, account_name, account_type, account_subtype, normal_balance')
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
      
      interface JournalLineResult {
        account_id: string;
        debit_amount: number | null;
        credit_amount: number | null;
      }

      journalLines?.forEach((line: JournalLineResult) => {
        const current = accountBalances.get(line.account_id) || { debits: 0, credits: 0 };
        accountBalances.set(line.account_id, {
          debits: current.debits + (line.debit_amount || 0),
          credits: current.credits + (line.credit_amount || 0),
        });
      });

      // Map accounts with their calculated balances
      // Revenue accounts: credits increase, debits decrease (normal balance = credit)
      // Expense/COGS accounts: debits increase, credits decrease (normal balance = debit)
      let accountsWithBalances = accounts?.map(account => {
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

      // Add inventory COGS (additive with any journaled COGS)
      if (!glOnly && unifiedCOGS.totalCOGS > 0) {
        const mergedCogs = mergeInventoryCOGS(
          accountsWithBalances.filter(a => a.account_type === 'cogs'),
          unifiedCOGS.totalCOGS
        );
        accountsWithBalances = [
          ...accountsWithBalances.filter(a => a.account_type !== 'cogs'),
          ...mergedCogs,
        ];
      }

      // Payroll expense fallback: if no payroll expense JE exists, include hourly punches + salary/contractor allocations
      const payrollExpenseJE = accountsWithBalances
        .filter(acc =>
          acc.account_type === 'expense' &&
          (
            acc.account_subtype === 'payroll' ||
            (acc.account_name || '').toLowerCase().includes('payroll')
          )
        )
        .reduce((sum, acc) => sum + acc.current_balance, 0);

      if (!glOnly && payrollExpenseJE === 0) {
        const fromStr = dateFrom.toISOString().split('T')[0];
        const toStr = dateTo.toISOString().split('T')[0];

        const { data: hourlyAgg, error: hourlyErr } = await supabase
          .from('daily_labor_costs')
          .select('sum:sum(total_labor_cost)')
          .eq('restaurant_id', restaurantId)
          .gte('date', fromStr)
          .lte('date', toStr)
          .maybeSingle();

        const { data: allocationAgg, error: allocErr } = await supabase
          .from('daily_labor_allocations')
          .select('sum:sum(allocated_cost)')
          .eq('restaurant_id', restaurantId)
          .gte('date', fromStr)
          .lte('date', toStr)
          .maybeSingle();

        if (hourlyErr) {
          console.warn('Failed to fetch hourly labor costs for IS:', hourlyErr);
        }
        if (allocErr) {
          console.warn('Failed to fetch salary/contractor allocations for IS:', allocErr);
        }

        let payrollFallback =
          Math.abs(Number(hourlyAgg?.sum) || 0) + Math.abs(Number(allocationAgg?.sum) || 0);

        // If still zero, derive daily allocations from salary/contractor employees
        // Uses calculateSalaryForPeriod/calculateContractorPayForPeriod which respect hire_date
        if (payrollFallback === 0) {
          const { data: employees, error: empErr } = await supabase
            .from('employees')
            .select('id, restaurant_id, name, position, compensation_type, salary_amount, pay_period_type, contractor_payment_amount, contractor_payment_interval, allocate_daily, hire_date, termination_date, hourly_rate, is_active')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true);

          if (empErr) {
            console.warn('Failed to fetch employees for payroll fallback:', empErr);
          } else if (employees?.length) {
            // Determine effective end date based on accrual mode
            const now = new Date();
            now.setHours(23, 59, 59, 999);
            const effectiveEndDate = accrualMode === 'actual' && dateTo > now ? now : dateTo;
            
            employees.forEach(emp => {
              if (emp.allocate_daily === false) return;
              
              // Cast to Employee type for the calculation functions
              const employee = emp as unknown as Employee;
              
              if (emp.compensation_type === 'salary' && emp.salary_amount && emp.pay_period_type) {
                // calculateSalaryForPeriod respects hire_date and termination_date
                const periodCostCents = calculateSalaryForPeriod(employee, dateFrom, effectiveEndDate);
                payrollFallback += periodCostCents / 100; // cents to dollars
              }
              if (emp.compensation_type === 'contractor' && emp.contractor_payment_amount && emp.contractor_payment_interval) {
                // calculateContractorPayForPeriod respects hire_date and termination_date
                const periodCostCents = calculateContractorPayForPeriod(employee, dateFrom, effectiveEndDate);
                payrollFallback += periodCostCents / 100; // cents to dollars
              }
            });
          }
        }

        if (payrollFallback > 0) {
          accountsWithBalances = [
            ...accountsWithBalances,
            {
              id: 'payroll-expense-fallback',
              account_code: 'PAYROLL-EXP',
              account_name: 'Payroll Expense (unposted)',
              account_type: 'expense' as const,
              account_subtype: 'payroll' as const,
              normal_balance: 'debit',
              current_balance: payrollFallback,
            },
          ];
        }
      }

      // If GL-only, strip any unposted synthetic rows just in case
      if (glOnly) {
        accountsWithBalances = accountsWithBalances.filter(
          acc => !acc.id.includes('fallback') && !acc.id.includes('usage')
        );
      }

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

  // Group expenses by USAR category
  const laborAccounts = incomeData?.expenses.filter(a => LABOR_SUBTYPES.has(a.account_subtype)) || [];
  const fixedAccounts = incomeData?.expenses.filter(a => FIXED_SUBTYPES.has(a.account_subtype)) || [];
  const controllableAccounts = incomeData?.expenses.filter(a =>
    !LABOR_SUBTYPES.has(a.account_subtype) && !FIXED_SUBTYPES.has(a.account_subtype)
  ) || [];

  const totalLabor = laborAccounts.reduce((sum, acc) => sum + acc.current_balance, 0);
  const totalControllable = controllableAccounts.reduce((sum, acc) => sum + acc.current_balance, 0);
  const totalFixed = fixedAccounts.reduce((sum, acc) => sum + acc.current_balance, 0);

  // Include uncategorized amounts (not in GL-only mode)
  const uncatExpenses = glOnly ? 0 : uncategorized.uncategorizedOutflows;
  const uncatRevenue = glOnly ? 0 : (revenueBreakdown?.uncategorized_revenue || 0);

  // Core totals
  const totalRevenue = incomeData?.revenue.reduce((sum, acc) => sum + acc.current_balance, 0) || 0;
  const totalCOGS = incomeData?.cogs.reduce((sum, acc) => sum + acc.current_balance, 0) || 0;
  const totalExpenses = totalLabor + totalControllable + totalFixed + uncatExpenses;

  const effectiveRevenue = (revenueBreakdown && revenueBreakdown.revenue_categories.length > 0)
    ? revenueBreakdown.totals.net_revenue
    : totalRevenue;

  // USAR subtotals
  const grossProfit = effectiveRevenue - totalCOGS;
  const primeCost = totalCOGS + totalLabor;
  const totalControllableWithUncat = totalControllable + uncatExpenses;
  const totalOperatingExpenses = totalLabor + totalControllableWithUncat + totalFixed;
  const operatingIncome = grossProfit - totalOperatingExpenses;

  // EBITDA: only meaningful if depreciation accounts exist
  const depreciationTotal = fixedAccounts
    .filter(a => a.account_subtype === 'depreciation')
    .reduce((sum, acc) => sum + acc.current_balance, 0);
  const ebitda = depreciationTotal > 0 ? operatingIncome + depreciationTotal : null;

  const netIncome = grossProfit - totalExpenses;

  // % of revenue helper
  const pctOfRevenue = (amount: number) =>
    effectiveRevenue > 0 ? ((amount / effectiveRevenue) * 100).toFixed(1) + '%' : '—';

  const handleExportCSV = () => {
    const csvRows: string[][] = [
      ['Income Statement'],
      [`Period: ${format(dateFrom, 'MMM dd, yyyy')} - ${format(dateTo, 'MMM dd, yyyy')}`],
      ['', '', 'Amount', '% of Revenue'],
      [''],
    ];

    // Revenue Section - Use revenueBreakdown if available, otherwise fall back to incomeData
    if (revenueBreakdown && revenueBreakdown.revenue_categories.length > 0) {
      csvRows.push(['REVENUE']);

      revenueBreakdown.revenue_categories.forEach((category) => {
        csvRows.push([category.account_code, category.account_name, String(category.total_amount), pctOfRevenue(category.total_amount)]);
      });

      if (uncatRevenue > 0) {
        csvRows.push(['', 'Uncategorized Revenue', String(uncatRevenue), pctOfRevenue(uncatRevenue)]);
      }

      csvRows.push(['', 'Gross Revenue', String(revenueBreakdown.totals.gross_revenue), pctOfRevenue(revenueBreakdown.totals.gross_revenue)]);

      if (revenueBreakdown.discount_categories.length > 0 || revenueBreakdown.refund_categories?.length > 0) {
        csvRows.push(['']);
        csvRows.push(['Less: Deductions']);

        revenueBreakdown.discount_categories.forEach((category) => {
          csvRows.push([category.account_code, category.account_name, String(-Math.abs(category.total_amount)), pctOfRevenue(-Math.abs(category.total_amount))]);
        });

        if (revenueBreakdown.refund_categories) {
          revenueBreakdown.refund_categories.forEach((category) => {
            csvRows.push([category.account_code, category.account_name, String(-Math.abs(category.total_amount)), pctOfRevenue(-Math.abs(category.total_amount))]);
          });
        }
      }

      csvRows.push(['', 'Net Sales Revenue', String(revenueBreakdown.totals.net_revenue), pctOfRevenue(revenueBreakdown.totals.net_revenue)]);

      if (revenueBreakdown.totals.sales_tax > 0 || revenueBreakdown.totals.tips > 0) {
        csvRows.push(['']);
        csvRows.push(['OTHER COLLECTIONS (Pass-Through)']);

        revenueBreakdown.tax_categories.forEach((category) => {
          csvRows.push([category.account_code, `${category.account_name} (Liability)`, String(category.total_amount), pctOfRevenue(category.total_amount)]);
        });

        revenueBreakdown.tip_categories.forEach((category) => {
          csvRows.push([category.account_code, `${category.account_name} (Liability)`, String(category.total_amount), pctOfRevenue(category.total_amount)]);
        });
      }
    } else {
      csvRows.push(['Revenue']);
      incomeData!.revenue.forEach(acc => {
        csvRows.push([acc.account_code, acc.account_name, String(acc.current_balance), pctOfRevenue(acc.current_balance)]);
      });
      csvRows.push(['', 'Total Revenue', String(totalRevenue), pctOfRevenue(totalRevenue)]);
    }

    csvRows.push(['']);

    // COGS Section
    csvRows.push(['COST OF GOODS SOLD']);
    incomeData!.cogs.forEach(acc => {
      csvRows.push([acc.account_code, acc.account_name, String(acc.current_balance), pctOfRevenue(acc.current_balance)]);
    });
    csvRows.push(['', 'Total COGS', String(totalCOGS), pctOfRevenue(totalCOGS)]);
    csvRows.push(['']);
    csvRows.push(['', 'Gross Profit', String(grossProfit), pctOfRevenue(grossProfit)]);
    csvRows.push(['']);

    // Labor Section
    csvRows.push(['LABOR COSTS']);
    laborAccounts.forEach(acc => {
      csvRows.push([acc.account_code, acc.account_name, String(acc.current_balance), pctOfRevenue(acc.current_balance)]);
    });
    csvRows.push(['', 'Total Labor', String(totalLabor), pctOfRevenue(totalLabor)]);
    csvRows.push(['']);
    csvRows.push(['', 'Prime Cost (COGS + Labor)', String(primeCost), pctOfRevenue(primeCost)]);
    csvRows.push(['']);

    // Controllable Expenses Section
    csvRows.push(['CONTROLLABLE EXPENSES']);
    controllableAccounts.forEach(acc => {
      csvRows.push([acc.account_code, acc.account_name, String(acc.current_balance), pctOfRevenue(acc.current_balance)]);
    });
    if (uncatExpenses > 0) {
      csvRows.push(['', 'Uncategorized Expenses', String(uncatExpenses), pctOfRevenue(uncatExpenses)]);
    }
    csvRows.push(['', 'Total Controllable', String(totalControllableWithUncat), pctOfRevenue(totalControllableWithUncat)]);
    csvRows.push(['']);

    // Fixed Expenses Section
    csvRows.push(['NON-CONTROLLABLE / FIXED']);
    fixedAccounts.forEach(acc => {
      csvRows.push([acc.account_code, acc.account_name, String(acc.current_balance), pctOfRevenue(acc.current_balance)]);
    });
    csvRows.push(['', 'Total Fixed', String(totalFixed), pctOfRevenue(totalFixed)]);
    csvRows.push(['']);

    csvRows.push(['', 'Total Operating Expenses', String(totalOperatingExpenses), pctOfRevenue(totalOperatingExpenses)]);
    csvRows.push(['', 'Operating Income', String(operatingIncome), pctOfRevenue(operatingIncome)]);

    if (ebitda !== null) {
      csvRows.push(['', 'EBITDA', String(ebitda), pctOfRevenue(ebitda)]);
    }

    csvRows.push(['']);
    csvRows.push(['', 'Net Income', String(netIncome), pctOfRevenue(netIncome)]);

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

    // Revenue Section
    if (revenueBreakdown && revenueBreakdown.revenue_categories.length > 0) {
      data.push({ label: 'REVENUE', amount: undefined, isBold: true });

      revenueBreakdown.revenue_categories.forEach((category) => {
        data.push({
          label: `${category.account_code} - ${category.account_name}`,
          amount: category.total_amount,
          indent: 1,
          pct: pctOfRevenue(category.total_amount),
        });
      });

      if (uncatRevenue > 0) {
        data.push({
          label: 'Uncategorized Revenue',
          amount: uncatRevenue,
          indent: 1,
          pct: pctOfRevenue(uncatRevenue),
        });
      }

      data.push({ label: 'Gross Revenue', amount: revenueBreakdown.totals.gross_revenue, isSubtotal: true, pct: pctOfRevenue(revenueBreakdown.totals.gross_revenue) });

      if (revenueBreakdown.discount_categories.length > 0 || revenueBreakdown.refund_categories?.length > 0) {
        data.push({ label: '', amount: undefined });
        data.push({ label: 'Less: Deductions', amount: undefined, isBold: true });

        revenueBreakdown.discount_categories.forEach((category) => {
          data.push({
            label: `${category.account_code} - ${category.account_name}`,
            amount: -Math.abs(category.total_amount),
            indent: 1,
            pct: pctOfRevenue(-Math.abs(category.total_amount)),
          });
        });

        if (revenueBreakdown.refund_categories) {
          revenueBreakdown.refund_categories.forEach((category) => {
            data.push({
              label: `${category.account_code} - ${category.account_name}`,
              amount: -Math.abs(category.total_amount),
              indent: 1,
              pct: pctOfRevenue(-Math.abs(category.total_amount)),
            });
          });
        }
      }

      data.push({ label: 'Net Sales Revenue', amount: revenueBreakdown.totals.net_revenue, isSubtotal: true, pct: pctOfRevenue(revenueBreakdown.totals.net_revenue) });

      if (revenueBreakdown.totals.sales_tax > 0 || revenueBreakdown.totals.tips > 0) {
        data.push({ label: '', amount: undefined });
        data.push({ label: 'OTHER COLLECTIONS (Pass-Through)', amount: undefined, isBold: true });

        revenueBreakdown.tax_categories.forEach((category) => {
          data.push({
            label: `${category.account_code} - ${category.account_name} (Liability)`,
            amount: category.total_amount,
            indent: 1,
            pct: pctOfRevenue(category.total_amount),
          });
        });

        revenueBreakdown.tip_categories.forEach((category) => {
          data.push({
            label: `${category.account_code} - ${category.account_name} (Liability)`,
            amount: category.total_amount,
            indent: 1,
            pct: pctOfRevenue(category.total_amount),
          });
        });
      }
    } else {
      data.push({ label: 'REVENUE', amount: undefined, isBold: true });
      incomeData!.revenue.forEach(acc => {
        data.push({
          label: `${acc.account_code} - ${acc.account_name}`,
          amount: acc.current_balance,
          indent: 1,
          pct: pctOfRevenue(acc.current_balance),
        });
      });
      data.push({ label: 'Total Revenue', amount: totalRevenue, isSubtotal: true, pct: pctOfRevenue(totalRevenue) });
    }

    data.push({ label: '', amount: undefined });

    // COGS Section
    data.push({ label: 'COST OF GOODS SOLD', amount: undefined, isBold: true });
    incomeData!.cogs.forEach(acc => {
      data.push({
        label: `${acc.account_code} - ${acc.account_name}`,
        amount: acc.current_balance,
        indent: 1,
        pct: pctOfRevenue(acc.current_balance),
      });
    });
    data.push({ label: 'Total COGS', amount: totalCOGS, isSubtotal: true, pct: pctOfRevenue(totalCOGS) });
    data.push({ label: '', amount: undefined });
    data.push({ label: 'Gross Profit', amount: grossProfit, isTotal: true, pct: pctOfRevenue(grossProfit) });
    data.push({ label: '', amount: undefined });

    // Labor Section
    data.push({ label: 'LABOR COSTS', amount: undefined, isBold: true });
    laborAccounts.forEach(acc => {
      data.push({
        label: `${acc.account_code} - ${acc.account_name}`,
        amount: acc.current_balance,
        indent: 1,
        pct: pctOfRevenue(acc.current_balance),
      });
    });
    data.push({ label: 'Total Labor', amount: totalLabor, isSubtotal: true, pct: pctOfRevenue(totalLabor) });
    data.push({ label: '', amount: undefined });
    data.push({ label: 'Prime Cost (COGS + Labor)', amount: primeCost, isTotal: true, pct: pctOfRevenue(primeCost) });
    data.push({ label: '', amount: undefined });

    // Controllable Expenses Section
    data.push({ label: 'CONTROLLABLE EXPENSES', amount: undefined, isBold: true });
    controllableAccounts.forEach(acc => {
      data.push({
        label: `${acc.account_code} - ${acc.account_name}`,
        amount: acc.current_balance,
        indent: 1,
        pct: pctOfRevenue(acc.current_balance),
      });
    });
    if (uncatExpenses > 0) {
      data.push({
        label: 'Uncategorized Expenses',
        amount: uncatExpenses,
        indent: 1,
        pct: pctOfRevenue(uncatExpenses),
      });
    }
    data.push({ label: 'Total Controllable', amount: totalControllableWithUncat, isSubtotal: true, pct: pctOfRevenue(totalControllableWithUncat) });
    data.push({ label: '', amount: undefined });

    // Fixed Expenses Section
    data.push({ label: 'NON-CONTROLLABLE / FIXED', amount: undefined, isBold: true });
    fixedAccounts.forEach(acc => {
      data.push({
        label: `${acc.account_code} - ${acc.account_name}`,
        amount: acc.current_balance,
        indent: 1,
        pct: pctOfRevenue(acc.current_balance),
      });
    });
    data.push({ label: 'Total Fixed', amount: totalFixed, isSubtotal: true, pct: pctOfRevenue(totalFixed) });
    data.push({ label: '', amount: undefined });

    data.push({ label: 'Total Operating Expenses', amount: totalOperatingExpenses, isSubtotal: true, pct: pctOfRevenue(totalOperatingExpenses) });
    data.push({ label: 'Operating Income', amount: operatingIncome, isTotal: true, pct: pctOfRevenue(operatingIncome) });

    if (ebitda !== null) {
      data.push({ label: 'EBITDA', amount: ebitda, isTotal: true, pct: pctOfRevenue(ebitda) });
    }

    data.push({ label: '', amount: undefined });
    data.push({ label: 'Net Income', amount: netIncome, isTotal: true, pct: pctOfRevenue(netIncome) });

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

  if (isLoading || revenueLoading || unifiedCOGS.isLoading || uncategorized.isLoading) {
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
              {accrualMode === 'actual' && periodIncludesFuture && !glOnly && (
                <span className="ml-2 text-xs text-amber-600">
                  * Payroll through {format(today, 'MMM d, yyyy')}
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center space-x-2">
              <Switch 
                id="accrual-mode" 
                checked={accrualMode === 'projected'} 
                onCheckedChange={(checked) => setAccrualMode(checked ? 'projected' : 'actual')}
                disabled={glOnly}
                aria-label="Toggle between actual and projected payroll"
              />
              <Label htmlFor="accrual-mode" className={glOnly ? 'text-muted-foreground' : ''}>
                {accrualMode === 'projected' ? 'Projected payroll' : 'Actual payroll (to date)'}
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Switch id="gl-only" checked={glOnly} onCheckedChange={setGlOnly} aria-label="Toggle GL-only mode" />
              <Label htmlFor="gl-only">GL-only</Label>
            </div>
            <ExportDropdown onExportCSV={handleExportCSV} onExportPDF={handleExportPDF} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* 1. Completeness Banner */}
          {!glOnly && uncategorized.uncategorizedCount > 0 && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span className="text-[13px] text-amber-700">
                  <strong>{uncategorized.uncategorizedCount}</strong> transactions ({formatCurrency(uncategorized.uncategorizedOutflows + uncategorized.uncategorizedInflows)}) are uncategorized.
                  Uncategorized amounts are included in totals below.
                </span>
              </div>
              <button
                onClick={() => navigate('/transactions')}
                className="text-[13px] font-medium text-amber-700 hover:text-amber-900 underline whitespace-nowrap"
                aria-label="Review uncategorized transactions"
              >
                Review Transactions
              </button>
            </div>
          )}

          {/* 2. REVENUE */}
          <div>
            <h3 className="text-[17px] font-semibold text-foreground mb-3">REVENUE</h3>
            <div className="space-y-2">
              {revenueBreakdown && revenueBreakdown.revenue_categories.length > 0 ? (
                <>
                  {/* Revenue Categories from POS Sales */}
                  {revenueBreakdown.revenue_categories.map((category) => (
                    <LineItem key={category.account_id} code={category.account_code} name={category.account_name} amount={category.total_amount} pct={pctOfRevenue(category.total_amount)} formatCurrency={formatCurrency} />
                  ))}

                  {/* Uncategorized revenue amber row */}
                  {uncatRevenue > 0 && (
                    <div className="flex justify-between items-center py-2 px-3 rounded-lg bg-amber-500/10">
                      <div className="flex items-center gap-3">
                        <span className="text-amber-600 text-[14px]">Uncategorized Revenue</span>
                        <span className="text-[11px] text-amber-600 font-medium">(uncategorized)</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-medium text-amber-600">{formatCurrency(uncatRevenue)}</span>
                        <span className="text-xs text-muted-foreground w-14 text-right">{pctOfRevenue(uncatRevenue)}</span>
                      </div>
                    </div>
                  )}

                  <SubtotalRow label="Gross Revenue" amount={revenueBreakdown.totals.gross_revenue} pct={pctOfRevenue(revenueBreakdown.totals.gross_revenue)} formatCurrency={formatCurrency} />

                  {/* Discounts, Refunds & Comps */}
                  {(revenueBreakdown.discount_categories.length > 0 || revenueBreakdown.refund_categories?.length > 0) && (
                    <div className="mt-2">
                      <div className="text-sm text-muted-foreground mb-1 px-3">Less: Deductions</div>
                      {revenueBreakdown.discount_categories.map((category) => (
                        <LineItem key={category.account_id} code={category.account_code} name={category.account_name} amount={category.total_amount} pct={pctOfRevenue(-Math.abs(category.total_amount))} formatCurrency={formatCurrency} variant="deduction" />
                      ))}
                      {revenueBreakdown.refund_categories?.map((category) => (
                        <LineItem key={category.account_id} code={category.account_code} name={category.account_name} amount={category.total_amount} pct={pctOfRevenue(-Math.abs(category.total_amount))} formatCurrency={formatCurrency} variant="deduction" />
                      ))}
                    </div>
                  )}

                  {/* Net Revenue */}
                  <SubtotalRow label="Net Sales Revenue" amount={revenueBreakdown.totals.net_revenue} pct={pctOfRevenue(revenueBreakdown.totals.net_revenue)} formatCurrency={formatCurrency} borderClass="border-t-2" />

                  {/* Pass-Through Collections */}
                  {(revenueBreakdown.totals.sales_tax > 0 || revenueBreakdown.totals.tips > 0) && (
                    <div className="mt-4 pt-4 border-t">
                      <div className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wide px-3">
                        OTHER COLLECTIONS (Pass-Through)
                      </div>
                      <div className="bg-muted/30 rounded-lg p-3 space-y-1">
                        {revenueBreakdown.tax_categories.map((category) => (
                          <LineItem key={category.account_id} code={category.account_code} name={category.account_name} amount={category.total_amount} pct={pctOfRevenue(category.total_amount)} formatCurrency={formatCurrency} variant="liability" />
                        ))}
                        {revenueBreakdown.tip_categories.map((category) => (
                          <LineItem key={category.account_id} code={category.account_code} name={category.account_name} amount={category.total_amount} pct={pctOfRevenue(category.total_amount)} formatCurrency={formatCurrency} variant="liability" />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* Fallback to journal entries if no POS categorization */
                <>
                  {incomeData?.revenue.map((account) => (
                    <LineItem key={account.id} code={account.account_code} name={account.account_name} amount={account.current_balance} pct={pctOfRevenue(account.current_balance)} formatCurrency={formatCurrency} />
                  ))}
                  <SubtotalRow label="Total Revenue" amount={totalRevenue} pct={pctOfRevenue(totalRevenue)} formatCurrency={formatCurrency} />
                </>
              )}
            </div>
          </div>

          {/* 3. COGS */}
          <div>
            <h3 className="text-[17px] font-semibold text-foreground mb-3">COST OF GOODS SOLD</h3>
            <div className="space-y-2">
              {incomeData?.cogs.map((account) => (
                <LineItem key={account.id} code={account.account_code} name={account.account_name} amount={account.current_balance} pct={pctOfRevenue(account.current_balance)} formatCurrency={formatCurrency} />
              ))}
              <SubtotalRow label="Total COGS" amount={totalCOGS} pct={pctOfRevenue(totalCOGS)} formatCurrency={formatCurrency} />
            </div>
          </div>

          {/* 4. Gross Profit highlight */}
          <HighlightRow label="Gross Profit" amount={grossProfit} pct={pctOfRevenue(grossProfit)} formatCurrency={formatCurrency} colorBySign className="bg-muted" />

          {/* 5. LABOR COSTS */}
          <div>
            <h3 className="text-[17px] font-semibold text-foreground mb-3">LABOR COSTS</h3>
            <div className="space-y-2">
              {laborAccounts.map((account) => (
                <LineItem key={account.id} code={account.account_code} name={account.account_name} amount={account.current_balance} pct={pctOfRevenue(account.current_balance)} formatCurrency={formatCurrency} />
              ))}
              <SubtotalRow label="Total Labor" amount={totalLabor} pct={pctOfRevenue(totalLabor)} formatCurrency={formatCurrency} />
            </div>
          </div>

          {/* 6. PRIME COST highlight */}
          <HighlightRow label="Prime Cost (COGS + Labor)" amount={primeCost} pct={pctOfRevenue(primeCost)} formatCurrency={formatCurrency} className="bg-amber-500/5 border border-amber-500/10" />

          {/* 7. CONTROLLABLE EXPENSES */}
          <div>
            <h3 className="text-[17px] font-semibold text-foreground mb-3">CONTROLLABLE EXPENSES</h3>
            <div className="space-y-2">
              {controllableAccounts.map((account) => (
                <LineItem key={account.id} code={account.account_code} name={account.account_name} amount={account.current_balance} pct={pctOfRevenue(account.current_balance)} formatCurrency={formatCurrency} />
              ))}
              {/* Uncategorized expenses amber row */}
              {uncatExpenses > 0 && (
                <div className="flex justify-between items-center py-2 px-3 rounded-lg bg-amber-500/10">
                  <div className="flex items-center gap-3">
                    <span className="text-amber-600 text-[14px]">Uncategorized Expenses</span>
                    <span className="text-[11px] text-amber-600 font-medium">(uncategorized)</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-medium text-amber-600">{formatCurrency(uncatExpenses)}</span>
                    <span className="text-xs text-muted-foreground w-14 text-right">{pctOfRevenue(uncatExpenses)}</span>
                  </div>
                </div>
              )}
              <SubtotalRow label="Total Controllable" amount={totalControllableWithUncat} pct={pctOfRevenue(totalControllableWithUncat)} formatCurrency={formatCurrency} />
            </div>
          </div>

          {/* 8. NON-CONTROLLABLE / FIXED */}
          <div>
            <h3 className="text-[17px] font-semibold text-foreground mb-3">NON-CONTROLLABLE / FIXED</h3>
            <div className="space-y-2">
              {fixedAccounts.map((account) => (
                <LineItem key={account.id} code={account.account_code} name={account.account_name} amount={account.current_balance} pct={pctOfRevenue(account.current_balance)} formatCurrency={formatCurrency} />
              ))}
              <SubtotalRow label="Total Fixed" amount={totalFixed} pct={pctOfRevenue(totalFixed)} formatCurrency={formatCurrency} />
            </div>
          </div>

          {/* 9. Total Operating Expenses */}
          <SubtotalRow label="Total Operating Expenses" amount={totalOperatingExpenses} pct={pctOfRevenue(totalOperatingExpenses)} formatCurrency={formatCurrency} borderClass="border-t-2 text-base" />

          {/* 10. Operating Income highlight */}
          <HighlightRow label="Operating Income" amount={operatingIncome} pct={pctOfRevenue(operatingIncome)} formatCurrency={formatCurrency} colorBySign className="bg-muted" />

          {/* 11. EBITDA (only if depreciation accounts exist) */}
          {ebitda !== null && (
            <HighlightRow label="EBITDA" amount={ebitda} pct={pctOfRevenue(ebitda)} formatCurrency={formatCurrency} colorBySign className="bg-muted" />
          )}

          {/* 12. Net Income highlight */}
          <HighlightRow label="Net Income" amount={netIncome} pct={pctOfRevenue(netIncome)} formatCurrency={formatCurrency} colorBySign className="bg-muted" />
        </div>
      </CardContent>
    </Card>
  );
}
