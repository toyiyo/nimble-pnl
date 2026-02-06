import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { usePayroll } from '@/hooks/usePayroll';
import { useEmployees } from '@/hooks/useEmployees';
import { useGustoConnection } from '@/hooks/useGustoConnection';
import { PayrollGustoProcessor } from '@/components/payroll/PayrollGustoProcessor';
import { FeatureGate } from '@/components/subscription';
import {
  formatCurrency,
  formatHours,
  exportPayrollToCSV,
  EmployeePayroll,
} from '@/utils/payrollCalculations';
import { isPerJobContractor } from '@/utils/compensationCalculations';
import { AddManualPaymentDialog } from '@/components/payroll/AddManualPaymentDialog';
import {
  DollarSign,
  Clock,
  Download,
  Calendar,
  RefreshCw,
  TrendingUp,
  Users,
  AlertTriangle,
  Plus,
  Briefcase,
  Banknote,
} from 'lucide-react';
import { format, startOfWeek, endOfWeek, subWeeks, addWeeks, endOfDay } from 'date-fns';
import { WEEK_STARTS_ON } from '@/lib/dateConfig';
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
    startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON })
  );
  const [customEndDate, setCustomEndDate] = useState<Date>(
    endOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON })
  );

  // Calculate date range based on period type
  const getDateRange = () => {
    const today = new Date();
    switch (periodType) {
      case 'current_week':
        return {
          start: startOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }),
          end: endOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }),
        };
      case 'last_week': {
        const lastWeek = subWeeks(today, 1);
        return {
          start: startOfWeek(lastWeek, { weekStartsOn: WEEK_STARTS_ON }),
          end: endOfWeek(lastWeek, { weekStartsOn: WEEK_STARTS_ON }),
        };
      }
      case 'last_2_weeks': {
        const lastWeek = subWeeks(today, 1);
        return {
          start: startOfWeek(subWeeks(lastWeek, 1), { weekStartsOn: WEEK_STARTS_ON }),
          end: endOfWeek(lastWeek, { weekStartsOn: WEEK_STARTS_ON }),
        };
      }
      case 'custom':
        return {
          start: customStartDate,
          end: customEndDate,
        };
      default:
        return {
          start: startOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }),
          end: endOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }),
        };
    }
  };

  const { start, end } = getDateRange();
  const { 
    payrollPeriod, 
    loading, 
    error, 
    refetch,
    addManualPayment,
    isAddingPayment,
  } = usePayroll(restaurantId, start, end);
  
  const { employees } = useEmployees(restaurantId);

  const { connection: gustoConnection } = useGustoConnection(restaurantId);
  const hasGusto = !!gustoConnection;

  // State for manual payment dialog
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Helper to check if an employee is a per-job contractor
  const isEmployeePerJobContractor = (employeeId: string) => {
    const employee = employees.find(e => e.id === employeeId);
    return employee ? isPerJobContractor(employee) : false;
  };

  // Helper to get compensation type badge
  const getCompensationBadge = (emp: EmployeePayroll) => {
    switch (emp.compensationType) {
      case 'salary':
        return (
          <Badge variant="outline" className="text-xs">
            <Banknote className="h-3 w-3 mr-1" />
            Salary
          </Badge>
        );
      case 'contractor':
        return (
          <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-200">
            <Briefcase className="h-3 w-3 mr-1" />
            {isEmployeePerJobContractor(emp.employeeId) ? 'Per-Job' : 'Contractor'}
          </Badge>
        );
      default:
        return null;
    }
  };

  // Helper to format rate display based on compensation type
  const formatRateDisplay = (employee: EmployeePayroll): string => {
    if (employee.compensationType === 'hourly') {
      return formatCurrency(employee.hourlyRate);
    }
    if (employee.compensationType === 'salary') {
      return `${formatCurrency(employee.salaryPay)}/period`;
    }
    // Contractor
    if (employee.contractorPay > 0) {
      return `${formatCurrency(employee.contractorPay)}/period`;
    }
    return 'Per-Job';
  };

  // Helper to format regular pay based on compensation type
  const formatRegularPayDisplay = (employee: EmployeePayroll): string => {
    if (employee.compensationType === 'hourly') {
      return formatCurrency(employee.regularPay);
    }
    if (employee.compensationType === 'salary') {
      return formatCurrency(employee.salaryPay);
    }
    // Contractor
    return formatCurrency(employee.contractorPay + employee.manualPaymentsTotal);
  };

  const handleAddPayment = (employeeId: string, employeeName: string) => {
    setSelectedEmployee({ id: employeeId, name: employeeName });
    setPaymentDialogOpen(true);
  };

  const handlePaymentSubmit = (data: {
    employeeId: string;
    date: string;
    amount: number;
    description?: string;
  }) => {
    addManualPayment(data);
    setPaymentDialogOpen(false);
    setSelectedEmployee(null);
  };

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
      setCustomStartDate(startOfWeek(newDate, { weekStartsOn: WEEK_STARTS_ON }));
      setCustomEndDate(endOfWeek(newDate, { weekStartsOn: WEEK_STARTS_ON }));
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
      setCustomStartDate(startOfWeek(newDate, { weekStartsOn: WEEK_STARTS_ON }));
      setCustomEndDate(endOfWeek(newDate, { weekStartsOn: WEEK_STARTS_ON }));
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
    <FeatureGate featureKey="payroll">
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
                  onChange={(e) => {
                    const [year, month, day] = e.target.value.split('-').map(Number);
                    setCustomStartDate(new Date(year, month - 1, day));
                  }}
                  className="px-3 py-2 border rounded-md"
                />
                <span>to</span>
                <input
                  type="date"
                  value={format(customEndDate, 'yyyy-MM-dd')}
                  onChange={(e) => {
                    const [year, month, day] = e.target.value.split('-').map(Number);
                    setCustomEndDate(endOfDay(new Date(year, month - 1, day)));
                  }}
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

      {/* Incomplete Shifts Warning */}
      {payrollPeriod && payrollPeriod.employees.some(e => e.incompleteShifts && e.incompleteShifts.length > 0) && (
        <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <AlertTitle className="text-amber-600">Incomplete Time Punches Detected</AlertTitle>
          <AlertDescription className="text-amber-600/90">
            <p className="mb-2">
              The following employees have missing or problematic time punches that may affect payroll accuracy:
            </p>
            <ul className="list-disc pl-4 space-y-1 text-sm">
              {payrollPeriod.employees
                .filter(e => e.incompleteShifts && e.incompleteShifts.length > 0)
                .map(e => (
                  <li key={e.employeeId}>
                    <span className="font-medium">{e.employeeName}</span>: {e.incompleteShifts!.length} issue(s)
                    <ul className="list-none pl-4 text-xs text-amber-600/80">
                      {e.incompleteShifts!.slice(0, 3).map((shift, idx) => (
                        <li key={idx}>• {shift.message}</li>
                      ))}
                      {e.incompleteShifts!.length > 3 && (
                        <li>• ...and {e.incompleteShifts!.length - 3} more</li>
                      )}
                    </ul>
                  </li>
                ))}
            </ul>
            <p className="mt-2 text-sm font-medium">
              Please review and fix time punches before processing payroll.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Payroll Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Employee Payroll Details</CardTitle>
            <Button
              onClick={handleExportCSV}
              variant={hasGusto ? 'outline' : 'default'}
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
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payrollPeriod.employees.map((employee) => (
                    <TableRow key={employee.employeeId} className={employee.incompleteShifts?.length ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span>{employee.employeeName}</span>
                          {getCompensationBadge(employee)}
                          {employee.incompleteShifts && employee.incompleteShifts.length > 0 && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertTriangle className="h-4 w-4 text-amber-500" aria-label={`${employee.incompleteShifts.length} incomplete time punches`} />
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-xs">
                                  <p className="font-medium mb-1">{employee.incompleteShifts.length} punch issue(s):</p>
                                  <ul className="text-xs space-y-0.5">
                                    {employee.incompleteShifts.slice(0, 5).map((shift) => (
                                      <li key={`${employee.employeeId}-${shift.punchTime}-${shift.type}`}>• {shift.message}</li>
                                    ))}
                                    {employee.incompleteShifts.length > 5 && (
                                      <li key="more">• ...and {employee.incompleteShifts.length - 5} more</li>
                                    )}
                                  </ul>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {/* Show manual payment info if any */}
                          {employee.manualPaymentsTotal > 0 && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="secondary" className="text-xs bg-green-50 text-green-700 border-green-200">
                                    +{formatCurrency(employee.manualPaymentsTotal)}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-xs">
                                  <p className="font-medium mb-1">{employee.manualPayments.length} manual payment(s):</p>
                                  <ul className="text-xs space-y-0.5">
                                    {employee.manualPayments.map((payment) => (
                                      <li key={`${employee.employeeId}-${payment.date}-${payment.amount}`}>• {format(new Date(payment.date), 'MMM d')}: {formatCurrency(payment.amount)}{payment.description ? ` - ${payment.description}` : ''}</li>
                                    ))}
                                  </ul>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{employee.position}</TableCell>
                      <TableCell className="text-right">
                        {formatRateDisplay(employee)}
                      </TableCell>
                      <TableCell className="text-right">
                        {employee.compensationType === 'hourly' ? formatHours(employee.regularHours) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {employee.compensationType === 'hourly' && employee.overtimeHours > 0 ? (
                          <Badge variant="secondary">
                            {formatHours(employee.overtimeHours)}
                          </Badge>
                        ) : (
                          employee.compensationType === 'hourly' ? '0.00' : '-'
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatRegularPayDisplay(employee)}
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
                      <TableCell className="text-right">
                        {isEmployeePerJobContractor(employee.employeeId) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleAddPayment(employee.employeeId, employee.employeeName)}
                            aria-label={`Add payment for ${employee.employeeName}`}
                          >
                            <Plus className="h-4 w-4 mr-1" />
                            Add Payment
                          </Button>
                        )}
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
                        payrollPeriod.employees.reduce((sum, e) => sum + e.regularPay + e.salaryPay + e.contractorPay + e.manualPaymentsTotal, 0)
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
                    <TableCell>{/* Actions column - empty for total row */}</TableCell>
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
                <li>Salaried employees and regular contractors have prorated pay for the period</li>
                <li>Per-job contractors require manual payment entry</li>
                <li>Export CSV for integration with payroll systems (ADP, Gusto, etc.)</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Gusto Payroll Processor */}
      {hasGusto && payrollPeriod && restaurantId && (
        <PayrollGustoProcessor
          restaurantId={restaurantId}
          payrollPeriod={payrollPeriod}
          startDate={format(start, 'yyyy-MM-dd')}
          endDate={format(end, 'yyyy-MM-dd')}
        />
      )}

      {/* Add Manual Payment Dialog */}
      {selectedEmployee && (
        <AddManualPaymentDialog
          open={paymentDialogOpen}
          onOpenChange={setPaymentDialogOpen}
          employeeName={selectedEmployee.name}
          employeeId={selectedEmployee.id}
          onSubmit={handlePaymentSubmit}
          isSubmitting={isAddingPayment}
        />
      )}
    </div>
    </FeatureGate>
  );
};

export default Payroll;
