// Deterministic resolution of which accountless employee (if any) an invitation
// should be linked to. Shared pure logic — no Deno/URL imports — so it is unit
// tested via vitest (tests/unit/resolveAccountlessEmployeeLink.test.ts) and
// imported by the send-team-invitation edge function.
//
// Two properties this guards, both flagged in review of PR #648:
//   1. Determinism. PostgREST returns rows in an UNDEFINED order, so a bare
//      `.find()` over duplicate-email matches would attach an arbitrary
//      employee_id and could link the wrong person on acceptance. When more
//      than one active accountless employee shares the invited email we link
//      NOTHING unless an exact, validated client hint disambiguates — the
//      caller fails open (invite still sends; no auto-link).
//   2. No id-only trust. A client-supplied employeeId is honored only if it is
//      itself one of the email-matched accountless rows; an id that does not
//      also match the invitation email is ignored (it must not let an inviter
//      link an arbitrary accountless employee to an unrelated invitee's email).

export interface AccountlessEmployeeRow {
  id: string;
  name?: string | null;
  email: string | null;
}

export interface AccountlessLinkResolution {
  /** Employee row id to link, or null when there is no match or it is ambiguous. */
  employeeId: string | null;
  /**
   * True when more than one active accountless employee shares the invited
   * email and the client hint did not disambiguate. The caller should fail
   * open (send the invite without a link) and surface this for observability.
   */
  ambiguous: boolean;
}

/** Case-insensitive, whitespace-trimmed email normalization (mirrors auth). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function resolveAccountlessEmployeeLink(
  accountlessEmployees: readonly AccountlessEmployeeRow[] | null | undefined,
  invitationEmail: string,
  clientEmployeeId?: string | null,
): AccountlessLinkResolution {
  const normalizedEmail = normalizeEmail(invitationEmail);

  const emailMatches = (accountlessEmployees ?? []).filter(
    (e) => e.email != null && normalizeEmail(e.email) === normalizedEmail,
  );

  if (emailMatches.length === 0) {
    return { employeeId: null, ambiguous: false };
  }

  // A client hint disambiguates only when it is one of the email-matched rows.
  if (clientEmployeeId) {
    const hint = emailMatches.find((e) => e.id === clientEmployeeId);
    if (hint) {
      return { employeeId: hint.id, ambiguous: false };
    }
  }

  if (emailMatches.length === 1) {
    return { employeeId: emailMatches[0].id, ambiguous: false };
  }

  // More than one match and no valid client hint → do not guess.
  return { employeeId: null, ambiguous: true };
}
