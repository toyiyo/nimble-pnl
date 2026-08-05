import type { PacedResult } from './emailQueue.ts';

export interface EmailSendSummary {
  sent: number;
  failed: number;
  rateLimited: number;
  firstError?: string;
}

const MAX_ERROR_LENGTH = 200;

// Cap the raw error text handed to the redaction regex, independent of how
// large the upstream Resend response body was. Well above MAX_ERROR_LENGTH
// so any embedded email near the front of the message still gets redacted
// before the final truncation below; bounds worst-case regex work to a
// fixed size regardless of how much text Resend sends back.
const MAX_RAW_INPUT_LENGTH = 2000;

// Resend's raw error body sometimes echoes the offending recipient back
// (e.g. "Invalid `to` field: a@example.com is not a valid email"). Strip
// anything email-shaped before the message reaches a log line or a response
// the manager sees, regardless of how it got there. Delimiter chars
// (":()[]{},;" plus the existing quote/angle-bracket/whitespace set) are
// excluded from both the local part and domain so adjacent diagnostic text
// ("field:", parens, etc.) survives redaction instead of being swallowed
// into the match; the trailing negative lookbehind keeps a sentence-ending
// period out of the match too.
const EMAIL_PATTERN =
  /[^\s"'<>:()[\]{},;]+@[^\s"'<>:()[\]{},;]+\.[^\s"'<>:()[\]{},;]+(?<!\.)/g;

const redactEmails = (message: string): string => message.replace(EMAIL_PATTERN, '[redacted]');

/**
 * Truncates an error message to a bounded length so a Resend error body
 * never gets pasted whole into a response the manager sees.
 */
const truncateError = (message: string): string => {
  const bounded =
    message.length > MAX_RAW_INPUT_LENGTH ? message.slice(0, MAX_RAW_INPUT_LENGTH) : message;
  const redacted = redactEmails(bounded);
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
