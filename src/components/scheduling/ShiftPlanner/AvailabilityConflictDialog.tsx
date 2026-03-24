import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import type { ConflictCheck } from '@/types/scheduling';
import type { ValidationIssue } from '@/lib/shiftValidator';
import { formatConflictLine } from '@/lib/conflictFormatUtils';

export interface ConflictDialogData {
  employeeName: string;
  conflicts: ConflictCheck[];
  warnings: ValidationIssue[];
}

interface AvailabilityConflictDialogProps {
  open: boolean;
  data: ConflictDialogData | null;
  timezone: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AvailabilityConflictDialog({
  open,
  data,
  timezone,
  onConfirm,
  onCancel,
}: Readonly<AvailabilityConflictDialogProps>) {
  if (!data) return null;

  const allIssues: string[] = [
    ...data.warnings.map((w) => w.message),
    ...data.conflicts.map((c) => formatConflictLine(c, timezone)),
  ];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <DialogContent className="max-w-md p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Scheduling Warning
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {data.employeeName} has conflicts with this assignment
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5">
          <div className="space-y-2">
            {allIssues.map((issue, i) => (
              <div
                key={i}
                className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20"
              >
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-[13px] text-foreground">{issue}</p>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="px-6 pb-6 pt-0 gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            Assign Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
