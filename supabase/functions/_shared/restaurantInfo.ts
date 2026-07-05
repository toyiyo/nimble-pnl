/**
 * Restaurant display info for notification emails.
 *
 * Type-agnostic like buildEmails.ts: accepts any object with a `.from()`
 * chain of the expected shape, so the real Deno Supabase client and Vitest
 * stubs satisfy the same interface — no URL imports, so this module is
 * directly unit-testable in Node.
 */

export const DEFAULT_RESTAURANT_NAME = 'Your Restaurant';
/** Matches the restaurants.timezone column default and sibling sync functions. */
export const DEFAULT_RESTAURANT_TIMEZONE = 'America/Chicago';

export interface RestaurantInfo {
  name: string;
  timezone: string;
}

interface RestaurantsQueryClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        single(): Promise<{
          data: { name?: string | null; timezone?: string | null } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

/**
 * Fetch a restaurant's name and IANA timezone, falling back per-field.
 *
 * Errors deliberately degrade to the defaults instead of throwing: this
 * helper feeds notification emails, where "generic name + default timezone"
 * is strictly better for the recipient than the whole send failing over a
 * cosmetic lookup. The error is logged server-side for operators.
 *
 * The timezone value is further validated downstream by formatDateTime's
 * Intl probe (invalid IANA → UTC), so a bad stored value cannot throw.
 */
export const getRestaurantInfo = async (
  supabase: RestaurantsQueryClient,
  restaurantId: string,
): Promise<RestaurantInfo> => {
  const { data, error } = await supabase
    .from('restaurants')
    .select('name, timezone')
    .eq('id', restaurantId)
    .single();

  if (error || !data) {
    console.error('Error fetching restaurant info:', error);
    return { name: DEFAULT_RESTAURANT_NAME, timezone: DEFAULT_RESTAURANT_TIMEZONE };
  }

  return {
    name: data.name || DEFAULT_RESTAURANT_NAME,
    timezone: data.timezone || DEFAULT_RESTAURANT_TIMEZONE,
  };
};
