/**
 * Compute age in whole years from a date-of-birth string (YYYY-MM-DD).
 *
 * Uses UTC date components throughout so results are consistent regardless of
 * the server/browser timezone. The DOB is parsed as UTC midnight (ISO T00:00:00Z)
 * and compared against today's UTC date.
 */
export function computeAge(dateOfBirth: string): number {
  const today = new Date();
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < dob.getUTCDate())) {
    age--;
  }
  return age;
}

/**
 * Returns true if the employee is under 18 based on their DOB.
 */
export function isMinor(dateOfBirth: string | null | undefined): boolean {
  if (!dateOfBirth) return false;
  return computeAge(dateOfBirth) < 18;
}
