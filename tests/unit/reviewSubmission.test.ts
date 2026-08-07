import { describe, it, expect } from 'vitest';

import {
  canSubmitFollowUp,
  isPlausibleEmail,
  MAX_EMAIL_LENGTH,
} from '@/lib/reviews/reviewSubmission';

describe('isPlausibleEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isPlausibleEmail('ada@example.com')).toBe(true);
  });

  it('accepts a subdomain and a plus tag', () => {
    expect(isPlausibleEmail('ada+tag@mail.example.co.uk')).toBe(true);
  });

  it('trims before it checks', () => {
    expect(isPlausibleEmail('  ada@example.com  ')).toBe(true);
  });

  it('rejects an address with no domain', () => {
    expect(isPlausibleEmail('ada@')).toBe(false);
  });

  it('rejects an address with no dot in the domain', () => {
    expect(isPlausibleEmail('ada@localhost')).toBe(false);
  });

  it('rejects an address with a space', () => {
    expect(isPlausibleEmail('ada example.com')).toBe(false);
  });

  it('rejects an empty value', () => {
    expect(isPlausibleEmail('   ')).toBe(false);
  });

  it('rejects a value past the 320-character server limit', () => {
    // The server slices at 320. A longer value would arrive truncated, so a
    // client that calls it valid enables a button the server then rejects.
    expect(isPlausibleEmail(`${'a'.repeat(320)}@example.com`)).toBe(false);
  });

  it('accepts an email exactly MAX_EMAIL_LENGTH characters long', () => {
    const domain = '@example.com';
    const email = `${'a'.repeat(MAX_EMAIL_LENGTH - domain.length)}${domain}`;
    expect(email.length).toBe(MAX_EMAIL_LENGTH);
    expect(isPlausibleEmail(email)).toBe(true);
  });

  it('rejects an email one character past MAX_EMAIL_LENGTH', () => {
    const domain = '@example.com';
    const email = `${'a'.repeat(MAX_EMAIL_LENGTH + 1 - domain.length)}${domain}`;
    expect(email.length).toBe(MAX_EMAIL_LENGTH + 1);
    expect(isPlausibleEmail(email)).toBe(false);
  });
});

describe('canSubmitFollowUp', () => {
  it('allows a comment on its own', () => {
    expect(canSubmitFollowUp({ comment: 'The soup was cold', consent: false, email: '' })).toBe(
      true
    );
  });

  it('allows an email on its own when the guest consents', () => {
    expect(canSubmitFollowUp({ comment: '', consent: true, email: 'ada@example.com' })).toBe(true);
  });

  it('refuses an email without consent', () => {
    // Consent false means the server discards the value. A button that sends
    // it promises the guest a reply the restaurant never gets.
    expect(canSubmitFollowUp({ comment: '', consent: false, email: 'ada@example.com' })).toBe(
      false
    );
  });

  it('refuses a malformed email with no comment', () => {
    expect(canSubmitFollowUp({ comment: '', consent: true, email: 'ada@' })).toBe(false);
  });

  it('refuses an empty form', () => {
    expect(canSubmitFollowUp({ comment: '', consent: false, email: '' })).toBe(false);
  });

  it('refuses a whitespace-only comment with no email', () => {
    expect(canSubmitFollowUp({ comment: '   \n  ', consent: false, email: '' })).toBe(false);
  });

  it('allows a malformed email when the guest also writes a comment', () => {
    // The comment alone is enough. A typo in an optional field must not block
    // the note the guest came to leave.
    expect(canSubmitFollowUp({ comment: 'Great night', consent: true, email: 'ada@' })).toBe(true);
  });
});
