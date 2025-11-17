import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { RecurrencePattern, RecurrenceEndType } from '@/types/scheduling';
import { format, addMonths } from 'date-fns';

interface CustomRecurrenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (pattern: RecurrencePattern) => void;
  initialPattern?: RecurrencePattern;
  startDate: Date;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];

export const CustomRecurrenceDialog = ({ 
  open, 
  onOpenChange, 
  onSave, 
  initialPattern,
  startDate 
}: CustomRecurrenceDialogProps) => {
  const [repeatType, setRepeatType] = useState<'day' | 'week' | 'month' | 'year'>('week');
  const [interval, setInterval] = useState(1);
  const [selectedDays, setSelectedDays] = useState<number[]>([new Date(startDate).getDay()]);
  const [endType, setEndType] = useState<RecurrenceEndType>('never');
  const [endDate, setEndDate] = useState(format(addMonths(startDate, 3), 'yyyy-MM-dd'));
  const [occurrences, setOccurrences] = useState(10);

  useEffect(() => {
    if (initialPattern) {
      // Parse initial pattern
      switch (initialPattern.type) {
        case 'daily':
          setRepeatType('day');
          break;
        case 'weekly':
        case 'weekday':
        case 'custom':
          setRepeatType('week');
          break;
        case 'monthly':
          setRepeatType('month');
          break;
        case 'yearly':
          setRepeatType('year');
          break;
      }
      
      setInterval(initialPattern.interval || 1);
      setSelectedDays(initialPattern.daysOfWeek || [new Date(startDate).getDay()]);
      setEndType(initialPattern.endType);
      setEndDate(initialPattern.endDate || format(addMonths(startDate, 3), 'yyyy-MM-dd'));
      setOccurrences(initialPattern.occurrences || 10);
    }
  }, [initialPattern, startDate]);

  // Ensure selectedDays is never empty when repeatType is 'week'
  useEffect(() => {
    if (repeatType === 'week' && selectedDays.length === 0) {
      setSelectedDays([new Date(startDate).getDay()]);
    }
  }, [repeatType, selectedDays, startDate]);

  const handleDayToggle = (day: number) => {
    setSelectedDays(prev => {
      if (prev.includes(day)) {
        // Don't allow removing the last day for weekly patterns
        const newDays = prev.filter(d => d !== day);
        // If removing this day would leave no days selected, keep at least one day
        if (newDays.length === 0) {
          return prev; // Don't remove the last day
        }
        return newDays;
      } else {
        return [...prev, day].sort((a, b) => a - b);
      }
    });
  };

  const handleSave = () => {
    let pattern: RecurrencePattern;

    switch (repeatType) {
      case 'day':
        pattern = {
          type: 'daily',
          interval,
          endType,
          ...(endType === 'on' && { endDate }),
          ...(endType === 'after' && { occurrences }),
        };
        break;

      case 'week': {
        // Ensure we have at least one day selected for weekly patterns
        const daysToUse = selectedDays.length > 0 ? selectedDays : [new Date(startDate).getDay()];
        
        pattern = {
          type: daysToUse.length === 5 && 
                daysToUse.every(d => d >= 1 && d <= 5) 
                ? 'weekday' 
                : 'custom',
          interval,
          daysOfWeek: daysToUse,
          endType,
          ...(endType === 'on' && { endDate }),
          ...(endType === 'after' && { occurrences }),
        };
        break;
      }

      case 'month':
        pattern = {
          type: 'monthly',
          interval,
          endType,
          ...(endType === 'on' && { endDate }),
          ...(endType === 'after' && { occurrences }),
        };
        break;

      case 'year':
        pattern = {
          type: 'yearly',
          interval,
          endType,
          ...(endType === 'on' && { endDate }),
          ...(endType === 'after' && { occurrences }),
        };
        break;
    }

    onSave(pattern);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Custom recurrence</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Repeat Every */}
          <div className="space-y-2">
            <Label>Repeat every</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min="1"
                max="999"
                value={interval}
                onChange={(e) => setInterval(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20"
                aria-label="Repeat interval"
              />
              <Select value={repeatType} onValueChange={(value) => setRepeatType(value as typeof repeatType)}>
                <SelectTrigger className="flex-1" aria-label="Repeat unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">{interval === 1 ? 'day' : 'days'}</SelectItem>
                  <SelectItem value="week">{interval === 1 ? 'week' : 'weeks'}</SelectItem>
                  <SelectItem value="month">{interval === 1 ? 'month' : 'months'}</SelectItem>
                  <SelectItem value="year">{interval === 1 ? 'year' : 'years'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Repeat On (for weekly) */}
          {repeatType === 'week' && (
            <div className="space-y-2">
              <Label>Repeat on</Label>
              <div className="grid grid-cols-7 gap-2">
                {DAY_NAMES.map((day, index) => (
                  <div key={index} className="flex flex-col items-center gap-1">
                    <Label htmlFor={`day-${index}`} className="text-xs cursor-pointer">
                      {day[0]}
                    </Label>
                    <Checkbox
                      id={`day-${index}`}
                      checked={selectedDays.includes(index)}
                      onCheckedChange={() => handleDayToggle(index)}
                      aria-label={`Repeat on ${day}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ends */}
          <div className="space-y-3">
            <Label>Ends</Label>
            <RadioGroup value={endType} onValueChange={(value) => setEndType(value as RecurrenceEndType)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="never" id="never" />
                <Label htmlFor="never" className="cursor-pointer font-normal">Never</Label>
              </div>

              <div className="flex items-center space-x-2">
                <RadioGroupItem value="on" id="on" />
                <Label htmlFor="on" className="cursor-pointer font-normal">On</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={endType !== 'on'}
                  className="flex-1"
                  aria-label="End date"
                />
              </div>

              <div className="flex items-center space-x-2">
                <RadioGroupItem value="after" id="after" />
                <Label htmlFor="after" className="cursor-pointer font-normal">After</Label>
                <Input
                  type="number"
                  min="1"
                  max="999"
                  value={occurrences}
                  onChange={(e) => setOccurrences(Math.max(1, parseInt(e.target.value) || 1))}
                  disabled={endType !== 'after'}
                  className="w-20"
                  aria-label="Number of occurrences"
                />
                <span className="text-sm text-muted-foreground">occurrences</span>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
