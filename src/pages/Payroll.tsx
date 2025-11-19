import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { usePayroll } from '@/hooks/usePayroll';
import {
  formatCurrency,
  formatHours,
  exportPayrollToCSV,
} from '@/utils/payrollCalculations';
import {
  DollarSign,
  Clock,
  Download,
  Calendar,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';
import { format, startOfWeek, endOfWeek, subWeeks, addWeeks } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type PayPeriodType = 'current_week' | 'last_week' | 'last_2_weeks' | 'custom';

const Payroll = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const [periodType, setPeriodType] = useState<PayPeriodType>('current_week');
  const [customStartDate, setCustomStartDate] = useState<Date>(
    startOfWeek(new Date(), { weekStartsOn: 0 })
  );
  const [customEndDate, setCustomEndDate] = useState<Date>(
    endOfWeek(new Date(), { weekStartsOn: 0 })
  );

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
          end: customEndDate,
        };
      default:
        return {
          start: startOfWeek(today, { weekStartsOn: 0 }),
          end: endOfWeek(today, { weekStartsOn: 0 }),
        };
    }
  };

  const { start, end } = getDateRange();
  const { payrollPeriod, loading, error, refetch } = usePayroll(restaurantId, start, end);

  const handleExportCSV = () => {
    if (!payrollPeriod) return;

    const csv = exportPayrollToCSV(payrollPeriod);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll_${format(start, 'yyyy-MM-dd')}_to_${format(end, 'yyyy-MM-dd')}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handlePreviousPeriod = () => {
    if (periodType === 'custom') {
      const duration = customEndDate.getTime() - customStartDate.getTime();
      setCustomStartDate(new Date(customStartDate.getTime() - duration));
      setCustomEndDate(new Date(customEndDate.getTime() - duration));
    } else {
      // Move to previous week
      const newDate = subWeeks(start, 1);
      setCustomStartDate(startOfWeek(newDate, { weekStartsOn: 0 }));
      setCustomEndDate(endOfWeek(newDate, { weekStartsOn: 0 }));
      setPeriodType('custom');
    }
  };

  const handleNextPeriod = () => {
    if (periodType === 'custom') {
      const duration = customEndDate.getTime() - customStartDate.getTime();
      setCustomStartDate(new Date(customStartDate.getTime() + duration));
      setCustomEndDate(new Date(customEndDate.getTime() + duration));
    } else {
      // Move to next week
      const newDate = addWeeks(start, 1);
      setCustomStartDate(startOfWeek(newDate, { weekStartsOn: 0 }));
      setCustomEndDate(endOfWeek(newDate, { weekStartsOn: 0 }));
      setPeriodType('custom');
    }
  };

  if (!selectedRestaurant) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Please select a restaurant to view payroll.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-primary" />
              <div>
                <CardTitle className="text-3xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Payroll
                </CardTitle>
                <CardDescription>
                  Calculate employee wages, overtime, and tips
                </CardDescription>
              </div>
            </div>
            <Button onClick={() => refetch()} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
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
              onValueChange={(value) => setPeriodType(value as PayPeriodType)}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current_week">Current Week</SelectItem>
                <SelectItem value="last_week">Last Week</SelectItem>
                <SelectItem value="last_2_weeks">Last 2 Weeks</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>

            {periodType === 'custom' && (
              <>
                <input
                  type="date"
                  value={format(customStartDate, 'yyyy-MM-dd')}
                  onChange={(e) => setCustomStartDate(new Date(e.target.value))}
                  className="px-3 py-2 border rounded-md"
                />
                <span>to</span>
                <input
                  type="date"
                  value={format(customEndDate, 'yyyy-MM-dd')}
                  onChange={(e) => setCustomEndDate(new Date(e.target.value))}
                  className="px-3 py-2 border rounded-md"
                />
              </>
            )}

            <div className="flex items-center gap-2">
              <Button onClick={handlePreviousPeriod} variant="outline" size="sm">
                ← Previous
              </Button>
              <Badge variant="outline" className="px-3">
                {format(start, 'MMM d')} - {format(end, 'MMM d, yyyy')}
              </Badge>
              <Button onClick={handleNextPeriod} variant="outline" size="sm">
                Next →
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-20" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : payrollPeriod ? (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Employees
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {payrollPeriod.employees.length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Total Hours
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatHours(
                  payrollPeriod.totalRegularHours + payrollPeriod.totalOvertimeHours
                )}
              </div>
              {payrollPeriod.totalOvertimeHours > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  {formatHours(payrollPeriod.totalOvertimeHours)} OT
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
                {formatCurrency(payrollPeriod.totalGrossPay)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Total Tips
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(payrollPeriod.totalTips)}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Error State */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">Error loading payroll: {error.message}</p>
          </CardContent>
        </Card>
      )}

      {/* Payroll Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Employee Payroll Details</CardTitle>
            <Button
              onClick={handleExportCSV}
              disabled={!payrollPeriod || payrollPeriod.employees.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : payrollPeriod && payrollPeriod.employees.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Regular Hrs</TableHead>
                    <TableHead className="text-right">OT Hrs</TableHead>
                    <TableHead className="text-right">Regular Pay</TableHead>
                    <TableHead className="text-right">OT Pay</TableHead>
                    <TableHead className="text-right">Tips</TableHead>
                    <TableHead className="text-right font-semibold">Total Pay</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payrollPeriod.employees.map((employee) => (
                    <TableRow key={employee.employeeId}>
                      <TableCell className="font-medium">{employee.employeeName}</TableCell>
                      <TableCell>{employee.position}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(employee.hourlyRate)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatHours(employee.regularHours)}
                      </TableCell>
                      <TableCell className="text-right">
                        {employee.overtimeHours > 0 ? (
                          <Badge variant="secondary">
                            {formatHours(employee.overtimeHours)}
                          </Badge>
                        ) : (
                          '0.00'
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(employee.regularPay)}
                      </TableCell>
                      <TableCell className="text-right">
                        {employee.overtimePay > 0 ? formatCurrency(employee.overtimePay) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {employee.totalTips > 0 ? formatCurrency(employee.totalTips) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(employee.totalPay)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Total Row */}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell colSpan={3}>TOTAL</TableCell>
                    <TableCell className="text-right">
                      {formatHours(payrollPeriod.totalRegularHours)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatHours(payrollPeriod.totalOvertimeHours)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(
                        payrollPeriod.employees.reduce((sum, e) => sum + e.regularPay, 0)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(
                        payrollPeriod.employees.reduce((sum, e) => sum + e.overtimePay, 0)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(payrollPeriod.totalTips)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(
                        payrollPeriod.totalGrossPay + payrollPeriod.totalTips
                      )}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-12">
              <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Payroll Data</h3>
              <p className="text-muted-foreground">
                No time punches or employee data found for this period.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="bg-muted/50">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <div className="text-muted-foreground">
              <svg
                className="h-5 w-5 mt-0.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="space-y-1 text-sm">
              <p className="font-medium">Payroll Calculation Notes:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Overtime is calculated at 1.5× regular rate for hours over 40 per calendar week</li>
                <li>Only completed time punches (clock in/out pairs) are included</li>
                <li>Break time is excluded from worked hours</li>
                <li>Tips are aggregated from the employee_tips table</li>
                <li>Export CSV for integration with payroll systems (ADP, Gusto, etc.)</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Payroll;
