/**
 * Filters unactionable, CORS-masked "Script error." exceptions out of
 * PostHog error tracking before they're sent.
 *
 * Cross-origin scripts we don't control (iOS-injected scripts, password
 * managers, content blockers, etc.) surface as a synthetic, stack-frame-less
 * "Script error." exception with zero diagnostic content. Every script we
 * control already reports unmasked errors, so these events are pure noise.
 * This mirrors Sentry's default posture (`ignoreErrors: ['Script error.']`).
 */

import type { CaptureResult } from 'posthog-js';

/** Exact masked-message literals this predicate matches. Kept exported and
 * exhaustive so the filter's scope stays auditable at a glance. */
export const MASKED_SCRIPT_ERROR_MESSAGES = ['Script error.', 'Script error'];

interface ExceptionStacktrace {
  /** Frame shape is never inspected here, only counted. */
  frames?: unknown[];
  [key: string]: unknown;
}

interface ExceptionListEntry {
  type?: string;
  value?: string;
  mechanism?: {
    synthetic?: boolean;
    [key: string]: unknown;
  };
  stacktrace?: ExceptionStacktrace;
  [key: string]: unknown;
}

function hasNoStackFrames(entry: ExceptionListEntry): boolean {
  const frames = entry.stacktrace?.frames;
  return !frames || frames.length === 0;
}

function isMaskedScriptErrorEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const candidate = entry as ExceptionListEntry;

  const isSynthetic = candidate.mechanism?.synthetic === true;
  if (!isSynthetic) return false;

  if (!hasNoStackFrames(candidate)) return false;

  return (
    typeof candidate.value === 'string' &&
    MASKED_SCRIPT_ERROR_MESSAGES.includes(candidate.value)
  );
}

/**
 * True only when `event` is a PostHog `$exception` event whose entire
 * `$exception_list` consists of synthetic, stack-frame-less entries with a
 * masked "Script error." message. Everything else (real errors, mixed
 * lists, non-exception events, null/undefined, missing/empty lists) is
 * left alone (returns `false`).
 */
export function isUnactionableScriptError(
  event: CaptureResult | null | undefined
): boolean {
  if (!event) return false;
  if (event.event !== '$exception') return false;

  const exceptionList = event.properties?.$exception_list;
  if (!Array.isArray(exceptionList) || exceptionList.length === 0) {
    return false;
  }

  return exceptionList.every(isMaskedScriptErrorEntry);
}
