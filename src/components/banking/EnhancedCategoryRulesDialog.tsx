import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Trash2, Plus, Settings2, Edit2, Save, X, Sparkles, Check, Split, AlertTriangle, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  useCategorizationRulesV2,
  useCreateRuleV2,
  useUpdateRuleV2,
  useDeleteRuleV2,
  useApplyRulesV2,
  type MatchType,
  type TransactionType,
  type AppliesTo,
  type CategorizationRule,
  type SplitCategory,
} from "@/hooks/useCategorizationRulesV2";
import { useSuppliers } from "@/hooks/useSuppliers";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { SearchableSupplierSelector } from "@/components/SearchableSupplierSelector";
import { SearchableAccountSelector } from "@/components/banking/SearchableAccountSelector";
import { SplitCategoryInput } from "@/components/banking/SplitCategoryInput";
import { Badge } from "@/components/ui/badge";
import { useAISuggestRules, type SuggestedRule } from "@/hooks/useAISuggestRules";

interface EnhancedCategoryRulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: 'bank' | 'pos';
  prefilledRule?: Partial<RuleFormData>;
}

interface RuleFormData {
  ruleName: string;
  appliesTo: AppliesTo;
  descriptionPattern: string;
  descriptionMatchType: MatchType;
  amountMin: string;
  amountMax: string;
  supplierId: string;
  transactionType: TransactionType;
  posCategory: string;
  itemNamePattern: string;
  itemNameMatchType: MatchType;
  categoryId: string;
  isSplitRule: boolean;
  splitCategories: SplitCategory[];
  splitType: 'percentage' | 'amount';
  priority: string;
  autoApply: boolean;
}

const emptyFormData: RuleFormData = {
  ruleName: '',
  appliesTo: 'bank_transactions',
  descriptionPattern: '',
  descriptionMatchType: 'contains',
  amountMin: '',
  amountMax: '',
  supplierId: '',
  transactionType: 'any',
  posCategory: '',
  itemNamePattern: '',
  itemNameMatchType: 'contains',
  categoryId: '',
  isSplitRule: false,
  splitCategories: [],
  splitType: 'percentage',
  priority: '0',
  autoApply: false,
};

export const EnhancedCategoryRulesDialog = ({
  open,
  onOpenChange,
  defaultTab = 'bank',
  prefilledRule
}: EnhancedCategoryRulesDialogProps) => {
  const { selectedRestaurant } = useRestaurantContext();
  const [activeTab, setActiveTab] = useState<'bank' | 'pos'>(defaultTab);
  const [showNewRule, setShowNewRule] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [formData, setFormData] = useState<RuleFormData>(emptyFormData);
  const [suggestedRules, setSuggestedRules] = useState<SuggestedRule[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const appliesTo: AppliesTo = activeTab === 'bank' ? 'bank_transactions' : 'pos_sales';

  const { data: rules, isLoading } = useCategorizationRulesV2(appliesTo);
  const { suppliers, createSupplier } = useSuppliers();
  const { accounts } = useChartOfAccounts(selectedRestaurant?.restaurant_id || null);
  const createRule = useCreateRuleV2();
  const updateRule = useUpdateRuleV2();
  const deleteRule = useDeleteRuleV2();
  const applyRules = useApplyRulesV2();
  const aiSuggestRules = useAISuggestRules();

  // Constants
  const RULE_NAME_MAX_LENGTH = 30;
  const FORM_SCROLL_DELAY_MS = 100;

  // Handle prefilled rule data
  useEffect(() => {
    if (open && prefilledRule) {
      // Set the tab based on the prefilled data
      if (prefilledRule.appliesTo) {
        setActiveTab(prefilledRule.appliesTo === 'pos_sales' ? 'pos' : 'bank');
      }
      // Merge prefilled data with empty form data
      setFormData({ ...emptyFormData, ...prefilledRule });
      setShowNewRule(true);
      // Scroll to form after a delay
      setTimeout(() => {
        const formElement = document.getElementById('rule-form');
        if (formElement) {
          formElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, FORM_SCROLL_DELAY_MS);
    }
  }, [open, prefilledRule]);

  const handleSupplierChange = async (value: string, isNew: boolean) => {
    if (isNew) {
      const newSupplier = await createSupplier({ name: value, is_active: true });
      if (newSupplier) {
        setFormData({ ...formData, supplierId: newSupplier.id });
      }
    } else {
      // Allow empty string to clear the supplier
      setFormData({ ...formData, supplierId: value });
    }
  };

  const handleCreateRule = async () => {
    if (!selectedRestaurant?.restaurant_id) {
      toast.error("No restaurant selected");
      return;
    }

    // Validate split rule or regular rule
    if (formData.isSplitRule) {
      if (formData.splitCategories.length < 2) {
        toast.error("Split rules must have at least 2 categories");
        return;
      }

      // Validate all splits have category_id
      if (formData.splitCategories.some(s => !s.category_id)) {
        toast.error("All splits must have a category selected");
        return;
      }

      // Validate percentages sum to 100 if using percentage
      if (formData.splitType === 'percentage') {
        const total = formData.splitCategories.reduce((sum, s) => sum + (s.percentage || 0), 0);
        if (Math.abs(total - 100) > 0.01) {
          toast.error(`Split percentages must sum to 100% (currently ${total.toFixed(2)}%)`);
          return;
        }
      }
    } else {
      // Regular rule validation
      if (!formData.categoryId) {
        toast.error("Please select a category");
        return;
      }
    }

    // Validate that at least one pattern is set
    const hasPattern = formData.descriptionPattern ||
                      formData.supplierId ||
                      formData.amountMin ||
                      formData.amountMax ||
                      formData.posCategory ||
                      formData.itemNamePattern;

    if (!hasPattern) {
      toast.error("Please specify at least one matching condition");
      return;
    }

    // Check for overly generic rules (safety check)
    const genericTerms = ['withdrawal', 'deposit', 'payment', 'transfer', 'debit', 'credit', 'ach', 'wire', 'check', 'atm'];
    const descPattern = formData.descriptionPattern?.trim().toLowerCase() || '';
    const isGenericPattern = descPattern && genericTerms.includes(descPattern);

    if (isGenericPattern) {
      // Generic pattern - check if we have other specificity
      const hasOtherSpecificity = formData.supplierId ||
                                  (formData.amountMin && parseFloat(formData.amountMin) > 0) ||
                                  (formData.amountMax && parseFloat(formData.amountMax) > 0);

      if (!hasOtherSpecificity) {
        toast.error(`"${formData.descriptionPattern}" is too generic. Add a supplier or amount range to make this rule more specific.`);
        return;
      }
    }

    // Warn if description pattern is very short (< 3 chars) without other criteria
    if (descPattern && descPattern.length < 3 && !formData.supplierId) {
      toast.error("Description pattern is too short. Use at least 3 characters or add a supplier.");
      return;
    }

    await createRule.mutateAsync({
      restaurantId: selectedRestaurant.restaurant_id,
      ruleName: formData.ruleName || 'Untitled Rule',
      appliesTo: formData.appliesTo,
      descriptionPattern: formData.descriptionPattern || undefined,
      descriptionMatchType: formData.descriptionPattern ? formData.descriptionMatchType : undefined,
      amountMin: formData.amountMin ? parseFloat(formData.amountMin) : undefined,
      amountMax: formData.amountMax ? parseFloat(formData.amountMax) : undefined,
      supplierId: formData.supplierId || undefined,
      transactionType: formData.transactionType !== 'any' ? formData.transactionType : undefined,
      posCategory: formData.posCategory || undefined,
      itemNamePattern: formData.itemNamePattern || undefined,
      itemNameMatchType: formData.itemNamePattern ? formData.itemNameMatchType : undefined,
      categoryId: formData.isSplitRule ? null : formData.categoryId, // null for split rules (not undefined)
      isSplitRule: formData.isSplitRule,
      splitCategories: formData.isSplitRule ? formData.splitCategories : undefined,
      priority: parseInt(formData.priority) || 0,
      autoApply: formData.autoApply,
    });

    setFormData(emptyFormData);
    setShowNewRule(false);
  };

  const handleEditRule = (rule: CategorizationRule) => {
    setEditingRuleId(rule.id);

    // Determine split type from split categories
    let splitType: 'percentage' | 'amount' = 'percentage';
    if (rule.split_categories && rule.split_categories.length > 0) {
      splitType = rule.split_categories[0].percentage !== undefined ? 'percentage' : 'amount';
    }

    setFormData({
      ruleName: rule.rule_name,
      appliesTo: rule.applies_to,
      descriptionPattern: rule.description_pattern || '',
      descriptionMatchType: rule.description_match_type || 'contains',
      amountMin: rule.amount_min?.toString() || '',
      amountMax: rule.amount_max?.toString() || '',
      supplierId: rule.supplier_id || '',
      transactionType: rule.transaction_type || 'any',
      posCategory: rule.pos_category || '',
      itemNamePattern: rule.item_name_pattern || '',
      itemNameMatchType: rule.item_name_match_type || 'contains',
      categoryId: rule.category_id || '',
      isSplitRule: rule.is_split_rule,
      splitCategories: rule.split_categories || [],
      splitType,
      priority: rule.priority.toString(),
      autoApply: rule.auto_apply,
    });
    setShowNewRule(true);

    // Scroll to the form smoothly after a short delay to ensure it's rendered
    setTimeout(() => {
      const formElement = document.getElementById('rule-form');
      if (formElement) {
        formElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, FORM_SCROLL_DELAY_MS);
  };

  const handleSaveEdit = async () => {
    if (!editingRuleId) return;

    // Validate split rule or regular rule
    if (formData.isSplitRule) {
      if (formData.splitCategories.length < 2) {
        toast.error("Split rules must have at least 2 categories");
        return;
      }

      if (formData.splitCategories.some(s => !s.category_id)) {
        toast.error("All splits must have a category selected");
        return;
      }

      if (formData.splitType === 'percentage') {
        const total = formData.splitCategories.reduce((sum, s) => sum + (s.percentage || 0), 0);
        if (Math.abs(total - 100) > 0.01) {
          toast.error(`Split percentages must sum to 100% (currently ${total.toFixed(2)}%)`);
          return;
        }
      }
    }

    await updateRule.mutateAsync({
      ruleId: editingRuleId,
      ruleName: formData.ruleName,
      descriptionPattern: formData.descriptionPattern || undefined,
      descriptionMatchType: formData.descriptionPattern ? formData.descriptionMatchType : undefined,
      amountMin: formData.amountMin ? parseFloat(formData.amountMin) : undefined,
      amountMax: formData.amountMax ? parseFloat(formData.amountMax) : undefined,
      supplierId: formData.supplierId || undefined,
      transactionType: formData.transactionType !== 'any' ? formData.transactionType : undefined,
      posCategory: formData.posCategory || undefined,
      itemNamePattern: formData.itemNamePattern || undefined,
      itemNameMatchType: formData.itemNamePattern ? formData.itemNameMatchType : undefined,
      categoryId: formData.isSplitRule ? null : formData.categoryId, // null for split rules (not undefined)
      isSplitRule: formData.isSplitRule,
      splitCategories: formData.isSplitRule ? formData.splitCategories : undefined,
      priority: parseInt(formData.priority) || 0,
      autoApply: formData.autoApply,
    });

    setFormData(emptyFormData);
    setShowNewRule(false);
    setEditingRuleId(null);
  };

  const handleCancelEdit = () => {
    setFormData(emptyFormData);
    setShowNewRule(false);
    setEditingRuleId(null);
  };

  const handleToggleAutoApply = async (ruleId: string, currentValue: boolean) => {
    await updateRule.mutateAsync({
      ruleId,
      autoApply: !currentValue,
    });
  };

  const handleToggleActive = async (ruleId: string, currentValue: boolean) => {
    await updateRule.mutateAsync({
      ruleId,
      isActive: !currentValue,
    });
  };

  const handleApplyRules = async () => {
    if (!selectedRestaurant?.restaurant_id) return;
    await applyRules.mutateAsync({
      restaurantId: selectedRestaurant.restaurant_id,
      applyTo: appliesTo
    });
  };

  const renderRuleConditions = (rule: CategorizationRule) => {
    const conditions: string[] = [];

    if (rule.supplier_id && rule.supplier) {
      conditions.push(`Supplier: ${rule.supplier.name}`);
    }
    if (rule.description_pattern) {
      conditions.push(`Description ${rule.description_match_type}: "${rule.description_pattern}"`);
    }
    if (rule.item_name_pattern) {
      conditions.push(`Item ${rule.item_name_match_type}: "${rule.item_name_pattern}"`);
    }
    if (rule.pos_category) {
      conditions.push(`POS Category: ${rule.pos_category}`);
    }
    if (rule.amount_min || rule.amount_max) {
      const min = rule.amount_min ? `$${rule.amount_min}` : '—';
      const max = rule.amount_max ? `$${rule.amount_max}` : '—';
      conditions.push(`Amount: ${min} to ${max}`);
    }
    if (rule.transaction_type && rule.transaction_type !== 'any') {
      conditions.push(`Type: ${rule.transaction_type}`);
    }

    return conditions.length > 0 ? conditions.join(' · ') : 'No conditions';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto p-0 gap-0 border-border/40">
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

        <div className="px-6 py-5">
          {/* Apple-style underline tabs */}
          <div className="flex items-center gap-0 border-b border-border/40 mb-6">
            <button
              onClick={() => setActiveTab('bank')}
              className={`relative px-0 py-3 mr-6 text-[14px] font-medium transition-colors ${
                activeTab === 'bank'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Bank Transactions
              {activeTab === 'bank' && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('pos')}
              className={`relative px-0 py-3 text-[14px] font-medium transition-colors ${
                activeTab === 'pos'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              POS Sales
              {activeTab === 'pos' && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
              )}
            </button>
          </div>

          <div className="space-y-5">
            {/* Action bar */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  {rules && rules.length > 0 ? 'Active Rules' : 'Rules'}
                </span>
                {rules && rules.length > 0 && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                    {rules.length}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (!selectedRestaurant?.restaurant_id) return;
                    aiSuggestRules.mutate(
                      {
                        restaurantId: selectedRestaurant.restaurant_id,
                        source: activeTab === 'bank' ? 'bank' : 'pos'
                      },
                      {
                        onSuccess: (data) => {
                          setSuggestedRules(data.rules);
                          setShowSuggestions(true);
                          toast.success(`Found ${data.rules.length} suggested rules`);
                        }
                      }
                    );
                  }}
                  disabled={aiSuggestRules.isPending}
                  className="h-8 px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg"
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  {aiSuggestRules.isPending ? 'Analyzing...' : 'AI Suggest'}
                </Button>
                {rules && rules.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleApplyRules}
                    disabled={applyRules.isPending}
                    className="h-8 px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg"
                  >
                    <Zap className="h-3.5 w-3.5 mr-1.5" />
                    {applyRules.isPending ? 'Applying...' : 'Apply to existing'}
                  </Button>
                )}
              </div>
            </div>

            {/* Existing Rules List */}
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-foreground/70" />
                <p className="mt-3 text-[13px] text-muted-foreground">Loading rules...</p>
              </div>
            ) : rules && rules.length > 0 ? (
              <div className="space-y-2">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className={`group flex items-start justify-between gap-4 p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors ${
                      !rule.is_active ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[14px] font-medium text-foreground">{rule.rule_name}</p>
                        {rule.is_split_rule && (
                          <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-medium">
                            <Split className="h-3 w-3" />
                            Split
                          </span>
                        )}
                        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                          Priority: {rule.priority}
                        </span>
                        {rule.apply_count > 0 && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                            {rule.apply_count}x applied
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-muted-foreground">
                        {renderRuleConditions(rule)}
                      </p>
                      <div className="flex items-center gap-2">
                        {rule.is_split_rule && rule.split_categories && rule.split_categories.length > 0 ? (
                          <p className="text-[13px] font-medium text-foreground">
                            → Split into {rule.split_categories.length} categories
                          </p>
                        ) : (
                          <p className="text-[13px] font-medium text-foreground">
                            → {rule.category?.account_code} · {rule.category?.account_name}
                          </p>
                        )}
                        {rule.category && !rule.category.is_active && !rule.is_split_rule && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive">
                            Inactive
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`active-${rule.id}`}
                            checked={rule.is_active}
                            onCheckedChange={() => handleToggleActive(rule.id, rule.is_active)}
                            disabled={updateRule.isPending}
                            className="data-[state=checked]:bg-foreground"
                          />
                          <Label htmlFor={`active-${rule.id}`} className="text-[11px] text-muted-foreground">
                            Active
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`auto-${rule.id}`}
                            checked={rule.auto_apply}
                            onCheckedChange={() => handleToggleAutoApply(rule.id, rule.auto_apply)}
                            disabled={updateRule.isPending}
                            className="data-[state=checked]:bg-foreground"
                          />
                          <Label htmlFor={`auto-${rule.id}`} className="text-[11px] text-muted-foreground">
                            Auto
                          </Label>
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleEditRule(rule)}
                        aria-label={`Edit rule: ${rule.rule_name}`}
                        className="h-8 w-8 rounded-lg hover:bg-muted/50"
                      >
                        <Edit2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteRule.mutate(rule.id)}
                        disabled={deleteRule.isPending}
                        aria-label={`Delete rule: ${rule.rule_name}`}
                        className="h-8 w-8 rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-destructive/10 focus-visible:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))}
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

            {/* AI Suggested Rules */}
            {showSuggestions && suggestedRules.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                      AI Suggestions
                    </span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      {suggestedRules.length}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowSuggestions(false)}
                    className="h-7 w-7 p-0 rounded-lg"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {suggestedRules.map((suggestion, idx) => (
                    <div
                      key={idx}
                      className="flex items-start justify-between gap-4 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5"
                    >
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[14px] font-medium text-foreground">{suggestion.rule_name}</p>
                          <span className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium ${
                            suggestion.confidence === 'high'
                              ? 'bg-green-500/10 text-green-700 dark:text-green-300'
                              : suggestion.confidence === 'medium'
                              ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {suggestion.confidence}
                          </span>
                          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                            {suggestion.historical_matches} matches
                          </span>
                          {!suggestion.category_id && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive">
                              Category not found
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-muted-foreground">{suggestion.reasoning}</p>
                        <p className="text-[13px] font-medium text-foreground">
                          → {suggestion.account_code} · {suggestion.category_name || 'Unknown'}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 shrink-0">
                        <Button
                          size="sm"
                          onClick={async () => {
                            if (!suggestion.category_id) {
                              toast.error(`Category "${suggestion.account_code}" not found`);
                              return;
                            }
                            try {
                              await createRule.mutateAsync({
                                restaurantId: selectedRestaurant?.restaurant_id || '',
                                ruleName: suggestion.rule_name,
                                appliesTo: suggestion.applies_to,
                                descriptionPattern: suggestion.description_pattern || undefined,
                                descriptionMatchType: suggestion.description_pattern ? (suggestion.description_match_type as MatchType) : undefined,
                                amountMin: suggestion.amount_min,
                                amountMax: suggestion.amount_max,
                                supplierId: undefined,
                                transactionType: suggestion.transaction_type as TransactionType | undefined,
                                posCategory: suggestion.pos_category || undefined,
                                itemNamePattern: suggestion.item_name_pattern || undefined,
                                itemNameMatchType: suggestion.item_name_pattern ? (suggestion.item_name_match_type as MatchType) : undefined,
                                categoryId: suggestion.category_id,
                                priority: suggestion.priority || 0,
                                autoApply: true,
                              });
                              setSuggestedRules(suggestedRules.filter((_, i) => i !== idx));
                              toast.success(`Rule created`);
                            } catch (error) {
                              toast.error(`Failed to create rule`);
                            }
                          }}
                          disabled={createRule.isPending || !suggestion.category_id}
                          className="h-8 px-3 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[12px] font-medium"
                        >
                          <Check className="h-3.5 w-3.5 mr-1" />
                          Use
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setSuggestedRules(suggestedRules.filter((_, i) => i !== idx));
                          }}
                          className="h-8 px-3 rounded-lg text-[12px] font-medium text-muted-foreground"
                          aria-label="Dismiss suggestion"
                        >
                          <X className="h-3.5 w-3.5 mr-1" />
                          Skip
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add/Edit Rule Form */}
            {!showNewRule ? (
              <Button
                variant="outline"
                className="w-full h-11 rounded-xl border-dashed border-border/60 text-[14px] font-medium text-muted-foreground hover:text-foreground hover:border-border hover:bg-muted/30"
                onClick={() => {
                  setFormData({ ...emptyFormData, appliesTo });
                  setShowNewRule(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add New Rule
              </Button>
            ) : (
              <div id="rule-form" className="rounded-xl border-2 border-primary/30 bg-muted/30 overflow-hidden">
                {/* Form header */}
                <div className="px-5 py-4 border-b border-border/40 bg-muted/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {editingRuleId ? (
                        <Edit2 className="h-4 w-4 text-primary" />
                      ) : (
                        <Plus className="h-4 w-4 text-primary" />
                      )}
                      <h3 className="text-[14px] font-semibold text-foreground">
                        {editingRuleId ? `Edit Rule: ${formData.ruleName}` : 'New Rule'}
                      </h3>
                    </div>
                    {editingRuleId && (
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-primary/10 text-primary font-medium">
                        Editing
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-5 space-y-5">
                  {/* Rule Name */}
                  <div className="space-y-2">
                    <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                      Rule Name
                    </Label>
                    <Input
                      placeholder="e.g., Food Supplier - Sysco"
                      value={formData.ruleName}
                      onChange={(e) => setFormData({ ...formData, ruleName: e.target.value })}
                      className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                    />
                  </div>

                  {/* Bank-specific fields */}
                  {activeTab === 'bank' && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Description Pattern
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            placeholder="e.g., Sysco, Amazon, etc."
                            value={formData.descriptionPattern}
                            onChange={(e) => setFormData({ ...formData, descriptionPattern: e.target.value })}
                            className="flex-1 h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                          />
                          <Select
                            value={formData.descriptionMatchType}
                            onValueChange={(value) => setFormData({ ...formData, descriptionMatchType: value as MatchType })}
                          >
                            <SelectTrigger className="w-[130px] h-10 text-[13px] bg-background border-border/40 rounded-lg">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="contains">Contains</SelectItem>
                              <SelectItem value="exact">Exact</SelectItem>
                              <SelectItem value="starts_with">Starts with</SelectItem>
                              <SelectItem value="ends_with">Ends with</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Warning for generic patterns */}
                        {(() => {
                          const genericTerms = ['withdrawal', 'deposit', 'payment', 'transfer', 'debit', 'credit', 'ach', 'wire', 'check', 'atm'];
                          const descPattern = formData.descriptionPattern?.trim().toLowerCase() || '';
                          const isGeneric = descPattern && genericTerms.includes(descPattern);
                          const isEmpty = !descPattern;
                          const hasOtherCriteria = formData.supplierId ||
                                                  (formData.amountMin && parseFloat(formData.amountMin) > 0) ||
                                                  (formData.amountMax && parseFloat(formData.amountMax) > 0);

                          if ((isEmpty || isGeneric) && !hasOtherCriteria) {
                            return (
                              <Alert className="mt-2 bg-amber-500/10 border-amber-500/20 rounded-lg">
                                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                <AlertDescription className="text-[12px] text-amber-700 dark:text-amber-300">
                                  {isEmpty
                                    ? "Add a pattern, supplier, or amount range to target specific transactions."
                                    : `"${formData.descriptionPattern}" is generic. Add more specificity.`
                                  }
                                </AlertDescription>
                              </Alert>
                            );
                          }
                          return null;
                        })()}
                      </div>

                      <div className="space-y-2">
                        <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Supplier <span className="font-normal">(Optional)</span>
                        </Label>
                        <SearchableSupplierSelector
                          value={formData.supplierId}
                          onValueChange={handleSupplierChange}
                          suppliers={suppliers || []}
                          showNewIndicator={true}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Transaction Type
                        </Label>
                        <Select
                          value={formData.transactionType}
                          onValueChange={(value) => setFormData({ ...formData, transactionType: value as TransactionType })}
                        >
                          <SelectTrigger className="h-10 text-[14px] bg-background border-border/40 rounded-lg">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="any">Any</SelectItem>
                            <SelectItem value="debit">Expense (Debit)</SelectItem>
                            <SelectItem value="credit">Income (Credit)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}

                  {/* POS-specific fields */}
                  {activeTab === 'pos' && (
                    <>
                      <div className="space-y-2">
                        <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Item Name Pattern
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            placeholder="e.g., Burger, Coffee, etc."
                            value={formData.itemNamePattern}
                            onChange={(e) => setFormData({ ...formData, itemNamePattern: e.target.value })}
                            className="flex-1 h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                          />
                          <Select
                            value={formData.itemNameMatchType}
                            onValueChange={(value) => setFormData({ ...formData, itemNameMatchType: value as MatchType })}
                          >
                            <SelectTrigger className="w-[130px] h-10 text-[13px] bg-background border-border/40 rounded-lg">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="contains">Contains</SelectItem>
                              <SelectItem value="exact">Exact</SelectItem>
                              <SelectItem value="starts_with">Starts with</SelectItem>
                              <SelectItem value="ends_with">Ends with</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          POS Category <span className="font-normal">(Optional)</span>
                        </Label>
                        <Input
                          placeholder="e.g., Beverages, Entrees"
                          value={formData.posCategory}
                          onChange={(e) => setFormData({ ...formData, posCategory: e.target.value })}
                          className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                        />
                      </div>
                    </>
                  )}

                  {/* Amount Range */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Min Amount <span className="font-normal">(Optional)</span>
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={formData.amountMin}
                        onChange={(e) => setFormData({ ...formData, amountMin: e.target.value })}
                        className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Max Amount <span className="font-normal">(Optional)</span>
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={formData.amountMax}
                        onChange={(e) => setFormData({ ...formData, amountMax: e.target.value })}
                        className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                      />
                    </div>
                  </div>

                  {/* Split Rule Toggle */}
                  <div className="flex items-center gap-3 py-3 px-4 rounded-lg bg-muted/50 border border-border/40">
                    <Switch
                      id="is-split-rule"
                      checked={formData.isSplitRule}
                      onCheckedChange={(checked) => {
                        setFormData({
                          ...formData,
                          isSplitRule: checked,
                          splitCategories: checked && formData.splitCategories.length === 0
                            ? [
                                { category_id: '', percentage: 50, description: '' },
                                { category_id: '', percentage: 50, description: '' }
                              ]
                            : formData.splitCategories
                        });
                      }}
                      className="data-[state=checked]:bg-foreground"
                    />
                    <div className="flex items-center gap-2">
                      <Split className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="is-split-rule" className="text-[13px] text-foreground font-medium cursor-pointer">
                        Split rule (categorize into multiple categories)
                      </Label>
                    </div>
                  </div>

                  {/* Category Selection */}
                  {formData.isSplitRule ? (
                    <div className="space-y-2">
                      <SplitCategoryInput
                        splits={formData.splitCategories}
                        onChange={(splits) => setFormData({ ...formData, splitCategories: splits })}
                        splitType={formData.splitType}
                        onSplitTypeChange={(type) => setFormData({ ...formData, splitType: type })}
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Target Category <span className="text-destructive">*</span>
                      </Label>
                      <SearchableAccountSelector
                        value={formData.categoryId}
                        onValueChange={(value) => setFormData({ ...formData, categoryId: value })}
                        placeholder="Select category..."
                      />
                    </div>
                  )}

                  {/* Priority and Auto-apply */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Priority <span className="font-normal">(higher = first)</span>
                      </Label>
                      <Input
                        type="number"
                        placeholder="0"
                        value={formData.priority}
                        onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                        className="h-10 text-[14px] bg-background border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                      />
                    </div>
                    <div className="flex items-end pb-2">
                      <div className="flex items-center gap-3">
                        <Switch
                          id="new-auto-apply"
                          checked={formData.autoApply}
                          onCheckedChange={(checked) => setFormData({ ...formData, autoApply: checked })}
                          className="data-[state=checked]:bg-foreground"
                        />
                        <Label htmlFor="new-auto-apply" className="text-[13px] text-foreground cursor-pointer">
                          Auto-apply to new records
                        </Label>
                      </div>
                    </div>
                  </div>

                  {/* Form Actions */}
                  <div className="flex gap-2 pt-4 border-t border-border/40">
                    {editingRuleId ? (
                      <>
                        <Button
                          onClick={handleSaveEdit}
                          disabled={
                            (formData.isSplitRule
                              ? formData.splitCategories.length < 2 || formData.splitCategories.some(s => !s.category_id)
                              : !formData.categoryId
                            ) || updateRule.isPending
                          }
                          className="h-10 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[14px] font-medium"
                        >
                          <Save className="h-4 w-4 mr-2" />
                          {updateRule.isPending ? 'Saving...' : 'Save Changes'}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={handleCancelEdit}
                          className="h-10 px-4 rounded-lg text-[14px] font-medium text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          onClick={handleCreateRule}
                          disabled={
                            (formData.isSplitRule
                              ? formData.splitCategories.length < 2 || formData.splitCategories.some(s => !s.category_id)
                              : !formData.categoryId
                            ) || createRule.isPending
                          }
                          className="h-10 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[14px] font-medium"
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          {createRule.isPending ? 'Creating...' : 'Create Rule'}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={handleCancelEdit}
                          className="h-10 px-4 rounded-lg text-[14px] font-medium text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
