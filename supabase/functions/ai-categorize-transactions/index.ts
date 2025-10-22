import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Model configurations (free models first, then paid fallbacks)
const MODELS = [
  {
    name: "Llama 4 Maverick Free",
    id: "meta-llama/llama-4-maverick:free",
    maxRetries: 2
  },
  {
    name: "Gemma 3 27B Free",
    id: "google/gemma-3-27b-it:free",
    maxRetries: 2
  },
  {
    name: "Gemini 2.5 Flash Lite",
    id: "google/gemini-2.5-flash-lite",
    maxRetries: 1
  },
  {
    name: "GPT-4.1 Nano",
    id: "openai/gpt-4.1-nano",
    maxRetries: 1
  }
];

const CATEGORIZATION_PROMPT = (transactions: any[], accounts: any[]) => `
You are an expert accountant helping categorize bank transactions. Analyze each transaction and assign it to the most appropriate account from the Chart of Accounts provided.

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

Return ONLY valid JSON (no markdown, no explanations) in this exact format:
{
  "categorizations": [
    {
      "transaction_id": "uuid-here",
      "account_code": "1234",
      "confidence": "high|medium|low",
      "reasoning": "brief explanation"
    }
  ]
}

RULES:
- Match transaction descriptions and payees to appropriate accounts
- Positive amounts are typically income/revenue
- Negative amounts are typically expenses
- Use confidence: "high" for obvious matches, "medium" for likely matches, "low" for uncertain
- Always provide brief reasoning for each categorization
- Return valid JSON only
`;

async function callModel(
  modelConfig: typeof MODELS[0],
  prompt: string,
  openRouterApiKey: string
): Promise<Response | null> {
  let retryCount = 0;
  
  while (retryCount < modelConfig.maxRetries) {
    try {
      console.log(`🔄 ${modelConfig.name} attempt ${retryCount + 1}/${modelConfig.maxRetries}...`);
      
      const requestBody = {
        model: modelConfig.id,
        messages: [
          {
            role: "system",
            content: "You are an expert accountant. Analyze transactions and categorize them accurately. Return only valid JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      };

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://app.easyshifthq.com",
          "X-Title": "EasyShiftHQ Transaction Categorization",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        console.log(`✅ ${modelConfig.name} succeeded`);
        return response;
      }

      if (response.status === 429 && retryCount < modelConfig.maxRetries - 1) {
        console.log(`🔄 ${modelConfig.name} rate limited, waiting before retry...`);
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount + 1) * 1000));
        retryCount++;
      } else {
        const errorText = await response.text();
        console.error(`❌ ${modelConfig.name} failed:`, response.status, errorText);
        break;
      }
    } catch (error) {
      console.error(`❌ ${modelConfig.name} error:`, error);
      retryCount++;
      if (retryCount < modelConfig.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      }
    }
  }
  
  return null;
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
        JSON.stringify({ error: 'AI service not configured' }),
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

    console.log(`🚀 Starting AI categorization for ${transactions.length} transactions...`);

    const prompt = CATEGORIZATION_PROMPT(transactions, accounts);

    let finalResponse: Response | undefined;

    // Try models in order
    for (const modelConfig of MODELS) {
      console.log(`🚀 Trying ${modelConfig.name}...`);
      
      const response = await callModel(
        modelConfig,
        prompt,
        openRouterApiKey
      );
      
      if (response) {
        finalResponse = response;
        break;
      }
      
      console.log(`⚠️ ${modelConfig.name} failed, trying next model...`);
    }

    if (!finalResponse || !finalResponse.ok) {
      console.error('❌ All AI models failed');
      
      return new Response(
        JSON.stringify({ 
          error: 'AI categorization temporarily unavailable. Please try again later.',
          details: 'All AI models are currently unavailable'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 503 
        }
      );
    }

    const data = await finalResponse.json();
    const aiResponse = data.choices[0].message.content;

    let categorizations;
    try {
      const parsed = JSON.parse(aiResponse);
      categorizations = parsed.categorizations;
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiResponse);
      return new Response(JSON.stringify({ error: 'Invalid AI response format' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
