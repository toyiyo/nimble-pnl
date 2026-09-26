import { describe, it, expect, beforeEach } from 'vitest';
import {
  CONSENT_RETURN_TTL_MS,
  consentPathFor,
  peekConsentReturnPath,
  postAuthRedirectPath,
  sanitizeConsentPath,
  saveConsentReturnPath,
  takeConsentReturnPath,
} from '@/lib/oauthReturnPath';

const ORIGIN = 'https://app.easyshifthq.com';
const ID = '3f1c2b9e-5d4a-4c1e-9b7a-2e8f6d0c1a42';
const GOOD = `/oauth/consent?authorization_id=${ID}`;

describe('sanitizeConsentPath', () => {
  it('accepts the consent path with an authorization_id', () => {
    expect(sanitizeConsentPath(GOOD, ORIGIN)).toBe(GOOD);
  });

  it('keeps only authorization_id and rebuilds the path', () => {
    expect(sanitizeConsentPath(`${GOOD}&next=https://evil.com#frag`, ORIGIN)).toBe(GOOD);
  });

  it.each([
    ['protocol-relative host', `//evil.com${GOOD}`],
    ['backslash host', `/\\evil.com${GOOD}`],
    ['absolute other origin', `https://evil.com${GOOD}`],
    ['javascript scheme', 'javascript:alert(1)'],
    ['dot segments', `/oauth/consent/..?authorization_id=${ID}`],
    ['longer path', `/oauth/consentx?authorization_id=${ID}`],
    ['sub path', `/oauth/consent/x?authorization_id=${ID}`],
    ['root', '/'],
    ['missing id', '/oauth/consent'],
    ['bad id characters', '/oauth/consent?authorization_id=a%22%3E%3Cscript%3E'],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    expect(sanitizeConsentPath(value, ORIGIN)).toBeNull();
  });

  it('accepts an absolute URL on the same origin', () => {
    expect(sanitizeConsentPath(`${ORIGIN}${GOOD}`, ORIGIN)).toBe(GOOD);
  });

  it('rejects a value that is not a string', () => {
    expect(sanitizeConsentPath(null, ORIGIN)).toBeNull();
    expect(sanitizeConsentPath(42 as unknown as string, ORIGIN)).toBeNull();
  });
});

describe('consentPathFor', () => {
  it('builds the consent path for an id', () => {
    expect(consentPathFor(ID)).toBe(GOOD);
  });
});

describe('return path storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves a path and takes it once', () => {
    saveConsentReturnPath(GOOD, 1_000);
    expect(takeConsentReturnPath(2_000)).toBe(GOOD);
    expect(takeConsentReturnPath(3_000)).toBeNull();
  });

  it('peeks without delete', () => {
    saveConsentReturnPath(GOOD, 1_000);
    expect(peekConsentReturnPath(2_000)).toBe(GOOD);
    expect(peekConsentReturnPath(2_000)).toBe(GOOD);
  });

  it('ignores and deletes an expired path', () => {
    saveConsentReturnPath(GOOD, 1_000);
    expect(takeConsentReturnPath(1_000 + CONSENT_RETURN_TTL_MS + 1)).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('does not save a path that fails the check', () => {
    saveConsentReturnPath('https://evil.com/', 1_000);
    expect(localStorage.length).toBe(0);
  });

  it('ignores a stored value that was changed to a bad path', () => {
    saveConsentReturnPath(GOOD, 1_000);
    const key = localStorage.key(0)!;
    localStorage.setItem(key, JSON.stringify({ path: '//evil.com', savedAt: 1_000 }));
    expect(takeConsentReturnPath(2_000)).toBeNull();
  });

  it('ignores a stored value that is not JSON', () => {
    saveConsentReturnPath(GOOD, 1_000);
    localStorage.setItem(localStorage.key(0)!, 'not json');
    expect(peekConsentReturnPath(2_000)).toBeNull();
  });

  it('postAuthRedirectPath gives the saved path or /', () => {
    expect(postAuthRedirectPath(1_000)).toBe('/');
    saveConsentReturnPath(GOOD, 1_000);
    expect(postAuthRedirectPath(2_000)).toBe(GOOD);
  });
});
