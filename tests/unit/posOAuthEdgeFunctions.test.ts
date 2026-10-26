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

  it('checks the callback before the first fetch, upsert or function call', () => {
    const check = src.indexOf('checkOAuthCallback({');
    expect(check).toBeGreaterThan(-1);
    for (const sideEffect of ['await fetch(', '.upsert(', 'functions.invoke(']) {
      const first = src.indexOf(sideEffect);
      if (first !== -1) expect(first, sideEffect).toBeGreaterThan(check);
    }
  });

  it('returns the status of a failed check with no further work', () => {
    expect(src).toMatch(/if \(!check\.ok\) \{[^}]*return jsonResponse\(\{ error: check\.error \}, check\.status\);/);
  });

  it('sets the state only to the signed token', () => {
    const stateSets = src.match(/searchParams\.set\('state', [^)]*\)/g) ?? [];
    expect(stateSets).toEqual(["searchParams.set('state', signedState)"]);
  });

  it('takes the restaurant in the callback only from the verified state', () => {
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

  it('builds the redirect from the allowlisted app origin', () => {
    expect(src).toMatch(/const REDIRECT_URI = `\$\{appOrigin\.origin\}\/[a-z]+\/callback`;/);
    expect(src).not.toMatch(/headers\.get\('origin'\)/);
  });
});
