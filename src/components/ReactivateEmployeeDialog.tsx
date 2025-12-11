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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useReactivateEmployee } from '@/hooks/useEmployees';
import { Employee } from '@/types/scheduling';
import { CheckCircle, RotateCcw, Info } from 'lucide-react';

interface ReactivateEmployeeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee | null;
}

export const ReactivateEmployeeDialog = ({
  open,
  onOpenChange,
  employee,
}: ReactivateEmployeeDialogProps) => {
  const [hourlyRate, setHourlyRate] = useState('');
  const [updateRate, setUpdateRate] = useState(false);
  const [confirmPin, setConfirmPin] = useState(true);
  
  const reactivateMutation = useReactivateEmployee();

  // Initialize form when employee changes
  useEffect(() => {
    if (employee && open) {
      // Pre-fill with current rate
      const currentRate = employee.hourly_rate
        ? (employee.hourly_rate / 100).toFixed(2)
        : '';
      setHourlyRate(currentRate);
      setUpdateRate(false);
      setConfirmPin(true);
    }
  }, [employee, open]);

  const handleReactivate = () => {
    if (!employee) return;

    const newRate = updateRate && hourlyRate
      ? Math.round(parseFloat(hourlyRate) * 100)
      : undefined;

    reactivateMutation.mutate(
      {
        employeeId: employee.id,
        hourlyRate: newRate,
        confirmPin,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          // Reset form
          setHourlyRate('');
          setUpdateRate(false);
          setConfirmPin(true);
        },
      }
    );
  };

  const handleCancel = () => {
    onOpenChange(false);
    setHourlyRate('');
    setUpdateRate(false);
    setConfirmPin(true);
  };

  if (!employee) return null;

  const currentRateDisplay = employee.hourly_rate
    ? `$${(employee.hourly_rate / 100).toFixed(2)}/hr`
    : 'Not set';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
              <RotateCcw className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <DialogTitle>Reactivate Employee</DialogTitle>
              <DialogDescription>
                Reactivate {employee.name}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Info Alert */}
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              The employee will be able to log in, punch in/out, and be scheduled for shifts.
            </AlertDescription>
          </Alert>

          {/* Employee Info */}
          <div className="rounded-lg bg-muted p-4 space-y-2">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Position:</span>
                <p className="font-medium">{employee.position}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Current Rate:</span>
                <p className="font-medium">{currentRateDisplay}</p>
              </div>
              {employee.deactivation_reason && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Deactivation Reason:</span>
                  <p className="font-medium capitalize">{employee.deactivation_reason.replace('_', ' ')}</p>
                </div>
              )}
            </div>
          </div>

          {/* Update Rate Option */}
          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-start space-x-3">
              <Checkbox
                id="update-rate"
                checked={updateRate}
                onCheckedChange={(checked) => setUpdateRate(checked as boolean)}
              />
              <div className="grid gap-1.5 leading-none flex-1">
                <Label
                  htmlFor="update-rate"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  Update hourly rate
                </Label>
                <p className="text-sm text-muted-foreground">
                  Set a new rate for this employee (optional)
                </p>
              </div>
            </div>

            {updateRate && (
              <div className="ml-8 space-y-2">
                <Label htmlFor="new-rate">New Hourly Rate</Label>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">$</span>
                  <Input
                    id="new-rate"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="15.00"
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                    className="max-w-[150px]"
                  />
                  <span className="text-sm text-muted-foreground">/hour</span>
                </div>
              </div>
            )}
          </div>

          {/* PIN Confirmation */}
          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-start space-x-3">
              <Checkbox
                id="confirm-pin"
                checked={confirmPin}
                onCheckedChange={(checked) => setConfirmPin(checked as boolean)}
              />
              <div className="grid gap-1.5 leading-none">
                <Label
                  htmlFor="confirm-pin"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  Enable kiosk PIN
                </Label>
                <p className="text-sm text-muted-foreground">
                  Allow employee to punch in/out using their existing PIN
                </p>
              </div>
            </div>
          </div>

          {/* Info Section */}
          <Alert variant="default">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Note:</strong> You can adjust roles, permissions, and other settings after reactivation in the employee profile.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={reactivateMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleReactivate}
            disabled={reactivateMutation.isPending || (updateRate && !hourlyRate)}
          >
            {reactivateMutation.isPending ? 'Reactivating...' : 'Reactivate Employee'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
