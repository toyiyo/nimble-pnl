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

    console.log('Enhancing recipe for:', itemName);

    const ingredientsList = availableIngredients.map(ing => 
      `- ${ing.name} (measured in ${ing.uom_recipe})`
    ).join('\n');

    const prompt = `You are a professional chef and recipe expert. Based on the menu item "${itemName}"${itemDescription ? ` with description: "${itemDescription}"` : ''}, create a realistic recipe using only ingredients from the available inventory list below.

Available Ingredients:
${ingredientsList}

Please respond with a JSON object containing:
{
  "recipeName": "Suggested recipe name",
  "servingSize": 1,
  "ingredients": [
    {
      "ingredientName": "exact name from the available ingredients list",
      "quantity": number,
      "unit": "unit from the available ingredients list"
    }
  ],
  "confidence": number between 0-1,
  "reasoning": "brief explanation of your choices"
}

Only suggest ingredients that are actually in the available ingredients list. If you cannot create a reasonable recipe with the available ingredients, set confidence to 0 and explain why in the reasoning.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://lovable.dev',
        'X-Title': 'Recipe Enhancement'
      },
      body: JSON.stringify({
        model: 'x-ai/grok-beta',
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', response.status, errorText);
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response from OpenRouter API');
    }

    const content = data.choices[0].message.content;
    
    try {
      const recipeData = JSON.parse(content);
      
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