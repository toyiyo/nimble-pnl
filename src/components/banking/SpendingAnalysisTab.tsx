import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DashboardMetricCard } from "@/components/DashboardMetricCard";
import { PieChart as PieChartIcon, TrendingDown, RefreshCw, AlertTriangle, CreditCard, CalendarDays, Brain, AlertCircle } from "lucide-react";
import { useSpendingAnalysis } from "@/hooks/useSpendingAnalysis";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Badge } from "@/components/ui/badge";
import type { Period } from "@/components/PeriodSelector";

interface SpendingAnalysisTabProps {
  selectedPeriod: Period;
  selectedBankAccount: string;
}

export function SpendingAnalysisTab({ selectedPeriod, selectedBankAccount }: SpendingAnalysisTabProps) {
  const { data: metrics, isLoading } = useSpendingAnalysis(selectedPeriod.from, selectedPeriod.to, selectedBankAccount);

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
            <Skeleton key={i} className="h-96" />
          ))}
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No spending data available</p>
      </div>
    );
  }

  const COLORS = ['hsl(var(--primary))', 'hsl(var(--accent))', 'hsl(var(--success))', 'hsl(var(--warning))', 'hsl(var(--muted))'];
  
  const concentrationVariant = metrics.vendorConcentration > 70 ? 'destructive' : metrics.vendorConcentration > 50 ? 'secondary' : 'default';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Primary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DashboardMetricCard
          title="Total Outflows"
          value={`$${metrics.totalOutflows.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={TrendingDown}
          variant="default"
          subtitle="Total expenses"
          periodLabel={selectedPeriod.label}
        />

        <DashboardMetricCard
          title="Avg Weekly Spend"
          value={`$${metrics.avgWeeklyOutflow.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={PieChartIcon}
          variant="default"
          subtitle="Average per week"
          periodLabel={selectedPeriod.label}
        />

        <DashboardMetricCard
          title="Vendor Concentration"
          value={`${metrics.vendorConcentration.toFixed(1)}%`}
          icon={AlertTriangle}
          variant={metrics.vendorConcentration > 70 ? 'danger' : metrics.vendorConcentration > 50 ? 'warning' : 'success'}
          subtitle="Top 3 vendors"
          periodLabel={selectedPeriod.label}
        />
      </div>

      {/* Top Vendors */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-primary" />
            Top 5 Vendors by Spend
          </CardTitle>
          <CardDescription>{selectedPeriod.label}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {metrics.topVendors.map((vendor, index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-2xl font-bold text-muted-foreground">{index + 1}</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{vendor.vendor}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold">${vendor.total.toLocaleString()}</span>
                          <span className="text-xs text-muted-foreground">{vendor.percentage.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div 
                          className="bg-gradient-to-r from-primary to-accent h-2 rounded-full transition-all duration-500"
                          style={{ width: `${vendor.percentage}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                {metrics.vendorSpendVariance[index] && Math.abs(metrics.vendorSpendVariance[index].changePercent) > 15 && (
                  <Badge variant={metrics.vendorSpendVariance[index].changePercent > 0 ? 'destructive' : 'default'} className="ml-12">
                    {metrics.vendorSpendVariance[index].changePercent > 0 ? '↑' : '↓'} 
                    {Math.abs(metrics.vendorSpendVariance[index].changePercent).toFixed(1)}% vs previous period
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Category Breakdown and Vendor Concentration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5 text-primary" />
              Spend by Category
            </CardTitle>
            <CardDescription>Distribution across categories</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={metrics.categoryBreakdown}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ category, percentage }) => `${category}: ${percentage.toFixed(1)}%`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="amount"
                >
                  {metrics.categoryBreakdown.map((entry, index) => (
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
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Vendor Concentration Risk */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-primary" />
              Vendor Concentration Index
            </CardTitle>
            <CardDescription>Dependency on top vendors</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="text-center">
                <div className="text-5xl font-bold mb-2">{metrics.vendorConcentration.toFixed(0)}%</div>
                <Badge variant={concentrationVariant} className="text-sm">
                  {concentrationVariant === 'destructive' ? 'High Risk' : concentrationVariant === 'secondary' ? 'Medium Risk' : 'Low Risk'}
                </Badge>
              </div>

              <div className="w-full bg-muted rounded-full h-6">
                <div 
                  className={`h-6 rounded-full transition-all duration-1000 ${
                    concentrationVariant === 'destructive' ? 'bg-gradient-to-r from-red-500 to-rose-600' :
                    concentrationVariant === 'secondary' ? 'bg-gradient-to-r from-yellow-500 to-orange-600' :
                    'bg-gradient-to-r from-emerald-500 to-green-600'
                  }`}
                  style={{ width: `${Math.min(metrics.vendorConcentration, 100)}%` }}
                />
              </div>

              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {concentrationVariant === 'destructive' 
                    ? 'High dependency on few vendors increases risk. Consider diversifying suppliers.'
                    : concentrationVariant === 'secondary'
                    ? 'Moderate concentration. Monitor vendor performance and have backup options.'
                    : 'Well-diversified vendor base. Good risk management.'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recurring Expenses */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            Recurring Expenses Detected
          </CardTitle>
          <CardDescription>Auto-detected patterns</CardDescription>
        </CardHeader>
        <CardContent>
          {metrics.recurringExpenses.length > 0 ? (
            <div className="space-y-3">
              {metrics.recurringExpenses.map((expense, index) => (
                <div key={index} className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-r from-primary/5 to-transparent border border-border">
                  <div className="flex items-center gap-3">
                    <RefreshCw className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">{expense.vendor}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" className="text-xs">
                          {expense.frequency.charAt(0).toUpperCase() + expense.frequency.slice(1)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Last: ${expense.lastAmount.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold">${expense.avgAmount.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">avg</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground text-sm">
              No recurring patterns detected yet
            </div>
          )}
        </CardContent>
      </Card>

      {/* Efficiency & Data Quality Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Efficiency & Data Quality Metrics
          </CardTitle>
          <CardDescription>
            Track processing costs, spending patterns, and data completeness
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {/* Payment Processing Fees */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CreditCard className="h-4 w-4" />
                Processing Fees
              </div>
              <p className="text-2xl font-bold">{metrics.processingFeePercentage.toFixed(2)}%</p>
              <p className="text-xs text-muted-foreground">
                ${metrics.processingFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
              </p>
              <Badge variant={metrics.processingFeePercentage > 3 ? 'secondary' : 'default'} className="text-xs">
                {metrics.processingFeePercentage > 3 ? 'Review rates' : 'Normal'}
              </Badge>
            </div>
            
            {/* Weekend Ratio */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarDays className="h-4 w-4" />
                Weekend Spending
              </div>
              <p className="text-2xl font-bold">{metrics.weekendRatio.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">
                ${metrics.weekendOutflows.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} spent
              </p>
              <Badge variant={metrics.weekendRatio > 20 ? 'secondary' : 'default'} className="text-xs">
                {metrics.weekendRatio > 20 ? 'Higher than typical' : 'Normal pattern'}
              </Badge>
            </div>
            
            {/* AI Confidence */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Brain className="h-4 w-4" />
                AI Categorization
              </div>
              <p className="text-2xl font-bold">{metrics.aiConfidencePercentage.toFixed(0)}%</p>
              <p className="text-xs text-muted-foreground">High confidence</p>
              <Badge 
                variant={
                  metrics.aiConfidencePercentage >= 70 ? 'default' : 
                  metrics.aiConfidencePercentage >= 40 ? 'secondary' : 
                  'destructive'
                } 
                className="text-xs"
              >
                {metrics.aiConfidencePercentage >= 70 ? 'Excellent' : 
                 metrics.aiConfidencePercentage >= 40 ? 'Good' : 
                 'Needs review'}
              </Badge>
            </div>
            
            {/* Uncategorized */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                Uncategorized
              </div>
              <p className="text-2xl font-bold">{metrics.uncategorizedPercentage.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">
                ${metrics.uncategorizedSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} untagged
              </p>
              <Badge variant={metrics.uncategorizedPercentage > 10 ? 'destructive' : 'default'} className="text-xs">
                {metrics.uncategorizedPercentage > 10 ? 'Action needed' : 'Good'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
