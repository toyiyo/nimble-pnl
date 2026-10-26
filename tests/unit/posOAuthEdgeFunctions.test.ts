import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The Deno entry files cannot run under Vitest. These source checks guard the
// security contract of each POS OAuth function: the callback check runs before
// any network call or write, and the state is always the signed token.
const FUNCTIONS = ['square-oauth', 'clover-oauth', 'toast-oauth'] as const;

function source(name: string): string {
  return readFileSync(resolve(__dirname, `../../supabase/functions/${name}/index.ts`), 'utf8');
}

describe.each(FUNCTIONS)('%s', (name) => {
  const src = source(name);

  it('runs the shared gate before the first fetch, upsert or function call', () => {
    const gate = src.indexOf('resolveOAuthRequest({');
    expect(gate).toBeGreaterThan(-1);
    for (const sideEffect of ['await fetch(', '.upsert(', 'functions.invoke(', 'getEncryptionService(']) {
      const first = src.indexOf(sideEffect);
      if (first !== -1) expect(first, sideEffect).toBeGreaterThan(gate);
    }
  });

  it('returns at once when the gate fails', () => {
    expect(src).toMatch(/if \(!gate\.ok\) \{\s*return jsonResponse\(\{ error: gate\.error \}, gate\.status\);\s*\}/);
  });

  it('sets the state only to the signed token', () => {
    const stateSets = src.match(/searchParams\.set\('state', [^)]*\)/g) ?? [];
    expect(stateSets).toEqual(["searchParams.set('state', signedState)"]);
  });

  it('takes the restaurant in the callback only from the gate', () => {
    expect(src).toMatch(/const \{ appOrigin, userId, restaurantId \} = gate;/);
    expect(src).not.toMatch(/restaurantId = state/);
    expect(src).not.toMatch(/JSON\.parse\(state\)/);
  });

  it('does not log the authorization URL or the client id', () => {
    const logs = src.match(/console\.(log|warn|error)\([^;]*;/g) ?? [];
    for (const line of logs) {
      // `!!X` logs only a boolean, so it is safe.
      expect(line.replace(/!!\w+/g, '')).not.toMatch(/authUrl|CLIENT_ID|APP_ID|APPLICATION_ID|client_id/);
    }
  });

  it('does not read the raw Origin or Referer header', () => {
    expect(src).not.toMatch(/headers\.get\('(origin|referer)'\)/i);
  });
});
