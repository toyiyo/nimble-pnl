import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateOpenShift } from '@/hooks/useOpenShifts';
import { Calendar, Clock, Users } from 'lucide-react';
import { format } from 'date-fns';

interface OpenShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  defaultDate?: Date;
  availablePositions: string[];
}

export const OpenShiftDialog = ({
  open,
  onOpenChange,
  restaurantId,
  defaultDate,
  availablePositions,
}: OpenShiftDialogProps) => {
  const today = defaultDate || new Date();
  const [date, setDate] = useState(format(today, 'yyyy-MM-dd'));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [position, setPosition] = useState('');
  const [breakDuration, setBreakDuration] = useState('30');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  
  const createOpenShift = useCreateOpenShift();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Combine date and time
      const startDateTime = new Date(`${date}T${startTime}`);
      const endDateTime = new Date(`${date}T${endTime}`);

      await createOpenShift.mutateAsync({
        restaurant_id: restaurantId,
        employee_id: null, // Open shift has no assigned employee
        start_time: startDateTime.toISOString(),
        end_time: endDateTime.toISOString(),
        break_duration: parseInt(breakDuration),
        position,
        status: 'scheduled',
        notes: notes || undefined,
      });
      
      onOpenChange(false);
      // Reset form
      setDate(format(today, 'yyyy-MM-dd'));
      setStartTime('09:00');
      setEndTime('17:00');
      setPosition('');
      setBreakDuration('30');
      setNotes('');
    } catch (error) {
      console.error('Error creating open shift:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Create Open Shift
          </DialogTitle>
          <DialogDescription>
            Create an unassigned shift that employees can claim from the marketplace.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="date" className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              Date
            </Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          {/* Time Range */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startTime" className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Start Time
              </Label>
              <Input
                id="startTime"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endTime" className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                End Time
              </Label>
              <Input
                id="endTime"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Position */}
          <div className="space-y-2">
            <Label htmlFor="position" className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Position
            </Label>
            {availablePositions.length > 0 ? (
              <Select value={position} onValueChange={setPosition} required>
                <SelectTrigger>
                  <SelectValue placeholder="Select position" />
                </SelectTrigger>
                <SelectContent>
                  {availablePositions.map((pos) => (
                    <SelectItem key={pos} value={pos}>
                      {pos}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id="position"
                placeholder="e.g., Server, Cook, Bartender"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                required
              />
            )}
          </div>

          {/* Break Duration */}
          <div className="space-y-2">
            <Label htmlFor="breakDuration">Break Duration (minutes)</Label>
            <Input
              id="breakDuration"
              type="number"
              min="0"
              step="15"
              value={breakDuration}
              onChange={(e) => setBreakDuration(e.target.value)}
              required
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add any special requirements or details..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-gradient-to-r from-green-500 to-emerald-600"
            >
              {loading ? 'Creating...' : 'Create Open Shift'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
