import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ATTRIBUTION_STORAGE_KEY,
  INTERNAL_DOMAINS,
  NEW_SIGNUP_WINDOW_MS,
  TRIAL_DURATION_DAYS,
  accountCreatedFlagKey,
  clearStoredAttribution,
  firstPnlViewedFlagKey,
  getStoredAttribution,
  isInternalEmail,
  posIntegrationCompletedFlagKey,
  recordAuthEvents,
  recordFirstPnlViewed,
  recordPosIntegrationCompleted,
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

  it('matches subdomain emails (e.g. user@mail.easyshifthq.com)', () => {
    expect(isInternalEmail('jose@mail.easyshifthq.com')).toBe(true);
    expect(isInternalEmail('jose@app.easyshifthq.com')).toBe(true);
  });

  it('does NOT false-match domains that merely contain the internal domain', () => {
    // '@evil-easyshifthq.com' ends with 'easyshifthq.com' but is a different host
    expect(isInternalEmail('attacker@evil-easyshifthq.com')).toBe(false);
    expect(isInternalEmail('attacker@notreallyeasyshifthq.com')).toBe(false);
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

  it('preserves first-touch when an OAuth callback arrives with referrer but no UTM', () => {
    // Simulate user landing first with UTM:
    storeAttribution('?utm_source=google&utm_medium=cpc', '', '/auth');
    const first = getStoredAttribution();

    // Then an OAuth provider redirect (e.g. ?code=… and referrer=accounts.google.com)
    // arrives without any UTM. We should NOT clobber the original UTM-based
    // attribution with a referrer that just describes the OAuth hop.
    storeAttribution('?code=abc123', 'https://accounts.google.com', '/auth');
    const second = getStoredAttribution();

    expect(second?.utm_source).toBe('google');
    expect(second?.utm_medium).toBe('cpc');
    expect(second?.captured_at).toBe(first?.captured_at);
  });

  it('treats utm_term / utm_content as fresh UTM and overwrites earlier referrer-only entry', () => {
    // Earlier: only referrer captured.
    storeAttribution('', 'https://google.com', '/auth');
    const first = getStoredAttribution();
    expect(first?.utm_source).toBeNull();
    expect(first?.referrer).toBe('https://google.com');

    // Later: hits with utm_term only (no source/medium/campaign). hasUtm should
    // still trigger a write because utm_term/utm_content count as fresh data —
    // proving fresh write by the referrer being overwritten to ''.
    storeAttribution('?utm_term=brand', '', '/auth');
    const second = getStoredAttribution();
    expect(second?.utm_source).toBeNull();
    expect(second?.referrer).toBe('');
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

describe('recordAuthEvents', () => {
  const FIXED_NOW = new Date('2026-05-07T12:00:00Z');
  const RECENT_CREATED_AT = new Date(FIXED_NOW.getTime() - 30_000).toISOString();
  const OLD_CREATED_AT = new Date(FIXED_NOW.getTime() - NEW_SIGNUP_WINDOW_MS - 1).toISOString();

  let posthog: { identify: ReturnType<typeof vi.fn>; capture: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();
    posthog = { identify: vi.fn(), capture: vi.fn() };
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('fires identify + account_created + trial_started for a fresh signup', () => {
    storeAttribution('?utm_source=google&utm_medium=cpc&utm_campaign=launch', '', '/auth');

    recordAuthEvents({
      userId: 'user-1',
      email: 'jose@example.com',
      createdAt: RECENT_CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.identify).toHaveBeenCalledTimes(1);
    expect(posthog.identify).toHaveBeenCalledWith('user-1', expect.objectContaining({
      signup_source: 'google',
      signup_medium: 'cpc',
      signup_campaign: 'launch',
      is_internal: false,
    }));
    // PII: email is NOT forwarded to PostHog
    const identifyProps = posthog.identify.mock.calls[0][1];
    expect(identifyProps).not.toHaveProperty('email');

    expect(posthog.capture).toHaveBeenCalledTimes(2);
    expect(posthog.capture).toHaveBeenCalledWith('account_created');
    const trialEndsAt = new Date(FIXED_NOW.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    expect(posthog.capture).toHaveBeenCalledWith('trial_started', { trial_ends_at: trialEndsAt });

    expect(localStorage.getItem(accountCreatedFlagKey('user-1'))).toBeTruthy();
    expect(localStorage.getItem(ATTRIBUTION_STORAGE_KEY)).toBeNull();
  });

  it('marks @easyshifthq.com users as is_internal:true', () => {
    recordAuthEvents({
      userId: 'user-internal',
      email: 'jose@easyshifthq.com',
      createdAt: RECENT_CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.identify).toHaveBeenCalledWith('user-internal', expect.objectContaining({
      is_internal: true,
    }));
  });

  it('falls back to referrer when UTM is absent', () => {
    storeAttribution('', 'https://google.com', '/auth');

    recordAuthEvents({
      userId: 'user-2',
      email: 'jose@example.com',
      createdAt: RECENT_CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.identify).toHaveBeenCalledWith('user-2', expect.objectContaining({
      signup_source: 'https://google.com',
      signup_medium: 'organic',
    }));
  });

  it('uses "direct" / "organic" when no attribution stored', () => {
    recordAuthEvents({
      userId: 'user-3',
      email: 'jose@example.com',
      createdAt: RECENT_CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.identify).toHaveBeenCalledWith('user-3', expect.objectContaining({
      signup_source: 'direct',
      signup_medium: 'organic',
      signup_campaign: null,
    }));
  });

  it('does not double-fire account_created if the flag is set', () => {
    localStorage.setItem(accountCreatedFlagKey('user-4'), '1');

    recordAuthEvents({
      userId: 'user-4',
      email: 'jose@example.com',
      createdAt: RECENT_CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.capture).not.toHaveBeenCalledWith('account_created', expect.anything());
    expect(posthog.capture).not.toHaveBeenCalledWith('trial_started', expect.anything());
    // Returning users still get an identify with last_login_at
    expect(posthog.identify).toHaveBeenCalledWith('user-4', expect.objectContaining({
      last_login_at: expect.any(String),
    }));
  });

  it('treats users with old created_at as returning users (only last_login_at)', () => {
    recordAuthEvents({
      userId: 'user-5',
      email: 'jose@example.com',
      createdAt: OLD_CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.identify).toHaveBeenCalledTimes(1);
    expect(posthog.identify).toHaveBeenCalledWith('user-5', expect.objectContaining({
      last_login_at: FIXED_NOW.toISOString(),
    }));
  });

  it('does nothing when userId is empty', () => {
    recordAuthEvents({
      userId: '',
      email: 'jose@example.com',
      createdAt: RECENT_CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.identify).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('handles missing email gracefully (still identifies, is_internal:false)', () => {
    recordAuthEvents({
      userId: 'user-6',
      email: null,
      createdAt: RECENT_CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.identify).toHaveBeenCalledWith('user-6', expect.objectContaining({
      is_internal: false,
    }));
    // PII: email is NOT forwarded to PostHog even when null
    const identifyProps = posthog.identify.mock.calls[0][1];
    expect(identifyProps).not.toHaveProperty('email');
    expect(posthog.capture).toHaveBeenCalledWith('account_created');
  });

  it('survives if posthog.capture throws (no rethrow)', () => {
    posthog.capture = vi.fn(() => {
      throw new Error('posthog blew up');
    });

    expect(() => recordAuthEvents({
      userId: 'user-7',
      email: 'jose@example.com',
      createdAt: RECENT_CREATED_AT,
      posthog,
      now: FIXED_NOW,
    })).not.toThrow();
  });

  it('does not re-fire account_created if trial_started capture throws (atomic dedup)', () => {
    // Simulate: account_created succeeds, trial_started throws.
    let callCount = 0;
    posthog.capture = vi.fn(() => {
      callCount += 1;
      if (callCount === 2) throw new Error('posthog blew up on second call');
    });

    recordAuthEvents({
      userId: 'user-partial-fail',
      email: 'jose@example.com',
      createdAt: RECENT_CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    // Flag must be set even though trial_started threw, so the next call
    // within the 5-min window does not re-fire account_created.
    expect(localStorage.getItem(accountCreatedFlagKey('user-partial-fail'))).toBeTruthy();

    // Second call: should treat user as returning (no account_created).
    posthog.capture = vi.fn();
    recordAuthEvents({
      userId: 'user-partial-fail',
      email: 'jose@example.com',
      createdAt: RECENT_CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });
    expect(posthog.capture).not.toHaveBeenCalledWith('account_created', expect.anything());
    expect(posthog.capture).not.toHaveBeenCalledWith('account_created');
  });
});

describe('recordPosIntegrationCompleted', () => {
  const FIXED_NOW = new Date('2026-05-07T12:00:00Z');
  const CREATED_AT = new Date(FIXED_NOW.getTime() - 90_000).toISOString(); // 90s earlier

  let posthog: { identify: ReturnType<typeof vi.fn>; capture: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();
    posthog = { identify: vi.fn(), capture: vi.fn() };
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('captures pos_integration_completed with provider and seconds_from_trial_start', () => {
    recordPosIntegrationCompleted({
      userId: 'user-pos-1',
      posProvider: 'square',
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.capture).toHaveBeenCalledTimes(1);
    expect(posthog.capture).toHaveBeenCalledWith('pos_integration_completed', {
      pos_provider: 'square',
      seconds_from_trial_start: 90,
    });
    expect(localStorage.getItem(posIntegrationCompletedFlagKey('user-pos-1', 'square'))).toBeTruthy();
  });

  it('handles missing userCreatedAt by sending null seconds_from_trial_start', () => {
    recordPosIntegrationCompleted({
      userId: 'user-pos-2',
      posProvider: 'toast',
      userCreatedAt: null,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.capture).toHaveBeenCalledWith('pos_integration_completed', {
      pos_provider: 'toast',
      seconds_from_trial_start: null,
    });
  });

  it('survives if posthog.capture throws (no rethrow)', () => {
    posthog.capture = vi.fn(() => {
      throw new Error('posthog blew up');
    });

    expect(() => recordPosIntegrationCompleted({
      userId: 'user-pos-3',
      posProvider: 'clover',
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    })).not.toThrow();
  });

  it('floors fractional seconds', () => {
    const createdAt = new Date(FIXED_NOW.getTime() - 1_500).toISOString(); // 1.5s ago
    recordPosIntegrationCompleted({
      userId: 'user-pos-4',
      posProvider: 'square',
      userCreatedAt: createdAt,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.capture).toHaveBeenCalledWith('pos_integration_completed', {
      pos_provider: 'square',
      seconds_from_trial_start: 1,
    });
  });

  it('does not double-fire when the per-(user, provider) flag is already set', () => {
    localStorage.setItem(posIntegrationCompletedFlagKey('user-pos-dup', 'square'), '1');

    recordPosIntegrationCompleted({
      userId: 'user-pos-dup',
      posProvider: 'square',
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('does nothing when userId is empty', () => {
    recordPosIntegrationCompleted({
      userId: '',
      posProvider: 'square',
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('does NOT set the flag if capture throws, so a retry can succeed later', () => {
    posthog.capture = vi.fn(() => {
      throw new Error('posthog blew up');
    });

    recordPosIntegrationCompleted({
      userId: 'user-pos-retry',
      posProvider: 'toast',
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(localStorage.getItem(posIntegrationCompletedFlagKey('user-pos-retry', 'toast'))).toBeNull();

    // Retry: capture works this time.
    posthog.capture = vi.fn();
    recordPosIntegrationCompleted({
      userId: 'user-pos-retry',
      posProvider: 'toast',
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });
    expect(posthog.capture).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(posIntegrationCompletedFlagKey('user-pos-retry', 'toast'))).toBeTruthy();
  });

  it('keeps per-provider dedup independent (square does not block toast)', () => {
    recordPosIntegrationCompleted({
      userId: 'user-pos-multi',
      posProvider: 'square',
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });
    expect(posthog.capture).toHaveBeenCalledTimes(1);

    // Different provider for the same user — should still fire.
    recordPosIntegrationCompleted({
      userId: 'user-pos-multi',
      posProvider: 'toast',
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });
    expect(posthog.capture).toHaveBeenCalledTimes(2);
    expect(posthog.capture).toHaveBeenLastCalledWith('pos_integration_completed', expect.objectContaining({
      pos_provider: 'toast',
    }));
  });
});

describe('recordFirstPnlViewed', () => {
  const FIXED_NOW = new Date('2026-05-07T12:00:00Z');
  const CREATED_AT = new Date(FIXED_NOW.getTime() - 120_000).toISOString(); // 120s earlier

  let posthog: { identify: ReturnType<typeof vi.fn>; capture: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();
    posthog = { identify: vi.fn(), capture: vi.fn() };
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('fires first_pnl_viewed once with seconds_from_trial_start and has_real_data:true', () => {
    recordFirstPnlViewed({
      userId: 'user-pnl-1',
      hasRealData: true,
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.capture).toHaveBeenCalledTimes(1);
    expect(posthog.capture).toHaveBeenCalledWith('first_pnl_viewed', {
      seconds_from_trial_start: 120,
      has_real_data: true,
    });
    expect(localStorage.getItem(firstPnlViewedFlagKey('user-pnl-1'))).toBeTruthy();
  });

  it('does not double-fire when flag is already set', () => {
    localStorage.setItem(firstPnlViewedFlagKey('user-pnl-2'), '1');

    recordFirstPnlViewed({
      userId: 'user-pnl-2',
      hasRealData: true,
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('passes has_real_data:false when there is no revenue yet', () => {
    recordFirstPnlViewed({
      userId: 'user-pnl-3',
      hasRealData: false,
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.capture).toHaveBeenCalledWith('first_pnl_viewed', expect.objectContaining({
      has_real_data: false,
    }));
  });

  it('handles missing userCreatedAt by sending null seconds_from_trial_start', () => {
    recordFirstPnlViewed({
      userId: 'user-pnl-4',
      hasRealData: true,
      userCreatedAt: null,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.capture).toHaveBeenCalledWith('first_pnl_viewed', {
      seconds_from_trial_start: null,
      has_real_data: true,
    });
  });

  it('does nothing when userId is empty', () => {
    recordFirstPnlViewed({
      userId: '',
      hasRealData: true,
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('survives if posthog.capture throws (no rethrow)', () => {
    posthog.capture = vi.fn(() => {
      throw new Error('posthog blew up');
    });

    expect(() => recordFirstPnlViewed({
      userId: 'user-pnl-5',
      hasRealData: true,
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    })).not.toThrow();
  });

  it('does NOT set the flag if capture throws, so a retry can succeed later', () => {
    posthog.capture = vi.fn(() => {
      throw new Error('posthog blew up');
    });

    recordFirstPnlViewed({
      userId: 'user-pnl-retry',
      hasRealData: true,
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });

    // Flag must NOT be set on capture failure, so the next view can retry.
    expect(localStorage.getItem(firstPnlViewedFlagKey('user-pnl-retry'))).toBeNull();

    // Retry: capture works this time. Event fires and flag is set.
    posthog.capture = vi.fn();
    recordFirstPnlViewed({
      userId: 'user-pnl-retry',
      hasRealData: true,
      userCreatedAt: CREATED_AT,
      posthog,
      now: FIXED_NOW,
    });
    expect(posthog.capture).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(firstPnlViewedFlagKey('user-pnl-retry'))).toBeTruthy();
  });
});
