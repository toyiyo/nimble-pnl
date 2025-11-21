import { useState } from "react";
import { Plus, Trash2, Percent, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableAccountSelector } from "./SearchableAccountSelector";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SplitCategory } from "@/hooks/useCategorizationRulesV2";

interface SplitCategoryInputProps {
  splits: SplitCategory[];
  onChange: (splits: SplitCategory[]) => void;
  splitType: 'percentage' | 'amount';
  onSplitTypeChange: (type: 'percentage' | 'amount') => void;
}

export function SplitCategoryInput({ 
  splits, 
  onChange, 
  splitType,
  onSplitTypeChange 
}: SplitCategoryInputProps) {
  const [errors, setErrors] = useState<string[]>([]);

  const handleAddSplit = () => {
    const newSplit: SplitCategory = {
      category_id: '',
      ...(splitType === 'percentage' ? { percentage: 0 } : { amount: 0 }),
      description: '',
    };
    onChange([...splits, newSplit]);
  };

  const handleRemoveSplit = (index: number) => {
    onChange(splits.filter((_, i) => i !== index));
  };

  const handleUpdateSplit = (index: number, field: keyof SplitCategory, value: any) => {
    const updatedSplits = splits.map((split, i) => {
      if (i !== index) return split;
      return { ...split, [field]: value };
    });
    onChange(updatedSplits);
    validateSplits(updatedSplits);
  };

  const validateSplits = (splitsToValidate: SplitCategory[]) => {
    const newErrors: string[] = [];
    
    // Check if all splits have a category
    if (splitsToValidate.some(s => !s.category_id)) {
      newErrors.push("All splits must have a category selected");
    }

    if (splitType === 'percentage') {
      const total = splitsToValidate.reduce((sum, s) => sum + (s.percentage || 0), 0);
      if (Math.abs(total - 100) > 0.01) {
        newErrors.push(`Percentages must sum to 100% (currently ${total.toFixed(2)}%)`);
      }
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const totalPercentage = splitType === 'percentage' 
    ? splits.reduce((sum, s) => sum + (s.percentage || 0), 0)
    : 0;

  const totalAmount = splitType === 'amount'
    ? splits.reduce((sum, s) => sum + (s.amount || 0), 0)
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Split Configuration</Label>
        <div className="flex gap-2">
          <Select value={splitType} onValueChange={(v: 'percentage' | 'amount') => onSplitTypeChange(v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage">
                <div className="flex items-center gap-2">
                  <Percent className="h-4 w-4" />
                  By Percentage
                </div>
              </SelectItem>
              <SelectItem value="amount">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  By Amount
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Split Lines */}
      <div className="space-y-3">
        {splits.map((split, index) => (
          <div key={index} className="p-4 border rounded-lg space-y-3 bg-muted/50">
            <div className="flex items-start gap-3">
              <div className="flex-1 space-y-3">
                <div>
                  <Label className="text-sm">Category *</Label>
                  <SearchableAccountSelector
                    value={split.category_id}
                    onValueChange={(value) => handleUpdateSplit(index, 'category_id', value)}
                    placeholder="Select category"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-sm">
                      {splitType === 'percentage' ? 'Percentage (%)' : 'Amount ($)'}
                    </Label>
                    <Input
                      type="number"
                      step={splitType === 'percentage' ? '0.01' : '0.01'}
                      min="0"
                      max={splitType === 'percentage' ? '100' : undefined}
                      value={splitType === 'percentage' ? split.percentage || '' : split.amount || ''}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value) || 0;
                        handleUpdateSplit(
                          index, 
                          splitType === 'percentage' ? 'percentage' : 'amount',
                          value
                        );
                      }}
                      placeholder={splitType === 'percentage' ? '0.00' : '0.00'}
                    />
                  </div>

                  <div>
                    <Label className="text-sm">Description (optional)</Label>
                    <Input
                      type="text"
                      value={split.description || ''}
                      onChange={(e) => handleUpdateSplit(index, 'description', e.target.value)}
                      placeholder="e.g., Labor portion"
                    />
                  </div>
                </div>
              </div>

              {splits.length > 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveSplit(index)}
                  className="mt-6"
                  aria-label="Remove split"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Split Button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAddSplit}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add Split Category
      </Button>

      {/* Summary */}
      {splitType === 'percentage' && (
        <div className="flex items-center justify-between text-sm p-3 bg-muted rounded-lg">
          <span>Total Percentage:</span>
          <span className={`font-mono font-bold ${Math.abs(totalPercentage - 100) < 0.01 ? 'text-green-600' : 'text-destructive'}`}>
            {totalPercentage.toFixed(2)}%
          </span>
        </div>
      )}

      {splitType === 'amount' && totalAmount > 0 && (
        <div className="flex items-center justify-between text-sm p-3 bg-muted rounded-lg">
          <span>Total Amount:</span>
          <span className="font-mono font-bold">
            ${totalAmount.toFixed(2)}
          </span>
        </div>
      )}

      {/* Validation Errors */}
      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc list-inside space-y-1">
              {errors.map((error, i) => (
                <li key={i}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
