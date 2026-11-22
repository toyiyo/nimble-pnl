/** One React Query key for the connected account row. Use it in every hook and page. */
export const stripeConnectedAccountKey = (restaurantId: string | null | undefined) =>
  ['stripe-connected-account', restaurantId ?? null] as const;
