-- ============================================================================
-- Review funnel: server-side aggregates for the Pages and Feedback tabs.
--
-- Both admin hooks previously folded raw review_responses rows into
-- averages/counts in JS — the Feedback tab's version capped that fetch at
-- 500 rows, so a restaurant past that many responses got a silently wrong
-- average/total/unread count, and the Pages tab's version had no cap at all,
-- pulling every response row for the restaurant on every mount just to sum
-- them client-side. Both are replaced by a real SQL aggregate, which is what
-- the design doc's own "Pages tab" section calls for: "Rating counts and
-- averages come from a single aggregate query per restaurant, not per card."
--
-- Both functions are LANGUAGE sql with no SECURITY DEFINER, so they run as
-- the calling role and review_responses_select's RLS (view:reviews) still
-- gates every row — a viewer without access to a restaurant's reviews gets
-- an aggregate over zero rows, not an error and not a leak.
-- ============================================================================

CREATE FUNCTION public.review_page_stats(p_restaurant_id UUID)
RETURNS TABLE (
  review_page_id UUID,
  average_rating NUMERIC,
  rating_count BIGINT,
  comment_count BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    rr.review_page_id,
    round(avg(rr.rating)::numeric, 1) AS average_rating,
    count(*) AS rating_count,
    count(*) FILTER (WHERE rr.comment IS NOT NULL) AS comment_count
  FROM public.review_responses rr
  WHERE rr.restaurant_id = p_restaurant_id
  GROUP BY rr.review_page_id;
$$;

REVOKE ALL ON FUNCTION public.review_page_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_page_stats(UUID) TO authenticated;

COMMENT ON FUNCTION public.review_page_stats(UUID) IS
'Per-page average rating / rating count / comment count for the Pages tab. One GROUP BY, not a client-side fold over every response row.';

CREATE FUNCTION public.review_response_metrics(p_restaurant_id UUID)
RETURNS TABLE (
  average_rating NUMERIC,
  total_ratings BIGINT,
  comment_count BIGINT,
  unread_count BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    round(avg(rr.rating)::numeric, 1) AS average_rating,
    count(*) AS total_ratings,
    count(*) FILTER (WHERE rr.comment IS NOT NULL) AS comment_count,
    -- Unread counts unread *comments*, not unread rows. A silent star tap is
    -- also born with status 'new' and never appears in the Feedback list, so
    -- counting every new row would leave a badge the manager has no way to
    -- open or clear — permanently nonzero under ordinary promoter traffic.
    count(*) FILTER (WHERE rr.status = 'new' AND rr.comment IS NOT NULL) AS unread_count
  FROM public.review_responses rr
  WHERE rr.restaurant_id = p_restaurant_id;
$$;

REVOKE ALL ON FUNCTION public.review_response_metrics(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_response_metrics(UUID) TO authenticated;

COMMENT ON FUNCTION public.review_response_metrics(UUID) IS
'Restaurant-wide average rating / total ratings / comment count / unread comment count for the Feedback tab header. Not capped at any row count, unlike the list query that backs the inbox rows themselves.';
