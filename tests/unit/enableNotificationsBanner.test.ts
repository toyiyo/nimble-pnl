import { describe, it, expect } from 'vitest';
import { shouldShowBanner } from '../../src/hooks/useWebPushSubscription';

// The banner component delegates show/hide logic to shouldShowBanner.
// We test that logic here. The component itself is a thin UI wrapper.

describe('EnableNotificationsBanner show/hide logic', () => {
  it('shows for supported browser with default permission', () => {
    expect(shouldShowBanner(true, 'default', false, null)).toBe(true);
  });

  it('hides when permission permanently denied', () => {
    expect(shouldShowBanner(true, 'denied', false, null)).toBe(false);
  });

  it('hides when already subscribed', () => {
    expect(shouldShowBanner(true, 'granted', true, null)).toBe(false);
  });

  it('respects 30-day dismiss window', () => {
    const recent = Date.now() - 5 * 24 * 60 * 60 * 1000;
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    expect(shouldShowBanner(true, 'default', false, recent)).toBe(false);
    expect(shouldShowBanner(true, 'default', false, old)).toBe(true);
  });
});
