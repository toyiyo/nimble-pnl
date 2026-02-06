import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle, Clock, Gift } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { useNavigate } from 'react-router-dom';

export function TrialBanner() {
  const {
    isTrialing,
    isGrandfathered,
    isPastDue,
    trialDaysRemaining,
    grandfatheredDaysRemaining,
  } = useSubscription();
  const navigate = useNavigate();

  // Trial banner
  if (isTrialing && trialDaysRemaining !== null) {
    const isUrgent = trialDaysRemaining <= 3;

    return (
      <Alert
        variant={isUrgent ? 'destructive' : 'default'}
        className="mb-4 border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950"
      >
        <Clock className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <span>
            <strong>{trialDaysRemaining}</strong> day
            {trialDaysRemaining === 1 ? '' : 's'} left in your Pro trial
          </span>
          <Button
            variant={isUrgent ? 'default' : 'outline'}
            size="sm"
            onClick={() => navigate('/settings?tab=subscription')}
          >
            Choose Plan
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // Grandfathered banner (show 30 days before expiration)
  if (isGrandfathered && grandfatheredDaysRemaining !== null && grandfatheredDaysRemaining <= 30) {
    return (
      <Alert className="mb-4 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
        <Gift className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <span>
            Your grandfathered Pro access ends in <strong>{grandfatheredDaysRemaining}</strong> days.
            Choose a plan to continue.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/settings?tab=subscription')}
          >
            View Plans
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // Past due banner
  if (isPastDue) {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <span>Payment failed. Please update your payment method to avoid service interruption.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/settings?tab=subscription')}
          >
            Update Payment
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
