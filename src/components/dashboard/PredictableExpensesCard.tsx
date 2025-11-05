import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { usePredictableExpenses } from '@/hooks/usePredictableExpenses';
import { Calendar, Clock, DollarSign, TrendingUp } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';

interface PredictableExpensesCardProps {
  lookAheadDays?: number;
}

const CONFIDENCE_COLORS = {
  high: 'bg-green-500/10 text-green-700 border-green-500/20',
  medium: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20',
  low: 'bg-gray-500/10 text-gray-700 border-gray-500/20',
};

const FREQUENCY_LABELS = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
};

export const PredictableExpensesCard = ({ lookAheadDays = 30 }: PredictableExpensesCardProps) => {
  const { data, isLoading } = usePredictableExpenses(lookAheadDays);
  const today = new Date();

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.upcomingExpenses.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-muted/50 to-transparent">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Calendar className="h-6 w-6 text-primary" />
            <div>
              <CardTitle className="text-2xl">What's Coming Up</CardTitle>
              <CardDescription>Predictable expenses • Next {lookAheadDays} days</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="py-12 text-center">
          <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No predictable expenses detected</h3>
          <p className="text-muted-foreground">
            We need more transaction history to identify recurring payments.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Calendar className="h-6 w-6 text-primary transition-transform duration-300 group-hover:scale-110" />
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                What's Coming Up
              </CardTitle>
              <CardDescription>Predictable expenses • Next {lookAheadDays} days</CardDescription>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">
              ${data.totalExpected.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className="text-sm text-muted-foreground">Expected Total</div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data.upcomingExpenses.map((expense) => {
            const daysUntil = differenceInDays(expense.expectedDate, today);
            const isUrgent = daysUntil <= 3;

            return (
              <div
                key={`${expense.vendor}-${expense.expectedDate.toISOString()}`}
                className={`p-4 rounded-lg border transition-all ${
                  isUrgent
                    ? 'bg-amber-500/5 border-amber-500/20'
                    : 'bg-muted/30 border-border hover:bg-accent/50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold truncate">{expense.vendor}</span>
                      <Badge variant="outline" className={CONFIDENCE_COLORS[expense.confidence]}>
                        {expense.confidence} confidence
                      </Badge>
                      {isUrgent && (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20">
                          Due Soon
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {format(expense.expectedDate, 'MMM d, yyyy')}
                        {daysUntil === 0 && ' (today)'}
                        {daysUntil === 1 && ' (tomorrow)'}
                        {daysUntil > 1 && ` (in ${daysUntil} days)`}
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {FREQUENCY_LABELS[expense.frequency]}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 ml-4">
                    <div className="text-lg font-bold">
                      ${expense.expectedAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      est. amount
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {data.highConfidenceTotal > 0 && (
          <div className="mt-4 p-3 bg-muted/30 rounded-lg border border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">High Confidence Total</span>
              </div>
              <span className="text-sm font-bold">
                ${data.highConfidenceTotal.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Expected expenses with high confidence based on historical patterns
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
