-- ============================================================================
-- Review funnel follow-ups: the unread badge follows the actionable rule.
--
-- A guest can now finish the follow-up form with contact details and no
-- comment. That guest asked to hear back, so the row needs a reply and must
-- reach the Unread badge. The old rule counted `comment IS NOT NULL` alone
-- and under-counts it.
--
-- Warning: a DROP FUNCTION here breaks the page for every user. A DROP resets
-- the grants, `authenticated` loses EXECUTE, and the Feedback tab header
-- fails with `permission denied for function`. Use CREATE OR REPLACE, keep
-- the same signature and the same attributes, and restate the two grant
-- lines below.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.review_response_metrics(p_restaurant_id UUID)
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
    -- Unread counts the rows a manager can act on: a comment to read, or a
    -- guest who asked to hear back. A silent star tap is also born with
    -- status 'new' and needs no triage, so counting it would leave a badge
    -- the manager has no way to open or clear.
    -- `isActionableResponse` in src/hooks/useReviewResponses.ts holds the same
    -- rule for the client. Change both together, or the badge count and the
    -- rows that show a status chip disagree.
    count(*) FILTER (
      WHERE rr.status = 'new'
        AND (rr.comment IS NOT NULL OR rr.contact_consent)
    ) AS unread_count
  FROM public.review_responses rr
  WHERE rr.restaurant_id = p_restaurant_id;
$$;

REVOKE ALL ON FUNCTION public.review_response_metrics(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_response_metrics(UUID) TO authenticated;

COMMENT ON FUNCTION public.review_response_metrics(UUID) IS
'Restaurant-wide average rating / total ratings / comment count / unread actionable count for the Feedback tab header. Unread counts a new row that holds a comment or contact consent. Not capped at any row count, unlike the list query that backs the inbox rows themselves.';

COMMENT ON COLUMN public.review_responses.commented_at IS
'When the guest finished the follow-up form. Does NOT imply a comment: a contact-only submit sets this and leaves comment NULL. Use comment IS NOT NULL to test for a comment.';
