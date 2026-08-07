/**
 * The submit rule `handleComment` uses.
 *
 * `src/lib/reviews/reviewSubmission.ts` holds the client copy, which enables
 * the Send control: `isPlausibleEmail` and `canSubmitFollowUp` there answer
 * to `isPlausibleEmail` and `hasFollowUpPayload` here. This copy is
 * authoritative: it decides what the server writes. An edge function cannot
 * import from `src/`. Change both together, or the button sends a request
 * the server answers with a 400.
 */

/** The longest email `handleComment` accepts. It slices at this length. */
export const MAX_EMAIL_LENGTH = 320;

/**
 * One local part, one `@`, and a domain with at least one dot. Only a sent
 * mail proves an address works. This check catches the typo a guest can see.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH) return false;
  return EMAIL_PATTERN.test(trimmed);
}

export function hasFollowUpPayload(input: {
  comment: string;
  consent: boolean;
  email: string;
}): boolean {
  if (input.comment.trim().length > 0) return true;
  // Consent false means the server discards the name and the email. Without
  // consent an address is not a payload.
  return input.consent && isPlausibleEmail(input.email);
}
