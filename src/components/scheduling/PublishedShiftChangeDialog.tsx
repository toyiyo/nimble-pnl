import { useEffect, useState, type MouseEvent } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

import { formatNamesLabel } from '@/lib/scheduling/formatNamesLabel';

interface PublishedShiftChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeName: string;
  /** Set on a reassignment. The dialog then names both employees. */
  secondEmployeeName?: string;
  isPending: boolean;
  onConfirm: (options: { notify: boolean }) => void;
}

export function PublishedShiftChangeDialog({
  open,
  onOpenChange,
  employeeName,
  secondEmployeeName,
  isPending,
  onConfirm,
}: Readonly<PublishedShiftChangeDialogProps>) {
  const [notify, setNotify] = useState(true);

  // The checkbox starts checked every time the dialog opens.
  useEffect(() => {
    if (open) {
      setNotify(true);
    }
  }, [open]);

  const namesLabel = formatNamesLabel(employeeName, secondEmployeeName);

  const handleConfirm = (event: MouseEvent) => {
    // AlertDialogAction closes the dialog on click by default. Always block
    // that: `onConfirm` is async and the guard clears `pending` itself only
    // once the change actually commits, so a Radix auto-close here would
    // race ahead of a failed mutation and leave it unretryable.
    event.preventDefault();
    if (isPending) return;
    onConfirm({ notify });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[17px] font-semibold text-foreground">
            This shift is published
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] text-muted-foreground">
            {namesLabel} can see this shift. Save the change anyway?
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-center gap-2">
          <Checkbox
            id="published-shift-change-notify"
            checked={notify}
            onCheckedChange={(checked) => setNotify(checked === true)}
            disabled={isPending}
          />
          <Label
            htmlFor="published-shift-change-notify"
            className="text-[13px] font-normal text-foreground"
          >
            Notify {namesLabel} about this change
          </Label>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
            Save change
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
