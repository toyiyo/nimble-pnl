import type { PacedResult } from './emailQueue.ts';

export interface EmailSendSummary {
  sent: number;
  failed: number;
  rateLimited: number;
  firstError?: string;
}

const MAX_ERROR_LENGTH = 200;

// Resend's raw error body sometimes echoes the offending recipient back
// (e.g. "Invalid `to` field: a@example.com is not a valid email"). Strip
// anything email-shaped before the message reaches a log line or a response
// the manager sees, regardless of how it got there.
const EMAIL_PATTERN = /[^\s"'<>]+@[^\s"'<>]+\.[^\s"'<>]+/g;

const redactEmails = (message: string): string => message.replace(EMAIL_PATTERN, '[redacted]');

/**
 * Truncates an error message to a bounded length so a Resend error body
 * never gets pasted whole into a response the manager sees.
 */
const truncateError = (message: string): string => {
  const redacted = redactEmails(message);
  if (redacted.length <= MAX_ERROR_LENGTH) {
    return redacted;
  }
  return `${redacted.slice(0, MAX_ERROR_LENGTH)}…`;
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
