import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getModel, getModelFallbackList } from "../_shared/model-router.ts";
import { getTools } from "../_shared/tools-registry.ts";

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') || '';
const MAX_PROMPT_TOKENS = 100000;
const MAX_MESSAGES = 100;

/**
 * Typed HTTP error for proper status code handling
 */
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

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
    let errorMessage = `OpenRouter API error`;
    
    // Parse error to check if it's a moderation error
    try {
      const errorData = JSON.parse(errorText);
      if (errorData.error) {
        errorMessage = `Model ${model} failed: ${errorData.error.message || 'Unknown error'}`;
        
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
              
              // Ensure toolCalls[index] is initialized (handles sparse indexes)
              if (!toolCalls[index]) {
                toolCalls[index] = {
                  id: toolCall.id || `tc_${Date.now()}_${index}`,
                  type: 'function',
                  function: {
                    name: '',
                    arguments: '',
                  },
                };
              }
              
              // Update ID if provided
              if (toolCall.id) {
                toolCalls[index].id = toolCall.id;
              }
              
              // For name: assign (names typically come complete in one chunk)
              if (toolCall.function?.name) {
                toolCalls[index].function.name = toolCall.function.name;
              }
              
              // For arguments: concatenate (arguments stream as JSON tokens)
              if (toolCall.function?.arguments) {
                toolCalls[index].function.arguments += toolCall.function.arguments;
              }
            }
          }
        }

        // Send tool calls if any
        if (toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            // Clean up arguments string - remove any special tokens
            let argsString = toolCall.function.arguments
              .replace(/<\|python_end\|>/g, '')
              .replace(/<\|python_start\|>/g, '')
              .replace(/<\|[^|]+\|>/g, '') // Remove any other special tokens
              .trim();
            
            let args;
            try {
              args = JSON.parse(argsString);
            } catch (e) {
              console.error('Failed to parse tool arguments:', e);
              console.error('Raw arguments:', argsString);
              // Keep raw string as arguments value so tool invocation still emits
              args = argsString;
            }
            
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
      throw new HttpError(401, 'Missing authorization header');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new HttpError(401, 'Unauthorized');
    }

    // Parse request body
    const body: ChatRequest = await req.json();
    const { projectRef, messages, routingKey } = body;

    if (!projectRef) {
      throw new HttpError(400, 'Missing projectRef (restaurant_id)');
    }

    if (!messages || messages.length === 0) {
      throw new HttpError(400, 'Messages array is required');
    }

    // Validate message count
    if (messages.length > MAX_MESSAGES) {
      throw new HttpError(400, `Too many messages (max ${MAX_MESSAGES})`);
    }

    // Verify user has access to this restaurant
    const { data: userRestaurant, error: accessError } = await supabase
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', projectRef)
      .single();

    if (accessError || !userRestaurant) {
      throw new HttpError(403, 'Access denied to this restaurant');
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
Current date: ${new Date().toISOString().split('T')[0]} (use this as "today" when users don't specify dates)

🚨 CRITICAL DATA INTEGRITY RULES - NEVER VIOLATE THESE:

1. NEVER EVER make up, invent, or guess data (sales figures, recipe costs, margins, inventory levels, etc.)
2. NEVER provide specific numbers unless they come from a tool call
3. If asked about data, you MUST use the appropriate tool to fetch real data
4. If a tool fails or returns no data, say so explicitly - DO NOT fill in with example data
5. If you don't have access to specific data, say "I don't have that information yet" and suggest using a tool

Examples of FORBIDDEN responses:
❌ "Here are your most profitable recipes: Grilled Salmon ($15,200), Steak Frites ($12,800)..." (MADE UP!)
❌ "Your inventory value is approximately $25,000..." (GUESSING!)
❌ "Based on typical restaurant patterns..." (NO! Use real data!)

Examples of CORRECT responses:
✅ "Let me fetch your actual recipe profitability data..." [calls get_recipe_analytics tool]
✅ "I need to check your real inventory levels..." [calls get_inventory_status tool]
✅ "The tool returned no sales data for that period, so I cannot calculate profitability yet."

RESPONSE FORMATTING - CRITICAL:
- ALWAYS use markdown formatting for your responses
- Use **bold** for important numbers and key metrics
- Use bullet points for lists
- Use tables for comparing data (ONLY with real data from tools)
- Use headers (##, ###) to structure longer responses
- For data analysis: present key insights in markdown tables
- When presenting reports: format them as tables using markdown table syntax
- DO NOT generate fake download links like "/reports/download?report_id=..."
- ALL report data should be presented inline in the chat using tables and formatting

MERMAID DIAGRAM GUIDELINES (use sparingly):
- Only use mermaid diagrams when they add clear value (NOT for simple lists)
- ALWAYS complete arrow syntax: use "A --> B" NOT "A -->" (arrows MUST have destinations)
- Use simple ASCII characters ONLY - NO unicode dashes (‑, –, —), smart quotes (', ", ", "), or special symbols
- Keep diagrams simple and focused (3-8 nodes maximum)
- Test syntax is valid: proper graph/flowchart declarations, complete arrow connections, closed brackets
- If a diagram is complex, use a markdown table or bullet list instead

CONVERSATION FLOW:
- When presenting a multi-step plan, ALWAYS ask if the user wants to execute it
- After showing insights, proactively suggest: "Would you like me to continue with [next logical step]?"
- When you present data, follow up with actionable recommendations
- Don't just show data - interpret it and suggest actions

When users ask questions:
- Be concise and helpful
- **MANDATORY: Use tools for ANY data request (recipes, sales, inventory, financials, KPIs)**
- Provide actionable insights based on actual numbers from tool calls
- Navigate users to relevant sections when needed
- Format ALL numbers clearly with $ signs and proper thousands separators
- When users ask for insights, recommendations, or advice, use the get_ai_insights tool (owners only)
- AFTER providing insights, suggest concrete next steps and ask if they want to proceed

Available tools: ${tools.map(t => t.name).join(', ')}

Tool Usage Guidelines:

1. Navigation & Basic Data (all users):
   - navigate: Guide users to specific app sections
   - **get_kpis: REQUIRED for revenue, costs, margins, inventory value questions**
   - **get_inventory_status: REQUIRED for stock levels, low stock alerts, suppliers**
   - **get_recipe_analytics: REQUIRED for recipe costs, margins, profitability, food cost %**
   - **get_sales_summary: REQUIRED for sales data, trends, item breakdowns**

2. Financial Intelligence (managers/owners):
   - **get_financial_intelligence: REQUIRED for financial questions**
     * analysis_type: 'cash_flow', 'revenue_health', 'spending', 'liquidity', 'predictions', 'all'
     * Returns: Cash flow metrics, deposit patterns, spending by vendor, burn rate, runway
     * Example: "What's my cash burn rate?" → MUST call with analysis_type: 'liquidity'
     * Example: "Show me spending breakdown" → MUST call with analysis_type: 'spending'
     * Example: "When will we run out of money?" → MUST call with analysis_type: 'liquidity'
   
   - **get_bank_transactions: REQUIRED for transaction queries**
     * Filter by date, amount, category, bank account
     * Example: "Show transactions over $500 last week" → MUST call this tool
   
   - **get_financial_statement: REQUIRED for financial statements**
     * statement_type: 'income_statement', 'balance_sheet', 'cash_flow', 'trial_balance'
     * Example: "What's on my balance sheet?" → MUST call with statement_type: 'balance_sheet'

3. AI Insights (owners only):
   - get_ai_insights: Business advice and recommendations
     * focus_area: cost_reduction, revenue_growth, inventory_optimization, menu_engineering, overall_health
     * Example: "Give me insights" → use focus_area: 'overall_health'

4. Report Generation (managers/owners):
   - generate_report: Generate formatted reports
     * Available types ONLY: monthly_pnl, inventory_variance, recipe_profitability, sales_by_category, cash_flow, balance_sheet
     * Returns: Report data in JSON format - NEVER generate download links or URLs
     * IMPORTANT: Present the report data inline using markdown tables and formatting
     * Example: "Generate monthly P&L" → use type: 'monthly_pnl', then format the returned data as a table

🔴 REMEMBER: ANY question about numbers, data, or restaurant operations REQUIRES a tool call. NEVER make up data, even if it seems plausible. Real restaurants depend on accurate data.`,
    };

    // Filter out any caller-provided system messages and ensure our system message is always first
    const filteredMessages = messages.filter(msg => msg.role !== 'system');
    const messagesWithSystem = [systemMessage, ...filteredMessages];

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
        console.log(`[OpenRouter] Attempting model: ${currentModel} (${attemptedModels.length}/${modelList.length})`);
        const startTime = Date.now();
        
        openRouterStream = await callOpenRouter(
          currentModel,
          messagesWithSystem,
          tools
        );
        
        const connectionTime = Date.now() - startTime;
        console.log(`[OpenRouter] Successfully connected with model: ${currentModel} in ${connectionTime}ms`);
        break; // Success! Exit the loop
      } catch (error) {
        lastError = error as Error;
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Check if this is a moderation error or other retryable error
        const isModeration = errorMessage.includes('MODERATION_ERROR') || errorMessage.includes('moderation') || errorMessage.includes('flagged');
        const is403 = errorMessage.includes('403');
        const is5xx = errorMessage.includes('500') || errorMessage.includes('502') || errorMessage.includes('503');
        
        if (isModeration || is403) {
          console.log(`[OpenRouter] Model ${currentModel} hit moderation/403 error, trying next model...`);
        } else if (is5xx) {
          console.error(`[OpenRouter] Model ${currentModel} hit server error (${errorMessage}), trying next model...`);
        } else {
          console.error(`[OpenRouter] Model ${currentModel} failed:`, errorMessage);
        }
        
        // Continue to next model in the list
        continue;
      }
    }

    // If all models failed, throw provider error
    if (!openRouterStream) {
      console.error(`[OpenRouter] All models failed. Attempted: ${attemptedModels.join(', ')}`);
      throw new HttpError(
        502,
        'AI service temporarily unavailable. Please try again.'
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
    
    // Determine status code and sanitized message
    let status = 500;
    let message = 'Internal server error';
    
    if (error instanceof HttpError) {
      // Use typed error status and message
      status = error.status;
      message = error.message;
    } else if (error instanceof Error) {
      // Check if it's a provider/upstream error (fallback to 502)
      const errorStr = error.message.toLowerCase();
      if (errorStr.includes('openrouter') || 
          errorStr.includes('api error') || 
          errorStr.includes('fetch') ||
          errorStr.includes('network')) {
        status = 502;
        message = 'AI service temporarily unavailable';
      } else {
        // Sanitize unexpected errors
        message = 'An unexpected error occurred';
      }
    }
    
    return new Response(
      JSON.stringify({ error: message }),
      { 
        status, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});
