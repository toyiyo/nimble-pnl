import { describe, it, expect } from 'vitest';

/**
 * Validate the subscription payload shape expected by the manage-web-push-subscription
 * edge function. The actual edge function runs in Deno, so we test the validation logic
 * that will be shared with the frontend hook.
 */

interface PushSubscriptionPayload {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  restaurant_id: string;
}

function validateSubscriptionPayload(
  payload: unknown
): payload is PushSubscriptionPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  if (typeof p.endpoint !== 'string' || !p.endpoint.startsWith('https://')) return false;
  if (!p.keys || typeof p.keys !== 'object') return false;
  const keys = p.keys as Record<string, unknown>;
  if (typeof keys.p256dh !== 'string' || keys.p256dh.length === 0) return false;
  if (typeof keys.auth !== 'string' || keys.auth.length === 0) return false;
  if (typeof p.restaurant_id !== 'string' || p.restaurant_id.length === 0) return false;
  return true;
}

// Export for reuse in the frontend hook
export { validateSubscriptionPayload };
export type { PushSubscriptionPayload };

describe('validateSubscriptionPayload', () => {
  it('accepts a valid subscription payload', () => {
    const valid = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: { p256dh: 'BNcRd...base64', auth: 'tBHI...base64' },
      restaurant_id: '550e8400-e29b-41d4-a716-446655440000',
    };
    expect(validateSubscriptionPayload(valid)).toBe(true);
  });

  it('rejects null', () => {
    expect(validateSubscriptionPayload(null)).toBe(false);
  });

  it('rejects missing endpoint', () => {
    const invalid = {
      keys: { p256dh: 'abc', auth: 'def' },
      restaurant_id: 'uuid',
    };
    expect(validateSubscriptionPayload(invalid)).toBe(false);
  });

  it('rejects non-https endpoint', () => {
    const invalid = {
      endpoint: 'http://insecure.example.com',
      keys: { p256dh: 'abc', auth: 'def' },
      restaurant_id: 'uuid',
    };
    expect(validateSubscriptionPayload(invalid)).toBe(false);
  });

  it('rejects missing keys', () => {
    const invalid = {
      endpoint: 'https://push.example.com',
      restaurant_id: 'uuid',
    };
    expect(validateSubscriptionPayload(invalid)).toBe(false);
  });

  it('rejects empty p256dh key', () => {
    const invalid = {
      endpoint: 'https://push.example.com',
      keys: { p256dh: '', auth: 'def' },
      restaurant_id: 'uuid',
    };
    expect(validateSubscriptionPayload(invalid)).toBe(false);
  });

  it('rejects missing restaurant_id', () => {
    const invalid = {
      endpoint: 'https://push.example.com',
      keys: { p256dh: 'abc', auth: 'def' },
    };
    expect(validateSubscriptionPayload(invalid)).toBe(false);
  });
});
