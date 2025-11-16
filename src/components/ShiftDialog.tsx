import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shift } from '@/types/scheduling';
import { useCreateShift, useUpdateShift } from '@/hooks/useShifts';
import { useEmployees } from '@/hooks/useEmployees';
import { format } from 'date-fns';

interface ShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift?: Shift;
  restaurantId: string;
  defaultDate?: Date;
}

const POSITIONS = [
  'Server',
  'Cook',
  'Bartender',
  'Host',
  'Manager',
  'Dishwasher',
  'Chef',
  'Busser',
  'Other',
];

export const ShiftDialog = ({ open, onOpenChange, shift, restaurantId, defaultDate }: ShiftDialogProps) => {
  const [employeeId, setEmployeeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [breakDuration, setBreakDuration] = useState('30');
  const [position, setPosition] = useState('Server');
  const [status, setStatus] = useState<'scheduled' | 'confirmed' | 'completed' | 'cancelled'>('scheduled');
  const [notes, setNotes] = useState('');

  const { employees } = useEmployees(restaurantId);
  const createShift = useCreateShift();
  const updateShift = useUpdateShift();

  useEffect(() => {
    if (shift) {
      const start = new Date(shift.start_time);
      const end = new Date(shift.end_time);
      
      setEmployeeId(shift.employee_id);
      setStartDate(format(start, 'yyyy-MM-dd'));
      setStartTime(format(start, 'HH:mm'));
      setEndDate(format(end, 'yyyy-MM-dd'));
      setEndTime(format(end, 'HH:mm'));
      setBreakDuration(shift.break_duration.toString());
      setPosition(shift.position);
      setStatus(shift.status);
      setNotes(shift.notes || '');
    } else {
      resetForm();
      if (defaultDate) {
        const dateStr = format(defaultDate, 'yyyy-MM-dd');
        setStartDate(dateStr);
        setEndDate(dateStr);
      }
    }
  }, [shift, defaultDate, open]);

  const resetForm = () => {
    setEmployeeId('');
    setStartDate('');
    setStartTime('09:00');
    setEndDate('');
    setEndTime('17:00');
    setBreakDuration('30');
    setPosition('Server');
    setStatus('scheduled');
    setNotes('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate employee selection
    if (!employeeId) {
      alert('Please select an employee');
      return;
    }

    // Validate and parse break duration
    const parsedBreak = parseInt(breakDuration, 10);
    if (Number.isNaN(parsedBreak) || parsedBreak < 0) {
      alert('Please enter a valid break duration (0 or greater)');
      return;
    }

    const startDateTime = new Date(`${startDate}T${startTime}`);
    const endDateTime = new Date(`${endDate}T${endTime}`);

    if (endDateTime <= startDateTime) {
      alert('End time must be after start time');
      return;
    }

    const shiftData = {
      restaurant_id: restaurantId,
      employee_id: employeeId,
      start_time: startDateTime.toISOString(),
      end_time: endDateTime.toISOString(),
      break_duration: parsedBreak,
      position,
      status,
      notes: notes || undefined,
    };

    if (shift) {
      updateShift.mutate(
        { id: shift.id, ...shiftData },
        {
          onSuccess: () => {
            onOpenChange(false);
            resetForm();
          },
        }
      );
    } else {
      createShift.mutate(shiftData, {
        onSuccess: () => {
          onOpenChange(false);
          resetForm();
        },
      });
    }
  };

  const activeEmployees = employees.filter((emp) => emp.status === 'active');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{shift ? 'Edit Shift' : 'Create New Shift'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="employee">
                Employee <span className="text-destructive">*</span>
              </Label>
              <Select value={employeeId} onValueChange={setEmployeeId} required>
                <SelectTrigger id="employee" aria-label="Select employee">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {activeEmployees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name} - {emp.position}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="position">
                Position <span className="text-destructive">*</span>
              </Label>
              <Select value={position} onValueChange={setPosition} required>
                <SelectTrigger id="position" aria-label="Select position">
                  <SelectValue placeholder="Select position" />
                </SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((pos) => (
                    <SelectItem key={pos} value={pos}>
                      {pos}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">
                  Start Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  aria-label="Shift start date"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="startTime">
                  Start Time <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="startTime"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  aria-label="Shift start time"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="endDate">
                  End Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                  aria-label="Shift end date"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="endTime">
                  End Time <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="endTime"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  aria-label="Shift end time"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="breakDuration">Break Duration (minutes)</Label>
                <Input
                  id="breakDuration"
                  type="number"
                  min="0"
                  step="15"
                  value={breakDuration}
                  onChange={(e) => setBreakDuration(e.target.value)}
                  aria-label="Break duration in minutes"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
                  <SelectTrigger id="status" aria-label="Shift status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional information about this shift..."
                rows={3}
                aria-label="Shift notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createShift.isPending || updateShift.isPending}
            >
              {createShift.isPending || updateShift.isPending
                ? 'Saving...'
                : shift
                ? 'Update Shift'
                : 'Create Shift'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
