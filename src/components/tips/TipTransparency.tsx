import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatCurrencyFromCents } from '@/utils/tipPooling';
import { HelpCircle } from 'lucide-react';
import type { ShareMethod } from '@/hooks/useTipPoolSettings';

interface EmployeeTip {
  amount: number;
  hours?: number | null;
  role?: string | null;
  totalSplit: number;
}

interface TipTransparencyProps {
  employeeTip: EmployeeTip;
  totalTeamHours: number;
  shareMethod: ShareMethod;
}

/**
 * TipTransparency - Part 3 of Apple-style UX
 * Shows plain-language explanation of how tips were calculated
 * "How was this calculated?"
 */
export function TipTransparency({ employeeTip, totalTeamHours, shareMethod }: TipTransparencyProps) {
  const getMethodExplanation = () => {
    switch (shareMethod) {
      case 'hours':
        return 'Tips were shared by hours worked.';
      case 'role':
        return 'Tips were shared by role.';
      case 'manual':
        return 'Tips were split manually by your manager.';
      default:
        return 'Tips were distributed according to the restaurant\'s policy.';
    }
  };

  const getCalculationDetails = () => {
    if (shareMethod === 'hours' && employeeTip.hours && totalTeamHours > 0) {
      const percentage = ((employeeTip.hours / totalTeamHours) * 100).toFixed(1);
      return (
        <>
          <div className="space-y-2 text-sm">
            <p>You worked <span className="font-semibold">{employeeTip.hours.toFixed(1)} hours</span></p>
            <p>Team worked <span className="font-semibold">{totalTeamHours.toFixed(1)} hours</span></p>
            <p className="text-muted-foreground">Your portion: {percentage}%</p>
          </div>
        </>
      );
    }

    if (shareMethod === 'role' && employeeTip.role) {
      return (
        <div className="space-y-2 text-sm">
          <p>Your role: <span className="font-semibold">{employeeTip.role}</span></p>
          <p className="text-muted-foreground">
            Role weights determine the distribution of tips.
          </p>
        </div>
      );
    }

    return (
      <p className="text-sm text-muted-foreground">
        Your manager distributed tips based on the restaurant's policy.
      </p>
    );
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <HelpCircle className="h-4 w-4" />
          How was this calculated?
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <HelpCircle className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">How your tips were split</DialogTitle>
              <DialogDescription className="text-[13px] mt-0.5">
                {getMethodExplanation()}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="px-6 py-5 space-y-6">
          {getCalculationDetails()}

          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground mb-2">Your share</p>
            <p className="text-3xl font-bold text-green-600">
              {formatCurrencyFromCents(employeeTip.amount)}
            </p>
          </div>

          <div className="p-4 rounded-lg bg-muted/50">
            <p className="text-xs text-muted-foreground">
              Total tips split: {formatCurrencyFromCents(employeeTip.totalSplit)}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
