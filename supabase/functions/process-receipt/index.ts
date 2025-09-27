import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface ReceiptProcessRequest {
  receiptId: string;
  imageData: string; // base64 encoded image
}

interface ParsedLineItem {
  rawText: string;
  parsedName: string;
  parsedQuantity: number;
  parsedUnit: string;
  parsedPrice: number;
  confidenceScore: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { receiptId, imageData }: ReceiptProcessRequest = await req.json();
    
    if (!receiptId || !imageData) {
      return new Response(
        JSON.stringify({ error: 'Receipt ID and image data are required' }),
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

    console.log('🧾 Processing receipt with Mistral AI...');

    // Use Mistral for receipt parsing with better OCR performance
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openRouterApiKey}`,
        "HTTP-Referer": "https://ncdujvdgqtaunuyigflp.supabase.co",
        "X-Title": "EasyShiftHQ Receipt Parser",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "model": "mistralai/mistral-small-3.2-24b-instruct:free",
        "messages": [
          {
            "role": "system",
            "content": `You are an expert receipt parser for restaurant inventory management. Your job is to carefully analyze this receipt image and extract ALL purchasable items.

CRITICAL INSTRUCTIONS:
1. Look for the main itemized section of the receipt (not headers, totals, or tax lines)
2. Extract EVERY line item that represents a product purchase
3. Include items even if prices seem unusual or formatting is unclear
4. For each item, identify: product name, quantity, unit of measure, and price
5. Expand common abbreviations (DNA=Banana, CHKN=Chicken, etc.)
6. If quantity isn't explicit, assume 1 unit
7. If unit isn't clear, use "each" as default

LOOK FOR THESE PATTERNS:
- Product lines with prices (e.g., "BANANAS 5 LB @ 0.68/LB $3.40")
- Simple format (e.g., "Milk Gallon $4.99")
- Abbreviated items (e.g., "CHKN BRST $12.99")
- Weight-based items (e.g., "BEEF 2.34 LB @ $8.99/LB")

IGNORE: Tax lines, subtotals, payment methods, store info, promotions

Return ONLY valid JSON in this exact format:
{
  "vendor": "Store Name",
  "totalAmount": 45.67,
  "lineItems": [
    {
      "rawText": "BANANAS 5 LB @ 0.68/LB $3.40",
      "parsedName": "Bananas",
      "parsedQuantity": 5,
      "parsedUnit": "lb",
      "parsedPrice": 3.40,
      "confidenceScore": 0.9
    }
  ]
}

IMPORTANT: Even if you're uncertain, include items that look like products. Better to include too many than too few.`
          },
          {
            "role": "user",
            "content": [
              {
                "type": "text",
                "text": "Analyze this receipt image carefully. Look for the itemized purchase section and extract ALL products with their quantities and prices. Focus on the main body of the receipt where individual items are listed, not the header or footer sections."
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
        "max_completion_tokens": 2000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter API error details:');
      console.error('Status:', response.status);
      console.error('Status Text:', response.statusText);
      console.error('Error Response:', errorText);
      console.error('Request Headers:', JSON.stringify({
        "Authorization": "Bearer [REDACTED]",
        "HTTP-Referer": "https://ncdujvdgqtaunuyigflp.supabase.co",
        "X-Title": "EasyShiftHQ Receipt Parser",
        "Content-Type": "application/json"
      }));
      console.error('Model used:', "mistralai/mistral-small-3.1-24b-instruct:free");
      
      return new Response(
        JSON.stringify({ 
          error: `OpenRouter API error: ${response.status} - ${response.statusText}`,
          details: errorText 
        }),
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

    const content = data.choices[0].message.content;
    console.log('✅ Mistral parsing completed. Raw response:', content);

    let parsedData;
    try {
      // Clean up the response to extract JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      parsedData = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse JSON from Mistral response:', parseError);
      return new Response(
        JSON.stringify({ error: 'Failed to parse receipt data' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Update receipt with parsed data
    const { error: updateError } = await supabase
      .from('receipt_imports')
      .update({
        vendor_name: parsedData.vendor,
        total_amount: parsedData.totalAmount,
        raw_ocr_data: parsedData,
        status: 'processed',
        processed_at: new Date().toISOString()
      })
      .eq('id', receiptId);

    if (updateError) {
      console.error('Error updating receipt:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update receipt' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      );
    }

    // Insert line items
    const lineItems = parsedData.lineItems.map((item: ParsedLineItem) => ({
      receipt_id: receiptId,
      raw_text: item.rawText,
      parsed_name: item.parsedName,
      parsed_quantity: item.parsedQuantity,
      parsed_unit: item.parsedUnit,
      parsed_price: item.parsedPrice,
      confidence_score: item.confidenceScore
    }));

    const { error: lineItemsError } = await supabase
      .from('receipt_line_items')
      .insert(lineItems);

    if (lineItemsError) {
      console.error('Error inserting line items:', lineItemsError);
      return new Response(
        JSON.stringify({ error: 'Failed to insert line items' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        vendor: parsedData.vendor,
        totalAmount: parsedData.totalAmount,
        lineItemsCount: lineItems.length
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in process-receipt function:', error);
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