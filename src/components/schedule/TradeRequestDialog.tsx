import { useState } from 'react';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateShiftTrade } from '@/hooks/useShiftTrades';
import { useEmployees } from '@/hooks/useEmployees';
import { ArrowRightLeft, Users, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Shift {
  id: string;
  start_time: string;
  end_time: string;
  position: string;
  employee_id: string;
}

interface TradeRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: Shift;
  restaurantId: string;
  currentEmployeeId: string;
}

export const TradeRequestDialog = ({
  open,
  onOpenChange,
  shift,
  restaurantId,
  currentEmployeeId,
}: TradeRequestDialogProps) => {
  const [tradeType, setTradeType] = useState<'marketplace' | 'directed'>('marketplace');
  const [targetEmployeeId, setTargetEmployeeId] = useState<string>('');
  const [reason, setReason] = useState('');

  const { mutate: createTrade, isPending } = useCreateShiftTrade();
  const { employees } = useEmployees(restaurantId);

  // Filter out current employee and inactive employees
  const availableEmployees = employees.filter(
    (emp) => emp.id !== currentEmployeeId && emp.is_active && emp.status === 'active'
  );

  const handleSubmit = () => {
    if (tradeType === 'directed' && !targetEmployeeId) {
      return;
    }

    createTrade(
      {
        restaurant_id: restaurantId,
        offered_shift_id: shift.id,
        offered_by_employee_id: currentEmployeeId,
        target_employee_id: tradeType === 'directed' ? targetEmployeeId : null,
        reason: reason || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          // Reset form
          setTradeType('marketplace');
          setTargetEmployeeId('');
          setReason('');
        },
      }
    );
  };

  // Early return if shift is null (dialog not yet opened)
  if (!shift) {
    return null;
  }

  const shiftStart = new Date(shift.start_time);
  const shiftEnd = new Date(shift.end_time);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <ArrowRightLeft className="h-6 w-6 text-primary" />
            Trade Shift
          </DialogTitle>
          <DialogDescription>
            Offer your shift to the trade marketplace or a specific coworker
          </DialogDescription>
        </DialogHeader>

        {/* Shift Details Card */}
        <div className="rounded-lg border border-border bg-gradient-to-br from-muted/30 to-transparent p-4">
          <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Shift Details</h4>
          <div className="space-y-1 text-sm">
            <p className="text-foreground">
              <span className="font-medium">Date:</span>{' '}
              {format(shiftStart, 'EEEE, MMMM d, yyyy')}
            </p>
            <p className="text-foreground">
              <span className="font-medium">Time:</span>{' '}
              {format(shiftStart, 'h:mm a')} - {format(shiftEnd, 'h:mm a')}
            </p>
            <p className="text-foreground">
              <span className="font-medium">Position:</span> {shift.position}
            </p>
          </div>
        </div>

        {/* Trade Type Selection */}
        <div className="space-y-4">
          <Label className="text-base font-semibold">Trade Type</Label>
          <RadioGroup value={tradeType} onValueChange={(val) => setTradeType(val as any)}>
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="marketplace" id="marketplace" className="mt-1" />
              <div className="flex-1">
                <Label
                  htmlFor="marketplace"
                  className="flex cursor-pointer items-center gap-2 text-base font-medium"
                >
                  <Users className="h-4 w-4 text-primary" />
                  Marketplace (Up for Grabs)
                </Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  Post to all employees. First to accept gets the shift.
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <RadioGroupItem value="directed" id="directed" className="mt-1" />
              <div className="flex-1">
                <Label
                  htmlFor="directed"
                  className="flex cursor-pointer items-center gap-2 text-base font-medium"
                >
                  <ArrowRightLeft className="h-4 w-4 text-primary" />
                  Specific Coworker
                </Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  Offer this shift to a specific employee.
                </p>
              </div>
            </div>
          </RadioGroup>

          {/* Target Employee Selection */}
          {tradeType === 'directed' && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-4">
              <Label htmlFor="target-employee" className="text-sm font-medium">
                Select Coworker
              </Label>
              <Select value={targetEmployeeId} onValueChange={setTargetEmployeeId}>
                <SelectTrigger id="target-employee">
                  <SelectValue placeholder="Choose an employee..." />
                </SelectTrigger>
                <SelectContent>
                  {availableEmployees.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      No other employees available
                    </div>
                  ) : (
                    availableEmployees.map((employee) => (
                      <SelectItem key={employee.id} value={employee.id}>
                        <div className="flex items-center gap-2">
                          <span>{employee.name}</span>
                          <span className="text-xs text-muted-foreground">
                            ({employee.position})
                          </span>
                          {!employee.user_id && (
                            <span className="text-xs text-yellow-600 dark:text-yellow-500">
                              • No account
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Reason (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="reason" className="text-sm font-medium">
              Reason <span className="text-muted-foreground">(Optional)</span>
            </Label>
            <Textarea
              id="reason"
              placeholder="Why do you need to trade this shift? (e.g., family event, another commitment)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-3 pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              isPending || (tradeType === 'directed' && !targetEmployeeId)
            }
            className="min-w-[120px]"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Posting...
              </>
            ) : (
              <>
                <ArrowRightLeft className="mr-2 h-4 w-4" />
                Post Trade
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
