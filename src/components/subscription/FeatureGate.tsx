import { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock, Sparkles, Check, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSubscription } from '@/hooks/useSubscription';
import {
  SUBSCRIPTION_FEATURES,
  SUBSCRIPTION_PLANS,
  getRequiredTier,
  formatPrice,
} from '@/lib/subscriptionPlans';

interface FeatureGateProps {
  /** The feature key to check access for */
  featureKey: keyof typeof SUBSCRIPTION_FEATURES;
  /** Content to render if user has access */
  children: ReactNode;
  /** Optional custom fallback to render if user doesn't have access */
  fallback?: ReactNode;
  /** If true, renders nothing instead of upgrade prompt when access denied */
  silent?: boolean;
  /** Compact mode - smaller upsell card */
  compact?: boolean;
}

/**
 * Gate content behind subscription tier requirements.
 *
 * Usage:
 * ```tsx
 * <FeatureGate featureKey="ai_assistant">
 *   <AiAssistantComponent />
 * </FeatureGate>
 * ```
 */
export function FeatureGate({
  featureKey,
  children,
  fallback,
  silent,
  compact,
}: FeatureGateProps) {
  const { hasFeature, effectiveTier, subscription } = useSubscription();
  const navigate = useNavigate();

  const hasAccess = hasFeature(featureKey);

  if (hasAccess) {
    return <>{children}</>;
  }

  if (silent) {
    return null;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  // Enhanced upgrade prompt
  const feature = SUBSCRIPTION_FEATURES[featureKey];
  const requiredTier = getRequiredTier(featureKey);
  const requiredPlan = SUBSCRIPTION_PLANS[requiredTier];
  const currentPlan = effectiveTier ? SUBSCRIPTION_PLANS[effectiveTier] : null;
  const benefits = 'benefits' in feature ? (feature.benefits as string[]) : [];

  if (compact) {
    return (
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-accent/5">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-full bg-primary/10">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <h3 className="font-semibold text-lg">{feature.name}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </div>
              <Button
                size="sm"
                onClick={() => navigate('/settings?tab=subscription')}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Upgrade to {requiredPlan.name}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-accent/5 overflow-hidden">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-full bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <div>
            <CardTitle className="text-xl">{feature.name}</CardTitle>
            <CardDescription className="text-base mt-1">
              Available with the <span className="font-semibold text-primary">{requiredPlan.name}</span> plan
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-muted-foreground">{feature.description}</p>

        {benefits.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-medium text-sm uppercase tracking-wide text-muted-foreground">
              What you get
            </h4>
            <ul className="space-y-2">
              {benefits.map((benefit, idx) => (
                <li key={idx} className="flex items-start gap-3">
                  <div className="p-1 rounded-full bg-green-500/10 mt-0.5">
                    <Check className="h-3 w-3 text-green-600" />
                  </div>
                  <span className="text-sm">{benefit}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-4 border-t">
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">
              {currentPlan ? (
                <>
                  You&apos;re on <span className="font-medium">{currentPlan.name}</span>.
                  Upgrade to unlock this feature.
                </>
              ) : (
                <>Upgrade to unlock this feature.</>
              )}
            </p>
            <p className="text-lg font-semibold mt-1">
              {formatPrice(requiredPlan.price.monthly)}/month
            </p>
          </div>
          <Button
            onClick={() => navigate('/settings?tab=subscription')}
            className="gap-2 bg-gradient-to-r from-primary to-primary/80"
          >
            <Sparkles className="h-4 w-4" />
            Upgrade to {requiredPlan.name}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Hook version of FeatureGate for programmatic access checks.
 *
 * Usage:
 * ```tsx
 * const { hasAccess, requiredTier } = useFeatureAccess('ai_assistant');
 * if (!hasAccess) {
 *   return <UpgradePrompt tier={requiredTier} />;
 * }
 * ```
 */
export function useFeatureAccess(featureKey: keyof typeof SUBSCRIPTION_FEATURES) {
  const { hasFeature, effectiveTier } = useSubscription();
  const hasAccess = hasFeature(featureKey);
  const requiredTier = getRequiredTier(featureKey);

  return {
    hasAccess,
    requiredTier,
    currentTier: effectiveTier,
    feature: SUBSCRIPTION_FEATURES[featureKey],
  };
}
