/**
 * Classifies what came back from `review-public`'s `page` action.
 *
 * This exists because the page used to collapse three outcomes into one. A
 * failed invoke, an empty response, and a genuinely paused page all rendered
 * "This link isn't active", so when `REVIEW_TOKEN_SECRET` was missing in
 * production and every call 500'd, the owner spent the outage toggling
 * `is_active` on a page that was already live.
 *
 * The payload is validated rather than cast: `supabase.functions.invoke()`
 * returns `unknown`, and a 200 the client cannot render is a failure that
 * should look like one — not a card with `undefined` in it.
 */

export interface PublicReviewPage {
  restaurant_name: string;
  headline: string;
  subheadline: string | null;
  logo_url: string | null;
  threshold: number;
}

export type ReviewPageLoad =
  | { kind: 'ready'; page: PublicReviewPage }
  | { kind: 'inactive' }
  | { kind: 'error' };

/** What the page holds while the fetch is still out, plus every settled outcome. */
export type ReviewPageLoadState = { kind: 'loading' } | ReviewPageLoad;

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function isPublicReviewPage(
  value: Record<string, unknown>
): value is Record<string, unknown> & PublicReviewPage {
  return (
    // `restaurant_name` may be '': the function emits `?? ''` when the
    // restaurant join is null (review-public/index.ts:141).
    typeof value.restaurant_name === 'string' &&
    typeof value.headline === 'string' &&
    isNullableString(value.subheadline) &&
    isNullableString(value.logo_url) &&
    // Type only, no range: the page never reads `threshold` — routing is
    // decided server-side and arrives as `routed_to`. Bounding it here would
    // encode a schema rule the render does not depend on, so a future widening
    // of `promoter_threshold` would turn every live page into an error screen.
    typeof value.threshold === 'number'
  );
}

export function classifyReviewPageResponse(data: unknown, error: unknown): ReviewPageLoad {
  if (error) return { kind: 'error' };
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { kind: 'error' };

  const payload = data as Record<string, unknown>;
  // Only this branch means paused — an unknown slug lands here too, on purpose
  // (review-public/index.ts:129-134).
  if (payload.inactive === true) return { kind: 'inactive' };
  if (isPublicReviewPage(payload)) return { kind: 'ready', page: payload };
  return { kind: 'error' };
}
