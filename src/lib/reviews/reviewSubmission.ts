/**
 * The rule that decides when the guest follow-up form may be sent.
 *
 * The comment is optional. A guest may give an email and no comment, or a
 * comment and no email. A form that holds neither writes nothing. The Send
 * control stays disabled in that case.
 *
 * This whole module is a copy. `supabase/functions/_shared/reviewContact.ts`
 * holds the Deno original, which an edge function can import and this file
 * cannot: `isPlausibleEmail` and `hasFollowUpPayload` there answer to
 * `isPlausibleEmail` and `canSubmitFollowUp` here. That copy is
 * authoritative: this one only enables a button. Change both together, or
 * the button sends a request the server answers with a 400.
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

export function canSubmitFollowUp(input: {
  comment: string;
  consent: boolean;
  email: string;
}): boolean {
  if (input.comment.trim().length > 0) return true;
  // Consent false means the server discards the name and the email. Without
  // consent an address is not a payload.
  return input.consent && isPlausibleEmail(input.email);
}
