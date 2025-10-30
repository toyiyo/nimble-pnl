import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricIcon } from '@/components/MetricIcon';
import { 
  ChevronDown, 
  ChevronRight, 
  TrendingUp, 
  TrendingDown,
  AlertCircle,
  CheckCircle,
  Info,
  Minus,
  Download,
  Calendar,
  BarChart3
} from 'lucide-react';
import { usePnLAnalytics } from '@/hooks/usePnLAnalytics';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useRevenueBreakdown } from '@/hooks/useRevenueBreakdown';

interface DetailedPnLBreakdownProps {
  restaurantId: string;
  days?: number;
  dateFrom?: Date;
  dateTo?: Date;
}

interface PnLRow {
  id: string;
  label: string;
  value: number;
  percentage: number;
  previousValue?: number;
  previousPercentage?: number;
  type: 'header' | 'category' | 'line-item' | 'subtotal' | 'total';
  level: number;
  children?: PnLRow[];
  benchmark?: number;
  insight?: string;
  status?: 'good' | 'warning' | 'critical' | 'neutral';
  trend?: number[];
}

export function DetailedPnLBreakdown({ restaurantId, days = 30, dateFrom, dateTo }: DetailedPnLBreakdownProps) {
  const { data, loading } = usePnLAnalytics(restaurantId, { days, dateFrom, dateTo });
  
  // Fetch revenue breakdown
  const { data: revenueBreakdown, isLoading: revenueLoading } = useRevenueBreakdown(
    restaurantId,
    dateFrom || new Date(new Date().setDate(new Date().getDate() - days)),
    dateTo || new Date()
  );
  
  // Calculate actual days if dates are provided (inclusive, minimum 1)
  const actualDays = dateFrom && dateTo 
    ? Math.max(1, Math.ceil((dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)) + 1)
    : days;
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['sales', 'cogs', 'labor', 'prime', 'controllable'])
  );

  const toggleSection = (id: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedSections(newExpanded);
  };

  const pnlStructure = useMemo<PnLRow[]>(() => {
    if (!data) return [];

    const current = data.comparison.current_period;
    const previous = data.comparison.previous_period;

    // Helper to calculate trend from daily data
    const getTrend = (metric: 'net_revenue' | 'food_cost' | 'labor_cost' | 'prime_cost') => {
      return data.dailyData.slice(-7).map(d => d[metric]);
    };

    const getInsight = (currentPct: number, previousPct: number, benchmark: number, metricName: string) => {
      const change = currentPct - previousPct;
      const vsBenchmark = currentPct - benchmark;
      
      if (Math.abs(vsBenchmark) <= 2) return `${metricName} is within target range`;
      if (vsBenchmark > 5) return `${metricName} is significantly above target by ${Math.abs(vsBenchmark).toFixed(1)}pp`;
      if (vsBenchmark < -5) return `${metricName} is well below target - great control!`;
      if (change > 3) return `${metricName} increased ${change.toFixed(1)}pp vs last period`;
      if (change < -3) return `${metricName} decreased ${Math.abs(change).toFixed(1)}pp vs last period`;
      return `${metricName} is stable`;
    };

    const getStatus = (currentPct: number, benchmark: number, lowerIsBetter: boolean = true): PnLRow['status'] => {
      const diff = currentPct - benchmark;
      if (lowerIsBetter) {
        if (diff > 5) return 'critical';
        if (diff > 2) return 'warning';
        if (diff < -2) return 'good';
      } else {
        if (diff < -5) return 'critical';
        if (diff < -2) return 'warning';
        if (diff > 2) return 'good';
      }
      return 'neutral';
    };

    return [
      // SALES SECTION - Enhanced with Revenue Breakdown
      {
        id: 'sales',
        label: revenueBreakdown && revenueBreakdown.has_categorization_data 
          ? 'Total Sales (Gross Revenue)' 
          : 'Total Sales',
        value: revenueBreakdown && revenueBreakdown.has_categorization_data
          ? revenueBreakdown.totals.gross_revenue
          : current.revenue,
        percentage: 100,
        previousValue: previous.revenue,
        previousPercentage: 100,
        type: 'header',
        level: 0,
        trend: getTrend('net_revenue'),
        insight: revenueBreakdown && revenueBreakdown.has_categorization_data
          ? `Gross revenue from ${revenueBreakdown.revenue_categories.reduce((sum, c) => sum + c.transaction_count, 0)} transactions across ${revenueBreakdown.revenue_categories.length} categories`
          : `Revenue ${data.comparison.change.revenue_pct >= 0 ? 'up' : 'down'} ${Math.abs(data.comparison.change.revenue_pct).toFixed(1)}% vs previous ${actualDays} days`,
        status: data.comparison.change.revenue_pct >= 0 ? 'good' : 'warning',
        // Add revenue categories as children if available
        children: revenueBreakdown && revenueBreakdown.has_categorization_data
          ? [
              ...revenueBreakdown.revenue_categories.map(cat => ({
                id: `sales-${cat.account_id}`,
                label: `${cat.account_code} - ${cat.account_name}`,
                value: cat.total_amount,
                percentage: (cat.total_amount / revenueBreakdown.totals.gross_revenue) * 100,
                type: 'line-item' as const,
                level: 1,
                insight: `${cat.transaction_count} transactions • ${(cat.total_amount / revenueBreakdown.totals.gross_revenue * 100).toFixed(1)}% of gross`,
                status: 'neutral' as const,
              })),
              ...(revenueBreakdown.discount_categories.length > 0 || revenueBreakdown.refund_categories.length > 0 
                ? [
                    {
                      id: 'sales-deductions',
                      label: 'Less: Discounts & Refunds',
                      value: -(revenueBreakdown.totals.total_discounts + revenueBreakdown.totals.total_refunds),
                      percentage: -((revenueBreakdown.totals.total_discounts + revenueBreakdown.totals.total_refunds) / revenueBreakdown.totals.gross_revenue) * 100,
                      type: 'line-item' as const,
                      level: 1,
                      insight: `${((revenueBreakdown.totals.total_discounts + revenueBreakdown.totals.total_refunds) / revenueBreakdown.totals.gross_revenue * 100).toFixed(1)}% of gross revenue`,
                      status: (revenueBreakdown.totals.total_discounts + revenueBreakdown.totals.total_refunds) / revenueBreakdown.totals.gross_revenue > 0.03 ? 'warning' as const : 'neutral' as const,
                    },
                  ]
                : []),
              {
                id: 'sales-net',
                label: 'Net Sales Revenue',
                value: revenueBreakdown.totals.net_revenue,
                percentage: (revenueBreakdown.totals.net_revenue / revenueBreakdown.totals.gross_revenue) * 100,
                type: 'subtotal' as const,
                level: 1,
                insight: `Final revenue after all deductions`,
                status: 'good' as const,
              },
            ]
          : undefined,
      },
      
      // COGS SECTION
      {
        id: 'cogs',
        label: 'Cost of Goods Sold (COGS)',
        value: current.food_cost,
        percentage: current.avg_food_cost_pct,
        previousValue: previous.food_cost,
        previousPercentage: previous.avg_food_cost_pct,
        type: 'header',
        level: 0,
        benchmark: data.benchmarks.industry_avg_food_cost,
        trend: getTrend('food_cost'),
        insight: getInsight(
          current.avg_food_cost_pct,
          previous.avg_food_cost_pct,
          data.benchmarks.industry_avg_food_cost,
          'Food cost'
        ),
        status: getStatus(current.avg_food_cost_pct, data.benchmarks.industry_avg_food_cost),
      },

      // LABOR SECTION
      {
        id: 'labor',
        label: 'Labor Costs',
        value: current.labor_cost,
        percentage: current.avg_labor_cost_pct,
        previousValue: previous.labor_cost,
        previousPercentage: previous.avg_labor_cost_pct,
        type: 'header',
        level: 0,
        benchmark: data.benchmarks.industry_avg_labor_cost,
        trend: getTrend('labor_cost'),
        insight: getInsight(
          current.avg_labor_cost_pct,
          previous.avg_labor_cost_pct,
          data.benchmarks.industry_avg_labor_cost,
          'Labor cost'
        ),
        status: getStatus(current.avg_labor_cost_pct, data.benchmarks.industry_avg_labor_cost),
      },

      // PRIME COST
      {
        id: 'prime',
        label: 'Prime Cost (COGS + Labor)',
        value: current.prime_cost,
        percentage: current.avg_prime_cost_pct,
        previousValue: previous.prime_cost,
        previousPercentage: previous.avg_prime_cost_pct,
        type: 'total',
        level: 0,
        benchmark: data.benchmarks.industry_avg_prime_cost,
        trend: getTrend('prime_cost'),
        insight: current.avg_prime_cost_pct > data.benchmarks.industry_avg_prime_cost 
          ? `Prime cost exceeds target of ${data.benchmarks.industry_avg_prime_cost}% - immediate action needed`
          : `Prime cost within healthy range - target is ${data.benchmarks.industry_avg_prime_cost}%`,
        status: getStatus(current.avg_prime_cost_pct, data.benchmarks.industry_avg_prime_cost),
      },

      // CONTRIBUTION MARGIN
      {
        id: 'contribution',
        label: 'Contribution Margin (Sales - Prime Cost)',
        value: current.revenue - current.prime_cost,
        percentage: 100 - current.avg_prime_cost_pct,
        previousValue: previous.revenue - previous.prime_cost,
        previousPercentage: 100 - previous.avg_prime_cost_pct,
        type: 'total',
        level: 0,
        insight: `${(100 - current.avg_prime_cost_pct).toFixed(1)}% margin available for operating expenses and profit`,
        status: current.avg_prime_cost_pct < data.benchmarks.industry_avg_prime_cost ? 'good' : 'warning',
      },

      // GROSS PROFIT
      {
        id: 'gross-profit',
        label: 'Gross Profit',
        value: current.revenue - current.food_cost - current.labor_cost,
        percentage: 100 - current.avg_prime_cost_pct,
        previousValue: previous.revenue - previous.food_cost - previous.labor_cost,
        previousPercentage: 100 - previous.avg_prime_cost_pct,
        type: 'total',
        level: 0,
        insight: `$${((current.revenue - current.prime_cost) / actualDays).toFixed(0)} average daily contribution`,
        status: 'neutral',
      },
    ];
  }, [data, actualDays]);

  const getStatusIcon = (status?: PnLRow['status']) => {
    switch (status) {
      case 'good': return <CheckCircle className="h-4 w-4 text-emerald-600" />;
      case 'warning': return <AlertCircle className="h-4 w-4 text-amber-600" />;
      case 'critical': return <AlertCircle className="h-4 w-4 text-destructive" />;
      default: return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getTrendIcon = (current: number, previous?: number) => {
    if (!previous) return null;
    const change = ((current - previous) / previous) * 100;
    if (Math.abs(change) < 1) return <Minus className="h-3 w-3 text-muted-foreground" />;
    return change > 0 
      ? <TrendingUp className="h-3 w-3 text-emerald-600" />
      : <TrendingDown className="h-3 w-3 text-destructive" />;
  };

  const MiniSparkline = ({ data }: { data: number[] }) => {
    if (!data || data.length < 2) return null;
    
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    
    const points = data.map((value, i) => {
      const x = (i / (data.length - 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    }).join(' ');

    const isUptrend = data[data.length - 1] > data[0];
    
    return (
      <svg width="40" height="16" className="inline-block ml-2">
        <polyline
          points={points}
          fill="none"
          stroke={isUptrend ? '#10b981' : '#ef4444'}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  };

  const exportToExcel = () => {
    if (!data) return;
    
    const rows = [
      ['Detailed P&L Breakdown'],
      ['Period:', `Last ${actualDays} days`, `vs Previous ${actualDays} days`],
      ['Generated:', format(new Date(), 'MMM dd, yyyy')],
      [],
      ['Category', 'Amount', '% of Sales', 'Previous Amount', 'Previous %', 'Change', 'Benchmark', 'Status', 'Insight'],
        ...pnlStructure.map(row => [
          row.label,
          row.value.toFixed(2),
          row.percentage.toFixed(1) + '%',
          row.previousValue != null ? row.previousValue.toFixed(2) : '',
          row.previousPercentage != null ? row.previousPercentage.toFixed(1) + '%' : '',
          row.previousValue != null && row.previousValue !== 0 ? ((row.value - row.previousValue) / row.previousValue * 100).toFixed(1) + '%' : '',
          row.benchmark != null ? row.benchmark.toFixed(1) + '%' : '',
          row.status || '',
          row.insight || '',
        ]),
    ];

    // Escape CSV cells to prevent formula injection and handle special characters
    const escapeCSV = (cell: any) => {
      const s = String(cell ?? '');
      // Prevent formula injection by prefixing with single quote if starts with =, +, -, @
      const prefixed = /^[=+\-@]/.test(s) ? "'" + s : s;
      // RFC4180 compliant: quote and escape internal quotes
      return `"${prefixed.replace(/"/g, '""')}"`;
    };
    
    const csv = rows.map(row => row.map(escapeCSV).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pnl-breakdown-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="space-y-4" role="status" aria-live="polite">
            <Skeleton className="h-8 w-1/4 mx-auto" />
            <Skeleton className="h-4 w-1/2 mx-auto" />
            <div className="space-y-2 mt-6">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">No P&L data available for this period</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <MetricIcon icon={BarChart3} variant="blue" />
            <div>
              <CardTitle className="text-lg md:text-xl">
                Detailed P&L Breakdown
              </CardTitle>
              <CardDescription className="text-sm">
                Last {actualDays} days • Inline insights & benchmarks
              </CardDescription>
            </div>
          </div>
          <Button onClick={exportToExcel} variant="outline" size="sm" aria-label="Export P&L breakdown to CSV" className="w-full sm:w-auto">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Desktop Table View - Hidden on Mobile */}
          <div className="hidden lg:block">
            <div className="space-y-1">
              {/* Header Row */}
              <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium text-muted-foreground border-b">
                <div className="col-span-4">Category</div>
                <div className="col-span-2 text-right">Amount</div>
                <div className="col-span-1 text-right">%</div>
                <div className="col-span-1 text-center">vs Prev</div>
                <div className="col-span-1 text-center">Target</div>
                <div className="col-span-2 text-center">Trend</div>
                <div className="col-span-1 text-center">Status</div>
              </div>

              {/* Data Rows */}
              <TooltipProvider>
                {pnlStructure.map((row) => {
                  const levelIndentClass = ['pl-0','pl-4','pl-8','pl-12','pl-16'][Math.min(row.level, 4)];
                  return (
                  <div
                    key={row.id}
                    className={cn(
                      "grid grid-cols-12 gap-2 px-4 py-3 rounded-lg transition-colors hover:bg-muted/50",
                      row.type === 'header' && "bg-muted/30 font-semibold",
                      row.type === 'total' && "bg-primary/5 font-bold border-t-2 border-b-2",
                      row.type === 'subtotal' && "font-medium bg-muted/10"
                    )}
                  >
                    <div 
                      className={cn("col-span-4 flex items-center gap-2", levelIndentClass)}
                    >
                      {row.children && row.children.length > 0 && (
                        <button
                          onClick={() => toggleSection(row.id)}
                          className="p-0.5 hover:bg-muted rounded"
                          aria-label={`Toggle ${row.label} section`}
                        >
                          {expandedSections.has(row.id) ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                        </button>
                      )}
                      <span className={cn(
                        "text-sm",
                        row.type === 'subtotal' && "font-semibold italic"
                      )}>
                        {row.label}
                      </span>
                    </div>

                    <div className="col-span-2 text-right text-sm font-mono">
                      ${row.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>

                    <div className="col-span-1 text-right text-sm font-mono">
                      {row.percentage.toFixed(1)}%
                    </div>

                    <div className="col-span-1 flex items-center justify-center gap-1">
                      {row.previousValue && (
                        <Tooltip>
                          <TooltipTrigger>
                            <div className="flex items-center gap-1">
                              {getTrendIcon(row.value, row.previousValue)}
                              <span className={cn(
                                "text-xs font-medium",
                                row.value > row.previousValue ? "text-green-600" : "text-red-600"
                              )}>
                                {Math.abs(((row.value - row.previousValue) / row.previousValue) * 100).toFixed(0)}%
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs">
                              <div>Previous: ${row.previousValue.toFixed(2)}</div>
                              <div>Change: ${(row.value - row.previousValue).toFixed(2)}</div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>

                    <div className="col-span-1 text-center">
                      {row.benchmark && (
                        <Tooltip>
                          <TooltipTrigger>
                            <Badge 
                              variant={
                                row.status === 'good' ? 'default' : 
                                row.status === 'warning' ? 'secondary' : 
                                row.status === 'critical' ? 'destructive' : 
                                'outline'
                              }
                              className="text-xs"
                            >
                              {row.benchmark.toFixed(0)}%
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs">
                              <div>Industry Target: {row.benchmark.toFixed(1)}%</div>
                              <div>Your: {row.percentage.toFixed(1)}%</div>
                              <div className={cn(
                                "font-medium",
                                row.percentage < row.benchmark ? "text-green-500" : "text-red-500"
                              )}>
                                {row.percentage < row.benchmark ? '✓ Below target' : '✗ Above target'}
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>

                    <div className="col-span-2 flex items-center justify-center">
                      {row.trend && row.trend.length > 0 && (
                        <Tooltip>
                          <TooltipTrigger>
                            <MiniSparkline data={row.trend} />
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs">7-day trend</div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>

                    <div className="col-span-1 flex items-center justify-center">
                      <Tooltip>
                        <TooltipTrigger>
                          {getStatusIcon(row.status)}
                        </TooltipTrigger>
                        {row.insight && (
                          <TooltipContent className="max-w-xs">
                            <p className="text-xs">{row.insight}</p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </div>
                  </div>
                  );
                })}
                
                {/* Render children (line items) if section is expanded */}
                {pnlStructure.map((row) => 
                  row.children && expandedSections.has(row.id) && row.children.map((child) => {
                    const childLevelIndentClass = ['pl-0','pl-4','pl-8','pl-12','pl-16'][Math.min(child.level, 4)];
                    return (
                      <div
                        key={child.id}
                        className={cn(
                          "grid grid-cols-12 gap-2 px-4 py-2 rounded-lg transition-colors hover:bg-muted/30",
                          child.type === 'subtotal' && "font-semibold bg-muted/20 border-t mt-1"
                        )}
                      >
                        <div className={cn("col-span-4 flex items-center gap-2", childLevelIndentClass)}>
                          <span className={cn(
                            "text-sm",
                            child.type === 'subtotal' && "font-semibold italic"
                          )}>
                            {child.label}
                          </span>
                        </div>

                        <div className={cn(
                          "col-span-2 text-right text-sm font-mono",
                          child.value < 0 && "text-red-600"
                        )}>
                          {child.value < 0 ? '-' : ''}${Math.abs(child.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>

                        <div className="col-span-1 text-right text-sm font-mono">
                          {child.percentage.toFixed(1)}%
                        </div>

                        <div className="col-span-1" />
                        <div className="col-span-1" />
                        <div className="col-span-2" />

                        <div className="col-span-1 flex items-center justify-center">
                          {getStatusIcon(child.status)}
                        </div>
                      </div>
                    );
                  })
                )}
              </TooltipProvider>
            </div>
          </div>

          {/* Mobile Card View - Hidden on Desktop */}
          <div className="lg:hidden space-y-3">
            {pnlStructure.map((row) => (
              <Card 
                key={row.id} 
                className={cn(
                  "transition-all duration-200",
                  row.type === 'header' && "border-l-4 border-l-blue-500",
                  row.type === 'total' && "border-l-4 border-l-primary bg-primary/5",
                  row.type === 'subtotal' && "border-l-4 border-l-muted-foreground/50"
                )}
              >
                <CardContent className="p-4 space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-1">
                      {row.children && row.children.length > 0 && (
                        <button
                          onClick={() => toggleSection(row.id)}
                          className="p-1 hover:bg-muted rounded flex-shrink-0"
                          aria-label={`Toggle ${row.label} section`}
                        >
                          {expandedSections.has(row.id) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      <h3 className={cn(
                        "text-sm",
                        row.type === 'header' && "font-semibold",
                        row.type === 'total' && "font-bold"
                      )}>
                        {row.label}
                      </h3>
                    </div>
                    {getStatusIcon(row.status)}
                  </div>

                  {/* Main Metrics */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Amount</p>
                      <p className="text-lg font-bold font-mono">
                        ${row.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">% of Sales</p>
                      <p className="text-lg font-bold font-mono">
                        {row.percentage.toFixed(1)}%
                      </p>
                    </div>
                  </div>

                  {/* Secondary Metrics Row */}
                  <div className="flex items-center justify-between pt-2 border-t">
                    {/* vs Previous */}
                    {row.previousValue && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">vs Prev:</span>
                        {getTrendIcon(row.value, row.previousValue)}
                        <span className={cn(
                          "text-xs font-medium",
                          row.value > row.previousValue ? "text-green-600" : "text-red-600"
                        )}>
                          {Math.abs(((row.value - row.previousValue) / row.previousValue) * 100).toFixed(0)}%
                        </span>
                      </div>
                    )}

                    {/* Benchmark */}
                    {row.benchmark && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Target:</span>
                        <Badge 
                          variant={
                            row.status === 'good' ? 'default' : 
                            row.status === 'warning' ? 'secondary' : 
                            row.status === 'critical' ? 'destructive' : 
                            'outline'
                          }
                          className="text-xs"
                        >
                          {row.benchmark.toFixed(0)}%
                        </Badge>
                      </div>
                    )}

                    {/* Trend Sparkline */}
                    {row.trend && row.trend.length > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">Trend:</span>
                        <MiniSparkline data={row.trend} />
                      </div>
                    )}
                  </div>

                  {/* Insight */}
                  {row.insight && (
                    <div className="pt-2 border-t">
                      <div className="flex gap-2">
                        <Info className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {row.insight}
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Legend */}
          <div className="mt-6 pt-4 border-t">
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3 text-green-500" />
                <span>On target or better</span>
              </div>
              <div className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3 text-orange-500" />
                <span>Needs attention</span>
              </div>
              <div className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3 text-red-500" />
                <span>Critical - immediate action</span>
              </div>
              <div className="flex items-center gap-1 hidden lg:flex">
                <Info className="h-3 w-3 text-blue-500" />
                <span>Hover for detailed insights</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
