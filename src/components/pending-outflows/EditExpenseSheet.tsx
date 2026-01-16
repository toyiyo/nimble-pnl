import { useCallback, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { usePendingOutflowMutations } from '@/hooks/usePendingOutflows';
import { useSuppliers } from '@/hooks/useSuppliers';
import { SearchableSupplierSelector } from '@/components/SearchableSupplierSelector';
import { SearchableAccountSelector } from '@/components/banking/SearchableAccountSelector';
import { useToast } from '@/hooks/use-toast';
import type { PendingOutflow, PaymentMethod, UpdatePendingOutflowInput } from '@/types/pending-outflows';
import { Loader2, Trash2 } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';

interface EditExpenseSheetProps {
  expense: PendingOutflow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditExpenseSheet({ expense, open, onOpenChange }: EditExpenseSheetProps) {
  const { toast } = useToast();
  const { suppliers, createSupplier } = useSuppliers();
  const { updatePendingOutflow, deletePendingOutflow } = usePendingOutflowMutations();

  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [pendingVendorName, setPendingVendorName] = useState<string>('');
  const [formData, setFormData] = useState<UpdatePendingOutflowInput>({
    vendor_name: '',
    payment_method: 'other',
    amount: 0,
    issue_date: '',
    category_id: null,
    due_date: null,
    notes: null,
    reference_number: null,
  });

  // Populate form when expense changes
  useEffect(() => {
    if (expense && open) {
      setFormData({
        vendor_name: expense.vendor_name,
        payment_method: expense.payment_method,
        amount: expense.amount,
        issue_date: expense.issue_date,
        category_id: expense.category_id,
        due_date: expense.due_date,
        notes: expense.notes,
        reference_number: expense.reference_number,
      });

      // Find matching supplier
      const match = suppliers.find(
        (s) => s.name.toLowerCase() === expense.vendor_name.toLowerCase().trim()
      );
      if (match) {
        setSelectedSupplierId(match.id);
        setPendingVendorName('');
      } else if (expense.vendor_name) {
        // No match found - show as pending vendor name
        setSelectedSupplierId('new_supplier');
        setPendingVendorName(expense.vendor_name);
      } else {
        setSelectedSupplierId('');
        setPendingVendorName('');
      }
    }
  }, [expense, open, suppliers]);

  const resetState = useCallback(() => {
    setSelectedSupplierId('');
    setPendingVendorName('');
    setFormData({
      vendor_name: '',
      payment_method: 'other',
      amount: 0,
      issue_date: '',
      category_id: null,
      due_date: null,
      notes: null,
      reference_number: null,
    });
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  const handleSupplierChange = async (value: string, createNew?: boolean) => {
    setSelectedSupplierId(value);

    if (createNew || value.startsWith('new:')) {
      const supplierName = createNew ? value.trim() : value.replace('new:', '');
      try {
        const newSupplier = await createSupplier({ name: supplierName });
        setFormData((prev) => ({ ...prev, vendor_name: newSupplier.name }));
        setSelectedSupplierId(newSupplier.id);
        setPendingVendorName('');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : null;
        toast({
          title: 'Error',
          description: errorMessage ? `Failed to create supplier: ${errorMessage}` : 'Failed to create supplier',
          variant: 'destructive',
        });
      }
      return;
    }

    const supplier = suppliers.find((s) => s.id === value);
    if (supplier) {
      setFormData((prev) => ({ ...prev, vendor_name: supplier.name }));
      setPendingVendorName('');
    }
  };

  const handleSave = async () => {
    if (!expense) return;

    if (!formData.vendor_name || formData.amount <= 0) {
      toast({
        title: 'Missing details',
        description: 'Vendor and total amount are required.',
        variant: 'destructive',
      });
      return;
    }

    try {
      await updatePendingOutflow.mutateAsync({
        id: expense.id,
        input: formData,
      });
      onOpenChange(false);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : null;
      toast({
        title: 'Error',
        description: errorMessage ? `Failed to update expense: ${errorMessage}` : 'Failed to update expense',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!expense) return;

    try {
      await deletePendingOutflow.mutateAsync(expense.id);
      onOpenChange(false);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : null;
      toast({
        title: 'Error',
        description: errorMessage ? `Failed to delete expense: ${errorMessage}` : 'Failed to delete expense',
        variant: 'destructive',
      });
    }
  };

  const isBusy = updatePendingOutflow.isPending || deletePendingOutflow.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="flex flex-row items-start justify-between">
          <div>
            <SheetTitle>Edit expense</SheetTitle>
            <SheetDescription>Update expense details</SheetDescription>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                aria-label="Delete expense"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete expense?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete this expense. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="space-y-4">
            {/* Vendor */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Vendor</Label>
              <SearchableSupplierSelector
                value={selectedSupplierId}
                onValueChange={handleSupplierChange}
                suppliers={suppliers}
                placeholder="Select or create vendor..."
                showNewIndicator
                pendingNewName={pendingVendorName}
              />
            </div>

            {/* Date, Due Date, Payment Method */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Date</Label>
                <Input
                  type="date"
                  value={formData.issue_date || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, issue_date: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Due Date</Label>
                <Input
                  type="date"
                  value={formData.due_date || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      due_date: e.target.value || null,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Method</Label>
                <Select
                  value={formData.payment_method}
                  onValueChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      payment_method: value as PaymentMethod,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="check">Check</SelectItem>
                    <SelectItem value="ach">ACH</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Total Amount */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Total</span>
                {formData.amount > 0 && (
                  <span className="text-foreground font-semibold text-base">
                    {formatCurrency(formData.amount)}
                  </span>
                )}
              </div>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={formData.amount || ''}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    amount: parseFloat(e.target.value) || 0,
                  }))
                }
              />
            </div>

            {/* Reference Number */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Reference #</Label>
              <Input
                type="text"
                placeholder="Invoice or check number"
                value={formData.reference_number || ''}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    reference_number: e.target.value || null,
                  }))
                }
              />
            </div>

            {/* Category */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Category</Label>
              <SearchableAccountSelector
                value={formData.category_id || undefined}
                onValueChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    category_id: value || null,
                  }))
                }
                filterByTypes={['expense', 'asset', 'cogs']}
                placeholder="Select category (expense, COGS, or asset)..."
              />
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Notes</Label>
              <Textarea
                placeholder="Additional notes..."
                value={formData.notes || ''}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    notes: e.target.value || null,
                  }))
                }
                rows={3}
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSave} disabled={isBusy}>
              {updatePendingOutflow.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save changes
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
