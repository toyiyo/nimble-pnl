export interface DirectedTarget {
  email: string | null;
}

/**
 * Recipients for a 'created' trade email.
 *
 * A DIRECTED trade (non-null target) goes ONLY to the target — or nobody if the target has
 * no email — NEVER the broadcast list, because directed offers are private to the target.
 * An OPEN marketplace trade (null target) uses the full broadcast list.
 *
 * Pure filter — no I/O — so it stays vitest-importable and independent of the Deno-only
 * email send path. Mirrors the push-channel gating in `webPushFanout.ts` (#606).
 */
export function resolveCreatedTradeEmailRecipients(
  directedTarget: DirectedTarget | null,
  broadcastEmails: string[],
): string[] {
  if (directedTarget) {
    return directedTarget.email ? [directedTarget.email] : [];
  }
  return broadcastEmails;
}
