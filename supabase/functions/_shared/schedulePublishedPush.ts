export interface SchedulePushEmployee {
  user_id?: string | null;
}

export type WebPushSend = (userId: string) => Promise<unknown>;

const PUSH_CONCURRENCY = 20; // bounded fan-out — see design doc "CPU/timeout" note

/**
 * Fan a "Schedule Updated" push out to every scheduled employee with a user_id,
 * in bounded-concurrency chunks so a 100+-employee restaurant doesn't open 100+
 * simultaneous push round-trips inside one edge-function invocation.
 * Sender is injected so the Deno-only web-push call stays out of this module.
 */
export async function notifySchedulePublishedPush(
  employees: SchedulePushEmployee[],
  send: WebPushSend,
  concurrency = PUSH_CONCURRENCY,
): Promise<{ attempted: number }> {
  const targets = employees.filter((e): e is { user_id: string } => !!e.user_id);
  for (let i = 0; i < targets.length; i += concurrency) {
    const chunk = targets.slice(i, i + concurrency);
    await Promise.allSettled(chunk.map((e) => send(e.user_id)));
  }
  return { attempted: targets.length };
}
