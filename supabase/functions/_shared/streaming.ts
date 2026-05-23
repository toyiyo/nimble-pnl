// Shared streaming utilities for AI responses
import { ModelConfig } from "./ai-caller.ts";
import { startStreamingSpan, logAICall, type AICallMetadata } from "./braintrust.ts";

export interface StreamingResult {
  content: string;
  /** OpenAI/OpenRouter finish_reason from the last delta seen ("stop", "length", "tool_calls", etc.) */
  finishReason: string | null;
}

/**
 * Process SSE (Server-Sent Events) streaming response and return complete content
 * Handles line-by-line parsing, partial JSON chunks, and [DONE] signals
 */
export async function processStreamedResponse(response: Response): Promise<StreamingResult> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let completeContent = '';
  let finishReason: string | null = null;
  let isComplete = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decode chunk and add to buffer
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      while (true) {
        const lineEnd = buffer.indexOf('\n');
        if (lineEnd === -1) break;

        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        // Skip empty lines and SSE comments
        if (!line || line.startsWith(':')) continue;

        // Parse SSE data
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          // Check for stream completion signal
          if (data === '[DONE]') {
            isComplete = true;
            break;
          }

          try {
            const parsed = JSON.parse(data);

            // Check for errors in the stream
            if (parsed.error) {
              throw new Error(`Stream error: ${parsed.error.message || 'Unknown error'}`);
            }

            // Extract content delta
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              completeContent += content;
            }

            const reason = parsed.choices?.[0]?.finish_reason;
            if (reason) {
              finishReason = reason;
              if (reason === 'error') {
                throw new Error('Stream terminated with error');
              }
            }
          } catch (e) {
            // If JSON parsing fails, it might be a partial chunk - continue
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      if (isComplete) break;
    }

    return { content: completeContent, finishReason };
  } finally {
    reader.cancel();
  }
}

/**
 * Call AI model with streaming support
 * Returns complete content string after stream finishes
 *
 * @param externalSignal Optional caller-supplied abort signal. Combined with the
 *   internal 90s per-attempt timeout so an outer chain budget can cancel an
 *   in-flight call.
 */
export async function callModelWithStreaming(
  modelConfig: ModelConfig,
  requestBody: any,
  openRouterApiKey: string,
  edgeFunction: string = 'unknown',
  restaurantId?: string,
  externalSignal?: AbortSignal
): Promise<string | null> {
  let retryCount = 0;

  while (retryCount < modelConfig.maxRetries) {
    try {
      console.log(`🔄 ${modelConfig.name} (streaming) attempt ${retryCount + 1}/${modelConfig.maxRetries}...`);

      // Add streaming flag and override model
      const streamingBody = {
        ...requestBody,
        model: modelConfig.id,
        stream: true
      };

      const metadata: AICallMetadata = {
        model: modelConfig.id,
        provider: "openrouter",
        restaurant_id: restaurantId,
        edge_function: edgeFunction,
        temperature: streamingBody.temperature,
        max_tokens: streamingBody.max_tokens,
        stream: true,
        attempt: retryCount + 1,
        success: false,
      };

      // Start streaming span
      const endSpan = startStreamingSpan(
        `${edgeFunction}:streaming`,
        { messages: requestBody.messages, model: modelConfig.id },
        metadata
      );

      // Per-attempt 90s timeout, combined with any caller-supplied chain budget signal.
      const timeoutSignal = AbortSignal.timeout(90000);
      const signal = externalSignal
        ? AbortSignal.any([timeoutSignal, externalSignal])
        : timeoutSignal;

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://ncdujvdgqtaunuyigflp.supabase.co",
          "X-Title": "EasyShiftHQ AI",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(streamingBody),
        signal,
      });

      if (response.ok) {
        console.log(`✅ ${modelConfig.name} stream started successfully`);
        const { content, finishReason } = await processStreamedResponse(response);
        console.log(
          `✅ ${modelConfig.name} stream completed. Content length: ${content.length}, finish_reason: ${finishReason ?? 'null'}`
        );

        // Reject truncated outputs (model hit max_tokens). With strict json_schema
        // a length-truncated payload is almost never parseable, but the previous
        // non-streaming path skipped on finish_reason=length explicitly and we
        // restore that here so the next model in the chain gets a chance.
        if (finishReason === 'length') {
          console.warn(
            `⚠️ ${modelConfig.name} truncated output (finish_reason=length), skipping to next model`
          );
          logAICall(
            `${edgeFunction}:streaming:truncated`,
            { messages: requestBody.messages, model: modelConfig.id },
            { content_length: content.length },
            { ...metadata, success: false, status_code: 200, error: 'finish_reason=length' },
            null
          );
          if (endSpan) {
            endSpan(content, null);
          }
          return null;
        }

        // End streaming span with complete content
        // Note: We don't have token usage for streaming responses from OpenRouter
        if (endSpan) {
          endSpan(content, null);
        }

        // Also log the successful streaming call
        logAICall(
          `${edgeFunction}:streaming:success`,
          { messages: requestBody.messages, model: modelConfig.id },
          { content, content_length: content.length },
          { ...metadata, success: true, status_code: 200 },
          null
        );

        return content;
      }

      if (response.status === 429 && retryCount < modelConfig.maxRetries - 1) {
        console.log(`🔄 ${modelConfig.name} rate limited, waiting before retry...`);
        
        // Log rate limit
        logAICall(
          `${edgeFunction}:streaming:rate_limit`,
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
        
        // Log error
        logAICall(
          `${edgeFunction}:streaming:error`,
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
        console.error(`❌ ${modelConfig.name} timed out after 90 seconds`);
        
        // Log timeout
        logAICall(
          `${edgeFunction}:streaming:timeout`,
          { messages: requestBody.messages, model: modelConfig.id },
          { error: 'Request timeout after 90s' },
          { 
            model: modelConfig.id,
            provider: "openrouter",
            restaurant_id: restaurantId,
            edge_function: edgeFunction,
            stream: true,
            attempt: retryCount + 1,
            success: false,
            error: 'Request timeout after 90s'
          },
          null
        );
        
        break; // Don't retry timeouts
      }
      console.error(`❌ ${modelConfig.name} error:`, error);
      
      // Log error
      logAICall(
        `${edgeFunction}:streaming:error`,
        { messages: requestBody.messages, model: modelConfig.id },
        { error: errorMessage },
        { 
          model: modelConfig.id,
          provider: "openrouter",
          restaurant_id: restaurantId,
          edge_function: edgeFunction,
          stream: true,
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
