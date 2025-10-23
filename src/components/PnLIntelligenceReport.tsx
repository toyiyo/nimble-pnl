import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricIcon } from '@/components/MetricIcon';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExportDropdown } from '@/components/financial-statements/shared/ExportDropdown';
import { generateTablePDF } from '@/utils/pdfExport';
import { exportToCSV as exportCSV, generateCSVFilename } from '@/utils/csvExport';
import { useToast } from '@/hooks/use-toast';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Target, 
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Info,
  Calendar,
  BarChart3,
  PieChart as PieChartIcon,
  LineChart as LineChartIcon,
  Zap,
  Award
} from 'lucide-react';
import { usePnLAnalytics } from '@/hooks/usePnLAnalytics';
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  AreaChart,
  Area,
  PieChart, 
  Pie, 
  Cell, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  ComposedChart,
  ReferenceLine,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar
} from 'recharts';
import { format } from 'date-fns';

interface PnLIntelligenceReportProps {
  restaurantId: string;
}

export function PnLIntelligenceReport({ restaurantId }: PnLIntelligenceReportProps) {
  const [timeframe, setTimeframe] = useState<30 | 60 | 90>(30);
  const { data, loading } = usePnLAnalytics(restaurantId, timeframe);
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const COLORS = {
    revenue: '#10b981',
    foodCost: '#ef4444',
    laborCost: '#f59e0b',
    primeCost: '#8b5cf6',
    profit: '#3b82f6',
  };

  const handleExportCSV = async () => {
    if (!data) return;
    setIsExporting(true);
    try {
      const csvData = data.dailyData.map(day => ({
        'Date': day.date,
        'Revenue': `$${day.net_revenue.toFixed(2)}`,
        'Food Cost': `$${day.food_cost.toFixed(2)}`,
        'Labor Cost': `$${day.labor_cost.toFixed(2)}`,
        'Prime Cost': `$${day.prime_cost.toFixed(2)}`,
        'Food Cost %': `${day.food_cost_percentage.toFixed(1)}%`,
        'Labor Cost %': `${day.labor_cost_percentage.toFixed(1)}%`,
        'Prime Cost %': `${day.prime_cost_percentage.toFixed(1)}%`,
      }));

      exportCSV({
        data: csvData,
        filename: generateCSVFilename('pnl_intelligence'),
      });

      toast({
        title: "Export Successful",
        description: "P&L intelligence data exported to CSV",
      });
    } catch (error) {
      console.error("Error exporting CSV:", error);
      toast({
        title: "Export Failed",
        description: "Failed to export P&L data",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDF = async () => {
    if (!data) return;
    setIsExporting(true);
    try {
      const columns = ["Date", "Revenue", "Food Cost", "Labor Cost", "Prime Cost", "Food %", "Labor %", "Prime %"];
      const rows = data.dailyData.map(day => [
        day.date,
        `$${day.net_revenue.toFixed(2)}`,
        `$${day.food_cost.toFixed(2)}`,
        `$${day.labor_cost.toFixed(2)}`,
        `$${day.prime_cost.toFixed(2)}`,
        `${day.food_cost_percentage.toFixed(1)}%`,
        `${day.labor_cost_percentage.toFixed(1)}%`,
        `${day.prime_cost_percentage.toFixed(1)}%`,
      ]);

      const metrics = [
        { label: "Total Revenue", value: `$${data.comparison.current_period.revenue.toFixed(2)}` },
        { label: "Total Food Cost", value: `$${data.comparison.current_period.food_cost.toFixed(2)}` },
        { label: "Total Labor Cost", value: `$${data.comparison.current_period.labor_cost.toFixed(2)}` },
        { label: "Prime Cost", value: `$${data.comparison.current_period.prime_cost.toFixed(2)}` },
        { label: "Avg Food Cost %", value: `${data.comparison.current_period.avg_food_cost_pct.toFixed(1)}%` },
        { label: "Avg Labor Cost %", value: `${data.comparison.current_period.avg_labor_cost_pct.toFixed(1)}%` },
      ];

      generateTablePDF({
        title: `P&L Intelligence Report - Last ${timeframe} Days`,
        restaurantName: "",
        columns,
        rows,
        metrics,
        filename: generateCSVFilename('pnl_intelligence').replace('.csv', '.pdf'),
      });

      toast({
        title: "Export Successful",
        description: "P&L intelligence report exported to PDF",
      });
    } catch (error) {
      console.error("Error exporting PDF:", error);
      toast({
        title: "Export Failed",
        description: "Failed to export P&L report",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'critical': return <AlertCircle className="h-5 w-5 text-red-500" />;
      case 'warning': return <AlertTriangle className="h-5 w-5 text-orange-500" />;
      case 'success': return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      default: return <Info className="h-5 w-5 text-blue-500" />;
    }
  };

  const getInsightColor = (type: string) => {
    switch (type) {
      case 'critical': return 'border-red-500';
      case 'warning': return 'border-orange-500';
      case 'success': return 'border-green-500';
      default: return 'border-blue-500';
    }
  };

  if (loading) {
    return (
      <div className="space-y-6" role="status" aria-live="polite">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-lg" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
          </CardHeader>
        </Card>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (!data || data.dailyData.length === 0) {
    return (
      <div className="text-center py-12">
        <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No P&L Data Available</h3>
        <p className="text-muted-foreground mb-4">
          Start tracking sales, food costs, and labor to see P&L intelligence
        </p>
      </div>
    );
  }

  const benchmarkComparison = [
    { metric: 'Food Cost %', yours: data.benchmarks.your_avg_food_cost, industry: data.benchmarks.industry_avg_food_cost },
    { metric: 'Labor Cost %', yours: data.benchmarks.your_avg_labor_cost, industry: data.benchmarks.industry_avg_labor_cost },
    { metric: 'Prime Cost %', yours: data.benchmarks.your_avg_prime_cost, industry: data.benchmarks.industry_avg_prime_cost },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <MetricIcon icon={DollarSign} variant="emerald" />
              <div>
                <h2 className="text-2xl font-bold">P&L Intelligence Dashboard</h2>
                <p className="text-muted-foreground">Predictive insights and performance analytics</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Tabs value={timeframe.toString()} onValueChange={(v) => setTimeframe(Number(v) as 30 | 60 | 90)}>
                <TabsList role="tablist">
                  <TabsTrigger value="30" className="text-xs" aria-label="View 30 day data">30 Days</TabsTrigger>
                  <TabsTrigger value="60" className="text-xs" aria-label="View 60 day data">60 Days</TabsTrigger>
                  <TabsTrigger value="90" className="text-xs" aria-label="View 90 day data">90 Days</TabsTrigger>
                </TabsList>
              </Tabs>
              <ExportDropdown 
                onExportCSV={handleExportCSV}
                onExportPDF={handleExportPDF}
                isExporting={isExporting}
              />
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Key Insights */}
      {data.insights.length > 0 && (
        <div className="grid gap-4">
          {data.insights.map((insight, idx) => (
            <Card key={idx} className={getInsightColor(insight.type)}>
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  {getInsightIcon(insight.type)}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold mb-1">{insight.title}</h3>
                    <p className="text-sm text-muted-foreground mb-2">{insight.description}</p>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <Badge variant="outline">{insight.metric}: {insight.value}</Badge>
                    </div>
                    <p className="text-sm bg-muted p-2 rounded">
                      <strong>Recommendation:</strong> {insight.recommendation}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MetricIcon icon={DollarSign} variant="emerald" className="p-2" />
              Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${data.comparison.current_period.revenue.toFixed(0)}</p>
            <div className="flex items-center gap-1 text-xs mt-1" role="status">
              {data.comparison.change.revenue_pct >= 0 ? (
                <TrendingUp className="h-3 w-3 text-green-500" aria-hidden="true" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-500" aria-hidden="true" />
              )}
              <span className={data.comparison.change.revenue_pct >= 0 ? 'text-green-600' : 'text-red-600'}>
                {data.comparison.change.revenue_pct.toFixed(1)}% vs prev period
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MetricIcon icon={Target} variant="blue" className="p-2" />
              Prime Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.comparison.current_period.avg_prime_cost_pct.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">
              Target: &lt;{data.benchmarks.industry_avg_prime_cost}%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MetricIcon icon={Zap} variant="amber" className="p-2" />
              Efficiency Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.efficiency.cost_control_score.toFixed(0)}/100</p>
            <Badge variant={data.efficiency.margin_trend === 'improving' ? 'default' : data.efficiency.margin_trend === 'declining' ? 'destructive' : 'secondary'} className="text-xs mt-1">
              {data.efficiency.margin_trend}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MetricIcon icon={Award} variant="purple" className="p-2" />
              Labor ROI
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${data.efficiency.revenue_per_labor_dollar.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">revenue per labor $</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="trends" className="w-full">
        <TabsList className="grid w-full grid-cols-5" role="tablist">
          <TabsTrigger value="trends" aria-label="P&L trends analysis">Trends</TabsTrigger>
          <TabsTrigger value="comparison" aria-label="Period comparison">Comparison</TabsTrigger>
          <TabsTrigger value="patterns" aria-label="Cost patterns">Patterns</TabsTrigger>
          <TabsTrigger value="forecast" aria-label="Financial forecast">Forecast</TabsTrigger>
          <TabsTrigger value="benchmarks" aria-label="Industry benchmarks">Benchmarks</TabsTrigger>
        </TabsList>

        {/* Trends Tab */}
        <TabsContent value="trends" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Revenue & Cost Trends</CardTitle>
              <CardDescription>Daily performance over time</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <ComposedChart data={data.dailyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(value) => format(new Date(value), 'MMM dd')}
                  />
                  <YAxis yAxisId="left" label={{ value: 'Amount ($)', angle: -90, position: 'insideLeft' }} />
                  <YAxis yAxisId="right" orientation="right" label={{ value: 'Percentage (%)', angle: 90, position: 'insideRight' }} />
                  <Tooltip 
                    labelFormatter={(value) => format(new Date(value), 'MMM dd, yyyy')}
                    formatter={(value: any, name: string) => {
                      if (name.includes('%')) return [`${value.toFixed(1)}%`, name];
                      return [`$${value.toFixed(2)}`, name];
                    }}
                  />
                  <Legend />
                  <Bar yAxisId="left" dataKey="net_revenue" fill={COLORS.revenue} name="Revenue" />
                  <Line yAxisId="right" type="monotone" dataKey="food_cost_percentage" stroke={COLORS.foodCost} name="Food Cost %" strokeWidth={2} />
                  <Line yAxisId="right" type="monotone" dataKey="labor_cost_percentage" stroke={COLORS.laborCost} name="Labor Cost %" strokeWidth={2} />
                  <Line yAxisId="right" type="monotone" dataKey="prime_cost_percentage" stroke={COLORS.primeCost} name="Prime Cost %" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cost Percentage Trends</CardTitle>
              <CardDescription>Tracking cost efficiency over time</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={data.dailyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(value) => format(new Date(value), 'MMM dd')}
                  />
                  <YAxis label={{ value: 'Percentage (%)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip 
                    labelFormatter={(value) => format(new Date(value), 'MMM dd, yyyy')}
                    formatter={(value: any) => `${value.toFixed(1)}%`}
                  />
                  <Legend />
                  <ReferenceLine y={data.benchmarks.industry_avg_food_cost} stroke="#ef4444" strokeDasharray="3 3" label="Industry Food Cost" />
                  <ReferenceLine y={data.benchmarks.industry_avg_labor_cost} stroke="#f59e0b" strokeDasharray="3 3" label="Industry Labor Cost" />
                  <Area type="monotone" dataKey="food_cost_percentage" stackId="1" stroke={COLORS.foodCost} fill={COLORS.foodCost} fillOpacity={0.6} name="Food Cost %" />
                  <Area type="monotone" dataKey="labor_cost_percentage" stackId="1" stroke={COLORS.laborCost} fill={COLORS.laborCost} fillOpacity={0.6} name="Labor Cost %" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Comparison Tab */}
        <TabsContent value="comparison" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Period Over Period</CardTitle>
                <CardDescription>Current vs Previous {timeframe} days</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Revenue</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">${data.comparison.current_period.revenue.toFixed(0)}</span>
                        <Badge variant={data.comparison.change.revenue_pct >= 0 ? 'default' : 'destructive'}>
                          {data.comparison.change.revenue_pct >= 0 ? '+' : ''}{data.comparison.change.revenue_pct.toFixed(1)}%
                        </Badge>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Previous: ${data.comparison.previous_period.revenue.toFixed(0)}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Food Cost</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{data.comparison.current_period.avg_food_cost_pct.toFixed(1)}%</span>
                        <Badge variant={data.comparison.current_period.avg_food_cost_pct <= data.comparison.previous_period.avg_food_cost_pct ? 'default' : 'destructive'}>
                          {data.comparison.current_period.avg_food_cost_pct <= data.comparison.previous_period.avg_food_cost_pct ? '↓' : '↑'}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Previous: {data.comparison.previous_period.avg_food_cost_pct.toFixed(1)}%
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Labor Cost</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{data.comparison.current_period.avg_labor_cost_pct.toFixed(1)}%</span>
                        <Badge variant={data.comparison.current_period.avg_labor_cost_pct <= data.comparison.previous_period.avg_labor_cost_pct ? 'default' : 'destructive'}>
                          {data.comparison.current_period.avg_labor_cost_pct <= data.comparison.previous_period.avg_labor_cost_pct ? '↓' : '↑'}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Previous: {data.comparison.previous_period.avg_labor_cost_pct.toFixed(1)}%
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium">Prime Cost</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{data.comparison.current_period.avg_prime_cost_pct.toFixed(1)}%</span>
                        <Badge variant={data.comparison.current_period.avg_prime_cost_pct <= data.comparison.previous_period.avg_prime_cost_pct ? 'default' : 'destructive'}>
                          {data.comparison.current_period.avg_prime_cost_pct <= data.comparison.previous_period.avg_prime_cost_pct ? '↓' : '↑'}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Previous: {data.comparison.previous_period.avg_prime_cost_pct.toFixed(1)}%
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Cost Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Food Cost', value: data.comparison.current_period.food_cost },
                        { name: 'Labor Cost', value: data.comparison.current_period.labor_cost },
                        { name: 'Gross Profit', value: data.comparison.current_period.revenue - data.comparison.current_period.prime_cost },
                      ]}
                      cx="50%"
                      cy="50%"
                      label={(entry) => `${entry.name}: $${entry.value.toFixed(0)}`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      <Cell fill={COLORS.foodCost} />
                      <Cell fill={COLORS.laborCost} />
                      <Cell fill={COLORS.profit} />
                    </Pie>
                    <Tooltip formatter={(value: any) => `$${value.toFixed(2)}`} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Patterns Tab */}
        <TabsContent value="patterns" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Day of Week Analysis</CardTitle>
              <CardDescription>Identify patterns and optimize operations</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={data.dayOfWeekPatterns}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis yAxisId="left" label={{ value: 'Revenue ($)', angle: -90, position: 'insideLeft' }} />
                  <YAxis yAxisId="right" orientation="right" label={{ value: 'Cost %', angle: 90, position: 'insideRight' }} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="avg_revenue" fill={COLORS.revenue} name="Avg Revenue" />
                  <Bar yAxisId="right" dataKey="avg_food_cost_pct" fill={COLORS.foodCost} name="Food Cost %" />
                  <Bar yAxisId="right" dataKey="avg_labor_cost_pct" fill={COLORS.laborCost} name="Labor Cost %" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {data.dayOfWeekPatterns.map((pattern, idx) => (
              <Card key={idx}>
                <CardContent className="pt-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-lg">{pattern.day}</h3>
                      <p className="text-sm text-muted-foreground">
                        Avg Revenue: ${pattern.avg_revenue.toFixed(2)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">
                        Food: {pattern.avg_food_cost_pct.toFixed(1)}%
                      </Badge>
                      <Badge variant="outline">
                        Labor: {pattern.avg_labor_cost_pct.toFixed(1)}%
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Forecast Tab */}
        <TabsContent value="forecast" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>7-Day Revenue Forecast</CardTitle>
              <CardDescription>Based on historical patterns and trends</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.forecast}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(value) => format(new Date(value), 'MMM dd')}
                  />
                  <YAxis label={{ value: 'Predicted Revenue ($)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip 
                    labelFormatter={(value) => format(new Date(value), 'MMM dd, yyyy')}
                    formatter={(value: any) => [`$${value.toFixed(2)}`, 'Predicted Revenue']}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="predicted_revenue" 
                    stroke="#10b981" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-4 text-sm text-muted-foreground text-center">
                Confidence: {data.forecast[0]?.confidence_level === 'high' ? 'High' : data.forecast[0]?.confidence_level === 'medium' ? 'Medium' : 'Low'}
                {' '}(based on {data.dailyData.length} days of data)
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4">
            {data.forecast.map((day, idx) => (
              <Card key={idx}>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{format(new Date(day.date), 'EEEE, MMM dd')}</h3>
                      <p className="text-sm text-muted-foreground">
                        Predicted Revenue
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold">${day.predicted_revenue.toFixed(0)}</p>
                      <Badge variant="outline">{day.confidence_level} confidence</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Benchmarks Tab */}
        <TabsContent value="benchmarks" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Industry Benchmarking</CardTitle>
              <CardDescription>Compare your performance against industry standards</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={benchmarkComparison} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 70]} />
                  <YAxis type="category" dataKey="metric" width={100} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="yours" fill="#3b82f6" name="Your Restaurant" />
                  <Bar dataKey="industry" fill="#94a3b8" name="Industry Average" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Performance Radar</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={[
                  { metric: 'Food Cost', value: 100 - (Math.abs(data.benchmarks.your_avg_food_cost - data.benchmarks.industry_avg_food_cost) * 3) },
                  { metric: 'Labor Cost', value: 100 - (Math.abs(data.benchmarks.your_avg_labor_cost - data.benchmarks.industry_avg_labor_cost) * 3) },
                  { metric: 'Prime Cost', value: 100 - (Math.abs(data.benchmarks.your_avg_prime_cost - data.benchmarks.industry_avg_prime_cost) * 2) },
                  { metric: 'Efficiency', value: data.efficiency.cost_control_score },
                  { metric: 'Revenue Growth', value: Math.min(100, Math.max(0, 50 + data.comparison.change.revenue_pct)) },
                ]}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="metric" />
                  <PolarRadiusAxis domain={[0, 100]} />
                  <Radar name="Your Performance" dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Food Cost Benchmark</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Your Average:</span>
                    <span className="font-medium">{data.benchmarks.your_avg_food_cost.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Industry:</span>
                    <span className="font-medium">{data.benchmarks.industry_avg_food_cost.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Difference:</span>
                    <span className={`font-medium ${data.benchmarks.your_avg_food_cost <= data.benchmarks.industry_avg_food_cost ? 'text-green-600' : 'text-red-600'}`}>
                      {data.benchmarks.your_avg_food_cost <= data.benchmarks.industry_avg_food_cost ? '✓' : '✗'} {Math.abs(data.benchmarks.your_avg_food_cost - data.benchmarks.industry_avg_food_cost).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Labor Cost Benchmark</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Your Average:</span>
                    <span className="font-medium">{data.benchmarks.your_avg_labor_cost.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Industry:</span>
                    <span className="font-medium">{data.benchmarks.industry_avg_labor_cost.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Difference:</span>
                    <span className={`font-medium ${data.benchmarks.your_avg_labor_cost <= data.benchmarks.industry_avg_labor_cost ? 'text-green-600' : 'text-red-600'}`}>
                      {data.benchmarks.your_avg_labor_cost <= data.benchmarks.industry_avg_labor_cost ? '✓' : '✗'} {Math.abs(data.benchmarks.your_avg_labor_cost - data.benchmarks.industry_avg_labor_cost).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Prime Cost Benchmark</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm">Your Average:</span>
                    <span className="font-medium">{data.benchmarks.your_avg_prime_cost.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Industry:</span>
                    <span className="font-medium">{data.benchmarks.industry_avg_prime_cost.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm">Difference:</span>
                    <span className={`font-medium ${data.benchmarks.your_avg_prime_cost <= data.benchmarks.industry_avg_prime_cost ? 'text-green-600' : 'text-red-600'}`}>
                      {data.benchmarks.your_avg_prime_cost <= data.benchmarks.industry_avg_prime_cost ? '✓' : '✗'} {Math.abs(data.benchmarks.your_avg_prime_cost - data.benchmarks.industry_avg_prime_cost).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
