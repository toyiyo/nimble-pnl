import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useComplianceViolations } from '@/hooks/useCompliance';
import { 
  Shield,
  AlertTriangle,
  CheckCircle,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ComplianceRuleType, ViolationSeverity } from '@/types/compliance';
import { useMemo } from 'react';

const RULE_TYPE_LABELS: Record<ComplianceRuleType, string> = {
  minor_restrictions: 'Minor Labor',
  clopening: 'Clopening',
  rest_period: 'Rest Period',
  shift_length: 'Shift Length',
  overtime: 'Overtime',
};

export const ComplianceDashboard = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const { violations, loading } = useComplianceViolations(restaurantId);

  const metrics = useMemo(() => {
    const activeViolations = violations.filter(v => v.status === 'active');
    const overriddenViolations = violations.filter(v => v.status === 'overridden');

    const violationsByType: Record<string, number> = {};
    const violationsBySeverity: Record<string, number> = {
      warning: 0,
      error: 0,
      critical: 0,
    };

    const employeeViolationMap = new Map<string, { name: string; count: number }>();

    violations.forEach(v => {
      // By type
      violationsByType[v.rule_type] = (violationsByType[v.rule_type] || 0) + 1;

      // By severity
      if (v.status === 'active') {
        violationsBySeverity[v.severity] = (violationsBySeverity[v.severity] || 0) + 1;
      }

      // By employee
      if (v.employee && v.status === 'active') {
        const current = employeeViolationMap.get(v.employee_id) || { name: v.employee.name, count: 0 };
        employeeViolationMap.set(v.employee_id, { ...current, count: current.count + 1 });
      }
    });

    const topViolators = Array.from(employeeViolationMap.entries())
      .map(([id, data]) => ({ employee_id: id, employee_name: data.name, violation_count: data.count }))
      .sort((a, b) => b.violation_count - a.violation_count)
      .slice(0, 5);

    return {
      totalViolations: violations.length,
      activeViolations: activeViolations.length,
      overriddenViolations: overriddenViolations.length,
      violationsByType,
      violationsBySeverity,
      topViolators,
    };
  }, [violations]);

  if (!restaurantId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Please select a restaurant to view compliance dashboard.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Shield className="h-6 w-6 text-primary transition-transform duration-300 group-hover:scale-110" />
            </div>
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Compliance Dashboard
              </CardTitle>
              <CardDescription>Overview of labor law compliance status</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Violations</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{metrics.totalViolations}</div>
                <p className="text-xs text-muted-foreground">All time</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Violations</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold text-destructive">{metrics.activeViolations}</div>
                <p className="text-xs text-muted-foreground">Require attention</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overridden</CardTitle>
            <CheckCircle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{metrics.overriddenViolations}</div>
                <p className="text-xs text-muted-foreground">Manager approved</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Compliance Rate</CardTitle>
            {metrics.activeViolations === 0 ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-orange-500" />
            )}
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className={`text-2xl font-bold ${metrics.activeViolations === 0 ? 'text-green-600' : ''}`}>
                  {metrics.activeViolations === 0 ? '100%' : 'Issues'}
                </div>
                <p className="text-xs text-muted-foreground">
                  {metrics.activeViolations === 0 ? 'All compliant' : 'Needs review'}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Violations by Severity */}
      <Card>
        <CardHeader>
          <CardTitle>Active Violations by Severity</CardTitle>
          <CardDescription>Current compliance issues by risk level</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-24 w-full" />
          ) : metrics.activeViolations === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-2" />
              <p className="text-sm text-muted-foreground">No active violations</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(['critical', 'error', 'warning'] as ViolationSeverity[]).map((severity) => {
                const count = metrics.violationsBySeverity[severity] || 0;
                if (count === 0) return null;

                return (
                  <div key={severity} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <Badge 
                        variant={severity === 'critical' ? 'destructive' : severity === 'error' ? 'default' : 'outline'}
                      >
                        {severity}
                      </Badge>
                      <span className="text-sm text-muted-foreground capitalize">
                        {severity === 'critical' 
                          ? 'Cannot be overridden' 
                          : severity === 'error'
                          ? 'Requires override'
                          : 'Advisory only'}
                      </span>
                    </div>
                    <span className="text-2xl font-bold">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Violations by Type */}
      <Card>
        <CardHeader>
          <CardTitle>Violations by Rule Type</CardTitle>
          <CardDescription>Breakdown of all violations by category</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : Object.keys(metrics.violationsByType).length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-2" />
              <p className="text-sm text-muted-foreground">No violations recorded</p>
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(metrics.violationsByType)
                .sort(([, a], [, b]) => b - a)
                .map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between p-2 hover:bg-muted/50 rounded">
                    <span className="text-sm">{RULE_TYPE_LABELS[type as ComplianceRuleType]}</span>
                    <Badge variant="outline">{count}</Badge>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top Violators */}
      {metrics.topViolators.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Employees with Active Violations</CardTitle>
            <CardDescription>Top employees requiring schedule adjustments</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {metrics.topViolators.map((violator, index) => (
                <div key={violator.employee_id} className="flex items-center gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{violator.employee_name}</p>
                  </div>
                  <Badge variant="destructive">{violator.violation_count} violations</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
