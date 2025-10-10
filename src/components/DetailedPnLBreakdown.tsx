import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  Calendar
} from 'lucide-react';
import { usePnLAnalytics } from '@/hooks/usePnLAnalytics';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface DetailedPnLBreakdownProps {
  restaurantId: string;
  days?: number;
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

export function DetailedPnLBreakdown({ restaurantId, days = 30 }: DetailedPnLBreakdownProps) {
  const { data, loading } = usePnLAnalytics(restaurantId, days);
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
      // SALES SECTION
      {
        id: 'sales',
        label: 'Total Sales',
        value: current.revenue,
        percentage: 100,
        previousValue: previous.revenue,
        previousPercentage: 100,
        type: 'header',
        level: 0,
        trend: getTrend('net_revenue'),
        insight: `Revenue ${data.comparison.change.revenue_pct >= 0 ? 'up' : 'down'} ${Math.abs(data.comparison.change.revenue_pct).toFixed(1)}% vs previous ${days} days`,
        status: data.comparison.change.revenue_pct >= 0 ? 'good' : 'warning',
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
        insight: `$${((current.revenue - current.prime_cost) / days).toFixed(0)} average daily contribution`,
        status: 'neutral',
      },
    ];
  }, [data, days]);

  const getStatusIcon = (status?: PnLRow['status']) => {
    switch (status) {
      case 'good': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'warning': return <AlertCircle className="h-4 w-4 text-orange-500" />;
      case 'critical': return <AlertCircle className="h-4 w-4 text-red-500" />;
      default: return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getTrendIcon = (current: number, previous?: number) => {
    if (!previous) return null;
    const change = ((current - previous) / previous) * 100;
    if (Math.abs(change) < 1) return <Minus className="h-3 w-3 text-muted-foreground" />;
    return change > 0 
      ? <TrendingUp className="h-3 w-3 text-green-500" />
      : <TrendingDown className="h-3 w-3 text-red-500" />;
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
      ['Period:', `Last ${days} days`, `vs Previous ${days} days`],
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

    const csv = rows.map(row => row.join(',')).join('\n');
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
          <div className="text-center">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-muted rounded w-1/4 mx-auto" />
              <div className="h-4 bg-muted rounded w-1/2 mx-auto" />
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
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Detailed P&L Breakdown
            </CardTitle>
            <CardDescription>
              Last {days} days • Inline insights & benchmarks
            </CardDescription>
          </div>
          <Button onClick={exportToExcel} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {/* Header Row */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-xs font-medium text-muted-foreground border-b">
            <div className="col-span-4">Category</div>
            <div className="col-span-2 text-right">Amount</div>
            <div className="col-span-1 text-right">% Sales</div>
            <div className="col-span-1 text-center">vs Prev</div>
            <div className="col-span-1 text-center">Target</div>
            <div className="col-span-2 text-center">Trend</div>
            <div className="col-span-1 text-center">Status</div>
          </div>

          {/* Data Rows */}
          <TooltipProvider>
            {pnlStructure.map((row) => (
              <div
                key={row.id}
                className={cn(
                  "grid grid-cols-12 gap-2 px-4 py-3 rounded-lg transition-colors hover:bg-muted/50",
                  row.type === 'header' && "bg-muted/30 font-semibold",
                  row.type === 'total' && "bg-primary/5 font-bold border-t-2 border-b-2",
                  row.type === 'subtotal' && "font-medium bg-muted/10"
                )}
              >
                {/* Category Name */}
                <div 
                  className="col-span-4 flex items-center gap-2"
                  style={{ paddingLeft: `${row.level * 16}px` }}
                >
                  {row.children && row.children.length > 0 && (
                    <button
                      onClick={() => toggleSection(row.id)}
                      className="p-0.5 hover:bg-muted rounded"
                    >
                      {expandedSections.has(row.id) ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </button>
                  )}
                  <span className="text-sm">{row.label}</span>
                </div>

                {/* Amount */}
                <div className="col-span-2 text-right text-sm font-mono">
                  ${row.value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>

                {/* Percentage */}
                <div className="col-span-1 text-right text-sm font-mono">
                  {row.percentage.toFixed(1)}%
                </div>

                {/* vs Previous */}
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
                          <div>Previous: ${row.previousValue.toFixed(0)}</div>
                          <div>Change: ${(row.value - row.previousValue).toFixed(0)}</div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>

                {/* Benchmark/Target */}
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

                {/* Mini Trend Sparkline */}
                <div className="col-span-2 flex items-center justify-center">
                  {row.trend && row.trend.length > 0 && (
                    <Tooltip>
                      <TooltipTrigger>
                        <MiniSparkline data={row.trend} />
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="text-xs">
                          7-day trend
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>

                {/* Status Icon with Insight */}
                <div className="col-span-1 flex items-center justify-center">
                  {row.insight && (
                    <Tooltip>
                      <TooltipTrigger>
                        {getStatusIcon(row.status)}
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="text-xs font-medium">{row.insight}</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            ))}
          </TooltipProvider>
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
            <div className="flex items-center gap-1">
              <Info className="h-3 w-3 text-blue-500" />
              <span>Hover for detailed insights</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
