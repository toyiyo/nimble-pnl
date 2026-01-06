import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useDeactivateEmployee } from '@/hooks/useEmployees';
import { Employee } from '@/types/scheduling';
import { AlertTriangle, UserX, Info } from 'lucide-react';

interface DeactivateEmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee | null;
}

const getTodayDate = () => new Date().toISOString().split('T')[0];

export const DeactivateEmployeeDialog = ({
  open,
  onOpenChange,
  employee,
}: DeactivateEmployeeDialogProps) => {
  const [reason, setReason] = useState<string>('');
  const [removeFromSchedules, setRemoveFromSchedules] = useState(true);
  const [terminationDate, setTerminationDate] = useState(getTodayDate());
  
  const deactivateMutation = useDeactivateEmployee();

  // Reset termination date when dialog opens
  useEffect(() => {
    if (open) {
      setTerminationDate(getTodayDate());
    }
  }, [open]);

  const handleDeactivate = () => {
    if (!employee || !terminationDate) return;

    deactivateMutation.mutate(
      {
        employeeId: employee.id,
        reason: reason || undefined,
        removeFromSchedules,
        terminationDate,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          // Reset form
          setReason('');
          setRemoveFromSchedules(true);
          setTerminationDate(getTodayDate());
        },
      }
    );
  };

  const handleCancel = () => {
    onOpenChange(false);
    setReason('');
    setRemoveFromSchedules(true);
    setTerminationDate(getTodayDate());
  };

  if (!employee) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100">
              <UserX className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <DialogTitle>Deactivate Employee</DialogTitle>
              <DialogDescription>
                Deactivate {employee.name}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Info Alert */}
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              This will not delete their historical punches or payroll. You can reactivate them at any time.
            </AlertDescription>
          </Alert>

          {/* Termination Date - CRITICAL for payroll calculations */}
          <div className="space-y-2">
            <Label htmlFor="terminationDate" className="flex items-center gap-1.5">
              Termination/Effective Date <span className="text-destructive">*</span>
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </Label>
            <Input
              id="terminationDate"
              type="date"
              value={terminationDate}
              onChange={(e) => setTerminationDate(e.target.value)}
              required
              aria-label="Termination date"
            />
            <p className="text-xs text-muted-foreground">
              <strong>Important:</strong> Payroll calculations will stop after this date. Set a future date if the employee is giving notice.
            </p>
          </div>

          {/* Reason Selection */}
          <div className="space-y-3">
            <Label>Why are you deactivating this employee? (Optional)</Label>
            <RadioGroup value={reason} onValueChange={setReason}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="seasonal" id="seasonal" />
                <Label htmlFor="seasonal" className="font-normal cursor-pointer">
                  Seasonal break
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="left_company" id="left_company" />
                <Label htmlFor="left_company" className="font-normal cursor-pointer">
                  Left the company
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="on_leave" id="on_leave" />
                <Label htmlFor="on_leave" className="font-normal cursor-pointer">
                  On leave
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="other" id="other" />
                <Label htmlFor="other" className="font-normal cursor-pointer">
                  Other
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Options */}
          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-start space-x-3">
              <Checkbox
                id="remove-schedules"
                checked={removeFromSchedules}
                onCheckedChange={(checked) => setRemoveFromSchedules(checked as boolean)}
              />
              <div className="grid gap-1.5 leading-none">
                <Label
                  htmlFor="remove-schedules"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  Remove from future shifts
                </Label>
                <p className="text-sm text-muted-foreground">
                  Cancel all scheduled shifts after today
                </p>
              </div>
            </div>
          </div>

          {/* What will happen */}
          <div className="rounded-lg bg-muted p-4 space-y-2">
            <h4 className="text-sm font-semibold">What will happen:</h4>
            <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
              <li>Employee will no longer appear in active lists</li>
              <li>Cannot log in or punch in/out at kiosk</li>
              <li>Cannot be assigned to new shifts</li>
              {removeFromSchedules && <li>Future scheduled shifts will be cancelled</li>}
              <li className="font-medium text-foreground">Historical data will be preserved</li>
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={deactivateMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDeactivate}
            disabled={deactivateMutation.isPending || !terminationDate}
          >
            {deactivateMutation.isPending ? 'Deactivating...' : 'Deactivate Employee'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
