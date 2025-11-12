import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAIWithFallbackStreaming } from "../_shared/ai-caller.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are an expert accountant helping create automatic categorization rules for financial transactions and POS sales. 

Analyze the provided categorized transactions and POS sales to identify patterns that can be converted into automatic categorization rules.

Look for patterns in:
- Description text (common words, merchant names, keywords)
- Transaction amounts (ranges that consistently map to specific categories)
- Suppliers (when available)
- Transaction types (debits vs credits)
- POS categories (for sales data)
- Item names (for POS sales)

Create rules that are:
1. SPECIFIC enough to be accurate (avoid overly broad patterns)
2. USEFUL for automating future categorizations
3. Based on clear, consistent patterns in the data
4. Prioritized by confidence and frequency

For each rule, provide:
- A descriptive name
- The pattern type and value
- The target category
- Confidence level (high/medium/low)
- Number of historical matches
- Reasoning for the rule`;

const buildUserPrompt = (source: 'bank' | 'pos', categorizedRecords: any[], accounts: any[]) => {
  const recordType = source === 'bank' ? 'transactions' : 'POS sales';
  const recordDetails = source === 'bank' 
    ? categorizedRecords.map((rec, idx) => `
${idx + 1}. Description: ${rec.description || 'N/A'}
   Merchant/Payee: ${rec.merchant_name || rec.normalized_payee || 'N/A'}
   Amount: $${rec.amount}
   Supplier: ${rec.supplier?.name || 'N/A'}
   Category: ${rec.category?.account_code} - ${rec.category?.account_name}
   Date: ${rec.transaction_date}
`).join('\n')
    : categorizedRecords.map((rec, idx) => `
${idx + 1}. Item Name: ${rec.item_name}
   POS Category: ${rec.pos_category || 'N/A'}
   Amount: $${rec.total_price}
   Category: ${rec.category?.account_code} - ${rec.category?.account_name}
   Date: ${rec.sale_date}
`).join('\n');

  return `
AVAILABLE CHART OF ACCOUNTS:
${accounts.map(acc => `- ${acc.account_code}: ${acc.account_name} (${acc.account_type})`).join('\n')}

CATEGORIZED ${recordType.toUpperCase()}:
${recordDetails}

Based on these categorized ${recordType}, suggest automatic categorization rules that would help categorize future ${recordType} without manual intervention.`;
};

function buildRuleSuggestionRequestBody(
  source: 'bank' | 'pos',
  categorizedRecords: any[],
  accounts: any[]
): any {
  const schema = source === 'bank' ? {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            rule_name: { type: 'string', description: 'Descriptive name for the rule' },
            pattern_type: { 
              type: 'string', 
              enum: ['description', 'amount_range', 'supplier', 'transaction_type'],
              description: 'Type of pattern to match'
            },
            description_pattern: { type: 'string', description: 'Text pattern for description matching (if pattern_type is description)' },
            description_match_type: { 
              type: 'string', 
              enum: ['contains', 'exact', 'starts_with', 'ends_with'],
              description: 'How to match description pattern'
            },
            amount_min: { type: 'number', description: 'Minimum amount (if pattern_type is amount_range)' },
            amount_max: { type: 'number', description: 'Maximum amount (if pattern_type is amount_range)' },
            transaction_type: { 
              type: 'string', 
              enum: ['debit', 'credit', 'any'],
              description: 'Transaction type to match'
            },
            account_code: { type: 'string', description: 'Target category account code' },
            confidence: { 
              type: 'string', 
              enum: ['high', 'medium', 'low'],
              description: 'Confidence in this rule'
            },
            historical_matches: { type: 'number', description: 'Number of existing transactions that match this pattern' },
            reasoning: { type: 'string', description: 'Why this rule is suggested' },
            priority: { type: 'number', description: 'Suggested priority (1-10, higher is more important)' }
          },
          required: ['rule_name', 'pattern_type', 'account_code', 'confidence', 'historical_matches', 'reasoning', 'priority'],
          additionalProperties: false
        }
      }
    },
    required: ['rules'],
    additionalProperties: false
  } : {
    type: 'object',
    properties: {
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            rule_name: { type: 'string', description: 'Descriptive name for the rule' },
            pattern_type: { 
              type: 'string', 
              enum: ['item_name', 'pos_category', 'amount_range'],
              description: 'Type of pattern to match'
            },
            item_name_pattern: { type: 'string', description: 'Text pattern for item name matching (if pattern_type is item_name)' },
            item_name_match_type: { 
              type: 'string', 
              enum: ['contains', 'exact', 'starts_with', 'ends_with'],
              description: 'How to match item name pattern'
            },
            pos_category: { type: 'string', description: 'POS category to match (if pattern_type is pos_category)' },
            amount_min: { type: 'number', description: 'Minimum amount (if pattern_type is amount_range)' },
            amount_max: { type: 'number', description: 'Maximum amount (if pattern_type is amount_range)' },
            account_code: { type: 'string', description: 'Target category account code' },
            confidence: { 
              type: 'string', 
              enum: ['high', 'medium', 'low'],
              description: 'Confidence in this rule'
            },
            historical_matches: { type: 'number', description: 'Number of existing sales that match this pattern' },
            reasoning: { type: 'string', description: 'Why this rule is suggested' },
            priority: { type: 'number', description: 'Suggested priority (1-10, higher is more important)' }
          },
          required: ['rule_name', 'pattern_type', 'account_code', 'confidence', 'historical_matches', 'reasoning', 'priority'],
          additionalProperties: false
        }
      }
    },
    required: ['rules'],
    additionalProperties: false
  };

  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(source, categorizedRecords, accounts) }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'categorization_rule_suggestions',
        strict: true,
        schema
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

    const { restaurantId, source = 'bank', limit = 100 } = await req.json();
    
    if (!restaurantId) {
      throw new Error('Restaurant ID is required');
    }

    if (!['bank', 'pos'].includes(source)) {
      throw new Error('Source must be "bank" or "pos"');
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

    // Get chart of accounts
    const { data: accounts, error: accountsError } = await supabaseClient
      .from('chart_of_accounts')
      .select('id, account_code, account_name, account_type')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .order('account_code');

    if (accountsError) throw accountsError;

    if (!accounts || accounts.length === 0) {
      throw new Error('No active accounts found');
    }

    // Get categorized records
    let categorizedRecords: any[] = [];
    
    if (source === 'bank') {
      const { data: transactions, error: txnError } = await supabaseClient
        .from('bank_transactions')
        .select(`
          id,
          description,
          merchant_name,
          normalized_payee,
          amount,
          transaction_date,
          category_id,
          supplier_id,
          supplier:suppliers(name),
          category:chart_of_accounts!bank_transactions_category_id_fkey(account_code, account_name)
        `)
        .eq('restaurant_id', restaurantId)
        .eq('is_categorized', true)
        .not('category_id', 'is', null)
        .order('transaction_date', { ascending: false })
        .limit(limit);

      if (txnError) throw txnError;
      categorizedRecords = transactions || [];
    } else {
      const { data: sales, error: salesError } = await supabaseClient
        .from('unified_sales')
        .select(`
          id,
          item_name,
          pos_category,
          total_price,
          sale_date,
          category_id,
          category:chart_of_accounts!unified_sales_category_id_fkey(account_code, account_name)
        `)
        .eq('restaurant_id', restaurantId)
        .eq('is_categorized', true)
        .not('category_id', 'is', null)
        .order('sale_date', { ascending: false })
        .limit(limit);

      if (salesError) throw salesError;
      categorizedRecords = sales || [];
    }

    if (categorizedRecords.length === 0) {
      return new Response(
        JSON.stringify({ 
          rules: [],
          message: `No categorized ${source === 'bank' ? 'transactions' : 'POS sales'} found to analyze. Please categorize some ${source === 'bank' ? 'transactions' : 'sales'} first.`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${categorizedRecords.length} categorized ${source === 'bank' ? 'transactions' : 'sales'} to analyze`);

    // Build request body for AI
    const requestBody = buildRuleSuggestionRequestBody(source, categorizedRecords, accounts);

    // Call AI with fallback
    const result = await callAIWithFallbackStreaming(
      requestBody,
      openRouterApiKey,
      'ai-suggest-categorization-rules',
      restaurantId
    );

    if (!result || !result.data) {
      console.error('[AI-SUGGEST-RULES] No result returned from AI');
      throw new Error('Failed to get AI suggestions');
    }

    console.log('[AI-SUGGEST-RULES] AI result received:', JSON.stringify(result.data).substring(0, 500));

    // Parse and validate the response
    const suggestions = result.data;
    
    if (!suggestions || !suggestions.rules || !Array.isArray(suggestions.rules)) {
      console.error('[AI-SUGGEST-RULES] Invalid response structure:', suggestions);
      throw new Error('Invalid AI response structure - missing rules array');
    }

    console.log(`[AI-SUGGEST-RULES] Processing ${suggestions.rules.length} suggested rules`);
    
    // Map account codes to IDs
    const rulesWithIds = suggestions.rules.map((rule: any) => {
      const account = accounts.find(acc => acc.account_code === rule.account_code);
      if (!account) {
        console.warn(`[AI-SUGGEST-RULES] Account code ${rule.account_code} not found for rule: ${rule.rule_name}`);
      }
      return {
        ...rule,
        category_id: account?.id,
        category_name: account?.account_name,
        applies_to: source === 'bank' ? 'bank_transactions' : 'pos_sales'
      };
    });

    console.log(`[AI-SUGGEST-RULES] Successfully processed all rules, returning response`);

    return new Response(
      JSON.stringify({ 
        rules: rulesWithIds,
        total_analyzed: categorizedRecords.length,
        source
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[AI-SUGGEST-RULES] Error:', error);
    console.error('[AI-SUGGEST-RULES] Error stack:', error instanceof Error ? error.stack : 'N/A');
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'An error occurred' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
