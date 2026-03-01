import { useState, useEffect } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Clock } from 'lucide-react';

import {
  useCreateShiftDefinition,
  useUpdateShiftDefinition,
} from '@/hooks/useShiftDefinitions';

import { ShiftTemplate, SHIFT_COLORS } from '@/types/scheduling';

import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShiftDefinitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition?: ShiftTemplate | null;
  restaurantId: string;
  positions: string[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShiftDefinitionDialog({
  open,
  onOpenChange,
  definition,
  restaurantId,
  positions,
}: ShiftDefinitionDialogProps) {
  const isEditing = !!definition;

  // Form state
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [breakDuration, setBreakDuration] = useState(0);
  const [position, setPosition] = useState<string>('__none__');
  const [color, setColor] = useState<string>(SHIFT_COLORS[0]);
  const [description, setDescription] = useState('');

  // Mutations
  const createMutation = useCreateShiftDefinition();
  const updateMutation = useUpdateShiftDefinition();
  const isPending = createMutation.isPending || updateMutation.isPending;

  const isInvalidTimeRange = startTime === endTime;

  // Reset form when dialog opens or definition changes
  useEffect(() => {
    if (open) {
      if (definition) {
        setName(definition.name);
        setStartTime(definition.start_time.slice(0, 5));
        setEndTime(definition.end_time.slice(0, 5));
        setBreakDuration(definition.break_duration);
        setPosition(definition.position || '__none__');
        setColor(definition.color || SHIFT_COLORS[0]);
        setDescription(definition.description || '');
      } else {
        setName('');
        setStartTime('09:00');
        setEndTime('17:00');
        setBreakDuration(0);
        setPosition('__none__');
        setColor(SHIFT_COLORS[0]);
        setDescription('');
      }
    }
  }, [open, definition]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const payload = {
      restaurant_id: restaurantId,
      name: name.trim(),
      start_time: startTime,
      end_time: endTime,
      break_duration: breakDuration,
      position: position === '__none__' ? null : position,
      color,
      description: description.trim() || null,
      is_active: definition?.is_active ?? true,
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: definition.id, ...payload },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => onOpenChange(false),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Clock className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                {isEditing ? 'Edit Shift Definition' : 'New Shift Definition'}
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {isEditing
                  ? 'Update the shift template details'
                  : 'Define a reusable shift template'}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label
              htmlFor="def-name"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Name
            </Label>
            <Input
              id="def-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Morning Shift"
              required
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label
                htmlFor="def-start"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Start Time
              </Label>
              <Input
                id="def-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="def-end"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                End Time
              </Label>
              <Input
                id="def-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
              />
            </div>
          </div>
          {isInvalidTimeRange && (
            <p className="text-[12px] text-destructive">Start and end time cannot be the same.</p>
          )}

          {/* Break duration */}
          <div className="space-y-1.5">
            <Label
              htmlFor="def-break"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Break Duration (minutes)
            </Label>
            <Input
              id="def-break"
              type="number"
              min={0}
              value={breakDuration}
              onChange={(e) => setBreakDuration(Number(e.target.value))}
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>

          {/* Position */}
          <div className="space-y-1.5">
            <Label htmlFor="def-position" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Position
            </Label>
            <Select value={position} onValueChange={setPosition}>
              <SelectTrigger id="def-position" className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
                <SelectValue placeholder="Select position" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No specific position</SelectItem>
                {positions.map((pos) => (
                  <SelectItem key={pos} value={pos}>
                    {pos}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <Label htmlFor="def-color" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Color
            </Label>
            <div id="def-color" role="radiogroup" aria-label="Shift color" className="flex items-center gap-2">
              {SHIFT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Select color ${c}`}
                  onClick={() => setColor(c)}
                  className={cn(
                    'h-8 w-8 rounded-lg transition-all',
                    color === c
                      ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground scale-110'
                      : 'hover:scale-105',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label
              htmlFor="def-desc"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Description (optional)
            </Label>
            <Textarea
              id="def-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes about this shift..."
              rows={3}
              className="text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !name.trim() || isInvalidTimeRange}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              {isPending
                ? 'Saving...'
                : isEditing
                  ? 'Update Definition'
                  : 'Create Definition'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
