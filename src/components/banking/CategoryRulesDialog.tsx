import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Trash2, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { useCategorizationRules, useCreateRule, useUpdateRule, useDeleteRule, useApplyRules } from "@/hooks/useCategorizationRules";
import { useSuppliers } from "@/hooks/useSuppliers";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { SearchableSupplierSelector } from "@/components/SearchableSupplierSelector";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CategoryRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CategoryRulesDialog({ open, onOpenChange }: CategoryRulesDialogProps) {
  const { selectedRestaurant } = useRestaurantContext();
  const { data: rules, isLoading } = useCategorizationRules();
  const { suppliers, createSupplier } = useSuppliers();
  const { accounts } = useChartOfAccounts(selectedRestaurant?.restaurant_id || null);
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const deleteRule = useDeleteRule();
  const applyRules = useApplyRules();

  const [showNewRule, setShowNewRule] = useState(false);
  const [newRule, setNewRule] = useState({
    supplierId: '',
    categoryId: '',
    autoApply: false,
  });

  const expenseAccounts = accounts?.filter(
    (acc) => acc.account_type === 'expense' || acc.account_type === 'cogs'
  );

  const handleSupplierChange = async (value: string, isNew: boolean) => {
    if (isNew) {
      const newSupplier = await createSupplier({ name: value, is_active: true });
      if (newSupplier) {
        setNewRule({ ...newRule, supplierId: newSupplier.id });
      }
    } else {
      setNewRule({ ...newRule, supplierId: value });
    }
  };

  const handleCreateRule = async () => {
    if (!selectedRestaurant?.restaurant_id || !newRule.supplierId || !newRule.categoryId) return;

    await createRule.mutateAsync({
      restaurantId: selectedRestaurant.restaurant_id,
      supplierId: newRule.supplierId,
      categoryId: newRule.categoryId,
      autoApply: newRule.autoApply,
    });

    setNewRule({ supplierId: '', categoryId: '', autoApply: false });
    setShowNewRule(false);
  };

  const handleToggleAutoApply = async (ruleId: string, currentValue: boolean) => {
    await updateRule.mutateAsync({
      ruleId,
      autoApply: !currentValue,
    });
  };

  const handleApplyRules = async () => {
    if (!selectedRestaurant?.restaurant_id) return;
    await applyRules.mutateAsync(selectedRestaurant.restaurant_id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Supplier Categorization Rules
          </DialogTitle>
          <DialogDescription>
            Set up automatic categorization rules for your suppliers. When enabled, transactions from these suppliers will be automatically categorized.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Existing Rules */}
          {isLoading ? (
            <div className="text-center py-4 text-muted-foreground">Loading rules...</div>
          ) : rules && rules.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Active Rules</h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleApplyRules}
                  disabled={applyRules.isPending}
                >
                  Apply Rules to Existing Transactions
                </Button>
              </div>
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-center justify-between p-3 border rounded-lg bg-card"
                >
                  <div className="flex-1">
                    <div className="font-medium">{rule.supplier?.name}</div>
                    <div className="text-sm text-muted-foreground">
                      → {rule.category?.account_code} - {rule.category?.account_name}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`auto-${rule.id}`} className="text-xs">
                        Auto-apply
                      </Label>
                      <Switch
                        id={`auto-${rule.id}`}
                        checked={rule.auto_apply}
                        onCheckedChange={() => handleToggleAutoApply(rule.id, rule.auto_apply)}
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteRule.mutate(rule.id)}
                      disabled={deleteRule.isPending}
                      aria-label={`Delete rule${rule.supplier?.name ? `: ${rule.supplier.name}` : ''}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No rules configured yet. Create your first rule below.
            </div>
          )}

          {/* Add New Rule */}
          {!showNewRule ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowNewRule(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add New Rule
            </Button>
          ) : (
            <div className="border rounded-lg p-4 space-y-4 bg-muted/50">
              <h3 className="text-sm font-medium">New Categorization Rule</h3>
              
              <div className="space-y-2">
                <Label>Supplier</Label>
                <SearchableSupplierSelector
                  value={newRule.supplierId}
                  onValueChange={handleSupplierChange}
                  suppliers={suppliers || []}
                  showNewIndicator={true}
                />
              </div>

              <div className="space-y-2">
                <Label>Default Category</Label>
                {!expenseAccounts || expenseAccounts.length === 0 ? (
                  <div className="text-sm text-muted-foreground p-3 border rounded-md bg-muted/50">
                    No expense categories available — please create an expense/COGS account first
                  </div>
                ) : (
                  <Select
                    value={newRule.categoryId}
                    onValueChange={(value) => setNewRule({ ...newRule, categoryId: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {expenseAccounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.account_code} - {account.account_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="new-auto-apply"
                  checked={newRule.autoApply}
                  onCheckedChange={(checked) => setNewRule({ ...newRule, autoApply: checked })}
                />
                <Label htmlFor="new-auto-apply" className="text-sm">
                  Automatically apply to new transactions
                </Label>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleCreateRule}
                  disabled={!newRule.supplierId || !newRule.categoryId || createRule.isPending}
                >
                  Create Rule
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowNewRule(false);
                    setNewRule({ supplierId: '', categoryId: '', autoApply: false });
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
