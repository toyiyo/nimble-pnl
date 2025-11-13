import { Fragment, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, AlertTriangle, Info } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format, parse, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { useRevenueBreakdown } from "@/hooks/useRevenueBreakdown";
import { useMonthlyExpenses } from "@/hooks/useMonthlyExpenses";
import { useRestaurantContext } from "@/contexts/RestaurantContext";

interface MonthlyData {
  period: string;
  gross_revenue: number;
  total_collected_at_pos: number;
  net_revenue: number;
  discounts: number;
  refunds: number;
  sales_tax: number;
  tips: number;
  other_liabilities: number;
  food_cost: number;
  labor_cost: number;
  has_data: boolean;
}

interface MonthlyBreakdownTableProps {
  monthlyData: MonthlyData[];
}

type MonthlyRow = MonthlyData & { profitChangePercent: number | null };

export const MonthlyBreakdownTable = ({ monthlyData }: MonthlyBreakdownTableProps) => {
  const { selectedRestaurant } = useRestaurantContext();
  const navigate = useNavigate();
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  // Fetch expense data for the period covering all months in monthlyData
  const dateFrom = monthlyData.length > 0 
    ? startOfMonth(parse(monthlyData[monthlyData.length - 1].period, 'yyyy-MM', new Date()))
    : subMonths(new Date(), 12);
  const dateTo = monthlyData.length > 0
    ? endOfMonth(parse(monthlyData[0].period, 'yyyy-MM', new Date()))
    : new Date();

  const { data: expenseData } = useMonthlyExpenses(
    selectedRestaurant?.restaurant_id || null,
    dateFrom,
    dateTo
  );

  // Fetch revenue breakdown only for the expanded month
  const expandedMonthDate = expandedMonth ? parse(expandedMonth, 'yyyy-MM', new Date()) : null;
  const { data: expandedBreakdown } = useRevenueBreakdown(
    selectedRestaurant?.restaurant_id || null,
    expandedMonthDate ? startOfMonth(expandedMonthDate) : new Date(),
    expandedMonthDate ? endOfMonth(expandedMonthDate) : new Date()
  );

  // Helper to get breakdown for the expanded month
  const getBreakdownForMonth = (period: string) => {
    return period === expandedMonth ? expandedBreakdown : null;
  };

  // Helper to get expense data for a specific month
  const getExpenseDataForMonth = (period: string) => {
    return expenseData?.find(e => e.period === period);
  };

  // Calculate profit change vs prior period
  // Note: We can't reliably calculate this without fetching all months' revenue data
  // For now, we'll calculate based on the monthlyData net_revenue values
  const dataWithComparison: MonthlyRow[] = useMemo(() => {
    return monthlyData.map((month, index) => {
      const priorMonth = monthlyData[index + 1];
      
      const currentNet = month.net_revenue;
      const priorNet = priorMonth?.net_revenue || 0;
      
      const profitChange = priorNet !== 0
        ? ((currentNet - priorNet) / Math.abs(priorNet)) * 100
        : null;
      
      return {
        ...month,
        profitChangePercent: profitChange,
      };
    });
  }, [monthlyData]);

  const toggleMonthExpansion = (period: string) => {
    setExpandedMonth(expandedMonth === period ? null : period);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatMonth = (period: string) => {
    try {
      const date = parse(period, 'yyyy-MM', new Date());
      return format(date, 'MMM yyyy');
    } catch {
      return period;
    }
  };

  const getTrendIcon = (change: number | null) => {
    if (change === null) return <Minus aria-hidden="true" className="h-3 w-3" />;
    if (change > 0) return <TrendingUp aria-hidden="true" className="h-3 w-3" />;
    if (change < 0) return <TrendingDown aria-hidden="true" className="h-3 w-3" />;
    return <Minus aria-hidden="true" className="h-3 w-3" />;
  };

  const getTrendVariant = (change: number | null): "default" | "secondary" | "destructive" => {
    if (change === null || change === 0) return "secondary";
    if (change > 0) return "default";
    return "destructive";
  };

  if (!monthlyData || monthlyData.length === 0) {
    return (
      <Card className="animate-fade-in">
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            Monthly Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 space-y-3">
            <p className="text-sm font-medium text-muted-foreground">
              No monthly data available yet
            </p>
            <p className="text-xs text-muted-foreground">
              Start tracking your performance to see monthly breakdowns
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="animate-fade-in">
      <CardHeader>
        <CardTitle className="text-base sm:text-xl flex items-center gap-2">
          <div className="h-1 w-6 sm:w-8 bg-gradient-to-r from-primary to-primary/50 rounded-full" />
          Monthly Performance
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <ScrollArea className="w-full">
          <div className="min-w-[650px] sm:min-w-[800px]">
            <table className="w-full">
              <caption className="sr-only">
                Monthly performance breakdown with revenue, costs, profit, and month-over-month change.
              </caption>
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground w-8"></th>
                  <th className="text-left py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    Month
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    <span className="hidden sm:inline">Collected at POS</span>
                    <span className="sm:hidden">POS</span>
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    <span className="hidden sm:inline">Gross Revenue</span>
                    <span className="sm:hidden">Revenue</span>
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    <span className="hidden sm:inline">Discounts</span>
                    <span className="sm:hidden">Disc</span>
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    <span className="hidden sm:inline">Net Revenue</span>
                    <span className="sm:hidden">Net Rev</span>
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    COGS
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    Labor
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    <span className="hidden sm:inline">Other Expenses</span>
                    <span className="sm:hidden">Other</span>
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    <span className="hidden sm:inline">Net Profit</span>
                    <span className="sm:hidden">Profit</span>
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    <span className="hidden sm:inline">vs Prior</span>
                    <span className="sm:hidden">Δ</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {dataWithComparison.map((month, index) => {
                  const isExpanded = expandedMonth === month.period;
                  const monthDate = parse(month.period, 'yyyy-MM', new Date());
                  const expenseMonth = getExpenseDataForMonth(month.period);
                  
                  // Use expense data from bank transactions (preferred source)
                  // Food/labor costs now come from source tables via useMonthlyMetrics
                  const foodCost = expenseMonth?.foodCost || month.food_cost;
                  const laborCost = expenseMonth?.laborCost || month.labor_cost;
                  const totalExpenses = expenseMonth?.totalExpenses || (month.food_cost + month.labor_cost);
                  const otherExpenses = totalExpenses - foodCost - laborCost;
                  
                  const foodCostPercent = month.net_revenue > 0 
                    ? (foodCost / month.net_revenue) * 100 
                    : 0;
                  const laborCostPercent = month.net_revenue > 0 
                    ? (laborCost / month.net_revenue) * 100 
                    : 0;
                  
                  return (
                    <Fragment key={month.period}>
                      <tr
                        key={month.period}
                        className={`border-b border-border/50 hover:bg-muted/50 transition-colors ${
                          index % 2 === 0 ? 'bg-muted/20' : ''
                        } ${isExpanded ? 'bg-primary/5' : ''}`}
                      >
                        <td className="py-2 px-2 sm:py-3 sm:px-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => toggleMonthExpansion(month.period)}
                            aria-label={isExpanded ? "Collapse revenue details" : "Expand revenue details"}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-3 w-3" />
                            ) : (
                              <ChevronDown className="h-3 w-3" />
                            )}
                          </Button>
                        </td>
                        <td className="py-2 px-2 sm:py-3 sm:px-4">
                          <span className="font-medium text-xs sm:text-sm">{formatMonth(month.period)}</span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          <span className="font-semibold text-xs sm:text-sm text-blue-600">
                            {formatCurrency(month.total_collected_at_pos)}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          <span className="font-semibold text-xs sm:text-sm text-emerald-600">
                            {formatCurrency(month.gross_revenue)}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          <span className="font-semibold text-xs sm:text-sm text-red-600">
                            {formatCurrency(month.discounts)}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          <span className="font-semibold text-xs sm:text-sm">
                            {formatCurrency(month.net_revenue)}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          <div className="flex flex-col items-end gap-0.5 sm:gap-1">
                            <span className="font-semibold text-xs sm:text-sm">{formatCurrency(foodCost)}</span>
                            <span className="text-[10px] sm:text-xs text-muted-foreground">
                              {foodCostPercent.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          <div className="flex flex-col items-end gap-0.5 sm:gap-1">
                            <span className="font-semibold text-xs sm:text-sm">{formatCurrency(laborCost)}</span>
                            <span className="text-[10px] sm:text-xs text-muted-foreground">
                              {laborCostPercent.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          <div className="flex flex-col items-end gap-0.5 sm:gap-1">
                            <span className="font-semibold text-xs sm:text-sm">{formatCurrency(otherExpenses)}</span>
                            <span className="text-[10px] sm:text-xs text-muted-foreground">
                              {month.net_revenue > 0 ? ((otherExpenses / month.net_revenue) * 100).toFixed(1) : '0.0'}%
                            </span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          {(() => {
                            const netRevenue = month.net_revenue;
                            const profit = netRevenue - totalExpenses;
                            const profitMargin = netRevenue > 0 ? (profit / netRevenue) * 100 : 0;
                            
                            return (
                              <div className="flex flex-col items-end gap-0.5 sm:gap-1">
                                <span className={`font-bold text-xs sm:text-sm ${
                                  profit > 0 
                                    ? 'text-primary' 
                                    : profit < 0 
                                    ? 'text-destructive'
                                    : 'text-foreground'
                                }`}>
                                  {formatCurrency(profit)}
                                </span>
                                <span className="text-[10px] sm:text-xs text-muted-foreground">
                                  {profitMargin.toFixed(1)}%
                                </span>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          {month.profitChangePercent !== null ? (
                            <Badge 
                              variant={getTrendVariant(month.profitChangePercent)}
                              className="gap-0.5 sm:gap-1 font-semibold text-[10px] sm:text-xs px-1.5 sm:px-2.5"
                              aria-label={`${
                                month.profitChangePercent > 0 
                                  ? 'Profit up' 
                                  : month.profitChangePercent < 0 
                                  ? 'Profit down' 
                                  : 'No change'
                              } ${Math.abs(month.profitChangePercent).toFixed(1)}% versus prior month`}
                            >
                              {getTrendIcon(month.profitChangePercent)}
                              <span className="hidden sm:inline">
                                {month.profitChangePercent > 0 ? '+' : ''}
                                {month.profitChangePercent.toFixed(1)}%
                              </span>
                              <span className="sm:hidden">
                                {month.profitChangePercent > 0 ? '+' : ''}
                                {Math.round(month.profitChangePercent)}%
                              </span>
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-0.5 sm:gap-1 text-[10px] sm:text-xs px-1.5 sm:px-2.5" aria-label="First month">
                              <Minus aria-hidden="true" className="h-2 w-2 sm:h-3 sm:w-3" />
                              <span className="hidden sm:inline">First Month</span>
                              <span className="sm:hidden">N/A</span>
                            </Badge>
                          )}
                        </td>
                       </tr>
                       
                       {/* Pass-through collections row (collapsed view) */}
                       {!isExpanded && (month.sales_tax > 0 || month.tips > 0 || month.other_liabilities > 0) && (
                         <tr className="border-b border-border/30 bg-amber-50/30 dark:bg-amber-950/10">
                           <td colSpan={2} className="py-1 px-4 text-xs text-muted-foreground">
                             <span className="ml-6">Pass-Through Collections:</span>
                           </td>
                           <td colSpan={9} className="py-1 px-2 text-xs">
                             <div className="flex gap-4 text-amber-600 dark:text-amber-400">
                               {month.sales_tax > 0 && (
                                 <span>Sales Tax: {formatCurrency(month.sales_tax)}</span>
                               )}
                               {month.tips > 0 && (
                                 <span>Tips: {formatCurrency(month.tips)}</span>
                               )}
                               {month.other_liabilities > 0 && (
                                 <span>Other: {formatCurrency(month.other_liabilities)}</span>
                               )}
                             </div>
                           </td>
                         </tr>
                       )}

                       {/* Expanded Revenue Detail Row */}
                       {isExpanded && (() => {
                        const breakdown = getBreakdownForMonth(month.period);
                        if (!breakdown) return null;
                        
                        return (
                          <tr className="bg-primary/5 border-b border-border/50">
                            <td colSpan={11} className="py-4 px-4 sm:px-8">
                              <div className="space-y-4">
                                {!month.has_data ? (
                                <div className="text-center py-8 space-y-2">
                                  <p className="text-sm font-medium text-muted-foreground">
                                    No categorized sales data for this month
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Categorize your POS sales to see detailed revenue breakdown
                                  </p>
                                </div>
                              ) : (
                                <>
                                  {/* Data Availability Warnings */}
                                  {(month.food_cost === 0 && month.labor_cost === 0) && (
                                    <div className="flex items-start gap-2 p-3 rounded bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                                      <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                                      <div className="text-xs text-blue-700 dark:text-blue-400 space-y-1">
                                        <p className="font-semibold">No cost data available for this month</p>
                                        <p>Profit calculation requires food costs (from inventory/suppliers) and labor costs (from integrations or manual entry).</p>
                                      </div>
                                    </div>
                                  )}

                                  {/* Uncategorized Revenue Warning */}
                                  {breakdown.uncategorized_revenue > 0 && (
                                    <div className="flex items-start gap-2 p-3 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                                      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                                      <div className="text-xs text-amber-700 dark:text-amber-400 space-y-2">
                                        <div>
                                          <span className="font-semibold">Uncategorized Sales: {formatCurrency(breakdown.uncategorized_revenue)}</span>
                                          <span className="ml-1">({(100 - breakdown.categorization_rate).toFixed(0)}% of total)</span>
                                        </div>
                                        <p>These sales haven't been categorized yet. Categorize them to see detailed revenue breakdown and accurate profit calculations.</p>
                                        <Button 
                                          size="sm" 
                                          variant="outline"
                                          className="h-7 text-xs"
                                          onClick={() => navigate('/pos-sales')}
                                        >
                                          Categorize Sales →
                                        </Button>
                                      </div>
                                    </div>
                                  )}

                                   {/* Revenue Breakdown */}
                                  {breakdown.revenue_categories.length > 0 && (
                                    <div>
                                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                        Revenue Breakdown
                                        {breakdown.uncategorized_revenue > 0 && (
                                          <span className="ml-2 text-[10px] text-amber-600">
                                            (Categorized: {formatCurrency(breakdown.totals.categorized_revenue)})
                                          </span>
                                        )}
                                      </h4>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                        {breakdown.revenue_categories.map((cat) => (
                                          <div 
                                            key={cat.account_id}
                                            className="flex items-center justify-between p-2 rounded bg-background/50 text-xs"
                                          >
                                            <div className="flex-1 min-w-0">
                                              <span className="font-medium truncate block">{cat.account_name}</span>
                                              <span className="text-[10px] text-muted-foreground">{cat.account_code}</span>
                                            </div>
                                            <span className="font-semibold text-emerald-600 ml-2">
                                              {formatCurrency(cat.total_amount)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                      <div className="mt-2 flex justify-between text-xs">
                                        <span className="text-muted-foreground">Categorized Total:</span>
                                        <span className="font-semibold text-emerald-600">
                                          {formatCurrency(breakdown.totals.categorized_revenue)}
                                        </span>
                                      </div>
                                      {breakdown.uncategorized_revenue > 0 && (
                                        <>
                                          <div className="mt-1 flex justify-between text-xs">
                                            <span className="text-amber-600">Uncategorized:</span>
                                            <span className="font-semibold text-amber-600">
                                              {formatCurrency(breakdown.uncategorized_revenue)}
                                            </span>
                                          </div>
                                          <div className="mt-1 pt-1 border-t flex justify-between text-xs">
                                            <span className="font-semibold text-muted-foreground">Gross Revenue:</span>
                                            <span className="font-bold text-emerald-600">
                                              {formatCurrency(breakdown.totals.gross_revenue)}
                                            </span>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )}

                                  {/* Expense Breakdown */}
                                  {expenseMonth && expenseMonth.categories.length > 0 && (
                                    <div>
                                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                        Expense Breakdown (from Bank Transactions)
                                      </h4>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                        {expenseMonth.categories.map((cat, idx) => (
                                          <div 
                                            key={idx}
                                            className="flex items-center justify-between p-2 rounded bg-background/50 text-xs"
                                          >
                                            <div className="flex-1 min-w-0">
                                              <span className="font-medium truncate block">{cat.category}</span>
                                              <span className="text-[10px] text-muted-foreground">{cat.transactionCount} transactions</span>
                                            </div>
                                            <span className="font-semibold text-red-600 ml-2">
                                              {formatCurrency(cat.amount)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                      <div className="mt-2 flex justify-between text-xs">
                                        <span className="text-muted-foreground">Total Expenses:</span>
                                        <span className="font-semibold text-red-600">
                                          {formatCurrency(expenseMonth.totalExpenses)}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                </>
                              )}

                              {/* Deductions */}
                              {breakdown?.totals && (breakdown.totals.total_discounts > 0 || breakdown.totals.total_refunds > 0) && (
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Deductions
                                  </h4>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {breakdown.totals.total_discounts > 0 && (
                                      <div className="flex items-center justify-between p-2 rounded bg-red-50 dark:bg-red-950/20 text-xs">
                                        <span className="font-medium">Discounts & Comps</span>
                                        <span className="font-semibold text-red-600">
                                          -{formatCurrency(breakdown.totals.total_discounts)}
                                        </span>
                                      </div>
                                    )}
                                    {breakdown.totals.total_refunds > 0 && (
                                      <div className="flex items-center justify-between p-2 rounded bg-red-50 dark:bg-red-950/20 text-xs">
                                        <span className="font-medium">Refunds</span>
                                        <span className="font-semibold text-red-600">
                                          -{formatCurrency(breakdown.totals.total_refunds)}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Collected at POS Summary */}
                              {breakdown?.totals && (
                                <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                                  <div className="flex justify-between items-center mb-2">
                                    <div className="flex items-center gap-2">
                                      <Info className="h-4 w-4 text-blue-600" />
                                      <span className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                                        Total Collected at POS
                                      </span>
                                    </div>
                                    <span className="text-lg font-bold text-blue-600">
                                      {formatCurrency(breakdown.totals.total_collected_at_pos)}
                                    </span>
                                  </div>
                                  <p className="text-xs text-blue-700 dark:text-blue-300 mb-3">
                                    This is the total amount of money collected through your POS system
                                  </p>
                                  <div className="space-y-2 pl-6">
                                    <div className="flex justify-between text-xs">
                                      <span className="text-blue-700 dark:text-blue-300">Revenue (Your Money):</span>
                                      <span className="font-semibold text-emerald-600">
                                        {formatCurrency(breakdown.totals.gross_revenue)}
                                      </span>
                                    </div>
                                    {(breakdown.totals.sales_tax > 0 || breakdown.totals.tips > 0 || breakdown.totals.other_liabilities > 0) && (
                                      <div className="flex justify-between text-xs">
                                        <span className="text-blue-700 dark:text-blue-300">Pass-Through Collections:</span>
                                        <span className="font-semibold text-amber-600">
                                          {formatCurrency(
                                            breakdown.totals.sales_tax + 
                                            breakdown.totals.tips + 
                                            breakdown.totals.other_liabilities
                                          )}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Pass-Through Collections */}
                              {breakdown?.totals && (breakdown.totals.sales_tax > 0 || breakdown.totals.tips > 0 || breakdown.totals.other_liabilities > 0) && (
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Pass-Through Collections (Not Revenue)
                                  </h4>
                                  <p className="text-[10px] text-muted-foreground mb-2">
                                    These amounts are collected on behalf of others and should not be included in your revenue totals.
                                  </p>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {breakdown.totals.sales_tax > 0 && (
                                      <div className="flex items-center justify-between p-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-xs">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium">Sales Tax Collected</span>
                                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-600">
                                            Liability
                                          </Badge>
                                        </div>
                                        <span className="font-semibold text-amber-700">
                                          {formatCurrency(breakdown.totals.sales_tax)}
                                        </span>
                                      </div>
                                    )}
                                    {breakdown.totals.tips > 0 && (
                                      <div className="flex items-center justify-between p-2 rounded bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-xs">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium">Tips Collected</span>
                                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-blue-600">
                                            Liability
                                          </Badge>
                                        </div>
                                        <span className="font-semibold text-blue-700">
                                          {formatCurrency(breakdown.totals.tips)}
                                        </span>
                                      </div>
                                    )}
                                    {breakdown.totals.other_liabilities > 0 && breakdown.adjustments
                                      .filter(adj => adj.adjustment_type === 'service_charge' || adj.adjustment_type === 'fee')
                                      .map((adjustment, idx) => (
                                      <div key={idx} className="flex items-center justify-between p-2 rounded bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 text-xs">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium">
                                            {adjustment.adjustment_type === 'service_charge' ? 'Service Charges' : 'Fees'}
                                          </span>
                                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-purple-600">
                                            Liability
                                          </Badge>
                                        </div>
                                        <span className="font-semibold text-purple-700">
                                          {formatCurrency(adjustment.total_amount)}
                                        </span>
                                      </div>
                                    ))}
                                    {breakdown.other_liability_categories.map((category) => (
                                      <div key={category.account_id} className="flex items-center justify-between p-2 rounded bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 text-xs">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium">{category.account_name}</span>
                                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-purple-600">
                                            Liability
                                          </Badge>
                                        </div>
                                        <span className="font-semibold text-purple-700">
                                          {formatCurrency(category.total_amount)}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                        );
                      })()}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
