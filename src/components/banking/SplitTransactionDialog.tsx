import { useState, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { Plus, Trash2, AlertCircle, RotateCcw } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { BankTransaction, useSplitTransaction, useRevertBankTransactionSplit, useUpdateBankTransactionSplit, useBankTransactionSplits } from "@/hooks/useBankTransactions";
import { SearchableAccountSelector } from "./SearchableAccountSelector";
import { SplitFormData } from "@/hooks/useSplitTransactionHelpers";

interface SplitTransactionDialogProps {
  transaction: BankTransaction;
  isOpen: boolean;
  onClose: () => void;
}

export function SplitTransactionDialog({
  transaction,
  isOpen,
  onClose,
}: SplitTransactionDialogProps) {
  const isEditMode = transaction.is_split;
  const { data: existingSplits, isLoading: splitsLoading } = useBankTransactionSplits(
    isEditMode && isOpen ? transaction.id : null
  );

  const { register, control, handleSubmit, watch, reset, formState: { errors } } = useForm<SplitFormData>({
    defaultValues: {
      splits: [
        { category_id: '', amount: 0, description: '' },
        { category_id: '', amount: 0, description: '' },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "splits",
  });

  const splitTransaction = useSplitTransaction();
  const updateSplit = useUpdateBankTransactionSplit();
  const revertSplit = useRevertBankTransactionSplit();
  const watchSplits = watch("splits");

  const totalAmount = Math.abs(transaction.amount);
  const allocatedAmount = watchSplits.reduce((sum, split) => sum + (Number(split.amount) || 0), 0);
  const remainingAmount = totalAmount - allocatedAmount;
  const isBalanced = Math.abs(remainingAmount) < 0.01;

  const [categorySelections, setCategorySelections] = useState<Record<number, string>>({});

  // Load existing splits when in edit mode
  useEffect(() => {
    if (isOpen && isEditMode && existingSplits && existingSplits.length > 0) {
      const loadedSplits = existingSplits.map(split => ({
        category_id: split.category_id,
        amount: split.amount,
        description: split.description || '',
      }));
      reset({ splits: loadedSplits });
      
      // Set initial category selections
      const initialSelections: Record<number, string> = {};
      existingSplits.forEach((split, index) => {
        initialSelections[index] = split.category_id;
      });
      setCategorySelections(initialSelections);
    } else if (isOpen && !isEditMode) {
      // Reset to default for new split
      reset({
        splits: [
          { category_id: '', amount: 0, description: '' },
          { category_id: '', amount: 0, description: '' },
        ],
      });
      setCategorySelections({});
    }
  }, [isOpen, isEditMode, existingSplits, reset]);

  const handleCategoryChange = (index: number, categoryId: string) => {
    setCategorySelections(prev => ({ ...prev, [index]: categoryId }));
  };

  const onSubmit = async (data: SplitFormData) => {
    if (!isBalanced) {
      return;
    }

    const splits = data.splits.map((split, index) => ({
      ...split,
      category_id: categorySelections[index] || split.category_id,
    }));

    const splitData = {
      transactionId: transaction.id,
      splits,
    };

    if (isEditMode) {
      await updateSplit.mutateAsync(splitData);
    } else {
      await splitTransaction.mutateAsync(splitData);
    }

    onClose();
  };

  const handleRevert = () => {
    if (window.confirm('Are you sure you want to revert this split? The original transaction will be restored.')) {
      revertSplit.mutate({ transactionId: transaction.id }, {
        onSuccess: () => {
          onClose();
        },
      });
    }
  };

  const formattedTotal = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(totalAmount);

  const formattedRemaining = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Math.abs(remainingAmount));

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Split Transaction' : 'Split Transaction'}</DialogTitle>
          <DialogDescription>
            Allocate {formattedTotal} across multiple categories
          </DialogDescription>
        </DialogHeader>

        {splitsLoading && isEditMode ? (
          <div className="text-center py-8 text-muted-foreground">Loading existing splits...</div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Original Transaction Info */}
          <div className="p-4 bg-muted rounded-lg">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Payee</div>
                <div className="font-medium">
                  {transaction.merchant_name || transaction.description}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Total Amount</div>
                <div className="font-medium text-lg">{formattedTotal}</div>
              </div>
            </div>
          </div>

          {/* Balance Indicator */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Allocated</span>
              <span className="font-mono">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: 'USD',
                }).format(allocatedAmount)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Remaining</span>
              <span className={`font-mono font-bold ${isBalanced ? 'text-green-600' : 'text-destructive'}`}>
                {formattedRemaining}
              </span>
            </div>
            {!isBalanced && allocatedAmount > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Split amounts must equal the total transaction amount
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Split Lines */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Split Lines</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ category_id: '', amount: 0, description: '' })}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Line
              </Button>
            </div>

            {fields.map((field, index) => (
              <div key={field.id} className="p-4 border rounded-lg space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor={`splits.${index}.category_id`}>Category</Label>
                      <SearchableAccountSelector
                        value={categorySelections[index] || ''}
                        onValueChange={(value) => handleCategoryChange(index, value)}
                        placeholder="Select category"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`splits.${index}.amount`}>Amount</Label>
                      <Input
                        type="number"
                        step="0.01"
                        {...register(`splits.${index}.amount`, {
                          required: true,
                          valueAsNumber: true,
                          min: 0.01,
                        })}
                        placeholder="0.00"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`splits.${index}.description`}>Description (optional)</Label>
                      <Textarea
                        {...register(`splits.${index}.description`)}
                        placeholder="Add notes about this split"
                        rows={2}
                      />
                    </div>
                  </div>

                  {fields.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(index)}
                      className="mt-8"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              className="flex-1"
              disabled={!isBalanced || splitTransaction.isPending || updateSplit.isPending || !watchSplits.every((_, i) => categorySelections[i])}
            >
              {splitTransaction.isPending || updateSplit.isPending 
                ? "Processing..." 
                : isEditMode 
                  ? "Update Split" 
                  : "Split Transaction"}
            </Button>
            {isEditMode && (
              <Button 
                type="button" 
                variant="destructive" 
                onClick={handleRevert}
                disabled={revertSplit.isPending}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                {revertSplit.isPending ? "Reverting..." : "Revert"}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
          </div>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
