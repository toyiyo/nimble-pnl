import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RecipeEnhanceRequest {
  itemName: string;
  itemDescription?: string;
  availableIngredients: Array<{
    id: string;
    name: string;
    uom_recipe: string;
  }>;
}

// Shared analysis prompt for all models
const RECIPE_ANALYSIS_PROMPT = (itemName: string, itemDescription: string, availableIngredients: string, validUnits: string[]) => `You are a professional chef and recipe expert. Based on the menu item "${itemName}"${itemDescription ? ` with description: "${itemDescription}"` : ''}, create a realistic recipe using only ingredients from the available inventory list below.

Available Ingredients:
${availableIngredients}

IMPORTANT: For the "unit" field, you must use one of these valid measurement units only: ${validUnits.join(', ')}.
Choose the most appropriate unit for each ingredient based on typical recipe measurements.

Please respond with a JSON object containing:
{
  "recipeName": "Suggested recipe name",
  "servingSize": 1,
  "ingredients": [
    {
      "ingredientName": "exact name from the available ingredients list",
      "quantity": number,
      "unit": "one of: oz, ml, cup, tbsp, tsp, lb, kg, g, bottle, can, bag, box, piece, serving"
    }
  ],
  "confidence": number between 0-1,
  "reasoning": "brief explanation of your choices"
}

Only suggest ingredients that are actually in the available ingredients list. Use realistic quantities and appropriate measurement units for cooking. If you cannot create a reasonable recipe with the available ingredients, set confidence to 0 and explain why in the reasoning.`;

// Model configurations
const MODELS = [
  {
    name: "DeepSeek V3.1",
    id: "deepseek/deepseek-chat-v3.1:free",
    systemPrompt: "You are a professional chef and recipe consultant using DeepSeek V3.1. Always respond with valid JSON only.",
    maxRetries: 3
  },
  {
    name: "Mistral Small",
    id: "mistralai/mistral-small-3.2-24b-instruct:free",
    systemPrompt: "You are a professional chef and recipe consultant. Always respond with valid JSON only.",
    maxRetries: 1
  },
  {
    name: "Grok 4 Fast",
    id: "x-ai/grok-4-fast:free",
    systemPrompt: "You are a professional chef and recipe consultant. Always respond with valid JSON only.",
    maxRetries: 1
  }
];

// Helper function to build consistent request bodies
function buildRecipeRequestBody(
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
  openRouterApiKey: string
): Promise<Response | null> {
  let retryCount = 0;
  
  while (retryCount < modelConfig.maxRetries) {
    try {
      console.log(`🔄 ${modelConfig.name} attempt ${retryCount + 1}/${modelConfig.maxRetries}...`);
      
      const requestBody = buildRecipeRequestBody(
        modelConfig.id,
        modelConfig.systemPrompt,
        prompt
      );

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://app.easyshifthq.com",
          "X-Title": "EasyShiftHQ Recipe Enhancement",
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
    const { itemName, itemDescription, availableIngredients }: RecipeEnhanceRequest = await req.json();

    const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!openRouterApiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured');
    }

    const ingredientsList = availableIngredients.map(ing => 
      `- ${ing.name} (measured in ${ing.uom_recipe})`
    ).join('\n');

    const validUnits = ['oz', 'ml', 'cup', 'tbsp', 'tsp', 'lb', 'kg', 'g', 'bottle', 'can', 'bag', 'box', 'piece', 'serving'];
    
    const prompt = RECIPE_ANALYSIS_PROMPT(itemName, itemDescription || '', ingredientsList, validUnits);

    console.log('🚀 Starting recipe enhancement with 3-model fallback...');

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
          error: 'Recipe enhancement temporarily unavailable. All AI models failed.',
          details: 'DeepSeek, Mistral, and Grok are currently unavailable'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 503 
        }
      );
    }

    const data = await finalResponse.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response from OpenRouter API');
    }

    const content = data.choices[0].message.content;
    
    try {
      // Clean up the response to extract JSON with better error handling
      let jsonContent = content.trim();
      
      // Remove markdown code blocks if present
      jsonContent = jsonContent.replace(/```json\s*/, '').replace(/```\s*$/, '');
      
      // Extract JSON between first { and last }
      const firstBrace = jsonContent.indexOf('{');
      const lastBrace = jsonContent.lastIndexOf('}');
      
      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error('No JSON structure found in response');
      }
      
      jsonContent = jsonContent.substring(firstBrace, lastBrace + 1);
      
      // Attempt to fix common JSON issues
      // Remove trailing commas before closing brackets/braces
      jsonContent = jsonContent.replace(/,(\s*[}\]])/g, '$1');
      
      const recipeData = JSON.parse(jsonContent);
      
      // Validate and fix measurement units
      if (recipeData.ingredients && Array.isArray(recipeData.ingredients)) {
        const validUnits = ['oz', 'ml', 'cup', 'tbsp', 'tsp', 'lb', 'kg', 'g', 'bottle', 'can', 'bag', 'box', 'piece', 'serving'];
        
        recipeData.ingredients = recipeData.ingredients.map((ingredient: any) => ({
          ...ingredient,
          unit: validUnits.includes(ingredient.unit) ? ingredient.unit : 'piece'
        }));
      }
      
      return new Response(JSON.stringify({
        success: true,
        recipe: recipeData
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (parseError) {
      console.error('Failed to parse JSON response:', content);
      throw new Error('Failed to parse recipe data from AI response');
    }

  } catch (error: any) {
    console.error('Error in grok-recipe-enhance function:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});