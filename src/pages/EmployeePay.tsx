import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { usePayroll } from '@/hooks/usePayroll';
import {
  DollarSign,
  Clock,
  Calendar,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  TrendingUp,
  Banknote,
  CreditCard,
  Wallet,
  AlertTriangle,
} from 'lucide-react';
import {
  format,
  startOfWeek,
  endOfWeek,
  subWeeks,
  addWeeks,
} from 'date-fns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type PeriodType = 'current_week' | 'last_week' | 'last_2_weeks' | 'custom';

const formatCurrency = (cents: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
};

const formatHours = (hours: number) => {
  return hours.toFixed(2);
};

const EmployeePay = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const [periodType, setPeriodType] = useState<PeriodType>('current_week');
  const [customStartDate, setCustomStartDate] = useState<Date>(
    startOfWeek(new Date(), { weekStartsOn: 0 })
  );

  const { currentEmployee, loading: employeeLoading } = useCurrentEmployee(restaurantId);

  // Calculate date range based on period type
  const getDateRange = () => {
    const today = new Date();
    switch (periodType) {
      case 'current_week':
        return {
          start: startOfWeek(today, { weekStartsOn: 0 }),
          end: endOfWeek(today, { weekStartsOn: 0 }),
        };
      case 'last_week': {
        const lastWeek = subWeeks(today, 1);
        return {
          start: startOfWeek(lastWeek, { weekStartsOn: 0 }),
          end: endOfWeek(lastWeek, { weekStartsOn: 0 }),
        };
      }
      case 'last_2_weeks': {
        const lastWeek = subWeeks(today, 1);
        return {
          start: startOfWeek(subWeeks(lastWeek, 1), { weekStartsOn: 0 }),
          end: endOfWeek(lastWeek, { weekStartsOn: 0 }),
        };
      }
      case 'custom':
        return {
          start: customStartDate,
          end: endOfWeek(customStartDate, { weekStartsOn: 0 }),
        };
      default:
        return {
          start: startOfWeek(today, { weekStartsOn: 0 }),
          end: endOfWeek(today, { weekStartsOn: 0 }),
        };
    }
  };

  const { start, end } = getDateRange();
  const { payrollPeriod, loading: payrollLoading, error } = usePayroll(restaurantId, start, end);

  // Find current employee's payroll data
  const myPayroll = useMemo(() => {
    if (!payrollPeriod || !currentEmployee) return null;
    return payrollPeriod.employees.find((e) => e.employeeId === currentEmployee.id);
  }, [payrollPeriod, currentEmployee]);

  const handlePreviousWeek = () => {
    const newDate = subWeeks(start, 1);
    setCustomStartDate(startOfWeek(newDate, { weekStartsOn: 0 }));
    setPeriodType('custom');
  };

  const handleNextWeek = () => {
    const newDate = addWeeks(start, 1);
    setCustomStartDate(startOfWeek(newDate, { weekStartsOn: 0 }));
    setPeriodType('custom');
  };

  const handleToday = () => {
    setCustomStartDate(startOfWeek(new Date(), { weekStartsOn: 0 }));
    setPeriodType('current_week');
  };

  if (!restaurantId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Please select a restaurant.</p>
      </div>
    );
  }

  if (employeeLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!currentEmployee) {
    return (
      <Card className="bg-gradient-to-br from-destructive/5 via-destructive/5 to-transparent border-destructive/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <div>
              <CardTitle className="text-2xl">Access Required</CardTitle>
              <CardDescription>
                Your account is not linked to an employee record.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Please contact your manager to link your account to your employee profile.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isLoading = payrollLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Wallet className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                My Pay
              </CardTitle>
              <CardDescription>
                {currentEmployee.name} • ${(currentEmployee.hourly_rate / 100).toFixed(2)}/hr
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Period Selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Pay Period:</span>
            </div>
            <Select
              value={periodType}
              onValueChange={(value) => setPeriodType(value as PeriodType)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current_week">Current Week</SelectItem>
                <SelectItem value="last_week">Last Week</SelectItem>
                <SelectItem value="last_2_weeks">Last 2 Weeks</SelectItem>
                <SelectItem value="custom">Custom Period</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviousWeek}
                aria-label="Previous period"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleToday}>
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextWeek}
                aria-label="Next period"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Badge variant="outline" className="px-3 py-1">
              {format(start, 'MMM d')} - {format(end, 'MMM d, yyyy')}
            </Badge>
          </div>
        </CardContent>
      </Card>

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
      <Alert className="bg-primary/5 border-primary/20">
        <AlertCircle className="h-4 w-4 text-primary" />
        <AlertDescription>
          <strong>Note:</strong> This is an estimate based on your time punches. Final pay may
          differ based on manager adjustments, tax withholdings, and other deductions. If you have
          questions, please contact your manager.
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default EmployeePay;
