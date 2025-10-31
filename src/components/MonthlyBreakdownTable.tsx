import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { format, parse, startOfMonth, endOfMonth } from "date-fns";
import { useRevenueBreakdown } from "@/hooks/useRevenueBreakdown";
import { useRestaurantContext } from "@/contexts/RestaurantContext";

interface MonthlyData {
  period: string;
  net_revenue: number;
  food_cost: number;
  labor_cost: number;
  gross_profit: number;
}

interface MonthlyBreakdownTableProps {
  monthlyData: MonthlyData[];
}

type MonthlyRow = MonthlyData & { profitChangePercent: number | null };

export const MonthlyBreakdownTable = ({ monthlyData }: MonthlyBreakdownTableProps) => {
  const { selectedRestaurant } = useRestaurantContext();
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  // Get revenue breakdown for the expanded month
  const expandedMonthDate = useMemo(() => {
    if (!expandedMonth) return null;
    try {
      return parse(expandedMonth, 'yyyy-MM', new Date());
    } catch {
      return null;
    }
  }, [expandedMonth]);

  const { data: expandedMonthRevenue } = useRevenueBreakdown(
    selectedRestaurant?.restaurant_id || null,
    expandedMonthDate ? startOfMonth(expandedMonthDate) : new Date(),
    expandedMonthDate ? endOfMonth(expandedMonthDate) : new Date()
  );

  // Calculate profit change vs prior period
  const dataWithComparison: MonthlyRow[] = useMemo(
    () => monthlyData.map((month, index) => {
      const priorMonth = monthlyData[index + 1];
      const profitChange = priorMonth && priorMonth.gross_profit !== 0
        ? ((month.gross_profit - priorMonth.gross_profit) / Math.abs(priorMonth.gross_profit)) * 100
        : null;
      
      return {
        ...month,
        profitChangePercent: profitChange,
      };
    }),
    [monthlyData]
  );

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
                    Gross Revenue
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    <span className="hidden sm:inline">Discounts</span>
                    <span className="sm:hidden">Disc</span>
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    Net Revenue
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    <span className="hidden sm:inline">Food Cost</span>
                    <span className="sm:hidden">COGS</span>
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    Labor
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    Profit
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
                  
                  const foodCostPercent = month.net_revenue > 0 
                    ? (month.food_cost / month.net_revenue) * 100 
                    : 0;
                  const laborCostPercent = month.net_revenue > 0 
                    ? (month.labor_cost / month.net_revenue) * 100 
                    : 0;
                  
                  return (
                    <>
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
                          <span className="font-semibold text-xs sm:text-sm text-emerald-600">
                            {formatCurrency((isExpanded && expandedMonthRevenue?.totals?.gross_revenue) || month.net_revenue)}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          <span className="font-semibold text-xs sm:text-sm text-red-600">
                            {isExpanded && expandedMonthRevenue?.totals?.total_discounts 
                              ? `-${formatCurrency(expandedMonthRevenue.totals.total_discounts)}` 
                              : '$0'
                            }
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          <span className="font-semibold text-xs sm:text-sm">{formatCurrency(month.net_revenue)}</span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          <div className="flex flex-col items-end gap-0.5 sm:gap-1">
                            <span className="font-semibold text-xs sm:text-sm">{formatCurrency(month.food_cost)}</span>
                            <span className="text-[10px] sm:text-xs text-muted-foreground">
                              {foodCostPercent.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          <div className="flex flex-col items-end gap-0.5 sm:gap-1">
                            <span className="font-semibold text-xs sm:text-sm">{formatCurrency(month.labor_cost)}</span>
                            <span className="text-[10px] sm:text-xs text-muted-foreground">
                              {laborCostPercent.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-4">
                          <span className={`font-bold text-xs sm:text-sm ${
                            month.gross_profit > 0 
                              ? 'text-primary' 
                              : month.gross_profit < 0 
                              ? 'text-destructive'
                              : 'text-foreground'
                          }`}>
                            {formatCurrency(month.gross_profit)}
                          </span>
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
                            <Badge variant="secondary" className="gap-0.5 sm:gap-1 text-[10px] sm:text-xs px-1.5 sm:px-2.5" aria-label="No prior period data">
                              <Minus aria-hidden="true" className="h-2 w-2 sm:h-3 sm:w-3" />
                              N/A
                            </Badge>
                          )}
                        </td>
                      </tr>
                      
                      {/* Expanded Revenue Detail Row */}
                      {isExpanded && expandedMonthRevenue && (
                        <tr className="bg-primary/5 border-b border-border/50">
                          <td colSpan={9} className="py-4 px-4 sm:px-8">
                            <div className="space-y-4">
                              {!expandedMonthRevenue.has_categorization_data ? (
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
                                  {/* Categorization Status */}
                                  {expandedMonthRevenue.categorization_rate < 100 && (
                                    <div className="flex items-center gap-2 p-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                                      <span className="text-xs text-amber-700 dark:text-amber-400">
                                        Only {expandedMonthRevenue.categorization_rate.toFixed(0)}% of sales are categorized. 
                                        <span className="font-semibold"> Categorize remaining items for accurate breakdown.</span>
                                      </span>
                                    </div>
                                  )}

                                  {/* Revenue Breakdown */}
                                  <div>
                                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                      Revenue Breakdown (Categorized Sales)
                                    </h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                      {expandedMonthRevenue.revenue_categories.map((cat) => (
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
                                    <div className="mt-2 flex justify-end">
                                      <div className="text-xs text-muted-foreground">
                                        Total: <span className="font-semibold text-emerald-600">{formatCurrency(expandedMonthRevenue.totals.gross_revenue)}</span>
                                      </div>
                                    </div>
                                  </div>
                                </>
                              )}

                              {/* Deductions */}
                              {expandedMonthRevenue?.totals && (expandedMonthRevenue.totals.total_discounts > 0 || expandedMonthRevenue.totals.total_refunds > 0) && (
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Deductions
                                  </h4>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {expandedMonthRevenue.totals.total_discounts > 0 && (
                                      <div className="flex items-center justify-between p-2 rounded bg-red-50 dark:bg-red-950/20 text-xs">
                                        <span className="font-medium">Discounts & Comps</span>
                                        <span className="font-semibold text-red-600">
                                          -{formatCurrency(expandedMonthRevenue.totals.total_discounts)}
                                        </span>
                                      </div>
                                    )}
                                    {expandedMonthRevenue.totals.total_refunds > 0 && (
                                      <div className="flex items-center justify-between p-2 rounded bg-red-50 dark:bg-red-950/20 text-xs">
                                        <span className="font-medium">Refunds</span>
                                        <span className="font-semibold text-red-600">
                                          -{formatCurrency(expandedMonthRevenue.totals.total_refunds)}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Pass-Through Collections */}
                              {expandedMonthRevenue?.has_categorization_data && expandedMonthRevenue?.totals && (expandedMonthRevenue.totals.sales_tax > 0 || expandedMonthRevenue.totals.tips > 0 || expandedMonthRevenue.totals.other_liabilities > 0) && (
                                <div>
                                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                    Pass-Through Collections (Not Revenue)
                                  </h4>
                                  <p className="text-[10px] text-muted-foreground mb-2">
                                    These amounts are collected on behalf of others and should not be included in your revenue totals.
                                  </p>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {expandedMonthRevenue.totals.sales_tax > 0 && (
                                      <div className="flex items-center justify-between p-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-xs">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium">Sales Tax Collected</span>
                                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-600">
                                            Liability
                                          </Badge>
                                        </div>
                                        <span className="font-semibold text-amber-700">
                                          {formatCurrency(expandedMonthRevenue.totals.sales_tax)}
                                        </span>
                                      </div>
                                    )}
                                    {expandedMonthRevenue.totals.tips > 0 && (
                                      <div className="flex items-center justify-between p-2 rounded bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-xs">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium">Tips Collected</span>
                                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-blue-600">
                                            Liability
                                          </Badge>
                                        </div>
                                        <span className="font-semibold text-blue-700">
                                          {formatCurrency(expandedMonthRevenue.totals.tips)}
                                        </span>
                                      </div>
                                    )}
                                    {expandedMonthRevenue.other_liability_categories.map((category) => (
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
                      )}
                    </>
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
