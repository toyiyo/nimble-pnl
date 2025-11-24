import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  Users, 
  Lock 
} from 'lucide-react';
import { format } from 'date-fns';

interface PublishScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weekStart: Date;
  weekEnd: Date;
  shiftCount: number;
  employeeCount: number;
  totalHours: number;
  onConfirm: (notes?: string) => void;
  isPublishing: boolean;
}

export const PublishScheduleDialog = ({
  open,
  onOpenChange,
  weekStart,
  weekEnd,
  shiftCount,
  employeeCount,
  totalHours,
  onConfirm,
  isPublishing,
}: PublishScheduleDialogProps) => {
  const [notes, setNotes] = useState('');

  const handleConfirm = () => {
    onConfirm(notes.trim() || undefined);
    setNotes('');
  };

  const handleCancel = () => {
    setNotes('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-primary" />
            Publish Schedule
          </DialogTitle>
          <DialogDescription>
            You are about to publish the schedule for{' '}
            <strong>
              {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
            </strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4 p-4 bg-gradient-to-br from-primary/5 to-accent/5 rounded-lg border border-primary/10">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{shiftCount}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                <Clock className="h-3 w-3" />
                Shifts
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{employeeCount}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                <Users className="h-3 w-3" />
                Employees
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">{totalHours.toFixed(1)}</div>
              <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                <Clock className="h-3 w-3" />
                Hours
              </div>
            </div>
          </div>

          {/* Warning Alert */}
          <Alert className="border-yellow-500/50 bg-yellow-500/10">
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-sm">
              <strong>Important:</strong> Once published, the schedule will be:
              <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
                <li>Locked and cannot be edited without unpublishing</li>
                <li>Visible to all employees</li>
                <li>Sent via push notifications to staff</li>
              </ul>
            </AlertDescription>
          </Alert>

          {/* Lock Icon */}
          <div className="flex items-center justify-center p-4 bg-muted/30 rounded-lg">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>

          {/* Notes Field */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add any notes about this schedule (e.g., special events, holiday coverage)..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[80px]"
              disabled={isPublishing}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleCancel}
            disabled={isPublishing}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isPublishing}
            className="bg-gradient-to-r from-primary to-accent"
          >
            {isPublishing ? (
              <>
                <Clock className="h-4 w-4 mr-2 animate-spin" />
                Publishing...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Publish Schedule
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
