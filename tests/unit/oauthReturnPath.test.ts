import { describe, it, expect, beforeEach } from 'vitest';
import {
  authorizationIdFrom,
  CONSENT_RETURN_TTL_MS,
  consentPathFor,
  peekConsentReturnPath,
  posCallbackPathFor,
  postAuthRedirectPath,
  sanitizeConsentPath,
  sanitizeReturnPath,
  saveConsentReturnPath,
  savePosCallbackReturnPath,
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

describe('authorizationIdFrom', () => {
  it('returns a safe id and rejects the rest', () => {
    expect(authorizationIdFrom(new URLSearchParams(`authorization_id=${ID}`))).toBe(ID);
    expect(authorizationIdFrom(new URLSearchParams('authorization_id=a%22b'))).toBeNull();
    expect(authorizationIdFrom(new URLSearchParams(''))).toBeNull();
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

// A real signed state is `<base64url payload>.<base64url signature>`.
const STATE = 'eyJwIjoic3F1YXJlIn0.c2lnbmF0dXJlLWJ5dGVz';
const CODE = 'sq0cgp-AbC_123-xyz';
const SQUARE_PATH = `/square/callback?code=${CODE}&state=${STATE}`;

describe('posCallbackPathFor', () => {
  it.each([
    ['square', '/square/callback'],
    ['clover', '/clover/callback'],
    ['toast', '/toast/callback'],
  ] as const)('should build the %s callback path when the code and state are safe', (provider, path) => {
    expect(posCallbackPathFor(provider, CODE, STATE)).toBe(`${path}?code=${CODE}&state=${STATE}`);
  });

  it.each([
    ['an empty code', '', STATE],
    ['a code with a slash and a dot segment', '../admin', STATE],
    ['a code with spaces', 'a b', STATE],
    ['a code longer than 1024 characters', 'a'.repeat(1025), STATE],
    ['a state with no signature part', CODE, 'eyJwIjoic3F1YXJlIn0'],
    ['a state with three parts', CODE, 'a.b.c'],
    ['a state with a URL', CODE, 'https://evil.com'],
    ['a state longer than 2048 characters', CODE, `${'a'.repeat(2048)}.b`],
  ])('should return null when it gets %s', (_label, code, state) => {
    expect(posCallbackPathFor('square', code, state)).toBeNull();
  });
});

describe('sanitizeReturnPath', () => {
  it('should accept the consent path', () => {
    expect(sanitizeReturnPath(GOOD, ORIGIN)).toBe(GOOD);
  });

  it('should rebuild a POS callback path and drop extra parameters', () => {
    expect(sanitizeReturnPath(`${SQUARE_PATH}&next=https://evil.com#x`, ORIGIN)).toBe(SQUARE_PATH);
  });

  it('should keep only code and state on a Clover callback', () => {
    expect(sanitizeReturnPath(`/clover/callback?merchant_id=M1&code=${CODE}&state=${STATE}`, ORIGIN)).toBe(
      `/clover/callback?code=${CODE}&state=${STATE}`
    );
  });

  it.each([
    ['another path', `/integrations?code=${CODE}&state=${STATE}`],
    ['a callback with no state', `/square/callback?code=${CODE}`],
    ['a callback on another origin', `https://evil.com${SQUARE_PATH}`],
    ['a protocol-relative URL', `//evil.com${SQUARE_PATH}`],
    ['a backslash', `/\\evil.com${SQUARE_PATH}`],
    ['a dot segment', `/square/../square/callback?code=${CODE}&state=${STATE}`],
    ['null', null],
  ])('should return null for %s', (_label, value) => {
    expect(sanitizeReturnPath(value, ORIGIN)).toBeNull();
  });

  it('should keep sanitizeConsentPath consent-only', () => {
    expect(sanitizeConsentPath(SQUARE_PATH, ORIGIN)).toBeNull();
  });
});

describe('POS callback return path storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should save the callback path and give it back once after sign-in', () => {
    savePosCallbackReturnPath('square', CODE, STATE, 1_000);
    expect(postAuthRedirectPath(2_000)).toBe(SQUARE_PATH);
    expect(takeConsentReturnPath(2_000)).toBe(SQUARE_PATH);
    expect(takeConsentReturnPath(3_000)).toBeNull();
  });

  it('should report true when it saves the callback path', () => {
    expect(savePosCallbackReturnPath('square', CODE, STATE, 1_000)).toBe(true);
  });

  it('should not save anything and report false when the code or state is not safe', () => {
    expect(savePosCallbackReturnPath('square', '../x', STATE, 1_000)).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('should drop the saved callback path after the TTL', () => {
    savePosCallbackReturnPath('toast', CODE, STATE, 1_000);
    expect(takeConsentReturnPath(1_000 + CONSENT_RETURN_TTL_MS + 1)).toBeNull();
  });
});
