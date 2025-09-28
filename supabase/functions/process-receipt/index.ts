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

    // Use Mistral for receipt parsing with better OCR performance and retry logic
    let response: Response | undefined;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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

CONFIDENCE SCORING (CRITICAL):
- Assign realistic confidence scores based on text clarity and completeness
- High confidence (0.85-0.95): Clear, complete text with obvious product name, quantity, and price
- Medium confidence (0.65-0.84): Readable but some ambiguity in parsing or abbreviations  
- Low confidence (0.40-0.64): Partially readable, significant guessing required
- Very low confidence (0.20-0.39): Poor quality text, major uncertainty

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
      "confidenceScore": 0.92
    },
    {
      "rawText": "CHKN BRST $12.99", 
      "parsedName": "Chicken Breast",
      "parsedQuantity": 1,
      "parsedUnit": "each",
      "parsedPrice": 12.99,
      "confidenceScore": 0.78
  ]
}

IMPORTANT: Vary confidence scores realistically based on actual text quality and parsing difficulty.`
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
            "max_completion_tokens": 4000
          })
        });

        // If successful, break
        if (response.ok) {
          break;
        }

        // Rate limited - wait and retry
        if (response.status === 429) {
          console.log(`🔄 Rate limited (attempt ${retryCount + 1}/${maxRetries}), waiting before retry...`);
          retryCount++;
          if (retryCount < maxRetries) {
            // Exponential backoff: wait 2^retryCount seconds
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
          }
        } else {
          // Non-retryable error, break
          break;
        }
      } catch (error) {
        console.error(`Attempt ${retryCount + 1} failed:`, error);
        retryCount++;
        if (retryCount >= maxRetries) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      }
    }

    // If we still don't have a successful response after all retries
    if (!response) {
      return new Response(
        JSON.stringify({ error: 'Failed to get response from OpenRouter API after retries' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      );
    }

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
      
      // Try to parse the cleaned JSON
      parsedData = JSON.parse(jsonContent);
      
      // Validate required structure
      if (!parsedData.lineItems || !Array.isArray(parsedData.lineItems)) {
        throw new Error('Invalid JSON structure: missing or invalid lineItems array');
      }
      
    } catch (parseError) {
      console.error('Failed to parse JSON from Mistral response:', parseError);
      console.error('Content that failed to parse:', content.substring(0, 1000) + '...');
      
      // Fallback: try to extract partial data if possible
      try {
        const partialMatch = content.match(/"vendor":\s*"([^"]*)"[\s\S]*"totalAmount":\s*([0-9.]+)/);
        if (partialMatch) {
          console.log('🔄 Attempting partial parsing fallback...');
          return new Response(
            JSON.stringify({ 
              error: 'Partial parsing failed - please try uploading the receipt again',
              vendor: partialMatch[1],
              totalAmount: parseFloat(partialMatch[2])
            }),
            { 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 422 
            }
          );
        }
      } catch (fallbackError) {
        console.error('Fallback parsing also failed:', fallbackError);
      }
      
      return new Response(
        JSON.stringify({ 
          error: 'Failed to parse receipt data. The AI response was malformed. Please try again.',
          details: parseError instanceof Error ? parseError.message : String(parseError)
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 422 
        }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get receipt info to find restaurant_id
    const { data: receiptInfo, error: receiptInfoError } = await supabase
      .from('receipt_imports')
      .select('restaurant_id')
      .eq('id', receiptId)
      .single();

    if (receiptInfoError || !receiptInfo) {
      console.error('Error fetching receipt info:', receiptInfoError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch receipt info' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      );
    }

    // Find or create supplier
    let supplierId: string | null = null;
    if (parsedData.vendor) {
      // Try to find existing supplier
      const { data: existingSupplier } = await supabase
        .from('suppliers')
        .select('id')
        .eq('restaurant_id', receiptInfo.restaurant_id)
        .eq('name', parsedData.vendor)
        .single();

      if (existingSupplier) {
        supplierId = existingSupplier.id;
      } else {
        // Create new supplier
        const { data: newSupplier, error: supplierError } = await supabase
          .from('suppliers')
          .insert({
            restaurant_id: receiptInfo.restaurant_id,
            name: parsedData.vendor,
            is_active: true
          })
          .select('id')
          .single();

        if (!supplierError && newSupplier) {
          supplierId = newSupplier.id;
        }
      }
    }

    // Update receipt with parsed data and supplier
    const { error: updateError } = await supabase
      .from('receipt_imports')
      .update({
        vendor_name: parsedData.vendor,
        total_amount: parsedData.totalAmount,
        raw_ocr_data: parsedData,
        status: 'processed',
        processed_at: new Date().toISOString(),
        supplier_id: supplierId
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