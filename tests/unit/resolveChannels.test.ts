import { describe, it, expect, vi } from 'vitest';
import { resolveChannels, type SupabaseLike } from '../../supabase/functions/_shared/resolveChannels';
import { NOTIFICATION_TYPES } from '../../src/lib/notificationTypes';

function makeClient(data: { email_enabled: boolean; push_enabled: boolean } | null, error: unknown = null): SupabaseLike {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const eq2 = vi.fn().mockReturnValue({ maybeSingle });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });
  return { from } as unknown as SupabaseLike;
}

describe('resolveChannels', () => {
  it('returns the row values when a settings row exists with both channels on', async () => {
    const client = makeClient({ email_enabled: true, push_enabled: true });
    const result = await resolveChannels(client, 'r1', 'shift_created');
    expect(result).toEqual({ email: true, push: true });
  });

  it('returns email off / push on when the row disables only email', async () => {
    const client = makeClient({ email_enabled: false, push_enabled: true });
    const result = await resolveChannels(client, 'r1', 'shift_created');
    expect(result).toEqual({ email: false, push: true });
  });

  it('returns email on / push off when the row disables only push', async () => {
    const client = makeClient({ email_enabled: true, push_enabled: false });
    const result = await resolveChannels(client, 'r1', 'shift_created');
    expect(result).toEqual({ email: true, push: false });
  });

  it('returns both off when the row disables both channels', async () => {
    const client = makeClient({ email_enabled: false, push_enabled: false });
    const result = await resolveChannels(client, 'r1', 'shift_created');
    expect(result).toEqual({ email: false, push: false });
  });

  it('fails OPEN (both true) when no row exists for the restaurant/type', async () => {
    const client = makeClient(null, null);
    const result = await resolveChannels(client, 'r1', 'schedule_published');
    expect(result).toEqual({ email: true, push: true });
  });

  it('fails OPEN (both true) when the query errors', async () => {
    const client = makeClient(null, { message: 'db down' });
    const result = await resolveChannels(client, 'r1', 'schedule_published');
    expect(result).toEqual({ email: true, push: true });
  });

  it('queries the composite (restaurant_id, notification_type) key on notification_channel_settings', async () => {
    const client = makeClient({ email_enabled: true, push_enabled: true });
    await resolveChannels(client, 'restaurant-42', 'pin_reset');

    expect(client.from).toHaveBeenCalledWith('notification_channel_settings');
    const fromResult = (client.from as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(fromResult.select).toHaveBeenCalledWith('email_enabled, push_enabled');
    const selectResult = fromResult.select.mock.results[0].value;
    expect(selectResult.eq).toHaveBeenCalledWith('restaurant_id', 'restaurant-42');
    const eq1Result = selectResult.eq.mock.results[0].value;
    expect(eq1Result.eq).toHaveBeenCalledWith('notification_type', 'pin_reset');
  });

  it('resolves for every catalog type without throwing', async () => {
    const client = makeClient({ email_enabled: true, push_enabled: true });
    for (const { key } of NOTIFICATION_TYPES) {
      await expect(resolveChannels(client, 'r1', key)).resolves.toEqual({ email: true, push: true });
    }
  });
});
