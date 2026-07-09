import { describe, it, expect, vi } from 'vitest';
import {
  getRestaurantInfo,
  DEFAULT_RESTAURANT_NAME,
  DEFAULT_RESTAURANT_TIMEZONE,
} from '../../supabase/functions/_shared/restaurantInfo';

const makeClient = (
  data: { name?: string | null; timezone?: string | null } | null,
  error: { message: string } | null = null,
) => ({
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  }),
});

describe('getRestaurantInfo', () => {
  it('returns name and timezone from the restaurants row', async () => {
    const client = makeClient({ name: "Russo's", timezone: 'America/New_York' });
    const info = await getRestaurantInfo(client, 'rest-1');
    expect(info).toEqual({ name: "Russo's", timezone: 'America/New_York' });
    expect(client.from).toHaveBeenCalledWith('restaurants');
  });

  it('falls back to defaults when the query errors', async () => {
    const client = makeClient(null, { message: 'boom' });
    const info = await getRestaurantInfo(client, 'rest-1');
    expect(info).toEqual({
      name: DEFAULT_RESTAURANT_NAME,
      timezone: DEFAULT_RESTAURANT_TIMEZONE,
    });
  });

  it('falls back per-field when the row has null name or timezone', async () => {
    const client = makeClient({ name: null, timezone: null });
    const info = await getRestaurantInfo(client, 'rest-1');
    expect(info).toEqual({
      name: DEFAULT_RESTAURANT_NAME,
      timezone: DEFAULT_RESTAURANT_TIMEZONE,
    });
  });

  it('uses the America/Chicago default (matches the restaurants.timezone column default)', () => {
    expect(DEFAULT_RESTAURANT_TIMEZONE).toBe('America/Chicago');
  });
});
