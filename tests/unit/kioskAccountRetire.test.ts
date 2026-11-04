import { describe, it, expect, vi } from 'vitest';

import {
  retireKioskAccount,
  KIOSK_BAN_DURATION,
  type KioskRetireClient,
} from '../../supabase/functions/_shared/kioskAccountRetire';

type Err = { message: string } | null;

function makeClient(opts: { membershipError?: Err; deleteError?: Err; banError?: Err } = {}) {
  const calls: string[] = [];
  const eqRestaurant = vi.fn(async (_c: 'restaurant_id', _v: string) => {
    calls.push('membership');
    return { error: opts.membershipError ?? null };
  });
  const eqUser = vi.fn((_c: 'user_id', _v: string) => ({ eq: eqRestaurant }));
  const deleteUser = vi.fn(async (_id: string) => {
    calls.push('deleteUser');
    return { error: opts.deleteError ?? null };
  });
  const updateUserById = vi.fn(async (_id: string, _attrs: { ban_duration: string }) => {
    calls.push('ban');
    return { error: opts.banError ?? null };
  });
  const client: KioskRetireClient = {
    from: () => ({ delete: () => ({ eq: eqUser }) }),
    auth: { admin: { deleteUser, updateUserById } },
  };
  return { client, calls, eqUser, eqRestaurant, deleteUser, updateUserById };
}

describe('retireKioskAccount', () => {
  it('deletes the membership first, then the auth user', async () => {
    const m = makeClient();
    await expect(retireKioskAccount(m.client, 'old-user', 'rest-1')).resolves.toBe('deleted');
    expect(m.calls).toEqual(['membership', 'deleteUser']);
    expect(m.eqUser).toHaveBeenCalledWith('user_id', 'old-user');
    expect(m.eqRestaurant).toHaveBeenCalledWith('restaurant_id', 'rest-1');
    expect(m.deleteUser).toHaveBeenCalledWith('old-user');
    expect(m.updateUserById).not.toHaveBeenCalled();
  });

  it('bans the user when the delete fails on the created_by foreign key', async () => {
    const m = makeClient({ deleteError: { message: 'Database error deleting user' } });
    await expect(retireKioskAccount(m.client, 'old-user', 'rest-1')).resolves.toBe('banned');
    expect(m.calls).toEqual(['membership', 'deleteUser', 'ban']);
    expect(m.updateUserById).toHaveBeenCalledWith('old-user', { ban_duration: KIOSK_BAN_DURATION });
  });

  it('throws when both the delete and the ban fail', async () => {
    const m = makeClient({
      deleteError: { message: 'Database error deleting user' },
      banError: { message: 'ban failed' },
    });
    await expect(retireKioskAccount(m.client, 'old-user', 'rest-1')).rejects.toThrow(
      'Failed to delete or ban old kiosk user: Database error deleting user; ban failed',
    );
  });

  it('throws and stops when the membership delete fails', async () => {
    const m = makeClient({ membershipError: { message: 'permission denied' } });
    await expect(retireKioskAccount(m.client, 'old-user', 'rest-1')).rejects.toThrow(
      'Failed to delete old kiosk membership: permission denied',
    );
    expect(m.deleteUser).not.toHaveBeenCalled();
    expect(m.updateUserById).not.toHaveBeenCalled();
  });
});
