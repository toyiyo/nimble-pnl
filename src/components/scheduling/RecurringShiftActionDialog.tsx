import { useState, useEffect } from 'react';

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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { AlertTriangle, Calendar, Edit, Repeat, Trash2 } from 'lucide-react';

import { RecurringActionScope, getScopeDescription } from '@/utils/recurringShiftHelpers';

import { Shift } from '@/types/scheduling';

import { format } from 'date-fns';

export type RecurringActionType = 'edit' | 'delete';

interface RecurringShiftActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actionType: RecurringActionType;
  shift: Shift | null;
  seriesCount: number;
  lockedCount: number;
  onConfirm: (scope: RecurringActionScope) => void;
  isLoading?: boolean;
}

interface ScopeOptionProps {
  value: RecurringActionScope;
  label: string;
  shift: Shift;
  seriesCount: number;
}

function ScopeOption({ value, label, shift, seriesCount }: ScopeOptionProps): React.ReactElement {
  const id = `scope-${value}`;

  return (
    <div className="flex items-start space-x-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
      <RadioGroupItem value={value} id={id} className="mt-0.5" />
      <div className="flex-1">
        <Label htmlFor={id} className="cursor-pointer font-medium">
          {label}
        </Label>
        <p className="text-sm text-muted-foreground">
          {getScopeDescription(value, shift, seriesCount)}
        </p>
      </div>
    </div>
  );
}

export function RecurringShiftActionDialog({
  open,
  onOpenChange,
  actionType,
  shift,
  seriesCount,
  lockedCount,
  onConfirm,
  isLoading = false,
}: RecurringShiftActionDialogProps): React.ReactElement | null {
  const [selectedScope, setSelectedScope] = useState<RecurringActionScope>('this');

  useEffect(() => {
    if (open) {
      setSelectedScope('this');
    }
  }, [open]);

  if (!shift) return null;

  const isDelete = actionType === 'delete';
  const shiftDate = format(new Date(shift.start_time), 'EEE, MMM d');
  const shiftTime = format(new Date(shift.start_time), 'h:mm a');

  const getButtonLabel = (): string => {
    if (isLoading) {
      return isDelete ? 'Deleting...' : 'Updating...';
    }
    return isDelete ? 'Delete' : 'Continue';
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {isDelete ? (
              <Trash2 className="h-5 w-5 text-destructive" />
            ) : (
              <Edit className="h-5 w-5 text-primary" />
            )}
            {isDelete ? 'Delete Recurring Shift' : 'Edit Recurring Shift'}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-foreground">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{shiftDate}</span>
                <span className="text-muted-foreground">at {shiftTime}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Repeat className="h-4 w-4" />
                <span>This shift is part of a recurring series ({seriesCount} shifts total)</span>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-4">
          {lockedCount > 0 && (
            <Alert variant="default" className="mb-4 border-warning/50 bg-warning/10">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <AlertDescription className="text-sm">
                {lockedCount} shift{lockedCount > 1 ? 's are' : ' is'} part of a published schedule
                and will not be {isDelete ? 'deleted' : 'modified'}.
              </AlertDescription>
            </Alert>
          )}

          <RadioGroup
            value={selectedScope}
            onValueChange={(value) => setSelectedScope(value as RecurringActionScope)}
            className="space-y-3"
          >
            <ScopeOption value="this" label="This shift only" shift={shift} seriesCount={seriesCount} />
            <ScopeOption value="following" label="This and following shifts" shift={shift} seriesCount={seriesCount} />
            <ScopeOption value="all" label="All shifts in series" shift={shift} seriesCount={seriesCount} />
          </RadioGroup>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => onConfirm(selectedScope)}
            disabled={isLoading}
            className={isDelete ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
          >
            {getButtonLabel()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
