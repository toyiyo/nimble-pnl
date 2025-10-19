import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const useAutoOpeningBalance = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (restaurantId: string) => {
      // Get current bank balance from connected bank
      const { data: bankBalances, error: balanceError } = await supabase
        .from('bank_account_balances')
        .select(`
          current_balance,
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

      // Get all categorized transactions to calculate net change
      const { data: transactions, error: txnError } = await supabase
        .from('bank_transactions')
        .select('amount')
        .eq('restaurant_id', restaurantId)
        .eq('is_categorized', true);

      if (txnError) throw txnError;

      const netChange = (transactions || []).reduce((sum, txn) => sum + txn.amount, 0);

      // Calculate opening balance: current balance - net change
      const openingBalance = currentBankBalance - netChange;

      if (openingBalance <= 0) {
        throw new Error(`Calculated opening balance is ${openingBalance.toFixed(2)}. This suggests data issues. Please check your transactions.`);
      }

      // Get the main cash account (account code 1000)
      const { data: cashAccount, error: accountError } = await supabase
        .from('chart_of_accounts')
        .select('id, account_name, current_balance')
        .eq('restaurant_id', restaurantId)
        .eq('account_code', '1000')
        .single();

      if (accountError) throw accountError;

      // Get or create Opening Balance Equity account
      let { data: equityAccount, error: equityError } = await supabase
        .from('chart_of_accounts')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('account_name', 'Opening Balance Equity')
        .eq('account_type', 'equity')
        .maybeSingle();

      if (!equityAccount) {
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

      // Get earliest transaction date
      const { data: earliestTxn } = await supabase
        .from('bank_transactions')
        .select('transaction_date')
        .eq('restaurant_id', restaurantId)
        .order('transaction_date', { ascending: true })
        .limit(1)
        .single();

      const openingDate = earliestTxn?.transaction_date || new Date().toISOString().split('T')[0];

      // Create journal entry for opening balance
      const entryNumber = `OPEN-AUTO-${Date.now()}`;
      const { data: journalEntry, error: journalError } = await supabase
        .from('journal_entries')
        .insert({
          restaurant_id: restaurantId,
          entry_date: openingDate,
          entry_number: entryNumber,
          description: `Auto-calculated opening balance for ${cashAccount.account_name}`,
          reference_type: 'opening_balance',
        })
        .select('id')
        .single();

      if (journalError) throw journalError;

      // Create journal entry lines
      const { error: linesError } = await supabase
        .from('journal_entry_lines')
        .insert([
          {
            journal_entry_id: journalEntry.id,
            account_id: cashAccount.id,
            debit_amount: openingBalance,
            credit_amount: 0,
            description: 'Auto-calculated opening balance',
          },
          {
            journal_entry_id: journalEntry.id,
            account_id: equityAccount.id,
            debit_amount: 0,
            credit_amount: openingBalance,
            description: 'Opening balance equity',
          },
        ]);

      if (linesError) throw linesError;

      // Update journal entry totals
      await supabase
        .from('journal_entries')
        .update({
          total_debit: openingBalance,
          total_credit: openingBalance,
        })
        .eq('id', journalEntry.id);

      // Update account balances
      await supabase
        .from('chart_of_accounts')
        .update({
          current_balance: cashAccount.current_balance + openingBalance,
        })
        .eq('id', cashAccount.id);

      const { data: currentEquity } = await supabase
        .from('chart_of_accounts')
        .select('current_balance')
        .eq('id', equityAccount.id)
        .single();

      await supabase
        .from('chart_of_accounts')
        .update({
          current_balance: (currentEquity?.current_balance || 0) - openingBalance,
        })
        .eq('id', equityAccount.id);

      return {
        openingBalance,
        currentBalance: currentBankBalance,
        netChange,
      };
    },
    onSuccess: (data) => {
      toast.success(
        `Opening balance set to ${new Intl.NumberFormat('en-US', { 
          style: 'currency', 
          currency: 'USD' 
        }).format(data.openingBalance)}`
      );
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['balance-sheet'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to calculate opening balance: ${error.message}`);
    },
  });
};
