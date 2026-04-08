import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

import { CalendarDays, CalendarCheck } from 'lucide-react';

interface AssignmentPopoverProps {
  open: boolean;
  employeeName: string;
  shiftName: string;
  activeDayCount: number;
  onAssignDay: () => void;
  onAssignAll: () => void;
  onCancel: () => void;
}

export function AssignmentPopover({
  open,
  employeeName,
  shiftName,
  activeDayCount,
  onAssignDay,
  onAssignAll,
  onCancel,
}: AssignmentPopoverProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent className="max-w-xs p-0 gap-0 border-border/40">
        <DialogHeader className="px-4 pt-4 pb-3">
          <DialogTitle className="text-[15px] font-semibold text-foreground">
            Assign {employeeName}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground">
            to {shiftName}
          </DialogDescription>
        </DialogHeader>
        <div className="px-4 pb-4 space-y-2">
          <Button
            variant="outline"
            className="w-full justify-start gap-2 h-10 text-[13px] font-medium rounded-lg border-border/40"
            onClick={onAssignDay}
          >
            <CalendarCheck className="h-4 w-4 text-muted-foreground" />
            This day only
          </Button>
          {activeDayCount > 1 && (
            <Button
              variant="outline"
              className="w-full justify-start gap-2 h-10 text-[13px] font-medium rounded-lg border-border/40"
              onClick={onAssignAll}
            >
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              All {activeDayCount} days this week
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
