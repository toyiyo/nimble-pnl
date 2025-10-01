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

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!openRouterApiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    const { itemName, itemDescription, availableIngredients }: RecipeEnhanceRequest = await req.json();

    const ingredientsList = availableIngredients.map(ing => 
      `- ${ing.name} (measured in ${ing.uom_recipe})`
    ).join('\n');

    const validUnits = ['oz', 'ml', 'cup', 'tbsp', 'tsp', 'lb', 'kg', 'g', 'bottle', 'can', 'bag', 'box', 'piece', 'serving'];
    
    const prompt = `You are a professional chef and recipe expert. Based on the menu item "${itemName}"${itemDescription ? ` with description: "${itemDescription}"` : ''}, create a realistic recipe using only ingredients from the available inventory list below.

Available Ingredients:
${ingredientsList}

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

    console.log('🧑‍🍳 Enhancing recipe with AI...');

    // Use Mistral first with retry logic, then Grok as backup
    let response: Response | undefined;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://ncdujvdgqtaunuyigflp.supabase.co',
            'X-Title': 'EasyShiftHQ Recipe Enhancement'
          },
          body: JSON.stringify({
            model: 'deepseek/deepseek-chat-v3.1:free',
            messages: [
              {
                role: 'system',
                content: 'You are a professional chef and recipe consultant using DeepSeek V3.1. Always respond with valid JSON only.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.3,
            max_tokens: 1000
          }),
        });

        if (response.ok) {
          console.log('✅ DeepSeek V3.1 succeeded');
          break;
        }

        if (response.status === 429) {
          console.log(`🔄 Rate limited (attempt ${retryCount + 1}/${maxRetries}), waiting before retry...`);
          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
          }
        } else {
          break;
        }
      } catch (error) {
        console.error(`DeepSeek attempt ${retryCount + 1} failed:`, error);
        retryCount++;
        if (retryCount >= maxRetries) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      }
    }

    // Try Grok as backup if DeepSeek failed
    if (!response || !response.ok) {
      console.log('🔄 DeepSeek failed, trying Grok as backup...');
      
      try {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openRouterApiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://ncdujvdgqtaunuyigflp.supabase.co',
            'X-Title': 'EasyShiftHQ Recipe Enhancement (Grok Backup)'
          },
          body: JSON.stringify({
            model: 'x-ai/grok-4-fast:free',
            messages: [
              {
                role: 'system',
                content: 'You are a professional chef and recipe consultant. Always respond with valid JSON only.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.3,
            max_tokens: 1000
          }),
        });

        if (response.ok) {
          console.log('✅ Grok backup succeeded');
        }
      } catch (grokError) {
        console.error('❌ Grok backup error:', grokError);
      }
    }

    // If both DeepSeek and Grok failed
    if (!response || !response.ok) {
      const errorMessage = response ? `API error: ${response.status} ${response.statusText}` : 'Failed to get response from both DeepSeek and Grok';
      const errorText = response ? await response.text() : '';
      console.error('OpenRouter API error:', errorMessage, errorText);
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
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