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
                "text": "You are an expert OCR system specialized in food packaging and product labels for restaurant inventory management.\n\nAnalyze this image and extract ALL visible text with special attention to:\n\n**CRITICAL INFORMATION:**\n1. Product name and brand (usually largest text)\n2. Package sizes: weights (oz, lb, g, kg), volumes (ml, L, fl oz), counts (ct, pack)\n3. Supplier/distributor codes or names (often in small print)\n4. Batch numbers, lot codes, expiration dates\n5. Nutritional information numbers\n6. Ingredient lists\n7. Barcode/UPC codes if visible\n\n**EXTRACTION RULES:**\n- Preserve exact spelling and capitalization\n- Include ALL numbers with their units\n- Note text hierarchy (large → small)\n- Extract any supplier stamps or distributor marks\n- Look for 'Distributed by' or 'Packed for' text\n- Include route numbers or warehouse codes\n\n**SUPPLIER DETECTION:**\nLook specifically for:\n- Company logos/names (Sysco, US Foods, Performance Food Group, etc.)\n- Distributor stamps or codes\n- Supplier SKU numbers\n- Route delivery information\n\n**FORMAT:** Return structured text maintaining visual layout:\nBRAND: [brand name]\nPRODUCT: [product name]\nSIZE: [size with units]\nSUPPLIER: [if visible]\nDISTRIBUTOR: [if visible]\nBATCH/LOT: [if visible]\nUPC/BARCODE: [if visible]\nOTHER: [remaining text]\n\nBe thorough - small text often contains critical supplier and batch information for inventory management."
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