import { navigatorLock } from '@supabase/supabase-js';

// Wait limit: 10 seconds plus a random value from 0 to 2 seconds.
const BASE_WAIT_MS = 10_000;
const JITTER_MS = 2_000;

// Value that means "query() failed". It counts as the same holder.
const QUERY_FAILED = Symbol('query-failed');
type Holder = string | undefined | typeof QUERY_FAILED;

type LockManagerLike = Pick<LockManager, 'request' | 'query'>;

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

async function readHolder(locks: LockManagerLike, name: string): Promise<Holder> {
  try {
    const snapshot = await locks.query();
    return snapshot.held?.find((entry) => entry.name === name)?.clientId;
  } catch {
    return QUERY_FAILED;
  }
}

/**
 * Auth lock with a bounded wait. A request with no timeout (acquireTimeout < 0)
 * steals the lock when the same holder keeps it past the wait limit.
 * WARNING: a steal ends the old holder's request. Its callback continues to run.
 */
export async function authLock<R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  const locks: LockManagerLike | undefined = globalThis.navigator?.locks;
  if (!locks) return fn();
  if (acquireTimeout >= 0) return navigatorLock(name, acquireTimeout, fn);

  let work: Promise<R> | undefined;
  const run = () => (work = fn());
  const controller = new AbortController();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;

  // No await before the request: the start query must not delay the lock request.
  let lastHolder: Promise<Holder> = readHolder(locks, name);

  const scheduleLimit = () => {
    if (finished) return;
    timer = setTimeout(onLimit, BASE_WAIT_MS + Math.random() * JITTER_MS);
  };

  const onLimit = async () => {
    if (finished || work) return;
    const previous: Holder = await lastHolder;
    const current: Holder = await readHolder(locks, name);
    if (finished || work) return;
    const progressed =
      current !== QUERY_FAILED && previous !== QUERY_FAILED && current !== previous;
    // A free lock means a grant is next. A changed holder means the lock moves.
    if (progressed || (current === undefined && previous !== QUERY_FAILED)) {
      lastHolder = Promise.resolve(current);
      scheduleLimit();
      return;
    }
    finished = true;
    controller.abort();
  };

  scheduleLimit();

  try {
    try {
      return await locks.request(name, { mode: 'exclusive', signal: controller.signal }, run);
    } catch (error) {
      if (work) return work; // The lock was stolen, or fn rejected.
      if (!isAbortError(error)) throw error;
    }
    console.warn(
      `[authLock] Lock "${name}" held by the same owner for ${Date.now() - startedAt} ms. Stealing the lock.`,
    );
    try {
      return await locks.request(name, { mode: 'exclusive', steal: true }, run);
    } catch (error) {
      if (work) return work;
      throw error;
    }
  } finally {
    finished = true;
    if (timer !== undefined) clearTimeout(timer);
  }
}
