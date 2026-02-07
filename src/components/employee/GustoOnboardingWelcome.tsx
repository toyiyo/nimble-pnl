// Gusto Onboarding Welcome Component
// Shows a welcome dialog for employees who need to complete payroll onboarding

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, DollarSign, FileText, Building2, ArrowRight } from 'lucide-react';

interface GustoOnboardingWelcomeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeName: string;
  onStartOnboarding: () => void;
  onSkip: () => void;
}

export const GustoOnboardingWelcome = ({
  open,
  onOpenChange,
  employeeName,
  onStartOnboarding,
  onSkip,
}: GustoOnboardingWelcomeProps) => {
  const firstName = employeeName.split(' ')[0];

  const handleStartOnboarding = () => {
    onStartOnboarding();
    onOpenChange(false);
  };

  const handleSkip = () => {
    onSkip();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <DollarSign className="h-6 w-6 text-primary" />
            </div>
            <Badge variant="secondary">Action Required</Badge>
          </div>
          <DialogTitle className="text-2xl">Welcome, {firstName}!</DialogTitle>
          <DialogDescription className="text-base">
            Complete your payroll setup to start getting paid. This only takes a few minutes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            You'll need to provide the following information:
          </p>

          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <FileText className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-sm">Tax Information</p>
                <p className="text-xs text-muted-foreground">
                  W-4 withholding preferences and tax filing status
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <Building2 className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-sm">Direct Deposit</p>
                <p className="text-xs text-muted-foreground">
                  Bank account for paycheck deposits
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <CheckCircle className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-sm">Identity Verification</p>
                <p className="text-xs text-muted-foreground">
                  I-9 work authorization documentation
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">Your information is secure.</strong> Payroll data is
              processed by Gusto, a trusted payroll provider used by over 300,000 businesses.
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={handleSkip}>
            I'll do this later
          </Button>
          <Button onClick={handleStartOnboarding} className="gap-2">
            Complete Setup
            <ArrowRight className="h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
