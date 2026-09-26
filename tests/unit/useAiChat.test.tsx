import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  SUPABASE_URL: 'http://supabase.test',
  supabase: { auth: { getSession } },
}));

import {
  useAiChat,
  MAX_TOOL_ROUNDS,
  TOO_MANY_STEPS_ERROR,
  TOOL_TIMEOUT_MS,
} from '@/hooks/useAiChat';

// ---------------------------------------------------------------------------
// SSE stream helpers
// ---------------------------------------------------------------------------

type Step =
  | { event: Record<string, unknown> }
  | { raw: string }
  | { wait: number }
  | { fail: Error }
  | { hang: true; onHang?: () => void };

interface FakeResponse {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

const encoder = new TextEncoder();

function sseResponse(steps: Step[]): FakeResponse {
  const queue = [...steps];
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (queue.length > 0) {
        const step = queue.shift()!;
        if ('wait' in step) {
          await new Promise((resolve) => setTimeout(resolve, step.wait));
          continue;
        }
        if ('hang' in step) {
          step.onHang?.();
          return new Promise<void>(() => {});
        }
        if ('fail' in step) {
          controller.error(step.fail);
          return;
        }
        const text = 'raw' in step ? step.raw : `data: ${JSON.stringify(step.event)}\n\n`;
        controller.enqueue(encoder.encode(text));
        return;
      }
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    body,
    json: async () => ({}),
    text: async () => '',
  };
}

function jsonResponse(status: number, payload: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: null,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

const start = (): Step => ({ event: { type: 'message_start', id: 'srv_msg' } });
const delta = (text: string): Step => ({ event: { type: 'message_delta', delta: text } });
const end = (): Step => ({ event: { type: 'message_end', id: 'srv_msg' } });
const toolCall = (id: string, name: string, args: Record<string, unknown> = {}): Step => ({
  event: { type: 'tool_call', id, tool: { name, arguments: args } },
});

type StreamResponder = (callIndex: number, body: StreamBody) => FakeResponse | Promise<FakeResponse>;
type ToolResponder = (
  callIndex: number,
  body: ToolBody,
  signal: AbortSignal
) => FakeResponse | Promise<FakeResponse>;

interface StreamBody {
  projectRef: string;
  messages: Array<Record<string, unknown>>;
}
interface ToolBody {
  tool_name: string;
  arguments: Record<string, unknown>;
  restaurant_id: string;
}

let fetchMock: ReturnType<typeof vi.fn>;
let streamResponder: StreamResponder;
let toolResponder: ToolResponder;
let streamBodies: StreamBody[];
let toolBodies: ToolBody[];

function installFetch() {
  streamBodies = [];
  toolBodies = [];
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (url.endsWith('/functions/v1/ai-chat-stream')) {
      streamBodies.push(body);
      return streamResponder(streamBodies.length, body);
    }
    if (url.endsWith('/functions/v1/ai-execute-tool')) {
      toolBodies.push(body);
      return toolResponder(toolBodies.length, body, init.signal as AbortSignal);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderChat() {
  return renderHook(() => useAiChat({ restaurantId: 'rest-1' }));
}

describe('useAiChat', () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'token-1' } } });
    toolResponder = () => jsonResponse(200, { ok: true, data: { revenue: 100 } });
    installFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('completes a turn with one round and no tools', async () => {
    streamResponder = () => sseResponse([start(), delta('Hello'), delta(' world'), end()]);
    const { result } = renderChat();

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(streamBodies).toHaveLength(1);
    expect(streamBodies[0].projectRef).toBe('rest-1');
    expect(streamBodies[0].messages).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(result.current.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Hi'],
      ['assistant', 'Hello world'],
    ]);
    expect(result.current.messages[1].tool_calls).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(result.current.isStreaming).toBe(false);
  });

  it('flushes a last SSE line that has no newline at the end of the stream', async () => {
    streamResponder = () =>
      sseResponse([
        start(),
        delta('Part one'),
        { raw: `data: ${JSON.stringify({ type: 'message_delta', delta: ', part two' })}` },
      ]);
    const { result } = renderChat();

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(result.current.messages[1].content).toBe('Part one, part two');
    expect(result.current.error).toBeNull();
  });

  it('runs two rounds and sends assistant tool_calls before the matching tool result', async () => {
    streamResponder = (n) =>
      n === 1
        ? sseResponse([start(), toolCall('call_1', 'get_kpis', { period: 'today' }), end()])
        : sseResponse([start(), delta('Sales are up'), end()]);
    const { result } = renderChat();

    await act(async () => {
      await result.current.sendMessage('How are sales?');
    });

    expect(streamBodies).toHaveLength(2);
    expect(toolBodies).toEqual([
      { tool_name: 'get_kpis', arguments: { period: 'today' }, restaurant_id: 'rest-1' },
    ]);

    // Round 1 request: the user message only, with no empty tool_calls key.
    expect(streamBodies[0].messages).toEqual([{ role: 'user', content: 'How are sales?' }]);

    // Round 2 request: user, assistant{tool_calls}, tool{tool_call_id}.
    const history = streamBodies[1].messages;
    expect(history).toHaveLength(3);
    expect(history[0]).toEqual({ role: 'user', content: 'How are sales?' });
    expect(history[1]).toMatchObject({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_kpis', arguments: JSON.stringify({ period: 'today' }) },
        },
      ],
    });
    expect(history[2]).toMatchObject({ role: 'tool', tool_call_id: 'call_1', name: 'get_kpis' });
    expect(JSON.parse(String(history[2].content))).toEqual({ ok: true, data: { revenue: 100 } });

    const msgs = result.current.messages;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(msgs[1].tool_calls?.[0].id).toBe('call_1');
    expect(msgs[3].content).toBe('Sales are up');
    expect(result.current.error).toBeNull();

    // IDs are unique and created_at values increase strictly.
    expect(new Set(msgs.map((m) => m.id)).size).toBe(msgs.length);
    const times = msgs.map((m) => Date.parse(m.created_at!));
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
  });

  it('stops at MAX_TOOL_ROUNDS requests and does not run the tools of the last round', async () => {
    streamResponder = (n) => sseResponse([start(), toolCall(`call_${n}`, 'get_kpis'), end()]);
    const { result } = renderChat();

    await act(async () => {
      await result.current.sendMessage('Loop forever');
    });

    expect(streamBodies).toHaveLength(MAX_TOOL_ROUNDS);
    // The last round gets no answer, so its tool must not run.
    expect(toolBodies).toHaveLength(MAX_TOOL_ROUNDS - 1);
    expect(result.current.error).toBe(TOO_MANY_STEPS_ERROR);
    expect(result.current.isStreaming).toBe(false);

    const last = result.current.messages.at(-1)!;
    expect(last).toMatchObject({ role: 'tool', tool_call_id: `call_${MAX_TOOL_ROUNDS}` });
    expect(JSON.parse(last.content)).toMatchObject({ ok: false, error: { code: 'STEP_LIMIT' } });
  });

  describe('write tool confirmation', () => {
    const WRITE_TOOL = 'batch_categorize_transactions';

    it('does not run a confirmed write in round 2 after a preview in round 1', async () => {
      streamResponder = (n) => {
        if (n === 1) return sseResponse([start(), toolCall('call_p', WRITE_TOOL, { preview: true }), end()]);
        if (n === 2) return sseResponse([start(), toolCall('call_c', WRITE_TOOL, { confirmed: true }), end()]);
        return sseResponse([start(), delta('Please confirm.'), end()]);
      };
      const { result } = renderChat();

      await act(async () => {
        await result.current.sendMessage('Categorize my transactions');
      });

      // Only the preview reaches ai-execute-tool.
      expect(toolBodies).toEqual([
        { tool_name: WRITE_TOOL, arguments: { preview: true }, restaurant_id: 'rest-1' },
      ]);
      const toolMsg = streamBodies[2].messages.at(-1)!;
      expect(toolMsg).toMatchObject({ role: 'tool', tool_call_id: 'call_c' });
      expect(JSON.parse(String(toolMsg.content))).toEqual({
        ok: false,
        error: {
          code: 'CONFIRMATION_REQUIRED',
          message: 'Show the preview to the user and ask them to confirm in a new message.',
        },
      });
      expect(result.current.error).toBeNull();
    });

    it.each(['batch_categorize_pos_sales', 'create_categorization_rule'])(
      'blocks a confirmed %s call in round 2',
      async (tool) => {
        streamResponder = (n) =>
          n === 1
            ? sseResponse([start(), toolCall('call_x', 'get_kpis'), end()])
            : n === 2
              ? sseResponse([start(), toolCall('call_c', tool, { confirmed: true }), end()])
              : sseResponse([start(), delta('Confirm?'), end()]);
        const { result } = renderChat();

        await act(async () => {
          await result.current.sendMessage('Do it');
        });

        expect(toolBodies.map((b) => b.tool_name)).toEqual(['get_kpis']);
      }
    );

    it('runs a confirmed write in round 1 of a new user message', async () => {
      streamResponder = (n) =>
        n === 1
          ? sseResponse([start(), toolCall('call_c', WRITE_TOOL, { confirmed: true }), end()])
          : sseResponse([start(), delta('Done.'), end()]);
      const { result } = renderChat();

      await act(async () => {
        await result.current.sendMessage('Yes, apply it');
      });

      expect(toolBodies).toEqual([
        { tool_name: WRITE_TOOL, arguments: { confirmed: true }, restaurant_id: 'rest-1' },
      ]);
    });

    it('runs a write in round 2 when it does not have confirmed:true', async () => {
      streamResponder = (n) =>
        n === 1
          ? sseResponse([start(), toolCall('call_x', 'get_kpis'), end()])
          : n === 2
            ? sseResponse([start(), toolCall('call_p', WRITE_TOOL, { preview: true }), end()])
            : sseResponse([start(), delta('Here is the preview.'), end()]);
      const { result } = renderChat();

      await act(async () => {
        await result.current.sendMessage('Preview it');
      });

      expect(toolBodies.map((b) => b.tool_name)).toEqual(['get_kpis', WRITE_TOOL]);
    });
  });

  describe('tool timeout', () => {
    /** A tool response that never comes. It rejects when the request signal aborts. */
    const hangingTool: ToolResponder = (_n, _body, signal) =>
      new Promise<FakeResponse>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });

    it('gives a TOOL_ERROR result when a tool does not answer in TOOL_TIMEOUT_MS', async () => {
      vi.useFakeTimers();
      toolResponder = hangingTool;
      streamResponder = (n) =>
        n === 1
          ? sseResponse([start(), toolCall('call_1', 'get_kpis'), end()])
          : sseResponse([start(), delta('The tool failed.'), end()]);
      const { result } = renderChat();

      let done!: Promise<void>;
      act(() => {
        done = result.current.sendMessage('Hi');
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TOOL_TIMEOUT_MS - 1_000);
      });
      expect(streamBodies).toHaveLength(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
        await done;
      });

      expect(streamBodies).toHaveLength(2);
      const toolMsg = streamBodies[1].messages.at(-1)!;
      expect(JSON.parse(String(toolMsg.content))).toMatchObject({ ok: false, error: { code: 'TOOL_ERROR' } });
      expect(result.current.error).toBeNull();
      expect(result.current.messages.at(-1)?.content).toBe('The tool failed.');
    });

    it('stops the turn when the user aborts while a tool runs', async () => {
      let toolStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        toolStarted = resolve;
      });
      toolResponder = (n, body, signal) => {
        toolStarted();
        return hangingTool(n, body, signal);
      };
      streamResponder = () => sseResponse([start(), toolCall('call_1', 'get_kpis'), end()]);
      const { result } = renderChat();

      let done!: Promise<void>;
      act(() => {
        done = result.current.sendMessage('Hi');
      });
      await act(async () => {
        await started;
      });
      await act(async () => {
        result.current.abortStream();
        await done;
      });

      expect(streamBodies).toHaveLength(1);
      expect(result.current.error).toBeNull();
      expect(result.current.messages.map((m) => m.role)).toEqual(['user']);
    });
  });

  it('stops the turn with no more requests when the user aborts in round 2', async () => {
    let hung!: () => void;
    const hangReached = new Promise<void>((resolve) => {
      hung = resolve;
    });
    streamResponder = (n) =>
      n === 1
        ? sseResponse([start(), toolCall('call_1', 'get_kpis'), end()])
        : sseResponse([start(), { hang: true, onHang: hung }]);
    const { result } = renderChat();

    let done!: Promise<void>;
    act(() => {
      done = result.current.sendMessage('Hi');
    });
    await act(async () => {
      await hangReached;
    });
    expect(result.current.isStreaming).toBe(true);

    await act(async () => {
      result.current.abortStream();
      await done;
    });

    expect(streamBodies).toHaveLength(2);
    expect(toolBodies).toHaveLength(1);
    expect(result.current.isStreaming).toBe(false);
    // A user abort is not an error. The empty round-2 assistant row is gone.
    expect(result.current.error).toBeNull();
    expect(result.current.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);

    // No request starts after the abort.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a round after a tool_call, so the tool runs once', async () => {
    streamResponder = () =>
      sseResponse([start(), toolCall('call_1', 'create_item'), { fail: new TypeError('network lost') }]);
    const { result } = renderChat();

    await act(async () => {
      await result.current.sendMessage('Create it');
    });

    expect(streamBodies).toHaveLength(1);
    expect(toolBodies).toHaveLength(1);
    expect(result.current.error).toBeTruthy();
    expect(result.current.isStreaming).toBe(false);
    // The failed round leaves no assistant row with tool_calls and no tool row.
    expect(result.current.messages.map((m) => m.role)).toEqual(['user']);
  });

  it('does not retry after a message_delta', async () => {
    streamResponder = () => sseResponse([start(), delta('Half'), { fail: new TypeError('network lost') }]);
    const { result } = renderChat();

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(streamBodies).toHaveLength(1);
    expect(result.current.error).toBeTruthy();
  });

  it('retries a network error before the first event and then succeeds', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    streamResponder = () => {
      attempts++;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      return sseResponse([start(), delta('Recovered'), end()]);
    };
    const { result } = renderChat();

    let done!: Promise<void>;
    act(() => {
      done = result.current.sendMessage('Hi');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      await done;
    });

    expect(streamBodies).toHaveLength(2);
    expect(result.current.error).toBeNull();
    expect(result.current.messages[1].content).toBe('Recovered');
  });

  it('sets an error when round 2 returns HTTP 500 on every try', async () => {
    vi.useFakeTimers();
    streamResponder = (n) =>
      n === 1
        ? sseResponse([start(), toolCall('call_1', 'get_kpis'), end()])
        : jsonResponse(500, { error: 'upstream down' });
    const { result } = renderChat();

    let done!: Promise<void>;
    act(() => {
      done = result.current.sendMessage('Hi');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
      await done;
    });

    // Round 1 once, round 2 once plus 2 retries.
    expect(streamBodies).toHaveLength(4);
    expect(toolBodies).toHaveLength(1);
    expect(result.current.error).toBe('upstream down');
    expect(result.current.isStreaming).toBe(false);
  });

  it('does not retry an HTTP 4xx response', async () => {
    streamResponder = () => jsonResponse(403, { error: 'Forbidden' });
    const { result } = renderChat();

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(streamBodies).toHaveLength(1);
    expect(result.current.error).toBe('Forbidden');
  });

  it('keeps streaming through a 2-round turn longer than 30 s in total', async () => {
    vi.useFakeTimers();
    streamResponder = (n) =>
      n === 1
        ? sseResponse([start(), { wait: 20_000 }, toolCall('call_1', 'get_kpis'), end()])
        : sseResponse([start(), { wait: 20_000 }, delta('Done'), { wait: 5_000 }, end()]);
    const { result } = renderChat();

    let done!: Promise<void>;
    act(() => {
      done = result.current.sendMessage('Hi');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000);
    });
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
      await done;
    });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.messages.at(-1)?.content).toBe('Done');
  });

  it('sets a timeout error when a round sends no event for 30 s', async () => {
    vi.useFakeTimers();
    streamResponder = () => sseResponse([start(), { hang: true }]);
    const { result } = renderChat();

    let done!: Promise<void>;
    act(() => {
      done = result.current.sendMessage('Hi');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(result.current.isStreaming).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await done;
    });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toMatch(/stopped responding/i);
    expect(streamBodies).toHaveLength(1);
  });

  it('passes an ok:false tool body (TOOL_PERMISSION_DENIED) to the model', async () => {
    const denied = {
      ok: false,
      error: { code: 'TOOL_PERMISSION_DENIED', message: "You don't have permission to use get_labor_costs." },
    };
    toolResponder = () => jsonResponse(403, denied);
    streamResponder = (n) =>
      n === 1
        ? sseResponse([start(), toolCall('call_1', 'get_labor_costs'), end()])
        : sseResponse([start(), delta('No access'), end()]);
    const { result } = renderChat();

    await act(async () => {
      await result.current.sendMessage('Labor?');
    });

    const toolMsg = streamBodies[1].messages[2];
    expect(toolMsg.role).toBe('tool');
    expect(JSON.parse(String(toolMsg.content))).toEqual(denied);
    expect(result.current.error).toBeNull();
  });

  it('sets the message of an SSE error event', async () => {
    streamResponder = () =>
      sseResponse([
        { event: { type: 'error', error: { code: 'ALL_MODELS_FAILED', message: 'All AI models failed.' } } },
      ]);
    const { result } = renderChat();

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(streamBodies).toHaveLength(1);
    expect(result.current.error).toBe('All AI models failed.');
  });

  it('sets an error when there is no session', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderChat();

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Not authenticated');
    expect(result.current.isStreaming).toBe(false);
  });

  it('ignores a second submit while a turn runs', async () => {
    streamResponder = () => sseResponse([start(), delta('One answer'), end()]);
    const { result } = renderChat();

    await act(async () => {
      const first = result.current.sendMessage('First');
      const second = result.current.sendMessage('Second');
      await Promise.all([first, second]);
    });

    expect(streamBodies).toHaveLength(1);
    expect(result.current.messages.filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('does not send tool_calls when a loaded row has an empty tool_calls array', async () => {
    streamResponder = () => sseResponse([start(), delta('Hi again'), end()]);
    const { result } = renderChat();

    act(() => {
      result.current.setMessages([
        { id: 'db-1', role: 'user', content: 'Old question', tool_calls: [], created_at: '2026-01-01T00:00:00.000Z' },
        { id: 'db-2', role: 'assistant', content: 'Old answer', tool_calls: [], created_at: '2026-01-01T00:00:01.000Z' },
      ]);
    });
    await act(async () => {
      await result.current.sendMessage('New question');
    });

    expect(streamBodies[0].messages).toEqual([
      { role: 'user', content: 'Old question' },
      { role: 'assistant', content: 'Old answer' },
      { role: 'user', content: 'New question' },
    ]);
  });

  it('sends earlier messages as history on the next turn', async () => {
    streamResponder = (n) => sseResponse([start(), delta(`Answer ${n}`), end()]);
    const { result } = renderChat();

    await act(async () => {
      await result.current.sendMessage('Q1');
    });
    await act(async () => {
      await result.current.sendMessage('Q2');
    });

    expect(streamBodies[1].messages).toEqual([
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'Answer 1' },
      { role: 'user', content: 'Q2' },
    ]);
  });
});
