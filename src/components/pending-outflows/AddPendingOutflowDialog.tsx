import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { usePendingOutflowMutations } from "@/hooks/usePendingOutflows";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import type { CreatePendingOutflowInput, PaymentMethod } from "@/types/pending-outflows";
import { formatDateInTimezone } from "@/lib/timezone";
import { Loader2 } from "lucide-react";

interface AddPendingOutflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddPendingOutflowDialog({ open, onOpenChange }: AddPendingOutflowDialogProps) {
  const { selectedRestaurant } = useRestaurantContext();
  const { accounts } = useChartOfAccounts(selectedRestaurant?.restaurant_id || null);
  const { createPendingOutflow } = usePendingOutflowMutations();

  const [formData, setFormData] = useState<CreatePendingOutflowInput>({
    vendor_name: '',
    payment_method: 'check',
    amount: 0,
    issue_date: formatDateInTimezone(new Date(), 'UTC', 'yyyy-MM-dd'),
    category_id: null,
    due_date: null,
    notes: null,
    reference_number: null,
  });

  const expenseAccounts = accounts.filter(
    (account) => account.account_type === 'expense' || account.account_subtype === 'accounts_payable'
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.vendor_name || formData.amount <= 0) {
      return;
    }

    createPendingOutflow.mutate(formData, {
      onSuccess: () => {
        // Reset form
        setFormData({
          vendor_name: '',
          payment_method: 'check',
          amount: 0,
          issue_date: formatDateInTimezone(new Date(), 'UTC', 'yyyy-MM-dd'),
          category_id: null,
          due_date: null,
          notes: null,
          reference_number: null,
        });
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Add Pending Payment
          </DialogTitle>
          <DialogDescription>
            Log a check or payment you've initiated but hasn't cleared the bank yet.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vendor_name">
              Payee / Vendor <span className="text-destructive">*</span>
            </Label>
            <Input
              id="vendor_name"
              placeholder="e.g., Sysco, Insurance Co."
              value={formData.vendor_name}
              onChange={(e) => setFormData({ ...formData, vendor_name: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="payment_method">
                Payment Method <span className="text-destructive">*</span>
              </Label>
              <Select
                value={formData.payment_method}
                onValueChange={(value) => setFormData({ ...formData, payment_method: value as PaymentMethod })}
              >
                <SelectTrigger id="payment_method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="check">Check</SelectItem>
                  <SelectItem value="ach">ACH</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">
                Amount <span className="text-destructive">*</span>
              </Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={formData.amount || ''}
                onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="issue_date">
                Issue / Due Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="issue_date"
                type="date"
                value={formData.issue_date}
                onChange={(e) => setFormData({ ...formData, issue_date: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reference_number">Reference / Check #</Label>
              <Input
                id="reference_number"
                placeholder="Optional"
                value={formData.reference_number || ''}
                onChange={(e) => setFormData({ ...formData, reference_number: e.target.value || null })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category_id">Category (Optional)</Label>
            <Select
              value={formData.category_id || undefined}
              onValueChange={(value) => setFormData({ ...formData, category_id: value || null })}
            >
              <SelectTrigger id="category_id">
                <SelectValue placeholder="Select category..." />
              </SelectTrigger>
              <SelectContent>
                {expenseAccounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.account_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Add any additional details..."
              value={formData.notes || ''}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value || null })}
              rows={3}
            />
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createPendingOutflow.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createPendingOutflow.isPending}>
              {createPendingOutflow.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
