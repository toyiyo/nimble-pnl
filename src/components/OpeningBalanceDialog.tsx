import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Calendar } from 'lucide-react';
import { format } from 'date-fns';

interface OpeningBalanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  account: {
    id: string;
    name: string;
    code: string;
    type: string;
  };
  onSuccess: () => void;
}

export function OpeningBalanceDialog({
  open,
  onOpenChange,
  restaurantId,
  account,
  onSuccess,
}: OpeningBalanceDialogProps) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const balance = parseFloat(amount);
    if (isNaN(balance) || balance <= 0) {
      toast.error('Please enter a valid positive amount');
      return;
    }

    setLoading(true);

    try {
      // Get or create Opening Balance Equity account
      let { data: equityAccount, error: equityError } = await supabase
        .from('chart_of_accounts')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('account_name', 'Opening Balance Equity')
        .eq('account_type', 'equity')
        .single();

      if (equityError || !equityAccount) {
        // Create Opening Balance Equity account
        const { data: newEquity, error: createError } = await supabase
          .from('chart_of_accounts')
          .insert([{
            restaurant_id: restaurantId,
            account_code: '3900',
            account_name: 'Opening Balance Equity',
            account_type: 'equity' as const,
            account_subtype: 'owners_equity' as const,
            normal_balance: 'credit',
            is_system_account: true,
          }])
          .select('id')
          .single();

        if (createError) throw createError;
        equityAccount = newEquity;
      }

      // Create journal entry for opening balance
      const entryNumber = `OPEN-${Date.now()}`;
      const { data: journalEntry, error: journalError } = await supabase
        .from('journal_entries')
        .insert({
          restaurant_id: restaurantId,
          entry_date: date,
          entry_number: entryNumber,
          description: `Opening balance for ${account.name}`,
          reference_type: 'opening_balance',
        })
        .select('id')
        .single();

      if (journalError) throw journalError;

      // Create journal entry lines
      // Debit the asset account (increases it)
      // Credit the equity account (balances the entry)
      const { error: linesError } = await supabase
        .from('journal_entry_lines')
        .insert([
          {
            journal_entry_id: journalEntry.id,
            account_id: account.id,
            debit_amount: balance,
            credit_amount: 0,
            description: 'Opening balance',
          },
          {
            journal_entry_id: journalEntry.id,
            account_id: equityAccount.id,
            debit_amount: 0,
            credit_amount: balance,
            description: 'Opening balance equity',
          },
        ]);

      if (linesError) throw linesError;

      // Update journal entry totals
      await supabase
        .from('journal_entries')
        .update({
          total_debit: balance,
          total_credit: balance,
        })
        .eq('id', journalEntry.id);

      // Update account balances
      const { data: currentAccount } = await supabase
        .from('chart_of_accounts')
        .select('current_balance')
        .eq('id', account.id)
        .single();

      await supabase
        .from('chart_of_accounts')
        .update({
          current_balance: (currentAccount?.current_balance || 0) + balance,
        })
        .eq('id', account.id);

      const { data: currentEquity } = await supabase
        .from('chart_of_accounts')
        .select('current_balance')
        .eq('id', equityAccount.id)
        .single();

      await supabase
        .from('chart_of_accounts')
        .update({
          current_balance: (currentEquity?.current_balance || 0) - balance,
        })
        .eq('id', equityAccount.id);

      toast.success('Opening balance recorded successfully');
      onSuccess();
      onOpenChange(false);
      setAmount('');
    } catch (error: any) {
      console.error('Error recording opening balance:', error);
      toast.error(`Failed to record opening balance: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set Opening Balance</DialogTitle>
          <DialogDescription>
            Record the starting balance for {account.name} ({account.code})
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="date">Opening Balance Date</Label>
            <div className="relative">
              <Calendar className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="pl-10"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              min="0.01"
            />
            <p className="text-xs text-muted-foreground">
              Enter the actual balance this account had on the opening date
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record Opening Balance
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
