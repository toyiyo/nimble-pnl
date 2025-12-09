import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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

  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const { toast } = useToast();

  useEffect(() => {
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
      // Compensation fields
      compensation_type: compensationType,
      hourly_rate: hourlyRateInCents,
      salary_amount: salaryAmountInCents,
      pay_period_type: compensationType === 'salary' ? payPeriodType : undefined,
      allocate_daily: compensationType === 'salary' ? allocateDaily : undefined,
      contractor_payment_amount: contractorAmountInCents,
      contractor_payment_interval: compensationType === 'contractor' ? contractorPaymentInterval : undefined,
    };

    if (employee) {
      updateEmployee.mutate(
        { id: employee.id, ...employeeData },
        {
          onSuccess: () => {
            onOpenChange(false);
            resetForm();
          },
        }
      );
    } else {
      createEmployee.mutate(employeeData, {
        onSuccess: (newEmployee) => {
          // If email is provided, send invitation for "staff" role
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
        },
      });
    }
  };

  return (
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

            {/* Hourly Rate - shown for hourly employees */}
            {compensationType === 'hourly' && (
              <div className="space-y-2">
                <Label htmlFor="hourlyRate">
                  Hourly Rate ($) <span className="text-destructive">*</span>
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

            {/* Salary Fields - shown for salaried employees */}
            {compensationType === 'salary' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="salaryAmount">
                    Salary Amount ($) <span className="text-destructive">*</span>
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
                  <Label htmlFor="payPeriodType">
                    Pay Period <span className="text-destructive">*</span>
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
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="allocateDaily"
                    checked={allocateDaily}
                    onCheckedChange={(checked) => setAllocateDaily(checked === true)}
                    aria-label="Allocate to Daily P&L"
                  />
                  <Label htmlFor="allocateDaily" className="cursor-pointer">
                    Allocate to Daily P&L
                  </Label>
                </div>
              </>
            )}

            {/* Contractor Fields - shown for contractors */}
            {compensationType === 'contractor' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="contractorPaymentAmount">
                    Payment Amount ($) <span className="text-destructive">*</span>
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
  );
};
