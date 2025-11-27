import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useAuth } from '@/hooks/useAuth';
import { useComplianceViolations, useOverrideViolation } from '@/hooks/useCompliance';
import { 
  AlertTriangle, 
  Clock,
  Users,
  Hourglass,
  CheckCircle,
  XCircle,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { format } from 'date-fns';
import { ComplianceViolation, ComplianceRuleType, ViolationSeverity } from '@/types/compliance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const RULE_TYPE_ICONS: Record<ComplianceRuleType, React.ComponentType<{ className?: string }>> = {
  minor_restrictions: Users,
  clopening: Clock,
  rest_period: Hourglass,
  shift_length: Clock,
  overtime: AlertTriangle,
};

const RULE_TYPE_LABELS: Record<ComplianceRuleType, string> = {
  minor_restrictions: 'Minor Labor',
  clopening: 'Clopening',
  rest_period: 'Rest Period',
  shift_length: 'Shift Length',
  overtime: 'Overtime',
};

const SEVERITY_BADGES: Record<ViolationSeverity, { variant: 'default' | 'destructive' | 'outline'; icon: React.ComponentType<{ className?: string }> }> = {
  warning: { variant: 'outline', icon: AlertTriangle },
  error: { variant: 'default', icon: AlertCircle },
  critical: { variant: 'destructive', icon: XCircle },
};

export const ComplianceViolationsReport = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const { user } = useAuth();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [selectedViolation, setSelectedViolation] = useState<ComplianceViolation | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  const { violations, loading } = useComplianceViolations(restaurantId, {
    status: statusFilter === 'all' ? undefined : statusFilter,
  });
  const overrideViolation = useOverrideViolation();

  const handleOverrideClick = (violation: ComplianceViolation) => {
    setSelectedViolation(violation);
    setOverrideReason('');
    setOverrideDialogOpen(true);
  };

  const handleOverrideSubmit = () => {
    if (selectedViolation && user && overrideReason.trim()) {
      overrideViolation.mutate(
        {
          id: selectedViolation.id,
          overrideReason: overrideReason.trim(),
          userId: user.id,
        },
        {
          onSuccess: () => {
            setOverrideDialogOpen(false);
            setSelectedViolation(null);
            setOverrideReason('');
          },
        }
      );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="destructive">Active</Badge>;
      case 'overridden':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-700">Overridden</Badge>;
      case 'resolved':
        return <Badge variant="outline" className="border-green-500 text-green-700">Resolved</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (!restaurantId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Please select a restaurant to view violations.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <FileText className="h-6 w-6 text-primary transition-transform duration-300 group-hover:scale-110" />
              </div>
              <div>
                <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Compliance Violations
                </CardTitle>
                <CardDescription>Review and manage labor law compliance violations</CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4 items-end">
            <div className="space-y-2 flex-1 max-w-xs">
              <Label htmlFor="statusFilter">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="statusFilter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Violations</SelectItem>
                  <SelectItem value="active">Active Only</SelectItem>
                  <SelectItem value="overridden">Overridden</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Violations List */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : violations.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {statusFilter === 'active' ? 'No Active Violations' : 'No Violations Found'}
              </h3>
              <p className="text-muted-foreground">
                {statusFilter === 'active' 
                  ? 'All schedules are currently compliant with configured rules.'
                  : 'No violations match the selected filters.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {violations.map((violation) => {
                const RuleIcon = RULE_TYPE_ICONS[violation.rule_type];
                const severityBadge = SEVERITY_BADGES[violation.severity];
                const SeverityIcon = severityBadge.icon;

                return (
                  <Card key={violation.id} className="border-l-4" style={{
                    borderLeftColor: violation.severity === 'critical' 
                      ? 'rgb(239 68 68)' 
                      : violation.severity === 'error'
                      ? 'rgb(249 115 22)'
                      : 'rgb(234 179 8)'
                  }}>
                    <CardContent className="pt-6">
                      <div className="space-y-4">
                        {/* Header */}
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-3 flex-1">
                            <RuleIcon className="h-5 w-5 text-muted-foreground mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold">
                                  {RULE_TYPE_LABELS[violation.rule_type]}
                                </h4>
                                <Badge variant={severityBadge.variant}>
                                  <SeverityIcon className="h-3 w-3 mr-1" />
                                  {violation.severity}
                                </Badge>
                                {getStatusBadge(violation.status)}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {violation.violation_details.message}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Details */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground text-xs">Employee</p>
                            <p className="font-medium">{violation.employee?.name || 'Unknown'}</p>
                          </div>
                          {violation.shift && (
                            <div>
                              <p className="text-muted-foreground text-xs">Shift</p>
                              <p className="font-medium">
                                {format(new Date(violation.shift.start_time), 'MMM d, h:mm a')}
                              </p>
                            </div>
                          )}
                          <div>
                            <p className="text-muted-foreground text-xs">Position</p>
                            <p className="font-medium">{violation.shift?.position || violation.employee?.position}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground text-xs">Detected</p>
                            <p className="font-medium">{format(new Date(violation.created_at), 'MMM d, yyyy')}</p>
                          </div>
                        </div>

                        {/* Override Info */}
                        {violation.status === 'overridden' && violation.override_reason && (
                          <div className="p-3 bg-muted rounded-md">
                            <p className="text-xs text-muted-foreground mb-1">Override Reason:</p>
                            <p className="text-sm">{violation.override_reason}</p>
                            {violation.overridden_at && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Overridden on {format(new Date(violation.overridden_at), 'MMM d, yyyy h:mm a')}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Actions */}
                        {violation.status === 'active' && (
                          <div className="flex justify-end pt-2 border-t">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOverrideClick(violation)}
                            >
                              Override Violation
                            </Button>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Override Dialog */}
      <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override Compliance Violation</DialogTitle>
            <DialogDescription>
              Provide a reason for overriding this compliance violation. This will be recorded in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {selectedViolation && (
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm font-medium mb-1">
                  {RULE_TYPE_LABELS[selectedViolation.rule_type]} - {selectedViolation.employee?.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {selectedViolation.violation_details.message}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="overrideReason">Override Reason *</Label>
              <Textarea
                id="overrideReason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Explain why this violation is being overridden..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleOverrideSubmit}
              disabled={!overrideReason.trim() || overrideViolation.isPending}
            >
              Confirm Override
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
