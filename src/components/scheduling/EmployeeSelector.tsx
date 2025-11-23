import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useEmployees } from '@/hooks/useEmployees';

interface EmployeeSelectorProps {
  restaurantId: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  required?: boolean;
}

export const EmployeeSelector = ({
  restaurantId,
  value,
  onValueChange,
  disabled = false,
  label = 'Employee',
  required = true,
}: EmployeeSelectorProps) => {
  const { employees } = useEmployees(restaurantId);
  const activeEmployees = employees.filter(emp => emp.status === 'active');

  return (
    <div className="space-y-2">
      <Label htmlFor="employee">
        {label} {required && '*'}
      </Label>
      <Select
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <SelectTrigger id="employee">
          <SelectValue placeholder="Select an employee" />
        </SelectTrigger>
        <SelectContent>
          {activeEmployees.map((employee) => (
            <SelectItem key={employee.id} value={employee.id}>
              {employee.name} - {employee.position}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
