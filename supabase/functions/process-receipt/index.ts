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

    console.log('🧾 Processing receipt with DeepSeek AI (free model)...');
    console.log('📸 Image data type:', isPDF ? 'PDF' : 'Base64 image', 'size:', imageData.length, 'characters');

    // Check if the data is a PDF
    const isProcessingPDF = isPDF || false;
    let pdfBase64Data = imageData;
    
    if (isProcessingPDF && !imageData.startsWith('data:application/pdf;base64,')) {
      console.log('📄 PDF URL detected, converting to base64...');
      
      // Create abort controller for fetch timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 20000); // 20 second timeout
      
      try {
        const pdfResponse = await fetch(imageData, { signal: controller.signal });
        clearTimeout(timeoutId); // Clear timeout on successful fetch
        
        if (!pdfResponse.ok) {
          throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);
        }
        const pdfBlob = await pdfResponse.arrayBuffer();
        
        // Convert to base64 in chunks to avoid call stack issues with large PDFs
        const uint8Array = new Uint8Array(pdfBlob);
        let binaryString = '';
        const chunkSize = 8192; // Process in 8KB chunks
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.subarray(i, i + chunkSize);
          binaryString += String.fromCharCode(...chunk);
        }
        const base64 = btoa(binaryString);
        
        pdfBase64Data = `data:application/pdf;base64,${base64}`;
        console.log('✅ PDF converted to base64, size:', base64.length);
      } catch (fetchError) {
        clearTimeout(timeoutId); // Ensure timeout is cleared on error
        
        // Check if error is due to abort/timeout
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          console.error('📄 PDF fetch timeout after 20 seconds');
          return new Response(
            JSON.stringify({ 
              error: 'PDF fetch timeout',
              details: 'The PDF file took too long to download. Please try again or use a smaller file.'
            }),
            { status: 408, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        console.error('📄 Failed to fetch and convert PDF:', fetchError);
        return new Response(
          JSON.stringify({ 
            error: 'Failed to fetch PDF for processing',
            details: fetchError instanceof Error ? fetchError.message : String(fetchError)
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    let finalResponse: Response | undefined;
    
    // Try DeepSeek first (free model) with proper branching for PDF vs Image
    console.log('🚀 Trying DeepSeek V3.1 (free)...');
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries && (!finalResponse || !finalResponse.ok)) {
      try {
        console.log(`🔄 DeepSeek attempt ${retryCount + 1}/${maxRetries}...`);
        
        const systemPrompt = `You are DeepSeek V3.1 (free), a large language model from deepseek.

Formatting Rules:
- Use Markdown **only when semantically appropriate**. Examples: \`inline code\`, \`\`\`code fences\`\`\`, tables, and lists.
- In assistant responses, format file names, directory paths, function names, and class names with backticks (\`).
- For math: use \\( and \\) for inline expressions, and \\[ and \\] for display (block) math.`;

        const userPrompt = `ANALYSIS TARGET: This receipt contains itemized purchases for restaurant inventory.

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

CRITICAL: Assign confidence scores based on actual text clarity, not wishful thinking.`;

        let requestBody: any;
        
        // Branch: PDF vs Image
        if (isProcessingPDF) {
          // PDF Path: Use file type with plugins
          console.log('📄 Using PDF file parser...');
          
          // Extract filename if present in data URL
          let filename = 'receipt.pdf';
          const filenameMatch = imageData.match(/filename[=:]([^;,]+)/i);
          if (filenameMatch) {
            filename = filenameMatch[1].trim();
          }
          
          requestBody = {
            "model": "deepseek/deepseek-chat-v3.1:free",
            "messages": [
              {
                "role": "system",
                "content": systemPrompt
              },
              {
                "role": "user",
                "content": [
                  {
                    "type": "text",
                    "text": userPrompt
                  },
                  {
                    "type": "file",
                    "file": {
                      "file_data": pdfBase64Data,
                      "filename": filename
                    }
                  }
                ]
              }
            ],
            "plugins": [
              {
                "id": "file-parser",
                "pdf": {
                  "engine": "pdf-text"
                }
              }
            ],
            "stream": false,
            "max_tokens": 4000
          };
        } else {
          // Image Path: Use image_url type
          console.log('📸 Using image vision...');
          
          requestBody = {
            "model": "deepseek/deepseek-chat-v3.1:free",
            "messages": [
              {
                "role": "system",
                "content": systemPrompt
              },
              {
                "role": "user",
                "content": [
                  {
                    "type": "text",
                    "text": userPrompt
                  },
                  {
                    "type": "image_url",
                    "image_url": {
                      "url": imageData
                    }
                  }
                ]
              }
            ]
          };
        }

        const deepseekResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openRouterApiKey}`,
            "HTTP-Referer": "https://app.easyshifthq.com",
            "X-Title": "EasyShiftHQ Receipt Parser",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody)
        });

        if (deepseekResponse.ok) {
          finalResponse = deepseekResponse;
          console.log('✅ DeepSeek succeeded');
          break;
        }

        // Rate limited - wait and retry
        if (deepseekResponse.status === 429) {
          console.log(`🔄 DeepSeek rate limited (attempt ${retryCount + 1}/${maxRetries}), waiting before retry...`);
          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
          }
        } else {
          const errorText = await deepseekResponse.text();
          console.error(`❌ DeepSeek failed (attempt ${retryCount + 1}):`, deepseekResponse.status, errorText);
          break;
        }
      } catch (error) {
        console.error(`❌ DeepSeek attempt ${retryCount + 1} failed:`, error);
        retryCount++;
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
        }
      }
    }

    // If DeepSeek failed, try Grok as backup (images only - Grok doesn't support PDFs)
    if ((!finalResponse || !finalResponse.ok) && !isProcessingPDF) {
      console.log('🔄 DeepSeek failed, trying Grok as backup for image...');
      
      try {
        const grokRequestBody: any = {
          "model": "x-ai/grok-4-fast:free",
          "messages": [
            {
              "role": "system",
              "content": `You are an expert receipt parser for restaurant inventory management. Analyze this receipt image and extract ALL purchasable items.

Return ONLY valid JSON in this exact format:
{
  "vendor": "Store Name",
  "totalAmount": 45.67,
  "lineItems": [
    {
      "rawText": "exact text from receipt",
      "parsedName": "standardized product name",
      "parsedQuantity": numeric_quantity,
      "parsedUnit": "standard_unit",
      "parsedPrice": numeric_price,
      "confidenceScore": realistic_score_0_to_1
    }
  ]
}`
            },
            {
              "role": "user",
              "content": [
                {
                  "type": "text",
                  "text": "Analyze this receipt carefully. Extract ALL products with their quantities and prices. Focus on the itemized section."
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
          "temperature": 0.1,
          "max_tokens": 4000
        };

        const grokResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openRouterApiKey}`,
            "HTTP-Referer": "https://app.easyshifthq.com",
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
      console.error('❌ Receipt processing failed');
      
      const errorMessage = isProcessingPDF 
        ? 'PDF processing temporarily unavailable. Please try again in a few minutes.'
        : 'Receipt processing temporarily unavailable. Please try again in a few minutes.';
      
      return new Response(
        JSON.stringify({ 
          error: errorMessage,
          details: 'AI services are currently unavailable'
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