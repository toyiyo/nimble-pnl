import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShiftTemplate } from '@/types/scheduling';
import { useCreateShiftTemplate, useUpdateShiftTemplate } from '@/hooks/useShiftTemplates';

interface ShiftTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: ShiftTemplate;
  restaurantId: string;
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

const DAYS_OF_WEEK = [
  { label: 'Sunday', value: 0 },
  { label: 'Monday', value: 1 },
  { label: 'Tuesday', value: 2 },
  { label: 'Wednesday', value: 3 },
  { label: 'Thursday', value: 4 },
  { label: 'Friday', value: 5 },
  { label: 'Saturday', value: 6 },
];

export const ShiftTemplateDialog = ({ open, onOpenChange, template, restaurantId }: ShiftTemplateDialogProps) => {
  const [name, setName] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState(1); // Default to Monday
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [breakDuration, setBreakDuration] = useState('30');
  const [position, setPosition] = useState('Server');

  const createTemplate = useCreateShiftTemplate();
  const updateTemplate = useUpdateShiftTemplate();

  useEffect(() => {
    if (template) {
      setName(template.name);
      setDayOfWeek(template.day_of_week);
      setStartTime(template.start_time);
      setEndTime(template.end_time);
      setBreakDuration(template.break_duration.toString());
      setPosition(template.position);
    } else {
      resetForm();
    }
  }, [template, open]);

  const resetForm = () => {
    setName('');
    setDayOfWeek(1);
    setStartTime('09:00');
    setEndTime('17:00');
    setBreakDuration('30');
    setPosition('Server');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      alert('Please enter a template name');
      return;
    }

    const parsedBreak = parseInt(breakDuration, 10);
    if (Number.isNaN(parsedBreak) || parsedBreak < 0) {
      alert('Please enter a valid break duration (0 or greater)');
      return;
    }

    // Validate times
    if (startTime >= endTime) {
      alert('End time must be after start time');
      return;
    }

    const templateData = {
      restaurant_id: restaurantId,
      name: name.trim(),
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      break_duration: parsedBreak,
      position,
      is_active: true,
    };

    if (template) {
      updateTemplate.mutate(
        { id: template.id, ...templateData },
        {
          onSuccess: () => {
            onOpenChange(false);
            resetForm();
          },
        }
      );
    } else {
      createTemplate.mutate(templateData, {
        onSuccess: () => {
          onOpenChange(false);
          resetForm();
        },
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{template ? 'Edit Shift Template' : 'Create Shift Template'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">
                Template Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Morning Server Shift"
                required
                aria-label="Template name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dayOfWeek">
                Day of Week <span className="text-destructive">*</span>
              </Label>
              <Select value={dayOfWeek.toString()} onValueChange={(value) => setDayOfWeek(parseInt(value, 10))} required>
                <SelectTrigger id="dayOfWeek" aria-label="Select day of week">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OF_WEEK.map((day) => (
                    <SelectItem key={day.value} value={day.value.toString()}>
                      {day.label}
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
                <Label htmlFor="startTime">
                  Start Time <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="startTime"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  aria-label="Template start time"
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
                  aria-label="Template end time"
                />
              </div>
            </div>

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
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createTemplate.isPending || updateTemplate.isPending}
            >
              {createTemplate.isPending || updateTemplate.isPending
                ? 'Saving...'
                : template
                ? 'Update Template'
                : 'Create Template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
