import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { format, parse } from "date-fns";

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
    if (change === null) return "secondary";
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
                  <th className="text-left py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    Month
                  </th>
                  <th className="text-right py-2 px-2 sm:py-3 sm:px-4 text-xs sm:text-sm font-semibold text-muted-foreground">
                    Revenue
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
                  const foodCostPercent = month.net_revenue > 0 
                    ? (month.food_cost / month.net_revenue) * 100 
                    : 0;
                  const laborCostPercent = month.net_revenue > 0 
                    ? (month.labor_cost / month.net_revenue) * 100 
                    : 0;
                  
                  return (
                    <tr
                      key={month.period}
                      className={`border-b border-border/50 hover:bg-muted/50 transition-colors ${
                        index % 2 === 0 ? 'bg-muted/20' : ''
                      }`}
                    >
                      <td className="py-2 px-2 sm:py-3 sm:px-4">
                        <span className="font-medium text-xs sm:text-sm">{formatMonth(month.period)}</span>
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
