import { describe, it, expect } from 'vitest';
import {
  resolveAccountlessEmployeeLink,
  normalizeEmail,
  type AccountlessEmployeeRow,
} from '../../supabase/functions/_shared/resolveAccountlessEmployeeLink';

const emp = (id: string, email: string | null, name = id): AccountlessEmployeeRow => ({
  id,
  name,
  email,
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  John@Example.COM ')).toBe('john@example.com');
  });
});

describe('resolveAccountlessEmployeeLink', () => {
  it('links the single email match', () => {
    const rows = [emp('e1', 'dana@x.com'), emp('e2', 'other@x.com')];
    expect(resolveAccountlessEmployeeLink(rows, 'dana@x.com')).toEqual({
      employeeId: 'e1',
      ambiguous: false,
    });
  });

  it('matches case-insensitively and trims both sides', () => {
    const rows = [emp('e1', '  Dana@X.com ')];
    expect(resolveAccountlessEmployeeLink(rows, 'DANA@x.COM')).toEqual({
      employeeId: 'e1',
      ambiguous: false,
    });
  });

  it('returns no link when nothing matches', () => {
    const rows = [emp('e1', 'someone@x.com')];
    expect(resolveAccountlessEmployeeLink(rows, 'nobody@x.com')).toEqual({
      employeeId: null,
      ambiguous: false,
    });
  });

  it('fails open (no link) for null/undefined/empty employee sets', () => {
    for (const rows of [null, undefined, []] as const) {
      expect(resolveAccountlessEmployeeLink(rows, 'dana@x.com')).toEqual({
        employeeId: null,
        ambiguous: false,
      });
    }
  });

  it('ignores rows with a null email without throwing', () => {
    const rows = [emp('e1', null), emp('e2', 'dana@x.com')];
    expect(resolveAccountlessEmployeeLink(rows, 'dana@x.com')).toEqual({
      employeeId: 'e2',
      ambiguous: false,
    });
  });

  describe('duplicate emails (undefined PostgREST order)', () => {
    const dupes = [emp('e1', 'dana@x.com'), emp('e2', 'dana@x.com')];

    it('is ambiguous and links nothing when the client hint is absent', () => {
      expect(resolveAccountlessEmployeeLink(dupes, 'dana@x.com')).toEqual({
        employeeId: null,
        ambiguous: true,
      });
    });

    it('is ambiguous when the client hint matches no email-matched row', () => {
      expect(resolveAccountlessEmployeeLink(dupes, 'dana@x.com', 'e-unrelated')).toEqual({
        employeeId: null,
        ambiguous: true,
      });
    });

    it('disambiguates to the exact client-hinted row', () => {
      expect(resolveAccountlessEmployeeLink(dupes, 'dana@x.com', 'e2')).toEqual({
        employeeId: 'e2',
        ambiguous: false,
      });
    });
  });

  describe('client hint validation (no id-only trust)', () => {
    it('ignores a hint id whose email does not match the invitation email', () => {
      // e-arb is accountless in the restaurant but belongs to a different email.
      const rows = [emp('e-arb', 'arbitrary@x.com'), emp('e1', 'dana@x.com')];
      // Hint points at e-arb, but the invite is for dana@x.com → hint rejected,
      // resolution falls through to the real single email match.
      expect(resolveAccountlessEmployeeLink(rows, 'dana@x.com', 'e-arb')).toEqual({
        employeeId: 'e1',
        ambiguous: false,
      });
    });

    it('does not fabricate a link from a hint when no email matches at all', () => {
      const rows = [emp('e-arb', 'arbitrary@x.com')];
      expect(resolveAccountlessEmployeeLink(rows, 'dana@x.com', 'e-arb')).toEqual({
        employeeId: null,
        ambiguous: false,
      });
    });
  });
});
