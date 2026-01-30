import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Sparkles, Clock } from 'lucide-react';
import { SUBSCRIPTION_PLANS, SubscriptionTier, formatPrice } from '@/lib/subscriptionPlans';

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
}

const TIER_ORDER: SubscriptionTier[] = ['starter', 'growth', 'pro'];

function getPricingCardStyles(isTrialPlan: boolean): string {
  if (isTrialPlan) {
    return 'border-primary bg-primary/5 shadow-lg';
  }
  return 'border-border bg-card hover:border-muted-foreground/30';
}

export function WelcomeModal({ open, onClose }: WelcomeModalProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="text-center space-y-4 pb-2">
          {/* Trial Banner */}
          <div className="flex justify-center">
            <Badge
              variant="secondary"
              className="px-4 py-2 text-base bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 border-emerald-200"
            >
              <Clock className="mr-2 h-4 w-4" />
              You're starting with Pro features FREE for 14 days
            </Badge>
          </div>

          <div>
            <DialogTitle className="text-2xl font-bold">
              Welcome to EasyShiftHQ
            </DialogTitle>
            <DialogDescription className="text-base mt-2">
              After your trial, choose the plan that fits your restaurant. No credit card required to start.
            </DialogDescription>
          </div>
        </DialogHeader>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-4 mt-6">
          {TIER_ORDER.map((tier) => {
            const plan = SUBSCRIPTION_PLANS[tier];
            const isTrialPlan = tier === 'pro';

            return (
              <div
                key={tier}
                className={`relative p-5 rounded-xl border-2 transition-all ${getPricingCardStyles(isTrialPlan)}`}
              >
                {/* Trial Plan Badge */}
                {isTrialPlan && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground shadow-sm">
                      <Sparkles className="mr-1 h-3 w-3" />
                      Your Free Trial
                    </Badge>
                  </div>
                )}

                {/* Plan Header */}
                <div className="mt-2">
                  <h3 className="font-bold text-lg">{plan.name}</h3>
                  <p className="text-sm text-muted-foreground mt-1 min-h-[40px]">
                    {plan.description}
                  </p>
                </div>

                {/* Price */}
                <div className="mt-4">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold">{formatPrice(plan.price.monthly)}</span>
                    <span className="text-muted-foreground">/mo</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    per restaurant, billed monthly
                  </p>
                </div>

                {/* Highlights */}
                <ul className="mt-4 space-y-2">
                  {plan.highlights.map((highlight, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                      <span className="text-sm">{highlight}</span>
                    </li>
                  ))}
                </ul>

                {/* Full Features Preview */}
                <details className="mt-4">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                    See all {plan.features.length} features
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <Check className="h-3 w-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <div className="flex flex-col items-center gap-3 mt-8">
          <Button size="lg" onClick={onClose} className="px-8">
            Get Started
          </Button>
          <p className="text-xs text-muted-foreground">
            You can change your plan anytime in Settings
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
