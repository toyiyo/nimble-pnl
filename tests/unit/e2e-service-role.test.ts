import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

// Mock target captured per-test so we can assert on the exact call args.
const updateMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();
const createClientMock = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

// The helper falls back to .env.local when the process env is absent.
// Stub the read so these tests never depend on a real file.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: actual,
    readFileSync: () => {
      throw new Error('ENOENT');
    },
  };
});

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

describe('tests/helpers/e2e-service-role', () => {
  beforeEach(() => {
    vi.resetModules();
    resetEnv();

    selectMock.mockReset().mockResolvedValue({ data: [{ id: 'restaurant-1' }], error: null });
    eqMock.mockReset().mockReturnValue({ select: selectMock });
    updateMock.mockReset().mockReturnValue({ eq: eqMock });
    fromMock.mockReset().mockReturnValue({ update: updateMock });
    createClientMock.mockReset().mockReturnValue({ from: fromMock });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('throws a clear error when SUPABASE_URL is absent', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

    const { setSubscriptionTier } = await import('../helpers/e2e-service-role');

    await expect(setSubscriptionTier('restaurant-1', 'pro', 'active')).rejects.toThrow(
      /SUPABASE_URL/
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('throws a clear error when SUPABASE_SERVICE_ROLE_KEY is absent', async () => {
    process.env.SUPABASE_URL = 'http://localhost:54321';

    const { setSubscriptionTier } = await import('../helpers/e2e-service-role');

    await expect(setSubscriptionTier('restaurant-1', 'pro', 'active')).rejects.toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/
    );
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('creates the client lazily with persistSession disabled', async () => {
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

    const { setSubscriptionTier } = await import('../helpers/e2e-service-role');
    expect(createClientMock).not.toHaveBeenCalled();

    await setSubscriptionTier('restaurant-1', 'pro', 'active');

    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(createClientMock).toHaveBeenCalledWith(
      'http://localhost:54321',
      'service-role-key',
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: false }),
      })
    );
  });

  it('reuses the same client across calls instead of recreating it', async () => {
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

    const { setSubscriptionTier } = await import('../helpers/e2e-service-role');

    await setSubscriptionTier('restaurant-1', 'pro', 'active');
    await setSubscriptionTier('restaurant-2', 'starter', 'trialing');

    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it('updates subscription_tier and subscription_status for the given restaurant', async () => {
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

    const { setSubscriptionTier } = await import('../helpers/e2e-service-role');

    await setSubscriptionTier('restaurant-1', 'growth', 'past_due');

    expect(fromMock).toHaveBeenCalledWith('restaurants');
    expect(updateMock).toHaveBeenCalledWith({
      subscription_tier: 'growth',
      subscription_status: 'past_due',
    });
    expect(eqMock).toHaveBeenCalledWith('id', 'restaurant-1');
  });

  it('throws when the update returns a Supabase error', async () => {
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    selectMock.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

    const { setSubscriptionTier } = await import('../helpers/e2e-service-role');

    await expect(setSubscriptionTier('restaurant-1', 'pro', 'active')).rejects.toThrow(
      /permission denied/
    );
  });

  it('throws when the update matches zero rows', async () => {
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    selectMock.mockResolvedValue({ data: [], error: null });

    const { setSubscriptionTier } = await import('../helpers/e2e-service-role');

    await expect(setSubscriptionTier('missing-id', 'pro', 'active')).rejects.toThrow(
      /no restaurant row matched id missing-id/
    );
  });

  it('asks PostgREST to return the updated row so a zero-row update is detectable', async () => {
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

    const { setSubscriptionTier } = await import('../helpers/e2e-service-role');

    await setSubscriptionTier('restaurant-1', 'pro', 'active');

    expect(selectMock).toHaveBeenCalledWith('id');
  });
});
