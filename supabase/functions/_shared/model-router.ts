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

// Model configurations (free models first, then paid fallbacks)
export const MODELS = [
  // Free models - good for general chat
  {
    name: "Llama 4 Maverick Free",
    id: "meta-llama/llama-4-maverick:free",
    supportsTools: true,
    cost: 0,
  },
  {
    name: "Gemma 3 27B Free",
    id: "google/gemma-3-27b-it:free",
    supportsTools: true,
    cost: 0,
  },
  // Paid fallbacks
  {
    name: "Gemini Flash",
    id: "google/gemini-flash-1.5",
    supportsTools: true,
    cost: 1,
  },
  {
    name: "Claude Haiku",
    id: "anthropic/claude-3-haiku",
    supportsTools: true,
    cost: 2,
  },
  {
    name: "GPT-4o Mini",
    id: "openai/gpt-4o-mini",
    supportsTools: true,
    cost: 3,
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

  // Select model based on routing key
  let selectedModel = availableModels[0]; // Default to first (free) model

  switch (routingKey) {
    case 'sql_heavy':
      // Use a more capable model for complex SQL queries
      selectedModel = availableModels.find(m => m.id.includes('gemini')) || selectedModel;
      break;
    case 'narrative':
      // Use a model better at natural language
      selectedModel = availableModels.find(m => m.id.includes('claude')) || selectedModel;
      break;
    case 'fast_preview':
      // Use the fastest free model
      selectedModel = availableModels[0];
      break;
    default:
      // Use first available free model
      selectedModel = availableModels[0];
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
 */
export function getModelFallbackList(requiresTools = true): string[] {
  const models = requiresTools 
    ? MODELS.filter(m => m.supportsTools)
    : MODELS;
  
  return models
    .sort((a, b) => a.cost - b.cost) // Sort by cost (free first)
    .map(m => m.id);
}
