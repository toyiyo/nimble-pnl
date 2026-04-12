import { describe, it, expect } from 'vitest';

/**
 * Test the push payload parsing logic used by the service worker.
 * The actual service worker runs in browser context, but we can test
 * the payload parsing as a pure function.
 */

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  tag?: string;
}

function parsePushPayload(jsonString: string): PushPayload | null {
  try {
    const data = JSON.parse(jsonString);
    if (!data.title || !data.body) return null;
    return {
      title: data.title,
      body: data.body,
      icon: data.icon || '/icon-192.png',
      url: data.url || '/',
      tag: data.tag,
    };
  } catch {
    return null;
  }
}

// This function is duplicated in sw.js (service workers can't import modules).
// Keep them in sync.
export { parsePushPayload };

describe('parsePushPayload', () => {
  it('parses a valid payload with all fields', () => {
    const json = JSON.stringify({
      title: 'New Shift',
      body: 'Mon 8am-4pm',
      icon: '/custom-icon.png',
      url: '/schedule',
      tag: 'shift-123',
    });
    const result = parsePushPayload(json);
    expect(result).toEqual({
      title: 'New Shift',
      body: 'Mon 8am-4pm',
      icon: '/custom-icon.png',
      url: '/schedule',
      tag: 'shift-123',
    });
  });

  it('provides defaults for optional fields', () => {
    const json = JSON.stringify({ title: 'Alert', body: 'Something happened' });
    const result = parsePushPayload(json);
    expect(result).toEqual({
      title: 'Alert',
      body: 'Something happened',
      icon: '/icon-192.png',
      url: '/',
      tag: undefined,
    });
  });

  it('returns null for invalid JSON', () => {
    expect(parsePushPayload('not json')).toBeNull();
  });

  it('returns null for missing title', () => {
    expect(parsePushPayload(JSON.stringify({ body: 'no title' }))).toBeNull();
  });

  it('returns null for missing body', () => {
    expect(parsePushPayload(JSON.stringify({ title: 'no body' }))).toBeNull();
  });
});
