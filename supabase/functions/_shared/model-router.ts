// Model Router - Selects appropriate AI model based on routing key and requirements

export interface ModelConfig {
  provider: 'openrouter';
  model: string;
  options: {
    temperature: number;
    top_p?: number;
    max_tokens?: number;
  };
}

export interface GetModelOptions {
  routingKey?: string;
  requiresTools?: boolean;
}

// Model configurations (prioritize reliable tool-calling models)
export const MODELS = [
  // Finance-optimized models
  {
    name: "Gemini 2.5 Flash Lite",
    id: "google/gemini-2.5-flash-lite",
    supportsTools: true,
    reliableTools: true,
    malformedFallback: false, // Primary model, not a fallback
    cost: 1,
  },
  // Best tool-calling models (paid but reliable)
  {
    name: "Gemini Flash",
    id: "google/gemini-flash-1.5",
    supportsTools: true,
    reliableTools: true,
    malformedFallback: false,
    cost: 2,
  },
  // Reliable fallbacks for MALFORMED_FUNCTION_CALL errors
  {
    name: "Gemini 2.5 Flash",
    id: "google/gemini-2.5-flash",
    supportsTools: true,
    reliableTools: true,
    malformedFallback: true, // Good fallback for malformed tool calls
    cost: 2,
  },
  {
    name: "Gemini 3 Flash Preview",
    id: "google/gemini-3-flash-preview",
    supportsTools: true,
    reliableTools: true,
    malformedFallback: true, // Good fallback for malformed tool calls
    cost: 2,
  },
  {
    name: "Claude Haiku",
    id: "anthropic/claude-3-haiku",
    supportsTools: true,
    reliableTools: true,
    malformedFallback: true, // Very reliable tool calling, good fallback
    cost: 3,
  },
  {
    name: "GPT-4o Mini",
    id: "openai/gpt-4o-mini",
    supportsTools: true,
    reliableTools: true,
    malformedFallback: true, // Very reliable tool calling, good fallback
    cost: 4,
  },
  // Additional models
  {
    name: "Llama 4 Maverick",
    id: "meta-llama/llama-4-maverick",
    supportsTools: true,
    reliableTools: false,
    malformedFallback: false,
    cost: 5,
  },
  {
    name: "Gemma 3 27B",
    id: "google/gemma-3-27b-it",
    supportsTools: true,
    reliableTools: false,
    malformedFallback: false,
    cost: 5,
  },
];

/**
 * Get the appropriate model based on routing key
 * @param options Configuration for model selection
 * @returns Model configuration
 */
export function getModel(options: GetModelOptions = {}): ModelConfig {
  const { routingKey = 'default', requiresTools = true } = options;

  // Filter models that support tools if required
  const availableModels = requiresTools 
    ? MODELS.filter(m => m.supportsTools)
    : MODELS;

  // For tool calling, prioritize reliable models
  let selectedModel = availableModels[0];

  if (requiresTools) {
    // Prefer models with reliable tool calling
    const reliableModel = availableModels.find(m => m.reliableTools);
    if (reliableModel) {
      selectedModel = reliableModel;
    }
  }

  // Override based on routing key
  switch (routingKey) {
    case 'sql_heavy':
      // Use Gemini for complex SQL queries
      selectedModel = availableModels.find(m => m.id.includes('gemini')) || selectedModel;
      break;
    case 'narrative':
      // Use Claude for natural language
      selectedModel = availableModels.find(m => m.id.includes('claude')) || selectedModel;
      break;
    case 'fast_preview':
      // Use fastest available model (even if less reliable)
      selectedModel = availableModels[availableModels.length - 1];
      break;
  }

  return {
    provider: 'openrouter',
    model: selectedModel.id,
    options: {
      temperature: 0.7,
      max_tokens: 4096,
    },
  };
}

/**
 * Get list of models for fallback (in order of preference)
 * Prioritizes reliable tool-calling models over free models
 */
export function getModelFallbackList(requiresTools = true): string[] {
  const models = requiresTools
    ? MODELS.filter(m => m.supportsTools)
    : MODELS;

  // Create a shallow copy to avoid mutating the original MODELS array
  return [...models]
    .sort((a, b) => {
      // Prioritize reliable tool-calling models over cost
      if (requiresTools && a.reliableTools !== b.reliableTools) {
        return a.reliableTools ? -1 : 1;
      }
      // Then sort by cost
      return a.cost - b.cost;
    })
    .map(m => m.id);
}

/**
 * Get fallback models specifically for MALFORMED_FUNCTION_CALL errors.
 * Returns models marked with malformedFallback: true in the MODELS array.
 * These models are known to handle tool calls more reliably.
 * Used when the initial model returns a malformed function call response.
 */
export function getMalformedFallbackModels(): string[] {
  return MODELS
    .filter(m => m.malformedFallback && m.supportsTools && m.reliableTools)
    .map(m => m.id);
}
