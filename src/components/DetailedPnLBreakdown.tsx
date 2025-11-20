import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { usePeriodMetrics } from '@/hooks/usePeriodMetrics';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { useRevenueBreakdown } from '@/hooks/useRevenueBreakdown';
import { useCostsFromSource } from '@/hooks/useCostsFromSource';

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
  // Calculate actual dates
  const actualDateFrom = dateFrom || new Date(new Date().setDate(new Date().getDate() - days));
  const actualDateTo = dateTo || new Date();
  
  // Use new unified metrics hook (revenue from unified_sales + costs from daily_pnl)
  const { data: periodMetrics, isLoading: metricsLoading } = usePeriodMetrics(
    restaurantId,
    actualDateFrom,
    actualDateTo
  );
  
  // Fetch revenue breakdown for detailed category display
  const { data: revenueBreakdown, isLoading: revenueLoading } = useRevenueBreakdown(
    restaurantId,
    actualDateFrom,
    actualDateTo
  );
  
  // Fetch daily cost data for trends (from source tables)
  const { dailyCosts, isLoading: costsLoading } = useCostsFromSource(
    restaurantId,
    actualDateFrom,
    actualDateTo
  );

  const loading = metricsLoading || revenueLoading || costsLoading;
  
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
    if (!periodMetrics || !revenueBreakdown) return [];

    // Use periodMetrics for current period data
    const current = {
      revenue: periodMetrics.netRevenue,
      food_cost: periodMetrics.foodCost,
      labor_cost: periodMetrics.laborCost,
      prime_cost: periodMetrics.primeCost,
      avg_food_cost_pct: periodMetrics.foodCostPercentage,
      avg_labor_cost_pct: periodMetrics.laborCostPercentage,
      avg_prime_cost_pct: periodMetrics.primeCostPercentage,
    };
    
    // For previous period, we'd need to make another API call
    // For now, use current as baseline (no comparison)
    const previous = current;
    
    // Safe denominator for revenue breakdown calculations
    const grossRevenue = revenueBreakdown.totals.gross_revenue;
    const safeGrossRevenue = grossRevenue > 0 ? grossRevenue : 1;

    // Helper to calculate trend from daily cost data
    const getTrend = (metric: 'food_cost' | 'labor_cost') => {
      if (!dailyCosts || dailyCosts.length < 2) return [];
      // Get last 7 days, reverse to show chronological order
      return dailyCosts.slice(-7).map(d => d[metric] || 0);
    };

    const getPrimeCostTrend = () => {
      if (!dailyCosts || dailyCosts.length < 2) return [];
      return dailyCosts.slice(-7).map(d => (d.food_cost || 0) + (d.labor_cost || 0));
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

    // Industry benchmarks
    const benchmarks = {
      industry_avg_food_cost: 30,
      industry_avg_labor_cost: 30,
      industry_avg_prime_cost: 60,
    };

    return [
      // SALES SECTION - Enhanced with Revenue Breakdown
      {
        id: 'sales',
        label: revenueBreakdown && revenueBreakdown.has_categorization_data 
          ? 'Net Sales (after discounts)' 
          : 'Net Sales',
        value: current.revenue, // Always use net revenue as the baseline
        percentage: 100,
        previousValue: previous.revenue,
        previousPercentage: 100,
        type: 'header',
        level: 0,
        trend: [],
        insight: revenueBreakdown && revenueBreakdown.has_categorization_data
          ? `Net revenue after discounts from ${revenueBreakdown.revenue_categories.reduce((sum, c) => sum + c.transaction_count, 0)} transactions across ${revenueBreakdown.revenue_categories.length} categories`
          : `Net revenue for ${periodMetrics.daysInPeriod} days`,
        // Add revenue breakdown as children if available (showing gross components under net)
        children: revenueBreakdown && revenueBreakdown.has_categorization_data
          ? [
               {
                id: 'sales-gross',
                label: 'Gross Revenue',
                value: revenueBreakdown.totals.gross_revenue,
                percentage: current.revenue > 0 ? (revenueBreakdown.totals.gross_revenue / current.revenue) * 100 : 0,
                type: 'line-item' as const,
                level: 1,
                insight: `Total before discounts and refunds`,
                status: 'neutral' as const,
              },
              ...(revenueBreakdown.discount_categories.length > 0 || revenueBreakdown.refund_categories.length > 0 
                ? [
                    {
                      id: 'sales-deductions',
                      label: 'Less: Discounts & Refunds',
                      value: -(revenueBreakdown.totals.total_discounts + revenueBreakdown.totals.total_refunds),
                      percentage: current.revenue > 0 ? -((revenueBreakdown.totals.total_discounts + revenueBreakdown.totals.total_refunds) / current.revenue) * 100 : 0,
                      type: 'line-item' as const,
                      level: 1,
                      insight: `Total discounts: $${revenueBreakdown.totals.total_discounts.toFixed(2)}, Total refunds: $${revenueBreakdown.totals.total_refunds.toFixed(2)}`,
                      status: current.revenue > 0 && (revenueBreakdown.totals.total_discounts + revenueBreakdown.totals.total_refunds) / revenueBreakdown.totals.gross_revenue > 0.05 ? 'warning' as const : 'neutral' as const,
                    },
                  ]
                : []),
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
        benchmark: benchmarks.industry_avg_food_cost,
        trend: getTrend('food_cost'),
        insight: getInsight(
          current.avg_food_cost_pct,
          previous.avg_food_cost_pct,
          benchmarks.industry_avg_food_cost,
          'Food cost'
        ),
        status: getStatus(current.avg_food_cost_pct, benchmarks.industry_avg_food_cost),
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
        benchmark: benchmarks.industry_avg_labor_cost,
        trend: getTrend('labor_cost'),
        insight: current.labor_cost === 0 
          ? 'Labor not yet recorded — metrics incomplete. Add labor costs for accurate prime cost calculation.'
          : getInsight(
              current.avg_labor_cost_pct,
              previous.avg_labor_cost_pct,
              benchmarks.industry_avg_labor_cost,
              'Labor cost'
            ),
        status: current.labor_cost === 0 ? 'warning' : getStatus(current.avg_labor_cost_pct, benchmarks.industry_avg_labor_cost),
        // Add breakdown children to show where labor costs come from
        children: current.labor_cost > 0 ? [
          {
            id: 'labor-timepunches',
            label: 'From Time Tracking',
            value: dailyCosts.reduce((sum, d) => sum + d.labor_cost_from_timepunches, 0),
            percentage: current.labor_cost > 0 
              ? (dailyCosts.reduce((sum, d) => sum + d.labor_cost_from_timepunches, 0) / current.labor_cost) * 100 
              : 0,
            type: 'line-item' as const,
            level: 1,
            insight: 'Labor costs calculated from employee time punches',
            status: 'neutral' as const,
          },
          {
            id: 'labor-transactions',
            label: 'From Financial Transactions',
            value: dailyCosts.reduce((sum, d) => sum + d.labor_cost_from_transactions, 0),
            percentage: current.labor_cost > 0 
              ? (dailyCosts.reduce((sum, d) => sum + d.labor_cost_from_transactions, 0) / current.labor_cost) * 100 
              : 0,
            type: 'line-item' as const,
            level: 1,
            insight: 'Labor expenses from bank transactions and checks categorized to payroll/labor accounts',
            status: 'neutral' as const,
          },
        ] : undefined,
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
        benchmark: benchmarks.industry_avg_prime_cost,
        trend: getPrimeCostTrend(),
        insight: current.labor_cost === 0
          ? `Prime cost shown as COGS only — labor data not yet tracked`
          : current.avg_prime_cost_pct > benchmarks.industry_avg_prime_cost 
            ? `Prime cost exceeds target of ${benchmarks.industry_avg_prime_cost}% - immediate action needed`
            : `Prime cost within healthy range - target is ${benchmarks.industry_avg_prime_cost}%`,
        status: getStatus(current.avg_prime_cost_pct, benchmarks.industry_avg_prime_cost),
      },

      // GROSS PROFIT / CONTRIBUTION MARGIN
      // Note: When no operating expenses exist, Contribution Margin = Gross Profit
      // We show only one to avoid confusion
      {
        id: 'gross-profit',
        label: 'Gross Profit (Revenue - Prime Cost)',
        value: current.revenue - current.prime_cost,
        percentage: 100 - current.avg_prime_cost_pct,
        previousValue: previous.revenue - previous.prime_cost,
        previousPercentage: 100 - previous.avg_prime_cost_pct,
        type: 'total',
        level: 0,
        insight: current.labor_cost === 0
          ? `Margin available for labor and operating expenses • $${((current.revenue - current.prime_cost) / periodMetrics.daysInPeriod).toFixed(0)} average daily`
          : `Margin available for operating expenses and profit • $${((current.revenue - current.prime_cost) / periodMetrics.daysInPeriod).toFixed(0)} average daily`,
        status: current.avg_prime_cost_pct < benchmarks.industry_avg_prime_cost ? 'good' : 'warning',
      },
    ];
  }, [periodMetrics, revenueBreakdown, dailyCosts]);

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
    if (!periodMetrics) return;
    
    const actualDays = periodMetrics.daysInPeriod;
    
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

  if (!periodMetrics) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">No P&L data available for this period</p>
        </CardContent>
      </Card>
    );
  }

  const actualDays = periodMetrics.daysInPeriod;

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
        {/* Context banner when labor = 0 */}
        {periodMetrics && periodMetrics.laborCost === 0 && (
          <Alert className="mb-4 border-amber-200 bg-amber-50">
            <Info className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-sm text-amber-900">
              <strong>Labor data not yet recorded</strong> — Prime cost and margin metrics are incomplete. 
              Add labor costs under the Data Input section for accurate P&L analysis.
            </AlertDescription>
          </Alert>
        )}
        
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
