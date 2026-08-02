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
): Promise<EmailSendResult> => {
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
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, status: response.status, error: body };
    }

    return { ok: true, status: response.status };
  } catch (error) {
    // status 0 means "never reached Resend" — a transport failure, not a
    // rejection from the API.
    return { ok: false, status: 0, error: errorMessage(error) };
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

  const startedAt = now();
  const results: PacedResult<T>[] = [];
  let nextSendAt = startedAt;

  for (const recipient of recipients) {
    let attempts = 0;
    let outcome: EmailSendResult = { ok: false, status: 0, error: 'not attempted' };

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
