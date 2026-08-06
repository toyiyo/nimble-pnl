import { describe, it, expect } from 'vitest';

import {
  hasFollowUpPayload,
  isPlausibleEmail,
  MAX_EMAIL_LENGTH,
} from '../../supabase/functions/_shared/reviewContact';
import {
  canSubmitFollowUp,
  isPlausibleEmail as isPlausibleEmailClient,
} from '@/lib/reviews/reviewSubmission';

describe('isPlausibleEmail (server)', () => {
  it('accepts an ordinary address', () => {
    expect(isPlausibleEmail('ada@example.com')).toBe(true);
  });

  it('rejects an address with no dot in the domain', () => {
    expect(isPlausibleEmail('ada@localhost')).toBe(false);
  });

  it('rejects an empty value', () => {
    expect(isPlausibleEmail('   ')).toBe(false);
  });

  it('rejects a value past MAX_EMAIL_LENGTH', () => {
    expect(isPlausibleEmail(`${'a'.repeat(MAX_EMAIL_LENGTH)}@example.com`)).toBe(false);
  });
});

describe('hasFollowUpPayload', () => {
  it('allows a comment on its own', () => {
    expect(hasFollowUpPayload({ comment: 'The soup was cold', consent: false, email: '' })).toBe(
      true
    );
  });

  it('refuses a whitespace-only comment with no email', () => {
    expect(hasFollowUpPayload({ comment: '   \n  ', consent: false, email: '' })).toBe(false);
  });

  it('allows an email on its own when the guest consents', () => {
    expect(hasFollowUpPayload({ comment: '', consent: true, email: 'ada@example.com' })).toBe(
      true
    );
  });

  it('refuses a plausible email without consent', () => {
    expect(hasFollowUpPayload({ comment: '', consent: false, email: 'ada@example.com' })).toBe(
      false
    );
  });

  it('refuses consent with a malformed email and no comment', () => {
    expect(hasFollowUpPayload({ comment: '', consent: true, email: 'ada@' })).toBe(false);
  });

  it('refuses an email over MAX_EMAIL_LENGTH even with consent', () => {
    const longEmail = `${'a'.repeat(MAX_EMAIL_LENGTH)}@example.com`;
    expect(hasFollowUpPayload({ comment: '', consent: true, email: longEmail })).toBe(false);
  });
});

// This group guards the drift the module docs warn about: the client copy
// enables a button, and the server copy decides what the server writes. A
// gap between the two lets the client enable a submit the server answers
// with a 400.
describe('parity between the client and server copies', () => {
  const emails = [
    'ada@example.com',
    'ada+tag@mail.example.co.uk',
    '  ada@example.com  ',
    'ada@',
    'ada@localhost',
    'ada example.com',
    '   ',
    `${'a'.repeat(MAX_EMAIL_LENGTH)}@example.com`,
  ];

  it('isPlausibleEmail agrees on every email string', () => {
    for (const email of emails) {
      expect(isPlausibleEmail(email)).toBe(isPlausibleEmailClient(email));
    }
  });

  const inputs = [
    { comment: 'The soup was cold', consent: false, email: '' },
    { comment: '', consent: true, email: 'ada@example.com' },
    { comment: '', consent: false, email: 'ada@example.com' },
    { comment: '', consent: true, email: 'ada@' },
    { comment: '', consent: false, email: '' },
    { comment: '   \n  ', consent: false, email: '' },
    { comment: 'Great night', consent: true, email: 'ada@' },
    { comment: '', consent: true, email: `${'a'.repeat(MAX_EMAIL_LENGTH)}@example.com` },
  ];

  it('hasFollowUpPayload and canSubmitFollowUp agree on every input', () => {
    for (const input of inputs) {
      expect(hasFollowUpPayload(input)).toBe(canSubmitFollowUp(input));
    }
  });
});
