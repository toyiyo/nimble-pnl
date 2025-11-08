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

// Shared analysis prompt for all models
const RECEIPT_ANALYSIS_PROMPT = `ANALYSIS TARGET: This receipt image contains itemized purchases for restaurant inventory.

EXTRACTION METHODOLOGY:
1. **Locate the itemized section** - Focus on the main purchase list (ignore headers, tax, totals, payment info)
2. **Extract ALL line items** - Every product purchase, even if formatting is unclear
3. **Identify key components**: Product name, quantity, unit of measure, price per item or total
4. **Expand abbreviations**: Common food service abbreviations (CHKN=Chicken, DNA=Banana, BROC=Broccoli, etc.)
5. **Standardize units**: Convert to standard restaurant units (lb, oz, case, each, gal, etc.)

IMPORTANT FOR LARGE RECEIPTS:
- If receipt has 100+ items, prioritize accuracy over verbosity
- Keep rawText concise (max 50 chars per item)
- Ensure JSON is complete - DO NOT truncate arrays mid-item

CONFIDENCE SCORING:
- 0.90-0.95: Crystal clear, complete info
- 0.80-0.89: Readable, minor ambiguity
- 0.65-0.79: Partially clear, some guessing
- 0.40-0.64: Poor quality, significant interpretation
- 0.20-0.39: Very unclear, major uncertainty

RESPONSE FORMAT (JSON ONLY - NO EXTRA TEXT):
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
      "rawText": "exact text from receipt (max 50 chars)",
      "parsedName": "standardized product name",
      "parsedQuantity": numeric_quantity,
      "parsedUnit": "standard_unit",
      "parsedPrice": numeric_price,
      "confidenceScore": realistic_score_0_to_1,
      "category": "estimated category"
    }
  ]
}

CRITICAL: Return ONLY valid, complete JSON. Ensure all arrays are properly closed.`;

// Model configurations - Gemini models prioritized based on file size
const GEMINI_MODELS = {
  flash: {
    name: "Gemini 2.5 Flash",
    id: "google/gemini-2.5-flash",
    systemPrompt: "You are an expert receipt parser. Extract itemized data precisely and return valid JSON only.",
    maxRetries: 2
  },
  flashLite: {
    name: "Gemini 2.5 Flash Lite",
    id: "google/gemini-2.5-flash-lite",
    systemPrompt: "You are an expert receipt parser. Extract itemized data precisely and return valid JSON only.",
    maxRetries: 2
  }
};

// Free model fallbacks
const FREE_FALLBACK_MODELS = [
  {
    name: "Llama 4 Maverick Free",
    id: "meta-llama/llama-4-maverick:free",
    systemPrompt: "You are an expert receipt parser. Extract itemized data precisely and return valid JSON only.",
    maxRetries: 1
  },
  {
    name: "Gemma 3 27B Free",
    id: "google/gemma-3-27b-it:free",
    systemPrompt: "You are an expert receipt parser. Extract itemized data precisely and return valid JSON only.",
    maxRetries: 1
  }
];

// Helper function to select models based on file size
function selectModelsForFileSize(estimatedFileSize: number) {
  // Base64 encoding increases size by ~33%, so we calculate actual file size
  const actualFileSize = Math.floor(estimatedFileSize * 0.75);
  
  console.log(`📊 Estimated file size: ${Math.round(actualFileSize / 1024)}KB`);
  
  // For large files (>100KB) or multi-page documents: Use Gemini Flash first
  if (actualFileSize > 100 * 1024) {
    console.log('📄 Large file detected, prioritizing Gemini 2.5 Flash');
    return [
      GEMINI_MODELS.flash,
      GEMINI_MODELS.flashLite,
      ...FREE_FALLBACK_MODELS
    ];
  }
  
  // For medium files (>50KB): Use Gemini Flash Lite first
  if (actualFileSize > 50 * 1024) {
    console.log('📄 Medium file detected, prioritizing Gemini 2.5 Flash Lite');
    return [
      GEMINI_MODELS.flashLite,
      GEMINI_MODELS.flash,
      ...FREE_FALLBACK_MODELS
    ];
  }
  
  // For small files: Use Flash Lite with free model fallbacks
  console.log('📄 Small file detected, using Gemini 2.5 Flash Lite with free fallbacks');
  return [
    GEMINI_MODELS.flashLite,
    ...FREE_FALLBACK_MODELS,
    GEMINI_MODELS.flash
  ];
}

// Helper function to build consistent request bodies
function buildRequestBody(
  modelId: string,
  systemPrompt: string,
  isPDF: boolean,
  mediaData: string
): any {
  const requestBody: any = {
    model: modelId,
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: RECEIPT_ANALYSIS_PROMPT
          },
          isPDF ? {
            type: "file",
            file: {
              file_data: mediaData,
              filename: "receipt.pdf"
            }
          } : {
            type: "image_url",
            image_url: {
              url: mediaData
            }
          }
        ]
      }
    ],
    // Set max tokens to ensure complete responses for large receipts
    max_tokens: 16000,
    temperature: 0.1 // Lower temperature for more consistent JSON output
  };

  // Add PDF parsing plugin if processing PDF
  if (isPDF) {
    requestBody.plugins = [
      {
        id: "file-parser",
        pdf: {
          engine: "pdf-text"
        }
      }
    ];
  }

  return requestBody;
}

// Helper function to detect and repair truncated JSON
function repairTruncatedJSON(jsonContent: string): string {
  let repaired = jsonContent.trim();
  
  // Count open and close braces/brackets
  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/]/g) || []).length;
  
  // If truncated mid-array or mid-object, try to close it
  if (openBrackets > closeBrackets) {
    console.log(`⚠️ Detected unclosed arrays. Adding ${openBrackets - closeBrackets} closing brackets.`);
    // Remove trailing comma if present
    repaired = repaired.replace(/,\s*$/, '');
    repaired += ']'.repeat(openBrackets - closeBrackets);
  }
  
  if (openBraces > closeBraces) {
    console.log(`⚠️ Detected unclosed objects. Adding ${openBraces - closeBraces} closing braces.`);
    // Remove trailing comma if present
    repaired = repaired.replace(/,\s*$/, '');
    repaired += '}'.repeat(openBraces - closeBraces);
  }
  
  return repaired;
}

// Generic function to call a model with retries
async function callModel(
  modelConfig: typeof MODELS[0],
  isPDF: boolean,
  mediaData: string,
  openRouterApiKey: string
): Promise<Response | null> {
  let retryCount = 0;
  
  while (retryCount < modelConfig.maxRetries) {
    try {
      console.log(`🔄 ${modelConfig.name} attempt ${retryCount + 1}/${modelConfig.maxRetries}...`);
      
      const requestBody = buildRequestBody(
        modelConfig.id,
        modelConfig.systemPrompt,
        isPDF,
        mediaData
      );

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://app.easyshifthq.com",
          "X-Title": "EasyShiftHQ Receipt Parser",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        console.log(`✅ ${modelConfig.name} succeeded`);
        return response;
      }

      // Handle rate limiting with exponential backoff
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

    console.log('🧾 Processing receipt with Gemini AI models...');
    console.log('📸 Image data type:', isPDF ? 'PDF' : 'Base64 image', 'size:', imageData.length, 'characters');

    // Check if the data is a PDF
    const isProcessingPDF = isPDF || false;
    let pdfBase64Data = imageData;
    let estimatedFileSize = imageData.length;
    
    if (isProcessingPDF && !imageData.startsWith('data:application/pdf;base64,')) {
      console.log('📄 PDF URL detected, converting to base64...');
      
      // Set up abort controller with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout
      
      try {
        const pdfResponse = await fetch(imageData, { signal: controller.signal });
        clearTimeout(timeoutId); // Clear timeout on successful fetch
        
        if (!pdfResponse.ok) {
          throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);
        }
        
        const pdfBlob = await pdfResponse.arrayBuffer();
        
        // Safe chunked base64 conversion for large PDFs
        const uint8Array = new Uint8Array(pdfBlob);
        const chunkSize = 32768; // 32KB chunks
        
        // Step 1: Convert all bytes to binary string (chunked to avoid stack overflow)
        let binaryString = '';
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
          binaryString += String.fromCharCode(...chunk);
        }
        
        // Step 2: Encode the COMPLETE binary string to base64 (only once!)
        const base64 = btoa(binaryString);
        
        pdfBase64Data = `data:application/pdf;base64,${base64}`;
        estimatedFileSize = base64.length;
        console.log('✅ PDF converted to base64, size:', base64.length);
      } catch (fetchError) {
        clearTimeout(timeoutId); // Ensure timeout is cleared
        
        // Check if error was due to abort/timeout
        if (fetchError.name === 'AbortError') {
          console.error('📄 PDF fetch timeout');
          return new Response(
            JSON.stringify({ 
              error: 'PDF download timeout',
              details: 'The PDF took too long to download (>20s)'
            }),
            { status: 408, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        console.error('📄 Failed to fetch and convert PDF:', fetchError);
        return new Response(
          JSON.stringify({ 
            error: 'Failed to fetch PDF for processing',
            details: fetchError.message
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Select models based on file size
    const MODELS = selectModelsForFileSize(estimatedFileSize);
    
    let finalResponse: Response | undefined;

    // Try models in order based on file size
    for (const modelConfig of MODELS) {
      console.log(`🚀 Trying ${modelConfig.name}...`);
      
      const response = await callModel(
        modelConfig,
        isProcessingPDF,
        pdfBase64Data,
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
      console.error('❌ All models failed');
      
      return new Response(
        JSON.stringify({ 
          error: 'Receipt processing temporarily unavailable. All AI models failed.',
          details: 'All Gemini and fallback models are currently unavailable'
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
    
    // Check if response appears truncated
    const isTruncated = !content.trim().endsWith('}') && !content.trim().endsWith(']');
    if (isTruncated) {
      console.warn('⚠️ Response appears truncated. Will attempt to repair JSON.');
    }
    
    console.log('✅ AI parsing completed. Response length:', content.length);

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
      
      // Attempt to repair truncated JSON
      jsonContent = repairTruncatedJSON(jsonContent);
      
      // Fix common JSON issues
      jsonContent = jsonContent.replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas
      jsonContent = jsonContent.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3'); // Quote unquoted keys
      
      // Try to parse the cleaned JSON
      parsedData = JSON.parse(jsonContent);
      
      // Enhanced validation for required structure
      if (!parsedData.lineItems || !Array.isArray(parsedData.lineItems)) {
        throw new Error('Invalid JSON structure: missing or invalid lineItems array');
      }

      // If no line items were parsed, throw error
      if (parsedData.lineItems.length === 0) {
        throw new Error('No line items found in receipt. Response may be truncated.');
      }

      // Validate each line item has required fields
      let validItemCount = 0;
      parsedData.lineItems = parsedData.lineItems.filter((item: any, index: number) => {
        if (!item.parsedName || typeof item.parsedQuantity !== 'number' || typeof item.parsedPrice !== 'number') {
          console.warn(`Line item ${index} missing required fields, skipping:`, item);
          return false;
        }
        // Ensure confidence score is within valid range
        if (item.confidenceScore > 1.0) item.confidenceScore = 1.0;
        if (item.confidenceScore < 0.0) item.confidenceScore = 0.0;
        validItemCount++;
        return true;
      });
      
      console.log(`✅ Successfully parsed ${validItemCount} valid line items`);
      
      if (isTruncated) {
        console.warn(`⚠️ Response was truncated. Parsed ${validItemCount} items but there may be more.`);
      }
      
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