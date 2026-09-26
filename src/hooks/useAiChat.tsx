import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase, SUPABASE_URL } from '@/integrations/supabase/client';
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
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

/** Maximum number of stream requests in one turn. Round 1 counts. */
export const MAX_TOOL_ROUNDS = 4;
/** A round fails when it sends no event for this time. */
export const ROUND_IDLE_TIMEOUT_MS = 30_000;
/** Retries of one round. The hook retries only before the first event. */
export const MAX_ROUND_RETRIES = 2;
/** A tool call fails with TOOL_ERROR when it gives no result in this time. */
export const TOOL_TIMEOUT_MS = 60_000;

/**
 * Tools that change data. The model must call them with `confirmed: true` only
 * after the user approves a preview in a new message.
 */
const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'batch_categorize_transactions',
  'batch_categorize_pos_sales',
  'create_categorization_rule',
]);

const CONFIRMATION_REQUIRED_RESULT = {
  ok: false,
  error: {
    code: 'CONFIRMATION_REQUIRED',
    message: 'Show the preview to the user and ask them to confirm in a new message.',
  },
} as const;

const STEP_LIMIT_RESULT = {
  ok: false,
  error: { code: 'STEP_LIMIT', message: 'The turn has no more steps. The tool did not run.' },
} as const;

const TOOL_TIMEOUT_MESSAGE = `The tool gave no result in ${TOOL_TIMEOUT_MS / 1000} seconds.`;

export const TOO_MANY_STEPS_ERROR = 'The assistant needed too many steps. Ask a more specific question.';
export const TIMEOUT_ERROR = 'The assistant stopped responding. Try again.';
const NETWORK_ERROR = 'The connection to the assistant failed. Try again.';
const EMPTY_RESPONSE_ERROR = 'The assistant sent an empty response. Try again.';

/** A round failure. `retryable` is true only when the round can run again safely. */
class RoundError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'RoundError';
  }
}

interface RoundResult {
  assistant: ChatMessage;
  toolMessages: ChatMessage[];
}

type Stamp = () => string;

/** Returns a clock that gives strictly increasing ISO timestamps. */
function createStamp(): Stamp {
  let last = 0;
  return () => {
    last = Math.max(Date.now(), last + 1);
    return new Date(last).toISOString();
  };
}

function toRequestMessage(m: ChatMessage) {
  return {
    role: m.role,
    content: m.content,
    ...(m.name && { name: m.name }),
    ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
    ...(m.tool_calls && m.tool_calls.length > 0 && { tool_calls: m.tool_calls }),
  };
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

/** Waits for `ms`. Rejects when the signal aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(id);
      reject(abortError(signal));
    };
    const id = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Reads one chunk. Rejects and cancels the reader when the signal aborts. */
function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reader.cancel().catch(() => undefined);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    reader.read().then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

async function readHttpError(response: Response): Promise<string> {
  const fallback = `The assistant request failed (HTTP ${response.status}).`;
  try {
    const body = await response.json();
    const err = body?.error;
    if (typeof err === 'string' && err) return err;
    if (err && typeof err.message === 'string' && err.message) return err.message;
    return fallback;
  } catch {
    return fallback;
  }
}

function parseSSELine(line: string): SSEEvent | null {
  if (!line.startsWith('data: ')) return null;
  try {
    return JSON.parse(line.slice(6)) as SSEEvent;
  } catch (e) {
    console.error('[AI Chat] Failed to parse SSE event:', e);
    return null;
  }
}

export function useAiChat({ restaurantId, onToolCall }: UseAiChatOptions): UseAiChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Stop the turn when the component unmounts.
  useEffect(() => () => abortControllerRef.current?.abort(), []);

  const executeTool = useCallback(
    async (toolName: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
      // The tool timeout gives a TOOL_ERROR result. It does not stop the turn.
      const timeout = new AbortController();
      const timeoutId = setTimeout(
        () => timeout.abort(new DOMException(TOOL_TIMEOUT_MESSAGE, 'TimeoutError')),
        TOOL_TIMEOUT_MS
      );
      const toolSignal = AbortSignal.any([signal, timeout.signal]);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Not authenticated');

        const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-execute-tool`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ tool_name: toolName, arguments: args, restaurant_id: restaurantId }),
          signal: toolSignal,
        });

        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }

        // The model must see in-band errors such as TOOL_PERMISSION_DENIED, for any status.
        if (body && typeof body === 'object' && (body as { ok?: unknown }).ok === false) {
          return body;
        }
        if (!response.ok) {
          throw new Error(`Tool execution failed (HTTP ${response.status})`);
        }
        return body;
      } catch (err) {
        if (signal.aborted) throw abortError(signal);
        console.error('Tool execution error:', err);
        const message = timeout.signal.aborted
          ? TOOL_TIMEOUT_MESSAGE
          : (err instanceof Error && err.message) || 'Failed to execute tool';
        return { ok: false, error: { code: 'TOOL_ERROR', message } };
      } finally {
        clearTimeout(timeoutId);
      }
    },
    [restaurantId]
  );

  /**
   * Gives the result of one tool call. Some calls do not go to the server:
   * - On the last round, no tool runs, because the model cannot answer after it.
   * - After round 1, a write with `confirmed: true` does not run. The user did
   *   not approve it in a new message.
   */
  const resolveToolCall = useCallback(
    async (name: string, args: Record<string, unknown>, round: number, signal: AbortSignal): Promise<unknown> => {
      if (round >= MAX_TOOL_ROUNDS) return STEP_LIMIT_RESULT;
      if (round > 1 && WRITE_TOOLS.has(name) && args?.confirmed === true) {
        return CONFIRMATION_REQUIRED_RESULT;
      }
      return executeTool(name, args, signal);
    },
    [executeTool]
  );

  /** One stream request, with no retry. */
  const attemptRound = useCallback(
    async (
      history: ChatMessage[],
      round: number,
      controller: AbortController,
      stamp: Stamp
    ): Promise<RoundResult> => {
      const { signal } = controller;
      let idleId: ReturnType<typeof setTimeout> | undefined;
      const clearIdle = () => clearTimeout(idleId);
      const armIdle = () => {
        clearIdle();
        idleId = setTimeout(
          () => controller.abort(new DOMException(TIMEOUT_ERROR, 'TimeoutError')),
          ROUND_IDLE_TIMEOUT_MS
        );
      };

      let assistantId: string | null = null;
      let assistantCreatedAt = '';
      let content = '';

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new RoundError('Not authenticated', false);

        armIdle();
        let response: Response;
        try {
          response = await fetch(`${SUPABASE_URL}/functions/v1/ai-chat-stream`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ projectRef: restaurantId, messages: history.map(toRequestMessage) }),
            signal,
          });
        } catch (err) {
          if (signal.aborted) throw abortError(signal);
          console.error('[AI Chat] Network error:', err);
          throw new RoundError(NETWORK_ERROR, true);
        }

        if (!response.ok) {
          throw new RoundError(await readHttpError(response), response.status >= 500);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new RoundError(EMPTY_RESPONSE_ERROR, false);

        const decoder = new TextDecoder('utf-8');
        const toolCalls: ToolCall[] = [];
        const toolMessages: ChatMessage[] = [];
        let buffer = '';
        let receivedEvent = false;

        const ensureAssistant = () => {
          if (assistantId) return;
          const id = crypto.randomUUID();
          assistantId = id;
          assistantCreatedAt = stamp();
          const row: ChatMessage = { id, role: 'assistant', content: '', created_at: assistantCreatedAt };
          setMessages((prev) => [...prev, row]);
        };

        const handleEvent = async (event: SSEEvent) => {
          switch (event.type) {
            case 'message_start':
              ensureAssistant();
              break;
            case 'message_delta':
              if (event.delta) {
                ensureAssistant();
                content += event.delta;
                const id = assistantId;
                const text = content;
                setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: text } : m)));
              }
              break;
            case 'tool_call':
              if (event.tool) {
                ensureAssistant();
                const toolCall: ToolCall = {
                  id: event.id || crypto.randomUUID(),
                  type: 'function',
                  function: { name: event.tool.name, arguments: JSON.stringify(event.tool.arguments) },
                };
                toolCalls.push(toolCall);
                // The idle timer covers the stream only, not the tool run.
                clearIdle();
                const result = await resolveToolCall(event.tool.name, event.tool.arguments, round, signal);
                if (signal.aborted) throw abortError(signal);
                armIdle();
                toolMessages.push({
                  id: crypto.randomUUID(),
                  role: 'tool',
                  content: JSON.stringify(result),
                  name: event.tool.name,
                  tool_call_id: toolCall.id,
                  created_at: stamp(),
                });
                if (onToolCall) await onToolCall(toolCall);
              }
              break;
            case 'message_end':
              break;
            case 'error':
              throw new RoundError(event.error?.message || 'An error occurred', false);
          }
        };

        const processLines = async (lines: string[]) => {
          for (const line of lines) {
            const event = parseSSELine(line);
            if (!event) continue;
            receivedEvent = true;
            armIdle();
            await handleEvent(event);
          }
        };

        while (true) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await readWithAbort(reader, signal);
          } catch (err) {
            if (signal.aborted) throw abortError(signal);
            console.error('[AI Chat] Stream read error:', err);
            throw new RoundError(NETWORK_ERROR, !receivedEvent);
          }
          if (chunk.done) {
            buffer += decoder.decode();
            await processLines(buffer.split('\n'));
            break;
          }
          buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          await processLines(lines);
        }

        if (!assistantId) throw new RoundError(EMPTY_RESPONSE_ERROR, false);

        const assistant: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          content,
          created_at: assistantCreatedAt,
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        };
        return { assistant, toolMessages };
      } catch (err) {
        // A failed round deletes its empty assistant row.
        if (assistantId && !content) {
          const id = assistantId;
          setMessages((prev) => prev.filter((m) => m.id !== id));
        }
        throw err;
      } finally {
        clearIdle();
      }
    },
    [restaurantId, resolveToolCall, onToolCall]
  );

  /** One round, with a retry only before the first event. */
  const runRound = useCallback(
    async (
      history: ChatMessage[],
      round: number,
      controller: AbortController,
      stamp: Stamp
    ): Promise<RoundResult> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await attemptRound(history, round, controller, stamp);
        } catch (err) {
          const canRetry =
            !controller.signal.aborted &&
            err instanceof RoundError &&
            err.retryable &&
            attempt < MAX_ROUND_RETRIES;
          if (!canRetry) throw err;
          await sleep(1000 * 2 ** attempt, controller.signal);
        }
      }
    },
    [attemptRound]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreamingRef.current) return;
      isStreamingRef.current = true;

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const stamp = createStamp();

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text.trim(),
        created_at: stamp(),
      };
      const turnHistory: ChatMessage[] = [...messagesRef.current, userMessage];

      setError(null);
      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);

      try {
        for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
          const { assistant, toolMessages } = await runRound(turnHistory, round, controller, stamp);

          setMessages((prev) => [
            ...prev.map((m) => (m.id === assistant.id ? { ...m, tool_calls: assistant.tool_calls } : m)),
            ...toolMessages,
          ]);
          turnHistory.push(assistant, ...toolMessages);

          if (!assistant.tool_calls) return;
        }
        setError(TOO_MANY_STEPS_ERROR);
      } catch (err) {
        const reason = controller.signal.reason as { name?: string } | undefined;
        if (controller.signal.aborted && reason?.name === 'TimeoutError') {
          setError(TIMEOUT_ERROR);
        } else if (controller.signal.aborted) {
          // The user stopped the turn. This is not an error.
        } else if (err instanceof RoundError) {
          setError(err.message);
        } else {
          console.error('[AI Chat] Turn failed:', err);
          setError((err as Error)?.message || 'Failed to send message');
        }
      } finally {
        if (abortControllerRef.current === controller) abortControllerRef.current = null;
        isStreamingRef.current = false;
        setIsStreaming(false);
      }
    },
    [runRound]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const abortStream = useCallback(() => {
    abortControllerRef.current?.abort(new DOMException('The user stopped the response.', 'AbortError'));
  }, []);

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    clearMessages,
    abortStream,
    setMessages,
  };
}
