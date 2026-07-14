export interface PushEligibleEmployee {
  user_id?: string | null;
}

const RUN_BOUNDED_CONCURRENCY = 20; // bounded fan-out — see design doc "CPU/timeout" note

/**
 * Reduce a list of employees down to the deduped set of user_ids eligible for a
 * broadcast push, excluding a given actor (e.g. the poster of a shift trade).
 * Pure filter — no I/O — so it stays vitest-importable and independent of the
 * Deno-only web-push send path.
 */
export function selectBroadcastPushUserIds(
  employees: PushEligibleEmployee[],
  excludeUserId?: string | null,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const employee of employees) {
    const userId = employee.user_id;
    if (!userId) continue;
    if (excludeUserId && userId === excludeUserId) continue;
    if (seen.has(userId)) continue;
    seen.add(userId);
    result.push(userId);
  }
  return result;
}

/**
 * Run `worker` once per item in bounded-concurrency chunks, so a large fan-out
 * (e.g. pushing to every active employee) doesn't open hundreds of simultaneous
 * async calls inside one edge-function invocation. A worker rejection never
 * aborts the run (Promise.allSettled semantics) — callers that need per-item
 * failure detail should capture it inside `worker` itself.
 */
export async function runBounded<T>(
  items: T[],
  worker: (item: T) => Promise<unknown>,
  concurrency = RUN_BOUNDED_CONCURRENCY,
): Promise<void> {
  // Clamp to a positive integer step — a caller-supplied 0/negative concurrency
  // would otherwise never advance `i`, spinning the loop until the edge function
  // times out.
  const step = Math.max(1, Math.floor(concurrency));
  for (let i = 0; i < items.length; i += step) {
    const chunk = items.slice(i, i + step);
    await Promise.allSettled(chunk.map((item) => worker(item)));
  }
}
