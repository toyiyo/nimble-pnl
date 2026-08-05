// Which way a guest goes after tapping a star.
//
// This lives server-side and nowhere else. The public page never receives the
// threshold or the destination URL until the server has decided the guest has
// earned it — otherwise anyone could read the Google link out of the page's
// JavaScript and infer that low ratings are being filtered.

export type RoutedTo = 'destination' | 'feedback';

export interface RouteDecision {
  routedTo: RoutedTo;
  /** Released only when routedTo === 'destination'. */
  destinationUrl: string | null;
}

export function routeRating(
  rating: number,
  promoterThreshold: number,
  destinationUrl: string | null
): RouteDecision {
  const inRange = Number.isInteger(rating) && rating >= 1 && rating <= 5;
  const isPromoter = inRange && rating >= promoterThreshold;

  if (isPromoter && destinationUrl) {
    return { routedTo: 'destination', destinationUrl };
  }
  return { routedTo: 'feedback', destinationUrl: null };
}
