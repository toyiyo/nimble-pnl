import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { logAICall, extractTokenUsage, type AICallMetadata } from "../_shared/braintrust.ts";

const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Shared analysis prompt for all models
const PRODUCT_ENHANCEMENT_PROMPT = (searchText: string, productName: string, brand: string, category: string, currentDescription: string) => `
Analyze this product information and extract structured data:

Search Results: ${searchText}
Product Name: ${productName}
Brand: ${brand}
Category: ${category}
Current Description: ${currentDescription}

Return ONLY valid JSON (no markdown, no explanations):
{
  "description": "concise 2-3 sentence description",
  "nutritionalInfo": "key nutritional facts if food product, otherwise null",
  "ingredients": "ingredient list if food product, otherwise null",
  "allergens": ["array", "of", "common", "allergens"] or null,
  "shelfLife": "typical shelf life if applicable, otherwise null",
  "storageInstructions": "storage requirements if applicable, otherwise null"
}

CRITICAL RULES:
- Keep descriptions professional and concise
- Only include nutritional/ingredient info for food products
- Return null for non-applicable fields
- Use proper JSON formatting
`;

// Model configurations (prioritized by reliability)
const MODELS = [
  // Primary models
  {
    name: "Llama 4 Maverick",
    id: "meta-llama/llama-4-maverick",
    systemPrompt: "You are an expert product data analyst. Return only valid JSON.",
    maxRetries: 2
  },
  {
    name: "Gemma 3 27B",
    id: "google/gemma-3-27b-it",
    systemPrompt: "You are an expert product data analyst. Return only valid JSON.",
    maxRetries: 2
  },
  // Paid models (fallback)
  {
    name: "Gemini 2.5 Flash Lite",
    id: "google/gemini-2.5-flash-lite",
    systemPrompt: "You are an expert product data analyst. Return only valid JSON.",
    maxRetries: 1
  },
  {
    name: "GPT-4.1 Nano",
    id: "openai/gpt-4.1-nano",
    systemPrompt: "You are an expert product data analyst. Return only valid JSON.",
    maxRetries: 1
  }
];

// Helper function to build consistent request bodies
function buildProductRequestBody(
  modelId: string,
  systemPrompt: string,
  prompt: string
): any {
  return {
    model: modelId,
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: prompt
      }
    ]
  };
}

// Generic function to call a model with retries
async function callModel(
  modelConfig: typeof MODELS[0],
  prompt: string,
  openRouterApiKey: string,
  restaurantId?: string
): Promise<Response | null> {
  let retryCount = 0;
  
  while (retryCount < modelConfig.maxRetries) {
    try {
      console.log(`🔄 ${modelConfig.name} attempt ${retryCount + 1}/${modelConfig.maxRetries}...`);
      
      const requestBody = buildProductRequestBody(
        modelConfig.id,
        modelConfig.systemPrompt,
        prompt
      );

      const metadata: AICallMetadata = {
        model: modelConfig.id,
        provider: "openrouter",
        restaurant_id: restaurantId,
        edge_function: 'enhance-product-ai',
        temperature: requestBody.temperature,
        max_tokens: requestBody.max_tokens,
        stream: false,
        attempt: retryCount + 1,
        success: false,
      };

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://app.easyshifthq.com",
          "X-Title": "EasyShiftHQ Product Enhancement",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        console.log(`✅ ${modelConfig.name} succeeded`);
        
        // Log success
        try {
          const clonedResponse = response.clone();
          const data = await clonedResponse.json();
          const tokenUsage = extractTokenUsage(data);
          logAICall(
            'enhance-product-ai:success',
            { model: modelConfig.id },
            { status: 'success' },
            { ...metadata, success: true, status_code: 200 },
            tokenUsage
          );
        } catch (e) {
          // Continue if logging fails
          console.log('[Braintrust] Could not extract response data for logging');
        }
        
        return response;
      }

      if (response.status === 429 && retryCount < modelConfig.maxRetries - 1) {
        console.log(`🔄 ${modelConfig.name} rate limited, waiting before retry...`);
        
        logAICall(
          'enhance-product-ai:rate_limit',
          { model: modelConfig.id },
          null,
          { ...metadata, success: false, status_code: 429, error: 'Rate limited' },
          null
        );
        
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount + 1) * 1000));
        retryCount++;
      } else {
        const errorText = await response.text();
        console.error(`❌ ${modelConfig.name} failed:`, response.status, errorText);
        
        logAICall(
          'enhance-product-ai:error',
          { model: modelConfig.id },
          null,
          { ...metadata, success: false, status_code: response.status, error: errorText },
          null
        );
        
        break;
      }
    } catch (error) {
      console.error(`❌ ${modelConfig.name} error:`, error);
      
      logAICall(
        'enhance-product-ai:error',
        { model: modelConfig.id },
        null,
        {
          model: modelConfig.id,
          provider: "openrouter",
          restaurant_id: restaurantId,
          edge_function: 'enhance-product-ai',
          stream: false,
          attempt: retryCount + 1,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        },
        null
      );
      
      retryCount++;
      if (retryCount < modelConfig.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      }
    }
  }
  
  return null;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { searchText, productName, brand, category, currentDescription } = await req.json();

    if (!openRouterApiKey) {
      console.error('OpenRouter API key not found');
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const prompt = PRODUCT_ENHANCEMENT_PROMPT(searchText, productName, brand || 'Unknown', category || 'Unknown', currentDescription || 'None');

    console.log('🚀 Starting product enhancement with 3-model fallback...');

    let finalResponse: Response | undefined;

    // Try models in order: DeepSeek -> Mistral -> Grok
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

    // If all models failed
    if (!finalResponse || !finalResponse.ok) {
      console.error('❌ All models (DeepSeek, Mistral, Grok) failed');
      
      return new Response(
        JSON.stringify({ 
          error: 'Product enhancement temporarily unavailable. All AI models failed.',
          details: 'DeepSeek, Mistral, and Grok are currently unavailable'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 503 
        }
      );
    }

    const data = await finalResponse.json();
    let enhancedText = data.choices[0].message.content;

    // Strip markdown code blocks if present
    if (enhancedText.includes('```')) {
      const jsonMatch = enhancedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        enhancedText = jsonMatch[1];
      }
    }

    try {
      const enhancedData = JSON.parse(enhancedText.trim());
      console.log('✅ Successfully enhanced product data:', enhancedData);
      
      return new Response(JSON.stringify({ enhancedData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (parseError) {
      console.error('Failed to parse AI response:', enhancedText);
      return new Response(JSON.stringify({ error: 'Invalid AI response format' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    console.error('Error in enhance-product-ai function:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});