import { describe, it, expect } from 'vitest';
import { findMemberByEmail, type RestaurantMember } from '@/hooks/useRestaurantMembers';

const members: RestaurantMember[] = [
  { userId: 'u1', email: 'Alexis@Rushbowls.com', fullName: 'Alexis Sanchez', role: 'manager' },
  { userId: 'u2', email: 'book@cpa.example', fullName: 'Dana Books', role: 'collaborator_accountant' },
  { userId: 'u3', email: null, fullName: 'No Email', role: 'staff' },
];

describe('findMemberByEmail', () => {
  it('matches case-insensitively — profiles.email is TEXT, not CITEXT', () => {
    expect(findMemberByEmail(members, 'alexis@rushbowls.com')?.userId).toBe('u1');
    expect(findMemberByEmail(members, 'ALEXIS@RUSHBOWLS.COM')?.userId).toBe('u1');
  });

  it('trims surrounding whitespace', () => {
    expect(findMemberByEmail(members, '  book@cpa.example  ')?.userId).toBe('u2');
  });

  it('returns null for a non-member', () => {
    expect(findMemberByEmail(members, 'stranger@example.com')).toBeNull();
  });

  it('returns null for blank input', () => {
    expect(findMemberByEmail(members, '')).toBeNull();
    expect(findMemberByEmail(members, '   ')).toBeNull();
  });

  it('fails open while the roster is loading or errored', () => {
    // undefined members must never read as "match found" — the callers use a
    // null result to mean "proceed normally".
    expect(findMemberByEmail(undefined, 'alexis@rushbowls.com')).toBeNull();
  });

  it('ignores members with no email rather than matching them', () => {
    expect(findMemberByEmail(members, '')).toBeNull();
    expect(members.some((m) => m.email === null)).toBe(true);
  });
});
