import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CreditCard, ExternalLink, Gift, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { SUBSCRIPTION_PLANS, formatPrice } from '@/lib/subscriptionPlans';

export function SubscriptionStatus() {
  const {
    subscription,
    effectiveTier,
    isTrialing,
    isGrandfathered,
    isPastDue,
    isActive,
    isCanceled,
    trialDaysRemaining,
    grandfatheredDaysRemaining,
    openPortal,
    isOpeningPortal,
  } = useSubscription();

  if (!subscription || !effectiveTier) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const plan = SUBSCRIPTION_PLANS[effectiveTier];
  const price = plan.price[subscription.period];

  const getStatusBadge = () => {
    if (isGrandfathered) {
      return (
        <Badge variant="secondary" className="gap-1">
          <Gift className="h-3 w-3" />
          Grandfathered
        </Badge>
      );
    }
    if (isTrialing) {
      return (
        <Badge variant="outline" className="gap-1 border-blue-500 text-blue-600">
          <Clock className="h-3 w-3" />
          Trial
        </Badge>
      );
    }
    if (isPastDue) {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" />
          Past Due
        </Badge>
      );
    }
    if (isCanceled) {
      return (
        <Badge variant="secondary" className="gap-1">
          Canceled
        </Badge>
      );
    }
    if (isActive) {
      return (
        <Badge variant="default" className="gap-1 bg-green-600">
          <CheckCircle className="h-3 w-3" />
          Active
        </Badge>
      );
    }
    return null;
  };

  const getStatusMessage = () => {
    if (isTrialing && trialDaysRemaining !== null) {
      return `${trialDaysRemaining} days left in trial`;
    }
    if (isGrandfathered && grandfatheredDaysRemaining !== null) {
      return `Pro features until ${new Date(subscription.grandfatheredUntil!).toLocaleDateString()}`;
    }
    if (isPastDue) {
      return 'Payment failed - please update your payment method';
    }
    if (isCanceled) {
      return 'Access limited to Starter features';
    }
    if (isActive && subscription.subscriptionEndsAt) {
      return `Renews ${new Date(subscription.subscriptionEndsAt).toLocaleDateString()}`;
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {plan.name} Plan
              {getStatusBadge()}
            </CardTitle>
            <CardDescription>
              {getStatusMessage()}
            </CardDescription>
          </div>
          {subscription.stripeSubscriptionId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => openPortal()}
              disabled={isOpeningPortal}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              {isOpeningPortal ? 'Opening...' : 'Manage Billing'}
              <ExternalLink className="ml-2 h-3 w-3" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Plan</p>
            <p className="font-medium">{plan.name}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Billing</p>
            <p className="font-medium capitalize">{subscription.period}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Price</p>
            <p className="font-medium">
              {formatPrice(price)}/{subscription.period === 'annual' ? 'year' : 'month'}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Status</p>
            <p className="font-medium capitalize">{subscription.status.replace('_', ' ')}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
