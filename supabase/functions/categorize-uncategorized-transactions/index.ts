import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { restaurantId } = await req.json();
    if (!restaurantId) {
      throw new Error('Restaurant ID is required');
    }

    // Verify user has access to this restaurant
    const { data: userRestaurant, error: accessError } = await supabaseClient
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .single();

    if (accessError || !userRestaurant || !['owner', 'manager'].includes(userRestaurant.role)) {
      throw new Error('Access denied');
    }

    // Get uncategorized account IDs
    const { data: accounts, error: accountsError } = await supabaseClient
      .from('chart_of_accounts')
      .select('id, account_name')
      .eq('restaurant_id', restaurantId)
      .in('account_name', ['Uncategorized Income', 'Uncategorized Expense'])
      .eq('is_active', true);

    if (accountsError) throw accountsError;

    const uncategorizedIncome = accounts?.find(a => a.account_name === 'Uncategorized Income');
    const uncategorizedExpense = accounts?.find(a => a.account_name === 'Uncategorized Expense');

    if (!uncategorizedIncome || !uncategorizedExpense) {
      throw new Error('Uncategorized accounts not found. Please create them first.');
    }

    // Get all uncategorized transactions
    const { data: transactions, error: transactionsError } = await supabaseClient
      .from('bank_transactions')
      .select('id, amount')
      .eq('restaurant_id', restaurantId)
      .is('category_id', null);

    if (transactionsError) throw transactionsError;

    if (!transactions || transactions.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No uncategorized transactions found',
          updated: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get bank account (cash/checking account) for journal entries
    const { data: bankAccount, error: bankAccountError } = await supabaseClient
      .from('chart_of_accounts')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .eq('account_type', 'asset')
      .eq('account_subtype', 'cash')
      .eq('is_active', true)
      .limit(1)
      .single();

    if (bankAccountError || !bankAccount) {
      throw new Error('No active cash account found. Please create a bank account in your chart of accounts.');
    }

    // Get full transaction details with bank info
    const { data: fullTransactions, error: fullTxnError } = await supabaseClient
      .from('bank_transactions')
      .select(`
        id, 
        amount, 
        transaction_date, 
        description,
        connected_bank:connected_banks(institution_name)
      `)
      .eq('restaurant_id', restaurantId)
      .is('category_id', null);

    if (fullTxnError) throw fullTxnError;

    // Update transactions and create journal entries
    let updatedCount = 0;
    
    for (const transaction of fullTransactions || []) {
      const categoryId = transaction.amount >= 0 
        ? uncategorizedIncome.id 
        : uncategorizedExpense.id;
      
      const absAmount = Math.abs(transaction.amount);

      // Update transaction
      const { error: updateError } = await supabaseClient
        .from('bank_transactions')
        .update({ 
          category_id: categoryId,
          is_categorized: true 
        })
        .eq('id', transaction.id);

      if (updateError) {
        console.error(`Error updating transaction ${transaction.id}:`, updateError);
        continue;
      }

      // Create journal entry
      const entryNumber = `AUTO-${Date.now()}-${transaction.id.slice(0, 8)}`;
      const description = `${transaction.description || 'Bank transaction'} - ${transaction.connected_bank?.institution_name || 'Bank'}`;

      const { data: journalEntry, error: journalError } = await supabaseClient
        .from('journal_entries')
        .insert({
          restaurant_id: restaurantId,
          entry_date: transaction.transaction_date,
          entry_number: entryNumber,
          description: description,
          reference_type: 'bank_transaction',
          reference_id: transaction.id,
          created_by: user.id
        })
        .select('id')
        .single();

      if (journalError || !journalEntry) {
        console.error(`Error creating journal entry for transaction ${transaction.id}:`, journalError);
        continue;
      }

      // Create journal entry lines (double-entry bookkeeping)
      // For expenses (negative amount): Debit expense, Credit bank
      // For income (positive amount): Debit bank, Credit revenue
      const lines = transaction.amount < 0 
        ? [
            // Debit expense account
            {
              journal_entry_id: journalEntry.id,
              account_id: categoryId,
              debit_amount: absAmount,
              credit_amount: 0,
              description: 'Expense'
            },
            // Credit bank account
            {
              journal_entry_id: journalEntry.id,
              account_id: bankAccount.id,
              debit_amount: 0,
              credit_amount: absAmount,
              description: 'Payment from bank'
            }
          ]
        : [
            // Debit bank account
            {
              journal_entry_id: journalEntry.id,
              account_id: bankAccount.id,
              debit_amount: absAmount,
              credit_amount: 0,
              description: 'Deposit to bank'
            },
            // Credit revenue account
            {
              journal_entry_id: journalEntry.id,
              account_id: categoryId,
              debit_amount: 0,
              credit_amount: absAmount,
              description: 'Revenue'
            }
          ];

      const { error: linesError } = await supabaseClient
        .from('journal_entry_lines')
        .insert(lines);

      if (linesError) {
        console.error(`Error creating journal entry lines for transaction ${transaction.id}:`, linesError);
        continue;
      }

      // Update journal entry totals
      const { error: updateJournalError } = await supabaseClient
        .from('journal_entries')
        .update({
          total_debit: absAmount,
          total_credit: absAmount
        })
        .eq('id', journalEntry.id);

      if (updateJournalError) {
        console.error(`Error updating journal entry totals:`, updateJournalError);
      }

      // Update account balances
      for (const line of lines) {
        const balanceChange = line.debit_amount - line.credit_amount;
        
        const { error: balanceError } = await supabaseClient.rpc('increment_account_balance', {
          p_account_id: line.account_id,
          p_amount: balanceChange
        });

        if (balanceError) {
          // If RPC doesn't exist, do direct update
          const { data: account } = await supabaseClient
            .from('chart_of_accounts')
            .select('current_balance, normal_balance')
            .eq('id', line.account_id)
            .single();

          if (account) {
            const newBalance = (account.current_balance || 0) + balanceChange;
            await supabaseClient
              .from('chart_of_accounts')
              .update({ current_balance: newBalance })
              .eq('id', line.account_id);
          }
        }
      }

      updatedCount++;
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Successfully categorized ${updatedCount} transactions`,
        updated: updatedCount,
        total: transactions.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
