import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface OCRRequest {
  imageData: string; // base64 encoded image
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageData }: OCRRequest = await req.json();
    
    if (!imageData) {
      return new Response(
        JSON.stringify({ error: 'Image data is required' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }

    const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!openRouterApiKey) {
      return new Response(
        JSON.stringify({ error: 'OpenRouter API key not configured' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      );
    }

    console.log('🔍 Processing image with Grok OCR...');

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openRouterApiKey}`,
        "HTTP-Referer": "https://ncdujvdgqtaunuyigflp.supabase.co",
        "X-Title": "EasyShiftHQ Inventory OCR",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "model": "x-ai/grok-4-fast:free",
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "type": "text",
                "text": "Extract ALL text from this product package/label image. Focus on:\n1. Product name and brand\n2. Sizes, quantities, weights (oz, ml, g, kg, etc.)\n3. All visible text including small print\n4. Numbers and measurements\n\nReturn ONLY the extracted text, one item per line, maintaining the visual hierarchy as much as possible."
              },
              {
                "type": "image_url",
                "image_url": {
                  "url": imageData
                }
              }
            ]
          }
        ],
        "max_tokens": 500,
        "temperature": 0.1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error:', response.status, errorText);
      return new Response(
        JSON.stringify({ error: `OpenRouter API error: ${response.status}` }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: response.status 
        }
      );
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('Invalid response structure:', data);
      return new Response(
        JSON.stringify({ error: 'Invalid response from OpenRouter API' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      );
    }

    const extractedText = data.choices[0].message.content || '';
    console.log('✅ Grok OCR completed. Extracted text:', extractedText);

    // Calculate a confidence score based on text length and structure
    let confidence = 0.8; // Default confidence for Grok
    if (extractedText.length > 50) confidence = 0.9;
    if (extractedText.length > 100) confidence = 0.95;
    if (extractedText.length === 0) confidence = 0.1;

    return new Response(
      JSON.stringify({ 
        text: extractedText,
        confidence: confidence,
        source: 'grok-4-fast'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in grok-ocr function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});