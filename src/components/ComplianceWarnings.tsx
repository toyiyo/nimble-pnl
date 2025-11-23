import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  AlertTriangle, 
  AlertCircle, 
  XCircle,
  Clock,
  Users,
  Hourglass,
} from 'lucide-react';
import { ViolationDetails, ViolationSeverity, ComplianceRuleType } from '@/types/compliance';

interface ComplianceWarningsProps {
  violations: ViolationDetails[];
  onOverride?: () => void;
  canOverride?: boolean;
  className?: string;
}

const SEVERITY_ICONS: Record<ViolationSeverity, React.ComponentType<{ className?: string }>> = {
  warning: AlertTriangle,
  error: AlertCircle,
  critical: XCircle,
};

const SEVERITY_COLORS: Record<ViolationSeverity, string> = {
  warning: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-900 dark:text-yellow-100',
  error: 'border-orange-500/50 bg-orange-500/10 text-orange-900 dark:text-orange-100',
  critical: 'border-red-500/50 bg-red-500/10 text-red-900 dark:text-red-100',
};

const RULE_TYPE_ICONS: Record<ComplianceRuleType, React.ComponentType<{ className?: string }>> = {
  minor_restrictions: Users,
  clopening: Clock,
  rest_period: Hourglass,
  shift_length: Clock,
  overtime: AlertTriangle,
};

export const ComplianceWarnings = ({ 
  violations, 
  onOverride, 
  canOverride = false,
  className = '',
}: ComplianceWarningsProps) => {
  if (violations.length === 0) {
    return null;
  }

  // Sort by severity (critical, error, warning)
  const sortedViolations = [...violations].sort((a, b) => {
    const severityOrder = { critical: 0, error: 1, warning: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  const hasCritical = violations.some(v => v.severity === 'critical');
  const hasError = violations.some(v => v.severity === 'error');

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          Compliance Issues Detected
        </h4>
        {onOverride && canOverride && !hasCritical && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOverride}
            className="h-8"
          >
            Override & Save
          </Button>
        )}
      </div>

      <div className="space-y-2">
        {sortedViolations.map((violation, index) => {
          const SeverityIcon = SEVERITY_ICONS[violation.severity];
          const RuleIcon = RULE_TYPE_ICONS[violation.rule_type];
          
          return (
            <Alert key={index} className={SEVERITY_COLORS[violation.severity]}>
              <div className="flex gap-3">
                <SeverityIcon className="h-5 w-5 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <AlertTitle className="text-sm flex items-center gap-2 mb-1">
                    <RuleIcon className="h-4 w-4" />
                    <span className="capitalize">{violation.rule_type.replace(/_/g, ' ')}</span>
                    <Badge 
                      variant="outline" 
                      className={`text-xs ${
                        violation.severity === 'critical' 
                          ? 'border-red-500' 
                          : violation.severity === 'error'
                          ? 'border-orange-500'
                          : 'border-yellow-500'
                      }`}
                    >
                      {violation.severity}
                    </Badge>
                  </AlertTitle>
                  <AlertDescription className="text-sm">
                    {violation.message}
                  </AlertDescription>
                  {violation.hours_between !== undefined && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Time between shifts: {violation.hours_between.toFixed(1)} hours
                    </p>
                  )}
                </div>
              </div>
            </Alert>
          );
        })}
      </div>

      {hasCritical && (
        <Alert className="border-red-500 bg-red-500/10">
          <XCircle className="h-4 w-4 text-red-500" />
          <AlertDescription className="text-sm text-red-900 dark:text-red-100">
            Critical violations cannot be overridden. Please adjust the shift to comply with regulations.
          </AlertDescription>
        </Alert>
      )}

      {hasError && !hasCritical && canOverride && onOverride && (
        <Alert className="border-orange-500 bg-orange-500/10">
          <AlertCircle className="h-4 w-4 text-orange-500" />
          <AlertDescription className="text-sm text-orange-900 dark:text-orange-100">
            This shift violates compliance rules. Manager override is required to proceed.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};
