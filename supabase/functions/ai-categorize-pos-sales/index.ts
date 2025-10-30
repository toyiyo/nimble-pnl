import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// Model configurations (free models first, then paid fallbacks)
const MODELS = [
  // Free models
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
  // Paid models (fallback)
  {
    name: "Gemini 2.5 Flash Lite",
    id: "google/gemini-2.5-flash-lite",
    maxRetries: 1
  },
  {
    name: "Claude Sonnet 4.5",
    id: "anthropic/claude-sonnet-4-5",
    maxRetries: 1
  },
  {
    name: "Llama 4 Maverick Paid",
    id: "meta-llama/llama-4-maverick",
    maxRetries: 1
  }
];

function buildUserPrompt(chartOfAccounts: any[], sales: any[]) {
  const relevantAccounts = chartOfAccounts.filter(
    acc => acc.account_type === 'revenue' || acc.account_type === 'liability'
  );

  return `
Chart of Accounts (Revenue & Liability accounts only):
${relevantAccounts.map(acc => 
  `- ${acc.account_code}: ${acc.account_name} (${acc.account_type}, ${acc.account_subtype})`
).join('\n')}

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
}

function buildCategorizationRequestBody(
  modelId: string,
  sales: any[],
  chartOfAccounts: any[]
): any {
  return {
    model: modelId,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(chartOfAccounts, sales) }
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

// Generic function to call a model with retries
async function callModel(
  modelConfig: typeof MODELS[0],
  sales: any[],
  chartOfAccounts: any[],
  openRouterApiKey: string
): Promise<Response | null> {
  let retryCount = 0;
  
  while (retryCount < modelConfig.maxRetries) {
    try {
      console.log(`🔄 ${modelConfig.name} attempt ${retryCount + 1}/${modelConfig.maxRetries}...`);
      
      const requestBody = buildCategorizationRequestBody(
        modelConfig.id,
        sales,
        chartOfAccounts
      );

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://ncdujvdgqtaunuyigflp.supabase.co",
          "X-Title": "Restaurant POS Categorization",
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

    if (chartError || !chartOfAccounts || chartOfAccounts.length === 0) {
      console.error('Error fetching chart of accounts:', chartError);
      throw new Error('No active chart of accounts found');
    }

    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
    if (!OPENROUTER_API_KEY) {
      console.error('OpenRouter API key not found');
      return new Response(
        JSON.stringify({ error: 'AI service not configured. Please add your OpenRouter API key.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    console.log(`🚀 Starting AI categorization for ${sales.length} sales with multi-model fallback...`);

    let categorizations: any[] | undefined;
    let successfulModel: string | undefined;

    // Try models in order: free models first, then paid fallbacks
    for (const modelConfig of MODELS) {
      console.log(`🚀 Trying ${modelConfig.name}...`);
      
      const response = await callModel(
        modelConfig,
        sales,
        chartOfAccounts,
        OPENROUTER_API_KEY
      );
      
      if (!response || !response.ok) {
        console.log(`⚠️ ${modelConfig.name} failed to return a valid response, trying next model...`);
        continue;
      }

      // Try to parse the response
      try {
        const data = await response.json();
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
          console.error(`❌ ${modelConfig.name} returned invalid response structure`);
          continue;
        }

        const content = data.choices[0].message.content;
        
        if (!content) {
          console.error(`❌ ${modelConfig.name} returned empty content`);
          continue;
        }

        // Parse the JSON content
        const result = JSON.parse(content);
        
        if (!result.categorizations || !Array.isArray(result.categorizations)) {
          console.error(`❌ ${modelConfig.name} returned invalid categorizations format`);
          continue;
        }

        // Success! We have valid categorizations
        categorizations = result.categorizations;
        successfulModel = modelConfig.name;
        console.log(`✅ ${modelConfig.name} successfully returned ${categorizations.length} categorizations`);
        break;
        
      } catch (parseError) {
        console.error(`❌ ${modelConfig.name} parsing error:`, parseError instanceof Error ? parseError.message : String(parseError));
        console.log(`⚠️ Trying next model due to parsing failure...`);
        continue;
      }
    }

    // If all models failed
    if (!categorizations || categorizations.length === 0) {
      console.error('❌ All models failed to return valid categorizations');
      
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

    console.log(`✅ Successfully categorized using ${successfulModel}`);

    let successCount = 0;
    const accountCodeMap = new Map(
      chartOfAccounts.map(acc => [acc.account_code, acc.id])
    );

    for (const cat of categorizations) {
      const accountId = accountCodeMap.get(cat.account_code);
      if (!accountId) {
        console.warn(`Invalid account code: ${cat.account_code}`);
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
        .eq('id', cat.sale_id)
        .eq('restaurant_id', restaurantId);

      if (updateError) {
        console.error(`Error updating sale ${cat.sale_id}:`, updateError);
      } else {
        successCount++;
      }
    }

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
