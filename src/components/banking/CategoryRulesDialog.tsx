import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Trash2, Plus, Settings2, Zap } from "lucide-react";
import { useCategorizationRules, useCreateRule, useUpdateRule, useDeleteRule, useApplyRules } from "@/hooks/useCategorizationRules";
import { useSuppliers } from "@/hooks/useSuppliers";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { SearchableSupplierSelector } from "@/components/SearchableSupplierSelector";
import { SearchableAccountSelector } from "@/components/banking/SearchableAccountSelector";

interface CategoryRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const CategoryRulesDialog = ({ open, onOpenChange }: CategoryRulesDialogProps) => {
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
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        {/* Apple-style header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Settings2 className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Categorization Rules
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Set up automatic categorization rules for bank transactions and POS sales.
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {/* Existing Rules */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-foreground/70" />
              <p className="mt-3 text-[13px] text-muted-foreground">Loading rules...</p>
            </div>
          ) : rules && rules.length > 0 ? (
            <div className="space-y-4">
              {/* Section header with action */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Active Rules</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                    {rules.length}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleApplyRules}
                  disabled={applyRules.isPending}
                  className="h-8 px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg"
                >
                  <Zap className="h-3.5 w-3.5 mr-1.5" />
                  {applyRules.isPending ? "Applying..." : "Apply to existing"}
                </Button>
              </div>

              {/* Rules list - clean card style */}
              <div className="space-y-2">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="group flex items-center justify-between p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium text-foreground truncate">
                        {rule.supplier?.name}
                      </p>
                      <p className="text-[13px] text-muted-foreground mt-0.5">
                        → {rule.category?.account_code} · {rule.category?.account_name}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 ml-4">
                      <div className="flex items-center gap-2">
                        <Switch
                          id={`auto-${rule.id}`}
                          checked={rule.auto_apply}
                          onCheckedChange={() => handleToggleAutoApply(rule.id, rule.auto_apply)}
                          className="data-[state=checked]:bg-foreground"
                        />
                        <Label htmlFor={`auto-${rule.id}`} className="text-[12px] text-muted-foreground">
                          Auto
                        </Label>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteRule.mutate(rule.id)}
                        disabled={deleteRule.isPending}
                        aria-label={`Delete rule${rule.supplier?.name ? `: ${rule.supplier.name}` : ''}`}
                        className="h-8 w-8 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <Settings2 className="h-6 w-6 text-muted-foreground/50" />
              </div>
              <p className="text-[15px] font-medium text-foreground mb-1">No rules yet</p>
              <p className="text-[13px] text-muted-foreground">Create your first categorization rule below.</p>
            </div>
          )}

          {/* Add New Rule */}
          {!showNewRule ? (
            <Button
              variant="outline"
              className="w-full h-11 rounded-xl border-dashed border-border/60 text-[14px] font-medium text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/30"
              onClick={() => setShowNewRule(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add New Rule
            </Button>
          ) : (
            <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
              {/* New rule header */}
              <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                <h3 className="text-[13px] font-semibold text-foreground">New Rule</h3>
              </div>

              <div className="p-4 space-y-4">
                <div className="space-y-2">
                  <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Supplier
                  </Label>
                  <SearchableSupplierSelector
                    value={newRule.supplierId}
                    onValueChange={handleSupplierChange}
                    suppliers={suppliers || []}
                    showNewIndicator={true}
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Default Category
                  </Label>
                  <SearchableAccountSelector
                    value={newRule.categoryId}
                    onValueChange={(value) => setNewRule({ ...newRule, categoryId: value })}
                    placeholder="Select expense category..."
                    filterByTypes={['expense', 'cogs']}
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <Switch
                    id="new-auto-apply"
                    checked={newRule.autoApply}
                    onCheckedChange={(checked) => setNewRule({ ...newRule, autoApply: checked })}
                    className="data-[state=checked]:bg-foreground"
                  />
                  <Label htmlFor="new-auto-apply" className="text-[13px] text-foreground">
                    Automatically apply to new transactions
                  </Label>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleCreateRule}
                    disabled={!newRule.supplierId || !newRule.categoryId || createRule.isPending}
                    className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
                  >
                    {createRule.isPending ? "Creating..." : "Create Rule"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setShowNewRule(false);
                      setNewRule({ supplierId: '', categoryId: '', autoApply: false });
                    }}
                    className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
