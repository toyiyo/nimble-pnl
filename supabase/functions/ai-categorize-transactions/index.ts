import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAIWithFallbackStreaming } from "../_shared/ai-caller.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are an expert accountant helping categorize bank transactions. Analyze each transaction and assign it to the most appropriate account from the Chart of Accounts provided.

CRITICAL RULES:
- You MUST ONLY use account codes that are explicitly listed in the Chart of Accounts provided
- DO NOT invent, guess, or use account codes that are not in the provided list
- If uncertain, choose the closest matching account from the provided list
- Match transaction descriptions and payees to appropriate accounts
- Positive amounts are typically income/revenue
- Negative amounts are typically expenses
- Use confidence: "high" for obvious matches, "medium" for likely matches, "low" for uncertain
- Always provide brief reasoning for each categorization
- Learn from the example categorizations provided to understand common patterns for this restaurant

IMPORTANT: Double-check that every account_code you return appears in the Chart of Accounts list provided in the user prompt. Invalid codes will be rejected.`;

const buildUserPrompt = (transactions: any[], accounts: any[], examples: any[]) => {
  let prompt = `CHART OF ACCOUNTS:
${accounts.map(acc => `- ${acc.account_code}: ${acc.account_name} (${acc.account_type})`).join('\n')}
`;

  // Include examples if available
  if (examples && examples.length > 0) {
    prompt += `

EXAMPLE CATEGORIZATIONS (learn from these patterns):
${examples.map((ex, idx) => `
${idx + 1}. Description: ${ex.description || 'N/A'}
   Merchant: ${ex.merchant_name || ex.normalized_payee || 'N/A'}
   Amount: $${ex.amount}
   → Categorized as: ${ex.account_code} - ${ex.account_name} (${ex.account_type})
`).join('')}
`;
  }

  prompt += `

TRANSACTIONS TO CATEGORIZE:
${transactions.map((txn, idx) => `
${idx + 1}. ID: ${txn.id}
   Description: ${txn.description || 'N/A'}
   Merchant: ${txn.merchant_name || txn.normalized_payee || 'N/A'}
   Amount: $${txn.amount}
   Date: ${txn.transaction_date}
`).join('\n')}

Categorize each transaction with the appropriate account code, confidence level, and reasoning.`;

  return prompt;
};

// Helper function to build structured output request body
function buildCategorizationRequestBody(
  transactions: any[],
  accounts: any[],
  examples: any[]
): any {
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(transactions, accounts, examples) }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'transaction_categorizations',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            categorizations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  transaction_id: { 
                    type: 'string', 
                    description: 'UUID of the transaction' 
                  },
                  account_code: { 
                    type: 'string', 
                    description: 'Account code from chart of accounts' 
                  },
                  confidence: { 
                    type: 'string', 
                    enum: ['high', 'medium', 'low'],
                    description: 'Confidence level of categorization'
                  },
                  reasoning: { 
                    type: 'string', 
                    description: 'Brief explanation for categorization' 
                  }
                },
                required: ['transaction_id', 'account_code', 'confidence', 'reasoning'],
                additionalProperties: false
              }
            }
          },
          required: ['categorizations'],
          additionalProperties: false
        }
      }
    }
  };
}

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

    const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!openRouterApiKey) {
      console.error('OpenRouter API key not found');
      return new Response(
        JSON.stringify({ error: 'AI service not configured. Please add your OpenRouter API key.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Get uncategorized accounts by NAME (not code) - matches Stripe import logic
    const { data: uncategorizedAccounts, error: uncatError } = await supabaseClient
      .from('chart_of_accounts')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .in('account_name', ['Uncategorized Expense', 'Uncategorized Income'])
      .eq('is_active', true);

    if (uncatError) throw uncatError;

    const uncategorizedIds = uncategorizedAccounts?.map(a => a.id) || [];

    // Get transactions that need categorization (no AI suggestion yet)
    const { data: transactions, error: transactionsError } = await supabaseClient
      .from('bank_transactions')
      .select('id, description, merchant_name, normalized_payee, amount, transaction_date, category_id, suggested_category_id')
      .eq('restaurant_id', restaurantId)
      .or(`category_id.is.null,category_id.in.(${uncategorizedIds.join(',')})`)
      .is('suggested_category_id', null) // Skip transactions that already have AI suggestions
      .order('transaction_date', { ascending: false })
      .limit(100); // Process max 100 at a time per batch

    if (transactionsError) throw transactionsError;

    if (!transactions || transactions.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No transactions need AI categorization. All transactions either have categories or already have AI suggestions pending review.',
          categorized: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check total count of transactions needing categorization
    const { count: remainingCount } = await supabaseClient
      .from('bank_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('restaurant_id', restaurantId)
      .or(`category_id.is.null,category_id.in.(${uncategorizedIds.join(',')})`)
      .is('suggested_category_id', null);

    // Get chart of accounts (excluding uncategorized ones)
    const { data: accounts, error: accountsError } = await supabaseClient
      .from('chart_of_accounts')
      .select('id, account_code, account_name, account_type')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .not('account_code', 'in', '(9200,9100)')
      .order('account_code');

    if (accountsError) {
      console.error('Database error fetching chart of accounts:', accountsError);
      throw new Error('Database error fetching chart of accounts');
    }

    if (!accounts || accounts.length === 0) {
      // Provide diagnostic information
      console.error('No active accounts found (excluding uncategorized). Running diagnostics...');
      
      // Check if ANY accounts exist
      const { data: allAccounts, error: allError } = await supabaseClient
        .from('chart_of_accounts')
        .select('id, account_code, is_active', { count: 'exact', head: false })
        .eq('restaurant_id', restaurantId);
      
      if (allError) {
        console.error('Diagnostic query error:', allError);
      } else if (!allAccounts || allAccounts.length === 0) {
        console.error('❌ No chart of accounts found at all for this restaurant');
        throw new Error('No chart of accounts found. Please set up your chart of accounts first in the Accounting section.');
      } else {
        // Check if any are active
        const activeCount = allAccounts.filter(a => a.is_active).length;
        const nonUncategorizedCount = allAccounts.filter(a => 
          a.account_code !== '9200' && a.account_code !== '9100'
        ).length;
        
        console.error(`📊 Diagnostics:
          Total accounts: ${allAccounts.length}
          Active accounts: ${activeCount}
          Non-uncategorized accounts: ${nonUncategorizedCount}
        `);
        
        if (activeCount === 0) {
          throw new Error('All chart of accounts are inactive. Please activate accounts in the Accounting section.');
        } else if (nonUncategorizedCount === 0) {
          throw new Error('Only uncategorized accounts (9200, 9100) exist. Please add proper accounts to your chart of accounts.');
        } else {
          throw new Error('No active categorizable accounts found. Please activate accounts (other than 9200, 9100) in the Accounting section.');
        }
      }
    }

    // Fetch example categorizations (recent categorized transactions)
    // Get up to 10 examples to help AI learn the restaurant's categorization patterns
    let exampleQuery = supabaseClient
      .from('bank_transactions')
      .select(`
        id, 
        description, 
        merchant_name, 
        normalized_payee, 
        amount, 
        transaction_date,
        category_id,
        chart_of_accounts!inner(
          account_code,
          account_name,
          account_type
        )
      `)
      .eq('restaurant_id', restaurantId)
      .eq('is_categorized', true)
      .not('category_id', 'is', null);

    // Only exclude uncategorized accounts if they exist
    if (uncategorizedIds.length > 0) {
      exampleQuery = exampleQuery.not('category_id', 'in', `(${uncategorizedIds.join(',')})`);
    }

    const { data: exampleTransactions, error: examplesError } = await exampleQuery
      .order('transaction_date', { ascending: false })
      .limit(10);

    if (examplesError) {
      console.warn('Warning: Could not fetch example categorizations:', examplesError);
    }

    // Format examples for the prompt
    const examples = (exampleTransactions || []).map((ex: any) => ({
      description: ex.description,
      merchant_name: ex.merchant_name,
      normalized_payee: ex.normalized_payee,
      amount: ex.amount,
      account_code: ex.chart_of_accounts?.account_code,
      account_name: ex.chart_of_accounts?.account_name,
      account_type: ex.chart_of_accounts?.account_type
    })).filter((ex: any) => ex.account_code); // Only include examples with valid account info

    console.log(`📚 Using ${examples.length} example categorizations to improve AI accuracy`);

    const requestBody = buildCategorizationRequestBody(transactions, accounts, examples);
    console.log(`🎯 Categorizing ${transactions.length} transactions with streaming...`);
    const aiResult = await callAIWithFallbackStreaming<{ categorizations: any[] }>(
      requestBody,
      openRouterApiKey,
      'ai-categorize-transactions',
      restaurantId
    );

    if (!aiResult || !aiResult.data.categorizations || aiResult.data.categorizations.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'AI categorization temporarily unavailable. All AI models failed to provide valid responses.',
          details: 'Please try again later'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 503 
        }
      );
    }

    const { data: { categorizations }, model: successfulModel } = aiResult;
    console.log(`✅ Successfully categorized ${categorizations.length} transactions using ${successfulModel}`);

    // Update transactions with AI suggestions
    let updatedCount = 0;
    const results = [];

    for (const cat of categorizations) {
      try {
        // Find the account by code
        const account = accounts.find(a => a.account_code === cat.account_code);
        if (!account) {
          console.warn(`❌ Account code ${cat.account_code} not found in chart of accounts. AI may have hallucinated this code.`);
          console.warn(`   Available account codes: ${accounts.map(a => a.account_code).join(', ')}`);
          continue;
        }

        // Update transaction with suggested category, confidence, and reasoning
        const { error: updateError } = await supabaseClient
          .from('bank_transactions')
          .update({ 
            suggested_category_id: account.id,
            ai_confidence: cat.confidence,
            ai_reasoning: cat.reasoning,
            is_categorized: false // Mark as not categorized yet (needs validation)
          })
          .eq('id', cat.transaction_id)
          .eq('restaurant_id', restaurantId);

        if (updateError) {
          console.error(`Error updating transaction ${cat.transaction_id}:`, updateError);
          continue;
        }

        updatedCount++;
        results.push({
          transaction_id: cat.transaction_id,
          suggested_account: account.account_name,
          confidence: cat.confidence,
          reasoning: cat.reasoning
        });
      } catch (error) {
        console.error(`Error processing categorization for ${cat.transaction_id}:`, error);
      }
    }

    console.log(`✅ Successfully suggested categories for ${updatedCount} transactions`);

    // Calculate remaining based on authoritative count and actual processed count
    const remainingAfterProcessing = (remainingCount ?? 0) - updatedCount;
    const hasMoreAfterProcessing = remainingAfterProcessing > 0;

    const responseMessage = hasMoreAfterProcessing 
      ? `AI suggested categories for ${updatedCount} transactions. ${remainingAfterProcessing} more need categorization - click again to continue.`
      : `AI suggested categories for ${updatedCount} transactions. All transactions have been processed!`;

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: responseMessage,
        categorized: updatedCount,
        total: transactions.length,
        remaining: remainingAfterProcessing,
        hasMore: hasMoreAfterProcessing,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An error occurred';
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
