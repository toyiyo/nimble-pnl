import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Sparkles, Calendar, DollarSign, TrendingUp, AlertCircle, Home } from "lucide-react";
import { usePredictiveMetrics } from "@/hooks/usePredictiveMetrics";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import type { Period } from "@/components/PeriodSelector";

interface PredictionsTabProps {
  selectedPeriod: Period;
  selectedBankAccount: string;
}

export function PredictionsTab({ selectedPeriod, selectedBankAccount }: PredictionsTabProps) {
  const { data: metrics, isLoading, isError, error, refetch } = usePredictiveMetrics(selectedPeriod.from, selectedPeriod.to, selectedBankAccount);

  if (isError) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-destructive mb-4" />
          <p className="text-lg font-semibold mb-2">Failed to load predictions</p>
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
        <Skeleton className="h-32" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No prediction data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* AI Predictions Header */}
      <Card className="bg-gradient-to-br from-purple-500/10 via-primary/5 to-transparent border-purple-500/20">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="h-6 w-6 text-purple-500" />
            <h3 className="text-xl font-bold">AI-Powered Predictions</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Based on pattern analysis of your transaction history
          </p>
        </CardContent>
      </Card>

      {/* Next Deposit & Payroll Predictions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Next Deposit */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-success" />
              Next Expected Deposit
            </CardTitle>
            <CardDescription>POS revenue prediction</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.nextDeposit ? (
              <div className="space-y-4">
                <div className="text-center p-6 rounded-lg bg-gradient-to-br from-success/10 to-transparent">
                  <Calendar className="h-8 w-8 mx-auto mb-3 text-success" />
                  <div className="text-2xl font-bold mb-1">
                    {format(metrics.nextDeposit.expectedDate, 'EEEE, MMM dd')}
                  </div>
                  <div className="text-sm text-muted-foreground mb-3">
                    ~{format(metrics.nextDeposit.expectedDate, 'h:mm a')}
                  </div>
                  <div className="text-lg font-semibold text-success">
                    ${metrics.nextDeposit.expectedAmount.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">Expected amount</div>
                </div>
                
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">Confidence</span>
                  <Badge variant={metrics.nextDeposit.confidence > 80 ? 'default' : 'secondary'}>
                    {metrics.nextDeposit.confidence}% confident
                  </Badge>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Not enough deposit history to predict</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Next Payroll */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              Next Expected Payroll
            </CardTitle>
            <CardDescription>Detected pattern</CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.nextPayroll ? (
              <div className="space-y-4">
                <div className="text-center p-6 rounded-lg bg-gradient-to-br from-primary/10 to-transparent">
                  <Calendar className="h-8 w-8 mx-auto mb-3 text-primary" />
                  <div className="text-2xl font-bold mb-1">
                    {format(metrics.nextPayroll.expectedDate, 'EEEE, MMM dd')}
                  </div>
                  <div className="text-sm text-muted-foreground mb-3">
                    Typical {metrics.nextPayroll.dayOfWeek}
                  </div>
                  <div className="text-lg font-semibold text-primary">
                    ${metrics.nextPayroll.expectedAmount.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">Expected amount</div>
                </div>
                
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <span className="text-sm text-muted-foreground">Pattern</span>
                  <Badge variant="secondary">
                    Every {metrics.nextPayroll.dayOfWeek}
                  </Badge>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No payroll pattern detected</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Supplier Cost Drift */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Supplier Cost Drift Alerts
          </CardTitle>
          <CardDescription>Price changes detected vs previous period</CardDescription>
        </CardHeader>
        <CardContent>
          {metrics.supplierCostDrift.length > 0 ? (
            <div className="space-y-3">
              {metrics.supplierCostDrift.map((drift, index) => (
                <div 
                  key={index} 
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    drift.driftPercent > 0 
                      ? 'bg-red-500/10 border-red-500/20' 
                      : 'bg-green-500/10 border-green-500/20'
                  }`}
                >
                  <div className="flex-1">
                    <p className="font-medium mb-1">{drift.supplier}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>Previous: ${drift.avgPrevious30Days.toLocaleString()}</span>
                      <span>→</span>
                      <span>Current: ${drift.avgLast30Days.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="text-right ml-4">
                    <Badge variant={drift.driftPercent > 0 ? 'destructive' : 'default'}>
                      {drift.driftPercent > 0 ? '↑' : '↓'} {Math.abs(drift.driftPercent).toFixed(1)}%
                    </Badge>
                    {drift.driftPercent > 10 && (
                      <p className="text-xs text-destructive mt-1">Review pricing</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No significant cost changes detected</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Seasonality Detection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Expense Seasonality
          </CardTitle>
          <CardDescription>Patterns and trends</CardDescription>
        </CardHeader>
        <CardContent>
          <div className={`p-6 rounded-lg ${
            metrics.seasonalityDetected 
              ? 'bg-gradient-to-br from-yellow-500/10 to-transparent border border-yellow-500/20' 
              : 'bg-muted/50'
          }`}>
            <div className="flex items-start gap-3">
              {metrics.seasonalityDetected ? (
                <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
              ) : (
                <Sparkles className="h-5 w-5 text-primary mt-0.5" />
              )}
              <div>
                <p className="font-semibold mb-2">
                  {metrics.seasonalityDetected ? 'Seasonal Pattern Detected' : 'Stable Spending Pattern'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {metrics.seasonalityMessage}
                </p>
              </div>
            </div>
          </div>

          {metrics.seasonalityDetected && (
            <div className="mt-4 p-4 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-sm">
                <strong>Tip:</strong> Consider adjusting your cash reserves to account for seasonal spending variations.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rent & Fixed Costs Detection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Home className="h-5 w-5 text-primary" />
            Rent & Fixed Costs Detected
          </CardTitle>
          <CardDescription>
            Recurring monthly expenses automatically identified
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(() => {
            const isRentOrLargeMonthly = (expense: typeof metrics.recurringExpenses[0]) =>
              expense.frequency === 'monthly' && 
              (expense.vendor.toLowerCase().includes('rent') ||
               expense.vendor.toLowerCase().includes('property') ||
               expense.vendor.toLowerCase().includes('landlord') ||
               expense.vendor.toLowerCase().includes('lease') ||
               expense.avgAmount > 1000);

            const filteredExpenses = metrics.recurringExpenses?.filter(isRentOrLargeMonthly) || [];

            return metrics.recurringExpenses && metrics.recurringExpenses.length > 0 ? (
              <div className="space-y-4">
                {filteredExpenses
                  .slice(0, 3)
                  .map((expense, idx) => (
                    <div key={idx} className="flex items-center justify-between p-4 rounded-lg bg-gradient-to-r from-primary/5 to-transparent border border-primary/10">
                      <div>
                        <p className="font-semibold">{expense.vendor}</p>
                        <p className="text-sm text-muted-foreground capitalize">{expense.frequency} recurring</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold">
                          ${expense.avgAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Next: {format(expense.nextExpectedDate, 'MMM dd')}
                        </p>
                      </div>
                    </div>
                  ))}
                
                {filteredExpenses.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No rent or large fixed costs detected in recurring expenses
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">
                No recurring monthly expenses detected
              </p>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}
