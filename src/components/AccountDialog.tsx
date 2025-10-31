import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAccountSubtypes } from '@/hooks/useAccountSubtypes';
import { Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

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

// Helper to format enum values to readable labels
const formatSubtypeLabel = (value: string): string => {
  // Special case: "other_expense" should be "Other Expenses" (plural)
  if (value === 'other_expense') {
    return 'Other Expenses';
  }
  
  return value
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

// Fallback hardcoded subtypes (will be replaced by dynamic values)
const fallbackSubtypesByType: Record<string, string[]> = {
  asset: ['cash', 'accounts_receivable', 'inventory', 'prepaid_expenses', 'fixed_assets', 'accumulated_depreciation', 'other_assets'],
  liability: ['accounts_payable', 'credit_card', 'loan', 'payroll_liabilities', 'deferred_revenue', 'other_liabilities'],
  equity: ['owners_equity', 'retained_earnings', 'distributions'],
  revenue: ['food_sales', 'beverage_sales', 'alcohol_sales', 'catering_income', 'other_income'],
  expense: ['labor', 'rent', 'utilities', 'marketing', 'insurance', 'repairs_maintenance', 'professional_fees', 'other_expenses'],
  cogs: ['food_cost', 'beverage_cost', 'packaging_cost'],
};

export function AccountDialog({ open, onOpenChange, restaurantId, parentAccount, onSuccess }: AccountDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const { data: accountSubtypes, isLoading: subtypesLoading } = useAccountSubtypes();
  const [parentNormalBalance, setParentNormalBalance] = useState<string>('debit');
  
  const [formData, setFormData] = useState({
    account_name: '',
    account_code: parentAccount?.code ? `${parentAccount.code}-` : '',
    account_type: parentAccount?.type || 'expense',
    account_subtype: '',
    description: '',
    normal_balance: 'debit',
  });

  // Fetch parent account details when creating a sub-account
  useEffect(() => {
    const fetchParentDetails = async () => {
      if (parentAccount?.id) {
        const { data, error } = await supabase
          .from('chart_of_accounts')
          .select('normal_balance, account_type')
          .eq('id', parentAccount.id)
          .single();
        
        if (data && !error) {
          setParentNormalBalance(data.normal_balance);
          // Reset form data with parent's type and normal balance
          setFormData({
            account_name: '',
            account_code: `${parentAccount.code}-`,
            account_type: data.account_type,
            account_subtype: '',
            description: '',
            normal_balance: data.normal_balance,
          });
        }
      } else {
        // Reset to defaults for main account
        setFormData({
          account_name: '',
          account_code: '',
          account_type: 'expense',
          account_subtype: '',
          description: '',
          normal_balance: 'debit',
        });
      }
    };

    if (open) {
      fetchParentDetails();
    }
  }, [open, parentAccount]);

  // Build subtypes from dynamic data or fallback
  const subtypesByType: Record<string, string[]> = accountSubtypes
    ? {
        asset: accountSubtypes.asset,
        liability: accountSubtypes.liability,
        equity: accountSubtypes.equity,
        revenue: accountSubtypes.revenue,
        expense: accountSubtypes.expense,
        cogs: accountSubtypes.cogs,
      }
    : fallbackSubtypesByType;

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
          account_subtype: formData.account_subtype || null,
          description: formData.description || null,
          normal_balance: formData.normal_balance,
          parent_account_id: parentAccount?.id || null,
          is_system_account: false,
        } as any);

      if (error) throw error;

      // Invalidate all chart of accounts queries
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });

      toast({
        title: 'Account created',
        description: `${formData.account_name} has been added to your chart of accounts.`,
      });

      onSuccess();
      onOpenChange(false);
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
      <DialogContent className="sm:max-w-[500px] bg-background">
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

          {subtypesLoading && (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading account types...
            </div>
          )}

          <div className="space-y-4 py-4" style={{ opacity: subtypesLoading ? 0.5 : 1 }}>
            <div className="space-y-2">
              <Label htmlFor="account_name">Account Name *</Label>
              <Input
                id="account_name"
                value={formData.account_name}
                onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                placeholder="e.g., Office Supplies"
                required
                disabled={subtypesLoading}
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
                disabled={subtypesLoading}
              />
              <p className="text-xs text-muted-foreground">
                Use format like 7800 for main accounts or 7800-01 for sub-accounts
              </p>
            </div>

            {parentAccount && (
              <div className="rounded-lg bg-muted/50 p-3 space-y-1">
                <p className="text-sm font-medium">Inherited from parent account:</p>
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <div>
                    <span className="font-medium">Type:</span> {formData.account_type}
                  </div>
                  <div>
                    <span className="font-medium">Normal Balance:</span> {formData.normal_balance}
                  </div>
                </div>
              </div>
            )}

            {!parentAccount && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="account_type">Account Type *</Label>
                  <Select
                    value={formData.account_type}
                    onValueChange={(value) => setFormData({ ...formData, account_type: value, account_subtype: '' })}
                    disabled={subtypesLoading}
                  >
                    <SelectTrigger id="account_type" className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover z-50">
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
                    disabled={subtypesLoading}
                  >
                    <SelectTrigger id="account_subtype" className="bg-background">
                      <SelectValue placeholder="Select a subtype (optional)" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover z-50">
                      {subtypesByType[formData.account_type as keyof typeof subtypesByType]?.map((subtype) => (
                        <SelectItem key={subtype} value={subtype}>
                          {formatSubtypeLabel(subtype)}
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
                    disabled={subtypesLoading}
                  >
                    <SelectTrigger id="normal_balance" className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover z-50">
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
                disabled={subtypesLoading}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || subtypesLoading}>
              {loading ? 'Creating...' : 'Create Account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
