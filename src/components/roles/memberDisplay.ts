import type { RestaurantMember } from '@/hooks/useRestaurantMembers';

/**
 * How to name and abbreviate a member in the roster UI.
 *
 * Not `getInitials` from `src/utils/tipDistribution.ts:169`: that takes a name
 * string and assumes there is one. `useRestaurantMembers` maps over the
 * memberships, not the profiles (useRestaurantMembers.ts:54), so a member whose
 * `profiles` row RLS hides returns with a null name *and* a null email — a case
 * a name-only helper cannot express. Both functions here take the member and
 * degrade through the same ladder, so the pile and the row that names it never
 * disagree about who someone is.
 */

const UNNAMED = 'Unnamed member';

/** Full name, then email, then a stable placeholder. Never empty. */
export function memberDisplayName(member: Pick<RestaurantMember, 'fullName' | 'email'>): string {
  return member.fullName?.trim() || member.email?.trim() || UNNAMED;
}

/**
 * Up to two uppercase letters for an avatar.
 *
 * Takes the first and last word of a name, which reads better than the first
 * two for "Maria de la Cruz". An email has no words to split, so it
 * contributes its first character only — 'JO' from 'jose@…' would look like a
 * surname that isn't there.
 */
export function memberInitials(member: Pick<RestaurantMember, 'fullName' | 'email'>): string {
  const name = member.fullName?.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  const email = member.email?.trim();
  if (email) return email[0].toUpperCase();

  return '?';
}
