import { useState } from "react";
import { Plus, Sparkles, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCategorizationRules, useDeleteRule, useUpdateRule } from "@/hooks/useCategorizationRules";
import { CreateRuleDialog } from "./CreateRuleDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

interface CategoryRulesDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CategoryRulesDialog({ isOpen, onClose }: CategoryRulesDialogProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const { data: rules, isLoading } = useCategorizationRules();
  const deleteRule = useDeleteRule();
  const updateRule = useUpdateRule();

  const getMatchTypeLabel = (type: string) => {
    switch (type) {
      case 'payee_exact': return 'Payee (Exact)';
      case 'payee_contains': return 'Payee (Contains)';
      case 'description_contains': return 'Description';
      case 'amount_exact': return 'Amount (Exact)';
      case 'amount_range': return 'Amount (Range)';
      default: return type;
    }
  };

  const handleToggleActive = async (rule: any) => {
    await updateRule.mutateAsync({
      id: rule.id,
      is_active: !rule.is_active,
    });
  };

  const handleToggleAutoApply = async (rule: any) => {
    await updateRule.mutateAsync({
      id: rule.id,
      auto_apply: !rule.auto_apply,
    });
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>Categorization Rules</DialogTitle>
                <DialogDescription>
                  Manage automatic categorization rules for bank transactions
                </DialogDescription>
              </div>
              <Button onClick={() => setShowCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New Rule
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-4">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading rules...
              </div>
            ) : rules && rules.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rule Name</TableHead>
                    <TableHead>Match Type</TableHead>
                    <TableHead>Match Value</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {rule.rule_name.startsWith('Auto:') && (
                            <Sparkles className="h-3 w-3 text-primary" />
                          )}
                          {rule.rule_name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{getMatchTypeLabel(rule.match_type)}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {rule.match_value}
                        {rule.amount_min !== null && ` ($${rule.amount_min}${rule.amount_max ? `-$${rule.amount_max}` : ''})`}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{rule.priority}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div>{rule.usage_count}x used</div>
                          {rule.last_used_at && (
                            <div className="text-xs text-muted-foreground">
                              Last: {format(new Date(rule.last_used_at), 'MMM d')}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          {rule.is_active ? (
                            <Badge variant="default">Active</Badge>
                          ) : (
                            <Badge variant="secondary">Inactive</Badge>
                          )}
                          {rule.auto_apply && (
                            <Badge variant="outline" className="text-xs">
                              <Sparkles className="h-2 w-2 mr-1" />
                              Auto
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleActive(rule)}
                            disabled={updateRule.isPending}
                          >
                            {rule.is_active ? (
                              <ToggleRight className="h-4 w-4" />
                            ) : (
                              <ToggleLeft className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleAutoApply(rule)}
                            disabled={updateRule.isPending}
                            title="Toggle auto-apply"
                          >
                            <Sparkles className={`h-4 w-4 ${rule.auto_apply ? 'text-primary' : 'text-muted-foreground'}`} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteRule.mutate(rule.id)}
                            disabled={deleteRule.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg">No rules yet</p>
                <p className="text-sm mt-2">
                  Rules are automatically created as you categorize transactions
                </p>
                <Button onClick={() => setShowCreateDialog(true)} className="mt-4">
                  <Plus className="h-4 w-4 mr-2" />
                  Create First Rule
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <CreateRuleDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />
    </>
  );
}
