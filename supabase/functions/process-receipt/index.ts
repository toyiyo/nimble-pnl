import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface ReceiptProcessRequest {
  receiptId: string;
  imageData: string; // base64 encoded image OR URL for PDF
  isPDF?: boolean; // Flag to indicate if it's a PDF
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
    const { receiptId, imageData, isPDF }: ReceiptProcessRequest = await req.json();
    
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

    console.log('🧾 Processing receipt with Mistral AI (preferred for OCR)...');
    console.log('📸 Image data type:', isPDF ? 'PDF URL' : 'Base64 image', 'size:', imageData.length, 'characters');

    // Check if the data is a PDF (passed via flag now)
    const isProcessingPDF = isPDF || false;
    if (isProcessingPDF) {
      console.log('📄 PDF detected, will use OpenRouter PDF processing engine');
      console.log('📄 PDF URL being sent to OpenRouter:', imageData.substring(0, 200) + '...');
      
      // Test if the URL is accessible
      try {
        const testResponse = await fetch(imageData, { method: 'HEAD' });
        console.log('📄 PDF URL accessibility test:', testResponse.ok ? 'ACCESSIBLE ✅' : 'FAILED ❌', 'Status:', testResponse.status);
        if (!testResponse.ok) {
          return new Response(
            JSON.stringify({ 
              error: 'PDF URL is not accessible',
              details: `Status: ${testResponse.status}`,
              url: imageData.substring(0, 100) + '...'
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      } catch (testError) {
        console.error('📄 Failed to test PDF URL accessibility:', testError);
        return new Response(
          JSON.stringify({ 
            error: 'Failed to verify PDF URL accessibility',
            details: testError.message,
            url: imageData.substring(0, 100) + '...'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    let finalResponse: Response | undefined;
    
    // Try Mistral first with retry logic (better for OCR)
    console.log('🚀 Trying Mistral first...');
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries && (!finalResponse || !finalResponse.ok)) {
      try {
        console.log(`🔄 Mistral attempt ${retryCount + 1}/${maxRetries}...`);
        
        // Build request body with PDF plugin if needed
        const requestBody: any = {
          "model": "mistralai/mistral-small-3.2-24b-instruct:free",
          "messages": [
              {
                "role": "system",
                "content": `You are an expert receipt parser for restaurant inventory management specializing in food service receipts.

ANALYSIS TARGET: This receipt image contains itemized purchases for restaurant inventory.

EXTRACTION METHODOLOGY:
1. **Locate the itemized section** - Focus on the main purchase list (ignore headers, tax, totals, payment info)
2. **Extract ALL line items** - Every product purchase, even if formatting is unclear
3. **Identify key components**: Product name, quantity, unit of measure, price per item or total
4. **Expand abbreviations**: Common food service abbreviations (CHKN=Chicken, DNA=Banana, BROC=Broccoli, etc.)
5. **Standardize units**: Convert to standard restaurant units (lb, oz, case, each, gal, etc.)

CONFIDENCE SCORING MATRIX:
- **0.90-0.95**: Crystal clear text, complete information, standard formatting
- **0.80-0.89**: Readable with minor ambiguity in abbreviations or formatting  
- **0.65-0.79**: Partially clear, some guessing required for quantities or names
- **0.40-0.64**: Poor quality text, significant interpretation needed
- **0.20-0.39**: Very unclear, major uncertainty in parsing

PATTERN RECOGNITION:
- Weight-based: "BEEF CHUCK 2.34 LB @ $8.99/LB = $20.96"
- Case quantities: "TOMATOES 6/10# CASE $24.50"
- Simple format: "MILK 1 GAL $4.99"
- Abbreviated: "CHKN BRST BNLS 5LB $32.45"

SUPPLIER DETECTION:
Look for distributor indicators:
- Company stamps (Sysco, US Foods, Performance Food Group)
- "Distributed by" or "Packed for" text
- Supplier codes or route numbers

RESPONSE FORMAT (JSON ONLY):
{
  "vendor": "Exact vendor/supplier name from receipt",
  "totalAmount": numeric_total,
  "supplierInfo": {
    "name": "distributor name if detected",
    "code": "supplier code if visible",
    "confidence": 0.0-1.0
  },
  "lineItems": [
    {
      "rawText": "exact text from receipt",
      "parsedName": "standardized product name",
      "parsedQuantity": numeric_quantity,
      "parsedUnit": "standard_unit",
      "parsedPrice": numeric_price,
      "confidenceScore": realistic_score_0_to_1,
      "category": "estimated category (Produce, Meat, Dairy, etc.)"
    }
  ]
}

CRITICAL: Assign confidence scores based on actual text clarity, not wishful thinking.`
              },
              {
                "role": "user",
                "content": [
                  {
                    "type": "text",
                    "text": "Analyze this receipt carefully. Look for the itemized purchase section and extract ALL products with their quantities and prices. Focus on the main body of the receipt where individual items are listed, not the header or footer sections."
                  },
                  {
                    "type": isProcessingPDF ? "file" : "image_url",
                    ...(isProcessingPDF 
                      ? { "file": { "url": imageData } }
                      : { "image_url": { "url": imageData } }
                    )
                  }
                ]
              }
            ],
          "max_completion_tokens": 4000
        };

        // Add PDF processing plugin if file is a PDF
        if (isProcessingPDF) {
          requestBody.plugins = [
            {
              "id": "file-parser",
              "pdf": {
                "engine": "pdf-text"
              }
            }
          ];
        }

        const mistralResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openRouterApiKey}`,
            "HTTP-Referer": "https://ncdujvdgqtaunuyigflp.supabase.co",
            "X-Title": "EasyShiftHQ Receipt Parser",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody)
        });

        if (mistralResponse.ok) {
          finalResponse = mistralResponse;
          console.log('✅ Mistral succeeded');
          break;
        }

        // Rate limited - wait and retry
        if (mistralResponse.status === 429) {
          console.log(`🔄 Mistral rate limited (attempt ${retryCount + 1}/${maxRetries}), waiting before retry...`);
          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
          }
        } else {
          const errorText = await mistralResponse.text();
          console.error(`❌ Mistral failed (attempt ${retryCount + 1}):`, mistralResponse.status, errorText);
          console.error('❌ Full Mistral error response:', errorText);
          console.error('❌ Failed Mistral request config:', {
            url: 'https://openrouter.ai/api/v1/chat/completions',
            model: 'mistralai/mistral-small-3.2-24b-instruct:free',
            isPDF: isProcessingPDF,
            imageDataType: isProcessingPDF ? 'file URL' : 'image_url',
            imageDataLength: imageData.length
          });
          break;
        }
      } catch (error) {
        console.error(`❌ Mistral attempt ${retryCount + 1} failed:`, error);
        retryCount++;
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
        }
      }
    }

    // If Mistral failed after retries, try Grok as backup
    if (!finalResponse || !finalResponse.ok) {
      console.log('🔄 Mistral failed after retries, trying Grok as backup...');
      
      try {
        // Build request body with PDF plugin if needed
        const grokRequestBody: any = {
          "model": "x-ai/grok-4-fast:free",
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
    }
  ]
}

IMPORTANT: Vary confidence scores realistically based on actual text quality and parsing difficulty.`
              },
              {
                "role": "user",
                "content": [
                  {
                    "type": "text",
                    "text": "Analyze this receipt carefully. Look for the itemized purchase section and extract ALL products with their quantities and prices. Focus on the main body of the receipt where individual items are listed, not the header or footer sections."
                  },
                  {
                    "type": isProcessingPDF ? "file" : "image_url",
                    ...(isProcessingPDF 
                      ? { "file": { "url": imageData } }
                      : { "image_url": { "url": imageData } }
                    )
                  }
                ]
              }
            ],
          "max_tokens": 4000,
          "temperature": 0.1
        };

        // Add PDF processing plugin if file is a PDF
        if (isProcessingPDF) {
          grokRequestBody.plugins = [
            {
              "id": "file-parser",
              "pdf": {
                "engine": "pdf-text"
              }
            }
          ];
        }

        const grokResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openRouterApiKey}`,
            "HTTP-Referer": "https://ncdujvdgqtaunuyigflp.supabase.co",
            "X-Title": "EasyShiftHQ Receipt Parser (Grok Backup)",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(grokRequestBody)
        });

        if (grokResponse.ok) {
          finalResponse = grokResponse;
          console.log('✅ Grok backup succeeded');
        } else {
          const grokErrorText = await grokResponse.text();
          console.error('❌ Grok backup failed:', grokResponse.status, grokErrorText);
        }
      } catch (grokError) {
        console.error('❌ Grok backup error:', grokError);
      }
    }

    // If both services failed
    if (!finalResponse || !finalResponse.ok) {
      console.error('❌ Both Grok and Mistral failed');
      
      return new Response(
        JSON.stringify({ 
          error: 'Receipt processing temporarily unavailable due to API limits. Please try again in a few minutes.',
          details: 'Both AI services are currently unavailable'
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 503 
        }
      );
    }

    const data = await finalResponse.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      console.error('Invalid response structure:', data);
      return new Response(
        JSON.stringify({ error: 'Invalid response from AI service' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      );
    }

    const content = data.choices[0].message.content;
    console.log('✅ AI parsing completed. Raw response:', content);

    let parsedData;
    try {
      // Enhanced parsing with better error handling
      let jsonContent = content.trim();
      
      // Remove markdown code blocks if present
      jsonContent = jsonContent.replace(/```json\s*/, '').replace(/```\s*$/, '');
      jsonContent = jsonContent.replace(/```[\w]*\s*/, '').replace(/```\s*$/, '');
      
      // Extract JSON between first { and last }
      const firstBrace = jsonContent.indexOf('{');
      const lastBrace = jsonContent.lastIndexOf('}');
      
      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error('No JSON structure found in response');
      }
      
      jsonContent = jsonContent.substring(firstBrace, lastBrace + 1);
      
      // Fix common JSON issues
      jsonContent = jsonContent.replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas
      jsonContent = jsonContent.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3'); // Quote unquoted keys
      
      // Try to parse the cleaned JSON
      parsedData = JSON.parse(jsonContent);
      
      // Enhanced validation for required structure
      if (!parsedData.lineItems || !Array.isArray(parsedData.lineItems)) {
        throw new Error('Invalid JSON structure: missing or invalid lineItems array');
      }

      // Validate each line item has required fields
      parsedData.lineItems.forEach((item: any, index: number) => {
        if (!item.parsedName || typeof item.parsedQuantity !== 'number' || typeof item.parsedPrice !== 'number') {
          console.warn(`Line item ${index} missing required fields:`, item);
        }
        // Ensure confidence score is within valid range
        if (item.confidenceScore > 1.0) item.confidenceScore = 1.0;
        if (item.confidenceScore < 0.0) item.confidenceScore = 0.0;
      });
      
    } catch (parseError) {
      console.error('Failed to parse JSON from AI response:', parseError);
      console.error('Content that failed to parse:', content.substring(0, 1000) + '...');
      
      // Create fallback structured response from raw content
      const fallbackData = {
        vendor: 'Unknown Vendor',
        totalAmount: 0,
        lineItems: [{
          rawText: content.substring(0, 200),
          parsedName: 'Unable to parse receipt',
          parsedQuantity: 1,
          parsedUnit: 'each',
          parsedPrice: 0,
          confidenceScore: 0.1,
          category: 'Other'
        }]
      };
      
      return new Response(
        JSON.stringify({ 
          error: 'Failed to parse receipt data. Using fallback parsing.',
          details: parseError instanceof Error ? parseError.message : String(parseError),
          fallbackData: fallbackData
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

    // Insert line items with sequence to preserve order
    const lineItems = parsedData.lineItems.map((item: ParsedLineItem, index: number) => ({
      receipt_id: receiptId,
      raw_text: item.rawText,
      parsed_name: item.parsedName,
      parsed_quantity: item.parsedQuantity,
      parsed_unit: item.parsedUnit,
      parsed_price: item.parsedPrice,
      confidence_score: item.confidenceScore,
      line_sequence: index + 1
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
        error: 'An unexpected error occurred while processing the receipt',
        details: error instanceof Error ? error.message : String(error)
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});