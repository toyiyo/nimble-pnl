import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface AccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  parentAccount?: {
    id: string;
    name: string;
    type: string;
    code: string;
  };
  onSuccess: () => void;
}

const accountTypes = [
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'expense', label: 'Expense' },
  { value: 'cogs', label: 'Cost of Goods Sold' },
];

const subtypesByType = {
  asset: ['cash', 'bank', 'accounts_receivable', 'inventory', 'prepaid', 'fixed_asset', 'other_asset'],
  liability: ['accounts_payable', 'credit_card', 'payroll_liabilities', 'sales_tax', 'loans', 'other_liability'],
  equity: ['owner_equity', 'retained_earnings', 'drawings'],
  revenue: ['food_sales', 'beverage_sales', 'alcohol_sales', 'catering', 'delivery', 'other_income'],
  expense: ['labor', 'rent', 'utilities', 'marketing', 'insurance', 'supplies', 'maintenance', 'professional_fees', 'other_expense'],
  cogs: ['food_cost', 'beverage_cost', 'packaging'],
};

export function AccountDialog({ open, onOpenChange, restaurantId, parentAccount, onSuccess }: AccountDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    account_name: '',
    account_code: parentAccount?.code ? `${parentAccount.code}-` : '',
    account_type: parentAccount?.type || 'expense',
    account_subtype: '',
    description: '',
    normal_balance: 'debit',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase
        .from('chart_of_accounts')
        .insert({
          restaurant_id: restaurantId,
          account_name: formData.account_name,
          account_code: formData.account_code,
          account_type: formData.account_type,
          account_subtype: formData.account_subtype,
          description: formData.description,
          normal_balance: formData.normal_balance,
          parent_account_id: parentAccount?.id || null,
          is_system_account: false,
        } as any);

      if (error) throw error;

      toast({
        title: 'Account created',
        description: `${formData.account_name} has been added to your chart of accounts.`,
      });

      onSuccess();
      onOpenChange(false);
      setFormData({
        account_name: '',
        account_code: parentAccount?.code ? `${parentAccount.code}-` : '',
        account_type: parentAccount?.type || 'expense',
        account_subtype: '',
        description: '',
        normal_balance: 'debit',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {parentAccount ? `Add Sub-Account to ${parentAccount.name}` : 'Add New Account'}
            </DialogTitle>
            <DialogDescription>
              {parentAccount 
                ? 'Create a sub-account under the selected parent account.'
                : 'Create a new account in your chart of accounts.'
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="account_name">Account Name *</Label>
              <Input
                id="account_name"
                value={formData.account_name}
                onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                placeholder="e.g., Office Supplies"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="account_code">Account Code *</Label>
              <Input
                id="account_code"
                value={formData.account_code}
                onChange={(e) => setFormData({ ...formData, account_code: e.target.value })}
                placeholder="e.g., 7800 or 7800-01"
                required
              />
              <p className="text-xs text-muted-foreground">
                Use format like 7800 for main accounts or 7800-01 for sub-accounts
              </p>
            </div>

            {!parentAccount && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="account_type">Account Type *</Label>
                  <Select
                    value={formData.account_type}
                    onValueChange={(value) => setFormData({ ...formData, account_type: value, account_subtype: '' })}
                  >
                    <SelectTrigger id="account_type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {accountTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="account_subtype">Account Subtype</Label>
                  <Select
                    value={formData.account_subtype}
                    onValueChange={(value) => setFormData({ ...formData, account_subtype: value })}
                  >
                    <SelectTrigger id="account_subtype">
                      <SelectValue placeholder="Select a subtype (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {subtypesByType[formData.account_type as keyof typeof subtypesByType]?.map((subtype) => (
                        <SelectItem key={subtype} value={subtype}>
                          {subtype.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="normal_balance">Normal Balance *</Label>
                  <Select
                    value={formData.normal_balance}
                    onValueChange={(value) => setFormData({ ...formData, normal_balance: value })}
                  >
                    <SelectTrigger id="normal_balance">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="debit">Debit</SelectItem>
                      <SelectItem value="credit">Credit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description for internal use"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}