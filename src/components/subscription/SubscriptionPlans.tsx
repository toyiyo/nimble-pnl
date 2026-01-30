import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { PricingCard } from './PricingCard';
import { SubscriptionStatus } from './SubscriptionStatus';
import { useSubscription } from '@/hooks/useSubscription';
import {
  SUBSCRIPTION_PLANS,
  SubscriptionTier,
  SubscriptionPeriod,
} from '@/lib/subscriptionPlans';

const TIERS: SubscriptionTier[] = ['starter', 'growth', 'pro'];

export function SubscriptionPlans() {
  const {
    effectiveTier,
    subscription,
    volumeDiscount,
    createCheckout,
    isCreatingCheckout,
  } = useSubscription();

  const [period, setPeriod] = useState<SubscriptionPeriod>(
    subscription?.period || 'monthly'
  );

  // Sync period with subscription when it changes (e.g., switching restaurants)
  useEffect(() => {
    if (subscription?.period) {
      setPeriod(subscription.period);
    }
  }, [subscription?.period]);

  const handleSelectPlan = useCallback(
    (tier: SubscriptionTier) => {
      createCheckout({ tier, period });
    },
    [createCheckout, period]
  );

  return (
    <div className="space-y-6">
      {/* Current Subscription Status */}
      <SubscriptionStatus />

      {/* Volume Discount Info */}
      {volumeDiscount.qualifies && (
        <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              Volume Discount Applied
              <Badge variant="secondary">{volumeDiscount.percent}% off</Badge>
            </CardTitle>
            <CardDescription>
              Managing {volumeDiscount.locationCount} locations qualifies you for a{' '}
              {volumeDiscount.percent}% discount on all plans.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Billing Toggle */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center gap-4">
            <Label
              htmlFor="billing-toggle"
              className={period === 'monthly' ? 'font-semibold' : 'text-muted-foreground'}
            >
              Monthly
            </Label>
            <Switch
              id="billing-toggle"
              checked={period === 'annual'}
              onCheckedChange={(checked) => setPeriod(checked ? 'annual' : 'monthly')}
            />
            <Label
              htmlFor="billing-toggle"
              className={period === 'annual' ? 'font-semibold' : 'text-muted-foreground'}
            >
              Annual
              <span className="ml-1 text-xs text-primary">(Save 17%)</span>
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Pricing Cards */}
      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((tier) => (
          <PricingCard
            key={tier}
            plan={SUBSCRIPTION_PLANS[tier]}
            period={period}
            isCurrentPlan={effectiveTier === tier && subscription?.status === 'active'}
            onSelect={() => handleSelectPlan(tier)}
            isLoading={isCreatingCheckout}
            volumeDiscount={volumeDiscount.qualifies ? volumeDiscount : undefined}
          />
        ))}
      </div>

      {/* Volume Discount Tiers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Volume Discounts</CardTitle>
          <CardDescription>
            Save more when you manage multiple locations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className={volumeDiscount.locationCount >= 3 && volumeDiscount.locationCount <= 5 ? 'font-semibold text-primary' : ''}>
              <div className="text-2xl font-bold">5%</div>
              <div className="text-sm text-muted-foreground">3-5 locations</div>
            </div>
            <div className={volumeDiscount.locationCount >= 6 && volumeDiscount.locationCount <= 10 ? 'font-semibold text-primary' : ''}>
              <div className="text-2xl font-bold">10%</div>
              <div className="text-sm text-muted-foreground">6-10 locations</div>
            </div>
            <div className={volumeDiscount.locationCount >= 11 ? 'font-semibold text-primary' : ''}>
              <div className="text-2xl font-bold">15%</div>
              <div className="text-sm text-muted-foreground">11+ locations</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
