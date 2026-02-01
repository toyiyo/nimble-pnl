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
import { Shift } from '@/types/scheduling';
import { RecurringActionScope, getScopeDescription } from '@/utils/recurringShiftHelpers';
import { AlertTriangle, Calendar, Repeat, Trash2, Edit } from 'lucide-react';
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

export const RecurringShiftActionDialog = ({
  open,
  onOpenChange,
  actionType,
  shift,
  seriesCount,
  lockedCount,
  onConfirm,
  isLoading = false,
}: RecurringShiftActionDialogProps) => {
  const [selectedScope, setSelectedScope] = useState<RecurringActionScope>('this');

  // Reset to safest option when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedScope('this');
    }
  }, [open]);

  if (!shift) return null;

  const isDelete = actionType === 'delete';
  const shiftDate = format(new Date(shift.start_time), 'EEE, MMM d');
  const shiftTime = format(new Date(shift.start_time), 'h:mm a');

  const handleConfirm = () => {
    onConfirm(selectedScope);
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
          <AlertDialogDescription className="space-y-3">
            <div className="flex items-center gap-2 text-foreground">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{shiftDate}</span>
              <span className="text-muted-foreground">at {shiftTime}</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Repeat className="h-4 w-4" />
              <span>This shift is part of a recurring series ({seriesCount} shifts total)</span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-4">
          {/* Locked shifts warning */}
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
            {/* This shift only */}
            <div className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
              <RadioGroupItem value="this" id="scope-this" className="mt-0.5" />
              <div className="flex-1">
                <Label htmlFor="scope-this" className="font-medium cursor-pointer">
                  This shift only
                </Label>
                <p className="text-sm text-muted-foreground">
                  {getScopeDescription('this', shift, seriesCount)}
                </p>
              </div>
            </div>

            {/* This and following */}
            <div className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
              <RadioGroupItem value="following" id="scope-following" className="mt-0.5" />
              <div className="flex-1">
                <Label htmlFor="scope-following" className="font-medium cursor-pointer">
                  This and following shifts
                </Label>
                <p className="text-sm text-muted-foreground">
                  {getScopeDescription('following', shift, seriesCount)}
                </p>
              </div>
            </div>

            {/* All shifts */}
            <div className="flex items-start space-x-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
              <RadioGroupItem value="all" id="scope-all" className="mt-0.5" />
              <div className="flex-1">
                <Label htmlFor="scope-all" className="font-medium cursor-pointer">
                  All shifts in series
                </Label>
                <p className="text-sm text-muted-foreground">
                  {getScopeDescription('all', shift, seriesCount)}
                </p>
              </div>
            </div>
          </RadioGroup>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isLoading}
            className={isDelete ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
          >
            {isLoading ? (
              isDelete ? 'Deleting...' : 'Updating...'
            ) : (
              isDelete ? 'Delete' : 'Continue'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
