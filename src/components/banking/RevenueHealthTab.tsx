import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DashboardMetricCard } from "@/components/DashboardMetricCard";
import { TrendingUp, DollarSign, AlertCircle, Star } from "lucide-react";
import { useRevenueHealth } from "@/hooks/useRevenueHealth";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Badge } from "@/components/ui/badge";
import type { Period } from "@/components/PeriodSelector";

interface RevenueHealthTabProps {
  selectedPeriod: Period;
  selectedBankAccount: string;
}

export function RevenueHealthTab({ selectedPeriod, selectedBankAccount }: RevenueHealthTabProps) {
  const { data: metrics, isLoading } = useRevenueHealth(selectedPeriod.from, selectedPeriod.to, selectedBankAccount);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No revenue data available</p>
      </div>
    );
  }

  const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', 'hsl(var(--muted))'];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Primary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Deposit Frequency</span>
              <DollarSign className="h-4 w-4 text-primary" />
            </div>
            <div className="flex items-center gap-2">
              {[...Array(5)].map((_, i) => (
                <Star
                  key={i}
                  className={`h-5 w-5 ${
                    i < metrics.depositFrequencyScore
                      ? 'fill-yellow-500 text-yellow-500'
                      : 'text-muted'
                  }`}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Every {metrics.depositFrequency.toFixed(1)} days
            </p>
          </div>
        </Card>

        <DashboardMetricCard
          title="Avg Deposit Size"
          value={`$${metrics.avgDepositSize.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={TrendingUp}
          variant="default"
          subtitle={`${metrics.depositCount} deposits`}
          periodLabel={selectedPeriod.label}
        />

        <DashboardMetricCard
          title="Largest Deposit Ratio"
          value={`${metrics.largestToAvgRatio.toFixed(1)}x`}
          icon={TrendingUp}
          variant={metrics.largestToAvgRatio > 3 ? 'warning' : 'default'}
          subtitle="vs average deposit"
          periodLabel={selectedPeriod.label}
        />

        <DashboardMetricCard
          title="Refund Rate"
          value={`${metrics.refundRate.toFixed(2)}%`}
          icon={AlertCircle}
          variant={metrics.refundRate < 2 ? 'success' : metrics.refundRate < 5 ? 'warning' : 'danger'}
          subtitle="Of total revenue"
          periodLabel={selectedPeriod.label}
        />
      </div>

      {/* Revenue Sources Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            Revenue Sources Breakdown
          </CardTitle>
          <CardDescription>{selectedPeriod.label}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={metrics.revenueSourceBreakdown}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percentage }) => `${name}: ${percentage.toFixed(1)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="amount"
                >
                  {metrics.revenueSourceBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
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
                <Legend />
              </PieChart>
            </ResponsiveContainer>

            <div className="space-y-3">
              {metrics.revenueSourceBreakdown.map((source, index) => (
                <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    />
                    <span className="text-sm font-medium">{source.source}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold">${source.amount.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">{source.percentage.toFixed(1)}%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Deposit Anomaly Detection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-primary" />
            Deposit Health Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-r from-success/10 to-transparent border border-success/20">
            <div>
              <p className="font-semibold">Deposit Pattern: {metrics.depositFrequencyScore >= 4 ? 'Excellent' : metrics.depositFrequencyScore >= 3 ? 'Good' : 'Needs Attention'}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {metrics.depositCount} deposits in {selectedPeriod.label.toLowerCase()}
              </p>
            </div>
            <Badge variant={metrics.missingDepositDays === 0 ? 'default' : 'secondary'}>
              {metrics.missingDepositDays === 0 ? '✓ On Track' : `${metrics.missingDepositDays} Missing Days`}
            </Badge>
          </div>

          {metrics.anomalousDeposits.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">Anomalous Deposits Detected</h4>
              {metrics.anomalousDeposits.map((anomaly, index) => (
                <div key={index} className="flex items-center justify-between p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <div>
                    <p className="text-sm font-medium">{anomaly.date}</p>
                    <p className="text-xs text-muted-foreground">{anomaly.reason}</p>
                  </div>
                  <span className="text-sm font-bold">${anomaly.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          {metrics.anomalousDeposits.length === 0 && (
            <div className="text-center py-6 text-muted-foreground text-sm">
              All deposits within expected range
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
