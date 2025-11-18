import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Employee } from '@/types/scheduling';
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
  const [hourlyRate, setHourlyRate] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'terminated'>('active');
  const [hireDate, setHireDate] = useState('');
  const [notes, setNotes] = useState('');

  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const { toast } = useToast();

  useEffect(() => {
    if (employee) {
      setName(employee.name);
      setEmail(employee.email || '');
      setPhone(employee.phone || '');
      setPosition(employee.position);
      setHourlyRate((employee.hourly_rate / 100).toFixed(2));
      setStatus(employee.status);
      setHireDate(employee.hire_date || '');
      setNotes(employee.notes || '');
    } else {
      resetForm();
    }
  }, [employee, open]);

  const resetForm = () => {
    setName('');
    setEmail('');
    setPhone('');
    setPosition('Server');
    setHourlyRate('');
    setStatus('active');
    setHireDate('');
    setNotes('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const hourlyRateInCents = Math.round(parseFloat(hourlyRate || '0') * 100);

    const employeeData = {
      restaurant_id: restaurantId,
      name,
      email: email || undefined,
      phone: phone || undefined,
      position,
      hourly_rate: hourlyRateInCents,
      status,
      hire_date: hireDate || undefined,
      notes: notes || undefined,
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
        onSuccess: async (newEmployee) => {
          // If email is provided, send invitation for "staff" role
          if (email && email.trim()) {
            try {
              const { error } = await supabase.functions.invoke('send-team-invitation', {
                body: {
                  restaurantId: restaurantId,
                  email: email.trim(),
                  role: 'staff',
                  employeeId: newEmployee.id, // Pass employee ID for linking
                },
              });

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
            } catch (error) {
              console.error('Error invoking send-team-invitation:', error);
              toast({
                title: 'Employee created',
                description: `${name} was added but invitation email failed to send.`,
                variant: 'default',
              });
            }
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
              {createEmployee.isPending || updateEmployee.isPending
                ? 'Saving...'
                : employee
                ? 'Update Employee'
                : 'Add Employee'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
