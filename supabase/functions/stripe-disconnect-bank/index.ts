import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DisconnectBankRequest {
  bankId: string;
  deleteData?: boolean; // Whether to delete transactions and journal entries
}

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[DISCONNECT-BANK] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    // Create Supabase client with service role
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }
    logStep("User authenticated", { userId: user.id });

    // Parse request body
    const { bankId, deleteData = false }: DisconnectBankRequest = await req.json();
    
    if (!bankId) {
      throw new Error('Bank ID is required');
    }
    logStep("Request parsed", { bankId, deleteData });

    // Get the connected bank details
    const { data: bank, error: bankError } = await supabaseClient
      .from('connected_banks')
      .select('id, stripe_financial_account_id, restaurant_id, institution_name')
      .eq('id', bankId)
      .single();

    if (bankError || !bank) {
      throw new Error('Bank connection not found');
    }
    logStep("Bank found", { bankId: bank.id, institutionName: bank.institution_name });

    // Initialize Stripe
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      throw new Error('Stripe secret key not configured');
    }
    const stripe = new Stripe(stripeKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Unsubscribe from transaction updates in Stripe
    try {
      logStep("Unsubscribing from Stripe transaction updates");
      await stripe.financialConnections.accounts.unsubscribe(
        bank.stripe_financial_account_id,
        { features: ['transactions'] }
      );
      logStep("Successfully unsubscribed from Stripe");
    } catch (stripeError: any) {
      // Log but don't fail - the subscription might already be inactive
      logStep("Stripe unsubscribe error (non-fatal)", { 
        error: stripeError.message,
        code: stripeError.code 
      });
    }

    // If deleteData is true, delete related transactions and journal entries
    if (deleteData) {
      logStep("Starting data deletion");

      // First, get all transaction IDs for this bank
      const { data: transactions, error: txFetchError } = await supabaseClient
        .from('bank_transactions')
        .select('id')
        .eq('connected_bank_id', bankId);

      if (txFetchError) {
        logStep("Error fetching transaction IDs", { error: txFetchError.message });
        throw new Error(`Failed to fetch transaction IDs: ${txFetchError.message}`);
      }

      const transactionIds = transactions?.map(tx => tx.id) || [];
      logStep("Found transactions to delete", { count: transactionIds.length });

      // Only proceed with deletions if there are transactions
      if (transactionIds.length > 0) {
        // Delete journal entries associated with this bank's transactions
        const { error: journalDeleteError } = await supabaseClient
          .from('journal_entries')
          .delete()
          .in('bank_transaction_id', transactionIds);

        if (journalDeleteError) {
          logStep("Error deleting journal entries", { error: journalDeleteError.message });
          throw new Error(`Failed to delete journal entries: ${journalDeleteError.message}`);
        }
        logStep("Journal entries deleted");

        // Delete transaction splits
        const { error: splitsDeleteError } = await supabaseClient
          .from('bank_transaction_splits')
          .delete()
          .in('transaction_id', transactionIds);

        if (splitsDeleteError) {
          logStep("Error deleting transaction splits", { error: splitsDeleteError.message });
          throw new Error(`Failed to delete transaction splits: ${splitsDeleteError.message}`);
        }
        logStep("Transaction splits deleted");
      }

      // Delete bank transactions
      const { error: transactionsDeleteError } = await supabaseClient
        .from('bank_transactions')
        .delete()
        .eq('connected_bank_id', bankId);

      if (transactionsDeleteError) {
        logStep("Error deleting bank transactions", { error: transactionsDeleteError.message });
        throw new Error(`Failed to delete transactions: ${transactionsDeleteError.message}`);
      }
      logStep("Bank transactions deleted");

      // Delete bank account balances
      const { error: balancesDeleteError } = await supabaseClient
        .from('bank_account_balances')
        .delete()
        .eq('connected_bank_id', bankId);

      if (balancesDeleteError) {
        logStep("Error deleting balances", { error: balancesDeleteError.message });
        throw new Error(`Failed to delete balances: ${balancesDeleteError.message}`);
      }
      logStep("Bank account balances deleted");
    }

    // Update the bank connection status to disconnected
    const { error: updateError } = await supabaseClient
      .from('connected_banks')
      .update({
        status: 'disconnected',
        disconnected_at: new Date().toISOString(),
      })
      .eq('id', bankId);

    if (updateError) {
      throw new Error(`Failed to update bank status: ${updateError.message}`);
    }
    logStep("Bank connection marked as disconnected");

    return new Response(
      JSON.stringify({
        success: true,
        message: deleteData 
          ? 'Bank disconnected and all related data deleted successfully'
          : 'Bank disconnected successfully. Transaction history preserved.',
        dataDeleted: deleteData,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logStep("ERROR", { message: errorMessage });
    
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        success: false,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
