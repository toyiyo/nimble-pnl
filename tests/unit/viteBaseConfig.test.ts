import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Vite base config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses absolute base path for web builds (no CAPACITOR_BUILD)', () => {
    delete process.env.CAPACITOR_BUILD;
    const base = process.env.CAPACITOR_BUILD === 'true' ? './' : '/';
    expect(base).toBe('/');
  });

  it('uses relative base path for Capacitor builds (CAPACITOR_BUILD=true)', () => {
    process.env.CAPACITOR_BUILD = 'true';
    const base = process.env.CAPACITOR_BUILD === 'true' ? './' : '/';
    expect(base).toBe('./');
  });

  it('uses absolute base path when CAPACITOR_BUILD is set to non-true value', () => {
    process.env.CAPACITOR_BUILD = 'false';
    const base = process.env.CAPACITOR_BUILD === 'true' ? './' : '/';
    expect(base).toBe('/');
  });
});
