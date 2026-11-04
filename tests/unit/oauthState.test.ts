import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  signOAuthState,
  verifyOAuthState,
  parseAllowedOrigins,
  resolveAppOrigin,
  isValidOAuthStateSecret,
  isOwnerOrManager,
  getUserIdFromAuthHeader,
  checkOAuthCallback,
  resolveOAuthRequest,
  OAUTH_STATE_TTL_SECONDS,
  OAUTH_STATE_MAX_LENGTH,
  PRODUCTION_APP_ORIGIN,
  type OAuthProvider,
  type SignOAuthStateInput,
} from '../../supabase/functions/_shared/oauthState';
import { fromBase64Url, toBase64Url } from '../../supabase/functions/_shared/hmacToken';

const SECRET = 'test-oauth-state-secret-0123456789abcdef';
const NOW = 1_770_000_000;
const RESTAURANT_A = '11111111-0000-0000-0000-00000000000a';
const RESTAURANT_B = '11111111-0000-0000-0000-00000000000b';
const USER = '22222222-0000-0000-0000-000000000001';
const OTHER_USER = '22222222-0000-0000-0000-000000000002';

function input(overrides: Partial<SignOAuthStateInput> = {}): SignOAuthStateInput {
  return {
    provider: 'square',
    restaurantId: RESTAURANT_A,
    userId: USER,
    origin: PRODUCTION_APP_ORIGIN,
    ...overrides,
  };
}

function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

/** Re-encodes the payload half of a token with a change, and keeps the old signature. */
function changePayload(token: string, change: (p: Record<string, unknown>) => void): string {
  const [payloadPart, sigPart] = token.split('.');
  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadPart)));
  change(payload);
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return `${toBase64Url(bytes)}.${sigPart}`;
}

describe('signOAuthState / verifyOAuthState', () => {
  it('accepts a good token and returns the payload', async () => {
    const token = await signOAuthState(input(), SECRET, NOW);
    const payload = await verifyOAuthState(token, SECRET, 'square', NOW + 1);

    expect(payload).toMatchObject({
      p: 'square',
      rid: RESTAURANT_A,
      uid: USER,
      o: PRODUCTION_APP_ORIGIN,
      exp: NOW + OAUTH_STATE_TTL_SECONDS,
    });
    expect(payload?.n).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('uses a new nonce for each token', async () => {
    const a = await signOAuthState(input(), SECRET, NOW);
    const b = await signOAuthState(input(), SECRET, NOW);
    expect(a).not.toBe(b);
  });

  it('rejects a token with a different restaurant in the payload', async () => {
    const token = await signOAuthState(input(), SECRET, NOW);
    const forged = changePayload(token, (p) => {
      p.rid = RESTAURANT_B;
    });
    expect(await verifyOAuthState(forged, SECRET, 'square', NOW)).toBeNull();
  });

  it('rejects a token with a changed signature', async () => {
    const token = await signOAuthState(input(), SECRET, NOW);
    const [payloadPart, sigPart] = token.split('.');
    // Change the first char: the last char can carry only padding bits.
    const first = sigPart[0] === 'A' ? 'B' : 'A';
    const forged = `${payloadPart}.${first}${sigPart.slice(1)}`;
    expect(await verifyOAuthState(forged, SECRET, 'square', NOW)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signOAuthState(input(), SECRET, NOW);
    expect(
      await verifyOAuthState(token, SECRET, 'square', NOW + OAUTH_STATE_TTL_SECONDS + 1)
    ).toBeNull();
  });

  it('accepts a token at the last second before expiry', async () => {
    const token = await signOAuthState(input(), SECRET, NOW);
    expect(
      await verifyOAuthState(token, SECRET, 'square', NOW + OAUTH_STATE_TTL_SECONDS)
    ).not.toBeNull();
  });

  it('rejects a token for a different provider', async () => {
    const token = await signOAuthState(input({ provider: 'square' }), SECRET, NOW);
    expect(await verifyOAuthState(token, SECRET, 'clover', NOW)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signOAuthState(input(), 'a-different-secret-0123456789abcdef', NOW);
    expect(await verifyOAuthState(token, SECRET, 'square', NOW)).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['the bare restaurant id (old format)', RESTAURANT_A],
    ['the old Clover JSON state', JSON.stringify({ restaurantId: RESTAURANT_A, region: 'na' })],
    ['three parts', 'a.b.c'],
    ['bad base64', '!!!.???'],
    ['too long', `${'a'.repeat(OAUTH_STATE_MAX_LENGTH)}.b`],
  ])('rejects a malformed token: %s', async (_label, token) => {
    expect(await verifyOAuthState(token, SECRET, 'square', NOW)).toBeNull();
  });

  it('rejects a value that is not a string', async () => {
    expect(await verifyOAuthState({} as unknown as string, SECRET, 'square', NOW)).toBeNull();
  });

  it('keeps the Clover region in the payload', async () => {
    const token = await signOAuthState(input({ provider: 'clover', region: 'eu' }), SECRET, NOW);
    const payload = await verifyOAuthState(token, SECRET, 'clover', NOW);
    expect(payload?.r).toBe('eu');
  });

  it('refuses to sign a region outside the Clover set', async () => {
    await expect(
      signOAuthState(input({ provider: 'clover', region: 'mars' as never }), SECRET, NOW)
    ).rejects.toThrow(/region/);
  });

  it('rejects a signed payload with a region outside the Clover set', async () => {
    // Sign a bad payload by hand, so only the shape check can catch it.
    const { signPayloadBytes } = await import('../../supabase/functions/_shared/hmacToken');
    const bytes = new TextEncoder().encode(
      JSON.stringify({ p: 'clover', rid: RESTAURANT_A, uid: USER, o: PRODUCTION_APP_ORIGIN, n: 'x', exp: NOW + 60, r: 'mars' })
    );
    const token = await signPayloadBytes(bytes, SECRET);
    expect(await verifyOAuthState(token, SECRET, 'clover', NOW)).toBeNull();
  });
});

describe('isValidOAuthStateSecret', () => {
  it('accepts a secret of 32 or more characters', () => {
    expect(isValidOAuthStateSecret('x'.repeat(32))).toBe(true);
  });

  it.each([undefined, null, '', 'short'])('rejects %s', (value) => {
    expect(isValidOAuthStateSecret(value)).toBe(false);
  });
});

describe('parseAllowedOrigins', () => {
  it('always holds the production origin', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([PRODUCTION_APP_ORIGIN]);
    expect(parseAllowedOrigins('')).toEqual([PRODUCTION_APP_ORIGIN]);
  });

  it('adds exact https origins and local http origins', () => {
    expect(
      parseAllowedOrigins(' https://preview.example.com , http://localhost:8080,http://127.0.0.1:5173 ')
    ).toEqual([
      PRODUCTION_APP_ORIGIN,
      'https://preview.example.com',
      'http://localhost:8080',
      'http://127.0.0.1:5173',
    ]);
  });

  it.each([
    'https://*.lovableproject.com',
    'https://preview.example.com/path',
    'http://preview.example.com',
    'javascript:alert(1)',
    'not a url',
  ])('drops %s', (entry) => {
    expect(parseAllowedOrigins(entry)).toEqual([PRODUCTION_APP_ORIGIN]);
  });

  it('does not add a duplicate', () => {
    expect(parseAllowedOrigins(`${PRODUCTION_APP_ORIGIN},${PRODUCTION_APP_ORIGIN}/`)).toEqual([
      PRODUCTION_APP_ORIGIN,
    ]);
  });
});

describe('resolveAppOrigin', () => {
  const allowed = [PRODUCTION_APP_ORIGIN, 'https://preview.example.com'];

  it('returns the production origin for the production app', () => {
    expect(resolveAppOrigin(headers({ origin: PRODUCTION_APP_ORIGIN }), allowed)).toEqual({
      origin: PRODUCTION_APP_ORIGIN,
      isProduction: true,
    });
  });

  it('returns an allowlisted preview origin', () => {
    expect(resolveAppOrigin(headers({ origin: 'https://preview.example.com' }), allowed)).toEqual({
      origin: 'https://preview.example.com',
      isProduction: false,
    });
  });

  it('falls back to production for an origin outside the list', () => {
    expect(resolveAppOrigin(headers({ origin: 'https://evil.example.com' }), allowed)).toEqual({
      origin: PRODUCTION_APP_ORIGIN,
      isProduction: true,
    });
  });

  it('uses the origin of the Referer when Origin is missing', () => {
    expect(
      resolveAppOrigin(headers({ referer: 'https://preview.example.com/integrations?x=1' }), allowed)
    ).toEqual({ origin: 'https://preview.example.com', isProduction: false });
  });

  it('falls back to production for a malformed header', () => {
    expect(resolveAppOrigin(headers({ origin: 'not a url' }), allowed)).toEqual({
      origin: PRODUCTION_APP_ORIGIN,
      isProduction: true,
    });
  });

  it('falls back to production when no header is present', () => {
    expect(resolveAppOrigin(headers({}), allowed)).toEqual({
      origin: PRODUCTION_APP_ORIGIN,
      isProduction: true,
    });
  });
});

function roleQueryClient(result: { data: unknown; error: unknown }) {
  const calls: Record<string, unknown[]> = {};
  const builder = {
    select: vi.fn((...a: unknown[]) => ((calls.select = a), builder)),
    eq: vi.fn((...a: unknown[]) => ((calls[`eq:${a[0]}`] = a), builder)),
    in: vi.fn((...a: unknown[]) => ((calls.in = a), builder)),
    maybeSingle: vi.fn(async () => result),
  };
  const client = { from: vi.fn(() => builder) };
  return { client, calls };
}

describe('isOwnerOrManager', () => {
  it('returns true when a row exists for owner or manager', async () => {
    const { client, calls } = roleQueryClient({ data: { role: 'manager' }, error: null });
    expect(await isOwnerOrManager(client, USER, RESTAURANT_A)).toBe(true);
    expect(client.from).toHaveBeenCalledWith('user_restaurants');
    expect(calls['eq:user_id']).toEqual(['user_id', USER]);
    expect(calls['eq:restaurant_id']).toEqual(['restaurant_id', RESTAURANT_A]);
    expect(calls.in).toEqual(['role', ['owner', 'manager']]);
  });

  it('returns false when no row exists', async () => {
    const { client } = roleQueryClient({ data: null, error: null });
    expect(await isOwnerOrManager(client, USER, RESTAURANT_A)).toBe(false);
  });

  it('returns false when the query fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = roleQueryClient({ data: null, error: { message: 'boom' } });
    expect(await isOwnerOrManager(client, USER, RESTAURANT_A)).toBe(false);
    spy.mockRestore();
  });
});

describe('getUserIdFromAuthHeader', () => {
  function authClient(result: { data: { user: { id: string } | null }; error: unknown }) {
    return { auth: { getUser: vi.fn(async () => result) } };
  }

  it('returns the user id for a valid JWT', async () => {
    const client = authClient({ data: { user: { id: USER } }, error: null });
    expect(await getUserIdFromAuthHeader(client, 'Bearer jwt-token')).toBe(USER);
    expect(client.auth.getUser).toHaveBeenCalledWith('jwt-token');
  });

  it('returns null with no header', async () => {
    const client = authClient({ data: { user: { id: USER } }, error: null });
    expect(await getUserIdFromAuthHeader(client, null)).toBeNull();
    expect(client.auth.getUser).not.toHaveBeenCalled();
  });

  it('returns null for a header that is not Bearer', async () => {
    const client = authClient({ data: { user: { id: USER } }, error: null });
    expect(await getUserIdFromAuthHeader(client, 'Basic abc')).toBeNull();
  });

  it('returns null when getUser rejects the token (the anon key)', async () => {
    const client = authClient({ data: { user: null }, error: { message: 'invalid JWT' } });
    expect(await getUserIdFromAuthHeader(client, 'Bearer anon-key')).toBeNull();
  });
});

describe('checkOAuthCallback', () => {
  const allowedOrigins = [PRODUCTION_APP_ORIGIN, 'https://preview.example.com'];

  async function run(
    overrides: {
      state?: string;
      callerId?: string | null;
      hasRole?: boolean;
      provider?: 'square' | 'clover' | 'toast';
      allowed?: string[];
      now?: number;
    } = {}
  ) {
    const state = overrides.state ?? (await signOAuthState(input(), SECRET, NOW));
    const getUserId = vi.fn(async () => (overrides.callerId === undefined ? USER : overrides.callerId));
    const hasRole = vi.fn(async () => overrides.hasRole ?? true);
    const result = await checkOAuthCallback({
      state,
      provider: overrides.provider ?? 'square',
      secret: SECRET,
      allowedOrigins: overrides.allowed ?? allowedOrigins,
      getUserId,
      isOwnerOrManager: hasRole,
      nowSeconds: overrides.now ?? NOW,
    });
    return { result, getUserId, hasRole };
  }

  it('returns the restaurant, user and origin from a good state', async () => {
    const { result, hasRole } = await run();
    expect(result).toEqual({
      ok: true,
      restaurantId: RESTAURANT_A,
      userId: USER,
      origin: PRODUCTION_APP_ORIGIN,
      isProduction: true,
      region: undefined,
    });
    expect(hasRole).toHaveBeenCalledWith(USER, RESTAURANT_A);
  });

  it('returns the region and the preview origin for a Clover state', async () => {
    const state = await signOAuthState(
      input({ provider: 'clover', region: 'latam', origin: 'https://preview.example.com' }),
      SECRET,
      NOW
    );
    const { result } = await run({ state, provider: 'clover' });
    expect(result).toMatchObject({ ok: true, region: 'latam', origin: 'https://preview.example.com', isProduction: false });
  });

  it('rejects an unsigned state (the bare restaurant id) with 403 and no other check', async () => {
    const { result, getUserId, hasRole } = await run({ state: RESTAURANT_B });
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(getUserId).not.toHaveBeenCalled();
    expect(hasRole).not.toHaveBeenCalled();
  });

  it('rejects an expired state with 403', async () => {
    const { result, hasRole } = await run({ now: NOW + OAUTH_STATE_TTL_SECONDS + 1 });
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(hasRole).not.toHaveBeenCalled();
  });

  it('rejects a state for another provider with 403', async () => {
    const { result } = await run({ provider: 'toast' });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects a caller with no valid JWT with 401', async () => {
    const { result, hasRole } = await run({ callerId: null });
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(hasRole).not.toHaveBeenCalled();
  });

  it('rejects a caller who is not the user in the state with 403', async () => {
    const { result, hasRole } = await run({ callerId: OTHER_USER });
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(hasRole).not.toHaveBeenCalled();
  });

  it('rejects a signed origin that is no longer in the allowlist with 403', async () => {
    const state = await signOAuthState(input({ origin: 'https://preview.example.com' }), SECRET, NOW);
    const { result, hasRole } = await run({ state, allowed: [PRODUCTION_APP_ORIGIN] });
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(hasRole).not.toHaveBeenCalled();
  });

  it('rejects a user who is not owner or manager of the restaurant with 403', async () => {
    const { result } = await run({ hasRole: false });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});

describe('resolveOAuthRequest', () => {
  const allowedOriginsEnv = 'https://preview.example.com';

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function gate(
    body: Record<string, unknown>,
    overrides: {
      provider?: OAuthProvider;
      secret?: string;
      callerId?: string | null;
      hasRole?: boolean;
      origin?: string;
    } = {}
  ) {
    const getUserId = vi.fn(async () => (overrides.callerId === undefined ? USER : overrides.callerId));
    const hasRole = vi.fn(async () => overrides.hasRole ?? true);
    const result = await resolveOAuthRequest({
      provider: overrides.provider ?? 'square',
      body,
      headers: headers(overrides.origin ? { origin: overrides.origin } : {}),
      secret: overrides.secret ?? SECRET,
      allowedOriginsEnv,
      getUserId,
      isOwnerOrManager: hasRole,
      nowSeconds: NOW,
    });
    return { result, getUserId, hasRole };
  }

  it('returns 500 with no other work when the secret is missing or short', async () => {
    for (const secret of ['', 'short']) {
      const { result, getUserId } = await gate({ action: 'authorize', restaurantId: RESTAURANT_A }, { secret });
      expect(result).toMatchObject({ ok: false, status: 500 });
      expect(getUserId).not.toHaveBeenCalled();
    }
  });

  it('returns 400 for an unknown action', async () => {
    const { result } = await gate({ action: 'delete' });
    expect(result).toMatchObject({ ok: false, status: 400, error: 'Invalid action' });
  });

  describe('authorize', () => {
    it('returns the checked values and a signed state for an owner or manager', async () => {
      const { result, hasRole } = await gate(
        { action: 'authorize', restaurantId: RESTAURANT_A },
        { origin: 'https://preview.example.com' }
      );
      expect(result).toMatchObject({
        ok: true,
        action: 'authorize',
        userId: USER,
        restaurantId: RESTAURANT_A,
        appOrigin: { origin: 'https://preview.example.com', isProduction: false },
        region: undefined,
      });
      expect(result).not.toHaveProperty('stateSecret');
      expect(hasRole).toHaveBeenCalledWith(USER, RESTAURANT_A);

      const signedState = (result as { signedState: string }).signedState;
      expect(await verifyOAuthState(signedState, SECRET, 'square', NOW)).toMatchObject({
        rid: RESTAURANT_A,
        uid: USER,
        o: 'https://preview.example.com',
      });
    });

    it('signs the Clover region into the state', async () => {
      const { result } = await gate(
        { action: 'authorize', restaurantId: RESTAURANT_A, region: 'latam' },
        { provider: 'clover' }
      );
      const signedState = (result as { signedState: string }).signedState;
      expect((await verifyOAuthState(signedState, SECRET, 'clover', NOW))?.r).toBe('latam');
    });

    it('returns 401 with no valid JWT', async () => {
      const { result, hasRole } = await gate({ action: 'authorize', restaurantId: RESTAURANT_A }, { callerId: null });
      expect(result).toMatchObject({ ok: false, status: 401 });
      expect(hasRole).not.toHaveBeenCalled();
    });

    it('returns 400 with no restaurant id', async () => {
      const { result } = await gate({ action: 'authorize' });
      expect(result).toMatchObject({ ok: false, status: 400 });
    });

    it('returns 403 for a user who is not owner or manager', async () => {
      const { result } = await gate({ action: 'authorize', restaurantId: RESTAURANT_A }, { hasRole: false });
      expect(result).toMatchObject({ ok: false, status: 403 });
    });

    it('uses the default Clover region and accepts a valid one', async () => {
      const defaultRegion = await gate({ action: 'authorize', restaurantId: RESTAURANT_A }, { provider: 'clover' });
      expect(defaultRegion.result).toMatchObject({ ok: true, region: 'na' });
      const explicitRegion = await gate(
        { action: 'authorize', restaurantId: RESTAURANT_A, region: 'eu' },
        { provider: 'clover' }
      );
      expect(explicitRegion.result).toMatchObject({ ok: true, region: 'eu' });
    });

    it.each(['mars', null, ''])('returns 400 for the Clover region %s, before the role check', async (region) => {
      const { result, hasRole } = await gate(
        { action: 'authorize', restaurantId: RESTAURANT_A, region },
        { provider: 'clover' }
      );
      expect(result).toMatchObject({ ok: false, status: 400, error: 'Invalid Clover region' });
      expect(hasRole).not.toHaveBeenCalled();
    });
  });

  describe('callback', () => {
    it('returns the values from a good state, not from the body', async () => {
      const state = await signOAuthState(input({ origin: 'https://preview.example.com' }), SECRET, NOW);
      const { result } = await gate({ action: 'callback', code: 'c0de', state, restaurantId: RESTAURANT_B });
      expect(result).toEqual({
        ok: true,
        action: 'callback',
        code: 'c0de',
        userId: USER,
        restaurantId: RESTAURANT_A,
        appOrigin: { origin: 'https://preview.example.com', isProduction: false },
        region: undefined,
      });
    });

    it('returns the Clover region from the state', async () => {
      const state = await signOAuthState(input({ provider: 'clover', region: 'apac' }), SECRET, NOW);
      const { result } = await gate({ action: 'callback', code: 'c0de', state, region: 'eu' }, { provider: 'clover' });
      expect(result).toMatchObject({ ok: true, region: 'apac' });
    });

    it.each([
      ['no code', { state: 'x' }],
      ['no state', { code: 'c0de' }],
      ['a state that is not a string', { code: 'c0de', state: { rid: RESTAURANT_A } }],
      ['a code that is not a string', { code: 42, state: 'x' }],
    ])('returns 400 for %s', async (_label, fields) => {
      const { result, getUserId } = await gate({ action: 'callback', ...fields });
      expect(result).toMatchObject({ ok: false, status: 400 });
      expect(getUserId).not.toHaveBeenCalled();
    });

    it('returns 403 for an unsigned state (the bare restaurant id)', async () => {
      const { result, hasRole } = await gate({ action: 'callback', code: 'c0de', state: RESTAURANT_B });
      expect(result).toMatchObject({ ok: false, status: 403 });
      expect(hasRole).not.toHaveBeenCalled();
      });

    it('returns 401 when the caller has no valid JWT', async () => {
      const state = await signOAuthState(input(), SECRET, NOW);
      const { result } = await gate({ action: 'callback', code: 'c0de', state }, { callerId: null });
      expect(result).toMatchObject({ ok: false, status: 401 });
      });

    it('returns 403 when the caller is a different user', async () => {
      const state = await signOAuthState(input(), SECRET, NOW);
      const { result } = await gate({ action: 'callback', code: 'c0de', state }, { callerId: OTHER_USER });
      expect(result).toMatchObject({ ok: false, status: 403 });
      });

    it('returns 403 when the user lost the owner or manager role', async () => {
      const state = await signOAuthState(input(), SECRET, NOW);
      const { result } = await gate({ action: 'callback', code: 'c0de', state }, { hasRole: false });
      expect(result).toMatchObject({ ok: false, status: 403 });
      });
  });
});
