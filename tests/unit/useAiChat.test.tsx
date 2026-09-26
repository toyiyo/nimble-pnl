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
  ROUND_IDLE_TIMEOUT_MS,
  readSseEvents,
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

    /** Runs one turn that previews the tool, then asks the user to confirm. */
    async function previewTurn(result: { current: ReturnType<typeof useAiChat> }) {
      await act(async () => {
        await result.current.sendMessage('Categorize my transactions');
      });
    }

    const CONFIRMATION_REQUIRED = {
      ok: false,
      error: {
        code: 'CONFIRMATION_REQUIRED',
        message: 'Show the preview to the user and ask them to confirm in a new message.',
      },
    };

    function lastToolResult(streamIndex: number) {
      const toolMsg = streamBodies[streamIndex].messages.at(-1)!;
      expect(toolMsg.role).toBe('tool');
      return JSON.parse(String(toolMsg.content));
    }

    it.each([['true'], [1], ['yes']])(
      'blocks the truthy confirmed value %j in round 2',
      async (confirmed) => {
        streamResponder = (n) =>
          n === 1
            ? sseResponse([start(), toolCall('call_x', 'get_kpis'), end()])
            : n === 2
              ? sseResponse([start(), toolCall('call_c', WRITE_TOOL, { confirmed }), end()])
              : sseResponse([start(), delta('Confirm?'), end()]);
        const { result } = renderChat();

        await act(async () => {
          await result.current.sendMessage('Do it');
        });

        expect(toolBodies.map((b) => b.tool_name)).toEqual(['get_kpis']);
        expect(lastToolResult(2)).toEqual(CONFIRMATION_REQUIRED);
      }
    );

    it.each([[true], ['true'], [1], ['yes']])(
      'blocks the confirmed value %j in round 1 when no earlier turn has a preview',
      async (confirmed) => {
        streamResponder = (n) =>
          n === 1
            ? sseResponse([start(), toolCall('call_c', WRITE_TOOL, { confirmed }), end()])
            : sseResponse([start(), delta('Here is a preview first.'), end()]);
        const { result } = renderChat();

        await act(async () => {
          await result.current.sendMessage('Yes, apply it');
        });

        expect(toolBodies).toEqual([]);
        expect(lastToolResult(1)).toEqual(CONFIRMATION_REQUIRED);
      }
    );

    it('runs a confirmed write in round 1 after a preview of the same tool in the last turn', async () => {
      streamResponder = (n) => {
        if (n === 1) return sseResponse([start(), toolCall('call_p', WRITE_TOOL, { preview: true }), end()]);
        if (n === 2) return sseResponse([start(), delta('Please confirm.'), end()]);
        if (n === 3) return sseResponse([start(), toolCall('call_c', WRITE_TOOL, { confirmed: 'true' }), end()]);
        return sseResponse([start(), delta('Done.'), end()]);
      };
      const { result } = renderChat();

      await previewTurn(result);
      await act(async () => {
        await result.current.sendMessage('Yes, apply it');
      });

      expect(toolBodies).toEqual([
        { tool_name: WRITE_TOOL, arguments: { preview: true }, restaurant_id: 'rest-1' },
        { tool_name: WRITE_TOOL, arguments: { confirmed: 'true' }, restaurant_id: 'rest-1' },
      ]);
    });

    it('blocks a confirm when the preview in the last turn failed', async () => {
      toolResponder = () => jsonResponse(200, { ok: false, error: { code: 'INVALID_ARGUMENTS', message: 'bad' } });
      streamResponder = (n) => {
        if (n === 1) return sseResponse([start(), toolCall('call_p', WRITE_TOOL, { preview: true, ids: ['a'] }), end()]);
        if (n === 2) return sseResponse([start(), delta('Please confirm.'), end()]);
        if (n === 3) return sseResponse([start(), toolCall('call_c', WRITE_TOOL, { confirmed: true, ids: ['a'] }), end()]);
        return sseResponse([start(), delta('Preview first.'), end()]);
      };
      const { result } = renderChat();

      await previewTurn(result);
      await act(async () => {
        await result.current.sendMessage('Yes, apply it');
      });

      expect(toolBodies.map((b) => b.arguments)).toEqual([{ preview: true, ids: ['a'] }]);
      expect(lastToolResult(3)).toEqual(CONFIRMATION_REQUIRED);
    });

    it('blocks a confirm whose arguments differ from the previewed arguments', async () => {
      streamResponder = (n) => {
        if (n === 1)
          return sseResponse([start(), toolCall('call_p', WRITE_TOOL, { preview: true, ids: ['a'], category_id: 'c1' }), end()]);
        if (n === 2) return sseResponse([start(), delta('Please confirm.'), end()]);
        if (n === 3)
          return sseResponse([start(), toolCall('call_c', WRITE_TOOL, { confirmed: true, ids: ['a', 'b'], category_id: 'c1' }), end()]);
        return sseResponse([start(), delta('Preview first.'), end()]);
      };
      const { result } = renderChat();

      await previewTurn(result);
      await act(async () => {
        await result.current.sendMessage('Yes, apply it');
      });

      expect(toolBodies).toHaveLength(1);
      expect(lastToolResult(3)).toEqual(CONFIRMATION_REQUIRED);
    });

    it('allows a confirm with the same arguments in another key and ID order', async () => {
      streamResponder = (n) => {
        if (n === 1)
          return sseResponse([start(), toolCall('call_p', WRITE_TOOL, { preview: true, ids: ['b', 'a'], category_id: 'c1' }), end()]);
        if (n === 2) return sseResponse([start(), delta('Please confirm.'), end()]);
        if (n === 3)
          return sseResponse([start(), toolCall('call_c', WRITE_TOOL, { category_id: 'c1', ids: ['a', 'b'], confirmed: true }), end()]);
        return sseResponse([start(), delta('Done.'), end()]);
      };
      const { result } = renderChat();

      await previewTurn(result);
      await act(async () => {
        await result.current.sendMessage('Yes, apply it');
      });

      expect(toolBodies).toHaveLength(2);
      expect(toolBodies[1].arguments).toMatchObject({ confirmed: true });
    });

    it('blocks a confirm of tool B after a preview of tool A in the last turn', async () => {
      const OTHER_TOOL = 'create_categorization_rule';
      streamResponder = (n) => {
        if (n === 1) return sseResponse([start(), toolCall('call_p', WRITE_TOOL, { preview: true }), end()]);
        if (n === 2) return sseResponse([start(), delta('Please confirm.'), end()]);
        if (n === 3) return sseResponse([start(), toolCall('call_c', OTHER_TOOL, { confirmed: true }), end()]);
        return sseResponse([start(), delta('Preview first.'), end()]);
      };
      const { result } = renderChat();

      await previewTurn(result);
      await act(async () => {
        await result.current.sendMessage('Yes, apply it');
      });

      expect(toolBodies.map((b) => b.tool_name)).toEqual([WRITE_TOOL]);
      expect(lastToolResult(3)).toEqual(CONFIRMATION_REQUIRED);
    });

    it('blocks a confirm that follows a preview of the same tool in the same round', async () => {
      streamResponder = (n) => {
        if (n === 1) return sseResponse([start(), toolCall('call_p', WRITE_TOOL, { preview: true }), end()]);
        if (n === 2) return sseResponse([start(), delta('Please confirm.'), end()]);
        if (n === 3)
          return sseResponse([
            start(),
            toolCall('call_p2', WRITE_TOOL, { preview: true }),
            toolCall('call_c', WRITE_TOOL, { confirmed: true }),
            end(),
          ]);
        return sseResponse([start(), delta('Confirm again.'), end()]);
      };
      const { result } = renderChat();

      await previewTurn(result);
      await act(async () => {
        await result.current.sendMessage('Yes, apply it');
      });

      expect(toolBodies.map((b) => b.arguments)).toEqual([{ preview: true }, { preview: true }]);
      expect(lastToolResult(3)).toEqual(CONFIRMATION_REQUIRED);
    });

    it('blocks a confirm when the preview is in an older turn, not the last turn', async () => {
      streamResponder = (n) => {
        if (n === 1) return sseResponse([start(), toolCall('call_p', WRITE_TOOL, { preview: true }), end()]);
        if (n === 2) return sseResponse([start(), delta('Please confirm.'), end()]);
        if (n === 3) return sseResponse([start(), delta('Sales are up.'), end()]);
        if (n === 4) return sseResponse([start(), toolCall('call_c', WRITE_TOOL, { confirmed: true }), end()]);
        return sseResponse([start(), delta('Preview first.'), end()]);
      };
      const { result } = renderChat();

      await previewTurn(result);
      await act(async () => {
        await result.current.sendMessage('How are sales?');
      });
      await act(async () => {
        await result.current.sendMessage('Yes, apply it');
      });

      expect(toolBodies.map((b) => b.arguments)).toEqual([{ preview: true }]);
      expect(lastToolResult(4)).toEqual(CONFIRMATION_REQUIRED);
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

    it('gives a TOOL_ERROR result on timeout also when AbortSignal.any does not exist', async () => {
      const originalAny = AbortSignal.any;
      delete (AbortSignal as { any?: typeof AbortSignal.any }).any;
      try {
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
          await vi.advanceTimersByTimeAsync(TOOL_TIMEOUT_MS + 1_000);
          await done;
        });

        expect(streamBodies).toHaveLength(2);
        const toolMsg = streamBodies[1].messages.at(-1)!;
        expect(JSON.parse(String(toolMsg.content))).toMatchObject({ ok: false, error: { code: 'TOOL_ERROR' } });
        expect(result.current.error).toBeNull();
      } finally {
        AbortSignal.any = originalAny;
      }
    });

    it('ends the turn on Stop while the round waits for getSession', async () => {
      getSession.mockImplementation(() => new Promise(() => {}));
      const { result } = renderChat();

      let done = false;
      act(() => {
        void result.current.sendMessage('Hello').then(() => {
          done = true;
        });
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.isStreaming).toBe(true);

      await act(async () => {
        result.current.abortStream();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(done).toBe(true);
      expect(result.current.isStreaming).toBe(false);
      expect(streamBodies).toHaveLength(0);
    });

    it('gives a TOOL_ERROR result when getSession does not answer in TOOL_TIMEOUT_MS', async () => {
      vi.useFakeTimers();
      const session = { data: { session: { access_token: 'token-1' } } };
      // Call 1 is round 1, call 2 is the tool, call 3 is round 2.
      getSession
        .mockResolvedValueOnce(session)
        .mockImplementationOnce(() => new Promise(() => {}))
        .mockResolvedValue(session);
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
        await vi.advanceTimersByTimeAsync(TOOL_TIMEOUT_MS + 1_000);
      });

      expect(toolBodies).toHaveLength(0);
      expect(streamBodies).toHaveLength(2);
      const toolMsg = streamBodies[1].messages.at(-1)!;
      expect(JSON.parse(String(toolMsg.content))).toMatchObject({ ok: false, error: { code: 'TOOL_ERROR' } });
      await act(async () => {
        await done;
      });
      expect(result.current.error).toBeNull();
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

  it('stops the turn and adds no more rows when restaurantId changes', async () => {
    let hung!: () => void;
    const hangReached = new Promise<void>((resolve) => {
      hung = resolve;
    });
    streamResponder = (n) =>
      n === 1
        ? sseResponse([start(), toolCall('call_1', 'get_kpis'), end()])
        : sseResponse([start(), { hang: true, onHang: hung }]);
    const { result, rerender } = renderHook(({ id }) => useAiChat({ restaurantId: id }), {
      initialProps: { id: 'rest-1' },
    });

    let done!: Promise<void>;
    act(() => {
      done = result.current.sendMessage('Hi');
    });
    await act(async () => {
      await hangReached;
    });
    const rowsBefore = result.current.messages.map((m) => m.id);

    // A sync act renders the new props now. An async act renders them only at its end.
    act(() => {
      rerender({ id: 'rest-2' });
    });
    await act(async () => {
      await done;
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(streamBodies).toHaveLength(2);
    // No row of the stopped turn is added after the change.
    expect(result.current.messages.every((m) => rowsBefore.includes(m.id))).toBe(true);
    // The empty round-2 assistant row is gone.
    expect(result.current.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('adds no rows after an abort, also when the server answers late', async () => {
    let releaseTool!: () => void;
    const toolGate = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    let toolStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      toolStarted = resolve;
    });
    // This tool ignores the abort signal and answers late.
    toolResponder = async () => {
      toolStarted();
      await toolGate;
      return jsonResponse(200, { ok: true, data: {} });
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
      releaseTool();
      await done;
    });

    expect(streamBodies).toHaveLength(1);
    expect(result.current.messages.map((m) => m.role)).toEqual(['user']);
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

  it('keeps streaming through a 2-round turn longer than ROUND_IDLE_TIMEOUT_MS in total', async () => {
    vi.useFakeTimers();
    const gap = Math.floor((ROUND_IDLE_TIMEOUT_MS * 2) / 3);
    streamResponder = (n) =>
      n === 1
        ? sseResponse([start(), { wait: gap }, toolCall('call_1', 'get_kpis'), end()])
        : sseResponse([start(), { wait: gap }, delta('Done'), { wait: 5_000 }, end()]);
    const { result } = renderChat();

    let done!: Promise<void>;
    act(() => {
      done = result.current.sendMessage('Hi');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROUND_IDLE_TIMEOUT_MS + 1_000);
    });
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(gap + 5_000);
      await done;
    });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.messages.at(-1)?.content).toBe('Done');
  });

  it('sets a timeout error when a round receives no data for ROUND_IDLE_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    streamResponder = () => sseResponse([start(), { hang: true }]);
    const { result } = renderChat();

    let done!: Promise<void>;
    act(() => {
      done = result.current.sendMessage('Hi');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROUND_IDLE_TIMEOUT_MS - 1_000);
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

  it('keeps a round alive while chunks arrive that hold no complete event', async () => {
    vi.useFakeTimers();
    const gap = ROUND_IDLE_TIMEOUT_MS - 1_000;
    const payload = `data: ${JSON.stringify({ type: 'message_delta', delta: 'Slow answer' })}\n\n`;
    streamResponder = () =>
      sseResponse([
        start(),
        { wait: gap },
        { raw: ': keep-alive\n' },
        { wait: gap },
        { raw: payload.slice(0, 10) },
        { wait: gap },
        { raw: payload.slice(10) },
        end(),
      ]);
    const { result } = renderChat();

    let done!: Promise<void>;
    act(() => {
      done = result.current.sendMessage('Hi');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(gap * 3 + 1_000);
      await done;
    });

    expect(result.current.error).toBeNull();
    expect(result.current.messages.at(-1)?.content).toBe('Slow answer');
  });

  it('stamps a new turn after the last loaded message, also when the clock is behind', async () => {
    streamResponder = () => sseResponse([start(), delta('Answer'), end()]);
    const { result } = renderChat();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    act(() => {
      result.current.setMessages([
        { id: 'db-1', role: 'user', content: 'Old question', created_at: future },
      ]);
    });
    await act(async () => {
      await result.current.sendMessage('New question');
    });

    const times = result.current.messages.map((m) => Date.parse(m.created_at!));
    expect(times).toHaveLength(3);
    expect(times[1]).toBeGreaterThan(times[0]);
    expect(times[2]).toBeGreaterThan(times[1]);
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

// ---------------------------------------------------------------------------
// SSE byte framing
// ---------------------------------------------------------------------------

function readerOf(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const queue = chunks.map((c) => encoder.encode(c));
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = queue.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
  }).getReader();
}

async function collect(chunks: string[], onChunk?: () => void) {
  const events: unknown[] = [];
  for await (const event of readSseEvents(readerOf(chunks), new AbortController().signal, onChunk)) {
    events.push(event);
  }
  return events;
}

describe('readSseEvents', () => {
  const line = (e: Record<string, unknown>) => `data: ${JSON.stringify(e)}\n\n`;

  it('parses a line that is split across chunks', async () => {
    const text = line({ type: 'message_delta', delta: 'Hello' });
    expect(await collect([text.slice(0, 7), text.slice(7, 20), text.slice(20)])).toEqual([
      { type: 'message_delta', delta: 'Hello' },
    ]);
  });

  it('parses a last line that has no newline', async () => {
    const events = await collect([
      line({ type: 'message_start' }),
      `data: ${JSON.stringify({ type: 'message_end' })}`,
    ]);
    expect(events).toEqual([{ type: 'message_start' }, { type: 'message_end' }]);
  });

  it('parses a multi-byte character that is split across chunks', async () => {
    const bytes = encoder.encode(line({ type: 'message_delta', delta: 'caf\u00e9 \u{1F600}' }));
    const cut = bytes.length - 8;
    const reader = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    }).getReader();
    const events: unknown[] = [];
    for await (const e of readSseEvents(reader, new AbortController().signal)) events.push(e);
    expect(events).toEqual([{ type: 'message_delta', delta: 'caf\u00e9 \u{1F600}' }]);
  });

  it('skips comment lines and lines that are not JSON', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const events = await collect([': ping\n', 'data: {bad json\n\n', line({ type: 'message_end' })]);
    expect(events).toEqual([{ type: 'message_end' }]);
  });

  it('calls onChunk for each read, also for a chunk with no complete event', async () => {
    const onChunk = vi.fn();
    await collect([': ping\n', 'data: {"type":', '"message_end"}\n\n'], onChunk);
    // Three data chunks and the final done read.
    expect(onChunk).toHaveBeenCalledTimes(4);
  });
});
