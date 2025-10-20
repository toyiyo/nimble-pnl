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

    // Get full transaction details
    const { data: fullTransactions, error: fullTxnError } = await supabaseClient
      .from('bank_transactions')
      .select('id, amount')
      .eq('restaurant_id', restaurantId)
      .is('category_id', null);

    if (fullTxnError) throw fullTxnError;

    // Use the database function to categorize each transaction
    let updatedCount = 0;
    
    for (const transaction of fullTransactions || []) {
      const categoryId = transaction.amount >= 0 
        ? uncategorizedIncome.id 
        : uncategorizedExpense.id;

      try {
        // Use the new categorize_bank_transaction function that handles deduplication
        const { error: categorizeError } = await supabaseClient
          .rpc('categorize_bank_transaction', {
            p_transaction_id: transaction.id,
            p_category_id: categoryId,
            p_restaurant_id: restaurantId
          });

        if (categorizeError) {
          console.error(`Error categorizing transaction ${transaction.id}:`, categorizeError);
          continue;
        }

        updatedCount++;
      } catch (error) {
        console.error(`Error categorizing transaction ${transaction.id}:`, error);
        continue;
      }
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
