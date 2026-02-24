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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { CalendarPlus } from 'lucide-react';

import { useAddTemplateSlot } from '@/hooks/useWeekTemplates';

import { ShiftTemplate } from '@/types/scheduling';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AddSlotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dayOfWeek: number;
  weekTemplateId: string;
  definitions: ShiftTemplate[];
  positions: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddSlotDialog({
  open,
  onOpenChange,
  dayOfWeek,
  weekTemplateId,
  definitions,
  positions,
}: AddSlotDialogProps) {
  const addSlotMutation = useAddTemplateSlot();

  const [shiftTemplateId, setShiftTemplateId] = useState('');
  const [position, setPosition] = useState('__inherit__');
  const [headcount, setHeadcount] = useState(1);

  // Active definitions only
  const activeDefinitions = definitions.filter((d) => d.is_active);

  // Reset form on open
  useEffect(() => {
    if (open) {
      setShiftTemplateId(activeDefinitions.length > 0 ? activeDefinitions[0].id : '');
      setPosition('__inherit__');
      setHeadcount(1);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!shiftTemplateId) return;

    addSlotMutation.mutate(
      {
        week_template_id: weekTemplateId,
        shift_template_id: shiftTemplateId,
        day_of_week: dayOfWeek,
        position: position === '__inherit__' ? null : position,
        headcount,
        sort_order: 0,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <CalendarPlus className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Add Shift Slot
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {DAY_NAMES[dayOfWeek]}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* Shift Definition */}
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Shift Definition
            </Label>
            {activeDefinitions.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No active shift definitions. Create one first.
              </p>
            ) : (
              <Select value={shiftTemplateId} onValueChange={setShiftTemplateId}>
                <SelectTrigger className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
                  <SelectValue placeholder="Select a shift definition" />
                </SelectTrigger>
                <SelectContent>
                  {activeDefinitions.map((def) => (
                    <SelectItem key={def.id} value={def.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full inline-block"
                          style={{ backgroundColor: def.color || '#3b82f6' }}
                        />
                        {def.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Position */}
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Position
            </Label>
            <Select value={position} onValueChange={setPosition}>
              <SelectTrigger className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
                <SelectValue placeholder="Select position" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__inherit__">Inherit from definition</SelectItem>
                {positions.map((pos) => (
                  <SelectItem key={pos} value={pos}>
                    {pos}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Headcount */}
          <div className="space-y-1.5">
            <Label
              htmlFor="slot-headcount"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Headcount
            </Label>
            <Input
              id="slot-headcount"
              type="number"
              min={1}
              value={headcount}
              onChange={(e) => setHeadcount(Math.max(1, Number(e.target.value)))}
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
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
              disabled={addSlotMutation.isPending || !shiftTemplateId}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              {addSlotMutation.isPending ? 'Adding...' : 'Add Slot'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
