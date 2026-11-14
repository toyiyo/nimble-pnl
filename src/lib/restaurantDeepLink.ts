/**
 * Helpers for the restaurant deep link in notice emails.
 * A link carries `?select_restaurant=<restaurant_id>`.
 */
export const SELECT_RESTAURANT_PARAM = 'select_restaurant';

/** Return the linked restaurant id, or null when the key is missing or empty. */
export function readLinkedRestaurantId(searchParams: URLSearchParams): string | null {
  const value = searchParams.get(SELECT_RESTAURANT_PARAM);
  return value || null;
}

/** Return the membership with the linked id, or null. */
export function resolveLinkedRestaurant<T extends { restaurant_id: string }>(
  linkedId: string | null,
  restaurants: readonly T[],
): T | null {
  if (!linkedId) return null;
  return restaurants.find((r) => r.restaurant_id === linkedId) ?? null;
}

/** Return a new URLSearchParams without the `select_restaurant` key. */
export function withoutLinkedRestaurant(searchParams: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  next.delete(SELECT_RESTAURANT_PARAM);
  return next;
}
