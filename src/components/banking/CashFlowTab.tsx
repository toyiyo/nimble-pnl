import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DashboardMetricCard } from "@/components/DashboardMetricCard";
import { TrendingUp, TrendingDown, DollarSign, Activity } from "lucide-react";
import { useCashFlowMetrics } from "@/hooks/useCashFlowMetrics";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { format, subDays } from "date-fns";

export function CashFlowTab() {
  const { data: metrics, isLoading } = useCashFlowMetrics();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No transaction data available</p>
      </div>
    );
  }

  // Prepare daily cash flow data for chart
  const dailyChartData = metrics.trend.map((value, index) => ({
    date: format(subDays(new Date(), 13 - index), 'MMM dd'),
    amount: value,
  }));

  // Prepare inflows vs outflows comparison
  const comparisonData = [
    { name: 'Inflows', value: metrics.netInflows30d, color: 'hsl(var(--success))' },
    { name: 'Outflows', value: metrics.netOutflows30d, color: 'hsl(var(--destructive))' },
  ];

  const volatilityScore = Math.max(0, 100 - (metrics.volatility / 100));
  const getVolatilityVariant = () => {
    if (volatilityScore >= 80) return 'success';
    if (volatilityScore >= 60) return 'warning';
    return 'danger';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Primary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DashboardMetricCard
          title="Net Inflows (30d)"
          value={`$${metrics.netInflows30d.toLocaleString()}`}
          trend={{
            value: metrics.trailingTrendPercentage,
            label: 'vs previous 30d'
          }}
          icon={TrendingUp}
          variant="success"
          sparklineData={metrics.trend.map(v => ({ value: v > 0 ? v : 0 }))}
        />
        
        <DashboardMetricCard
          title="Net Outflows (30d)"
          value={`$${metrics.netOutflows30d.toLocaleString()}`}
          icon={TrendingDown}
          variant="danger"
          sparklineData={metrics.trend.map(v => ({ value: v < 0 ? Math.abs(v) : 0 }))}
        />
        
        <DashboardMetricCard
          title="Net Cash Flow (30d)"
          value={`${metrics.netCashFlow30d >= 0 ? '+' : ''}$${metrics.netCashFlow30d.toLocaleString()}`}
          icon={DollarSign}
          variant={metrics.netCashFlow30d >= 0 ? 'success' : 'danger'}
          subtitle={`Avg: $${Math.round(metrics.avgDailyCashFlow)}/day`}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Cash Flow Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Daily Cash Flow
            </CardTitle>
            <CardDescription>Last 14 days</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={dailyChartData}>
                <defs>
                  <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis 
                  dataKey="date" 
                  className="text-xs text-muted-foreground"
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                />
                <YAxis 
                  className="text-xs text-muted-foreground"
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--background))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px'
                  }}
                  formatter={(value: number) => [`$${value.toLocaleString()}`, 'Amount']}
                />
                <Area 
                  type="monotone" 
                  dataKey="amount" 
                  stroke="hsl(var(--primary))" 
                  strokeWidth={2}
                  fill="url(#colorAmount)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Inflows vs Outflows */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              Inflows vs Outflows
            </CardTitle>
            <CardDescription>Last 30 days comparison</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={comparisonData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: $${value.toLocaleString()}`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {comparisonData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => `$${value.toLocaleString()}`}
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--background))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between p-3 rounded-lg bg-success/10">
                <span className="text-sm font-medium">Net Position</span>
                <span className={`text-sm font-bold ${metrics.netCashFlow30d >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {metrics.netCashFlow30d >= 0 ? '+' : ''}${metrics.netCashFlow30d.toLocaleString()}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Volatility Gauge */}
      <Card className={`border-${getVolatilityVariant() === 'success' ? 'green' : getVolatilityVariant() === 'warning' ? 'yellow' : 'red'}-200`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Cash Flow Volatility
          </CardTitle>
          <CardDescription>Stability score (higher is better)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-4xl font-bold">{volatilityScore.toFixed(0)}/100</span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                volatilityScore >= 80 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' :
                volatilityScore >= 60 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
              }`}>
                {volatilityScore >= 80 ? 'Low Volatility' : volatilityScore >= 60 ? 'Medium Volatility' : 'High Volatility'}
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-4">
              <div 
                className={`h-4 rounded-full transition-all duration-1000 ${
                  volatilityScore >= 80 ? 'bg-gradient-to-r from-emerald-500 to-green-600' :
                  volatilityScore >= 60 ? 'bg-gradient-to-r from-yellow-500 to-orange-600' :
                  'bg-gradient-to-r from-red-500 to-rose-600'
                }`}
                style={{ width: `${volatilityScore}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {volatilityScore >= 80 
                ? 'Your cash flow is stable and predictable.' 
                : volatilityScore >= 60 
                ? 'Some fluctuation in your cash flow. Monitor closely.' 
                : 'High cash flow variability detected. Consider smoothing expenses or revenue timing.'}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
