import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface OCRRequest {
  imageData: string; // base64 encoded image
}

// Shared OCR analysis prompt for all models
const OCR_ANALYSIS_PROMPT = `You are an expert OCR system specialized in food packaging and product labels for restaurant inventory management.

Analyze this image and extract ALL visible text with special attention to:

**CRITICAL INFORMATION:**
1. Product name and brand (usually largest text)
2. Package sizes: weights (oz, lb, g, kg), volumes (ml, L, fl oz), counts (ct, pack)
3. Supplier/distributor codes or names (often in small print)
4. Batch numbers, lot codes, expiration dates
5. Nutritional information numbers
6. Ingredient lists
7. Barcode/UPC codes if visible

**EXTRACTION RULES:**
- Preserve exact spelling and capitalization
- Include ALL numbers with their units
- Note text hierarchy (large → small)
- Extract any supplier stamps or distributor marks
- Look for 'Distributed by' or 'Packed for' text
- Include route numbers or warehouse codes

**SUPPLIER DETECTION:**
Look specifically for:
- Company logos/names (Sysco, US Foods, Performance Food Group, etc.)
- Distributor stamps or codes
- Supplier SKU numbers
- Route delivery information

**CRITICAL: Return ONLY valid JSON** in this exact format (no markdown, no code blocks, no extra text):
{
  "brand": "brand name or empty string",
  "productName": "product name",
  "sizeValue": "numeric value only (e.g., 20, 228) or null",
  "sizeUnit": "unit only (e.g., oz, lb, g, kg, ct, servings) or null",
  "packageDescription": "full size description (e.g., '20 Servings Per Container, 1 Pack (228g)')",
  "supplier": "supplier/distributor name or empty string",
  "batchLot": "batch or lot number or empty string",
  "upcBarcode": "UPC/barcode if visible or empty string",
  "ingredients": "ingredient list if visible or empty string",
  "nutritionFacts": "brief nutrition summary if visible or empty string"
}

Be thorough - small text often contains critical supplier and batch information for inventory management.`;

// Model configurations (free models first, then paid fallbacks)
const MODELS = [
  // Free models
  {
    name: "Llama 4 Maverick Free",
    id: "meta-llama/llama-4-maverick:free",
    systemPrompt: "You are an expert OCR system for food packaging and inventory labels.",
    maxRetries: 2
  },
  {
    name: "Gemma 3 27B Free",
    id: "google/gemma-3-27b-it:free",
    systemPrompt: "You are an expert OCR system for food packaging and inventory labels.",
    maxRetries: 2
  },
  // Paid models (fallback)
  {
    name: "Gemini 2.5 Flash Lite",
    id: "google/gemini-2.5-flash-lite",
    systemPrompt: "You are an expert OCR system for food packaging and inventory labels.",
    maxRetries: 1
  },
  {
    name: "GPT-4.1 Nano",
    id: "openai/gpt-4.1-nano",
    systemPrompt: "You are an expert OCR system for food packaging and inventory labels.",
    maxRetries: 1
  },
  {
    name: "Llama 4 Maverick Paid",
    id: "meta-llama/llama-4-maverick",
    systemPrompt: "You are an expert OCR system for food packaging and inventory labels.",
    maxRetries: 1
  }
];

// Helper function to build consistent request bodies
function buildOCRRequestBody(
  modelId: string,
  systemPrompt: string,
  imageData: string
): any {
  return {
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
            text: OCR_ANALYSIS_PROMPT
          },
          {
            type: "image_url",
            image_url: {
              url: imageData
            }
          }
        ]
      }
    ],
    max_tokens: 500,
    temperature: 0.1
  };
}

// Generic function to call a model with retries
async function callModel(
  modelConfig: typeof MODELS[0],
  imageData: string,
  openRouterApiKey: string
): Promise<Response | null> {
  let retryCount = 0;
  
  while (retryCount < modelConfig.maxRetries) {
    try {
      console.log(`🔄 ${modelConfig.name} attempt ${retryCount + 1}/${modelConfig.maxRetries}...`);
      
      const requestBody = buildOCRRequestBody(
        modelConfig.id,
        modelConfig.systemPrompt,
        imageData
      );

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://app.easyshifthq.com",
          "X-Title": "EasyShiftHQ Inventory OCR",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        console.log(`✅ ${modelConfig.name} succeeded`);
        return response;
      }

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

    console.log('🔍 Starting OCR with 2-model fallback...');

    let finalResponse: Response | undefined;

    // Try models in order: Mistral -> Grok
    for (const modelConfig of MODELS) {
      console.log(`🚀 Trying ${modelConfig.name}...`);
      
      const response = await callModel(
        modelConfig,
        imageData,
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
      console.error('❌ All models (Mistral, Grok) failed');
      
      return new Response(
        JSON.stringify({ 
          error: 'OCR temporarily unavailable. All AI models failed.',
          details: 'Mistral and Grok are currently unavailable'
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
        JSON.stringify({ error: 'Invalid response from OpenRouter API' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500 
        }
      );
    }

    const extractedText = data.choices[0].message.content || '';
    console.log('✅ Grok OCR completed. Raw response:', extractedText);

    // Try to parse as JSON
    let structuredData = null;
    let parseError = null;
    
    try {
      // Remove markdown code blocks if present
      const cleanedText = extractedText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      
      structuredData = JSON.parse(cleanedText);
      console.log('✅ Successfully parsed structured data:', structuredData);
    } catch (e) {
      parseError = e instanceof Error ? e.message : 'Failed to parse JSON';
      console.warn('⚠️ Could not parse as JSON, returning raw text:', parseError);
    }

    // Calculate a confidence score based on whether we got structured data
    let confidence = structuredData ? 0.95 : 0.7;
    if (!extractedText || extractedText.length === 0) confidence = 0.1;

    return new Response(
      JSON.stringify({ 
        text: extractedText,
        structuredData: structuredData,
        confidence: confidence,
        source: 'grok-4-fast',
        parseError: parseError
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