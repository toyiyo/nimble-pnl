// Shared AI calling utility with multi-model fallback
import { logAICall, extractTokenUsage, type AICallMetadata } from "./braintrust.ts";

export interface ModelConfig {
  name: string;
  id: string;
  maxRetries: number;
}

// Model configurations (Gemini 2.5 Flash Lite as default, then free models, then paid fallbacks)
export const MODELS: ModelConfig[] = [
  // Primary model (fast, reliable, large context window)
  {
    name: "Gemini 2.5 Flash Lite",
    id: "google/gemini-2.5-flash-lite",
    maxRetries: 2
  },
  // Secondary models
  {
    name: "Llama 4 Maverick",
    id: "meta-llama/llama-4-maverick",
    maxRetries: 2
  },
  {
    name: "Gemma 3 27B",
    id: "google/gemma-3-27b-it",
    maxRetries: 2
  },
  // Paid models (final fallback)
  {
    name: "Claude Sonnet 4.5",
    id: "anthropic/claude-sonnet-4-5",
    maxRetries: 1
  }
];

/**
 * Call OpenRouter AI with retries and exponential backoff
 */
export async function callModel(
  modelConfig: ModelConfig,
  requestBody: any,
  openRouterApiKey: string,
  edgeFunction: string = 'unknown',
  restaurantId?: string
): Promise<Response | null> {
  let retryCount = 0;
  
  while (retryCount < modelConfig.maxRetries) {
    try {
      console.log(`🔄 ${modelConfig.name} attempt ${retryCount + 1}/${modelConfig.maxRetries}...`);
      
      // Override model in request body
      const body = { ...requestBody, model: modelConfig.id };

      const metadata: AICallMetadata = {
        model: modelConfig.id,
        provider: "openrouter",
        restaurant_id: restaurantId,
        edge_function: edgeFunction,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
        stream: false,
        attempt: retryCount + 1,
        success: false,
      };

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://ncdujvdgqtaunuyigflp.supabase.co",
          "X-Title": "EasyShiftHQ AI",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000) // 30 second timeout
      });

      if (response.ok) {
        console.log(`✅ ${modelConfig.name} succeeded`);
        
        // Clone response to extract usage data without consuming the original
        const clonedResponse = response.clone();
        try {
          const responseData = await clonedResponse.json();
          const tokenUsage = extractTokenUsage(responseData);
          
          // Log successful call with token usage
          logAICall(
            `${edgeFunction}:callModel:success`,
            { messages: requestBody.messages, model: modelConfig.id },
            responseData,
            { ...metadata, success: true, status_code: response.status },
            tokenUsage
          );
        } catch (e) {
          // If we can't parse response for logging, continue anyway
          console.log('[Braintrust] Could not extract response data for logging');
        }
        
        return response;
      }

      if (response.status === 429 && retryCount < modelConfig.maxRetries - 1) {
        console.log(`🔄 ${modelConfig.name} rate limited, waiting before retry...`);
        
        // Log rate limit
        logAICall(
          `${edgeFunction}:callModel:rate_limit`,
          { messages: requestBody.messages, model: modelConfig.id },
          { error: 'Rate limited' },
          { ...metadata, success: false, status_code: 429, error: 'Rate limited' },
          null
        );
        
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount + 1) * 1000));
        retryCount++;
      } else {
        const errorText = await response.text();
        console.error(`❌ ${modelConfig.name} failed:`, response.status, errorText);
        
        // Log failure
        logAICall(
          `${edgeFunction}:callModel:error`,
          { messages: requestBody.messages, model: modelConfig.id },
          { error: errorText },
          { ...metadata, success: false, status_code: response.status, error: errorText },
          null
        );
        
        break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`❌ ${modelConfig.name} timed out after 30 seconds`);
        
        // Log timeout
        logAICall(
          `${edgeFunction}:callModel:timeout`,
          { messages: requestBody.messages, model: modelConfig.id },
          { error: 'Request timeout after 30s' },
          { 
            model: modelConfig.id,
            provider: "openrouter",
            restaurant_id: restaurantId,
            edge_function: edgeFunction,
            stream: false,
            attempt: retryCount + 1,
            success: false,
            error: 'Request timeout after 30s'
          },
          null
        );
        
        break; // Don't retry timeouts
      }
      console.error(`❌ ${modelConfig.name} error:`, error);
      
      // Log error
      logAICall(
        `${edgeFunction}:callModel:error`,
        { messages: requestBody.messages, model: modelConfig.id },
        { error: errorMessage },
        { 
          model: modelConfig.id,
          provider: "openrouter",
          restaurant_id: restaurantId,
          edge_function: edgeFunction,
          stream: false,
          attempt: retryCount + 1,
          success: false,
          error: errorMessage
        },
        null
      );
      
      retryCount++;
      if (retryCount < modelConfig.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      }
    }
  }
  
  return null;
}

/**
 * Call AI with multi-model fallback and return parsed result (non-streaming)
 */
export async function callAIWithFallback<T>(
  requestBody: any,
  openRouterApiKey: string,
  edgeFunction: string = 'unknown',
  restaurantId?: string
): Promise<{ data: T; model: string } | null> {
  console.log(`🚀 Starting AI call with multi-model fallback...`);

  for (const modelConfig of MODELS) {
    console.log(`🚀 Trying ${modelConfig.name}...`);
    
    const response = await callModel(modelConfig, requestBody, openRouterApiKey, edgeFunction, restaurantId);
    
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
      
      // Log successful fallback result
      const tokenUsage = extractTokenUsage(data);
      logAICall(
        `${edgeFunction}:callAIWithFallback:success`,
        { messages: requestBody.messages },
        { result, model: modelConfig.name },
        { 
          model: modelConfig.id,
          provider: 'openrouter',
          restaurant_id: restaurantId,
          edge_function: edgeFunction,
          stream: false,
          attempt: MODELS.indexOf(modelConfig) + 1,
          success: true,
        },
        tokenUsage
      );
      
      return { data: result, model: modelConfig.name };
      
    } catch (parseError) {
      console.error(`❌ ${modelConfig.name} parsing error:`, parseError instanceof Error ? parseError.message : String(parseError));
      console.log(`⚠️ Trying next model due to parsing failure...`);
      continue;
    }
  }

  console.error('❌ All models failed');
  
  // Log complete failure
  logAICall(
    `${edgeFunction}:callAIWithFallback:all_failed`,
    { messages: requestBody.messages },
    { error: 'All models failed' },
    { 
      model: 'all-models',
      provider: 'openrouter',
      restaurant_id: restaurantId,
      edge_function: edgeFunction,
      stream: false,
      attempt: MODELS.length,
      success: false,
      error: 'All models failed'
    },
    null
  );
  
  return null;
}

/**
 * Call AI with multi-model fallback using streaming (for large responses)
 * Returns parsed result after stream completes
 */
export async function callAIWithFallbackStreaming<T>(
  requestBody: any,
  openRouterApiKey: string,
  edgeFunction: string = 'unknown',
  restaurantId?: string
): Promise<{ data: T; model: string } | null> {
  // Import streaming utilities dynamically to avoid circular dependencies
  const { callModelWithStreaming } = await import("./streaming.ts");
  
  console.log(`🚀 Starting AI call with streaming multi-model fallback...`);

  for (const modelConfig of MODELS) {
    console.log(`🚀 Trying ${modelConfig.name} (streaming)...`);
    
    try {
      const content = await callModelWithStreaming(modelConfig, requestBody, openRouterApiKey, edgeFunction, restaurantId);
      
      if (!content) {
        console.log(`⚠️ ${modelConfig.name} failed, trying next model...`);
        continue;
      }

      // Parse the JSON content
      const result = JSON.parse(content);
      
      console.log(`✅ ${modelConfig.name} successfully returned result via streaming`);
      
      // Log successful streaming result
      // Note: Token usage is logged within callModelWithStreaming
      logAICall(
        `${edgeFunction}:callAIWithFallbackStreaming:success`,
        { messages: requestBody.messages },
        { result, model: modelConfig.name, content_length: content.length },
        { 
          model: modelConfig.id,
          provider: 'openrouter',
          restaurant_id: restaurantId,
          edge_function: edgeFunction,
          stream: true,
          attempt: MODELS.indexOf(modelConfig) + 1,
          success: true,
        },
        null // Token usage already logged in streaming function
      );
      
      return { data: result, model: modelConfig.name };
      
    } catch (parseError) {
      console.error(`❌ ${modelConfig.name} streaming error:`, parseError instanceof Error ? parseError.message : String(parseError));
      console.log(`⚠️ Trying next model due to streaming/parsing failure...`);
      continue;
    }
  }

  console.error('❌ All models failed (streaming)');
  
  // Log complete failure
  logAICall(
    `${edgeFunction}:callAIWithFallbackStreaming:all_failed`,
    { messages: requestBody.messages },
    { error: 'All models failed (streaming)' },
    { 
      model: 'all-models',
      provider: 'openrouter',
      restaurant_id: restaurantId,
      edge_function: edgeFunction,
      stream: true,
      attempt: MODELS.length,
      success: false,
      error: 'All models failed (streaming)'
    },
    null
  );
  
  return null;
}
