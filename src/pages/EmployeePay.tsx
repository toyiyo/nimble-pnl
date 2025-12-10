import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { usePayroll } from '@/hooks/usePayroll';
import { usePeriodNavigation } from '@/hooks/usePeriodNavigation';
import { formatCurrency, formatHours } from '@/utils/payrollCalculations';
import {
  EmployeePageHeader,
  NoRestaurantState,
  EmployeePageSkeleton,
  EmployeeNotLinkedState,
  EmployeeInfoAlert,
  PeriodSelector,
} from '@/components/employee';
import {
  DollarSign,
  Clock,
  TrendingUp,
  Banknote,
  CreditCard,
  Wallet,
  AlertTriangle,
} from 'lucide-react';

const EmployeePay = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const {
    periodType,
    setPeriodType,
    startDate,
    endDate,
    handlePreviousWeek,
    handleNextWeek,
    handleToday,
  } = usePeriodNavigation({ includeLast2Weeks: true });

  const { currentEmployee, loading: employeeLoading } = useCurrentEmployee(restaurantId);
  const { payrollPeriod, loading: payrollLoading, error } = usePayroll(restaurantId, startDate, endDate);

  // Find current employee's payroll data
  const myPayroll = useMemo(() => {
    if (!payrollPeriod || !currentEmployee) return null;
    return payrollPeriod.employees.find((e) => e.employeeId === currentEmployee.id);
  }, [payrollPeriod, currentEmployee]);

  if (!restaurantId) {
    return <NoRestaurantState />;
  }

  if (employeeLoading) {
    return <EmployeePageSkeleton />;
  }

  if (!currentEmployee) {
    return <EmployeeNotLinkedState />;
  }

  const isLoading = payrollLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <EmployeePageHeader
        icon={Wallet}
        title="My Pay"
        subtitle={`${currentEmployee.name} • ${formatCurrency(currentEmployee.hourly_rate)}/hr`}
      />

      {/* Period Selector */}
      <PeriodSelector
        periodType={periodType}
        onPeriodTypeChange={setPeriodType}
        startDate={startDate}
        endDate={endDate}
        onPrevious={handlePreviousWeek}
        onNext={handleNextWeek}
        onToday={handleToday}
        label="Pay Period:"
        showLast2Weeks
      />

      {/* Error State */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">Error loading pay data: {error.message}</p>
          </CardContent>
        </Card>
      )}

      {/* Pay Summary */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : myPayroll ? (
        <>
          {/* Incomplete Shifts Warning */}
          {myPayroll.incompleteShifts && myPayroll.incompleteShifts.length > 0 && (
            <Alert className="bg-amber-500/10 border-amber-500/30">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-medium text-amber-700">
                    {myPayroll.incompleteShifts.length} incomplete shift{myPayroll.incompleteShifts.length > 1 ? 's' : ''} detected
                  </p>
                  <ul className="text-sm text-amber-600 space-y-1">
                    {myPayroll.incompleteShifts.slice(0, 3).map((shift, idx) => (
                      <li key={idx}>• {shift.message}</li>
                    ))}
                    {myPayroll.incompleteShifts.length > 3 && (
                      <li>• ...and {myPayroll.incompleteShifts.length - 3} more</li>
                    )}
                  </ul>
                  <p className="text-xs text-amber-600">
                    Contact your manager to fix these before payroll is processed.
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Hours Worked
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatHours(myPayroll.regularHours + myPayroll.overtimeHours)}
                </div>
                {myPayroll.overtimeHours > 0 && (
                  <p className="text-xs text-amber-600">
                    {formatHours(myPayroll.overtimeHours)} OT
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Gross Wages
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatCurrency(myPayroll.regularPay + myPayroll.overtimePay)}
                </div>
                <p className="text-xs text-muted-foreground">Before taxes</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <Banknote className="h-4 w-4" />
                  Tips
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {myPayroll.totalTips > 0
                    ? formatCurrency(myPayroll.totalTips)
                    : '$0.00'}
                </div>
                <p className="text-xs text-muted-foreground">Cash + Credit</p>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-green-500/5 to-green-600/5 border-green-500/20">
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Total Pay
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {formatCurrency(myPayroll.totalPay)}
                </div>
                <p className="text-xs text-muted-foreground">Wages + Tips</p>
              </CardContent>
            </Card>
          </div>

          {/* Pay Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Pay Breakdown</CardTitle>
              <CardDescription>Detailed breakdown of your earnings</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Wages Section */}
                <div>
                  <h4 className="font-medium mb-3 flex items-center gap-2">
                    <DollarSign className="h-4 w-4" />
                    Wages
                  </h4>
                  <div className="space-y-2 pl-6">
                    <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                      <div>
                        <span className="font-medium">Regular Pay</span>
                        <p className="text-sm text-muted-foreground">
                          {formatHours(myPayroll.regularHours)} hrs × {formatCurrency(myPayroll.hourlyRate)}/hr
                        </p>
                      </div>
                      <span className="font-medium">{formatCurrency(myPayroll.regularPay)}</span>
                    </div>

                    {myPayroll.overtimeHours > 0 && (
                      <div className="flex justify-between items-center p-3 rounded-lg bg-amber-500/10">
                        <div>
                          <span className="font-medium">Overtime Pay</span>
                          <p className="text-sm text-muted-foreground">
                            {formatHours(myPayroll.overtimeHours)} hrs × {formatCurrency(myPayroll.hourlyRate * 1.5)}/hr (1.5×)
                          </p>
                        </div>
                        <span className="font-medium text-amber-600">
                          {formatCurrency(myPayroll.overtimePay)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Tips Section */}
                {myPayroll.totalTips > 0 && (
                  <div>
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <Banknote className="h-4 w-4" />
                      Tips
                    </h4>
                    <div className="space-y-2 pl-6">
                      <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
                        <div className="flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">Total Tips</span>
                        </div>
                        <span className="font-medium">{formatCurrency(myPayroll.totalTips)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Total */}
                <div className="border-t pt-4 mt-4">
                  <div className="flex justify-between items-center p-4 rounded-lg bg-gradient-to-r from-green-500/10 to-green-600/10">
                    <span className="text-lg font-semibold">Total Compensation</span>
                    <span className="text-2xl font-bold text-green-600">
                      {formatCurrency(myPayroll.totalPay)}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Pay Data</h3>
            <p className="text-muted-foreground">
              No time punches found for this pay period.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Info Alert */}
      <EmployeeInfoAlert>
        <strong>Note:</strong> This is an estimate based on your time punches. Final pay may
        differ based on manager adjustments, tax withholdings, and other deductions. If you have
        questions, please contact your manager.
      </EmployeeInfoAlert>
    </div>
  );
};

export default EmployeePay;
