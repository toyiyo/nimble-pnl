import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAIWithFallbackStreaming } from "../_shared/ai-caller.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are an expert restaurant accountant categorizing POS sales items to the chart of accounts.

CRITICAL RULES:
1. Most POS sales items map to REVENUE accounts (account_type = 'revenue')
2. Special items map to LIABILITY or CONTRA-REVENUE accounts:
   - Tips/Gratuity → "Tips Payable" (LIABILITY)
   - Sales Tax → "Sales Tax Payable" (LIABILITY)
   - Discounts/Comps → "Discounts Given" (CONTRA-REVENUE, reduces total)
   - Refunds → "Refunds & Returns" (CONTRA-REVENUE)
   - Cover Charge/Service Charge → Revenue account

3. Use pos_category field (if present) as PRIMARY signal for categorization
4. Match item names to appropriate revenue categories
5. Learn from the example categorizations provided to understand common patterns for this restaurant

ITEM TYPE DETECTION:
- item_type: "tip" → Items containing: "tip", "gratuity", "auto-grat"
- item_type: "tax" → Items containing: "tax", "HST", "GST", "VAT", "sales tax"
- item_type: "discount" → Items containing: "discount", "comp", "promo", "coupon"
- item_type: "service_charge" → Items containing: "cover charge" (maps to REVENUE)
- item_type: "sale" → All other items (default)

REVENUE CATEGORIZATION EXAMPLES:
- "Burger & Fries" → Sales – Food (high)
- "Draft Beer" → Sales – Beverages (Non-Alcoholic) OR Sales – Alcohol (high)
- "Wine - Merlot" → Sales – Alcohol (high)
- "Catering Order #123" → Catering Income (high)
- "DoorDash Delivery" → Delivery & Takeout Revenue (high)
- "Cover Charge" → Service Charges / Fees (high, item_type: service_charge)

LIABILITY CATEGORIZATION EXAMPLES:
- "Auto-Gratuity 18%" → Tips Payable (high, item_type: tip)
- "Sales Tax 7%" → Sales Tax Payable (high, item_type: tax)
- "HST" → Sales Tax Payable (high, item_type: tax)

CONTRA-REVENUE CATEGORIZATION EXAMPLES:
- "Employee Meal Discount" → Discounts Given (high, item_type: discount)
- "Manager Comp" → Discounts Given (high, item_type: discount)
- "Refund - Burger" → Refunds & Returns (high, item_type: discount)

CONFIDENCE LEVELS:
- "high" → Clear match, obvious category
- "medium" → Reasonable match, some ambiguity
- "low" → Uncertain, needs human review

Response format: JSON with categorizations array`;

function buildUserPrompt(chartOfAccounts: any[], sales: any[], examples: any[]) {
  const relevantAccounts = chartOfAccounts.filter(
    acc => acc.account_type === 'revenue' || acc.account_type === 'liability'
  );

  let prompt = `Chart of Accounts (Revenue & Liability accounts only):
${relevantAccounts.map(acc => 
  `- ${acc.account_code}: ${acc.account_name} (${acc.account_type}, ${acc.account_subtype})`
).join('\n')}
`;

  // Include examples if available
  if (examples && examples.length > 0) {
    prompt += `

EXAMPLE CATEGORIZATIONS (learn from these patterns):
${examples.map((ex, idx) => `
${idx + 1}. Item: ${ex.item_name}
   POS Category: ${ex.pos_category || 'N/A'}
   Total: $${ex.total_price}
   → Categorized as: ${ex.account_code} - ${ex.account_name} (${ex.account_type})
   Item Type: ${ex.item_type}
`).join('')}
`;
  }

  prompt += `

Uncategorized POS Sales:
${sales.map((sale, i) => `
${i + 1}. Sale ID: ${sale.id}
   Item: ${sale.item_name}
   POS Category: ${sale.pos_category || 'N/A'}
   POS System: ${sale.pos_system}
   Quantity: ${sale.quantity}
   Total: $${sale.total_price}
   Date: ${sale.sale_date}
`).join('\n')}

Categorize each sale with:
1. sale_id
2. account_code (must exist in chart of accounts)
3. item_type ('sale', 'tip', 'tax', 'discount', 'comp', 'service_charge', 'other')
4. confidence ('high', 'medium', 'low')
5. reasoning (brief explanation)
`;

  return prompt;
}

function buildCategorizationRequestBody(
  chartOfAccounts: any[],
  sales: any[],
  examples: any[]
): any {
  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(chartOfAccounts, sales, examples) }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "pos_sales_categorization",
        strict: true,
        schema: {
          type: "object",
          properties: {
            categorizations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sale_id: { type: "string" },
                  account_code: { 
                    type: "string",
                    enum: chartOfAccounts.map(acc => acc.account_code)
                  },
                  item_type: {
                    type: "string",
                    enum: ["sale", "tip", "tax", "discount", "comp", "service_charge", "other"]
                  },
                  confidence: {
                    type: "string",
                    enum: ["high", "medium", "low"]
                  },
                  reasoning: { type: "string" }
                },
                required: ["sale_id", "account_code", "item_type", "confidence", "reasoning"],
                additionalProperties: false
              }
            }
          },
          required: ["categorizations"],
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
      throw new Error('Missing authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false }
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { restaurantId } = await req.json();
    if (!restaurantId) {
      throw new Error('Missing restaurantId');
    }

    // Verify user has permission
    const { data: userRestaurant, error: permError } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .single();

    if (permError || !userRestaurant || !['owner', 'manager'].includes(userRestaurant.role)) {
      throw new Error('Access denied');
    }

    // Fetch uncategorized sales (limit to 50 per batch)
    const { data: sales, error: salesError } = await supabase
      .from('unified_sales')
      .select('id, item_name, pos_category, pos_system, quantity, total_price, sale_date')
      .eq('restaurant_id', restaurantId)
      .eq('is_categorized', false)
      .is('suggested_category_id', null)
      .order('sale_date', { ascending: false })
      .limit(50);

    if (salesError) {
      console.error('Error fetching sales:', salesError);
      throw new Error('Failed to fetch uncategorized sales');
    }

    if (!sales || sales.length === 0) {
      return new Response(
        JSON.stringify({ 
          message: 'No uncategorized sales found',
          count: 0,
          categorized: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch chart of accounts (revenue + liability only)
    const { data: chartOfAccounts, error: chartError } = await supabase
      .from('chart_of_accounts')
      .select('id, account_code, account_name, account_type, account_subtype')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .in('account_type', ['revenue', 'liability'])
      .order('account_code');

    if (chartError) {
      console.error('Database error fetching chart of accounts:', chartError);
      throw new Error('Database error fetching chart of accounts');
    }

    if (!chartOfAccounts || chartOfAccounts.length === 0) {
      // Provide diagnostic information
      console.error('No active revenue/liability accounts found. Running diagnostics...');
      
      // Check if ANY accounts exist
      const { data: allAccounts, error: allError } = await supabase
        .from('chart_of_accounts')
        .select('id, account_type, is_active', { count: 'exact', head: false })
        .eq('restaurant_id', restaurantId);
      
      if (allError) {
        console.error('Diagnostic query error:', allError);
      } else if (!allAccounts || allAccounts.length === 0) {
        console.error('❌ No chart of accounts found at all for this restaurant');
        throw new Error('No chart of accounts found. Please set up your chart of accounts first in the Accounting section.');
      } else {
        // Check if any are active
        const activeCount = allAccounts.filter(a => a.is_active).length;
        const revenueCount = allAccounts.filter(a => a.account_type === 'revenue').length;
        const liabilityCount = allAccounts.filter(a => a.account_type === 'liability').length;
        
        console.error(`📊 Diagnostics:
          Total accounts: ${allAccounts.length}
          Active accounts: ${activeCount}
          Revenue accounts: ${revenueCount}
          Liability accounts: ${liabilityCount}
        `);
        
        if (activeCount === 0) {
          throw new Error('All chart of accounts are inactive. Please activate at least one revenue or liability account in the Accounting section.');
        } else if (revenueCount === 0 && liabilityCount === 0) {
          throw new Error('No revenue or liability accounts found. POS sales must be categorized to revenue, liability, or contra-revenue accounts.');
        } else {
          throw new Error('No active revenue or liability accounts found. Please activate revenue/liability accounts in the Accounting section.');
        }
      }
    }

    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!OPENROUTER_API_KEY) {
      console.error('OpenRouter API key not found');
      return new Response(
        JSON.stringify({ error: 'AI service not configured. Please add your OpenRouter API key.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Fetch example categorizations (recent categorized sales)
    // Get up to 10 examples to help AI learn the restaurant's categorization patterns
    const { data: exampleSales, error: examplesError } = await supabase
      .from('unified_sales')
      .select(`
        id,
        item_name,
        pos_category,
        total_price,
        item_type,
        category_id,
        sale_date,
        chart_of_accounts!inner(
          account_code,
          account_name,
          account_type
        )
      `)
      .eq('restaurant_id', restaurantId)
      .eq('is_categorized', true)
      .not('category_id', 'is', null)
      .order('sale_date', { ascending: false })
      .limit(10);

    if (examplesError) {
      console.warn('Warning: Could not fetch example categorizations:', examplesError);
    }

    // Format examples for the prompt
    const examples = (exampleSales || []).map(ex => ({
      item_name: ex.item_name,
      pos_category: ex.pos_category,
      total_price: ex.total_price,
      item_type: ex.item_type || 'sale',
      account_code: ex.chart_of_accounts?.account_code,
      account_name: ex.chart_of_accounts?.account_name,
      account_type: ex.chart_of_accounts?.account_type
    })).filter(ex => ex.account_code); // Only include examples with valid account info

    console.log(`📚 Using ${examples.length} example categorizations to improve AI accuracy`);

    const requestBody = buildCategorizationRequestBody(chartOfAccounts, sales, examples);
    console.log(`🎯 Categorizing ${sales.length} POS sales with streaming...`);
    const aiResult = await callAIWithFallbackStreaming<{ categorizations: any[] }>(
      requestBody,
      OPENROUTER_API_KEY,
      'ai-categorize-pos-sales',
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
    console.log(`✅ Successfully categorized ${categorizations.length} sales using ${successfulModel}`);

    let successCount = 0;
    let failedCount = 0;
    const accountCodeMap = new Map(
      chartOfAccounts.map(acc => [acc.account_code, acc.id])
    );

    // Create a map of valid sale IDs for validation
    const validSaleIds = new Set(sales.map(s => s.id));

    for (const cat of categorizations) {
      // Trim and validate sale_id
      const saleId = cat.sale_id?.trim();
      if (!saleId || !validSaleIds.has(saleId)) {
        console.warn(`Invalid or unknown sale_id: ${cat.sale_id}`);
        failedCount++;
        continue;
      }

      const accountId = accountCodeMap.get(cat.account_code);
      if (!accountId) {
        console.warn(`Invalid account code: ${cat.account_code} for sale ${saleId}`);
        failedCount++;
        continue;
      }

      const { error: updateError } = await supabase
        .from('unified_sales')
        .update({
          suggested_category_id: accountId,
          ai_confidence: cat.confidence,
          ai_reasoning: cat.reasoning,
          item_type: cat.item_type || 'sale'
        })
        .eq('id', saleId)
        .eq('restaurant_id', restaurantId);

      if (updateError) {
        console.error(`Error updating sale ${saleId}:`, updateError);
        failedCount++;
      } else {
        successCount++;
      }
    }

    console.log(`📊 Results: ${successCount} succeeded, ${failedCount} failed`);

    return new Response(
      JSON.stringify({ 
        message: `AI suggested categories for ${successCount} sales`,
        count: sales.length,
        categorized: successCount,
        remaining: sales.length - successCount
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ai-categorize-pos-sales:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
