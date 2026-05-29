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

  const reactivateMutation = useReactivateEmployee();

  const resetForm = () => {
    setHourlyRate('');
    setUpdateRate(false);
  };

  // Pre-fill the rate field whenever the dialog opens for a different employee
  useEffect(() => {
    if (employee && open) {
      setHourlyRate(employee.hourly_rate ? (employee.hourly_rate / 100).toFixed(2) : '');
      setUpdateRate(false);
    }
  }, [employee, open]);

  const handleReactivate = () => {
    if (!employee) return;

    const newRate = updateRate && hourlyRate
      ? Math.round(parseFloat(hourlyRate) * 100)
      : undefined;

    reactivateMutation.mutate(
      { employeeId: employee.id, hourlyRate: newRate },
      {
        onSuccess: () => {
          onOpenChange(false);
          resetForm();
        },
      }
    );
  };

  const handleCancel = () => {
    onOpenChange(false);
    resetForm();
  };

  if (!employee) return null;

  const currentRateDisplay = employee.hourly_rate
    ? `$${(employee.hourly_rate / 100).toFixed(2)}/hr`
    : 'Not set';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[500px] max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <RotateCcw className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Reactivate Employee
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                Reactivate {employee.name}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {/* Info Alert */}
          <Alert>
            <CheckCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="text-[13px]">
              The employee will be able to log in, punch in/out (including with their existing kiosk PIN), and be scheduled for shifts.
            </AlertDescription>
          </Alert>

          {/* Employee Info */}
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
              <h3 className="text-[13px] font-semibold text-foreground">Employee Details</h3>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Position</span>
                  <p className="text-[14px] font-medium text-foreground mt-0.5">{employee.position}</p>
                </div>
                <div>
                  <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Current Rate</span>
                  <p className="text-[14px] font-medium text-foreground mt-0.5">{currentRateDisplay}</p>
                </div>
                {employee.deactivation_reason && (
                  <div className="col-span-2">
                    <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Deactivation Reason</span>
                    <p className="text-[14px] font-medium text-foreground mt-0.5 capitalize">{employee.deactivation_reason.replace(/_/g, ' ')}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Update Rate Option */}
          <div className="space-y-4 pt-1 border-t border-border/40">
            <div className="flex items-start space-x-3 pt-4">
              <Checkbox
                id="update-rate"
                checked={updateRate}
                onCheckedChange={(checked) => setUpdateRate(checked as boolean)}
              />
              <div className="grid gap-1 leading-none flex-1">
                <Label
                  htmlFor="update-rate"
                  className="text-[14px] font-medium text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  Update hourly rate
                </Label>
                <p className="text-[13px] text-muted-foreground">
                  Set a new rate for this employee (optional)
                </p>
              </div>
            </div>

            {updateRate && (
              <div className="ml-7 space-y-2">
                <Label
                  htmlFor="new-rate"
                  className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                >
                  New Hourly Rate
                </Label>
                <div className="flex items-center gap-2">
                  <span className="text-[14px] text-muted-foreground">$</span>
                  <Input
                    id="new-rate"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="15.00"
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(e.target.value)}
                    className="max-w-[150px] h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                  />
                  <span className="text-[13px] text-muted-foreground">/hour</span>
                </div>
              </div>
            )}
          </div>

          {/* Info Section */}
          <Alert variant="default">
            <Info className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="text-[13px]">
              <strong>Note:</strong> You can adjust roles, permissions, and other settings after reactivation in the employee profile.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter className="px-6 pb-6 pt-0">
          <Button
            variant="ghost"
            onClick={handleCancel}
            disabled={reactivateMutation.isPending}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handleReactivate}
            disabled={reactivateMutation.isPending || (updateRate && !hourlyRate)}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            {reactivateMutation.isPending ? 'Reactivating...' : 'Reactivate Employee'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
