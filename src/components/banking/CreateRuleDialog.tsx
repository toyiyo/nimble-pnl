import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCreateRule } from "@/hooks/useCategorizationRules";
import { SearchableAccountSelector } from "./SearchableAccountSelector";
import { useRestaurantContext } from "@/contexts/RestaurantContext";

interface CreateRuleDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface RuleFormData {
  rule_name: string;
  match_type: string;
  match_value: string;
  amount_min?: number;
  amount_max?: number;
  category_id: string;
  priority: number;
  auto_apply: boolean;
}

export function CreateRuleDialog({ isOpen, onClose }: CreateRuleDialogProps) {
  const { selectedRestaurant } = useRestaurantContext();
  const [matchType, setMatchType] = useState<string>('payee_contains');
  const [categoryId, setCategoryId] = useState<string>('');
  const [autoApply, setAutoApply] = useState(false);
  
  const { register, handleSubmit, reset, formState: { errors } } = useForm<RuleFormData>();
  const createRule = useCreateRule();

  const onSubmit = async (data: RuleFormData) => {
    if (!selectedRestaurant?.restaurant_id) return;

    await createRule.mutateAsync({
      ...data,
      restaurant_id: selectedRestaurant.restaurant_id,
      match_type: matchType as any,
      category_id: categoryId,
      auto_apply: autoApply,
      amount_min: matchType.includes('amount') ? data.amount_min : undefined,
      amount_max: matchType === 'amount_range' ? data.amount_max : undefined,
    });

    reset();
    onClose();
  };

  const showAmountFields = matchType.includes('amount');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Categorization Rule</DialogTitle>
          <DialogDescription>
            Define a new rule to automatically categorize transactions
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rule_name">Rule Name</Label>
            <Input
              id="rule_name"
              {...register('rule_name', { required: true })}
              placeholder="e.g., Amazon Purchases"
            />
            {errors.rule_name && (
              <p className="text-sm text-destructive">Rule name is required</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="match_type">Match Type</Label>
            <Select value={matchType} onValueChange={setMatchType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="payee_exact">Payee (Exact Match)</SelectItem>
                <SelectItem value="payee_contains">Payee (Contains)</SelectItem>
                <SelectItem value="description_contains">Description (Contains)</SelectItem>
                <SelectItem value="amount_exact">Amount (Exact)</SelectItem>
                <SelectItem value="amount_range">Amount (Range)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!showAmountFields && (
            <div className="space-y-2">
              <Label htmlFor="match_value">Match Value</Label>
              <Input
                id="match_value"
                {...register('match_value', { required: !showAmountFields })}
                placeholder="e.g., Amazon or AWS"
              />
              {errors.match_value && (
                <p className="text-sm text-destructive">Match value is required</p>
              )}
            </div>
          )}

          {showAmountFields && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="amount_min">
                  {matchType === 'amount_exact' ? 'Amount' : 'Min Amount'}
                </Label>
                <Input
                  id="amount_min"
                  type="number"
                  step="0.01"
                  {...register('amount_min', { required: showAmountFields, valueAsNumber: true })}
                  placeholder="0.00"
                />
              </div>
              {matchType === 'amount_range' && (
                <div className="space-y-2">
                  <Label htmlFor="amount_max">Max Amount</Label>
                  <Input
                    id="amount_max"
                    type="number"
                    step="0.01"
                    {...register('amount_max', { valueAsNumber: true })}
                    placeholder="0.00"
                  />
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>Category</Label>
            <SearchableAccountSelector
              value={categoryId}
              onValueChange={setCategoryId}
              placeholder="Select category"
            />
            {!categoryId && (
              <p className="text-sm text-destructive">Category is required</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="priority">Priority (0-100)</Label>
            <Input
              id="priority"
              type="number"
              {...register('priority', { required: true, valueAsNumber: true, min: 0, max: 100 })}
              defaultValue={10}
            />
            <p className="text-xs text-muted-foreground">
              Higher priority rules are matched first
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto_apply">Auto-apply</Label>
              <p className="text-xs text-muted-foreground">
                Automatically categorize matching transactions
              </p>
            </div>
            <Switch
              id="auto_apply"
              checked={autoApply}
              onCheckedChange={setAutoApply}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              className="flex-1"
              disabled={createRule.isPending || !categoryId}
            >
              Create Rule
            </Button>
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
