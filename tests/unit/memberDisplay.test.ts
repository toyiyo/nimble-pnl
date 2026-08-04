import { describe, it, expect } from 'vitest';

import { memberDisplayName, memberInitials } from '@/components/roles/memberDisplay';

describe('memberDisplayName', () => {
  it('prefers the full name', () => {
    expect(memberDisplayName({ fullName: 'Ada Lovelace', email: 'ada@example.com' })).toBe(
      'Ada Lovelace'
    );
  });

  it('falls back to the email, then to a placeholder', () => {
    expect(memberDisplayName({ fullName: null, email: 'ada@example.com' })).toBe('ada@example.com');
    // Both null is reachable: useRestaurantMembers maps over memberships, so a
    // member whose profiles row RLS hides still appears in the roster.
    expect(memberDisplayName({ fullName: null, email: null })).toBe('Unnamed member');
  });

  it('treats a whitespace-only name as absent', () => {
    expect(memberDisplayName({ fullName: '   ', email: 'ada@example.com' })).toBe(
      'ada@example.com'
    );
  });
});

describe('memberInitials', () => {
  it('takes the first and last word of a name', () => {
    expect(memberInitials({ fullName: 'Ada Lovelace', email: null })).toBe('AL');
    expect(memberInitials({ fullName: 'Maria de la Cruz', email: null })).toBe('MC');
  });

  it('takes two letters from a single-word name', () => {
    expect(memberInitials({ fullName: 'Prince', email: null })).toBe('PR');
  });

  it('takes only one letter from an email', () => {
    // 'JO' from 'jose@...' would read as a surname that does not exist.
    expect(memberInitials({ fullName: null, email: 'jose@example.com' })).toBe('J');
  });

  it('never returns an empty string', () => {
    expect(memberInitials({ fullName: null, email: null })).toBe('?');
    expect(memberInitials({ fullName: '  ', email: '  ' })).toBe('?');
  });
});
