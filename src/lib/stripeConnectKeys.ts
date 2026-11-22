/** One shared key so invalidation matches the query. `?? null` maps undefined and null to the same key. */
export const stripeConnectedAccountKey = (restaurantId: string | null | undefined) =>
  ['stripe-connected-account', restaurantId ?? null] as const;
