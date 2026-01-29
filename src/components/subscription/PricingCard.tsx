import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SubscriptionPlan, SubscriptionPeriod, formatPrice } from '@/lib/subscriptionPlans';

interface PricingCardProps {
  plan: SubscriptionPlan;
  period: SubscriptionPeriod;
  isCurrentPlan?: boolean;
  onSelect: () => void;
  isLoading?: boolean;
  volumeDiscount?: {
    percent: number;
    locationCount: number;
  };
}

export function PricingCard({
  plan,
  period,
  isCurrentPlan,
  onSelect,
  isLoading,
  volumeDiscount,
}: PricingCardProps) {
  const price = plan.price[period];
  const monthlyEquivalent = period === 'annual' ? Math.round(price / 12) : price;

  const hasDiscount = volumeDiscount && volumeDiscount.percent > 0;
  const discountedPrice = hasDiscount
    ? Math.round(price * (1 - volumeDiscount.percent / 100))
    : price;

  return (
    <Card
      className={cn(
        'relative flex flex-col',
        plan.recommended && 'border-primary shadow-lg ring-2 ring-primary/20'
      )}
    >
      {plan.recommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-primary text-primary-foreground">
            <Sparkles className="mr-1 h-3 w-3" />
            Recommended
          </Badge>
        </div>
      )}

      <CardHeader className="text-center pb-2">
        <CardTitle className="text-xl">{plan.name}</CardTitle>
        <CardDescription className="min-h-[40px]">{plan.description}</CardDescription>
      </CardHeader>

      <CardContent className="flex-1">
        <div className="text-center mb-6">
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-4xl font-bold">{formatPrice(monthlyEquivalent)}</span>
            <span className="text-muted-foreground">/mo</span>
          </div>
          {period === 'annual' && (
            <p className="text-sm text-muted-foreground mt-1">
              Billed {formatPrice(price)}/year
            </p>
          )}
          {hasDiscount && (
            <Badge variant="secondary" className="mt-2">
              {volumeDiscount.percent}% volume discount applied
            </Badge>
          )}
        </div>

        <ul className="space-y-2">
          {plan.features.map((feature, idx) => (
            <li key={idx} className="flex items-start gap-2">
              <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
              <span className="text-sm">{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter>
        {isCurrentPlan ? (
          <Button variant="outline" className="w-full" disabled>
            Current Plan
          </Button>
        ) : (
          <Button
            className="w-full"
            variant={plan.recommended ? 'default' : 'outline'}
            onClick={onSelect}
            disabled={isLoading}
          >
            {isLoading ? 'Loading...' : `Select ${plan.name}`}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
