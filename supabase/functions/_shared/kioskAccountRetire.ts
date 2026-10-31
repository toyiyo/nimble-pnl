/**
 * Retire an old kiosk service account during a credential rotation.
 *
 * `time_punches.created_by` references `auth.users` with no ON DELETE clause.
 * A kiosk that recorded a punch therefore cannot be deleted: `deleteUser`
 * returns a foreign key error. Before this module, the rotation ignored that
 * error. The old login then kept its 'kiosk' membership and could still
 * insert punches.
 *
 * The steps:
 * 1. Delete the membership row. This removes all access through RLS.
 * 2. Delete the auth user.
 * 3. If step 2 fails, ban the auth user, so the old password cannot sign in.
 *
 * Any failure throws. The caller must then stop and not create a new account.
 */

type ResultError = { message: string } | null;

export interface KioskRetireClient {
  from(table: 'user_restaurants'): {
    delete(): {
      eq(column: 'user_id', value: string): {
        eq(column: 'restaurant_id', value: string): PromiseLike<{ error: ResultError }>;
      };
    };
  };
  auth: {
    admin: {
      deleteUser(userId: string): PromiseLike<{ error: ResultError }>;
      updateUserById(
        userId: string,
        attributes: { ban_duration: string },
      ): PromiseLike<{ error: ResultError }>;
    };
  };
}

/** About 100 years. Supabase Auth has no permanent ban value. */
export const KIOSK_BAN_DURATION = '876000h';

export type KioskRetireOutcome = 'deleted' | 'banned';

export async function retireKioskAccount(
  client: KioskRetireClient,
  userId: string,
  restaurantId: string,
): Promise<KioskRetireOutcome> {
  const { error: membershipError } = await client
    .from('user_restaurants')
    .delete()
    .eq('user_id', userId)
    .eq('restaurant_id', restaurantId);
  if (membershipError) {
    throw new Error(`Failed to delete old kiosk membership: ${membershipError.message}`);
  }

  const { error: deleteError } = await client.auth.admin.deleteUser(userId);
  if (!deleteError) return 'deleted';

  const { error: banError } = await client.auth.admin.updateUserById(userId, {
    ban_duration: KIOSK_BAN_DURATION,
  });
  if (banError) {
    throw new Error(
      `Failed to delete or ban old kiosk user: ${deleteError.message}; ${banError.message}`,
    );
  }
  return 'banned';
}
