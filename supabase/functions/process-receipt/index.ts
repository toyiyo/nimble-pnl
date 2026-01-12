import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logAICall, extractTokenUsage, type AICallMetadata } from "../_shared/braintrust.ts";
import { normalizePrices, hasValidPriceData, normalizeConfidenceScore } from "../_shared/priceNormalization.ts";

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
  packageType?: string;    // NEW: Type of container (bottle, bag, case)
  sizeValue?: number;      // NEW: Amount per package (750 for 750ml)
  sizeUnit?: string;       // NEW: Unit of measurement (ml, oz, lb)
  unitPrice?: number;      // NEW: Price per unit
  lineTotal?: number;      // NEW: Total for this line (qty × unit price)
  parsedPrice?: number;    // DEPRECATED: Keep for backward compatibility
  confidenceScore: number;
}

// Helper function to parse and validate purchase date from receipt
function parsePurchaseDate(dateString: string | undefined): string | null {
  if (!dateString) return null;
  
  try {
    // Try to parse the date string
    const date = new Date(dateString);
    
    // Validate the date is reasonable (not in future, not before 2000)
    const now = new Date();
    const minDate = new Date('2000-01-01');
    
    if (isNaN(date.getTime()) || date > now || date < minDate) {
      console.log(`⚠️ Invalid purchase date: ${dateString}`);
      return null;
    }
    
    // Return in YYYY-MM-DD format
    return date.toISOString().split('T')[0];
  } catch (error) {
    console.error('Error parsing purchase date:', error);
    return null;
  }
}

// Helper function to extract date from filename
function extractDateFromFilename(filename: string | null): string | null {
  if (!filename) return null;
  
  // Remove file extension
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  
  // Pattern 1: YYYY-MM-DD or YYYY_MM_DD or YYYY.MM.DD
  const isoPattern = /(\d{4})[-_.\/](\d{1,2})[-_.\/](\d{1,2})/;
  const isoMatch = nameWithoutExt.match(isoPattern);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  
  // Pattern 2: MM-DD-YYYY or MM_DD_YYYY
  const usPattern = /(\d{1,2})[-_.\/](\d{1,2})[-_.\/](\d{4})/;
  const usMatch = nameWithoutExt.match(usPattern);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  
  return null;
}

// Shared analysis prompt for all models
const RECEIPT_ANALYSIS_PROMPT = `ANALYSIS TARGET: This receipt image contains itemized purchases for restaurant inventory.

CRITICAL REQUIREMENT: Extract EVERY SINGLE LINE ITEM from this receipt. This receipt may contain 100+ items - you MUST extract ALL of them.

EXTRACTION METHODOLOGY:
1. **Scan the ENTIRE document** - Read every page from start to finish
2. **Extract ALL line items** - Every product purchase, no matter how many items there are
3. **Identify key components**: Product name, quantity, unit of measure, UNIT PRICE, and LINE TOTAL
4. **Expand abbreviations**: Common food service abbreviations (CHKN=Chicken, DNA=Banana, BROC=Broccoli, etc.)
5. **Standardize units**: Use ONLY the units from our standard lists below

**STANDARD UNIT LISTS (use these exactly):**
- **Weight units**: lb, kg, g, oz (note: oz is for WEIGHT only)
- **Volume units**: fl oz (fluid ounces), cup, tbsp, tsp, ml, L, gal, qt, pint
- **Container types** (CHOOSE FROM THIS LIST): 
  Primary: bag, box, bottle, can, jar, tube, sachet, packet, pouch, tray, cup, bowl, wrapper, carton, roll, stick, bar, piece, slice, loaf, portion, pair, pod, capsule, vial
  Secondary: case, crate, pack, multipack, sleeve, bundle, set, strip, pallet, display_box
  Bulk: drum, barrel, bucket, bin, sack, tote, tank, tub, jug
  Other: container, unit, serving

**THREE-FIELD EXTRACTION SYSTEM:**

We use THREE separate fields to capture package information:
1. **packageType** = The CONTAINER/PACKAGE TYPE (bottle, bag, box, case, can, jar, etc.)
2. **sizeValue** = The NUMERIC amount per package (750, 5, 16, etc.)
3. **sizeUnit** = The MEASUREMENT UNIT for sizeValue (ml, oz, lb, fl oz, etc.)

**EXTRACTION RULES:**
- **parsedQuantity**: How MANY packages you're buying (e.g., "2" for "2 bottles")
- **parsedUnit**: ALWAYS use "each" for discrete countable items, OR lb/kg/oz/g for weight-based items
- **packageType**: The TYPE OF CONTAINER - extract ONLY if explicitly visible
  → bottle, bag, box, case, can, jar, container, package
  → Use null for bulk/loose items (produce by weight)
  → Use null if no container type is mentioned
- **sizeValue**: The AMOUNT per package (numeric only)
- **sizeUnit**: The MEASUREMENT UNIT from the lists above

**CRITICAL DISTINCTION:**
- parsedUnit = "each" means "how many items am I buying" (quantity unit)
- packageType = "bottle" means "what container is it in" (container type)
- sizeValue + sizeUnit = "how big is each container" (package size)

**CORRECT EXTRACTION EXAMPLES:**

Example 1: "2 bottles 750ML VODKA"
→ parsedQuantity=2, parsedUnit="each", packageType="bottle", sizeValue=750, sizeUnit="ml"
(Buying 2 discrete items, each is a bottle containing 750ml)

Example 2: "6.86 @ 4.64 CHEEK MEAT"
→ parsedQuantity=6.86, parsedUnit="lb", packageType=null, sizeValue=6.86, sizeUnit="lb"
(Buying 6.86 pounds of meat, sold by weight, no container)

Example 3: "1 case 12x355ML BEER"
→ parsedQuantity=1, parsedUnit="each", packageType="case", sizeValue=355, sizeUnit="ml"
(Buying 1 case, which contains 12 cans of 355ml each - extract the per-can size)

Example 4: "5LB BAG RICE"
→ parsedQuantity=1, parsedUnit="each", packageType="bag", sizeValue=5, sizeUnit="lb"
(Buying 1 bag that weighs 5 pounds)

Example 5: "HEB 1LB KEY LIMES BAG"
→ parsedQuantity=1, parsedUnit="each", packageType="bag", sizeValue=1, sizeUnit="lb"
(Buying 1 bag containing 1 pound of limes)

Example 6: "LIONI FRSH MZRLA BALL 16Z"
→ parsedQuantity=1, parsedUnit="each", packageType="package", sizeValue=16, sizeUnit="oz"
(Buying 1 package weighing 16 ounces)

Example 7: "2 @ 10.98 CHORIZO"
→ parsedQuantity=2, parsedUnit="each", packageType=null, sizeValue=null, sizeUnit=null
(Buying 2 items, no container or size info visible)

Example 8: "ROMA TOMATOES 0.62 Lbs @ 0.82"
→ parsedQuantity=0.62, parsedUnit="lb", packageType=null, sizeValue=0.62, sizeUnit="lb"
(Buying 0.62 pounds of tomatoes, sold by weight)

**KEY RULES:**
- ALWAYS extract packageType when container is explicitly mentioned (bottle, bag, box, case, can, jar)
- ALWAYS use parsedUnit="each" for countable discrete items
- ONLY use parsedUnit=lb/kg/oz/g for weight-based pricing (produce, meat by weight)
- ALWAYS extract sizeValue and sizeUnit when size is visible in the text
- Use null for packageType ONLY when selling bulk/loose items by weight (produce, meat by the pound)

**PACKAGE TYPE INFERENCE BY CATEGORY (when no explicit container mentioned):**
When no explicit container type is visible in the text, INFER packageType based on product category:
- Cereal, crackers, cookies → "box"
- Bread, tortillas, buns → "bag" or "loaf"
- Rice, flour, sugar, chips, snacks → "bag"
- Soda, juice, water, milk → "bottle" or "jug" (large) or "can" (small)
- Yogurt, sour cream, cottage cheese → "container"
- Ketchup, mustard, mayo, sauces → "bottle"
- Canned goods (beans, tomatoes, soup) → "can"
- Spices, seasonings → "jar" or "container"
- Cleaning supplies, detergent → "bottle" or "container"
- Eggs → "carton"
- Produce sold by count (avocados, limes, cucumbers) → "each"
- Meat in packaging (chicken breast, steaks) → "package"
- Honey, jam, peanut butter → "jar"

**FALLBACK RULE:**
- If product category is ambiguous but it's clearly a packaged item (not bulk/weight), use "package" as safe default
- ONLY use null for packageType when the item is truly sold loose by weight (like "ROMA TOMATOES 0.62 Lbs")
- When inferring packageType, set confidenceScore slightly lower (0.70-0.79 range)

**CRITICAL PRICE EXTRACTION RULES:**
- **unitPrice**: The price PER SINGLE ITEM/UNIT (e.g., "$1.00/ea", "$2.50/lb")
- **lineTotal**: The TOTAL PRICE for that line (quantity × unit price)
- If only ONE price is visible, determine if it's the unit price or line total based on context
- For "2 @ $1.00 = $2.00": unitPrice=1.00, lineTotal=2.00
- For "CHICKEN BREAST 5LB $15.00": unitPrice=3.00, lineTotal=15.00
- If unsure, set the visible price as lineTotal and calculate unitPrice = lineTotal / quantity

IMPORTANT FOR LARGE RECEIPTS (100+ items):
- Keep rawText concise (max 40 chars per item) to fit all items in response
- Extract ALL items - do not stop early or summarize
- If you see items continuing on multiple pages, extract from ALL pages
- Prioritize completeness over detailed descriptions

CONFIDENCE SCORING:
- 0.90-0.95: Crystal clear, complete info with both prices and units visible
- 0.80-0.89: Readable, one price visible (other calculated) or unit inferred
- 0.65-0.79: Partially clear, some guessing required
- 0.40-0.64: Poor quality, significant interpretation
- 0.20-0.39: Very unclear, major uncertainty

RESPONSE FORMAT (JSON ONLY - NO EXTRA TEXT):
{
  "vendor": "Exact vendor/supplier name from receipt",
  "totalAmount": numeric_total,
  "purchaseDate": "YYYY-MM-DD format date from receipt (invoice date, order date, delivery date, etc.)",
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
      "parsedUnit": "standard_unit_from_lists_above",
      "packageType": "container_type_if_visible",
      "sizeValue": numeric_amount_per_package,
      "sizeUnit": "measurement_unit_for_size",
      "unitPrice": numeric_price_per_unit,
      "lineTotal": numeric_total_for_this_line,
      "confidenceScore": realistic_score_0_to_1,
      "category": "estimated category"
    }
  ]
}

CRITICAL: Return ONLY valid, complete JSON. Ensure all arrays are properly closed.`;

// Model token limits per provider (to prevent exceeding hard caps)
const MODEL_TOKEN_LIMITS: Record<string, number> = {
  "google/gemini-2.5-flash": 32768,        // Gemini supports high token counts
  "meta-llama/llama-4-maverick": 8192,     // Llama 4 Maverick
  "google/gemma-3-27b-it": 16384,          // Gemma 3 27B
  "openai/gpt-4.1-nano": 16384,            // OpenAI standard limit
};

// Default max tokens for unknown models
const DEFAULT_MAX_TOKENS = 8192;

// Model configurations (prioritized by reliability)
const MODELS = [
  // Primary model
  {
    name: "Gemini 2.5 Flash",
    id: "google/gemini-2.5-flash",
    systemPrompt: "You are an expert receipt parser. Extract itemized data precisely and return valid JSON only.",
    maxRetries: 2,
  },
  // Secondary models
  {
    name: "Llama 4 Maverick",
    id: "meta-llama/llama-4-maverick",
    systemPrompt: "You are an expert receipt parser. Extract itemized data precisely and return valid JSON only.",
    maxRetries: 2,
  },
  {
    name: "Gemma 3 27B",
    id: "google/gemma-3-27b-it",
    systemPrompt: "You are an expert receipt parser. Extract itemized data precisely and return valid JSON only.",
    maxRetries: 2,
  },
  {
    name: "GPT-4.1 Nano",
    id: "openai/gpt-4.1-nano",
    systemPrompt: "You are an expert receipt parser. Extract itemized data precisely and return valid JSON only.",
    maxRetries: 1,
  }
];

// Helper function to build consistent request bodies
function buildRequestBody(modelId: string, systemPrompt: string, isPDF: boolean, mediaData: string): any {
  // Calculate model-specific max tokens (clamped to provider limits)
  const requestedMax = 32000;
  const modelMaxLimit = MODEL_TOKEN_LIMITS[modelId] || DEFAULT_MAX_TOKENS;
  const clampedMaxTokens = Math.min(requestedMax, modelMaxLimit);
  
  console.log(`📊 Token limit for ${modelId}: ${clampedMaxTokens} (model max: ${modelMaxLimit})`);

  const requestBody: any = {
    model: modelId,
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: RECEIPT_ANALYSIS_PROMPT,
          },
          isPDF
            ? {
                type: "file",
                file: {
                  file_data: mediaData,
                  filename: "receipt.pdf",
                },
              }
            : {
                type: "image_url",
                image_url: {
                  url: mediaData,
                },
              },
        ],
      },
    ],
    // Set max tokens clamped to model-specific provider limits
    max_tokens: clampedMaxTokens,
    temperature: 0.1, // Lower temperature for more consistent JSON output
    stream: true, // Enable streaming to handle large receipts without truncation
  };

  // Add PDF parsing plugin if processing PDF
  if (isPDF) {
    requestBody.plugins = [
      {
        id: "file-parser",
        pdf: {
          engine: "mistral-ocr", // Better for complex/scanned receipts
        },
      },
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
    repaired = repaired.replace(/,\s*$/, "");
    repaired += "]".repeat(openBrackets - closeBrackets);
  }

  if (openBraces > closeBraces) {
    console.log(`⚠️ Detected unclosed objects. Adding ${openBraces - closeBraces} closing braces.`);
    // Remove trailing comma if present
    repaired = repaired.replace(/,\s*$/, "");
    repaired += "}".repeat(openBraces - closeBraces);
  }

  return repaired;
}

// Process SSE streaming response and return complete content
async function processStreamedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let completeContent = '';
  let isComplete = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Append new chunk to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines from buffer
      while (true) {
        const lineEnd = buffer.indexOf('\n');
        if (lineEnd === -1) break;

        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        // Skip empty lines and comments
        if (!line || line.startsWith(':')) {
          continue;
        }

        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          
          // Stream complete signal
          if (data === '[DONE]') {
            isComplete = true;
            break;
          }

          try {
            const parsed = JSON.parse(data);

            // Check for mid-stream error
            if (parsed.error) {
              throw new Error(`Stream error: ${parsed.error.message || 'Unknown error'}`);
            }

            // Accumulate content from delta
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              completeContent += content;
            }

            // Check for error finish reason
            if (parsed.choices?.[0]?.finish_reason === 'error') {
              throw new Error('Stream terminated with error');
            }
          } catch (e) {
            // Skip invalid JSON lines (could be comments)
            if (e instanceof SyntaxError) {
              continue;
            }
            throw e;
          }
        }
      }

      if (isComplete) break;
    }

    console.log(`✅ Stream completed. Total content length: ${completeContent.length}`);
    return completeContent;
    
  } catch (error) {
    console.error('❌ Error processing stream:', error);
    throw error;
  } finally {
    reader.cancel();
  }
}

// Generic function to call a model with retries
async function callModel(
  modelConfig: (typeof MODELS)[0],
  isPDF: boolean,
  mediaData: string,
  openRouterApiKey: string,
  restaurantId?: string,
): Promise<Response | null> {
  let retryCount = 0;

  while (retryCount < modelConfig.maxRetries) {
    try {
      console.log(`🔄 ${modelConfig.name} attempt ${retryCount + 1}/${modelConfig.maxRetries}...`);

      const requestBody = buildRequestBody(modelConfig.id, modelConfig.systemPrompt, isPDF, mediaData);

      const metadata: AICallMetadata = {
        model: modelConfig.id,
        provider: "openrouter",
        restaurant_id: restaurantId,
        edge_function: 'process-receipt',
        temperature: requestBody.temperature,
        max_tokens: requestBody.max_tokens,
        stream: requestBody.stream || false,
        attempt: retryCount + 1,
        success: false,
      };

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://app.easyshifthq.com",
          "X-Title": "EasyShiftHQ Receipt Parser",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        console.log(`✅ ${modelConfig.name} succeeded`);
        
        // Log successful receipt processing
        logAICall(
          'process-receipt:success',
          { model: modelConfig.id, isPDF },
          { status: 'success' },
          { ...metadata, success: true, status_code: 200 },
          null // Token usage will be tracked via streaming
        );
        
        return response;
      }

      // Handle rate limiting with exponential backoff
      if (response.status === 429 && retryCount < modelConfig.maxRetries - 1) {
        console.log(`🔄 ${modelConfig.name} rate limited, waiting before retry...`);
        
        logAICall(
          'process-receipt:rate_limit',
          { model: modelConfig.id },
          null,
          { ...metadata, success: false, status_code: 429, error: 'Rate limited' },
          null
        );
        
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retryCount + 1) * 1000));
        retryCount++;
      } else {
        const errorText = await response.text();
        console.error(`❌ ${modelConfig.name} failed:`, response.status, errorText);
        
        logAICall(
          'process-receipt:error',
          { model: modelConfig.id },
          null,
          { ...metadata, success: false, status_code: response.status, error: errorText },
          null
        );
        
        break;
      }
    } catch (error) {
      console.error(`❌ ${modelConfig.name} error:`, error);
      
      logAICall(
        'process-receipt:error',
        { model: modelConfig.id },
        null,
        { 
          model: modelConfig.id,
          provider: "openrouter",
          restaurant_id: restaurantId,
          edge_function: 'process-receipt',
          stream: false,
          attempt: retryCount + 1,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        },
        null
      );
      
      retryCount++;
      if (retryCount < modelConfig.maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      }
    }
  }

  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { receiptId, imageData, isPDF }: ReceiptProcessRequest = await req.json();

    if (!receiptId || !imageData) {
      return new Response(JSON.stringify({ error: "Receipt ID and image data are required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Initialize Supabase client early to get restaurant_id
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get receipt info to find restaurant_id (needed for tracing)
    const { data: receiptInfo, error: receiptInfoError } = await supabase
      .from("receipt_imports")
      .select("restaurant_id")
      .eq("id", receiptId)
      .single();

    if (receiptInfoError || !receiptInfo) {
      console.error("Error fetching receipt info:", receiptInfoError);
      return new Response(JSON.stringify({ error: "Failed to fetch receipt info" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    const restaurantId = receiptInfo.restaurant_id;

    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterApiKey) {
      return new Response(JSON.stringify({ error: "OpenRouter API key not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    console.log("🧾 Processing receipt with multi-model fallback (Gemini -> Llama -> Gemma -> GPT -> Llama Paid)...");
    console.log("📸 Image data type:", isPDF ? "PDF" : "Base64 image", "size:", imageData.length, "characters");

    // Check if the data is a PDF
    const isProcessingPDF = isPDF || false;
    let pdfBase64Data = imageData;

    if (isProcessingPDF && !imageData.startsWith("data:application/pdf;base64,")) {
      console.log("📄 PDF URL detected, converting to base64...");

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
        let binaryString = "";
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
          binaryString += String.fromCharCode(...chunk);
        }

        // Step 2: Encode the COMPLETE binary string to base64 (only once!)
        const base64 = btoa(binaryString);

        pdfBase64Data = `data:application/pdf;base64,${base64}`;
        console.log("✅ PDF converted to base64, size:", base64.length);
      } catch (fetchError) {
        clearTimeout(timeoutId); // Ensure timeout is cleared

        // Check if error was due to abort/timeout
        if (fetchError.name === "AbortError") {
          console.error("📄 PDF fetch timeout");
          return new Response(
            JSON.stringify({
              error: "PDF download timeout",
              details: "The PDF took too long to download (>20s)",
            }),
            { status: 408, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        console.error("📄 Failed to fetch and convert PDF:", fetchError);
        return new Response(
          JSON.stringify({
            error: "Failed to fetch PDF for processing",
            details: fetchError.message,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    let finalResponse: Response | undefined;

    // Try models in order: DeepSeek -> Mistral -> Grok
    for (const modelConfig of MODELS) {
      console.log(`🚀 Trying ${modelConfig.name}...`);

      const response = await callModel(modelConfig, isProcessingPDF, pdfBase64Data, openRouterApiKey, restaurantId);

      if (response) {
        finalResponse = response;
        break;
      }

      console.log(`⚠️ ${modelConfig.name} failed, trying next model...`);
    }

    // If all models failed
    if (!finalResponse || !finalResponse.ok) {
      console.error("❌ All models failed");

      return new Response(
        JSON.stringify({
          error: "Receipt processing temporarily unavailable. All AI models failed.",
          details: "All configured AI models are currently unavailable",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 503,
        },
      );
    }

    // Process the streaming response
    const content = await processStreamedResponse(finalResponse);

    // Validate we got content
    if (!content || content.trim().length === 0) {
      console.error("Empty content from streamed response");
      return new Response(JSON.stringify({ error: "No content received from AI service" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    console.log("✅ AI parsing completed. Response length:", content.length);

    let parsedData;
    try {
      // Enhanced parsing with better error handling
      let jsonContent = content.trim();

      // Remove markdown code blocks if present
      jsonContent = jsonContent.replace(/```json\s*/, "").replace(/```\s*$/, "");
      jsonContent = jsonContent.replace(/```[\w]*\s*/, "").replace(/```\s*$/, "");

      // Extract JSON between first { and last }
      const firstBrace = jsonContent.indexOf("{");
      const lastBrace = jsonContent.lastIndexOf("}");

      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error("No JSON structure found in response");
      }

      jsonContent = jsonContent.substring(firstBrace, lastBrace + 1);

      // Attempt to repair truncated JSON
      jsonContent = repairTruncatedJSON(jsonContent);

      // Fix common JSON issues
      jsonContent = jsonContent.replace(/,(\s*[}\]])/g, "$1"); // Remove trailing commas
      jsonContent = jsonContent.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3'); // Quote unquoted keys

      // Try to parse the cleaned JSON
      parsedData = JSON.parse(jsonContent);

      // Enhanced validation for required structure
      if (!parsedData.lineItems || !Array.isArray(parsedData.lineItems)) {
        throw new Error("Invalid JSON structure: missing or invalid lineItems array");
      }

      // If no line items were parsed, throw error
      if (parsedData.lineItems.length === 0) {
        throw new Error("No line items found in receipt. Response may be truncated.");
      }

      // Validate each line item has required fields
      let validItemCount = 0;
      parsedData.lineItems = parsedData.lineItems.filter((item: any, index: number) => {
        if (!hasValidPriceData(item)) {
          console.warn(`Line item ${index} missing required fields, skipping:`, item);
          return false;
        }
        // Ensure confidence score is within valid range
        item.confidenceScore = normalizeConfidenceScore(item.confidenceScore);
        validItemCount++;
        return true;
      });

      // Normalize and validate prices for each line item using shared utility
      parsedData.lineItems = parsedData.lineItems.map((item: any) => {
        const normalized = normalizePrices({
          parsedName: item.parsedName,
          parsedQuantity: item.parsedQuantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          parsedPrice: item.parsedPrice,
        });

        return {
          ...item,
          unitPrice: normalized.unitPrice,
          lineTotal: normalized.lineTotal,
          parsedPrice: normalized.parsedPrice,
        };
      });

      console.log(`✅ Successfully parsed ${validItemCount} valid line items`);
    } catch (parseError) {
      console.error("Failed to parse JSON from AI response:", parseError);
      console.error("Content that failed to parse:", content.substring(0, 1000) + "...");

      // Create fallback structured response from raw content
      const fallbackData = {
        vendor: "Unknown Vendor",
        totalAmount: 0,
        lineItems: [
          {
            rawText: content.substring(0, 200),
            parsedName: "Unable to parse receipt",
            parsedQuantity: 1,
            parsedUnit: "each",
            parsedPrice: 0,
            confidenceScore: 0.1,
            category: "Other",
          },
        ],
      };

      return new Response(
        JSON.stringify({
          error: "Failed to parse receipt data. Using fallback parsing.",
          details: parseError instanceof Error ? parseError.message : String(parseError),
          fallbackData: fallbackData,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 422,
        },
      );
    }

    // Find or create supplier
    let supplierId: string | null = null;
    if (parsedData.vendor) {
      // Try to find existing supplier
      const { data: existingSupplier } = await supabase
        .from("suppliers")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("name", parsedData.vendor)
        .single();

      if (existingSupplier) {
        supplierId = existingSupplier.id;
      } else {
        // Create new supplier
        const { data: newSupplier, error: supplierError } = await supabase
          .from("suppliers")
          .insert({
            restaurant_id: restaurantId,
            name: parsedData.vendor,
            is_active: true,
          })
          .select("id")
          .single();

        if (!supplierError && newSupplier) {
          supplierId = newSupplier.id;
        }
      }
    }

    // Get the receipt filename for date extraction fallback
    const { data: receiptData } = await supabase
      .from("receipt_imports")
      .select("file_name")
      .eq("id", receiptId)
      .single();

    // Determine purchase date: prioritize AI extraction, fallback to filename extraction
    let purchaseDate: string | null = null;
    
    // Try to get date from AI-parsed data
    if (parsedData.purchaseDate) {
      purchaseDate = parsePurchaseDate(parsedData.purchaseDate);
      if (purchaseDate) {
        console.log(`✅ Purchase date from AI: ${purchaseDate}`);
      }
    }
    
    // Fallback to filename extraction if AI didn't find a date
    if (!purchaseDate && receiptData?.file_name) {
      purchaseDate = extractDateFromFilename(receiptData.file_name);
      if (purchaseDate) {
        console.log(`✅ Purchase date from filename: ${purchaseDate}`);
      }
    }
    
    if (!purchaseDate) {
      console.log('⚠️ No purchase date found, will need user input');
    }

    // Update receipt with parsed data and supplier
    const { error: updateError } = await supabase
      .from("receipt_imports")
      .update({
        vendor_name: parsedData.vendor,
        total_amount: parsedData.totalAmount,
        raw_ocr_data: parsedData,
        status: "processed",
        processed_at: new Date().toISOString(),
        supplier_id: supplierId,
        purchase_date: purchaseDate,
      })
      .eq("id", receiptId);

    if (updateError) {
      console.error("Error updating receipt:", updateError);
      return new Response(JSON.stringify({ error: "Failed to update receipt" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // Insert line items with sequence to preserve order
    const lineItems = parsedData.lineItems.map((item: ParsedLineItem, index: number) => ({
      receipt_id: receiptId,
      raw_text: item.rawText,
      parsed_name: item.parsedName,
      parsed_quantity: item.parsedQuantity,
      parsed_unit: item.parsedUnit,
      package_type: item.packageType || null,
      size_value: item.sizeValue || null,
      size_unit: item.sizeUnit || null,
      parsed_price: item.lineTotal,   // Store lineTotal in parsed_price for backward compat
      unit_price: item.unitPrice,     // NEW: Store actual unit price
      confidence_score: item.confidenceScore,
      line_sequence: index + 1,
    }));

    const { error: lineItemsError } = await supabase.from("receipt_line_items").insert(lineItems);

    if (lineItemsError) {
      console.error("Error inserting line items:", lineItemsError);
      return new Response(JSON.stringify({ error: "Failed to insert line items" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        vendor: parsedData.vendor,
        totalAmount: parsedData.totalAmount,
        lineItemsCount: lineItems.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error in process-receipt function:", error);
    return new Response(
      JSON.stringify({
        error: "An unexpected error occurred while processing the receipt",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
