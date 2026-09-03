import { useState, type ReactNode } from 'react';
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
import { useCreateShiftTrade, useCreateShiftTradeForEmployee } from '@/hooks/useShiftTrades';
import { useShiftProtection } from '@/hooks/useShiftProtection';
import { useEmployees } from '@/hooks/useEmployees';
import { ArrowRightLeft, Users, Loader2, AlertTriangle, Shield } from 'lucide-react';
import { tradeDeadlineFinding } from '@/lib/shiftProtection';

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
  /** Set in self-service mode: the signed-in employee posts their own shift. */
  currentEmployeeId?: string;
  /** Set in manager mode: an owner or a manager posts this employee's shift. */
  onBehalfOfEmployee?: { id: string; name: string };
}

export const TradeRequestDialog = ({
  open,
  onOpenChange,
  shift,
  restaurantId,
  currentEmployeeId,
  onBehalfOfEmployee,
}: TradeRequestDialogProps) => {
  const [tradeType, setTradeType] = useState<'marketplace' | 'directed'>('marketplace');
  const [targetEmployeeId, setTargetEmployeeId] = useState<string>('');
  const [reason, setReason] = useState('');

  // Both hooks must run every render (React rule of hooks). The manager mode
  // uses the SECURITY DEFINER RPC; the self-service mode uses the direct insert.
  const selfMutation = useCreateShiftTrade();
  const managerMutation = useCreateShiftTradeForEmployee();
  const isManagerMode = Boolean(onBehalfOfEmployee);
  const { mutate: createTrade, isPending } = isManagerMode ? managerMutation : selfMutation;

  const { employees, loading: employeesLoading, error: employeesError } = useEmployees(restaurantId);

  // Shift Protection: the deadline rule for this shift. Manager mode is
  // exempt from block, matching the server triggers.
  const { protection } = useShiftProtection(restaurantId);
  const deadlineFinding = tradeDeadlineFinding(protection, shift?.start_time, new Date());
  const postBlocked = deadlineFinding?.mode === 'block' && !isManagerMode;

  // The offerer is the on-behalf employee in manager mode, else the signed-in
  // employee.
  const offererId = onBehalfOfEmployee?.id ?? currentEmployeeId;

  // Show every other active coworker as a directed-trade target.
  const availableEmployees = employees.filter(
    (emp) => emp.id !== offererId && emp.is_active
  );

  const handleSubmit = () => {
    if (!offererId) {
      return;
    }
    if (tradeType === 'directed' && !targetEmployeeId) {
      return;
    }

    createTrade(
      {
        restaurant_id: restaurantId,
        offered_shift_id: shift.id,
        offered_by_employee_id: offererId,
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

  // Early return if the shift or the offerer is missing (dialog not ready).
  if (!shift || !offererId) {
    return null;
  }

  const shiftStart = new Date(shift.start_time);
  const shiftEnd = new Date(shift.end_time);

  const title = isManagerMode
    ? `Post ${onBehalfOfEmployee?.name}'s shift for trade`
    : 'Trade Shift';
  const description = isManagerMode
    ? 'Post this shift to the trade marketplace or offer it to a specific coworker.'
    : 'Offer your shift to the trade marketplace or a specific coworker.';

  // Build the coworker-picker body one state at a time (no nested ternary).
  let targetOptions: ReactNode;
  if (employeesLoading) {
    targetOptions = (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Loading employees...
      </div>
    );
  } else if (employeesError) {
    targetOptions = (
      <div className="p-4 text-center text-sm text-muted-foreground">
        Couldn't load coworkers. Something went wrong.
      </div>
    );
  } else if (availableEmployees.length === 0) {
    targetOptions = (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No other employees available
      </div>
    );
  } else {
    targetOptions = availableEmployees.map((employee) => (
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
    ));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <ArrowRightLeft className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                {title}
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {description}
              </DialogDescription>
            </div>
          </div>
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

        {deadlineFinding && (
          <div
            id="trade-policy-warning"
            role="status"
            className="flex gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20"
          >
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-[13px] text-foreground">{deadlineFinding.message}</p>
              <p className="text-[12px] text-muted-foreground">
                {postBlocked
                  ? 'A shift protection rule blocks this trade. Ask your manager to post it for you.'
                  : 'Your manager sees this warning with the trade.'}
              </p>
            </div>
          </div>
        )}

        {!isManagerMode && (
          <div className="flex gap-2.5 p-3 rounded-lg bg-muted/50 border border-border/40">
            <Shield className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-[13px] text-foreground leading-relaxed">
              <span className="font-semibold">This shift stays yours</span> until a manager
              approves the trade. If nobody accepts, you work it.
            </p>
          </div>
        )}

        {/* Trade Type Selection */}
        <div className="space-y-4">
          <Label className="text-base font-semibold">Trade Type</Label>
          <RadioGroup value={tradeType} onValueChange={(val: 'marketplace' | 'directed') => setTradeType(val)}>
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
                <SelectContent>{targetOptions}</SelectContent>
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
              placeholder="Why does this shift need a trade? (e.g., family event, another commitment)"
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
              isPending || postBlocked || (tradeType === 'directed' && !targetEmployeeId)
            }
            aria-describedby={postBlocked ? 'trade-policy-warning' : undefined}
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
