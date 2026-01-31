import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { logAICall } from "../_shared/braintrust.ts";

interface AssetDocumentRequest {
  documentId: string;
  imageData?: string; // base64 encoded image OR URL for PDF
  isPDF?: boolean;
  textContent?: string; // Raw text content for CSV/XML/text files
  fileName?: string; // Original filename for context
  restaurantId: string;
}

interface ParsedAssetItem {
  rawText: string;
  parsedName: string;
  parsedDescription?: string;
  purchaseCost: number;
  purchaseDate?: string;
  serialNumber?: string;
  suggestedCategory: string;
  suggestedUsefulLifeMonths: number;
  suggestedSalvageValue: number;
  confidenceScore: number;
}

// Default asset categories with useful lives (mirrors frontend constants)
const DEFAULT_ASSET_CATEGORIES = [
  { name: 'Kitchen Equipment', defaultUsefulLifeMonths: 84 },
  { name: 'Furniture & Fixtures', defaultUsefulLifeMonths: 84 },
  { name: 'Electronics', defaultUsefulLifeMonths: 60 },
  { name: 'Vehicles', defaultUsefulLifeMonths: 60 },
  { name: 'Leasehold Improvements', defaultUsefulLifeMonths: 120 },
  { name: 'Office Equipment', defaultUsefulLifeMonths: 60 },
  { name: 'Signage', defaultUsefulLifeMonths: 84 },
  { name: 'HVAC Systems', defaultUsefulLifeMonths: 180 },
  { name: 'Security Systems', defaultUsefulLifeMonths: 60 },
  { name: 'POS Hardware', defaultUsefulLifeMonths: 36 },
  { name: 'Other', defaultUsefulLifeMonths: 60 },
];

// AI extraction prompt for asset documents
const ASSET_EXTRACTION_PROMPT = `ANALYSIS TARGET: This document contains equipment or fixed asset purchases for a restaurant.

EXTRACTION RULES:
1. Extract ALL line items that represent equipment, furniture, vehicles, or other fixed assets
2. Focus on items that would be capitalized (typically $500+), but include all line items found
3. Do NOT skip items - extract everything visible

FOR EACH ASSET EXTRACT:
- **rawText**: The exact text from the document for this item (max 100 chars)
- **parsedName**: Clean, standardized equipment name (e.g., "Commercial Walk-in Refrigerator")
- **parsedDescription**: Additional details if visible (brand, model, specs)
- **purchaseCost**: Total price for this item (numeric, no currency symbols)
- **purchaseDate**: Date from invoice/receipt (YYYY-MM-DD format)
- **serialNumber**: Serial number if visible
- **suggestedCategory**: Best match from these categories:
  ${DEFAULT_ASSET_CATEGORIES.map(c => c.name).join(', ')}
- **suggestedUsefulLifeMonths**: Based on category (see defaults below)
- **suggestedSalvageValue**: Typically 0-10% of purchase cost (0 for most restaurant equipment)
- **confidenceScore**: How confident you are in extraction (0.0-1.0)

CATEGORY → USEFUL LIFE MAPPING:
${DEFAULT_ASSET_CATEGORIES.map(c => `- ${c.name}: ${c.defaultUsefulLifeMonths} months`).join('\n')}

CONFIDENCE SCORING:
- 0.90-1.0: Clear text, all fields visible
- 0.75-0.89: Most fields clear, some inference needed
- 0.60-0.74: Readable but some guessing required
- 0.40-0.59: Poor quality, significant interpretation
- 0.20-0.39: Very unclear, major uncertainty

RESPONSE FORMAT (JSON ONLY - NO MARKDOWN, NO EXTRA TEXT):
{
  "success": true,
  "vendor": "Supplier/vendor name from document",
  "purchaseDate": "YYYY-MM-DD from invoice date",
  "totalAmount": 12345.67,
  "lineItems": [
    {
      "rawText": "exact text from document",
      "parsedName": "Commercial Refrigerator",
      "parsedDescription": "True Manufacturing 2-door",
      "purchaseCost": 5499.99,
      "purchaseDate": "2024-01-15",
      "serialNumber": "TM-12345",
      "suggestedCategory": "Kitchen Equipment",
      "suggestedUsefulLifeMonths": 84,
      "suggestedSalvageValue": 0,
      "confidenceScore": 0.95
    }
  ]
}

CRITICAL RULES:
- Return ONLY valid JSON, no markdown code blocks
- Extract ALL visible line items (don't summarize or skip)
- If purchaseDate is missing from line item, use invoice/document date
- Use 0 for salvageValue unless there's a clear reason for residual value
- Match category as closely as possible; use "Other" only as last resort`;

// Text-specific extraction prompt for CSV/XML/text files
const TEXT_EXTRACTION_PROMPT = `ANALYSIS TARGET: This text data contains equipment or fixed asset information for a restaurant.
The data may be in CSV, XML, or other structured/semi-structured format.

EXTRACTION RULES:
1. Parse the data structure (CSV columns, XML elements, etc.) to understand the format
2. Extract ALL line items that represent equipment, furniture, vehicles, or other fixed assets
3. Focus on items that would be capitalized (typically $500+), but include all line items found
4. Handle unusual formats - columns may have non-standard names
5. If prices are missing for some items (bundle pricing), still extract them with purchaseCost: 0

FOR EACH ASSET EXTRACT:
- **rawText**: The original row/element text (max 100 chars)
- **parsedName**: Clean, standardized equipment name (e.g., "Commercial Walk-in Refrigerator")
- **parsedDescription**: Additional details if available (brand, model, specs)
- **purchaseCost**: Price for this item (numeric, 0 if not specified)
- **purchaseDate**: Date if found (YYYY-MM-DD format)
- **serialNumber**: Serial number if available
- **suggestedCategory**: Best match from these categories:
  ${DEFAULT_ASSET_CATEGORIES.map(c => c.name).join(', ')}
- **suggestedUsefulLifeMonths**: Based on category (see defaults below)
- **suggestedSalvageValue**: Typically 0-10% of purchase cost (0 for most restaurant equipment)
- **confidenceScore**: How confident you are in extraction (0.0-1.0)

CATEGORY → USEFUL LIFE MAPPING:
${DEFAULT_ASSET_CATEGORIES.map(c => `- ${c.name}: ${c.defaultUsefulLifeMonths} months`).join('\n')}

CONFIDENCE SCORING:
- 0.90-1.0: Clear structure, all fields present
- 0.75-0.89: Most fields clear, some inference needed
- 0.60-0.74: Unusual format but parseable
- 0.40-0.59: Ambiguous structure, significant interpretation
- 0.20-0.39: Very unclear, major uncertainty

RESPONSE FORMAT (JSON ONLY - NO MARKDOWN, NO EXTRA TEXT):
{
  "success": true,
  "vendor": "Supplier/vendor name if found",
  "purchaseDate": "YYYY-MM-DD if found",
  "totalAmount": 12345.67,
  "lineItems": [
    {
      "rawText": "original text from data",
      "parsedName": "Commercial Refrigerator",
      "parsedDescription": "True Manufacturing 2-door",
      "purchaseCost": 5499.99,
      "purchaseDate": "2024-01-15",
      "serialNumber": "TM-12345",
      "suggestedCategory": "Kitchen Equipment",
      "suggestedUsefulLifeMonths": 84,
      "suggestedSalvageValue": 0,
      "confidenceScore": 0.95
    }
  ]
}

CRITICAL RULES:
- Return ONLY valid JSON, no markdown code blocks
- Extract ALL line items (don't summarize or skip)
- Items with $0 cost are OK - user will add prices later
- If date is missing, omit purchaseDate field
- Match category as closely as possible; use "Other" only as last resort`;

// Model configurations (same as process-receipt for consistency)
const MODELS = [
  {
    name: "Gemini 2.5 Flash",
    id: "google/gemini-2.5-flash",
    systemPrompt: "You are an expert document parser for restaurant equipment purchases. Extract asset details precisely and return valid JSON only.",
    maxRetries: 2,
  },
  {
    name: "Llama 4 Maverick",
    id: "meta-llama/llama-4-maverick",
    systemPrompt: "You are an expert document parser for restaurant equipment purchases. Extract asset details precisely and return valid JSON only.",
    maxRetries: 2,
  },
  {
    name: "Gemma 3 27B",
    id: "google/gemma-3-27b-it",
    systemPrompt: "You are an expert document parser for restaurant equipment purchases. Extract asset details precisely and return valid JSON only.",
    maxRetries: 2,
  },
  {
    name: "GPT-4.1 Nano",
    id: "openai/gpt-4.1-nano",
    systemPrompt: "You are an expert document parser for restaurant equipment purchases. Extract asset details precisely and return valid JSON only.",
    maxRetries: 1,
  }
];

// Model token limits
const MODEL_TOKEN_LIMITS: Record<string, number> = {
  "google/gemini-2.5-flash": 32768,
  "meta-llama/llama-4-maverick": 8192,
  "google/gemma-3-27b-it": 16384,
  "openai/gpt-4.1-nano": 16384,
};

const DEFAULT_MAX_TOKENS = 8192;

interface BuildRequestOptions {
  modelId: string;
  systemPrompt: string;
  isPDF: boolean;
  mediaData?: string;
  textContent?: string;
  fileName?: string;
}

function buildRequestBody(options: BuildRequestOptions): Record<string, unknown> {
  const { modelId, systemPrompt, isPDF, mediaData, textContent, fileName } = options;
  const modelMaxLimit = MODEL_TOKEN_LIMITS[modelId] || DEFAULT_MAX_TOKENS;
  const clampedMaxTokens = Math.min(16000, modelMaxLimit);

  // Text-based extraction (CSV, XML, etc.)
  if (textContent) {
    const prompt = `${TEXT_EXTRACTION_PROMPT}\n\n--- FILE: ${fileName || 'data.txt'} ---\n${textContent}\n--- END FILE ---`;
    return {
      model: modelId,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: clampedMaxTokens,
      temperature: 0.1,
      stream: true,
    };
  }

  // Image/PDF-based extraction
  const requestBody: Record<string, unknown> = {
    model: modelId,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: ASSET_EXTRACTION_PROMPT },
          isPDF
            ? { type: "file", file: { file_data: mediaData, filename: "document.pdf" } }
            : { type: "image_url", image_url: { url: mediaData } },
        ],
      },
    ],
    max_tokens: clampedMaxTokens,
    temperature: 0.1,
    stream: true,
  };

  if (isPDF) {
    requestBody.plugins = [
      { id: "file-parser", pdf: { engine: "mistral-ocr" } },
    ];
  }

  return requestBody;
}

async function processStreamedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response body is not readable');

  const decoder = new TextDecoder();
  let buffer = '';
  let completeContent = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const lineEnd = buffer.indexOf('\n');
        if (lineEnd === -1) break;

        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        if (!line || line.startsWith(':')) continue;

        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(parsed.error.message || 'Stream error');
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) completeContent += content;
          } catch (e) {
            if (!(e instanceof SyntaxError)) throw e;
          }
        }
      }
    }
    return completeContent;
  } finally {
    reader.cancel();
  }
}

function repairTruncatedJSON(jsonContent: string): string {
  let repaired = jsonContent.trim();

  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/]/g) || []).length;

  if (openBrackets > closeBrackets) {
    repaired = repaired.replace(/,\s*$/, "");
    repaired += "]".repeat(openBrackets - closeBrackets);
  }

  if (openBraces > closeBraces) {
    repaired = repaired.replace(/,\s*$/, "");
    repaired += "}".repeat(openBraces - closeBraces);
  }

  return repaired;
}

interface CallModelOptions {
  modelConfig: typeof MODELS[0];
  isPDF: boolean;
  mediaData?: string;
  textContent?: string;
  fileName?: string;
  openRouterApiKey: string;
  restaurantId: string;
}

async function callModel(options: CallModelOptions): Promise<Response | null> {
  const { modelConfig, isPDF, mediaData, textContent, fileName, openRouterApiKey, restaurantId } = options;
  let retryCount = 0;

  while (retryCount < modelConfig.maxRetries) {
    try {
      console.log(`🔄 ${modelConfig.name} attempt ${retryCount + 1}/${modelConfig.maxRetries}...`);

      const requestBody = buildRequestBody({
        modelId: modelConfig.id,
        systemPrompt: modelConfig.systemPrompt,
        isPDF,
        mediaData,
        textContent,
        fileName,
      });

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://app.easyshifthq.com",
          "X-Title": "EasyShiftHQ Asset Import",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        console.log(`✅ ${modelConfig.name} succeeded`);
        logAICall(
          'process-asset-document:success',
          { model: modelConfig.id, isPDF },
          { status: 'success' },
          { model: modelConfig.id, provider: "openrouter", restaurant_id: restaurantId, edge_function: 'process-asset-document', success: true, status_code: 200 },
          null
        );
        return response;
      }

      if (response.status === 429 && retryCount < modelConfig.maxRetries - 1) {
        console.log(`🔄 ${modelConfig.name} rate limited, waiting...`);
        await new Promise(r => setTimeout(r, Math.pow(2, retryCount + 1) * 1000));
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
        await new Promise(r => setTimeout(r, Math.pow(2, retryCount) * 1000));
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
    // Verify authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Authentication required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    // Use service role client to verify auth and check access (bypasses RLS)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid or expired authentication" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }

    const { documentId, imageData, isPDF, textContent, fileName, restaurantId }: AssetDocumentRequest = await req.json();

    // Validate: need either imageData OR textContent
    if (!documentId || !restaurantId) {
      return new Response(
        JSON.stringify({ success: false, error: "Document ID and restaurant ID are required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    if (!imageData && !textContent) {
      return new Response(
        JSON.stringify({ success: false, error: "Either image data or text content is required" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Verify user has access to this restaurant via user_restaurants table
    const { data: userRestaurant, error: accessError } = await supabaseAdmin
      .from("user_restaurants")
      .select("id, role")
      .eq("user_id", user.id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (accessError || !userRestaurant) {
      console.error(`Access denied: user ${user.id} has no access to restaurant ${restaurantId}`, accessError);
      return new Response(
        JSON.stringify({ success: false, error: "Access denied to this restaurant" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403 }
      );
    }

    const isTextExtraction = !!textContent;

    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "OpenRouter API key not configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    console.log("📦 Processing asset document with multi-model fallback...");

    let pdfBase64Data = imageData;
    const isProcessingPDF = isPDF || false;

    if (isTextExtraction) {
      // Text-based extraction (CSV, XML, etc.)
      console.log("📄 Text extraction mode, file:", fileName, "size:", textContent!.length, "chars");
    } else {
      // Image/PDF extraction
      console.log("📸 Document type:", isPDF ? "PDF" : "Image", "size:", imageData!.length, "chars");

      // Handle PDF URL conversion to base64
      if (isProcessingPDF && !imageData!.startsWith("data:application/pdf;base64,")) {
        console.log("📄 PDF URL detected, converting to base64...");

        // Validate URL before fetching
        let pdfUrl: URL;
        try {
          pdfUrl = new URL(imageData!);
        } catch {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid PDF URL format" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        // Only allow HTTPS URLs (except localhost for development)
        const isLocalhost = pdfUrl.hostname === "localhost" || pdfUrl.hostname === "127.0.0.1";
        if (pdfUrl.protocol !== "https:" && !isLocalhost) {
          return new Response(
            JSON.stringify({ success: false, error: "PDF URL must use HTTPS" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        // Block internal/private IP ranges (except localhost for development)
        const blockedHosts = ["169.254.", "10.", "172.16.", "172.17.", "172.18.", "172.19.",
                             "172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.",
                             "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
                             "192.168.", "0.0.0.0"];
        if (blockedHosts.some(prefix => pdfUrl.hostname.startsWith(prefix))) {
          return new Response(
            JSON.stringify({ success: false, error: "Invalid PDF URL - internal addresses not allowed" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
          );
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        try {
          const pdfResponse = await fetch(pdfUrl.toString(), { signal: controller.signal });
          clearTimeout(timeoutId);

          if (!pdfResponse.ok) throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);

          const pdfBlob = await pdfResponse.arrayBuffer();
          const uint8Array = new Uint8Array(pdfBlob);
          const chunkSize = 32768;
          let binaryString = "";

          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
            binaryString += String.fromCharCode(...chunk);
          }

          const base64 = btoa(binaryString);
          pdfBase64Data = `data:application/pdf;base64,${base64}`;
          console.log("✅ PDF converted to base64, size:", base64.length);
        } catch (fetchError) {
          clearTimeout(timeoutId);
          if (fetchError instanceof Error && fetchError.name === "AbortError") {
            return new Response(
              JSON.stringify({ success: false, error: "PDF download timeout (>20s)" }),
              { status: 408, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          throw fetchError;
        }
      }
    }

    // Try models in order
    let finalResponse: Response | undefined;

    for (const modelConfig of MODELS) {
      console.log(`🚀 Trying ${modelConfig.name}...`);
      const response = await callModel({
        modelConfig,
        isPDF: isProcessingPDF,
        mediaData: isTextExtraction ? undefined : pdfBase64Data,
        textContent: isTextExtraction ? textContent : undefined,
        fileName,
        openRouterApiKey,
        restaurantId,
      });

      if (response) {
        finalResponse = response;
        break;
      }
      console.log(`⚠️ ${modelConfig.name} failed, trying next...`);
    }

    if (!finalResponse || !finalResponse.ok) {
      return new Response(
        JSON.stringify({ success: false, error: "All AI models failed. Please try again later." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 503 }
      );
    }

    // Process streaming response
    const content = await processStreamedResponse(finalResponse);

    if (!content || content.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No content received from AI" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    console.log("✅ AI response received, length:", content.length);

    // Parse JSON response
    let parsedData: {
      success?: boolean;
      vendor?: string;
      purchaseDate?: string;
      totalAmount?: number;
      lineItems?: ParsedAssetItem[];
    };

    try {
      let jsonContent = content.trim();
      jsonContent = jsonContent.replace(/```json\s*/, "").replace(/```\s*$/, "");
      jsonContent = jsonContent.replace(/```[\w]*\s*/, "").replace(/```\s*$/, "");

      const firstBrace = jsonContent.indexOf("{");
      const lastBrace = jsonContent.lastIndexOf("}");

      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error("No JSON structure found in response");
      }

      jsonContent = jsonContent.substring(firstBrace, lastBrace + 1);
      jsonContent = repairTruncatedJSON(jsonContent);
      jsonContent = jsonContent.replace(/,(\s*[}\]])/g, "$1");

      parsedData = JSON.parse(jsonContent);

      if (!parsedData.lineItems || !Array.isArray(parsedData.lineItems)) {
        throw new Error("Invalid response: missing lineItems array");
      }

      if (parsedData.lineItems.length === 0) {
        throw new Error("No assets found in document");
      }

      // Validate and normalize line items
      // Allow $0 costs for bundle pricing - user can add prices in review
      parsedData.lineItems = parsedData.lineItems.filter((item) => {
        if (!item.parsedName) {
          console.warn("Skipping item missing name:", item);
          return false;
        }
        return true;
      }).map((item) => ({
        ...item,
        purchaseCost: Number(item.purchaseCost) || 0,
        confidenceScore: Math.max(0, Math.min(1, item.confidenceScore || 0.7)),
        suggestedUsefulLifeMonths: item.suggestedUsefulLifeMonths || getUsefulLifeForCategory(item.suggestedCategory),
        suggestedSalvageValue: item.suggestedSalvageValue || 0,
      }));

      console.log(`✅ Parsed ${parsedData.lineItems.length} assets`);

    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to parse document. Please try a clearer image or PDF.",
          details: parseError instanceof Error ? parseError.message : String(parseError),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        vendor: parsedData.vendor,
        purchaseDate: parsedData.purchaseDate,
        totalAmount: parsedData.totalAmount,
        lineItems: parsedData.lineItems,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in process-asset-document:", error);

    // Sanitize error message to avoid leaking internal details
    let userMessage = "An unexpected error occurred while processing the document.";
    if (error instanceof Error) {
      // Only expose safe error messages to the client
      const safePatterns = [
        /timeout/i,
        /too large/i,
        /invalid.*format/i,
        /parsing failed/i,
        /no assets found/i,
      ];
      if (safePatterns.some(pattern => pattern.test(error.message))) {
        userMessage = error.message;
      }
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: userMessage,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});

function getUsefulLifeForCategory(category: string | undefined): number {
  if (!category) return 60;
  const found = DEFAULT_ASSET_CATEGORIES.find(
    c => c.name.toLowerCase() === category.toLowerCase()
  );
  return found?.defaultUsefulLifeMonths ?? 60;
}
