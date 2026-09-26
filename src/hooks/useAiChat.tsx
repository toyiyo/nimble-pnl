import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase, SUPABASE_URL } from '@/integrations/supabase/client';
import { ChatMessage, SSEEvent, ToolCall } from '@/types/ai-chat';
import { anySignal } from '@/lib/anySignal';
import { isWriteTool } from '../../supabase/functions/_shared/aiWriteTools';

export interface UseAiChatOptions {
  restaurantId: string;
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
/**
 * A round fails when it receives no data for this time. The server can work
 * for a long time with no event, for example when it tries the next model or
 * streams tool arguments.
 */
export const ROUND_IDLE_TIMEOUT_MS = 90_000;
/** Retries of one round. The hook retries only before the first event. */
export const MAX_ROUND_RETRIES = 2;
/** A tool call fails with TOOL_ERROR when it gives no result in this time. */
export const TOOL_TIMEOUT_MS = 60_000;

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

/**
 * Returns a clock that gives strictly increasing ISO timestamps. The first
 * stamp is later than `after`, so a new turn sorts after the history.
 */
function createStamp(after: number): Stamp {
  let last = after;
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

/** Waits for a promise. Rejects when the signal aborts first. */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
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

/**
 * Reads SSE events from a byte stream. It decodes the bytes, splits them into
 * lines, and parses each `data:` line. It parses a last line with no newline.
 * It calls `onChunk` after each read, also when the chunk has no full event.
 * A read error or an abort rejects the iteration.
 */
export async function* readSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  onChunk?: () => void
): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const chunk = await readWithAbort(reader, signal);
    onChunk?.();
    if (chunk.done) {
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const event = parseSSELine(line);
      if (event) yield event;
    }
  }
  for (const line of buffer.split('\n')) {
    const event = parseSSELine(line);
    if (event) yield event;
  }
}

function parseToolArguments(json: string): Record<string, unknown> | null {
  try {
    const args = JSON.parse(json);
    return args && typeof args === 'object' ? (args as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Gives the names of the write tools that the last assistant turn called with a
 * truthy `preview`. The last assistant turn is the assistant rows after the last
 * user row. A turn can have more than one assistant row, one for each round.
 */
function previewedWriteTools(history: ChatMessage[]): Set<string> {
  const names = new Set<string>();
  let lastUser = -1;
  history.forEach((m, i) => {
    if (m.role === 'user') lastUser = i;
  });
  for (const m of history.slice(lastUser + 1)) {
    if (m.role !== 'assistant') continue;
    for (const call of m.tool_calls ?? []) {
      const name = call.function?.name;
      if (!name || !isWriteTool(name)) continue;
      const args = parseToolArguments(call.function.arguments);
      if (args && Boolean(args.preview)) names.add(name);
    }
  }
  return names;
}

/** The facts that the write guard needs for one tool call. */
interface ToolCallContext {
  round: number;
  signal: AbortSignal;
  /** Write tools that the last assistant turn previewed. */
  approvedPreviews: ReadonlySet<string>;
  /** Write tools that this round previewed before this call. */
  roundPreviews: Set<string>;
}

/** Returns the time of the last message, or 0 when no message has a time. */
function lastCreatedAt(messages: ChatMessage[]): number {
  let last = 0;
  for (const m of messages) {
    const t = m.created_at ? Date.parse(m.created_at) : NaN;
    if (Number.isFinite(t) && t > last) last = t;
  }
  return last;
}

export function useAiChat({ restaurantId }: UseAiChatOptions): UseAiChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isStreamingRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Stop the turn when the restaurant changes or the component unmounts.
  // The rows of a stopped turn must not go into another restaurant or session.
  useEffect(
    () => () =>
      abortControllerRef.current?.abort(new DOMException('The restaurant changed.', 'AbortError')),
    [restaurantId]
  );

  const executeTool = useCallback(
    async (toolName: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> => {
      // The tool timeout gives a TOOL_ERROR result. It does not stop the turn.
      const timeout = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let cleanupSignal: (() => void) | undefined;
      try {
        timeoutId = setTimeout(
          () => timeout.abort(new DOMException(TOOL_TIMEOUT_MESSAGE, 'TimeoutError')),
          TOOL_TIMEOUT_MS
        );
        const combined = anySignal([signal, timeout.signal]);
        cleanupSignal = combined.cleanup;
        const toolSignal = combined.signal;
        // getSession can wait for a token refresh. The tool timeout and the user abort cover it too.
        const { data: { session } } = await withAbort(supabase.auth.getSession(), toolSignal);
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
        cleanupSignal?.();
      }
    },
    [restaurantId]
  );

  /**
   * Gives the result of one tool call. Some calls do not go to the server:
   * - On the last round, no tool runs, because the model cannot answer after it.
   * - A write with a truthy `confirmed` runs only in round 1, and only when the
   *   last assistant turn previewed the same tool. The server also accepts
   *   "true" and 1 as a confirm, so the guard checks for any truthy value.
   * - A confirm does not run after a preview of the same tool in the same
   *   round. The user did not see that preview.
   */
  const resolveToolCall = useCallback(
    async (name: string, args: Record<string, unknown>, context: ToolCallContext): Promise<unknown> => {
      const { round, signal, approvedPreviews, roundPreviews } = context;
      if (round >= MAX_TOOL_ROUNDS) return STEP_LIMIT_RESULT;
      if (isWriteTool(name)) {
        if (args?.confirmed) {
          const approved = round === 1 && approvedPreviews.has(name) && !roundPreviews.has(name);
          if (!approved) return CONFIRMATION_REQUIRED_RESULT;
        } else if (args?.preview) {
          roundPreviews.add(name);
        }
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
      stamp: Stamp,
      approvedPreviews: ReadonlySet<string>
    ): Promise<RoundResult> => {
      const { signal } = controller;
      const roundPreviews = new Set<string>();
      // After an abort, the turn adds and changes no rows. The panel can show another session.
      const updateIfLive: typeof setMessages = (update) => {
        if (!signal.aborted) setMessages(update);
      };
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
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

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
        reader = response.body?.getReader();
        if (!reader) throw new RoundError(EMPTY_RESPONSE_ERROR, false);

        const toolCalls: ToolCall[] = [];
        const toolMessages: ChatMessage[] = [];
        let receivedEvent = false;

        const ensureAssistant = () => {
          if (assistantId) return;
          const id = crypto.randomUUID();
          assistantId = id;
          assistantCreatedAt = stamp();
          const row: ChatMessage = { id, role: 'assistant', content: '', created_at: assistantCreatedAt };
          updateIfLive((prev) => [...prev, row]);
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
                updateIfLive((prev) => prev.map((m) => (m.id === id ? { ...m, content: text } : m)));
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
                const result = await resolveToolCall(event.tool.name, event.tool.arguments, {
                  round,
                  signal,
                  approvedPreviews,
                  roundPreviews,
                });
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
              }
              break;
            case 'message_end':
              break;
            case 'error':
              throw new RoundError(event.error?.message || 'An error occurred', false);
          }
        };

        // Every chunk re-arms the idle timer, also a chunk with no full event.
        const events = readSseEvents(reader, signal, armIdle);
        while (true) {
          let next: IteratorResult<SSEEvent>;
          try {
            next = await events.next();
          } catch (err) {
            if (signal.aborted) throw abortError(signal);
            console.error('[AI Chat] Stream read error:', err);
            throw new RoundError(NETWORK_ERROR, !receivedEvent);
          }
          if (next.done) break;
          receivedEvent = true;
          await handleEvent(next.value);
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
        // Close the stream also when an event handler throws.
        reader?.cancel().catch(() => undefined);
      }
    },
    [restaurantId, resolveToolCall]
  );

  /** One round, with a retry only before the first event. */
  const runRound = useCallback(
    async (
      history: ChatMessage[],
      round: number,
      controller: AbortController,
      stamp: Stamp,
      approvedPreviews: ReadonlySet<string>
    ): Promise<RoundResult> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await attemptRound(history, round, controller, stamp, approvedPreviews);
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
      const stamp = createStamp(lastCreatedAt(messagesRef.current));

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text.trim(),
        created_at: stamp(),
      };
      const turnHistory: ChatMessage[] = [...messagesRef.current, userMessage];
      // Read the previews before the user message. A confirm needs a preview that the user saw.
      const approvedPreviews = previewedWriteTools(messagesRef.current);

      setError(null);
      setMessages((prev) => [...prev, userMessage]);
      setIsStreaming(true);

      try {
        for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
          const { assistant, toolMessages } = await runRound(turnHistory, round, controller, stamp, approvedPreviews);
          if (controller.signal.aborted) throw abortError(controller.signal);

          setMessages((prev) => [
            ...prev.map((m) => (m.id === assistant.id ? { ...m, tool_calls: assistant.tool_calls } : m)),
            ...toolMessages,
          ]);
          turnHistory.push(assistant, ...toolMessages);

          if (!assistant.tool_calls) return;
        }
        setError(TOO_MANY_STEPS_ERROR);
      } catch (err) {
        const { reason } = controller.signal;
        if (controller.signal.aborted && reason instanceof DOMException && reason.name === 'TimeoutError') {
          setError(TIMEOUT_ERROR);
        } else if (controller.signal.aborted) {
          // The user stopped the turn. This is not an error.
        } else if (err instanceof RoundError) {
          setError(err.message);
        } else {
          console.error('[AI Chat] Turn failed:', err);
          setError((err instanceof Error && err.message) || 'Failed to send message');
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
