// Shared AI calling utility with multi-model fallback

export interface ModelConfig {
  name: string;
  id: string;
  maxRetries: number;
}

// Model configurations (free models first, then paid fallbacks)
export const MODELS: ModelConfig[] = [
  // Free models
  {
    name: "Llama 4 Maverick Free",
    id: "meta-llama/llama-4-maverick:free",
    maxRetries: 2
  },
  {
    name: "Gemma 3 27B Free",
    id: "google/gemma-3-27b-it:free",
    maxRetries: 2
  },
  // Paid models (fallback)
  {
    name: "Gemini 2.5 Flash Lite",
    id: "google/gemini-2.5-flash-lite",
    maxRetries: 1
  },
  {
    name: "Claude Sonnet 4.5",
    id: "anthropic/claude-sonnet-4-5",
    maxRetries: 1
  },
  {
    name: "Llama 4 Maverick Paid",
    id: "meta-llama/llama-4-maverick",
    maxRetries: 1
  }
];

/**
 * Call OpenRouter AI with retries and exponential backoff
 */
export async function callModel(
  modelConfig: ModelConfig,
  requestBody: any,
  openRouterApiKey: string
): Promise<Response | null> {
  let retryCount = 0;
  
  while (retryCount < modelConfig.maxRetries) {
    try {
      console.log(`🔄 ${modelConfig.name} attempt ${retryCount + 1}/${modelConfig.maxRetries}...`);
      
      // Override model in request body
      const body = { ...requestBody, model: modelConfig.id };

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://ncdujvdgqtaunuyigflp.supabase.co",
          "X-Title": "Nimble PnL AI",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
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

/**
 * Call AI with multi-model fallback and return parsed result
 */
export async function callAIWithFallback<T>(
  requestBody: any,
  openRouterApiKey: string
): Promise<{ data: T; model: string } | null> {
  console.log(`🚀 Starting AI call with multi-model fallback...`);

  for (const modelConfig of MODELS) {
    console.log(`🚀 Trying ${modelConfig.name}...`);
    
    const response = await callModel(modelConfig, requestBody, openRouterApiKey);
    
    if (!response || !response.ok) {
      console.log(`⚠️ ${modelConfig.name} failed, trying next model...`);
      continue;
    }

    // Try to parse the response
    try {
      const data = await response.json();
      
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        console.error(`❌ ${modelConfig.name} returned invalid response structure`);
        continue;
      }

      const content = data.choices[0].message.content;
      
      if (!content) {
        console.error(`❌ ${modelConfig.name} returned empty content`);
        continue;
      }

      // Parse the JSON content
      const result = JSON.parse(content);
      
      console.log(`✅ ${modelConfig.name} successfully returned result`);
      return { data: result, model: modelConfig.name };
      
    } catch (parseError) {
      console.error(`❌ ${modelConfig.name} parsing error:`, parseError instanceof Error ? parseError.message : String(parseError));
      console.log(`⚠️ Trying next model due to parsing failure...`);
      continue;
    }
  }

  console.error('❌ All models failed');
  return null;
}
