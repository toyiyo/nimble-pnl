// AI Chat Types

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  name?: string; // For tool messages
  tool_call_id?: string; // For tool result messages
  tool_calls?: ToolCall[];
  created_at?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolResult {
  tool_name: string;
  call_id: string;
  status: 'ok' | 'error';
  summary: string;
  data?: unknown;
  meta?: {
    took_ms?: number;
    rows?: number;
    [key: string]: unknown;
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ChatStreamRequest {
  projectRef?: string; // restaurant_id in our case
  messages: ChatMessage[];
  model?: string;
  chatName?: string;
  aiMetadata?: Record<string, unknown>;
  routingKey?: string;
}

export interface SSEEvent {
  type: 'message_start' | 'message_delta' | 'tool_call' | 'tool_result' | 'message_end' | 'error';
  id?: string;
  delta?: string;
  tool_call_id?: string;
  tool?: {
    name: string;
    arguments: Record<string, unknown>;
  };
  result?: ToolResult;
  error?: {
    code: string;
    message: string;
  };
}

// Tool Definition for the AI model
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Model configuration
export interface ModelConfig {
  provider: 'openai' | 'anthropic' | 'openrouter';
  model: string;
  options: {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    tool_choice?: 'auto' | 'required' | 'none';
  };
}

// Tool execution request
export interface ToolExecutionRequest {
  tool_name: string;
  arguments: Record<string, unknown>;
  restaurant_id: string;
}

// Tool execution response
export interface ToolExecutionResponse {
  ok: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
