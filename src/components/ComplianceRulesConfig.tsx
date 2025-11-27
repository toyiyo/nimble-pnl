import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import {
  useComplianceRules,
  useUpdateComplianceRule,
  useDeleteComplianceRule,
} from '@/hooks/useCompliance';
import { ComplianceRuleDialog } from '@/components/ComplianceRuleDialog';
import {
  Shield,
  Plus,
  Edit,
  Trash2,
  Clock,
  Users,
  AlertTriangle,
  Hourglass,
} from 'lucide-react';
import { ComplianceRule, ComplianceRuleType } from '@/types/compliance';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const RULE_TYPE_ICONS: Record<ComplianceRuleType, React.ComponentType<{ className?: string }>> = {
  minor_restrictions: Users,
  clopening: Clock,
  rest_period: Hourglass,
  shift_length: Clock,
  overtime: AlertTriangle,
};

const RULE_TYPE_LABELS: Record<ComplianceRuleType, string> = {
  minor_restrictions: 'Minor Labor Restrictions',
  clopening: 'Clopening Prevention',
  rest_period: 'Rest Period Requirements',
  shift_length: 'Shift Length Limits',
  overtime: 'Overtime Regulations',
};

const RULE_TYPE_DESCRIPTIONS: Record<ComplianceRuleType, string> = {
  minor_restrictions: 'Age-based work hour restrictions and scheduling limits',
  clopening: 'Prevent closing then opening shifts with insufficient rest',
  rest_period: 'Enforce minimum rest periods between shifts',
  shift_length: 'Set minimum and maximum shift durations',
  overtime: 'Track and manage overtime thresholds',
};

export const ComplianceRulesConfig = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [selectedRule, setSelectedRule] = useState<ComplianceRule | undefined>();
  const [ruleToDelete, setRuleToDelete] = useState<ComplianceRule | null>(null);

  const { rules, loading } = useComplianceRules(restaurantId);
  const updateRule = useUpdateComplianceRule();
  const deleteRule = useDeleteComplianceRule();

  const handleToggleRule = (rule: ComplianceRule) => {
    updateRule.mutate({
      id: rule.id,
      enabled: !rule.enabled,
    });
  };

  const handleEditRule = (rule: ComplianceRule) => {
    setSelectedRule(rule);
    setRuleDialogOpen(true);
  };

  const handleAddRule = () => {
    setSelectedRule(undefined);
    setRuleDialogOpen(true);
  };

  const handleDeleteRule = (rule: ComplianceRule) => {
    setRuleToDelete(rule);
  };

  const confirmDeleteRule = () => {
    if (ruleToDelete && restaurantId) {
      deleteRule.mutate(
        { id: ruleToDelete.id, restaurantId },
        {
          onSuccess: () => {
            setRuleToDelete(null);
          },
        }
      );
    }
  };

  const getRuleDescription = (rule: ComplianceRule): string => {
    const config = rule.rule_config as Record<string, unknown>;
    
    switch (rule.rule_type) {
      case 'minor_restrictions':
        return `Max ${config.max_hours_per_day}h/day, ${config.max_hours_per_week}h/week for minors`;
      case 'clopening':
        return `Minimum ${config.min_hours_between_shifts}h between close and open`;
      case 'rest_period':
        return `Minimum ${config.min_hours_between_shifts}h rest between shifts`;
      case 'shift_length':
        return `Shift length: ${config.min_hours}h - ${config.max_hours}h`;
      case 'overtime':
        return `Weekly threshold: ${config.weekly_threshold}h${config.daily_threshold ? `, Daily: ${config.daily_threshold}h` : ''}`;
      default:
        return 'Custom rule configuration';
    }
  };

  if (!restaurantId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Please select a restaurant to configure compliance rules.</p>
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
                <Shield className="h-6 w-6 text-primary transition-transform duration-300 group-hover:scale-110" />
              </div>
              <div>
                <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                  Compliance Rules
                </CardTitle>
                <CardDescription>Configure labor law compliance rules for your restaurant</CardDescription>
              </div>
            </div>
            <Button onClick={handleAddRule}>
              <Plus className="h-4 w-4 mr-2" />
              Add Rule
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Rules List */}
      <div className="grid gap-4 md:grid-cols-2">
        {loading ? (
          <>
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </>
        ) : rules.length === 0 ? (
          <Card className="col-span-2 bg-gradient-to-br from-muted/50 to-transparent">
            <CardContent className="py-12 text-center">
              <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No compliance rules configured</h3>
              <p className="text-muted-foreground mb-4">
                Add compliance rules to ensure your schedules meet labor law requirements.
              </p>
              <Button onClick={handleAddRule}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First Rule
              </Button>
            </CardContent>
          </Card>
        ) : (
          rules.map((rule) => {
            const IconComponent = RULE_TYPE_ICONS[rule.rule_type];
            return (
              <Card key={rule.id} className="group hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={`p-2 rounded-lg ${rule.enabled ? 'bg-primary/10' : 'bg-muted'}`}>
                        <IconComponent className={`h-5 w-5 ${rule.enabled ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <CardTitle className="text-base">{RULE_TYPE_LABELS[rule.rule_type]}</CardTitle>
                          {!rule.enabled && (
                            <Badge variant="outline" className="text-xs">
                              Disabled
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="text-sm">
                          {RULE_TYPE_DESCRIPTIONS[rule.rule_type]}
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">{getRuleDescription(rule)}</p>
                    
                    <div className="flex items-center justify-between pt-2 border-t">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id={`rule-${rule.id}`}
                          checked={rule.enabled}
                          onCheckedChange={() => handleToggleRule(rule)}
                          aria-label={`Toggle ${RULE_TYPE_LABELS[rule.rule_type]}`}
                        />
                        <Label htmlFor={`rule-${rule.id}`} className="text-sm cursor-pointer">
                          {rule.enabled ? 'Enabled' : 'Disabled'}
                        </Label>
                      </div>
                      
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleEditRule(rule)}
                          aria-label="Edit rule"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleDeleteRule(rule)}
                          aria-label="Delete rule"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Dialogs */}
      {restaurantId && (
        <ComplianceRuleDialog
          open={ruleDialogOpen}
          onOpenChange={setRuleDialogOpen}
          rule={selectedRule}
          restaurantId={restaurantId}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!ruleToDelete} onOpenChange={() => setRuleToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Compliance Rule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this compliance rule? This action cannot be undone.
              Existing violations will remain in the history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteRule}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
