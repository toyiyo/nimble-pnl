import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authLock } from '@/lib/authLock';

type Req = {
  name: string;
  options: Record<string, unknown>;
  callback: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  clientId: string;
};

function abortError() {
  return new DOMException('aborted', 'AbortError');
}

// A fake navigator.locks that follows the Web Locks specification rules.
function createFakeLocks() {
  const held: Record<string, { req: Req; clientId: string } | undefined> = {};
  const queue: Req[] = [];
  const state = {
    steals: 0,
    requests: [] as Array<Record<string, unknown>>,
    queryRejects: false,
    onQuery: undefined as undefined | (() => void),
    nextClientId: 1,
  };

  function grant(req: Req) {
    held[req.name] = { req, clientId: req.clientId };
    let p: Promise<unknown>;
    try {
      p = Promise.resolve(req.callback());
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (v) => {
        if (held[req.name]?.req === req) {
          held[req.name] = undefined;
          next(req.name);
        }
        req.resolve(v);
      },
      (e) => {
        if (held[req.name]?.req === req) {
          held[req.name] = undefined;
          next(req.name);
        }
        req.reject(e);
      },
    );
  }

  function next(name: string) {
    if (held[name]) return;
    const idx = queue.findIndex((r) => r.name === name);
    if (idx >= 0) grant(queue.splice(idx, 1)[0]);
  }

  const locks = {
    request(name: string, options: Record<string, unknown>, callback: () => Promise<unknown>) {
      state.requests.push(options);
      if (options.steal && (options.signal || options.ifAvailable)) {
        return Promise.reject(new DOMException('bad', 'NotSupportedError'));
      }
      return new Promise((resolve, reject) => {
        const req: Req = {
          name,
          options,
          callback,
          resolve,
          reject,
          clientId: `client-${state.nextClientId++}`,
        };
        const signal = options.signal as AbortSignal | undefined;
        if (options.steal) {
          state.steals++;
          const old = held[name];
          if (old) old.req.reject(abortError());
          grant(req);
          return;
        }
        if (signal) {
          signal.addEventListener('abort', () => {
            const i = queue.indexOf(req);
            if (i >= 0) {
              queue.splice(i, 1);
              reject(abortError());
            }
          });
        }
        if (options.ifAvailable && held[name]) {
          // The spec calls the callback with null when the lock is not free.
          Promise.resolve((callback as (l: unknown) => Promise<unknown>)(null)).then(resolve, reject);
          return;
        }
        queue.push(req);
        next(name);
      });
    },
    async query() {
      state.onQuery?.();
      if (state.queryRejects) throw new Error('query failed');
      return {
        held: Object.entries(held)
          .filter(([, h]) => h)
          .map(([name, h]) => ({ name, clientId: h!.clientId })),
        pending: queue.map((r) => ({ name: r.name, clientId: r.clientId })),
      };
    },
  };
  return { locks, state, held, grant, next };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('authLock', () => {
  let fake: ReturnType<typeof createFakeLocks>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fake = createFakeLocks();
    vi.stubGlobal('navigator', { locks: fake.locks });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Hold the lock with a callback that never ends.
  function hang(name = 'lock:test') {
    void fake.locks.request(name, { mode: 'exclusive' }, () => new Promise(() => {})).catch(() => {});
  }

  it('runs fn with no lock when navigator.locks does not exist', async () => {
    vi.stubGlobal('navigator', {});
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(authLock('lock:test', -1, fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('delegates to navigatorLock when acquireTimeout is 0', async () => {
    hang();
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(authLock('lock:test', 0, fn)).rejects.toMatchObject({ isAcquireTimeout: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it('runs fn when the lock is granted in time', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(authLock('lock:test', -1, fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fake.state.steals).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('steals when the same holder keeps the lock past the limit', async () => {
    hang();
    const fn = vi.fn().mockResolvedValue('ok');
    const p = authLock('lock:test', -1, fn);
    await vi.advanceTimersByTimeAsync(9999);
    expect(fake.state.steals).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toBe('ok');
    expect(fake.state.steals).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0].join(' '))).toContain('lock:test');
  });

  it('steals within 12 seconds at the highest random value', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    hang();
    const fn = vi.fn().mockResolvedValue('ok');
    const p = authLock('lock:test', -1, fn);
    await vi.advanceTimersByTimeAsync(11999);
    await expect(p).resolves.toBe('ok');
    expect(fake.state.steals).toBe(1);
  });

  it('sends only mode and steal on the steal request', async () => {
    hang();
    const p = authLock('lock:test', -1, vi.fn().mockResolvedValue('ok'));
    await vi.advanceTimersByTimeAsync(10000);
    await p;
    const stealOptions = fake.state.requests.find((o) => o.steal);
    expect(stealOptions).toEqual({ mode: 'exclusive', steal: true });
  });

  it('keeps the queue place when the holder changed', async () => {
    // First holder ends at 5 s, a second holder then hangs.
    let release: () => void = () => {};
    void fake.locks
      .request('lock:test', { mode: 'exclusive' }, () => new Promise<void>((r) => (release = r)))
      .catch(() => {});
    hang(); // queued behind the first holder, then holds forever
    const fn = vi.fn().mockResolvedValue('ok');
    const p = authLock('lock:test', -1, fn);
    await vi.advanceTimersByTimeAsync(5000);
    release();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fake.state.steals).toBe(0);
    await vi.advanceTimersByTimeAsync(10000);
    await expect(p).resolves.toBe('ok');
    expect(fake.state.steals).toBe(1);
  });

  it('steals one time for two calls in one tab', async () => {
    hang();
    const fn1 = vi.fn().mockResolvedValue('a');
    const fn2 = vi.fn().mockResolvedValue('b');
    const p1 = authLock('lock:test', -1, fn1);
    const p2 = authLock('lock:test', -1, fn2);
    await vi.advanceTimersByTimeAsync(10000);
    await expect(p1).resolves.toBe('a');
    await expect(p2).resolves.toBe('b');
    expect(fake.state.steals).toBe(1);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it('returns the fn result when the lock is stolen from this call', async () => {
    let finish: (v: string) => void = () => {};
    const fn = vi.fn(() => new Promise<string>((r) => (finish = r)));
    const p = authLock('lock:test', -1, fn);
    await flush();
    // Another client steals the lock while fn runs.
    void fake.locks.request('lock:test', { mode: 'exclusive', steal: true }, () => new Promise(() => {})).catch(() => {});
    await flush();
    finish('result');
    await expect(p).resolves.toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fake.state.steals).toBe(1);
  });

  it('rejects with the fn error after the lock is stolen', async () => {
    let fail: (e: unknown) => void = () => {};
    const fn = vi.fn(() => new Promise<string>((_, rej) => (fail = rej)));
    const p = authLock('lock:test', -1, fn);
    p.catch(() => {});
    await flush();
    void fake.locks.request('lock:test', { mode: 'exclusive', steal: true }, () => new Promise(() => {})).catch(() => {});
    await flush();
    fail(new Error('boom'));
    await expect(p).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not steal when fn throws AbortError', async () => {
    const err = new DOMException('fn abort', 'AbortError');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(authLock('lock:test', -1, fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fake.state.steals).toBe(0);
  });

  it('steals when query rejects', async () => {
    fake.state.queryRejects = true;
    hang();
    const fn = vi.fn().mockResolvedValue('ok');
    const p = authLock('lock:test', -1, fn);
    await vi.advanceTimersByTimeAsync(10000);
    await expect(p).resolves.toBe('ok');
    expect(fake.state.steals).toBe(1);
  });

  it('does not steal when the lock is free at the limit', async () => {
    let release: () => void = () => {};
    void fake.locks
      .request('lock:test', { mode: 'exclusive' }, () => new Promise<void>((r) => (release = r)))
      .catch(() => {});
    const fn = vi.fn().mockResolvedValue('ok');
    const p = authLock('lock:test', -1, fn);
    await vi.advanceTimersByTimeAsync(9000);
    release();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fake.state.steals).toBe(0);
  });

  it('does not steal when the grant arrives during the query at the limit', async () => {
    let release: () => void = () => {};
    void fake.locks
      .request('lock:test', { mode: 'exclusive' }, () => new Promise<void>((r) => (release = r)))
      .catch(() => {});
    const fn = vi.fn().mockResolvedValue('ok');
    const p = authLock('lock:test', -1, fn);
    await vi.advanceTimersByTimeAsync(5000);
    // On the next query (at the limit) the holder ends before the query returns.
    fake.state.onQuery = () => {
      fake.state.onQuery = undefined;
      release();
    };
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fake.state.steals).toBe(0);
  });

  it('leaves no active timer after the call ends', async () => {
    hang();
    const p = authLock('lock:test', -1, vi.fn().mockResolvedValue('ok'));
    await vi.advanceTimersByTimeAsync(10000);
    await p;
    expect(vi.getTimerCount()).toBe(0);
  });
});
