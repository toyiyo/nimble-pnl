import { useState, useCallback } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Clock } from 'lucide-react';

import { formatDayLabel } from '@/lib/shiftInterval';

interface ShiftQuickCreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  employeeName: string;
  day: string;
  positions: string[];
  onSubmit: (data: {
    employeeId: string;
    day: string;
    startTime: string;
    endTime: string;
    position: string;
  }) => void;
}

export function ShiftQuickCreate({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  day,
  positions,
  onSubmit,
}: ShiftQuickCreateProps) {
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [position, setPosition] = useState(positions[0] ?? '');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!position) return;

      onSubmit({
        employeeId,
        day,
        startTime,
        endTime,
        position,
      });

      // Reset form
      setStartTime('09:00');
      setEndTime('17:00');
      setPosition(positions[0] ?? '');
    },
    [employeeId, day, startTime, endTime, position, positions, onSubmit],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 border-border/40">
        {/* Header with icon */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Clock className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Quick Add Shift
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {employeeName} &middot; {formatDayLabel(day)}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Time inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="shift-start"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Start Time
              </Label>
              <Input
                id="shift-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="shift-end"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                End Time
              </Label>
              <Input
                id="shift-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                required
              />
            </div>
          </div>

          {/* Position select */}
          <div className="space-y-1.5">
            <Label
              htmlFor="shift-position"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Position
            </Label>
            <Select value={position} onValueChange={setPosition}>
              <SelectTrigger
                id="shift-position"
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
              >
                <SelectValue placeholder="Select position" />
              </SelectTrigger>
              <SelectContent>
                {positions.map((pos) => (
                  <SelectItem key={pos} value={pos}>
                    {pos}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              Add Shift
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
