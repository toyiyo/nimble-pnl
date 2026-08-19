/**
 * Paced Resend sender.
 *
 * Resend's default rate limit is 2 requests/second. `notify-schedule-published`
 * historically fanned every recipient out at once through `Promise.allSettled`,
 * so any roster past a handful started collecting 429s — invisibly, because the
 * old `sendEmail` collapsed every outcome to a bare boolean.
 *
 * Two pieces live here:
 *   - `sendEmailResult` — like `notificationHelpers.sendEmail`, but keeps the
 *     HTTP status and body so a retryable 429 is distinguishable from a hard
 *     bounce. `sendEmail` is now a one-line wrapper over it.
 *   - `sendPaced` — walks recipients sequentially at <= 2/s, retrying 429s with
 *     backoff, returning one result per recipient so callers can report partial
 *     failure.
 *
 * The pacing is awaited idle wall time, not CPU, so it does not press the edge
 * runtime's CPU budget. It does consume wall-clock: at 2/s the largest roster in
 * production today (25) takes ~12.5s. `sendPaced` logs the count and elapsed
 * time so that ceiling is observable well before a roster is large enough to
 * threaten the request timeout — past a few hundred recipients the answer is a
 * queue/cron drain, not a faster loop.
 */

/** Resend's default limit is 2 req/s. */
export const RESEND_DEFAULT_INTERVAL_MS = 500;

const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

/**
 * Overall wall-clock ceiling for one fan-out.
 *
 * Per-request timeouts alone do not bound the whole loop. An all-429 storm
 * costs ~7s of backoff per recipient, and a roster of 25 then runs ~175s —
 * past the edge request ceiling, and in exactly the conditions the pacing is
 * meant to survive. At a healthy 2/s this budget covers 180 recipients, which
 * is several times the largest roster in production today, so it truncates
 * nothing that is currently working.
 */
const DEFAULT_BUDGET_MS = 90_000;

/** Recorded as the error for recipients the budget never reached. */
export const BUDGET_EXHAUSTED_ERROR = 'send budget exhausted';

/**
 * Per-request ceiling on the Resend call.
 *
 * `fetch` has no timeout of its own, so a connection Resend accepts and then
 * stops answering hangs until the whole edge invocation is killed. That used to
 * be somebody else's problem; now that the publish dialog awaits this fan-out,
 * it is a manager staring at a spinner that never resolves. Aborting turns the
 * hang into a status-0 result the pacer already knows how to record.
 */
const REQUEST_TIMEOUT_MS = 15_000;

export interface EmailSendResult {
  ok: boolean;
  status: number;
  error?: string;
}

export interface PacedResult<T> {
  recipient: T;
  ok: boolean;
  status: number;
  error?: string;
  attempts: number;
}

export interface PacedOptions {
  /** Minimum gap between send starts. Defaults to 2/s. */
  intervalMs?: number;
  /** Retries after the initial attempt, for 429s only. */
  maxRetries?: number;
  /** Wall-clock ceiling for the whole fan-out. Defaults to 90s. */
  budgetMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests. */
  now?: () => number;
  /** Labels the summary log line. */
  label?: string;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Send one email via Resend, preserving the HTTP status.
 */
export const sendEmailResult = async (
  resendApiKey: string,
  from: string,
  to: string | string[],
  subject: string,
  html: string,
  headers?: Record<string, string>,
): Promise<EmailSendResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
      }),
      signal: controller.signal,
    });

    // Headers are in, so the deadline has done its job. Leaving it armed would
    // let a slow body abort mid-read and turn a retryable 429 into a terminal
    // status 0 — the exact distinction this module exists to preserve.
    clearTimeout(timer);

    if (!response.ok) {
      // The status is what decides retryability; the body is only for the log.
      // A truncated or unreadable body must not downgrade a 429 to a 0.
      const body = await response.text().catch(errorMessage);
      return { ok: false, status: response.status, error: body };
    }

    return { ok: true, status: response.status };
  } catch (error) {
    // status 0 means "never reached Resend" — a transport failure, not a
    // rejection from the API. An abort lands here too, and is deliberately not
    // retried: 429 is the only retryable status, and a stalled connection is
    // not evidence the next one will answer any faster.
    return { ok: false, status: 0, error: errorMessage(error) };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Send to each recipient in order, at most `1000 / intervalMs` per second.
 *
 * A failure for one recipient never aborts the rest: every recipient gets
 * exactly one result, in input order.
 */
export const sendPaced = async <T>(
  recipients: T[],
  send: (recipient: T) => Promise<EmailSendResult>,
  options: PacedOptions = {},
): Promise<PacedResult<T>[]> => {
  if (recipients.length === 0) return [];

  const intervalMs = options.intervalMs ?? RESEND_DEFAULT_INTERVAL_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? (() => Date.now());
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;

  const startedAt = now();
  const results: PacedResult<T>[] = [];
  let nextSendAt = startedAt;

  for (const recipient of recipients) {
    // Checked between recipients rather than mid-flight: aborting a send
    // already in progress would lose the distinction between a 429 worth
    // retrying and a request that never happened. The residual overshoot is
    // therefore one in-flight request (capped by REQUEST_TIMEOUT_MS) plus at
    // most one pacing interval — the retry chain is bounded separately below.
    if (now() - startedAt >= budgetMs) {
      results.push({
        recipient,
        attempts: 0,
        ok: false,
        status: 0,
        error: BUDGET_EXHAUSTED_ERROR,
      });
      continue;
    }

    let attempts = 0;
    // No initializer: the only way out of the loop below is the `break`, and
    // both paths into it assign. A placeholder here would be dead on every
    // path, and would quietly become the reported result if a future edit ever
    // did break out early.
    let outcome: EmailSendResult;

    for (;;) {
      const waitMs = nextSendAt - now();
      if (waitMs > 0) await sleep(waitMs);

      attempts++;
      // The interval is measured from when this send *starts*, so a send that
      // itself outlasts the interval doesn't then wait out a second one.
      const sentAt = now();
      try {
        outcome = await send(recipient);
      } catch (error) {
        outcome = { ok: false, status: 0, error: errorMessage(error) };
      }
      nextSendAt = sentAt + intervalMs;

      const retryable = outcome.status === 429 && attempts <= maxRetries;
      if (!retryable) break;

      // Stop retrying once the budget is spent. The retry chain would otherwise
      // run entirely inside the per-recipient guard above, so one unlucky
      // recipient could add four request timeouts plus 7s of backoff on top of
      // the deadline — the dominant overshoot term by far. The attempt already
      // made keeps its real outcome; only further attempts are abandoned.
      if (now() - startedAt >= budgetMs) break;

      // Exponential backoff on top of the normal pacing gap: 1s, 2s, 4s.
      await sleep(BASE_BACKOFF_MS * 2 ** (attempts - 1));
      nextSendAt = now();
    }

    results.push({ recipient, attempts, ...outcome });
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `[emailQueue]${options.label ? ` ${options.label}:` : ''} sent ${
      results.length - failed
    }/${results.length} in ${now() - startedAt}ms (${failed} failed)`,
  );

  return results;
};
