// Shared streaming utilities for AI responses
import { ModelConfig } from "./ai-caller.ts";

/**
 * Process SSE (Server-Sent Events) streaming response and return complete content
 * Handles line-by-line parsing, partial JSON chunks, and [DONE] signals
 */
export async function processStreamedResponse(response: Response): Promise<string> {
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

            // Check for error finish reason
            if (parsed.choices?.[0]?.finish_reason === 'error') {
              throw new Error('Stream terminated with error');
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

    return completeContent;
  } finally {
    reader.cancel();
  }
}

/**
 * Call AI model with streaming support
 * Returns complete content string after stream finishes
 */
export async function callModelWithStreaming(
  modelConfig: ModelConfig,
  requestBody: any,
  openRouterApiKey: string
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

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${openRouterApiKey}`,
          "HTTP-Referer": "https://ncdujvdgqtaunuyigflp.supabase.co",
          "X-Title": "EasyShiftHQ AI",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(streamingBody),
        signal: AbortSignal.timeout(90000) // 90 second timeout for large responses
      });

      if (response.ok) {
        console.log(`✅ ${modelConfig.name} stream started successfully`);
        const content = await processStreamedResponse(response);
        console.log(`✅ ${modelConfig.name} stream completed. Content length: ${content.length}`);
        return content;
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
      if (error instanceof Error && error.name === 'AbortError') {
        console.error(`❌ ${modelConfig.name} timed out after 90 seconds`);
        break; // Don't retry timeouts
      }
      console.error(`❌ ${modelConfig.name} error:`, error);
      retryCount++;
      if (retryCount < modelConfig.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
      }
    }
  }
  
  return null;
}
