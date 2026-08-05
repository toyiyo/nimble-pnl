-- ============================================================================
-- review_pages / review_responses / review_response_contacts were created in
-- 20260804100100 with grants for `anon` (revoked) and `authenticated`, but
-- none for `service_role`. PostgreSQL checks the table ACL before it ever
-- evaluates RLS, so `service_role`'s `rolbypassrls` does nothing here — with
-- no table grant, the service-role client every one of review-public's
-- handlers runs under (handlePage's SELECT, handleRate's INSERT, and
-- handleComment's SELECT/UPDATE + the contacts INSERT) fails outright with
-- "permission denied for table review_pages" before RLS is ever consulted.
-- This is the same requirement bank_reauth_notices already documents:
-- "Without this GRANT the SELECT above fails" (20260723130100).
--
-- pgTAP suites never exposed this because they run as `postgres`/
-- `authenticated`, never as `service_role`.
-- ============================================================================

-- Each grant is exactly what one handler needs, and no more. `service_role`
-- carries rolbypassrls, so its table ACL is the only thing standing between a
-- leaked key and the data: DELETE on any of these tables would put "erase the
-- restaurant's feedback history" inside the blast radius for no benefit,
-- since review-public never deletes a row.
GRANT SELECT ON public.review_pages TO service_role;              -- handlePage
GRANT SELECT, INSERT ON public.review_responses TO service_role;  -- handleRate
-- UPDATE is column-scoped for the same reason `authenticated`'s is
-- (20260804100100): handleComment writes exactly these three columns and
-- nothing else. A table-level UPDATE would let a leaked service key rewrite
-- `rating` or `routed_to` on rows that are already filed — silently turning a
-- one-star complaint into a five-star rave inside the restaurant's own
-- metrics, with no INSERT to show for it.
GRANT UPDATE (comment, contact_consent, commented_at)
  ON public.review_responses TO service_role;
GRANT INSERT ON public.review_response_contacts TO service_role;  -- handleComment
