import { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Lock, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSubscription } from '@/hooks/useSubscription';
import {
  SUBSCRIPTION_FEATURES,
  SUBSCRIPTION_PLANS,
  getRequiredTier,
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
}: FeatureGateProps) {
  const { hasFeature, effectiveTier } = useSubscription();
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

  // Default upgrade prompt
  const feature = SUBSCRIPTION_FEATURES[featureKey];
  const requiredTier = getRequiredTier(featureKey);
  const requiredPlan = SUBSCRIPTION_PLANS[requiredTier];

  return (
    <Alert className="my-4">
      <Lock className="h-4 w-4" />
      <AlertTitle className="flex items-center gap-2">
        {feature.name}
        <span className="text-xs font-normal text-muted-foreground">
          ({requiredPlan.name} plan required)
        </span>
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <p>{feature.description}</p>
        <div>
          <Button
            variant="default"
            size="sm"
            onClick={() => navigate('/settings?tab=subscription')}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Upgrade to {requiredPlan.name}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
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
