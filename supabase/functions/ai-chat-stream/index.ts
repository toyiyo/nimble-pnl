import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getModel, getModelFallbackList } from "../_shared/model-router.ts";
import { getTools } from "../_shared/tools-registry.ts";

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') || '';
const MAX_PROMPT_TOKENS = 100000;
const MAX_MESSAGES = 100;

interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

interface ChatRequest {
  projectRef?: string; // restaurant_id
  messages: ChatMessage[];
  model?: string;
  routingKey?: string;
}

/**
 * Call OpenRouter API with streaming
 */
async function callOpenRouter(
  model: string,
  messages: ChatMessage[],
  tools: any[],
  signal?: AbortSignal
): Promise<ReadableStream> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://app.easyshifthq.com',
      'X-Title': 'EasyShiftHQ AI Assistant',
    },
    body: JSON.stringify({
      model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.name && { name: m.name }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
      })),
      tools: tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      tool_choice: 'auto',
      temperature: 0.7,
      stream: true,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = `OpenRouter API error: ${errorText}`;
    
    // Parse error to check if it's a moderation error
    try {
      const errorData = JSON.parse(errorText);
      if (errorData.error) {
        errorMessage = `Model ${model} failed: ${errorData.error.message || errorText}`;
        
        // Check for moderation errors (403)
        if (errorData.error.code === 403 || response.status === 403) {
          console.log(`[OpenRouter] Moderation error on model ${model}:`, errorData.error.message);
          throw new Error(`MODERATION_ERROR: ${errorMessage}`);
        }
      }
    } catch (parseError) {
      // If parsing fails, use the raw error text
      console.error('[OpenRouter] Failed to parse error response:', parseError);
    }
    
    throw new Error(errorMessage);
  }

  return response.body!;
}

/**
 * Parse SSE stream from OpenRouter
 */
async function* parseSSEStream(stream: ReadableStream): AsyncGenerator<any> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          
          try {
            yield JSON.parse(data);
          } catch (e) {
            console.error('Failed to parse SSE data:', e);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Stream response with SSE
 */
function createSSEStream(
  openRouterStream: ReadableStream,
  messageId: string
): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      // Send message_start event
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'message_start', id: messageId })}\n\n`)
      );

      let fullContent = '';
      let toolCalls: any[] = [];

      try {
        for await (const chunk of parseSSEStream(openRouterStream)) {
          const delta = chunk.choices?.[0]?.delta;
          
          if (!delta) continue;

          // Handle content delta
          if (delta.content) {
            fullContent += delta.content;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ 
                type: 'message_delta', 
                id: messageId, 
                delta: delta.content 
              })}\n\n`)
            );
          }

          // Handle tool calls
          if (delta.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index;
              
              if (!toolCalls[index]) {
                toolCalls[index] = {
                  id: toolCall.id || `tc_${Date.now()}_${index}`,
                  type: 'function',
                  function: {
                    name: toolCall.function?.name || '',
                    arguments: toolCall.function?.arguments || '',
                  },
                };
              } else {
                // Append to existing tool call
                if (toolCall.function?.name) {
                  toolCalls[index].function.name += toolCall.function.name;
                }
                if (toolCall.function?.arguments) {
                  toolCalls[index].function.arguments += toolCall.function.arguments;
                }
              }
            }
          }
        }

        // Send tool calls if any
        if (toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({
                  type: 'tool_call',
                  id: toolCall.id,
                  tool: {
                    name: toolCall.function.name,
                    arguments: args,
                  },
                })}\n\n`)
              );
            } catch (e) {
              console.error('Failed to parse tool arguments:', e);
            }
          }
        }

        // Send message_end event
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'message_end', id: messageId })}\n\n`)
        );

        controller.close();
      } catch (error) {
        console.error('Stream error:', error);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ 
            type: 'error', 
            error: { 
              code: 'STREAM_ERROR', 
              message: error.message 
            } 
          })}\n\n`)
        );
        controller.close();
      }
    },
  });
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // Parse request body
    const body: ChatRequest = await req.json();
    const { projectRef, messages, routingKey } = body;

    if (!projectRef) {
      throw new Error('Missing projectRef (restaurant_id)');
    }

    if (!messages || messages.length === 0) {
      throw new Error('Messages array is required');
    }

    // Validate message count
    if (messages.length > MAX_MESSAGES) {
      throw new Error(`Too many messages (max ${MAX_MESSAGES})`);
    }

    // Verify user has access to this restaurant
    const { data: userRestaurant, error: accessError } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', projectRef)
      .single();

    if (accessError || !userRestaurant) {
      throw new Error('Access denied to this restaurant');
    }

    // Get model configuration
    const modelConfig = getModel({ routingKey, requiresTools: true });
    
    // Get available tools based on user role
    const tools = getTools(projectRef, userRestaurant.role);

    // Add system message if not present
    const systemMessage = {
      role: 'system' as const,
      content: `You are a helpful AI assistant for EasyShiftHQ, a restaurant management system. 
You help restaurant owners and managers with their operations, financials, inventory, and recipes.

Current restaurant ID: ${projectRef}
User role: ${userRestaurant.role}

When users ask questions:
- Be concise and helpful
- Use the available tools to fetch real data
- Provide actionable insights based on actual numbers
- Navigate users to relevant sections when needed
- Format numbers and dates clearly
- When users ask for insights, recommendations, or advice, use the get_ai_insights tool (owners only)
- Always use tools to get real-time data rather than making assumptions

Available tools: ${tools.map(t => t.name).join(', ')}

Special tool: get_ai_insights
- Use this when owners ask for business advice, insights, or recommendations
- Available focus areas: cost_reduction, revenue_growth, inventory_optimization, menu_engineering, overall_health
- Example triggers: "Give me insights", "How can I reduce costs?", "What should I improve?", "Analyze my business"

Always use tools to get real-time data rather than making assumptions.`,
    };

    const messagesWithSystem = messages[0]?.role === 'system' 
      ? messages 
      : [systemMessage, ...messages];

    // Call OpenRouter with fallback logic
    const modelList = getModelFallbackList(true);
    let selectedModel = body.model || modelConfig.model;
    
    if (!modelList.includes(selectedModel)) {
      selectedModel = modelList[0];
    }

    // Try models in order until one succeeds
    let openRouterStream: ReadableStream | null = null;
    let lastError: Error | null = null;
    const attemptedModels: string[] = [];

    for (const model of modelList) {
      // Start with the selected model if it's in the list
      const currentModel = attemptedModels.length === 0 && modelList.includes(selectedModel) 
        ? selectedModel 
        : model;
      
      // Skip if already attempted
      if (attemptedModels.includes(currentModel)) {
        continue;
      }

      attemptedModels.push(currentModel);
      
      try {
        console.log(`[OpenRouter] Attempting model: ${currentModel}`);
        openRouterStream = await callOpenRouter(
          currentModel,
          messagesWithSystem,
          tools
        );
        console.log(`[OpenRouter] Successfully connected with model: ${currentModel}`);
        break; // Success! Exit the loop
      } catch (error) {
        lastError = error as Error;
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Check if this is a moderation error or other retryable error
        const isModeration = errorMessage.includes('MODERATION_ERROR') || errorMessage.includes('moderation') || errorMessage.includes('flagged');
        const is403 = errorMessage.includes('403');
        
        if (isModeration || is403) {
          console.log(`[OpenRouter] Model ${currentModel} hit moderation/403 error, trying next model...`);
        } else {
          console.error(`[OpenRouter] Model ${currentModel} failed:`, errorMessage);
        }
        
        // Continue to next model in the list
        continue;
      }
    }

    // If all models failed, throw the last error
    if (!openRouterStream) {
      console.error(`[OpenRouter] All models failed. Attempted: ${attemptedModels.join(', ')}`);
      throw new Error(
        lastError?.message || 
        `All AI models failed. This may be due to content moderation. Please try rephrasing your request.`
      );
    }

    // Create SSE response stream
    const messageId = `msg_${Date.now()}`;
    const sseStream = createSSEStream(openRouterStream, messageId);

    return new Response(sseStream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('AI Chat Stream Error:', error);
    
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Internal server error' 
      }),
      { 
        status: 500, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});
