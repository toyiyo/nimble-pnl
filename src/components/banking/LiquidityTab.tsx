import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DashboardMetricCard } from "@/components/DashboardMetricCard";
import { AlertTriangle, TrendingDown, Wallet, AlertCircle } from "lucide-react";
import { useLiquidityMetrics } from "@/hooks/useLiquidityMetrics";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { format } from "date-fns";
import type { Period } from "@/components/PeriodSelector";

interface LiquidityTabProps {
  selectedPeriod: Period;
  selectedBankAccount: string;
}

export function LiquidityTab({ selectedPeriod, selectedBankAccount }: LiquidityTabProps) {
  const { data: metrics, isLoading, isError, error, refetch } = useLiquidityMetrics(selectedPeriod.from, selectedPeriod.to, selectedBankAccount);

  if (isError) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-destructive mb-4" />
          <p className="text-lg font-semibold mb-2">Failed to load liquidity data</p>
          <p className="text-sm text-muted-foreground mb-4">{error?.message}</p>
          <Button onClick={() => refetch()} variant="outline">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!metrics || metrics.currentBalance === undefined) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Wallet className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-lg font-semibold mb-2">No liquidity data available</p>
          <p className="text-sm text-muted-foreground">Connect a bank account to see cash runway metrics</p>
        </CardContent>
      </Card>
    );
  }

  const runwayPercentage = Math.min((metrics.daysOfCash / 90) * 100, 100);
  const chartData = metrics.burnRateTrend.map((value, index) => ({
    week: `Week ${metrics.burnRateTrend.length - index}`,
    burnRate: value,
  }));

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Runway Alert */}
      <Alert variant={metrics.runwayStatus === 'critical' ? 'destructive' : 'default'}
        className={metrics.runwayStatus === 'caution' ? 'border-yellow-500 bg-yellow-500/10' : ''}>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>
          {metrics.runwayStatus === 'critical' ? '🚨 Critical Cash Runway Alert' : 
           metrics.runwayStatus === 'caution' ? '⚠️ Cash Runway Caution' : 
           '✓ Healthy Cash Position'}
        </AlertTitle>
        <AlertDescription className="mt-2">
          <div className="space-y-3">
            <div>
              <p className="text-lg font-bold mb-1">
                You have {Math.floor(metrics.daysOfCash)} days of cash remaining
              </p>
              {metrics.projectedZeroDate && (
                <p className="text-sm text-muted-foreground">
                  Projected zero date: {format(metrics.projectedZeroDate, 'MMMM dd, yyyy')}
                </p>
              )}
            </div>

            <div className="w-full bg-muted rounded-full h-4">
              <div 
                className={`h-4 rounded-full transition-all duration-1000 ${
                  metrics.runwayStatus === 'critical' ? 'bg-gradient-to-r from-red-500 to-rose-600' :
                  metrics.runwayStatus === 'caution' ? 'bg-gradient-to-r from-yellow-500 to-orange-600' :
                  'bg-gradient-to-r from-emerald-500 to-green-600'
                }`}
                style={{ width: `${runwayPercentage}%` }}
              />
            </div>

            <p className="text-sm mt-2">
              <strong>Recommendation:</strong> {metrics.recommendation}
            </p>
          </div>
        </AlertDescription>
      </Alert>

      {/* Primary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DashboardMetricCard
          title="Current Balance"
          value={`$${metrics.currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={Wallet}
          variant={metrics.currentBalance > 0 ? 'success' : 'danger'}
          subtitle="Total across accounts"
          periodLabel={selectedPeriod.label}
        />

        <DashboardMetricCard
          title="Avg Weekly Outflow"
          value={`$${metrics.avgWeeklyOutflow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={TrendingDown}
          variant="default"
          subtitle="Based on recent activity"
          periodLabel={selectedPeriod.label}
        />

        <DashboardMetricCard
          title="Cash Burn Rate"
          value={`$${Math.abs(metrics.cashBurnRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/wk`}
          icon={AlertTriangle}
          variant={metrics.cashBurnRate < 0 ? 'success' : metrics.cashBurnRate < metrics.avgWeeklyOutflow * 0.2 ? 'warning' : 'danger'}
          subtitle={metrics.cashBurnRate < 0 ? 'Net positive' : 'Net outflow'}
          periodLabel={selectedPeriod.label}
        />
      </div>

      {/* Burn Rate Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-primary" />
            Weekly Burn Rate Trend
          </CardTitle>
          <CardDescription>Last {metrics.burnRateTrend.length} weeks</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <defs>
                <linearGradient id="burnRateGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="week" 
                className="text-xs text-muted-foreground"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
              />
              <YAxis 
                className="text-xs text-muted-foreground"
                tick={{ fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px'
                }}
                formatter={(value: number) => [
                  `$${value.toLocaleString()}`, 
                  value < 0 ? 'Net Positive' : 'Net Burn'
                ]}
              />
              <Line 
                type="monotone" 
                dataKey="burnRate" 
                stroke="hsl(var(--destructive))" 
                strokeWidth={2}
                fill="url(#burnRateGradient)"
              />
            </LineChart>
          </ResponsiveContainer>

          <div className="mt-6 grid grid-cols-3 gap-4 text-center">
            <div className="p-3 rounded-lg bg-success/10">
              <div className="text-xs text-muted-foreground mb-1">Healthy Zone</div>
              <div className="text-sm font-semibold text-success">{'<'} $0</div>
            </div>
            <div className="p-3 rounded-lg bg-yellow-500/10">
              <div className="text-xs text-muted-foreground mb-1">Caution Zone</div>
              <div className="text-sm font-semibold text-yellow-600">$0 - $2k</div>
            </div>
            <div className="p-3 rounded-lg bg-destructive/10">
              <div className="text-xs text-muted-foreground mb-1">Critical Zone</div>
              <div className="text-sm font-semibold text-destructive">{'>'} $2k</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Additional Insights */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Daily Cash Analysis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">Avg Daily Outflow</span>
              <span className="text-sm font-bold">${metrics.avgDailyOutflow.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">Days Until Zero</span>
              <span className="text-sm font-bold">{Math.floor(metrics.daysOfCash)} days</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">Status</span>
              <span className={`text-sm font-bold ${
                metrics.runwayStatus === 'healthy' ? 'text-success' :
                metrics.runwayStatus === 'caution' ? 'text-yellow-600' :
                'text-destructive'
              }`}>
                {metrics.runwayStatus.charAt(0).toUpperCase() + metrics.runwayStatus.slice(1)}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Action Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {metrics.runwayStatus === 'critical' && (
              <>
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold">Immediate Action Required</p>
                    <p className="text-muted-foreground">Reduce expenses or secure additional funding</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50">
                  <span className="text-sm">Review and cut non-essential costs</span>
                </div>
                <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50">
                  <span className="text-sm">Accelerate receivables collection</span>
                </div>
              </>
            )}
            {metrics.runwayStatus === 'caution' && (
              <>
                <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold">Monitor Closely</p>
                    <p className="text-muted-foreground">Consider cost optimization opportunities</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50">
                  <span className="text-sm">Review upcoming large expenses</span>
                </div>
              </>
            )}
            {metrics.runwayStatus === 'healthy' && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-success/10">
                <div className="text-sm">
                  <p className="font-semibold text-success">Strong Position</p>
                  <p className="text-muted-foreground">Continue monitoring weekly trends</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
