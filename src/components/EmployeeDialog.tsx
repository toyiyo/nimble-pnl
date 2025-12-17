import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Employee, CompensationType, PayPeriodType, ContractorPaymentInterval } from '@/types/scheduling';
import { useCreateEmployee, useUpdateEmployee } from '@/hooks/useEmployees';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { PositionCombobox } from '@/components/PositionCombobox';
import { HelpCircle, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface EmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee?: Employee;
  restaurantId: string;
}

export const EmployeeDialog = ({ open, onOpenChange, employee, restaurantId }: EmployeeDialogProps) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [position, setPosition] = useState('Server');
  const [status, setStatus] = useState<'active' | 'inactive' | 'terminated'>('active');
  const [hireDate, setHireDate] = useState('');
  const [terminationDate, setTerminationDate] = useState('');
  const [notes, setNotes] = useState('');
  
  // Compensation type state
  const [compensationType, setCompensationType] = useState<CompensationType>('hourly');
  
  // Hourly employee fields
  const [hourlyRate, setHourlyRate] = useState('');
  
  // Salaried employee fields
  const [salaryAmount, setSalaryAmount] = useState('');
  const [payPeriodType, setPayPeriodType] = useState<PayPeriodType>('bi-weekly');
  const [allocateDaily, setAllocateDaily] = useState(true);
  
  // Contractor fields
  const [contractorPaymentAmount, setContractorPaymentAmount] = useState('');
  const [contractorPaymentInterval, setContractorPaymentInterval] = useState<ContractorPaymentInterval>('monthly');

  const getToday = () => new Date().toISOString().split('T')[0];

  type CompensationHistoryPayload = {
    restaurantId: string;
    compensationType: CompensationType;
    amountInCents?: number;
    payPeriodType?: PayPeriodType;
  };

  type PendingCompChange = {
    employeeId: string;
    updatePayload: Partial<Employee> & { id: string };
    historyPayload: CompensationHistoryPayload | null;
  } | null;

  const [effectiveDate, setEffectiveDate] = useState(getToday());
  const [isEffectiveDateModalOpen, setIsEffectiveDateModalOpen] = useState(false);
  const [pendingCompChange, setPendingCompChange] = useState<PendingCompChange>(null);
  const [savingCompHistory, setSavingCompHistory] = useState(false);

  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const { toast } = useToast();

  useEffect(() => {
    setEffectiveDate(getToday());
    setIsEffectiveDateModalOpen(false);
    setPendingCompChange(null);
    setSavingCompHistory(false);

    if (employee) {
      setName(employee.name);
      setEmail(employee.email || '');
      setPhone(employee.phone || '');
      setPosition(employee.position);
      setStatus(employee.status);
      setHireDate(employee.hire_date || '');
      setTerminationDate(employee.termination_date || '');
      setNotes(employee.notes || '');
      
      // Compensation fields
      setCompensationType(employee.compensation_type || 'hourly');
      // Only set hourly rate if it's a valid finite number
      setHourlyRate(
        typeof employee.hourly_rate === 'number' && Number.isFinite(employee.hourly_rate)
          ? (employee.hourly_rate / 100).toFixed(2)
          : ''
      );
      setSalaryAmount(employee.salary_amount ? (employee.salary_amount / 100).toFixed(2) : '');
      setPayPeriodType(employee.pay_period_type || 'bi-weekly');
      setAllocateDaily(employee.allocate_daily ?? true);
      setContractorPaymentAmount(employee.contractor_payment_amount ? (employee.contractor_payment_amount / 100).toFixed(2) : '');
      setContractorPaymentInterval(employee.contractor_payment_interval || 'monthly');
    } else {
      resetForm();
    }
  }, [employee, open]);

  const resetForm = () => {
    setName('');
    setEmail('');
    setPhone('');
    setPosition('Server');
    setStatus('active');
    setHireDate('');
    setTerminationDate('');
    setNotes('');
    
    // Reset compensation fields
    setCompensationType('hourly');
    setHourlyRate('');
    setSalaryAmount('');
    setPayPeriodType('bi-weekly');
    setAllocateDaily(true);
    setContractorPaymentAmount('');
    setContractorPaymentInterval('monthly');
  };

  const hasCompensationChanged = (
    existing: Employee,
    payload: {
      compensationType: CompensationType;
      hourlyRateInCents: number;
      salaryAmountInCents?: number;
      payPeriodType?: PayPeriodType;
      contractorAmountInCents?: number;
      contractorInterval?: ContractorPaymentInterval;
    }
  ) => {
    if (existing.compensation_type !== payload.compensationType) {
      return true;
    }

    switch (payload.compensationType) {
      case 'hourly':
        return existing.hourly_rate !== payload.hourlyRateInCents;
      case 'salary':
        return (
          existing.salary_amount !== payload.salaryAmountInCents ||
          existing.pay_period_type !== payload.payPeriodType
        );
      case 'contractor':
        return (
          existing.contractor_payment_amount !== payload.contractorAmountInCents ||
          existing.contractor_payment_interval !== payload.contractorInterval
        );
      default:
        return false;
    }
  };

  const buildHistoryPayload = (
    restaurant: string,
    hourlyRateInCents: number,
    salaryAmountInCents?: number,
    contractorAmountInCents?: number
  ): CompensationHistoryPayload | null => {
    switch (compensationType) {
      case 'hourly':
        return hourlyRateInCents > 0
          ? { restaurantId: restaurant, compensationType, amountInCents: hourlyRateInCents }
          : null;
      case 'salary':
        return salaryAmountInCents
          ? {
              restaurantId: restaurant,
              compensationType,
              amountInCents: salaryAmountInCents,
              payPeriodType,
            }
          : null;
      case 'contractor':
        return contractorAmountInCents
          ? { restaurantId: restaurant, compensationType, amountInCents: contractorAmountInCents }
          : null;
      default:
        return null;
    }
  };

  const insertCompensationHistoryEntry = async (params: {
    employeeId: string;
    payload: CompensationHistoryPayload | null;
    effectiveDate: string;
  }) => {
    if (!params.payload || !params.payload.amountInCents || params.payload.amountInCents <= 0) {
      return;
    }

    const { error } = await supabase.from('employee_compensation_history').insert({
      employee_id: params.employeeId,
      restaurant_id: params.payload.restaurantId,
      compensation_type: params.payload.compensationType,
      amount_cents: params.payload.amountInCents,
      pay_period_type:
        params.payload.compensationType === 'salary' ? params.payload.payPeriodType : null,
      effective_date: params.effectiveDate,
    });

    if (error) {
      throw error;
    }
  };

  const createEmployeeWithHistory = async (
    employeePayload: Record<string, unknown>,
    historyPayload: CompensationHistoryPayload | null,
    historyEffectiveDate: string
  ) => {
    try {
      const newEmployee = await createEmployee.mutateAsync(employeePayload);

      try {
        await insertCompensationHistoryEntry({
          employeeId: newEmployee.id,
          payload: historyPayload,
          effectiveDate: historyEffectiveDate,
        });
      } catch (historyError: any) {
        console.error('Error recording compensation history:', historyError);
        toast({
          title: 'Compensation history not saved',
          description: historyError?.message || 'Please retry saving the new rate.',
          variant: 'destructive',
        });
        setPendingCompChange({
          employeeId: newEmployee.id,
          updatePayload: { id: newEmployee.id, ...(employeePayload as Partial<Employee>) },
          historyPayload,
        });
        setEffectiveDate(historyEffectiveDate);
        setIsEffectiveDateModalOpen(true);
        return;
      }

      if (email?.trim()) {
        supabase.functions.invoke('send-team-invitation', {
          body: {
            restaurantId: restaurantId,
            email: email.trim(),
            role: 'staff',
            employeeId: newEmployee.id, // Pass employee ID for linking
          },
        }).then(({ error }) => {
          if (error) {
            console.error('Error sending invitation:', error);
            toast({
              title: 'Employee created',
              description: `${name} was added but invitation email failed to send. You can resend from the Team page.`,
              variant: 'default',
            });
          } else {
            toast({
              title: 'Employee created and invited',
              description: `${name} was added and an invitation was sent to ${email}`,
            });
          }
        }).catch((error) => {
          console.error('Error invoking send-team-invitation:', error);
          toast({
            title: 'Employee created',
            description: `${name} was added but invitation email failed to send.`,
            variant: 'default',
          });
        });
      }

      onOpenChange(false);
      resetForm();
    } catch (error) {
      console.error('Error creating employee', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Build compensation data based on type
    const hourlyRateInCents = compensationType === 'hourly' 
      ? Math.round(Number.parseFloat(hourlyRate || '0') * 100)
      : 0;
    
    const salaryAmountInCents = compensationType === 'salary' && salaryAmount
      ? Math.round(Number.parseFloat(salaryAmount) * 100)
      : undefined;
    
    const contractorAmountInCents = compensationType === 'contractor' && contractorPaymentAmount
      ? Math.round(Number.parseFloat(contractorPaymentAmount) * 100)
      : undefined;

    const employeeData = {
      restaurant_id: restaurantId,
      name,
      email: email || undefined,
      phone: phone || undefined,
      position,
      status,
      hire_date: hireDate || undefined,
      termination_date: (status === 'inactive' || status === 'terminated') && terminationDate 
        ? terminationDate 
        : null, // Clear termination date if status is active
      notes: notes || undefined,
      // Activation tracking - preserve existing state or default to true for new employees
      is_active: employee?.is_active ?? true,
      // Compensation fields
      compensation_type: compensationType,
      hourly_rate: hourlyRateInCents,
      salary_amount: salaryAmountInCents,
      pay_period_type: compensationType === 'salary' ? payPeriodType : undefined,
      allocate_daily: compensationType === 'salary' ? allocateDaily : undefined,
      contractor_payment_amount: contractorAmountInCents,
      contractor_payment_interval: compensationType === 'contractor' ? contractorPaymentInterval : undefined,
    };

    const historyPayload = buildHistoryPayload(
      restaurantId,
      hourlyRateInCents,
      salaryAmountInCents,
      contractorAmountInCents
    );

    if (employee) {
      const compensationChanged = hasCompensationChanged(employee, {
        compensationType,
        hourlyRateInCents,
        salaryAmountInCents,
        payPeriodType,
        contractorAmountInCents,
        contractorInterval: contractorPaymentInterval,
      });

      if (compensationChanged) {
        setPendingCompChange({
          employeeId: employee.id,
          updatePayload: { id: employee.id, ...employeeData },
          historyPayload,
        });
        setEffectiveDate(getToday());
        setIsEffectiveDateModalOpen(true);
        return;
      }

      try {
        await updateEmployee.mutateAsync({ id: employee.id, ...employeeData });
        onOpenChange(false);
        resetForm();
      } catch (error) {
        console.error('Error updating employee', error);
      }
    } else {
      await createEmployeeWithHistory(
        employeeData,
        historyPayload,
        hireDate || getToday()
      );
    }
  };

  const handleApplyCompChange = async () => {
    if (!pendingCompChange) return;

    setSavingCompHistory(true);
    try {
      await updateEmployee.mutateAsync(pendingCompChange.updatePayload);
      await insertCompensationHistoryEntry({
        employeeId: pendingCompChange.employeeId,
        payload: pendingCompChange.historyPayload,
        effectiveDate,
      });
      setIsEffectiveDateModalOpen(false);
      onOpenChange(false);
      resetForm();
    } catch (error: any) {
      console.error('Error applying compensation change', error);
      toast({
        title: 'Unable to save new rate',
        description: error?.message || 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSavingCompHistory(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{employee ? 'Edit Employee' : 'Add New Employee'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  required
                  aria-label="Employee name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="position">
                  Position <span className="text-destructive">*</span>
                </Label>
                <PositionCombobox
                  restaurantId={restaurantId}
                  value={position}
                  onValueChange={setPosition}
                  placeholder="Select or type a position..."
                />
              </div>

              {/* Compensation Type Selector */}
              <div className="space-y-2">
                <Label htmlFor="compensationType">
                  Compensation Type <span className="text-destructive">*</span>
                </Label>
                <Select 
                  value={compensationType} 
                  onValueChange={(value) => setCompensationType(value as CompensationType)}
                >
                  <SelectTrigger id="compensationType" aria-label="Compensation type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="salary">Salary</SelectItem>
                    <SelectItem value="contractor">Contractor</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Hourly Fields - shown for hourly employees */}
              {compensationType === 'hourly' && (
                <div className="space-y-2">
                  <Label htmlFor="hourlyRate" className="flex items-center gap-1.5">
                    Hourly Rate ($) <span className="text-destructive">*</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <p className="text-xs">Regular hourly rate. Overtime (over 40 hrs/week) automatically calculated at 1.5× this rate.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Input
                    id="hourlyRate"
                    type="number"
                    step="0.01"
                    min="0"
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                    placeholder="15.00"
                    required
                    aria-label="Hourly rate in dollars"
                  />
                </div>
              )}

              {/* Salary Fields - shown for salary employees */}
              {compensationType === 'salary' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="salaryAmount" className="flex items-center gap-1.5">
                      Salary Amount ($) <span className="text-destructive">*</span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs">
                            <p className="text-xs">Enter the amount paid per pay period (e.g., $2,000 for bi-weekly means $2,000 every two weeks, not per year)</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </Label>
                    <Input
                      id="salaryAmount"
                      type="number"
                      step="0.01"
                      min="0"
                      value={salaryAmount}
                      onChange={(e) => setSalaryAmount(e.target.value)}
                      placeholder="52000.00"
                      required
                      aria-label="Salary amount in dollars"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="payPeriodType" className="flex items-center gap-1.5">
                      Pay Period <span className="text-destructive">*</span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs">
                            <div className="text-xs space-y-1">
                              <p><strong>Weekly:</strong> 52 paychecks/year</p>
                              <p><strong>Bi-Weekly:</strong> 26 paychecks/year</p>
                              <p><strong>Semi-Monthly:</strong> 24 paychecks/year (1st & 15th)</p>
                              <p><strong>Monthly:</strong> 12 paychecks/year</p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </Label>
                    <Select 
                      value={payPeriodType} 
                      onValueChange={(value) => setPayPeriodType(value as PayPeriodType)}
                    >
                      <SelectTrigger id="payPeriodType" aria-label="Pay period">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="bi-weekly">Bi-weekly</SelectItem>
                        <SelectItem value="semi-monthly">Semi-monthly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="allocateDaily"
                        checked={allocateDaily}
                        onCheckedChange={(checked) => setAllocateDaily(checked === true)}
                        aria-label="Allocate to Daily P&L"
                      />
                      <Label htmlFor="allocateDaily" className="cursor-pointer flex items-center gap-1.5">
                        Allocate to Daily P&L
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-xs">
                              <p className="font-semibold text-xs mb-1">Accrual vs Cash Basis</p>
                              <div className="text-xs space-y-1">
                                <p><strong>On (Accrual):</strong> Salary appears daily on dashboard</p>
                                <p><strong>Off (Cash):</strong> Appears only on payday</p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground ml-6">
                      When enabled, salary costs are spread evenly across each day for smoother P&L reporting.
                    </p>
                  </div>
                </>
              )}

              {/* Contractor Fields - shown for contractors */}
              {compensationType === 'contractor' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="contractorPaymentAmount" className="flex items-center gap-1.5">
                      Payment Amount ($) <span className="text-destructive">*</span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs">
                            <p className="text-xs">Amount paid per interval (weekly/monthly) or per completed project. No overtime or benefits included.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </Label>
                    <Input
                      id="contractorPaymentAmount"
                      type="number"
                      step="0.01"
                      min="0"
                      value={contractorPaymentAmount}
                      onChange={(e) => setContractorPaymentAmount(e.target.value)}
                      placeholder="2500.00"
                      required
                      aria-label="Payment amount in dollars"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contractorPaymentInterval">
                      Payment Interval <span className="text-destructive">*</span>
                    </Label>
                    <Select 
                      value={contractorPaymentInterval} 
                      onValueChange={(value) => setContractorPaymentInterval(value as ContractorPaymentInterval)}
                    >
                      <SelectTrigger id="contractorPaymentInterval" aria-label="Payment interval">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="bi-weekly">Bi-weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="per-job">Per Job</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@example.com"
                    aria-label="Employee email"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                    aria-label="Employee phone number"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
                    <SelectTrigger id="status" aria-label="Employee status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="terminated">Terminated</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="hireDate">Hire Date</Label>
                  <Input
                    id="hireDate"
                    type="date"
                    value={hireDate}
                    onChange={(e) => setHireDate(e.target.value)}
                    aria-label="Hire date"
                  />
                </div>
              </div>

              {/* Termination Date - Only show when status is inactive or terminated */}
              {(status === 'inactive' || status === 'terminated') && (
                <div className="space-y-2">
                  <Label htmlFor="terminationDate">
                    Termination Date {status === 'terminated' && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id="terminationDate"
                    type="date"
                    value={terminationDate}
                    onChange={(e) => setTerminationDate(e.target.value)}
                    required={status === 'terminated'}
                    aria-label="Termination date"
                  />
                  <p className="text-xs text-muted-foreground">
                    Payroll allocations will stop being generated after this date
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional information about this employee..."
                  rows={3}
                  aria-label="Employee notes"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createEmployee.isPending || updateEmployee.isPending}
              >
                {(() => {
                  if (createEmployee.isPending || updateEmployee.isPending) return 'Saving...';
                  if (employee) return 'Update Employee';
                  return 'Add Employee';
                })()}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isEffectiveDateModalOpen}
        onOpenChange={(open) => {
          setIsEffectiveDateModalOpen(open);
          if (!open) {
            setPendingCompChange(null);
            setSavingCompHistory(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Apply New Compensation Rate</DialogTitle>
            <DialogDescription>
              We’ll keep your historical records intact. This change only applies to shifts worked on or after the effective date.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="effectiveDate">
                Effective Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="effectiveDate"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                required
                aria-label="Effective date for new compensation rate"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              This change only applies to shifts worked on or after the effective date.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEffectiveDateModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleApplyCompChange}
              disabled={savingCompHistory || updateEmployee.isPending || !effectiveDate}
            >
              {savingCompHistory ? 'Saving...' : 'Save New Rate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
