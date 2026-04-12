import { describe, it, expect } from 'vitest';

/**
 * Test the helper functions used by useWebPushSubscription.
 * The hook itself depends on browser APIs (navigator.serviceWorker, PushManager),
 * so we test the pure logic separately.
 */

function isWebPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function shouldShowBanner(
  isSupported: boolean,
  permission: NotificationPermission | null,
  isSubscribed: boolean,
  dismissedAt: number | null
): boolean {
  if (!isSupported) return false;
  if (permission === 'denied') return false;
  if (isSubscribed) return false;
  if (dismissedAt) {
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - dismissedAt < thirtyDaysMs) return false;
  }
  return true;
}

export { isWebPushSupported, shouldShowBanner };

describe('isWebPushSupported', () => {
  it('returns false in non-browser environment', () => {
    // vitest runs in jsdom which has window but not serviceWorker/PushManager
    const result = isWebPushSupported();
    expect(result).toBe(false);
  });
});

describe('shouldShowBanner', () => {
  it('shows banner when supported, default permission, not subscribed, not dismissed', () => {
    expect(shouldShowBanner(true, 'default', false, null)).toBe(true);
  });

  it('shows banner when permission is granted but not yet subscribed', () => {
    expect(shouldShowBanner(true, 'granted', false, null)).toBe(true);
  });

  it('hides banner when not supported', () => {
    expect(shouldShowBanner(false, 'default', false, null)).toBe(false);
  });

  it('hides banner when permission is denied', () => {
    expect(shouldShowBanner(true, 'denied', false, null)).toBe(false);
  });

  it('hides banner when already subscribed', () => {
    expect(shouldShowBanner(true, 'default', true, null)).toBe(false);
  });

  it('hides banner when dismissed less than 30 days ago', () => {
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
    expect(shouldShowBanner(true, 'default', false, tenDaysAgo)).toBe(false);
  });

  it('shows banner when dismissed more than 30 days ago', () => {
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
    expect(shouldShowBanner(true, 'default', false, fortyDaysAgo)).toBe(true);
  });
});
