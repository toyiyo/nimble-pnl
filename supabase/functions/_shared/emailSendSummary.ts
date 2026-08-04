import type { PacedResult } from './emailQueue.ts';

export interface EmailSendSummary {
  sent: number;
  failed: number;
  rateLimited: number;
  firstError?: string;
}

const MAX_ERROR_LENGTH = 200;

/**
 * Truncates an error message to a bounded length so a Resend error body
 * never gets pasted whole into a response the manager sees.
 */
const truncateError = (message: string): string => {
  if (message.length <= MAX_ERROR_LENGTH) {
    return message;
  }
  return `${message.slice(0, MAX_ERROR_LENGTH)}…`;
};

/**
 * Tallies a paced fan-out's results into a summary that can be handed back
 * in an edge function response and logged without leaking recipient emails.
 */
export const summarizeSends = <T extends { id: string }>(
  results: PacedResult<T>[],
  label: string,
): EmailSendSummary => {
  let sent = 0;
  let failed = 0;
  let rateLimited = 0;
  let firstError: string | undefined;

  for (const result of results) {
    if (result.ok) {
      sent += 1;
      continue;
    }

    failed += 1;
    if (result.status === 429) {
      rateLimited += 1;
    }

    const message = result.error ? truncateError(result.error) : `HTTP ${result.status}`;
    if (firstError === undefined) {
      firstError = message;
    }

    // Log the employee id, never the email address — function logs are
    // readable well outside the tenant boundary.
    console.error(`[${label}] send failed for recipient ${result.recipient.id}: ${message}`);
  }

  return firstError === undefined
    ? { sent, failed, rateLimited }
    : { sent, failed, rateLimited, firstError };
};
