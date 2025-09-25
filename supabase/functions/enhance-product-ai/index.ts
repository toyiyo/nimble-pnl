import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const prompt = `Based on the following search results about a product, extract and enhance the product information:

Product Name: ${productName}
Brand: ${brand || 'Unknown'}
Category: ${category || 'Unknown'}
Current Description: ${currentDescription || 'None'}

Search Results Text: ${searchText}

Please extract and return ONLY a JSON object with the following structure (no additional text):
{
  "description": "Enhanced product description (2-3 sentences, informative and professional)",
  "brand": "Confirmed brand name if found",
  "category": "Refined category classification",
  "nutritionalInfo": "Brief nutritional summary if applicable",
  "ingredients": ["ingredient1", "ingredient2"] (if food product),
  "packageSize": "Package size information if found",
  "manufacturer": "Manufacturer name if different from brand"
}

Only include fields where you have confident information from the search results. Return empty object {} if no reliable information can be extracted.`;

    console.log('🤖 Calling Grok for product enhancement');

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterApiKey}`,
        'HTTP-Referer': 'https://ncdujvdgqtaunuyigflp.supabase.co',
        'X-Title': 'EasyShiftHQ Product Enhancement',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'x-ai/grok-4-fast:free',
        messages: [
          { role: 'system', content: 'You are a product data enhancement expert. Extract and enhance product information from search results. Always respond with valid JSON only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 500
      }),
    });

    if (!response.ok) {
      throw new Error(`Grok API error: ${response.statusText}`);
    }

    const data = await response.json();
    const enhancedText = data.choices[0].message.content;

    try {
      const enhancedData = JSON.parse(enhancedText);
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