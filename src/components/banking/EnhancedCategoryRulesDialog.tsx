import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Trash2, Plus, Settings2, Edit2, Save, X, Sparkles, Check, Split, AlertTriangle } from "lucide-react";
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
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
    
    return conditions.length > 0 ? conditions.join(' • ') : 'No conditions';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Categorization Rules
          </DialogTitle>
          <DialogDescription>
            Set up automatic categorization rules for bank transactions and POS sales. Rules can match on patterns, amounts, suppliers, and more.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'bank' | 'pos')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="bank">Bank Transactions</TabsTrigger>
            <TabsTrigger value="pos">POS Sales</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="space-y-4 mt-4">
            {/* Action Buttons - Always visible */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-sm font-medium">
                {rules && rules.length > 0 ? 'Active Rules' : 'Categorization Rules'}
              </h3>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
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
                          toast.success(`Found ${data.rules.length} suggested rules based on ${data.total_analyzed} categorized ${activeTab === 'bank' ? 'transactions' : 'sales'}`);
                        }
                      }
                    );
                  }}
                  disabled={aiSuggestRules.isPending}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  {aiSuggestRules.isPending ? 'Analyzing...' : 'AI Suggest Rules'}
                </Button>
                {rules && rules.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleApplyRules}
                    disabled={applyRules.isPending}
                  >
                    Apply Rules to Existing Records
                  </Button>
                )}
              </div>
            </div>

            {/* Existing Rules */}
            {isLoading ? (
              <div className="text-center py-4 text-muted-foreground">Loading rules...</div>
            ) : rules && rules.length > 0 ? (
              <div className="space-y-2">
                {rules.map((rule) => (
                  <Card
                    key={rule.id}
                    className={`${!rule.is_active ? 'opacity-60' : ''}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="font-medium">{rule.rule_name}</div>
                            {rule.is_split_rule && (
                              <Badge variant="default" className="text-xs bg-gradient-to-r from-primary to-accent">
                                <Split className="h-3 w-3 mr-1" />
                                Split Rule
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-xs">
                              Priority: {rule.priority}
                            </Badge>
                            {rule.apply_count > 0 && (
                              <Badge variant="secondary" className="text-xs">
                                Applied {rule.apply_count}x
                              </Badge>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {renderRuleConditions(rule)}
                          </div>
                          <div className="flex items-center gap-2">
                            {rule.is_split_rule && rule.split_categories && rule.split_categories.length > 0 ? (
                              <div className="text-sm font-medium text-primary">
                                → Split into {rule.split_categories.length} categories
                              </div>
                            ) : (
                              <div className="text-sm font-medium text-primary">
                                → {rule.category?.account_code} - {rule.category?.account_name}
                              </div>
                            )}
                            {rule.category && !rule.category.is_active && !rule.is_split_rule && (
                              <Badge variant="destructive" className="text-xs">
                                Inactive Category
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                              <Label htmlFor={`active-${rule.id}`} className="text-xs">
                                Active
                              </Label>
                              <Switch
                                id={`active-${rule.id}`}
                                checked={rule.is_active}
                                onCheckedChange={() => handleToggleActive(rule.id, rule.is_active)}
                                disabled={updateRule.isPending}
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <Label htmlFor={`auto-${rule.id}`} className="text-xs">
                                Auto-apply
                              </Label>
                              <Switch
                                id={`auto-${rule.id}`}
                                checked={rule.auto_apply}
                                onCheckedChange={() => handleToggleAutoApply(rule.id, rule.auto_apply)}
                                disabled={updateRule.isPending}
                              />
                            </div>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleEditRule(rule)}
                            aria-label={`Edit rule: ${rule.rule_name}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteRule.mutate(rule.id)}
                            disabled={deleteRule.isPending}
                            aria-label={`Delete rule: ${rule.rule_name}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No rules configured yet. Create your first rule below.
              </div>
            )}

            {/* AI Suggested Rules */}
            {showSuggestions && suggestedRules.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    AI Suggested Rules ({suggestedRules.length})
                  </h3>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowSuggestions(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {suggestedRules.map((suggestion, idx) => (
                    <Card key={idx} className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2">
                              <div className="font-medium">{suggestion.rule_name}</div>
                              <Badge 
                                variant={
                                  suggestion.confidence === 'high' ? 'default' :
                                  suggestion.confidence === 'medium' ? 'secondary' : 
                                  'outline'
                                }
                                className="text-xs"
                              >
                                {suggestion.confidence} confidence
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                {suggestion.historical_matches} matches
                              </Badge>
                              {!suggestion.category_id && (
                                <Badge variant="destructive" className="text-xs">
                                  Category not found
                                </Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {suggestion.reasoning}
                            </div>
                            <div className="text-sm font-medium text-primary">
                              → {suggestion.account_code} - {suggestion.category_name || 'Unknown'}
                            </div>
                          </div>
                          <div className="flex flex-col gap-2">
                            <Button
                              size="sm"
                              onClick={async () => {
                                // Directly create the rule from AI suggestion
                                if (!suggestion.category_id) {
                                  toast.error(`Cannot create rule: Category "${suggestion.account_code}" not found in chart of accounts`);
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
                                    autoApply: true, // Default to enabled for AI suggestions
                                  });
                                  
                                  // Remove this suggestion from the list after successful creation
                                  setSuggestedRules(suggestedRules.filter((_, i) => i !== idx));
                                  toast.success(`Rule "${suggestion.rule_name}" created successfully`);
                                } catch (error) {
                                  toast.error(`Failed to create rule: ${error instanceof Error ? error.message : 'Unknown error'}`);
                                }
                              }}
                              disabled={createRule.isPending || !suggestion.category_id}
                            >
                              <Check className="h-4 w-4 mr-2" />
                              Use This Rule
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                // Remove this suggestion from the list
                                setSuggestedRules(suggestedRules.filter((_, i) => i !== idx));
                                toast.success('Suggestion dismissed');
                              }}
                              aria-label="Dismiss suggestion"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Add/Edit Rule Form */}
            {!showNewRule ? (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setFormData({ ...emptyFormData, appliesTo });
                  setShowNewRule(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add New Rule
              </Button>
            ) : (
              <Card id="rule-form" className="bg-muted/50 border-2 border-primary/50 shadow-lg">
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      {editingRuleId ? (
                        <>
                          <Edit2 className="h-4 w-4 text-primary" />
                          Edit Rule: {formData.ruleName}
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4 text-primary" />
                          New Categorization Rule
                        </>
                      )}
                    </h3>
                    {editingRuleId && (
                      <Badge variant="outline" className="text-xs">
                        Editing
                      </Badge>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <Label>Rule Name</Label>
                      <Input
                        placeholder="e.g., Food Supplier - Sysco"
                        value={formData.ruleName}
                        onChange={(e) => setFormData({ ...formData, ruleName: e.target.value })}
                      />
                    </div>

                    {activeTab === 'bank' && (
                      <>
                        <div className="col-span-2">
                          <Label>Description Pattern</Label>
                          <div className="flex gap-2">
                            <Input
                              placeholder="e.g., Sysco, Amazon, etc."
                              value={formData.descriptionPattern}
                              onChange={(e) => setFormData({ ...formData, descriptionPattern: e.target.value })}
                              className="flex-1"
                            />
                            <Select
                              value={formData.descriptionMatchType}
                              onValueChange={(value) => setFormData({ ...formData, descriptionMatchType: value as MatchType })}
                            >
                              <SelectTrigger className="w-[140px]">
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
                          
                          {/* Warning for generic or missing patterns */}
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
                                <Alert variant="warning" className="mt-2">
                                  <AlertTriangle className="h-4 w-4" />
                                  <AlertDescription>
                                    {isEmpty ? (
                                      <>Add a specific description pattern, supplier, or amount range to avoid matching too many transactions.</>
                                    ) : (
                                      <>"{formData.descriptionPattern}" is too generic. Add a supplier or amount range to make this rule more specific.</>
                                    )}
                                  </AlertDescription>
                                </Alert>
                              );
                            }
                            return null;
                          })()}
                        </div>

                        <div className="col-span-2">
                          <Label>Supplier (Optional)</Label>
                          <SearchableSupplierSelector
                            value={formData.supplierId}
                            onValueChange={handleSupplierChange}
                            suppliers={suppliers || []}
                            showNewIndicator={true}
                          />
                        </div>

                        <div>
                          <Label>Transaction Type</Label>
                          <Select
                            value={formData.transactionType}
                            onValueChange={(value) => setFormData({ ...formData, transactionType: value as TransactionType })}
                          >
                            <SelectTrigger>
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

                    {activeTab === 'pos' && (
                      <>
                        <div className="col-span-2">
                          <Label>Item Name Pattern</Label>
                          <div className="flex gap-2">
                            <Input
                              placeholder="e.g., Burger, Coffee, etc."
                              value={formData.itemNamePattern}
                              onChange={(e) => setFormData({ ...formData, itemNamePattern: e.target.value })}
                              className="flex-1"
                            />
                            <Select
                              value={formData.itemNameMatchType}
                              onValueChange={(value) => setFormData({ ...formData, itemNameMatchType: value as MatchType })}
                            >
                              <SelectTrigger className="w-[140px]">
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

                        <div className="col-span-2">
                          <Label>POS Category (Optional)</Label>
                          <Input
                            placeholder="e.g., Beverages, Entrees"
                            value={formData.posCategory}
                            onChange={(e) => setFormData({ ...formData, posCategory: e.target.value })}
                          />
                        </div>
                      </>
                    )}

                    <div>
                      <Label>Min Amount (Optional)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={formData.amountMin}
                        onChange={(e) => setFormData({ ...formData, amountMin: e.target.value })}
                      />
                    </div>

                    <div>
                      <Label>Max Amount (Optional)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={formData.amountMax}
                        onChange={(e) => setFormData({ ...formData, amountMax: e.target.value })}
                      />
                    </div>

                    <div className="col-span-2">
                      <div className="flex items-center gap-2 mb-3">
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
                        />
                        <Label htmlFor="is-split-rule" className="text-sm">
                          Split rule (categorize into multiple categories)
                        </Label>
                      </div>
                    </div>

                    {formData.isSplitRule ? (
                      <div className="col-span-2">
                        <SplitCategoryInput
                          splits={formData.splitCategories}
                          onChange={(splits) => setFormData({ ...formData, splitCategories: splits })}
                          splitType={formData.splitType}
                          onSplitTypeChange={(type) => setFormData({ ...formData, splitType: type })}
                        />
                      </div>
                    ) : (
                      <div className="col-span-2">
                        <Label>Target Category *</Label>
                        <SearchableAccountSelector
                          value={formData.categoryId}
                          onValueChange={(value) => setFormData({ ...formData, categoryId: value })}
                          placeholder="Select category..."
                        />
                      </div>
                    )}

                    <div>
                      <Label>Priority (higher = first)</Label>
                      <Input
                        type="number"
                        placeholder="0"
                        value={formData.priority}
                        onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Switch
                        id="new-auto-apply"
                        checked={formData.autoApply}
                        onCheckedChange={(checked) => setFormData({ ...formData, autoApply: checked })}
                      />
                      <Label htmlFor="new-auto-apply" className="text-sm">
                        Auto-apply to new records
                      </Label>
                    </div>
                  </div>

                  <div className="flex gap-2">
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
                        >
                          <Save className="h-4 w-4 mr-2" />
                          Save Changes
                        </Button>
                        <Button variant="outline" onClick={handleCancelEdit}>
                          <X className="h-4 w-4 mr-2" />
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
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Create Rule
                        </Button>
                        <Button variant="outline" onClick={handleCancelEdit}>
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
