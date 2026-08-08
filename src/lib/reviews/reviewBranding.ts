import { supabase } from '@/integrations/supabase/client';

/** Matches the bucket created by 20260804100100_review_funnel_tables.sql. */
const LOGO_BUCKET = 'review-page-logos';

/**
 * The circle a review page shows when a restaurant uploaded no logo.
 *
 * The public page and the printed sheet must agree, so this lives here and not
 * inside either surface. A guest who scans the QR should see the same two
 * letters that the paper on the counter showed.
 *
 * Not `getInitials` from tipDistribution.ts: that one takes the first and
 * last word ("Blue Fin Sushi" -> "BS"). A restaurant name reads better as
 * its first two words ("Blue Fin Sushi" -> "BF"). Same reason for a plain
 * empty string here, not tipDistribution's "?" fallback.
 */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * The manager side stores `logo_path`, not a URL (useReviewPages.ts:14), while
 * the guest side receives `logo_url` already built by the edge function
 * (supabase/functions/review-public/index.ts:137-138). The printed sheet runs
 * in the browser and has only the path, so it repeats that derivation here.
 *
 * No signature is involved: the bucket carries `public = true` and a public
 * SELECT policy (20260804100100_review_funnel_tables.sql:202-215).
 */
export function logoPublicUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(LOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}
