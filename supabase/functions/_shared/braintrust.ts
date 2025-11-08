// Braintrust telemetry integration for AI observability
import { initLogger } from "npm:braintrust@0.0.163";

// Lazy-initialized logger instance
let logger: any = null;
let loggerInitialized = false;

/**
 * Initialize and get Braintrust logger
 * Returns null if BRAINTRUST_API_KEY is not configured
 */
export function getBraintrustLogger() {
  if (loggerInitialized) {
    return logger;
  }

  const apiKey = Deno.env.get('BRAINTRUST_API_KEY');
  if (!apiKey) {
    console.log('[Braintrust] API key not configured - tracing disabled');
    loggerInitialized = true;
    logger = null;
    return null;
  }

  try {
    logger = initLogger({
      projectName: "EasyShiftHQ AI",
      apiKey: apiKey,
    });
    loggerInitialized = true;
    console.log('[Braintrust] Logger initialized successfully');
    return logger;
  } catch (error) {
    console.error('[Braintrust] Failed to initialize logger:', error);
    loggerInitialized = true;
    logger = null;
    return null;
  }
}

/**
 * Metadata for AI call tracing
 */
export interface AICallMetadata {
  model: string;
  provider: string;
  restaurant_id?: string;
  edge_function: string;
  temperature?: number;
  max_tokens?: number;
  stream: boolean;
  attempt: number;
  success: boolean;
  error?: string;
  status_code?: number;
}

/**
 * Token usage data from OpenRouter responses
 */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd?: number;
}

/**
 * Extract token usage from OpenRouter API response
 */
export function extractTokenUsage(responseData: any): TokenUsage | null {
  try {
    if (!responseData?.usage) {
      return null;
    }

    return {
      prompt_tokens: responseData.usage.prompt_tokens || 0,
      completion_tokens: responseData.usage.completion_tokens || 0,
      total_tokens: responseData.usage.total_tokens || 0,
      cost_usd: responseData.usage.cost_usd,
    };
  } catch (error) {
    console.error('[Braintrust] Error extracting token usage:', error);
    return null;
  }
}

// traceAICall removed - we use manual logging with logAICall for explicit input/output control

/**
 * Log AI call result to Braintrust
 * Used for calls where we have the full context (input, output, tokens)
 */
export function logAICall(
  spanName: string,
  input: any,
  output: any,
  metadata: AICallMetadata,
  tokenUsage?: TokenUsage | null
) {
  const logger = getBraintrustLogger();
  
  if (!logger) {
    return;
  }

  try {
    logger.log({
      input,
      output,
      metadata: {
        ...metadata,
        ...(tokenUsage && {
          prompt_tokens: tokenUsage.prompt_tokens,
          completion_tokens: tokenUsage.completion_tokens,
          total_tokens: tokenUsage.total_tokens,
          cost_usd: tokenUsage.cost_usd,
        }),
      },
      scores: tokenUsage ? {
        total_tokens: tokenUsage.total_tokens,
      } : undefined,
    });
  } catch (error) {
    console.error('[Braintrust] Error logging AI call:', error);
  }
}

/**
 * Start a span for streaming operations
 * Returns a function to end the span with accumulated content
 */
export function startStreamingSpan(
  spanName: string,
  metadata: AICallMetadata
): ((content: string, tokenUsage?: TokenUsage | null) => void) | null {
  const logger = getBraintrustLogger();
  
  if (!logger) {
    return null;
  }

  const startTime = Date.now();
  
  return (content: string, tokenUsage?: TokenUsage | null) => {
    try {
      logger.log({
        input: { model: metadata.model },
        output: content,
        metadata: {
          ...metadata,
          duration_ms: Date.now() - startTime,
          ...(tokenUsage && {
            prompt_tokens: tokenUsage.prompt_tokens,
            completion_tokens: tokenUsage.completion_tokens,
            total_tokens: tokenUsage.total_tokens,
            cost_usd: tokenUsage.cost_usd,
          }),
        },
        scores: tokenUsage ? {
          total_tokens: tokenUsage.total_tokens,
        } : undefined,
      });
    } catch (error) {
      console.error('[Braintrust] Error ending streaming span:', error);
    }
  };
}
