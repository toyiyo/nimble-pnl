import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useEmployeeTips, calculateEmployeeTipTotal } from '@/hooks/useEmployeeTips';
import { formatCurrencyFromCents } from '@/utils/tipPooling';
import { format } from 'date-fns';
import { DollarSign, User, Trash2, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface EmployeeDeclaredTipsProps {
  restaurantId: string;
  date: string;
  onImport?: (totalCents: number) => void;
}

/**
 * Component to display employee-declared tips for a specific date
 * Shows tips entered by employees via clock-out or self-service
 */
export const EmployeeDeclaredTips = ({ restaurantId, date, onImport }: EmployeeDeclaredTipsProps) => {
  const { tips, isLoading, deleteTip, isDeleting } = useEmployeeTips(restaurantId);

  // Filter tips for the selected date
  const dateTips = (tips || []).filter(tip => {
    const tipDate = format(new Date(tip.recorded_at), 'yyyy-MM-dd');
    return tipDate === date;
  });

  const totalTipsCents = calculateEmployeeTipTotal(dateTips);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (dateTips.length === 0) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          No employee-declared tips for {format(new Date(date), 'MMMM d, yyyy')}.
          Employees can declare tips when clocking out or via the self-service page.
        </AlertDescription>
      </Alert>
    );
  }

  // Group by employee
  const tipsByEmployee = dateTips.reduce((acc, tip) => {
    const key = tip.employee_id;
    if (!acc[key]) {
      acc[key] = {
        employeeId: tip.employee_id,
        employeeName: tip.employee?.name || 'Unknown Employee',
        tips: [],
        total: 0,
      };
    }
    acc[key].tips.push(tip);
    acc[key].total += tip.tip_amount;
    return acc;
  }, {} as Record<string, { employeeId: string; employeeName: string; tips: typeof dateTips; total: number }>);

  return (
    <Card className="border-blue-200 bg-blue-50/50">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-blue-600" />
              Employee-Declared Tips
            </CardTitle>
            <CardDescription>
              Tips declared by employees for {format(new Date(date), 'MMMM d, yyyy')}
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-blue-600">
              {formatCurrencyFromCents(totalTipsCents)}
            </p>
            <p className="text-sm text-muted-foreground">
              {dateTips.length} {dateTips.length === 1 ? 'entry' : 'entries'}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary by employee */}
        <div className="space-y-2">
          {Object.values(tipsByEmployee).map(({ employeeId, employeeName, tips, total }) => (
            <div
              key={employeeId}
              className="bg-background rounded-lg border p-3 hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{employeeName}</span>
                  <Badge variant="outline" className="text-xs">
                    {tips.length} {tips.length === 1 ? 'entry' : 'entries'}
                  </Badge>
                </div>
                <span className="font-semibold text-blue-600">
                  {formatCurrencyFromCents(total)}
                </span>
              </div>

              {/* Individual tip entries */}
              <div className="space-y-1 pl-6 border-l-2 border-muted">
                {tips.map(tip => (
                  <div
                    key={tip.id}
                    className="flex items-center justify-between text-sm py-1"
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={tip.tip_source === 'cash' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {tip.tip_source}
                      </Badge>
                      <span className="text-muted-foreground">
                        {format(new Date(tip.recorded_at), 'h:mm a')}
                      </span>
                      {tip.notes && (
                        <span className="text-xs text-muted-foreground italic">
                          {tip.notes}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {formatCurrencyFromCents(tip.tip_amount)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteTip(tip.id)}
                        disabled={isDeleting}
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Action button to import */}
        {onImport && (
          <Button
            onClick={() => onImport(totalTipsCents)}
            className="w-full"
            size="lg"
          >
            Use Employee-Declared Tips ({formatCurrencyFromCents(totalTipsCents)})
          </Button>
        )}

        {/* Info message */}
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription className="text-xs">
            These tips were declared by employees when clocking out. You can use this total
            for tip pooling or enter a different amount manually.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
};
