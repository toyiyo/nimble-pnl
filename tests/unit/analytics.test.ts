import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ATTRIBUTION_STORAGE_KEY,
  INTERNAL_DOMAINS,
  clearStoredAttribution,
  getStoredAttribution,
  isInternalEmail,
  storeAttribution,
} from '../../src/lib/analytics';

describe('isInternalEmail', () => {
  it('returns true for @easyshifthq.com', () => {
    expect(isInternalEmail('jose@easyshifthq.com')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isInternalEmail('Jose@EasyShiftHQ.com')).toBe(true);
  });

  it('returns false for other domains', () => {
    expect(isInternalEmail('jose@example.com')).toBe(false);
    expect(isInternalEmail('jose@gmail.com')).toBe(false);
  });

  it('returns false for null/undefined/empty', () => {
    expect(isInternalEmail(null)).toBe(false);
    expect(isInternalEmail(undefined)).toBe(false);
    expect(isInternalEmail('')).toBe(false);
  });

  it('returns false for malformed emails', () => {
    expect(isInternalEmail('not-an-email')).toBe(false);
    expect(isInternalEmail('foo@')).toBe(false);
  });

  it('exposes INTERNAL_DOMAINS as a readonly array', () => {
    expect(INTERNAL_DOMAINS).toContain('@easyshifthq.com');
  });
});

describe('storeAttribution / getStoredAttribution / clearStoredAttribution', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('writes UTM params, referrer, and landing page', () => {
    storeAttribution(
      '?utm_source=google&utm_medium=cpc&utm_campaign=launch',
      'https://google.com/search',
      '/auth',
    );

    const stored = getStoredAttribution();
    expect(stored).not.toBeNull();
    expect(stored?.utm_source).toBe('google');
    expect(stored?.utm_medium).toBe('cpc');
    expect(stored?.utm_campaign).toBe('launch');
    expect(stored?.referrer).toBe('https://google.com/search');
    expect(stored?.landing_page).toBe('/auth');
    expect(stored?.captured_at).toBeTruthy();
  });

  it('does not write when there is no UTM and no referrer', () => {
    storeAttribution('', '', '/auth');
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
  });

  it('writes when only referrer is present', () => {
    storeAttribution('', 'https://google.com', '/auth');
    const stored = getStoredAttribution();
    expect(stored?.referrer).toBe('https://google.com');
    expect(stored?.utm_source).toBeNull();
  });

  it('writes when only one UTM param is present', () => {
    storeAttribution('?utm_source=twitter', '', '/auth');
    const stored = getStoredAttribution();
    expect(stored?.utm_source).toBe('twitter');
    expect(stored?.utm_medium).toBeNull();
  });

  it('does not clobber existing attribution when called again with no fresh data', () => {
    storeAttribution('?utm_source=google', '', '/auth');
    const first = getStoredAttribution();

    storeAttribution('', '', '/dashboard');
    const second = getStoredAttribution();

    expect(second?.utm_source).toBe('google');
    expect(second?.captured_at).toBe(first?.captured_at);
  });

  it('returns null when key missing', () => {
    expect(getStoredAttribution()).toBeNull();
  });

  it('returns null when value is malformed JSON (does not throw)', () => {
    localStorage.setItem(ATTRIBUTION_STORAGE_KEY, '{not json');
    expect(() => getStoredAttribution()).not.toThrow();
    expect(getStoredAttribution()).toBeNull();
  });

  it('clearStoredAttribution removes the key', () => {
    storeAttribution('?utm_source=google', '', '/auth');
    expect(getStoredAttribution()).not.toBeNull();
    clearStoredAttribution();
    expect(getStoredAttribution()).toBeNull();
  });

  it('survives a localStorage that throws on setItem (no rethrow)', () => {
    const original = Storage.prototype.setItem;
    const setItemMock = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => storeAttribution('?utm_source=google', '', '/auth')).not.toThrow();
    setItemMock.mockRestore();
    Storage.prototype.setItem = original;
  });
});
