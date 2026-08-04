import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendEmailResult,
  sendPaced,
  RESEND_DEFAULT_INTERVAL_MS,
  BUDGET_EXHAUSTED_ERROR,
} from '../../supabase/functions/_shared/emailQueue';

/**
 * A fake clock + sleep so pacing/backoff are asserted deterministically
 * instead of by actually waiting seconds in the test run.
 */
function makeFakeTimer() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('sendEmailResult', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports ok with the HTTP status on success', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'abc' }), { status: 200 }),
    );

    const result = await sendEmailResult('key', 'from@x.com', 'to@x.com', 'Subj', '<p>hi</p>');

    expect(result).toEqual({ ok: true, status: 200 });
  });

  it('surfaces the status and body on failure instead of collapsing to false', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('rate limit exceeded', { status: 429 }));

    const result = await sendEmailResult('key', 'from@x.com', 'to@x.com', 'Subj', '<p>hi</p>');

    // This is the whole point of the sibling function: a 429 must be
    // distinguishable from a hard bounce so the queue can retry it.
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error).toContain('rate limit');
  });

  it('reports a thrown network error as status 0 rather than throwing', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('connection reset'));

    const result = await sendEmailResult('key', 'from@x.com', 'to@x.com', 'Subj', '<p>hi</p>');

    expect(result).toEqual({ ok: false, status: 0, error: 'connection reset' });
  });

  it('aborts a request Resend accepts but never answers', async () => {
    vi.useFakeTimers();

    // A connection that is opened and then goes silent. `fetch` has no timeout
    // of its own, so without the AbortController this promise -- and the
    // manager's publish dialog awaiting it -- never settles.
    vi.mocked(fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () =>
            reject(new DOMException('The signal has been aborted', 'AbortError')),
          );
        }),
    );

    const pending = sendEmailResult('key', 'from@x.com', 'to@x.com', 'Subj', '<p>hi</p>');
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;

    expect(result.ok).toBe(false);
    // Status 0 is the same channel a transport failure uses, so the pacer needs
    // no new case: it is not a 429, so it is not retried.
    expect(result.status).toBe(0);

    vi.useRealTimers();
  });

  it('normalizes a single recipient into an array for the Resend payload', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }));

    await sendEmailResult('key', 'from@x.com', 'to@x.com', 'Subj', '<p>hi</p>');

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.to).toEqual(['to@x.com']);
  });
});

describe('sendPaced', () => {
  it('paces sends at the Resend default of 2 per second', async () => {
    const timer = makeFakeTimer();
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await sendPaced(['a@x.com', 'b@x.com', 'c@x.com'], send, {
      sleep: timer.sleep,
      now: timer.now,
    });

    expect(send).toHaveBeenCalledTimes(3);
    // First send is immediate; the following two each wait out the interval.
    expect(timer.sleeps).toEqual([RESEND_DEFAULT_INTERVAL_MS, RESEND_DEFAULT_INTERVAL_MS]);
  });

  it('does not sleep before the first send', async () => {
    const timer = makeFakeTimer();
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await sendPaced(['only@x.com'], send, { sleep: timer.sleep, now: timer.now });

    expect(timer.sleeps).toEqual([]);
  });

  it('does not sleep when the caller already burned the interval', async () => {
    const timer = makeFakeTimer();
    const send = vi.fn().mockImplementation(async () => {
      // A send that itself takes longer than the pacing interval means the
      // next one is already due — waiting again would be wasted wall time.
      timer.advance(RESEND_DEFAULT_INTERVAL_MS + 50);
      return { ok: true, status: 200 };
    });

    await sendPaced(['a@x.com', 'b@x.com'], send, { sleep: timer.sleep, now: timer.now });

    expect(timer.sleeps).toEqual([]);
  });

  it('retries a 429 with backoff and reports the eventual success', async () => {
    const timer = makeFakeTimer();
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, error: 'too many' })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const results = await sendPaced(['a@x.com'], send, { sleep: timer.sleep, now: timer.now });

    expect(send).toHaveBeenCalledTimes(2);
    expect(results[0]).toMatchObject({ recipient: 'a@x.com', ok: true, attempts: 2 });
    expect(timer.sleeps).toContain(1000);
  });

  it('gives up after maxRetries and reports the last 429', async () => {
    const timer = makeFakeTimer();
    const send = vi.fn().mockResolvedValue({ ok: false, status: 429, error: 'too many' });

    const results = await sendPaced(['a@x.com'], send, {
      sleep: timer.sleep,
      now: timer.now,
      maxRetries: 2,
    });

    expect(send).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(results[0]).toMatchObject({ ok: false, status: 429, attempts: 3 });
  });

  it('does not retry a non-429 failure', async () => {
    const timer = makeFakeTimer();
    const send = vi.fn().mockResolvedValue({ ok: false, status: 422, error: 'invalid address' });

    const results = await sendPaced(['bad@x.com'], send, { sleep: timer.sleep, now: timer.now });

    expect(send).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ ok: false, status: 422, attempts: 1 });
  });

  it('keeps one result per recipient, in order, so partial failure can be reported', async () => {
    const timer = makeFakeTimer();
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 422, error: 'invalid address' })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const results = await sendPaced(['a@x.com', 'b@x.com', 'c@x.com'], send, {
      sleep: timer.sleep,
      now: timer.now,
    });

    expect(results.map((r) => r.recipient)).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
  });

  it('one recipient failing does not abort the rest of the fan-out', async () => {
    const timer = makeFakeTimer();
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('unexpected explosion'))
      .mockResolvedValue({ ok: true, status: 200 });

    const results = await sendPaced(['a@x.com', 'b@x.com'], send, {
      sleep: timer.sleep,
      now: timer.now,
    });

    expect(results[0]).toMatchObject({ ok: false, status: 0, error: 'unexpected explosion' });
    expect(results[1]).toMatchObject({ ok: true });
  });

  it('returns an empty result set for an empty recipient list without sending', async () => {
    const send = vi.fn();

    const results = await sendPaced([], send, {});

    expect(results).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('stops sending once the wall-clock budget is exhausted', async () => {
    const timer = makeFakeTimer();
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    // 500ms pacing inside a 1000ms budget: sends start at t=0, 500 and 1000,
    // so the fourth recipient finds the budget already spent.
    const results = await sendPaced(['a', 'b', 'c', 'd'], send, {
      intervalMs: 500,
      budgetMs: 1000,
      sleep: timer.sleep,
      now: timer.now,
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(results).toHaveLength(4);
    expect(results[3]).toEqual({
      recipient: 'd',
      ok: false,
      status: 0,
      error: BUDGET_EXHAUSTED_ERROR,
      attempts: 0,
    });
  });

  it('reports every unsent recipient, in order, when the budget runs out', async () => {
    const timer = makeFakeTimer();
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    // Budget 0 means nothing may be sent at all — the caller still needs a
    // result per recipient or it cannot tell who was skipped.
    const results = await sendPaced(['a', 'b', 'c'], send, {
      budgetMs: 0,
      sleep: timer.sleep,
      now: timer.now,
    });

    expect(send).not.toHaveBeenCalled();
    expect(results.map((r) => r.recipient)).toEqual(['a', 'b', 'c']);
    expect(results.every((r) => !r.ok && r.error === BUDGET_EXHAUSTED_ERROR)).toBe(true);
  });

  it('does not truncate a run that fits inside the budget', async () => {
    const timer = makeFakeTimer();
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    const results = await sendPaced(['a', 'b', 'c'], send, {
      intervalMs: 500,
      budgetMs: 90_000,
      sleep: timer.sleep,
      now: timer.now,
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
