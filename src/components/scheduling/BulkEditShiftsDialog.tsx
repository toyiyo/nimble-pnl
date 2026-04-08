import { useState, useCallback } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Pencil } from 'lucide-react';

const NO_CHANGE = '__no_change__' as const;

interface BulkEditShiftsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly selectedCount: number;
  readonly onConfirm: (changes: Record<string, unknown>) => void;
  readonly isUpdating: boolean;
  readonly positions: string[];
}

export function BulkEditShiftsDialog({
  open,
  onOpenChange,
  selectedCount,
  onConfirm,
  isUpdating,
  positions,
}: BulkEditShiftsDialogProps) {
  const [startTime, setStartTime] = useState(NO_CHANGE);
  const [endTime, setEndTime] = useState(NO_CHANGE);
  const [position, setPosition] = useState(NO_CHANGE);

  const hasChanges = startTime !== NO_CHANGE || endTime !== NO_CHANGE || position !== NO_CHANGE;

  const resetFields = useCallback(() => {
    setStartTime(NO_CHANGE);
    setEndTime(NO_CHANGE);
    setPosition(NO_CHANGE);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetFields();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetFields],
  );

  const handleConfirm = useCallback(() => {
    const changes: Record<string, unknown> = {};
    if (startTime !== NO_CHANGE) changes.start_time = startTime;
    if (endTime !== NO_CHANGE) changes.end_time = endTime;
    if (position !== NO_CHANGE) changes.position = position;
    onConfirm(changes);
  }, [startTime, endTime, position, onConfirm]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Pencil className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Edit {selectedCount} Shift{selectedCount !== 1 ? 's' : ''}
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Only changed fields will be applied
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Start Time
            </Label>
            <Input
              type="time"
              value={startTime === NO_CHANGE ? '' : startTime}
              placeholder="-- No change --"
              onChange={(e) =>
                setStartTime(e.target.value || NO_CHANGE)
              }
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
              aria-label="Start time"
            />
            {startTime !== NO_CHANGE && (
              <button
                type="button"
                onClick={() => setStartTime(NO_CHANGE)}
                className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Reset start time"
              >
                Reset to no change
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              End Time
            </Label>
            <Input
              type="time"
              value={endTime === NO_CHANGE ? '' : endTime}
              placeholder="-- No change --"
              onChange={(e) =>
                setEndTime(e.target.value || NO_CHANGE)
              }
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
              aria-label="End time"
            />
            {endTime !== NO_CHANGE && (
              <button
                type="button"
                onClick={() => setEndTime(NO_CHANGE)}
                className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Reset end time"
              >
                Reset to no change
              </button>
            )}
          </div>

          {positions.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Position
              </Label>
              <Select value={position} onValueChange={setPosition}>
                <SelectTrigger
                  className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  aria-label="Position"
                >
                  <SelectValue placeholder="-- No change --" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CHANGE}>
                    <span className="text-muted-foreground">-- No change --</span>
                  </SelectItem>
                  {positions.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/40">
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={isUpdating}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!hasChanges || isUpdating}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            {isUpdating
              ? 'Updating...'
              : `Apply to ${selectedCount} Shift${selectedCount !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
