import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useExpenseHealth } from '@/hooks/useExpenseHealth';
import { AlertCircle, CheckCircle2, TrendingUp, DollarSign, Activity } from 'lucide-react';

interface ExpenseHealthChipsProps {
  startDate: Date;
  endDate: Date;
  periodLabel: string;
}

export const ExpenseHealthChips = ({ startDate, endDate, periodLabel }: ExpenseHealthChipsProps) => {
  const { data, isLoading } = useExpenseHealth(startDate, endDate);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  const foodCostStatus = 
    data.foodCostPercentage >= data.foodCostTarget.min && data.foodCostPercentage <= data.foodCostTarget.max
      ? 'good'
      : data.foodCostPercentage > data.foodCostTarget.max
      ? 'high'
      : 'low';

  const laborStatus =
    data.laborPercentage >= data.laborTarget.min && data.laborPercentage <= data.laborTarget.max
      ? 'good'
      : data.laborPercentage > data.laborTarget.max
      ? 'high'
      : 'low';

  const processingFeesStatus = data.processingFeePercentage <= data.processingFeeTarget ? 'good' : 'high';
  const uncategorizedStatus = data.uncategorizedSpendPercentage <= data.uncategorizedSpendTarget ? 'good' : 'high';
  const cashCoverageStatus = data.cashCoverageBeforePayroll >= 1.5 ? 'good' : data.cashCoverageBeforePayroll >= 1.2 ? 'medium' : 'low';

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'good':
        return 'bg-green-500/10 text-green-700 border-green-500/20';
      case 'medium':
        return 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20';
      case 'high':
      case 'low':
        return 'bg-red-500/10 text-red-700 border-red-500/20';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusIcon = (status: string) => {
    return status === 'good' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <CardTitle>Expense Health</CardTitle>
        </div>
        <CardDescription>Key metrics • {periodLabel}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          {/* Food Cost % */}
          {data.foodCostPercentage > 0 && (
            <Badge variant="outline" className={`${getStatusColor(foodCostStatus)} py-2 px-3`}>
              <div className="flex items-center gap-2">
                {getStatusIcon(foodCostStatus)}
                <div>
                  <div className="text-xs font-normal">Food Cost</div>
                  <div className="font-semibold">
                    {data.foodCostPercentage.toFixed(1)}%
                  </div>
                  <div className="text-xs font-normal">
                    target: {data.foodCostTarget.min}-{data.foodCostTarget.max}%
                  </div>
                </div>
              </div>
            </Badge>
          )}

          {/* Labor % */}
          {data.laborPercentage > 0 && (
            <Badge variant="outline" className={`${getStatusColor(laborStatus)} py-2 px-3`}>
              <div className="flex items-center gap-2">
                {getStatusIcon(laborStatus)}
                <div>
                  <div className="text-xs font-normal">Labor</div>
                  <div className="font-semibold">
                    {data.laborPercentage.toFixed(1)}%
                  </div>
                  <div className="text-xs font-normal">
                    target: {data.laborTarget.min}-{data.laborTarget.max}%
                  </div>
                </div>
              </div>
            </Badge>
          )}

          {/* Prime Cost % */}
          {data.primeCostPercentage > 0 && (
            <Badge variant="outline" className="bg-blue-500/10 text-blue-700 border-blue-500/20 py-2 px-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                <div>
                  <div className="text-xs font-normal">Prime Cost</div>
                  <div className="font-semibold">
                    {data.primeCostPercentage.toFixed(1)}%
                  </div>
                  <div className="text-xs font-normal">
                    Food + Labor
                  </div>
                </div>
              </div>
            </Badge>
          )}

          {/* Processing Fees */}
          {data.processingFeePercentage > 0 && (
            <Badge variant="outline" className={`${getStatusColor(processingFeesStatus)} py-2 px-3`}>
              <div className="flex items-center gap-2">
                {getStatusIcon(processingFeesStatus)}
                <div>
                  <div className="text-xs font-normal">Processing Fees</div>
                  <div className="font-semibold">
                    {data.processingFeePercentage.toFixed(1)}%
                  </div>
                  <div className="text-xs font-normal">
                    target: ≤{data.processingFeeTarget}%
                  </div>
                </div>
              </div>
            </Badge>
          )}

          {/* Cash Coverage */}
          {data.cashCoverageBeforePayroll > 0 && (
            <Badge variant="outline" className={`${getStatusColor(cashCoverageStatus)} py-2 px-3`}>
              <div className="flex items-center gap-2">
                {getStatusIcon(cashCoverageStatus)}
                <div>
                  <div className="text-xs font-normal">Cash Coverage</div>
                  <div className="font-semibold">
                    {data.cashCoverageBeforePayroll.toFixed(1)}×
                  </div>
                  <div className="text-xs font-normal">
                    before payroll
                  </div>
                </div>
              </div>
            </Badge>
          )}

          {/* Uncategorized Spend */}
          <Badge variant="outline" className={`${getStatusColor(uncategorizedStatus)} py-2 px-3`}>
            <div className="flex items-center gap-2">
              {getStatusIcon(uncategorizedStatus)}
              <div>
                <div className="text-xs font-normal">Uncategorized</div>
                <div className="font-semibold">
                  {data.uncategorizedSpendPercentage.toFixed(0)}%
                </div>
                <div className="text-xs font-normal">
                  {uncategorizedStatus === 'high' ? 'fix to improve' : 'target: <5%'}
                </div>
              </div>
            </div>
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
};
