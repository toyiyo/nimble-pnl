import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Clock } from 'lucide-react';
import { useEmployees } from '@/hooks/useEmployees';
import { useCreateAvailability, useUpdateAvailability } from '@/hooks/useAvailability';
import { EmployeeAvailability } from '@/types/scheduling';

interface AvailabilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  availability?: EmployeeAvailability;
}

const daysOfWeek = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export const AvailabilityDialog = ({
  open,
  onOpenChange,
  restaurantId,
  availability,
}: AvailabilityDialogProps) => {
  const [employeeId, setEmployeeId] = useState<string>('');
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);
  const [isAvailable, setIsAvailable] = useState(true);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [notes, setNotes] = useState('');

  const { employees } = useEmployees(restaurantId);
  const createAvailability = useCreateAvailability();
  const updateAvailability = useUpdateAvailability();

  const activeEmployees = employees.filter(emp => emp.status === 'active');

  useEffect(() => {
    if (availability) {
      setEmployeeId(availability.employee_id);
      setDayOfWeek(availability.day_of_week);
      setIsAvailable(availability.is_available);
      setStartTime(availability.start_time.substring(0, 5)); // HH:MM
      setEndTime(availability.end_time.substring(0, 5)); // HH:MM
      setNotes(availability.notes || '');
    } else {
      setEmployeeId('');
      setDayOfWeek(1);
      setIsAvailable(true);
      setStartTime('09:00');
      setEndTime('17:00');
      setNotes('');
    }
  }, [availability, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!employeeId) {
      return;
    }

    const availabilityData = {
      restaurant_id: restaurantId,
      employee_id: employeeId,
      day_of_week: dayOfWeek,
      is_available: isAvailable,
      start_time: `${startTime}:00`,
      end_time: `${endTime}:00`,
      notes: notes || undefined,
    };

    if (availability) {
      updateAvailability.mutate(
        { id: availability.id, ...availabilityData },
        {
          onSuccess: () => {
            onOpenChange(false);
          },
        }
      );
    } else {
      createAvailability.mutate(availabilityData, {
        onSuccess: () => {
          onOpenChange(false);
        },
      });
    }
  };

  const isValid = employeeId && (!isAvailable || (startTime && endTime && startTime < endTime));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby="availability-description">
        <DialogHeader>
          <DialogTitle>{availability ? 'Edit Availability' : 'Set Availability'}</DialogTitle>
          <DialogDescription id="availability-description">
            {availability 
              ? 'Update recurring weekly availability for this employee.' 
              : 'Set recurring weekly availability preferences for an employee.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="employee">Employee *</Label>
            <Select
              value={employeeId}
              onValueChange={setEmployeeId}
              disabled={!!availability}
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

          <div className="space-y-2">
            <Label htmlFor="day-of-week">Day of Week *</Label>
            <Select
              value={dayOfWeek.toString()}
              onValueChange={(value) => setDayOfWeek(parseInt(value))}
            >
              <SelectTrigger id="day-of-week">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {daysOfWeek.map((day) => (
                  <SelectItem key={day.value} value={day.value.toString()}>
                    {day.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between space-x-2">
            <Label htmlFor="is-available" className="flex-1">
              Is available on this day
            </Label>
            <Switch
              id="is-available"
              checked={isAvailable}
              onCheckedChange={setIsAvailable}
            />
          </div>

          {isAvailable && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start-time">Start Time *</Label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="start-time"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="end-time">End Time *</Label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="end-time"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about this availability..."
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid || createAvailability.isPending || updateAvailability.isPending}
            >
              {availability ? 'Update' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
