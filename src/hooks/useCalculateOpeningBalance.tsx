import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const useCalculateOpeningBalance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (restaurantId: string) => {
      // Step 1: Get current bank balance from connected bank
      const { data: bankBalances, error: balanceError } = await supabase
        .from('bank_account_balances')
        .select(`
          current_balance,
          as_of_date,
          connected_bank:connected_banks!inner(
            restaurant_id
          )
        `)
        .eq('connected_bank.restaurant_id', restaurantId)
        .order('as_of_date', { ascending: false })
        .limit(1);

      if (balanceError) throw balanceError;
      if (!bankBalances || bankBalances.length === 0) {
        throw new Error('No bank balance found. Please connect your bank account first.');
      }

      const currentBankBalance = bankBalances[0].current_balance;
      const balanceAsOfDate = bankBalances[0].as_of_date;

      // Step 2: Get all categorized transactions to calculate net change
      const { data: transactions, error: txnError } = await supabase
        .from('bank_transactions')
        .select('amount, transaction_date')
        .eq('restaurant_id', restaurantId)
        .eq('is_categorized', true);

      if (txnError) throw txnError;

      // Calculate net change from transactions
      const netChange = (transactions || []).reduce((sum, txn) => sum + Number(txn.amount), 0);

      // Step 3: Calculate opening balance
      // Opening balance = current balance - net change from transactions
      const openingBalance = Number(currentBankBalance) - netChange;

      // Step 4: Get the Cash account (1000)
      const { data: cashAccount, error: accountError } = await supabase
        .from('chart_of_accounts')
        .select('id, account_name')
        .eq('restaurant_id', restaurantId)
        .eq('account_code', '1000')
        .single();

      if (accountError) throw accountError;

      // Step 5: Get Owner's Equity account (3000)
      const { data: equityAccount, error: equityError } = await supabase
        .from('chart_of_accounts')
        .select('id, account_name')
        .eq('restaurant_id', restaurantId)
        .eq('account_code', '3000')
        .single();

      if (equityError) throw equityError;

      // Step 6: Get earliest transaction date for the journal entry date
      const { data: earliestTxn } = await supabase
        .from('bank_transactions')
        .select('transaction_date')
        .eq('restaurant_id', restaurantId)
        .order('transaction_date', { ascending: true })
        .limit(1)
        .maybeSingle();

      const openingDate = earliestTxn?.transaction_date || new Date().toISOString().split('T')[0];

      // Step 7: Check if opening balance already exists
      const { data: existingEntry } = await supabase
        .from('journal_entries')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('reference_type', 'opening_balance')
        .maybeSingle();

      if (existingEntry) {
        throw new Error('Opening balance already set. Use "Rebuild Balances" to recalculate all account balances.');
      }

      // Step 8: Create journal entry for opening balance
      const entryNumber = `OPEN-${Date.now()}`;
      const { data: journalEntry, error: journalError } = await supabase
        .from('journal_entries')
        .insert({
          restaurant_id: restaurantId,
          entry_date: openingDate,
          entry_number: entryNumber,
          description: `Opening balance calculated from bank data (as of ${new Date(balanceAsOfDate).toLocaleDateString()})`,
          reference_type: 'opening_balance',
          total_debit: openingBalance,
          total_credit: openingBalance,
        })
        .select('id')
        .single();

      if (journalError) throw journalError;

      // Step 9: Create journal entry lines
      const { error: linesError } = await supabase
        .from('journal_entry_lines')
        .insert([
          {
            journal_entry_id: journalEntry.id,
            account_id: cashAccount.id,
            debit_amount: openingBalance,
            credit_amount: 0,
            description: 'Opening cash balance',
          },
          {
            journal_entry_id: journalEntry.id,
            account_id: equityAccount.id,
            debit_amount: 0,
            credit_amount: openingBalance,
            description: 'Owner\'s equity - initial investment',
          },
        ]);

      if (linesError) throw linesError;

      // Step 10: Save reconciliation boundary
      const { error: boundaryError } = await supabase
        .from('reconciliation_boundaries')
        .upsert({
          restaurant_id: restaurantId,
          balance_start_date: openingDate,
          opening_balance: openingBalance,
          opening_balance_journal_entry_id: journalEntry.id,
          last_reconciled_at: new Date().toISOString(),
        }, {
          onConflict: 'restaurant_id'
        });

      if (boundaryError) throw boundaryError;

      // Step 11: Rebuild account balances
      const { error: rebuildError } = await supabase.rpc('rebuild_account_balances', {
        p_restaurant_id: restaurantId
      });

      if (rebuildError) throw rebuildError;

      return {
        openingBalance,
        currentBankBalance,
        netChange,
        openingDate,
      };
    },
    onSuccess: (data) => {
      toast.success(
        `Opening balance calculated: ${new Intl.NumberFormat('en-US', { 
          style: 'currency', 
          currency: 'USD' 
        }).format(data.openingBalance)}`
      );
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['balance-sheet'] });
      queryClient.invalidateQueries({ queryKey: ['trial-balance'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to calculate opening balance: ${error.message}`);
    },
  });
};
