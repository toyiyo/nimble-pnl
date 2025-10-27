import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ChatMessage, SSEEvent, ToolCall } from '@/types/ai-chat';

export interface UseAiChatOptions {
  restaurantId: string;
  onToolCall?: (toolCall: ToolCall) => Promise<unknown>;
}

export interface UseAiChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  abortStream: () => void;
}

export function useAiChat({ restaurantId, onToolCall }: UseAiChatOptions): UseAiChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentMessageRef = useRef<string>('');

  const executeTool = useCallback(async (toolName: string, args: Record<string, unknown>) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-execute-tool`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tool_name: toolName,
            arguments: args,
            restaurant_id: restaurantId,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Tool execution failed');
      }

      const result = await response.json();
      return result;
    } catch (err) {
      const error = err as Error;
      console.error('Tool execution error:', error);
      return {
        ok: false,
        error: {
          code: 'TOOL_ERROR',
          message: error.message || 'Failed to execute tool',
        },
      };
    }
  }, [restaurantId]);

  const streamFollowUp = useCallback(async (conversationHistory: ChatMessage[], retryCount = 0) => {
    const MAX_RETRIES = 2;
    const TIMEOUT_MS = 30000; // 30 second timeout
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.error('No session for follow-up stream');
        return;
      }

      abortControllerRef.current = new AbortController();
      
      // Add timeout to abort controller
      const timeoutId = setTimeout(() => {
        console.log('[Follow-up] Timeout reached, aborting stream');
        abortControllerRef.current?.abort();
      }, TIMEOUT_MS);

      console.log(`[Follow-up] Starting stream (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`);
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat-stream`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectRef: restaurantId,
            messages: conversationHistory.map(m => ({
              role: m.role,
              content: m.content,
              ...(m.name && { name: m.name }),
              ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
              ...(m.tool_calls && { tool_calls: m.tool_calls }),
            })),
          }),
          signal: abortControllerRef.current.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Follow-up] HTTP error ${response.status}:`, errorText);
        
        // Retry on server errors
        if (response.status >= 500 && retryCount < MAX_RETRIES) {
          const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
          console.log(`[Follow-up] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return streamFollowUp(conversationHistory, retryCount + 1);
        }
        
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        console.error('[Follow-up] No response body');
        return;
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let assistantMessageId = '';
      let hasReceivedData = false;
      currentMessageRef.current = '';

      console.log('[Follow-up] Starting to read stream...');

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[Follow-up] Stream completed');
          break;
        }

        hasReceivedData = true;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            try {
              const event: SSEEvent = JSON.parse(data);

              switch (event.type) {
                case 'message_start':
                  assistantMessageId = event.id || `assistant_${Date.now()}`;
                  console.log('[Follow-up] Message start:', assistantMessageId);
                  setMessages(prev => [
                    ...prev,
                    {
                      id: assistantMessageId,
                      role: 'assistant',
                      content: '',
                      created_at: new Date().toISOString(),
                    },
                  ]);
                  break;

                case 'message_delta':
                  if (event.delta && event.delta.trim()) {
                    currentMessageRef.current += event.delta;
                    setMessages(prev =>
                      prev.map(msg =>
                        msg.id === assistantMessageId
                          ? { ...msg, content: currentMessageRef.current }
                          : msg
                      )
                    );
                  }
                  break;

                case 'message_end':
                  console.log('[Follow-up] Message end');
                  currentMessageRef.current = '';
                  break;
                  
                case 'error':
                  console.error('[Follow-up] Stream error event:', event.error);
                  if (retryCount < MAX_RETRIES) {
                    const delay = Math.pow(2, retryCount) * 1000;
                    console.log(`[Follow-up] Retrying after error in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return streamFollowUp(conversationHistory, retryCount + 1);
                  }
                  break;
              }
            } catch (e) {
              console.error('[Follow-up] Failed to parse SSE event:', e, 'data:', data);
            }
          }
        }
      }
      
      if (!hasReceivedData) {
        console.warn('[Follow-up] No data received from stream');
        if (retryCount < MAX_RETRIES) {
          const delay = Math.pow(2, retryCount) * 1000;
          console.log(`[Follow-up] Retrying due to no data in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return streamFollowUp(conversationHistory, retryCount + 1);
        }
      }
    } catch (err) {
      const error = err as Error & { name?: string };
      if (error.name === 'AbortError') {
        console.log('[Follow-up] Stream aborted');
        if (retryCount < MAX_RETRIES) {
          const delay = Math.pow(2, retryCount) * 1000;
          console.log(`[Follow-up] Retrying after abort in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return streamFollowUp(conversationHistory, retryCount + 1);
        }
      } else {
        console.error('[Follow-up] Stream error:', error);
        if (retryCount < MAX_RETRIES) {
          const delay = Math.pow(2, retryCount) * 1000;
          console.log(`[Follow-up] Retrying after error in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return streamFollowUp(conversationHistory, retryCount + 1);
        }
      }
    }
  }, [restaurantId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return;

    setError(null);
    
    // Add user message
    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: content.trim(),
      created_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);

    // Start streaming
    setIsStreaming(true);
    currentMessageRef.current = '';

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      // Create abort controller for this request
      abortControllerRef.current = new AbortController();

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat-stream`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectRef: restaurantId,
            messages: [...messages, userMessage].map(m => ({
              role: m.role,
              content: m.content,
              ...(m.name && { name: m.name }),
              ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
              ...(m.tool_calls && { tool_calls: m.tool_calls }),
            })),
          }),
          signal: abortControllerRef.current.signal,
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Stream failed');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let assistantMessageId = '';
      const toolCalls: ToolCall[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            try {
              const event: SSEEvent = JSON.parse(data);

              switch (event.type) {
                case 'message_start':
                  assistantMessageId = event.id || `assistant_${Date.now()}`;
                  setMessages(prev => [
                    ...prev,
                    {
                      id: assistantMessageId,
                      role: 'assistant',
                      content: '',
                      created_at: new Date().toISOString(),
                    },
                  ]);
                  break;

                case 'message_delta':
                  if (event.delta && event.delta.trim()) {
                    currentMessageRef.current += event.delta;
                    setMessages(prev =>
                      prev.map(msg =>
                        msg.id === assistantMessageId
                          ? { ...msg, content: currentMessageRef.current }
                          : msg
                      )
                    );
                  }
                  break;

                case 'tool_call':
                  if (event.tool) {
                    const toolCall: ToolCall = {
                      id: event.id || `tc_${Date.now()}`,
                      type: 'function',
                      function: {
                        name: event.tool.name,
                        arguments: JSON.stringify(event.tool.arguments),
                      },
                    };
                    toolCalls.push(toolCall);

                    // Execute tool
                    const result = await executeTool(event.tool.name, event.tool.arguments);
                    
                    // Add tool result as a message
                    const toolResultMessage: ChatMessage = {
                      id: `tool_${Date.now()}`,
                      role: 'tool',
                      content: JSON.stringify(result),
                      name: event.tool.name,
                      tool_call_id: toolCall.id,
                      created_at: new Date().toISOString(),
                    };

                    setMessages(prev => [...prev, toolResultMessage]);

                    // Call custom handler if provided
                    if (onToolCall) {
                      await onToolCall(toolCall);
                    }
                  }
                  break;

                case 'message_end':
                  // If we have tool calls, we need to update the assistant message and continue the conversation
                  if (toolCalls.length > 0) {
                    setMessages(prev => 
                      prev.map(msg =>
                        msg.id === assistantMessageId
                          ? { ...msg, tool_calls: toolCalls }
                          : msg
                      )
                    );
                  }
                  currentMessageRef.current = '';
                  break;

                case 'error':
                  console.error('Stream error:', event.error);
                  setError(event.error?.message || 'An error occurred');
                  break;
              }
            } catch (e) {
              console.error('Failed to parse SSE event:', e);
            }
          }
        }
      }

      // After streaming ends, if we have tool calls, send another request with tool results
      if (toolCalls.length > 0) {
        // Get all messages including tool results
        const messagesWithTools = await new Promise<ChatMessage[]>((resolve) => {
          setMessages(prev => {
            resolve(prev);
            return prev;
          });
        });

        // Make a follow-up request to get AI's response based on tool results
        await streamFollowUp(messagesWithTools);
      }
    } catch (err) {
      const error = err as Error & { name?: string };
      if (error.name === 'AbortError') {
        console.log('Stream aborted');
      } else {
        console.error('Chat error:', error);
        setError(error.message || 'Failed to send message');
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [messages, isStreaming, restaurantId, executeTool, onToolCall, streamFollowUp]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const abortStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    clearMessages,
    abortStream,
  };
}
