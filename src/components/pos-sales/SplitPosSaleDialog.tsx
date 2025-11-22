import { useState, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SearchableAccountSelector } from "@/components/banking/SearchableAccountSelector";
import { useSplitPosSale, useRevertPosSaleSplit, useUpdatePosSaleSplit } from "@/hooks/useSplitPosSale";
import { Plus, Trash2, RotateCcw } from "lucide-react";
import { SplitLine } from "@/hooks/useSplitTransactionHelpers";

interface SplitFormData {
  splits: SplitLine[];
}

import { UnifiedSaleItem } from "@/types/pos";

interface SplitPosSaleDialogProps {
  sale: UnifiedSaleItem | null;
  isOpen: boolean;
  onClose: () => void;
  restaurantId: string;
}

const splitLineSchema = z.object({
  category_id: z.string().min(1, "Category is required"),
  amount: z.coerce.number().positive("Amount must be positive"),
  description: z.string().optional(),
});

const splitFormSchema = z.object({
  splits: z.array(splitLineSchema).min(2, "At least 2 splits required"),
});

export function SplitPosSaleDialog({ sale, isOpen, onClose, restaurantId }: SplitPosSaleDialogProps) {
  const { mutate: splitSale, isPending } = useSplitPosSale();
  const { mutate: updateSplit, isPending: isUpdating } = useUpdatePosSaleSplit();
  const { mutate: revertSplit, isPending: isReverting } = useRevertPosSaleSplit();
  
  const isEditMode = sale?.is_split && sale?.child_splits && sale.child_splits.length > 0;

  const { control, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<SplitFormData>({
    resolver: zodResolver(splitFormSchema),
    defaultValues: {
      splits: [
        { category_id: "", amount: 0, description: "" },
        { category_id: "", amount: 0, description: "" },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "splits",
  });

  const splits = watch("splits");
  
  // Load existing splits when in edit mode
  useEffect(() => {
    if (isOpen && sale && isEditMode) {
      const existingSplits = sale.child_splits!.map(child => ({
        category_id: child.category_id || "",
        amount: child.totalPrice || 0,
        description: child.itemName?.split(' - ')[1] || "",
      }));
      reset({ splits: existingSplits });
    } else if (isOpen && sale && !isEditMode) {
      // Reset to default for new split
      reset({
        splits: [
          { category_id: "", amount: 0, description: "" },
          { category_id: "", amount: 0, description: "" },
        ],
      });
    }
  }, [isOpen, sale, isEditMode, reset]);
  
  // Early return if no sale is provided (after all hooks)
  if (!sale) {
    return null;
  }
  
  const allocatedAmount = splits.reduce((sum, split) => sum + (Number(split.amount) || 0), 0);
  const remainingAmount = (sale.totalPrice || 0) - allocatedAmount;
  const isBalanced = Math.abs(remainingAmount) < 0.01;

  const onSubmit = (data: SplitFormData) => {
    if (!isBalanced) {
      return;
    }

    const splitData = {
      saleId: sale.id,
      splits: data.splits.map(split => ({
        category_id: split.category_id,
        amount: Number(split.amount),
        description: split.description,
      })),
    };

    if (isEditMode) {
      updateSplit(splitData, {
        onSuccess: () => {
          onClose();
        },
      });
    } else {
      splitSale(splitData, {
        onSuccess: () => {
          onClose();
        },
      });
    }
  };

  const handleRevert = () => {
    if (window.confirm('Are you sure you want to revert this split? The original transaction will be restored.')) {
      revertSplit({ saleId: sale.id }, {
        onSuccess: () => {
          onClose();
        },
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Split Sale' : 'Split Sale'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted/50 p-4 rounded-lg space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Item:</span>
              <span className="text-sm font-medium">{sale.itemName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Amount:</span>
              <span className="text-sm font-medium">${(sale.totalPrice || 0).toFixed(2)}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Allocated:</span>
              <span className="text-sm">${allocatedAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Remaining:</span>
              <span className={`text-sm font-medium ${
                Math.abs(remainingAmount) < 0.01 ? 'text-green-600' : 'text-destructive'
              }`}>
                ${remainingAmount.toFixed(2)}
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-4">
              {fields.map((field, index) => (
                <div key={field.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Split {index + 1}</Label>
                    {fields.length > 2 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Category</Label>
                    <SearchableAccountSelector
                      value={splits[index].category_id}
                      onValueChange={(accountId) => setValue(`splits.${index}.category_id`, accountId)}
                      filterByTypes={['revenue', 'liability']}
                    />
                    {errors.splits?.[index]?.category_id && (
                      <p className="text-sm text-destructive">
                        {errors.splits[index]?.category_id?.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={splits[index].amount || ""}
                      onChange={(e) => setValue(`splits.${index}.amount`, Number(e.target.value))}
                    />
                    {errors.splits?.[index]?.amount && (
                      <p className="text-sm text-destructive">
                        {errors.splits[index]?.amount?.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Description (Optional)</Label>
                    <Input
                      placeholder="e.g., Sales Tax, Tip, etc."
                      value={splits[index].description || ""}
                      onChange={(e) => setValue(`splits.${index}.description`, e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ category_id: "", amount: 0, description: "" })}
              className="w-full"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Split Line
            </Button>

            {errors.splits?.root && (
              <p className="text-sm text-destructive">{errors.splits.root.message}</p>
            )}

            <div className="flex gap-2 pt-4">
              <Button
                type="submit"
                disabled={!isBalanced || isPending || isUpdating}
                className="flex-1"
              >
                {isPending || isUpdating ? "Processing..." : isEditMode ? "Update Split" : "Split Sale"}
              </Button>
              {isEditMode && (
                <Button 
                  type="button" 
                  variant="destructive" 
                  onClick={handleRevert}
                  disabled={isReverting}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  {isReverting ? "Reverting..." : "Revert"}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
