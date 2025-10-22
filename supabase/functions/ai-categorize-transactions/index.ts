import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are an expert accountant helping categorize bank transactions. Analyze each transaction and assign it to the most appropriate account from the Chart of Accounts provided.

RULES:
- Match transaction descriptions and payees to appropriate accounts
- Positive amounts are typically income/revenue
- Negative amounts are typically expenses
- Use confidence: "high" for obvious matches, "medium" for likely matches, "low" for uncertain
- Always provide brief reasoning for each categorization`;

const buildUserPrompt = (transactions: any[], accounts: any[]) => `
CHART OF ACCOUNTS:
${accounts.map(acc => `- ${acc.account_code}: ${acc.account_name} (${acc.account_type})`).join('\n')}

TRANSACTIONS TO CATEGORIZE:
${transactions.map((txn, idx) => `
${idx + 1}. ID: ${txn.id}
   Description: ${txn.description || 'N/A'}
   Merchant: ${txn.merchant_name || txn.normalized_payee || 'N/A'}
   Amount: $${txn.amount}
   Date: ${txn.transaction_date}
`).join('\n')}

Categorize each transaction with the appropriate account code, confidence level, and reasoning.`;

async function categorizeWithOpenRouter(
  transactions: any[],
  accounts: any[],
  openRouterApiKey: string
) {
  console.log('🤖 Calling OpenRouter with structured output for guaranteed valid JSON...');
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openRouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://ncdujvdgqtaunuyigflp.supabase.co',
      'X-Title': 'Restaurant AI Categorization'
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(transactions, accounts) }
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
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ OpenRouter API error:', response.status, errorText);
    throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  
  if (!content) {
    throw new Error('No content in OpenRouter response');
  }

  const result = JSON.parse(content);
  console.log('✅ OpenRouter returned structured categorizations:', result.categorizations.length);
  
  return result.categorizations;
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

    if (!openRouterApiKey) {
      console.error('OpenRouter API key not found');
      return new Response(
        JSON.stringify({ error: 'AI service not configured. Please add your OpenRouter API key.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Get uncategorized accounts (9200 and 9100)
    const { data: uncategorizedAccounts, error: uncatError } = await supabaseClient
      .from('chart_of_accounts')
      .select('id')
      .eq('restaurant_id', restaurantId)
      .in('account_code', ['9200', '9100'])
      .eq('is_active', true);

    if (uncatError) throw uncatError;

    const uncategorizedIds = uncategorizedAccounts?.map(a => a.id) || [];

    // Get transactions that need categorization
    const { data: transactions, error: transactionsError } = await supabaseClient
      .from('bank_transactions')
      .select('id, description, merchant_name, normalized_payee, amount, transaction_date, category_id')
      .eq('restaurant_id', restaurantId)
      .or(`category_id.is.null,category_id.in.(${uncategorizedIds.join(',')})`)
      .order('transaction_date', { ascending: false })
      .limit(100); // Process max 100 at a time

    if (transactionsError) throw transactionsError;

    if (!transactions || transactions.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No transactions need AI categorization',
          categorized: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get chart of accounts (excluding uncategorized ones)
    const { data: accounts, error: accountsError } = await supabaseClient
      .from('chart_of_accounts')
      .select('id, account_code, account_name, account_type')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .not('account_code', 'in', '(9200,9100)')
      .order('account_code');

    if (accountsError) throw accountsError;

    if (!accounts || accounts.length === 0) {
      throw new Error('No chart of accounts found');
    }

    console.log(`🚀 Starting AI categorization for ${transactions.length} transactions using OpenRouter...`);

    let categorizations;
    try {
      categorizations = await categorizeWithOpenRouter(transactions, accounts, openRouterApiKey);
    } catch (error) {
      console.error('❌ OpenRouter categorization failed:', error);
      return new Response(
        JSON.stringify({ 
          error: 'AI categorization failed. Please try again later.',
          details: error.message
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 503 
        }
      );
    }

    // Update transactions with AI suggestions
    let updatedCount = 0;
    const results = [];

    for (const cat of categorizations) {
      try {
        // Find the account by code
        const account = accounts.find(a => a.account_code === cat.account_code);
        if (!account) {
          console.warn(`Account code ${cat.account_code} not found`);
          continue;
        }

        // Update transaction with suggested category
        const { error: updateError } = await supabaseClient
          .from('bank_transactions')
          .update({ 
            suggested_category_id: account.id,
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

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `AI suggested categories for ${updatedCount} transactions. Please review and validate.`,
        categorized: updatedCount,
        total: transactions.length,
        results
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
