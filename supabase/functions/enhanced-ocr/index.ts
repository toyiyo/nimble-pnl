import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { logAICall, type AICallMetadata } from "../_shared/braintrust.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OCRRequest {
  imageData: string; // base64 encoded image
}

// Shared OCR analysis prompt for all models
const ENHANCED_OCR_PROMPT = `Extract ALL visible text from this image with high precision. Focus on:
- Product names and brands
- Numbers (quantities, prices, weights, volumes)
- Dates and codes
- Any visible text regardless of size

Return the extracted text maintaining the layout structure when possible.`;

// Model configurations (prioritized by reliability)
const MODELS = [
  // Primary models
  {
    name: "Llama 4 Maverick",
    id: "meta-llama/llama-4-maverick",
    systemPrompt: "You are an expert OCR system. Extract all visible text precisely.",
    maxRetries: 2
  },
  {
    name: "Gemma 3 27B",
    id: "google/gemma-3-27b-it",
    systemPrompt: "You are an expert OCR system. Extract all visible text precisely.",
    maxRetries: 2
  },
  // Paid models (fallback)
  {
    name: "Gemini 2.5 Flash Lite",
    id: "google/gemini-2.5-flash-lite",
    systemPrompt: "You are an expert OCR system. Extract all visible text precisely.",
    maxRetries: 1
  },
  {
    name: "GPT-4.1 Nano",
    id: "openai/gpt-4.1-nano",
    systemPrompt: "You are an expert OCR system. Extract all visible text precisely.",
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
            text: ENHANCED_OCR_PROMPT
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
          "X-Title": "EasyShiftHQ Enhanced OCR",
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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageData }: OCRRequest = await req.json();
    
    if (!imageData) {
      throw new Error('No image data provided');
    }

    const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!openRouterApiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    console.log('🔍 Starting enhanced OCR with 2-model fallback...');

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
          error: 'Enhanced OCR temporarily unavailable. All AI models failed.',
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
      throw new Error('Invalid response from AI model');
    }

    const extractedText = data.choices[0].message.content || '';
    console.log('✅ Enhanced OCR completed. Extracted text:', extractedText);

    // Calculate confidence based on text length
    let confidence = 0.8;
    if (extractedText.length > 50) confidence = 0.9;
    if (extractedText.length > 100) confidence = 0.95;
    if (extractedText.length === 0) confidence = 0.1;

    return new Response(JSON.stringify({
      text: extractedText,
      confidence: confidence,
      source: 'openrouter'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Enhanced OCR error:', error);
    return new Response(JSON.stringify({
      error: (error as Error).message,
      source: 'openrouter'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});